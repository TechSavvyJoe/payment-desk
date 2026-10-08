import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { DESK_DRAFT_KEY, LEGACY_DESK_DRAFT_KEY } from '../../src/lib/deskDraft.js';

let context;
let extensionId;
let worker;
// Test the delivered package, including the production-built worksheet.
const source = fileURLToPath(new URL('../../extension-dist/payment-desk-companion/', import.meta.url));
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`, '--enable-unsafe-extension-debugging', '--disable-background-mode'],
  });
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).hostname;
});
test.afterEach(async () => { if (context) await context.close(); });

const openPanelDocument = async (width = 390, height = 850) => {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.frameLocator('#desk').locator('#sale-price')).toBeVisible();
  await expect(page.locator('#start-estimate')).toBeEnabled();
  return page;
};

test('panel finishes loading before starting the worksheet', async () => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.addEventListener('load', () => {
      window.panelStartup = {
        frameSource: document.getElementById('desk').getAttribute('src'),
        loadingVisible: Boolean(document.getElementById('worksheet-loading')?.getBoundingClientRect().height),
      };
    }, { once: true });
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.frameLocator('#desk').locator('#sale-price')).toBeVisible();
  expect(await page.evaluate(() => window.panelStartup)).toEqual({ frameSource: null, loadingVisible: true });
  await expect(page.locator('#worksheet-loading')).toBeHidden();
  await expect(page.locator('#start-estimate')).toBeEnabled();
  await expect(page.locator('#inventory-notice')).toContainText('Automatic refresh is off');
  expect(errors).toEqual([]);
});

test('a worksheet startup failure offers retry and recovers without losing a loaded deal', async () => {
  const page = await context.newPage();
  await page.clock.install();
  await page.addInitScript(() => {
    const source = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    let first = true;
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', { ...source, set(value) {
      if (first && value === 'desk/index.html') { first = false; window.worksheetStartBlocked = true; return; }
      source.set.call(this, value);
    } });
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect.poll(() => page.evaluate(() => window.worksheetStartBlocked)).toBe(true);
  await expect(page.locator('#start-estimate')).toBeDisabled();
  await page.clock.fastForward(16_000);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.frameLocator('#desk').locator('#sale-price')).toBeVisible();
  await expect(page.locator('#worksheet-loading')).toBeHidden();
  await page.frameLocator('#desk').locator('#sale-price').fill('30000');
  // A stale retry event is harmless after the worksheet is ready.
  await page.locator('#worksheet-retry').dispatchEvent('click');
  await expect(page.frameLocator('#desk').locator('#sale-price')).toHaveValue('30000');
});

test('laptop panel keeps a readable estimate and initial deal inputs above its fixed payment bar', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const page = await openPanelDocument(390, 650);
  const desk = page.frameLocator('#desk');
  await desk.locator('#sale-price').fill('30000');
  const frame = page.frames().find(frame => frame.url().endsWith('/desk/index.html'));
  await frame.evaluate(() => document.fonts.ready);
  const metrics = await frame.evaluate(() => ({
    header: document.querySelector('.app-header').getBoundingClientRect().height,
    payment: document.querySelector('.mobile-results .results-panel').getBoundingClientRect().height,
    cashDown: document.getElementById('cash-down').getBoundingClientRect().bottom,
    paymentFont: parseFloat(getComputedStyle(document.querySelector('.mobile-results .payment-number strong')).fontSize),
    amountTop: document.querySelector('.mobile-results .payment-number').getBoundingClientRect().top,
    labelBottom: document.querySelector('.mobile-results .results-payment__label-row').getBoundingClientRect().bottom,
    bar: document.querySelector('.mobile-nav').getBoundingClientRect().top,
    cardWidth: document.querySelector('.deal-section').getBoundingClientRect().width,
    viewportWidth: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  await testInfo.attach('laptop-layout-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('laptop-panel.png') });
  expect(metrics.header).toBeLessThan(60);
  expect(metrics.payment).toBeLessThan(170);
  expect(metrics.paymentFont).toBeGreaterThanOrEqual(32);
  expect(metrics.amountTop).toBeGreaterThanOrEqual(metrics.labelBottom);
  expect(metrics.cashDown).toBeLessThan(metrics.bar);
  expect(metrics.cardWidth).toBeGreaterThan(metrics.viewportWidth * .95);
  expect(metrics.overflow).toBe(false);
});

// Native panels are page targets outside Playwright's tab inventory. Use CDP for
// the real toolbar/panel test; the other cases use the identical panel document.
const attachNativePanel = async (browserSession, targetId) => {
  const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { browserSession.off('Target.receivedMessageFromTarget', listener); reject(new Error(`Native panel ${method} timed out: ${params.expression ?? ''}`)); }, 15_000);
    const listener = event => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.id !== id) return;
      clearTimeout(timer);
      browserSession.off('Target.receivedMessageFromTarget', listener);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    };
    browserSession.on('Target.receivedMessageFromTarget', listener);
    browserSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
      clearTimeout(timer); browserSession.off('Target.receivedMessageFromTarget', listener); reject(error);
    });
  });
};

test('toolbar opens a real side panel and captures into its worksheet without changing the listing', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const listing = await context.newPage();
  const url = 'https://vehicle.example.test/explorer';
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<h1>2024 Ford Explorer</h1><script type="application/ld+json">{"@type":"Car","name":"2024 Ford Explorer XLT","sku":"H12345","offers":{"@type":"Offer","price":29995,"priceCurrency":"USD"}}</script>' }));
  await listing.goto(url);
  await listing.bringToFront();
  const browserSession = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const listingTarget = targetInfos.find(info => info.url === url);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: listingTarget.targetId });
  let panelTarget;
  await expect.poll(async () => {
    panelTarget = (await browserSession.send('Target.getTargets')).targetInfos.find(info => info.url === `chrome-extension://${extensionId}/sidepanel.html`);
    return Boolean(panelTarget);
  }).toBe(true);
  const call = await attachNativePanel(browserSession, panelTarget.targetId);
  // Playwright may auto-attach this non-tab page in a paused state. Resume its
  // renderer explicitly; otherwise CDP evaluations can wait forever at startup.
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Runtime.runIfWaitingForDebugger');
  // Headless Chrome creates the native panel at 0×0 until its first paint.
  // Give that real panel a visible viewport so the iframe can render normally.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  // The native compositor can lag the renderer on a busy machine. Wait for an
  // actual painted frame rather than treating the first paint as synchronous.
  await expect.poll(async () => {
    try { return Boolean((await call('Page.captureScreenshot')).data); }
    catch (error) { if (error.message === 'Unable to capture screenshot') return false; throw error; }
  }, { timeout: 20_000 }).toBe(true);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await expect.poll(() => evaluate('({ready:Boolean(document.querySelector("#desk")?.contentDocument?.querySelector("#sale-price")),width:innerWidth,frameUrl:document.querySelector("#desk")?.contentWindow?.location.href})'), { timeout: 20_000 }).toMatchObject({ ready: true, width: 390 });
  await expect.poll(() => evaluate('document.getElementById("start-estimate").disabled')).toBe(false);
  await evaluate('document.getElementById("capture").click()');
  await expect.poll(() => evaluate('document.getElementById("capture").disabled')).toBe(false);
  await expect.poll(() => evaluate('({price:document.getElementById("price").value,reading:document.getElementById("capture").disabled,notice:document.getElementById("notice").textContent})')).toMatchObject({ price: '29995', reading: false });
  expect(await evaluate('document.getElementById("stock").value')).toBe('H12345');
  // A failed attempt on a different, unauthorized tab must invalidate listing A.
  const unauthorized = await context.newPage();
  await unauthorized.goto('about:blank');
  await unauthorized.bringToFront();
  await evaluate('document.getElementById("capture").click()');
  await expect.poll(() => evaluate('document.getElementById("capture").disabled')).toBe(false);
  expect(await evaluate('({name:document.getElementById("vehicle-name").value,stock:document.getElementById("stock").value,price:document.getElementById("price").value,source:document.getElementById("source").textContent})')).toEqual({ name: '', stock: '', price: '', source: 'Enter the vehicle details manually.' });
  expect(await evaluate('document.getElementById("notice").textContent')).toContain('cannot be read');
  await listing.bringToFront();
  await evaluate('document.getElementById("capture").click()');
  await expect.poll(() => evaluate('document.getElementById("price").value')).toBe('29995');
  await evaluate('document.getElementById("start-estimate").click()');
  await expect.poll(() => evaluate('document.getElementById("desk").contentDocument.querySelector("dialog")?.textContent')).toContain('$29,995');
  await evaluate('Array.from(document.getElementById("desk").contentDocument.querySelectorAll("button")).find(b => b.textContent === "Start new estimate").click()');
  await expect.poll(() => evaluate('document.getElementById("desk").contentDocument.getElementById("sale-price").value')).toBe('29,995');
  expect(await evaluate('document.getElementById("desk").contentWindow.location.hash')).toBe('');
  expect(listing.url()).toBe(url);
  expect(context.pages().filter(page => page.url().startsWith('chrome-extension:'))).toHaveLength(0);
  const screenshot = await call('Page.captureScreenshot');
  await mkdir(testInfo.outputPath(), { recursive: true });
  const screenshotPath = testInfo.outputPath('native-side-panel.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  await testInfo.attach('native-side-panel', { path: screenshotPath, contentType: 'image/png' });
  // Global panel remains the same live worksheet when the user changes tabs.
  const another = await context.newPage();
  await another.goto('about:blank');
  await another.bringToFront();
  expect(await evaluate('document.getElementById("desk").contentDocument.getElementById("sale-price").value')).toBe('29,995');
  await browserSession.detach();
});

