import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

let context;
let extensionId;
const source = fileURLToPath(new URL('../../extensions/payment-desk-companion/', import.meta.url));
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`, '--enable-unsafe-extension-debugging'],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).hostname;
});
test.afterEach(async () => {
  if (!context) return;
  await context.unrouteAll({ behavior: 'wait' });
  await context.close();
});

const openPopup = async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
};

test('toolbar authorization and real capture transfer a reviewed vehicle into the built app', async ({ baseURL }, testInfo) => {
  const listing = await context.newPage();
  const listingUrl = 'https://vehicle.example.test/explorer';
  await context.route(listingUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>2024 Ford Explorer</h1><script type="application/ld+json">{"@type":"Car","name":"2024 Ford Explorer XLT","sku":"H12345","offers":{"@type":"Offer","price":29995,"priceCurrency":"USD"}}</script>' }));
  await listing.goto(listingUrl);
  const browserSession = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const targetInfo = targetInfos.find(info => info.url === listingUrl);
  expect(targetInfo).toBeDefined();
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
  // Native action popups are CDP "other" targets. Exercise the same popup document
  // in a tab after the real toolbar action grants activeTab on the listing.
  const popup = await openPopup();
  await listing.bringToFront();
  await popup.getByRole('button', { name: 'Capture vehicle from this page' }).click();
  await expect(popup.locator('#price')).toHaveValue('29995');
  await expect(popup.locator('#stock')).toHaveValue('H12345');
  await expect(popup.locator('#source')).toContainText('vehicle.example.test');
  await popup.bringToFront();
  await popup.locator('body').screenshot({ path: testInfo.outputPath('companion-captured.png') });
  // Keep the real tabs API, but route the intended production handoff to the local
  // build. Extension-created tabs can send their first request before routing attaches.
  await popup.evaluate(localDesk => {
    const createTab = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = properties => {
      const destination = new URL(properties.url);
      if (destination.origin !== 'https://desking.mysoldlog.com') throw new Error('Unexpected destination');
      return createTab({ ...properties, url: localDesk + '/' + destination.hash });
    };
  }, baseURL);
  const deskReady = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Start estimate' }).click();
  const desk = await deskReady;
  await desk.bringToFront();
  await desk.waitForLoadState();
  await expect(desk.getByRole('dialog', { name: 'Review captured vehicle' })).toContainText('$29,995');
  await desk.getByRole('button', { name: 'Start new estimate' }).click();
  await expect(desk.locator('#sale-price')).toHaveValue('29,995');
  await expect(desk.locator('#vehicle-reference')).toHaveValue('2024 Ford Explorer XLT · Stock H12345');
  expect(new URL(desk.url()).hash).toBe('');
  await desk.screenshot({ path: testInfo.outputPath('companion-estimate.png'), fullPage: true });
  await browserSession.detach();
});
test('manual entry validates price, opens a fixed URL and clears transient fields', async () => {
  const popup = await openPopup();
  await popup.locator('#vehicle-name').fill('2023 Ford Escape');
  await popup.locator('#stock').fill('E100');
  await popup.locator('#price').fill('$399/month');
  await popup.getByRole('button', { name: 'Start estimate' }).click();
  await expect(popup.locator('#price')).toHaveAttribute('aria-invalid', 'true');
  await popup.locator('#price').fill('24,500.50');
  await context.route('https://desking.mysoldlog.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Destination</h1>' }));
  const nextPage = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Start estimate' }).click();
  const desk = await nextPage;
  await desk.waitForLoadState();
  expect(new URL(desk.url()).origin).toBe('https://desking.mysoldlog.com');
  expect(JSON.parse(decodeURIComponent(new URL(desk.url()).hash.slice('#pd-vehicle='.length)))).toEqual({ version: 1, salePrice: 24500.5, vehicleDescription: '2023 Ford Escape · Stock E100' });
  await expect(popup.locator('#price')).toHaveValue('');
});
test('unsupported pages show a usable fallback and the popup is accessible', async () => {
  const popup = await openPopup();
  await popup.getByRole('button', { name: 'Capture vehicle from this page' }).click();
  await expect(popup.locator('#notice')).toContainText('cannot be read');
  await popup.locator('#vehicle-name').fill('2024 Explorer');
  const results = await new AxeBuilder({ page: popup }).analyze();
  expect(results.violations).toEqual([]);
  expect(await popup.evaluate(() => chrome.runtime.getManifest().permissions)).toEqual(['activeTab', 'scripting']);
});
test('Open desk opens a blank estimate without listing data', async () => {
  const popup = await openPopup();
  await context.route('https://desking.mysoldlog.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Blank desk</h1>' }));
  const nextPage = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Open desk' }).click();
  const desk = await nextPage;
  await desk.waitForLoadState();
  expect(desk.url()).toBe('https://desking.mysoldlog.com/');
});
