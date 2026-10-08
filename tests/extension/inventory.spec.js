import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { NIGHT_ALARM, WORK_ALARM } from '../../extensions/payment-desk-companion/inventoryModel.js';

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
async function connect(url = site) {
  await panel.locator('#dealership-site').fill(url);
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('ready');
}

test('a direct used-inventory page discovers new inventory before reporting completion', async () => {
  await connect(`${site}searchused.aspx`);
  const state = await saved();
  expect(state.vehicles.map(vehicle => vehicle.condition).sort()).toEqual(['new', 'used', 'used']);
  expect(requests).toContain(site);
  expect(requests).toContain(`${site}searchnew.aspx`);
});

for (const provider of ['DealerOn', 'DealerCarSearch']) {
  test(`a direct combined ${provider} feed completes without unsupported homepage discovery`, async () => {
    const feed = `${site}${provider === 'DealerOn' ? 'searchall.aspx' : 'inventory'}`;
    await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<h1>Dealer homepage without inventory navigation</h1>' }));
    if (provider === 'DealerOn') {
      await context.route(feed, route => route.fulfill({ contentType: 'text/html', body: `<script id="dlron-srp-model">${JSON.stringify({ ...config('used'), PageId: 30, BaseFilter: '', PageVehicleType: 'All' })}</script>` }));
      await context.route(`${site}api/vhcliaa/**/30?*`, route => route.fulfill({ json: { DisplayCards: [card('new', 1), card('used', 2)], Paging: { PaginationDataModel: { PageNumber: 1, TotalPages: 1, TotalCount: 2 } } } }));
    } else await context.route(`${feed}*`, route => {
      const page = Number(new URL(route.request().url()).searchParams.get('page') || 1);
      return route.fulfill({ contentType: 'text/html', body: `<span class="pager-summary">Page: ${page} of 2 (2 vehicles)</span><div class="invMainCell"><h4 class="vehicleTitleH4"><a href="/vdp/${page}/${page === 1 ? 'New' : 'Used'}-2024-Ford-Explorer">2024 Ford Explorer</a></h4><p>Stock #: S${page}</p></div>` });
    });
    await panel.locator('#dealership-site').fill(feed);
    await panel.getByRole('button', { name: 'Connect and refresh' }).click();
    await expect.poll(async () => ['ready', 'partial', 'error'].includes((await saved())?.status), { timeout: 30_000 }).toBe(true);
    const state = await saved();
    expect(state.status, state.error).toBe('ready');
    expect(state.error).toBe('');
    expect(state.lastCompletedAt).toBeGreaterThan(0);
    expect(state.vehicles.map(vehicle => vehicle.condition).sort()).toEqual(['new', 'used']);
    expect(requests).not.toContain(site);
  });
}