test('choosing inventory invalidates a pending listing capture before reviewing the saved vehicle', async () => {
  await worker.evaluate(async () => chrome.storage.local.set({ 'payment-desk.inventory.v1': {
    config: { site: 'https://dealer.example.com/', nightly: false },
    vehicles: [{ name: 'Saved Explorer', stock: 'S100', price: 25000, url: 'https://dealer.example.com/vehicles/100', condition: 'used', mileage: 12000, listed: true, lastSeenAt: 1000 }],
  } }));
  const panel = await context.newPage();
  await panel.addInitScript(() => {
    chrome.tabs.query = async () => [{ id: 1, url: 'https://listing.example.com/car' }];
    chrome.scripting.executeScript = () => new Promise((resolve, reject) => { window.finishCapture = fail => fail ? reject(new Error('Late capture failure')) : resolve([{ result: { name: 'Late capture', stock: 'L999', price: 19000, sourceHost: 'listing.example.com', notice: 'Late listing details' } }]); });
  });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const desk = panel.frameLocator('#desk');
  await expect(desk.locator('#sale-price')).toBeVisible();
  for (const fail of [false, true]) {
    await panel.getByRole('button', { name: 'Capture listing' }).click();
    await expect.poll(() => panel.evaluate(() => typeof window.finishCapture)).toBe('function');
    await expect(panel.getByRole('button', { name: 'Review in worksheet' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Inventory', exact: true }).click();
    await panel.getByRole('button', { name: 'Use vehicle' }).click();
    await expect(panel.locator('#vehicle-name')).toHaveValue('Saved Explorer');
    await panel.evaluate(fail => window.finishCapture(fail), fail);
    await expect(panel.locator('#vehicle-name')).toHaveValue('Saved Explorer');
    await expect(panel.locator('#stock')).toHaveValue('S100');
    await expect(panel.locator('#price')).toHaveValue('25000');
    await expect(panel.locator('#notice')).not.toContainText('Late listing');
    await expect(panel.locator('#notice')).not.toContainText('cannot be read');
    await expect(panel.getByRole('button', { name: 'Review in worksheet' })).toBeEnabled();
  }
  await panel.getByRole('button', { name: 'Review in worksheet' }).click();
  await expect(desk.getByRole('dialog', { name: 'Review captured vehicle' })).toContainText('Saved Explorer');
  await expect(desk.getByRole('dialog', { name: 'Review captured vehicle' })).toContainText('$25,000');
});

test('manual entry validates, reviews in place, and cancellation preserves an existing deal', async () => {
  const panel = await openPanelDocument();
  const desk = panel.frameLocator('#desk');
  await desk.locator('#sale-price').fill('40000');
  await desk.locator('#cash-down').fill('2000');
  await panel.getByRole('button', { name: 'Enter vehicle' }).click();
  await panel.locator('#vehicle-name').fill('2023 Ford Escape');
  await panel.locator('#stock').fill('E100');
  await panel.locator('#price').fill('$399/month');
  await panel.getByRole('button', { name: 'Review in worksheet' }).click();
  await expect(panel.locator('#price')).toHaveAttribute('aria-invalid', 'true');
  await panel.locator('#price').fill('24,500.50');
  await panel.getByRole('button', { name: 'Review in worksheet' }).click();
  await expect(desk.getByRole('dialog')).toContainText('clear the current deal figures');
  await expect(desk.locator('#sale-price')).toHaveValue('40,000');
  await desk.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(desk.locator('#cash-down')).toHaveValue('2,000');
  await panel.getByRole('button', { name: 'Enter vehicle' }).click();
  await panel.locator('#price').fill('24500.50');
  await panel.getByRole('button', { name: 'Review in worksheet' }).click();
  await desk.getByRole('button', { name: 'Start new estimate' }).click();
  await expect(desk.locator('#sale-price')).toHaveValue('24,500.5');
  await expect(desk.locator('#cash-down')).toHaveValue('0');
  await expect(panel.locator('#price')).toHaveValue('');
  await expect(panel.locator('#vehicle-controls')).toBeHidden();
});

test('unsupported-page fallback and narrow worksheet remain accessible', async () => {
  const panel = await openPanelDocument(360);
  await panel.getByRole('button', { name: 'Capture listing' }).click();
  await expect(panel.locator('#notice')).toContainText('cannot be read');
  await panel.locator('#vehicle-name').fill('2024 Explorer');
  expect((await new AxeBuilder({ page: panel }).analyze()).violations).toEqual([]);
  expect(await panel.evaluate(() => chrome.runtime.getManifest().permissions)).toEqual(['activeTab', 'scripting', 'sidePanel', 'storage', 'alarms', 'offscreen', 'webRequest']);
  expect(await panel.evaluate(() => chrome.runtime.getManifest().optional_host_permissions)).toEqual(['https://*/*']);
  expect(await panel.evaluate(() => chrome.runtime.getManifest().host_permissions)).toBeUndefined();
  await panel.getByRole('button', { name: 'Hide vehicle' }).click();
  await expect(panel.frameLocator('#desk').locator('#sale-price')).toBeVisible();
});

test('packaged worksheet works offline, calculates, compares, copies and prints at panel widths', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const panel = await openPanelDocument(420);
  const errors = [];
  panel.on('pageerror', error => errors.push(error.stack ?? error.message));
  await context.setOffline(true);
  await panel.reload();
  const desk = panel.frameLocator('#desk');
  await expect(desk.locator('#sale-price')).toBeVisible();
  const frame = panel.frames().find(frame => frame.url().endsWith('/desk/index.html'));
  for (const width of [360, 390, 600]) {
    await panel.setViewportSize({ width, height: 850 });
    await frame.evaluate(() => document.fonts.ready);
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.setViewportSize({ width: 420, height: 850 });
  await desk.locator('#sale-price').fill('30000');
  await desk.locator('#cash-down').fill('2000');
  await desk.locator('#sale-price').blur();
  await desk.locator('#mobile-grid-trigger').click();
  await expect(desk.getByRole('heading', { name: 'Payment grid', exact: true })).toBeVisible();
  await desk.getByRole('button', { name: /Use 60 months.*2,000.*down/ }).filter({ visible: true }).click();
  await desk.locator('#mobile-grid-trigger').click();
  await desk.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
  // Observe the existing copy/print APIs without launching an OS dialog.
  await frame.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedEstimate = text; } } });
    window.print = () => { window.testPrinted = true; };
  });
  await desk.getByRole('button', { name: 'Copy summary' }).click();
  const copied = await frame.evaluate(() => window.testCopiedEstimate);
  expect(copied).toContain('https://desking.mysoldlog.com/');
  expect(copied).not.toContain('chrome-extension:');
  await desk.getByRole('button', { name: 'Print', exact: true }).click();
  expect(await frame.evaluate(() => window.testPrinted)).toBe(true);
  await expect(desk.locator('.customer-print-root')).toHaveCount(1);
  await desk.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await expect(desk.locator('#sale-price')).toHaveValue('30,000');
  await panel.screenshot({ path: testInfo.outputPath('side-panel-worksheet.png') });
  expect(errors).toEqual([]);
});

