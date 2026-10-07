import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

let context;
let extensionId;
let worker;
// Test the delivered package, including the production-built worksheet.
const source = fileURLToPath(new URL('../../extension-dist/payment-desk-companion/', import.meta.url));
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`, '--enable-unsafe-extension-debugging'],
  });
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).hostname;
});
test.afterEach(async () => { if (context) await context.close(); });

const openPanelDocument = async (width = 390) => {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 850 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.frameLocator('#desk').locator('#sale-price')).toBeVisible();
  await expect(page.locator('#start-estimate')).toBeEnabled();
  return page;
};
// Native panels are page targets outside Playwright's tab inventory. Use CDP for
// the real toolbar/panel test; the other cases use the identical panel document.
const attachNativePanel = async (browserSession, targetId) => {
  const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { browserSession.off('Target.receivedMessageFromTarget', listener); reject(new Error(`Native panel ${method} timed out`)); }, 15_000);
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
  // Headless Chrome creates the native panel at 0×0 until its first paint.
  // Give that real panel a visible viewport so the iframe can render normally.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  await call('Page.captureScreenshot');
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await expect.poll(() => evaluate('({ready:Boolean(document.querySelector("#desk")?.contentDocument?.querySelector("#sale-price")),width:innerWidth,frameUrl:document.querySelector("#desk")?.contentWindow?.location.href})'), { timeout: 20_000 }).toMatchObject({ ready: true, width: 390 });
  await expect.poll(() => evaluate('document.getElementById("start-estimate").disabled')).toBe(false);
  await evaluate('document.getElementById("capture").click()');
  await expect.poll(() => evaluate('document.getElementById("capture").disabled')).toBe(false);
  await expect.poll(() => evaluate('({price:document.getElementById("price").value,reading:document.getElementById("capture").disabled,notice:document.getElementById("notice").textContent})')).toMatchObject({ price: '29995', reading: false });
  expect(await evaluate('document.getElementById("stock").value')).toBe('H12345');
  await evaluate('document.getElementById("start-estimate").click()');
  await expect.poll(() => evaluate('document.getElementById("desk").contentDocument.querySelector("dialog")?.textContent')).toContain('$29,995');
  await evaluate('Array.from(document.getElementById("desk").contentDocument.querySelectorAll("button")).find(b => b.textContent === "Start new estimate").click()');
  await expect.poll(() => evaluate('document.getElementById("desk").contentDocument.getElementById("sale-price").value')).toBe('29,995');
  expect(await evaluate('document.getElementById("desk").contentWindow.location.hash')).toBe('');
  expect(listing.url()).toBe(url);
  expect(context.pages().filter(page => page.url().startsWith('chrome-extension:'))).toHaveLength(0);
  await evaluate('document.getElementById("desk").contentDocument.fonts.ready');
  const screenshot = await call('Page.captureScreenshot');
  await testInfo.attach('native-side-panel', { body: Buffer.from(screenshot.data, 'base64'), contentType: 'image/png' });
  // Global panel remains the same live worksheet when the user changes tabs.
  const another = await context.newPage();
  await another.goto('about:blank');
  await another.bringToFront();
  expect(await evaluate('document.getElementById("desk").contentDocument.getElementById("sale-price").value')).toBe('29,995');
  await browserSession.detach();
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
  expect(await panel.evaluate(() => chrome.runtime.getManifest().permissions)).toEqual(['activeTab', 'scripting', 'sidePanel']);
  expect(await panel.evaluate(() => chrome.runtime.getManifest().host_permissions)).toBeUndefined();
  await panel.getByRole('button', { name: 'Hide vehicle' }).click();
  await expect(panel.frameLocator('#desk').locator('#sale-price')).toBeVisible();
});

test('packaged worksheet works offline, calculates, compares, copies and prints at panel widths', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const panel = await openPanelDocument(420);
  const errors = [];
  panel.on('pageerror', error => errors.push(error.message));
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
  expect(web.url()).toBe('https://desking.mysoldlog.com/');
  await expect(desk.locator('#sale-price')).toHaveValue('30,000');
});

test('panel dealership and fees survive Reset deal and reload without saving deal figures', async () => {
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
  expect(await frame.evaluate(() => Object.keys(localStorage).sort())).toEqual(['payment-desk.dealership.v1', 'payment-desk.fees.v1']);
});