for (const failure of ['night', 'work', 'cleanup']) {
  test(`switching dealerships handles a ${failure} setup failure without losing a working connection`, async () => {
    const [worker] = context.serviceWorkers();
    await panel.locator('#dealership-site').blur();
    const previous = await panel.evaluate(async key => {
      const { vehicleRecord, NIGHT_ALARM } = await import('./inventoryModel.js');
      const former = 'https://former.example.com/';
      const state = { config: { site: former, nightly: true }, status: 'ready', error: '', lastCompletedAt: 1000, nextRefreshAt: Date.now() + 3_600_000,
        vehicles: [vehicleRecord({ name: '2024 Ford Escape', stock: 'OLD1', vin: '1FM5K8D80MGA12345', url: `${former}used/vehicle`, condition: 'used', currency: 'USD', price: 25000 }, former, 1000)] };
      await chrome.storage.local.set({ [key]: state });
      await chrome.alarms.create(NIGHT_ALARM, { when: state.nextRefreshAt });
      return state;
    }, KEY);
    expect(previous.vehicles[0]?.price).toBe(25000);
    await worker.evaluate(({ failure, NIGHT_ALARM, WORK_ALARM }) => {
      const create = chrome.alarms.create;
      let injected = false;
      chrome.alarms.create = async (...args) => {
        if (!injected && (failure === 'night' && args[0] === NIGHT_ALARM || failure === 'work' && args[0] === WORK_ALARM)) {
          injected = true;
          throw new Error(`Injected ${failure} setup failure`);
        }
        return create(...args);
      };
      globalThis.removedSites = [];
      const contains = chrome.permissions.contains;
      chrome.permissions.contains = ({ origins }) => origins.every(origin => origin.includes('former.example.com')) ? Promise.resolve(true) : contains({ origins });
      chrome.permissions.remove = async ({ origins }) => {
        globalThis.removedSites.push(origins);
        if (failure === 'cleanup') throw new Error('Injected cleanup failure');
        return true;
      };
    }, { failure, NIGHT_ALARM, WORK_ALARM });
    await expect(panel.locator('#dealership-site')).toHaveValue(previous.config.site);
    await panel.locator('#inventory-settings summary').click();
    await panel.locator('#dealership-site').fill(site);
    await panel.getByRole('button', { name: 'Connect and refresh' }).click();
    if (failure === 'cleanup') {
      await expect.poll(async () => {
        const state = await saved();
        return state?.config?.site === site && ['ready', 'partial', 'error', 'idle'].includes(state.status);
      }, { timeout: 30_000 }).toBe(true);
      expect((await saved()).status).toBe('ready');
      expect((await saved()).config.site).toBe(site);
      expect((await saved()).vehicles).toHaveLength(3);
      await expect(panel.locator('#inventory-notice')).toContainText('Previous website access could not be removed');
    } else {
      await expect(panel.locator('#inventory-notice')).toContainText(`Injected ${failure} setup failure`);
      expect(await saved()).toEqual(previous);
      expect(await worker.evaluate(() => globalThis.removedSites)).toEqual([]);
      const alarm = await worker.evaluate(name => chrome.alarms.get(name), NIGHT_ALARM);
      expect(alarm.scheduledTime).toBe(previous.nextRefreshAt);
      expect(await worker.evaluate(name => chrome.alarms.get(name), WORK_ALARM)).toBeUndefined();
    }
  });
}

for (const provider of ['DealerOn', 'DealerCarSearch']) {
  test(`${provider} verifies duplicate VIN source rows before deduplicating the catalog`, async () => {
    await connect();
    const previous = await saved();
    if (provider === 'DealerOn') {
      await context.route(`${site}api/vhcliaa/**`, route => {
        const url = new URL(route.request().url());
        const type = url.pathname.endsWith('/10') ? 'new' : 'used';
        const page = Number(url.searchParams.get('pt'));
        const body = response(type, page);
        body.DisplayCards = [card(type, type === 'new' ? 1 : 2)];
        body.DisplayCards[0].VehicleCard.VehicleDetailUrl = `${site}${type}/location-${page}`;
        return route.fulfill({ json: body });
      });
    } else {
      await context.route('https://dealer.example.com/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/robots.txt') return route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nAllow: /' });
        const navigation = '<a href="/inventory/new">New</a><a href="/inventory/used">Used</a>';
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: navigation });
        const type = url.pathname.endsWith('/new') ? 'new' : 'used';
        const page = Number(url.searchParams.get('page') || 1);
        const pages = type === 'new' ? 1 : 2;
        const number = type === 'new' ? 1 : 2;
        const html = `${navigation}<span class="pager-summary">Page: ${page} of ${pages} (${pages} vehicles)</span><div class="invMainCell"><h4 class="vehicleTitleH4"><a href="/${type}/location-${page}">2024 Ford Explorer</a></h4><p>VIN: 1FM5K8D80MGA1234${number}</p><p>Stock #: S${number}</p></div>`;
        return route.fulfill({ contentType: 'text/html', body: html });
      });
    }
    await panel.getByRole('button', { name: 'Refresh now' }).click();
    await expect.poll(async () => (await saved())?.lastCompletedAt, { timeout: 30_000 }).not.toBe(previous.lastCompletedAt);
    const state = await saved();
    expect(state.status).toBe('ready');
    expect(state.error).toBe('');
    expect(state.vehicles.filter(vehicle => vehicle.listed)).toHaveLength(2);
    expect(state.vehicles.find(vehicle => vehicle.id === '1FM5K8D80MGA12343').listed).toBe(false);
    expect(state.vehicles.filter(vehicle => vehicle.id === '1FM5K8D80MGA12342')).toHaveLength(1);
  });
}