test('web app button opens the fixed blank site and retains the panel deal', async () => {
  const panel = await openPanelDocument();
  const desk = panel.frameLocator('#desk');
  await desk.locator('#sale-price').fill('30000');
  await context.route('https://desking.mysoldlog.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Blank web app</h1>' }));
  const nextPage = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Web app' }).click();
  const web = await nextPage;
  await web.waitForLoadState();
  expect(web.url()).toBe(`https://desking.mysoldlog.com/#pd-companion=${extensionId}`);
  await expect(desk.locator('#sale-price')).toHaveValue('30,000');
});

test('production-origin web app searches the companion catalog and reviews vehicles before changing a deal', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(180_000);
  const site = 'https://dealer.example.com/';
  const record = (number, overrides = {}) => ({ name: `2024 Ford Explorer ${number}`, stock: `S${number}`, url: `${site}vehicles/${number}`, condition: 'used', price: 25000, websitePrice: 25280, mileage: 12000, listed: true, lastSeenAt: 1000, features: ['Rear camera'], ...overrides });
  await worker.evaluate(async state => { await chrome.storage.local.set({ 'payment-desk.inventory.v1': state }); }, {
    config: { site, nightly: false }, vehicles: [record(1, { condition: 'new' }), record(2, { price: null }), record(3, { listed: false })], lastCompletedAt: 1000,
    customer: 'private-value-must-not-be-shared',
  });
  const dist = resolve(fileURLToPath(new URL('../../dist/', import.meta.url)));
  const headersText = await readFile(fileURLToPath(new URL('../../public/_headers', import.meta.url)), 'utf8');
  const csp = headersText.split('\n').find(line => line.includes('Content-Security-Policy:')).split('Content-Security-Policy:')[1].trim();
  // Serve this build at the real allowlisted origin inside an isolated browser.
  // No production request or change is made by this test.
  const loadErrors = [];
  context.on('console', message => { if (message.type() === 'error') loadErrors.push(message.text()); });
  context.on('requestfailed', request => loadErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await context.route('https://desking.mysoldlog.com/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const path = resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(dist + sep)) return route.fulfill({ status: 404, body: '' });
    const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    try { await route.fulfill({ body: await readFile(path), contentType, headers: { 'Content-Security-Policy': csp } }); }
    catch { loadErrors.push(`Missing fixture: ${path}`); await route.fulfill({ status: 404, body: '' }); }
  });
  // Explicit navigation is routeable from its first request. Chrome-created
  // tabs can begin their initial navigation before Playwright attaches; the
  // preceding test separately checks the toolbar's exact handoff URL.
  const web = await context.newPage();
  await web.goto(`https://desking.mysoldlog.com/#pd-companion=${extensionId}`);
  await web.waitForLoadState('domcontentloaded');
  try { await expect(web.locator('#sale-price')).toBeVisible({ timeout: 30_000 }); }
  catch (error) {
    await testInfo.attach('web-load-errors', { body: JSON.stringify(loadErrors), contentType: 'application/json' });
    console.log(loadErrors);
    await web.screenshot({ path: testInfo.outputPath('web-load-failure.png') });
    throw error;
  }
  await expect.poll(() => web.url()).toBe('https://desking.mysoldlog.com/');
  await web.locator('#sale-price').fill('40000');
  await web.locator('#cash-down').fill('2000');
  await web.getByRole('button', { name: 'Inventory', exact: true }).click();
  const picker = web.getByRole('dialog', { name: 'Dealership inventory' });
  const expectVehicles = async count => {
    try { await expect(picker.locator('article')).toHaveCount(count, { timeout: 60_000 }); }
    catch (error) {
      await testInfo.attach('inventory-read-errors', { body: JSON.stringify(loadErrors), contentType: 'application/json' });
      throw error;
    }
  };
  await expectVehicles(2);
  await picker.getByRole('searchbox').fill('S1');
  await expectVehicles(1);
  await picker.getByRole('button', { name: 'Use vehicle' }).click();
  await expect(web.getByRole('dialog', { name: 'Review captured vehicle' })).toContainText('clear the current deal figures');
  await expect(web.locator('#sale-price')).toHaveValue('40,000');
  await web.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(web.locator('#cash-down')).toHaveValue('2,000');
  await web.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expectVehicles(2);
  await picker.getByRole('combobox').selectOption('used');
  await expectVehicles(1);
  await expect(picker.locator('article')).toContainText('$25,280 advertised');
  await picker.getByRole('button', { name: 'Use vehicle' }).click();
  await expect(web.getByRole('dialog', { name: 'Review captured vehicle' })).toContainText('Not provided');
  await web.getByRole('button', { name: 'Start new estimate' }).click();
  await expect(web.locator('#sale-price')).toHaveValue('');
  await expect(web.locator('#vehicle-reference')).toHaveValue('2024 Ford Explorer 2 · Stock S2');
  await web.reload();
  await web.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expectVehicles(2);
  await picker.getByRole('checkbox', { name: 'Include previously listed vehicles' }).check();
  await expectVehicles(3);
  const exported = await web.evaluate(id => new Promise(resolve => chrome.runtime.sendMessage(id, { target: 'inventory.catalog', action: 'read' }, result => resolve(JSON.stringify(result)))), extensionId);
  expect(exported).not.toContain('private-value');
  const refused = await web.evaluate(id => new Promise(resolve => chrome.runtime.sendMessage(id, { target: 'inventory.background', action: 'disconnect' }, result => { const error = chrome.runtime.lastError; resolve({ result, error: Boolean(error) }); })), extensionId);
  expect(refused.result).toBeUndefined();
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('payment-desk.inventory.v1'))['payment-desk.inventory.v1'].config.site)).toBe(site);
  // A crafted link must not replace the verified connection or break reads.
  const brokenLink = await context.newPage();
  await brokenLink.goto(`https://desking.mysoldlog.com/#pd-companion=${'a'.repeat(32)}`);
  await expect(brokenLink.locator('#sale-price')).toBeVisible();
  expect(await brokenLink.evaluate(() => localStorage.getItem('payment-desk.companion.v1'))).toBe(extensionId);
  await brokenLink.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(brokenLink.getByRole('dialog', { name: 'Dealership inventory' }).locator('article')).toHaveCount(2, { timeout: 60_000 });
  expect(await brokenLink.evaluate(() => localStorage.getItem('payment-desk.companion.v1'))).toBe(extensionId);
});