test('separate DealerCarSearch new and used feeds verify their own totals', async () => {
  await context.route('https://dealer.example.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/robots.txt') return route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nAllow: /' });
    const navigation = '<a href="/inventory/new">New</a><a href="/inventory/used">Used</a>';
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: navigation });
    const type = url.pathname.endsWith('/new') ? 'new' : 'used';
    const page = Number(url.searchParams.get('page') || 1);
    const pages = type === 'new' ? 1 : 2;
    const number = type === 'new' ? 1 : page + 1;
    const html = `${navigation}<span class="LabelCityStateZip1">Roseville, MI 48066</span><span class="pager-summary">Page: ${page} of ${pages} (${pages} vehicles)</span><div class="invMainCell"><h4 class="vehicleTitleH4"><a href="/vdp/${number}/${type === 'new' ? 'New' : 'Used'}-2024-Ford-Explorer">2024 Ford Explorer</a></h4><p>Stock #: S${number}</p></div>`;
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await connect();
  const state = await saved();
  expect(state.vehicles).toHaveLength(3);
  expect(state.vehicles.map(vehicle => vehicle.condition).sort()).toEqual(['new', 'used', 'used']);
  expect(state.error).toBe('');
  expect(state.lastCompletedAt).toBeGreaterThan(0);
  expect(requests).toContain(`${site}inventory/used?page=2`);
});

test('each discovered origin gets its own robots policy before an inventory request', async () => {
  const www = 'https://www.dealer.example.com/';
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: `<a href="${www}searchnew.aspx">New inventory</a>` }));
  await context.route(`${www}**`, route => route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nDisallow: /' }));
  await panel.locator('#dealership-site').fill(site);
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('error');
  expect(requests).toContain(`${site}robots.txt`);
  expect(requests).toContain(`${www}robots.txt`);
  expect(requests).not.toContain(`${www}searchnew.aspx`);
  expect((await saved()).error).toContain('excludes this inventory path');
});

test('a robots response from a canonical host also applies to the requesting origin', async () => {
  const www = 'https://www.dealer.example.com/';
  // Routed synthetic hosts cannot serve a browser-followed redirect chain.
  // Model only Fetch's final response URL; all inventory reads still use the
  // real worker, network fixtures, parser, queue and Chrome storage.
  const [worker] = context.serviceWorkers();
  await worker.evaluate(({ source, final }) => {
    const original = fetch;
    globalThis.fetch = async (...args) => {
      const response = await original(...args);
      if (args[0] === source) Object.defineProperty(response, 'url', { value: final });
      return response;
    };
  }, { source: `${site}robots.txt`, final: `${www}robots.txt` });
  await panel.locator('#dealership-site').fill(site);
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect.poll(async () => ['ready', 'partial', 'error'].includes((await saved())?.status), { timeout: 30_000 }).toBe(true);
  const state = await saved();
  expect(state.status, `${state.error}; requests: ${requests.join(', ')}`).toBe('ready');
  expect(state.vehicles).toHaveLength(3);
  expect(requests.filter(url => url.endsWith('/robots.txt'))).toEqual([`${site}robots.txt`]);
});

test('a redirected robots resource cannot substitute for its destination origin policy', async () => {
  const www = 'https://www.dealer.example.com/';
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: `<a href="${www}searchnew.aspx">New inventory</a>` }));
  await context.route(`${www}**`, route => route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nDisallow: /' }));
  const [worker] = context.serviceWorkers();
  await worker.evaluate(({ source, final }) => {
    const original = fetch;
    globalThis.fetch = async (...args) => {
      const response = await original(...args);
      if (args[0] === source) Object.defineProperty(response, 'url', { value: final });
      return response;
    };
  }, { source: `${site}robots.txt`, final: `${www}apex-robots.txt` });
  await panel.locator('#dealership-site').fill(site);
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('error');
  expect(requests).toContain(`${www}robots.txt`);
  expect(requests).not.toContain(`${www}searchnew.aspx`);
  expect((await saved()).error).toContain('excludes this inventory path');
});

test('discovery uses the fetched document URL and neutral vehicle URLs retain the feed condition', async () => {
  const results = await panel.evaluate(async () => {
    const { parseInventoryHtml } = await import('./inventoryParser.js');
    const site = 'https://dealer.example.com/inventory/used/';
    const links = parseInventoryHtml('<a href="searchnew.aspx">New</a><a href="searchused.aspx">Used</a><a href="https://outside.example.com/inventory">Outside</a>', { url: 'https://dealer.example.com/', kind: 'html' }, site, 123);
    const html = '<span class="LabelCityStateZip1">Roseville, MI 48066</span><span class="pager-summary">Page: 1 of 1 (1 vehicles)</span><div class="invMainCell"><h4 class="vehicleTitleH4"><a href="/vdp/123/2024-Ford-Explorer">2024 Ford Explorer</a></h4><div class="i18r_customPricing"><div class="price"><label class="price-label">Retail Price</label><span class="price-price">$24,995</span></div></div></div>';
    return { links: links.tasks.map(task => task.url), newVehicle: parseInventoryHtml(html, { url: 'https://dealer.example.com/inventory/new', kind: 'html', condition: 'new' }, site, 123).vehicles[0], usedVehicle: parseInventoryHtml(html, { url: site, kind: 'html', condition: 'used' }, site, 123).vehicles[0], directNew: parseInventoryHtml(html, { url: 'https://dealer.example.com/inventory/new', kind: 'html', condition: 'unknown' }, site, 123).vehicles[0] };
  });
  expect(results.links).toEqual([`${site}searchnew.aspx`, `${site}searchused.aspx`]);
  expect(results.newVehicle).toMatchObject({ condition: 'new', price: null });
  expect(results.directNew).toMatchObject({ condition: 'new', price: null });
  expect(results.usedVehicle).toMatchObject({ condition: 'used', price: 24995 });
});