test('panel dealership and fees survive Reset deal and reload after the draft is cleared', async () => {
  const panel = await openPanelDocument();
  const desk = panel.frameLocator('#desk');
  await desk.getByRole('button', { name: 'Dealership settings' }).click();
  let settings = desk.getByRole('dialog', { name: 'Dealership settings' });
  await settings.getByLabel('Dealership name').fill('Lakeside Motors');
  await settings.getByRole('textbox', { name: 'Document fee', exact: true }).fill('200');
  await settings.getByRole('textbox', { name: 'CRV dealer fee', exact: true }).fill('125.50');
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await desk.locator('#sale-price').fill('30000');
  panel.on('dialog', dialog => dialog.accept());
  await desk.getByRole('button', { name: 'Reset deal' }).click();
  await expect(desk.locator('#sale-price')).toHaveValue('');
  await panel.reload();
  await desk.getByRole('button', { name: 'Dealership settings' }).click();
  settings = desk.getByRole('dialog', { name: 'Dealership settings' });
  await expect(settings.getByLabel('Dealership name')).toHaveValue('Lakeside Motors');
  await expect(settings.getByRole('textbox', { name: 'Document fee', exact: true })).toHaveValue('200');
  await expect(settings.getByRole('textbox', { name: 'CRV dealer fee', exact: true })).toHaveValue('125.5');
  const frame = panel.frames().find(frame => frame.url().endsWith('/desk/index.html'));
  const saved = await frame.evaluate(({ key, legacy }) => ({
    keys: Object.keys(localStorage).sort(), marker: JSON.parse(localStorage.getItem(key)), legacy: localStorage.getItem(legacy),
  }), { key: DESK_DRAFT_KEY, legacy: LEGACY_DESK_DRAFT_KEY });
  expect(saved.keys).toEqual(['payment-desk.dealership.v1', DESK_DRAFT_KEY, 'payment-desk.fees.v1'].sort());
  expect(saved.marker).toEqual({ version: 2, discarded: true, revision: expect.any(String) });
  expect(saved.legacy).toBeNull();
});

test('the companion draft survives panel reload and reopening until Reset deal', async () => {
  let panel = await openPanelDocument();
  let desk = panel.frameLocator('#desk');
  await desk.locator('#sale-price').fill('30000');
  await desk.locator('#cash-down').fill('2500');
  await desk.locator('#target-value').fill('450');
  await desk.locator('#target-value').blur();
  await panel.reload();
  await expect(desk.locator('#sale-price')).toHaveValue('30,000');
  await expect(desk.locator('#cash-down')).toHaveValue('2,500');
  await expect(desk.locator('#target-value')).toHaveValue('450');
  await panel.close();
  panel = await openPanelDocument();
  desk = panel.frameLocator('#desk');
  await expect(desk.locator('#sale-price')).toHaveValue('30,000');
  await expect(desk.locator('#cash-down')).toHaveValue('2,500');
  panel.once('dialog', dialog => dialog.accept());
  await desk.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await panel.reload();
  await expect(desk.locator('#sale-price')).toHaveValue('');
  await expect(desk.locator('#cash-down')).toHaveValue('0');
});

test('cold offline packaged companion generates and downloads a current local PDF', async () => {
  const external = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await context.setOffline(true);
  const panel = await openPanelDocument(450, 800);
  const desk = panel.frameLocator('#desk');
  await desk.locator('#sale-price').fill('25000'); await desk.locator('#sale-price').blur();
  await desk.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  const pending = panel.waitForEvent('download');
  await desk.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await pending;
  const bytes = await readFile(await download.path());
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getSubject()).toContain('Vehicle selling price: $25,000.00');
  expect(pdf.getSubject()).toContain('Estimated payment:');
  expect(pdf.getSubject()).not.toMatch(/total interest|total of payments/i);
  expect(external).toEqual([]);
});