test('combined DealerOn feeds verify both conditions when a cached new vehicle disappears', async () => {
  const scopes = await panel.evaluate(async () => {
    const { parseInventoryHtml, parseDealerOn } = await import('./inventoryParser.js');
    return [['All', 'all'], [undefined, 'all'], [undefined, 'new'], [undefined, 'used']].map(([PageVehicleType, path]) => {
      const config = { DealerId: 123, PageId: 30, BaseFilter: '', PageVehicleType };
      const parsed = parseInventoryHtml(`<script id="dlron-srp-model">${JSON.stringify(config)}</script>`, { url: `https://dealer.example.com/search${path}.aspx` }, 'https://dealer.example.com/', 123);
      const task = parsed.tasks.find(task => task.kind === 'dealeron');
      const empty = parseDealerOn({ DisplayCards: [], Paging: { PaginationDataModel: { PageNumber: 1, TotalPages: 0, TotalCount: 0 } } }, task, 'https://dealer.example.com/', 123);
      return { condition: task.condition, scope: empty.scope };
    });
  });
  expect(scopes).toEqual([{ condition: 'all', scope: 'all' }, { condition: 'all', scope: 'all' }, { condition: 'new', scope: 'new' }, { condition: 'used', scope: 'used' }]);
  await connect();
  const previous = await saved();
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchall.aspx">All inventory</a>' }));
  await context.route(`${site}searchall.aspx`, route => route.fulfill({ contentType: 'text/html', body: `<script id="dlron-srp-model">${JSON.stringify({ ...config('used'), PageId: 30, BaseFilter: '', PageVehicleType: 'All' })}</script>` }));
  await context.route(`${site}api/vhcliaa/**`, route => route.fulfill({ json: { DisplayCards: [card('used', 2), card('used', 3)], Paging: { PaginationDataModel: { PageNumber: 1, TotalPages: 1, TotalCount: 2 } } } }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.lastCompletedAt, { timeout: 30_000 }).not.toBe(previous.lastCompletedAt);
  const state = await saved();
  expect(state.status).toBe('ready');
  expect(state.vehicles.filter(vehicle => vehicle.listed)).toHaveLength(2);
  expect(state.vehicles.find(vehicle => vehicle.condition === 'new').listed).toBe(false);
});

test('verified empty DealerCarSearch feeds complete and unlist only absent vehicles', async () => {
  const emptyGroups = await panel.evaluate(async () => {
    const { parseInventoryHtml } = await import('./inventoryParser.js');
    return ['1 of 1', '1 of 0', '0 of 0'].map(paging => {
      const result = parseInventoryHtml(`<span class="pager-summary">Page: ${paging} (0 vehicles)</span>`, { url: 'https://dealer.example.com/inventory/used', condition: 'used', feed: true }, 'https://dealer.example.com/', 123);
      return { count: result.vehicles.length, expected: result.expected, finalPage: result.finalPage, scope: result.scope };
    });
  });
  expect(emptyGroups).toEqual(Array(3).fill({ count: 0, expected: 0, finalPage: true, scope: 'used' }));
  await connect();
  const previous = await saved();
  await context.route(`${site}searchused.aspx`, route => route.fulfill({ contentType: 'text/html', body: '<span class="pager-summary">Page: 1 of 1 (0 vehicles)</span><a href="/searchnew.aspx">New</a>' }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.lastCompletedAt, { timeout: 30_000 }).not.toBe(previous.lastCompletedAt);
  const state = await saved();
  expect(state.status).toBe('ready');
  expect(state.vehicles.filter(vehicle => vehicle.listed).map(vehicle => vehicle.condition)).toEqual(['new']);
  expect(state.vehicles.filter(vehicle => vehicle.condition === 'used').every(vehicle => !vehicle.listed)).toBe(true);
});

test('a no-content robots response permits the verified inventory refresh', async () => {
  await context.route(`${site}robots.txt`, route => route.fulfill({ status: 204 }));
  await connect();
  expect((await saved()).vehicles).toHaveLength(3);
  expect(requests).toContain(`${site}searchnew.aspx`);
  expect(requests).toContain(`${site}searchused.aspx`);
});

for (const condition of ['new', 'used']) {
  test(`discovery retains the combined feed beside only a ${condition} feed on a fresh connection`, async () => {
    await context.route(site, route => route.fulfill({ contentType: 'text/html', body: `<a href="/search${condition}.aspx">${condition}</a><a href="/searchall.aspx">All inventory</a>` }));
    await context.route(`${site}searchall.aspx`, route => route.fulfill({ contentType: 'text/html', body: `<script id="dlron-srp-model">${JSON.stringify({ ...config('used'), PageId: 30, BaseFilter: '', PageVehicleType: 'All' })}</script>` }));
    await context.route(`${site}api/vhcliaa/**/30?*`, route => route.fulfill({ json: { DisplayCards: [card('new', 1), card('used', 2), card('used', 3)], Paging: { PaginationDataModel: { PageNumber: 1, TotalPages: 1, TotalCount: 3 } } } }));
    await connect();
    const state = await saved();
    expect(state.vehicles.map(vehicle => vehicle.condition).sort()).toEqual(['new', 'used', 'used']);
    expect(requests).toContain(`${site}searchall.aspx`);
    expect(state.lastCompletedAt).toBeGreaterThan(0);
  });
}

test('robots files containing only global records or comments permit inventory refreshes', async () => {
  for (const body of ['Sitemap: https://dealer.example.com/sitemap.xml', '# No exclusions configured']) {
    await context.route(`${site}robots.txt`, route => route.fulfill({ contentType: 'text/plain', body }));
    const previous = (await saved())?.lastCompletedAt;
    if (!previous) await connect();
    else {
      await panel.getByRole('button', { name: 'Refresh now' }).click();
      await expect.poll(async () => (await saved())?.lastCompletedAt, { timeout: 30_000 }).not.toBe(previous);
    }
    expect((await saved()).status).toBe('ready');
    expect((await saved()).vehicles).toHaveLength(3);
  }
});

test('global robots records preserve a shared exclusion and encoded inventory paths are not requested', async () => {
  await context.route(`${site}robots.txt`, route => route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nSitemap: https://dealer.example.com/sitemap.xml\nUser-agent: OtherBot\nDisallow: /private/' }));
  const inventory = `${site}%70rivate/inventory`;
  await panel.locator('#dealership-site').fill(inventory);
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('error');
  expect((await saved()).error).toContain('excludes this inventory path');
  expect(requests).not.toContain(inventory);
});

test('unparsed feed navigation cannot complete a refresh or unlist its cached vehicles', async () => {
  await connect();
  const previous = await saved();
  await context.route(`${site}searchused.aspx`, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchnew.aspx">New</a><a href="/searchused.aspx">Used</a>' }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  const state = await saved();
  expect(state.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(state.vehicles).toHaveLength(3);
  expect(state.vehicles.every(vehicle => vehicle.listed)).toBe(true);
  expect(state.error).toContain('feed could not be verified');
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchnew.aspx">New</a><a href="/searchused.aspx?make=Ford">Ford used</a>' }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('error');
  const filtered = await saved();
  expect(filtered.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(filtered.vehicles).toHaveLength(3);
  expect(filtered.vehicles.every(vehicle => vehicle.listed)).toBe(true);
  expect(filtered.error).toContain('Only filtered inventory links');
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchnew.aspx">New</a>' }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  const missing = await saved();
  expect(missing.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(missing.vehicles.every(vehicle => vehicle.listed)).toBe(true);
  expect(missing.error).toContain('cached inventory condition was not verified');
});

test('inventory redirects never request an excluded destination and preserve the old catalog', async () => {
  await connect();
  const previous = await saved();
  await context.route(`${site}robots.txt`, route => route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nAllow: /\nDisallow: /private/' }));
  await context.route(`${site}searchnew.aspx`, route => route.fulfill({ status: 302, headers: { location: `${site}private/new` } }));
  const before = requests.length;
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  expect(requests.slice(before)).not.toContain(`${site}private/new`);
  expect((await saved()).lastCompletedAt).toBe(previous.lastCompletedAt);
  expect((await saved()).vehicles.every(vehicle => vehicle.listed)).toBe(true);
  expect((await saved()).error).toContain('excludes this inventory path');
});

test('legacy inventory links redirect to checked canonical feeds and do not reread the connected feed', async () => {
  const used = `${site}used-vehicle-inventory-howell-mi.html`;
  const fresh = `${site}new-ford-inventory-howell-mi.html`;
  for (const [legacy, canonical, type] of [['searchused.aspx', used, 'used'], ['searchnew.aspx', fresh, 'new']]) {
    await context.route(`${site}${legacy}`, route => route.fulfill({ status: 301, headers: { location: new URL(canonical).pathname } }));
    await context.route(canonical, route => route.fulfill({ contentType: 'text/html', body: `<script id="dlron-srp-model" type="application/json">${JSON.stringify(config(type))}</script><a href="/searchnew.aspx">New</a><a href="/searchused.aspx">Used</a>` }));
  }
  await connect(used);
  const state = await saved();
  expect(state.error).toBe('');
  expect(state.vehicles.map(vehicle => vehicle.condition).sort()).toEqual(['new', 'used', 'used']);
  expect(requests).toContain(fresh);
  expect(requests.filter(url => url === used)).toHaveLength(1);
  expect(requests.filter(url => url.includes('/20') && url.includes('pt=1'))).toHaveLength(1);
});

test('redirect destinations need their own robots policy and outside hosts or loops keep the old catalog', async () => {
  await connect();
  const previous = await saved();
  const www = 'https://www.dealer.example.com/';
  await context.route(`${www}**`, route => route.fulfill({ contentType: 'text/plain', body: 'User-agent: *\nDisallow: /' }));
  await context.route(`${site}searchnew.aspx`, route => route.fulfill({ status: 302, headers: { location: `${www}new-canonical` } }));
  let before = requests.length;
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  expect(requests.slice(before)).toContain(`${www}robots.txt`);
  expect(requests.slice(before)).not.toContain(`${www}new-canonical`);
  expect((await saved()).error).toContain('excludes this inventory path');
  await context.route(`${site}searchnew.aspx`, route => route.fulfill({ status: 302, headers: { location: 'https://outside.example.com/inventory' } }));
  before = requests.length;
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  expect(requests.slice(before).some(url => url.startsWith('https://outside.example.com/'))).toBe(false);
  expect((await saved()).error).toContain('outside this dealership');
  await context.route(`${site}searchnew.aspx`, route => route.fulfill({ status: 302, headers: { location: '/redirect-again' } }));
  await context.route(`${site}redirect-again`, route => route.fulfill({ status: 302, headers: { location: '/searchnew.aspx' } }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  const state = await saved();
  expect(state.error).toContain('redirect chain loops');
  expect(state.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(state.vehicles.every(vehicle => vehicle.listed)).toBe(true);
});

test('filtered navigation is skipped and relative listing links use the fetched feed', async () => {
  const result = await panel.evaluate(async () => {
    const { parseInventoryHtml } = await import('./inventoryParser.js');
    const site = 'https://dealer.example.com/';
    const links = '<a href="/searchused.aspx?make=Ford">Ford</a><a href="/inventory/used?certified=true">Certified</a><a href="/searchused.aspx">All used</a><a href="/searchnew.aspx">All new</a>';
    const tasks = parseInventoryHtml(links, { url: site, kind: 'html' }, site, 123).tasks;
    const html = '<span class="LabelCityStateZip1">Roseville, MI 48066</span><span class="pager-summary">Page: 1 of 1 (1 vehicles)</span><div class="invMainCell"><h4 class="vehicleTitleH4"><a href="vehicle/123">2024 Ford Explorer</a></h4><div class="mainImgWrap"><img src="photos/123.jpg"></div></div>';
    const vehicle = parseInventoryHtml(html, { url: `${site}inventory/used/`, kind: 'html', condition: 'used' }, site, 123).vehicles[0];
    return { tasks, vehicle };
  });
  expect(result.tasks.map(task => task.url)).toEqual([`${site}searchnew.aspx`, `${site}searchused.aspx`]);
  expect(result.tasks.every(task => task.feed)).toBe(true);
  expect(result.vehicle.url).toBe(`${site}inventory/used/vehicle/123`);
  expect(result.vehicle.id).toBe(result.vehicle.url);
  expect(result.vehicle.photos).toEqual([`${site}inventory/used/photos/123.jpg`]);
});

test('a failed connection withdraws only newly approved website access', async () => {
  await connect();
  const previous = await saved();
  await panel.locator('#inventory-settings summary').click();
  await panel.locator('#dealership-site').fill('https://another.example.com/');
  // Headless Chrome cannot approve its native permission dialog. Simulate its
  // contract and an unsuccessful background command, without adding real hosts.
  await panel.evaluate(() => {
    window.withdrawnOrigins = [];
    chrome.permissions.contains = async ({ origins }) => origins[0] === 'https://www.another.example.com/*';
    chrome.permissions.request = async () => true;
    chrome.permissions.remove = async ({ origins }) => { window.withdrawnOrigins.push(origins); return true; };
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (...args) => args[0]?.target === 'inventory.background' && args[0]?.action === 'connect'
      ? Promise.resolve({ ok: false, error: 'Simulated connection write failure' }) : original(...args);
  });
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect(panel.locator('#inventory-notice')).toContainText('Simulated connection write failure');
  expect(await panel.evaluate(() => window.withdrawnOrigins)).toEqual([['https://another.example.com/*']]);
  expect((await saved()).config).toEqual(previous.config);
  await panel.evaluate(() => { chrome.permissions.contains = async () => true; });
  await panel.getByRole('button', { name: 'Connect and refresh' }).click();
  await expect(panel.getByRole('button', { name: 'Connect and refresh' })).toBeEnabled();
  expect(await panel.evaluate(() => window.withdrawnOrigins)).toHaveLength(1);
  expect((await saved()).config).toEqual(previous.config);
});

test('unknown cached conditions require all or both verified condition feeds before unlisting', async () => {
  await connect();
  await panel.evaluate(async key => {
    const state = (await chrome.storage.local.get(key))[key];
    const { vehicleRecord } = await import('./inventoryModel.js');
    const unknown = vehicleRecord({ ...state.vehicles[0], vin: '1FM5K8D80MGA19999', stock: 'X999', condition: 'unknown' }, state.config.site, Date.now());
    state.vehicles = [state.vehicles.find(vehicle => vehicle.condition === 'new'), unknown];
    await chrome.storage.local.set({ [key]: state });
  }, KEY);
  const previous = await saved();
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchnew.aspx">New inventory</a>' }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.status, { timeout: 30_000 }).toBe('partial');
  const partial = await saved();
  expect(partial.lastCompletedAt).toBe(previous.lastCompletedAt);
  expect(partial.vehicles.find(vehicle => vehicle.condition === 'unknown').listed).toBe(true);
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchnew.aspx">New</a><a href="/searchused.aspx">Used</a>' }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.lastCompletedAt, { timeout: 30_000 }).not.toBe(previous.lastCompletedAt);
  expect((await saved()).status).toBe('ready');
  expect((await saved()).vehicles.find(vehicle => vehicle.condition === 'unknown').listed).toBe(false);
  await panel.evaluate(async key => {
    const state = (await chrome.storage.local.get(key))[key];
    state.vehicles.find(vehicle => vehicle.condition === 'unknown').listed = true;
    await chrome.storage.local.set({ [key]: state });
  }, KEY);
  const complete = await saved();
  await context.route(site, route => route.fulfill({ contentType: 'text/html', body: '<a href="/searchall.aspx">All</a>' }));
  await context.route(`${site}searchall.aspx`, route => route.fulfill({ contentType: 'text/html', body: `<script id="dlron-srp-model">${JSON.stringify({ ...config('used'), PageId: 30, BaseFilter: '', PageVehicleType: 'All' })}</script>` }));
  await context.route(`${site}api/vhcliaa/**/30?*`, route => route.fulfill({ json: { DisplayCards: [card('new', 1)], Paging: { PaginationDataModel: { PageNumber: 1, TotalPages: 1, TotalCount: 1 } } } }));
  await panel.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await saved())?.lastCompletedAt, { timeout: 30_000 }).not.toBe(complete.lastCompletedAt);
  expect((await saved()).status).toBe('ready');
  expect((await saved()).vehicles.find(vehicle => vehicle.condition === 'unknown').listed).toBe(false);
});

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
  await desk.getByRole('button', { name: 'Inventory', exact: true }).click();
  const picker = desk.getByRole('dialog', { name: 'Dealership inventory' });
  await expect(picker.locator('article')).toHaveCount(3);
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
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
