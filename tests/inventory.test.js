import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, dealershipSite, inventoryFeedUrl, inventoryUrl, mergeInventory, nextNightAt, publicImage, refreshDue, robotsAllows, robotsPolicy, siteOrigins, unfilteredInventoryUrl, usdPrice, vehicleRecord } from '../extensions/payment-desk-companion/inventoryModel.js';
import { validateVehicle } from '../extensions/payment-desk-companion/vehicleHandoff.js';

test('inventory connects only public HTTPS sites and scopes access to apex/www', () => {
  assert.equal(dealershipSite('dealer.example.com'), 'https://dealer.example.com/');
  assert.deepEqual(siteOrigins('https://www.dealer.example.com/'), ['https://dealer.example.com/*', 'https://www.dealer.example.com/*']);
  for (const site of ['http://dealer.example.com', 'https://localhost', 'https://192.168.1.1/', 'https://127.0.0.1/', 'https://user:pass@dealer.example.com/', 'https://dealer.example.com:1234/', 'https://dealer.local/', 'javascript:alert(1)', 'https://dealer.example.test/']) assert.throws(() => dealershipSite(site));
  assert.equal(inventoryUrl('/searchnew.aspx', 'https://dealer.example.com/'), 'https://dealer.example.com/searchnew.aspx');
  for (const url of ['https://other.example.com/', 'http://dealer.example.com/', 'https://dealer.example.com.attacker.com/', undefined, '']) assert.equal(inventoryUrl(url, 'https://dealer.example.com/'), null);
  assert.equal(publicImage('https://images.example.com/photo.jpg', 'https://dealer.example.com/'), 'https://images.example.com/photo.jpg');
  assert.equal(publicImage('data:image/svg+xml,<svg/>', 'https://dealer.example.com/'), null);
  assert.equal(publicImage(undefined, 'https://dealer.example.com/'), null);
});

test('inventory never invents a selling price from payments or non-USD values', () => {
  assert.equal(usdPrice('$29,995.50'), 29995.5);
  for (const price of [0, '$299/month', '$2,000 down', '-500', 'Call for price', 1000001, '24.999', NaN]) assert.equal(usdPrice(price), null);
  const source = { name: '2024 Ford Explorer', url: '/used/123', vin: '1FM5K8D80MGA12345', price: 29995, currency: 'CAD' };
  assert.equal(vehicleRecord(source, 'https://dealer.example.com', 100).price, null);
  assert.equal(vehicleRecord({ ...source, currency: 'USD' }, 'https://dealer.example.com', 100).price, 29995);
});

test('full inventory selection excludes filters and starts pagination at page one', () => {
  for (const path of ['/searchnew.aspx', '/inventory/used/', '/used-inventory/index.htm', '/used-vehicle-inventory-howell-mi.html']) assert.equal(inventoryFeedUrl(`https://dealer.example.com${path}`), true);
  assert.equal(inventoryFeedUrl('https://dealer.example.com/'), false);
  for (const query of ['', '?clearall=1', '?page=1']) assert.equal(unfilteredInventoryUrl(`https://dealer.example.com/inventory${query}`), true);
  for (const query of ['?make=Ford', '?certified=true', '?clearall=1&make=Ford', '?page=2']) assert.equal(unfilteredInventoryUrl(`https://dealer.example.com/inventory${query}`), false);
  assert.equal(unfilteredInventoryUrl('https://dealer.example.com/inventory?page=2', 2), true);
});

test('inventory text removes directionality controls and remains importable', () => {
  for (const control of ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']) {
    const vehicle = vehicleRecord({ name: `2024 Ford ${control}Explorer`, stock: `H${control}123`, url: '/used/123', price: 29995, currency: 'USD', features: [`Heated${control}seats`] }, 'https://dealer.example.com', 100);
    assert.equal(cleanText(`A${control}B`), 'A B');
    assert.equal(vehicle.name, '2024 Ford Explorer');
    assert.equal(vehicle.stock, 'H 123');
    assert.deepEqual(vehicle.features, ['Heated seats']);
    assert.ok(validateVehicle({ version: 1, salePrice: vehicle.price, vehicleDescription: `${vehicle.name} · ${vehicle.stock}` }));
  }
  assert.equal(cleanText('2024 تويوتا Corolla'), '2024 تويوتا Corolla');
});

test('records keep only bounded public vehicle fields, without customer data or executable URLs', () => {
  const vehicle = vehicleRecord({ name: '2024 Ford Explorer', url: '/used/123', vin: '1FM5K8D80MGA12345', stock: 'H123', mileage: '12,345', photos: ['javascript:alert(1)', '/photo.jpg', '/photo.jpg'], customer: 'Private', downPayment: 1000, features: ['Heated seats'], location: 'Other location', availability: 'Not in stock' }, 'https://dealer.example.com', 100);
  assert.equal(vehicle.id, '1FM5K8D80MGA12345');
  assert.equal(vehicle.mileage, 12345);
  assert.deepEqual(vehicle.photos, ['https://dealer.example.com/photo.jpg']);
  assert.equal('customer' in vehicle, false);
  assert.equal('downPayment' in vehicle, false);
  assert.equal(vehicle.lastSeenAt, 100);
  for (const mileage of [undefined, null, '', 'Not available', '-5', '12 miles', '2,000,001']) {
    assert.equal(vehicleRecord({ name: '2024 Ford Explorer', url: '/used/123', mileage }, 'https://dealer.example.com', 100).mileage, null);
  }
  assert.equal(vehicleRecord({ name: '2024 Ford Explorer', url: '/used/123', mileage: 0 }, 'https://dealer.example.com', 100).mileage, 0);
  assert.equal(vehicleRecord({ name: 'Brake parts', url: '/parts' }, 'https://dealer.example.com', 100), null);
  assert.equal(vehicleRecord({ name: '2024 Ford Explorer' }, 'https://dealer.example.com', 100), null);
});

test('partial refresh preserves missing vehicles and complete refresh says not listed, never sold', () => {
  const a = { id: 'A', listed: true, lastSeenAt: 100, price: 10000 };
  const b = { id: 'B', listed: true, lastSeenAt: 100 };
  const updated = { ...a, price: 11000, lastSeenAt: 200 };
  const partial = mergeInventory([a, b], [updated, updated], false);
  assert.equal(partial.length, 2);
  assert.equal(partial.find(v => v.id === 'B').listed, true);
  assert.equal(partial.find(v => v.id === 'A').price, 11000);
  const complete = mergeInventory([a, b], [updated], true);
  assert.equal(complete.find(v => v.id === 'B').listed, false);
  assert.equal(complete.find(v => v.id === 'B').lastSeenAt, 100);
  assert.equal(complete.some(v => v.sold), false);
});

test('nightly scheduling uses the next local calendar night and missed-run catch-up', () => {
  for (const now of [new Date(2026, 9, 7, 1), new Date(2026, 9, 7, 4), new Date(2026, 9, 31, 23), new Date(2026, 2, 7, 23)]) {
    const night = new Date(nextNightAt(now.getTime()));
    assert.ok(night > now);
    assert.equal(night.getMinutes(), 0);
    assert.ok(night.getHours() === 2 || night.getHours() === 3);
  }
  assert.equal(refreshDue({ config: { nightly: true }, nextRefreshAt: 100 }, 200), true);
  assert.equal(refreshDue({ config: { nightly: false }, nextRefreshAt: 100 }, 200), false);
  assert.equal(refreshDue({ config: { nightly: true }, nextRefreshAt: 300 }, 200), false);
  assert.equal(refreshDue({ config: { nightly: true }, job: {}, nextRefreshAt: 100 }, 200), false);
  // After the spring-forward day has passed 3 AM, tomorrow returns to 2 AM.
  const spring = new Date(nextNightAt(new Date(2026, 2, 8, 4).getTime()));
  assert.equal(spring.getDate(), 9);
  assert.equal(spring.getHours(), 2);
});

test('robots policies respect site exclusions, wildcards, more-specific allows and crawl delay', () => {
  const policy = robotsPolicy('User-agent: OtherBot\nDisallow: /\nUser-agent: *\nCrawl-delay: 10\nDisallow: /private/\nDisallow: /*.axd$\nAllow: /private/public\nUser-Agent: *\nDisallow: /rss-usedinventory.aspx');
  assert.equal(policy.delay, 10);
  for (const path of ['/private/data', '/rss-usedinventory.aspx', '/resource.axd']) assert.equal(robotsAllows(policy, `https://dealer.example.com${path}`), false);
  for (const path of ['/private/public/data', '/searchused.aspx', '/resource.axd?x=1', '/api/vhcliaa/vehicles']) assert.equal(robotsAllows(policy, `https://dealer.example.com${path}`), true);
  const specific = robotsPolicy('User-agent: *\nAllow: /\nUser-agent: PaymentDeskCompanion\nDisallow: /');
  assert.equal(robotsAllows(specific, 'https://dealer.example.com/'), true);
  const namedAllow = robotsPolicy('User-agent: *\nDisallow: /\nCrawl-delay: 10\nUser-agent: PaymentDeskCompanion\nAllow: /');
  assert.equal(robotsAllows(namedAllow, 'https://dealer.example.com/searchused.aspx'), false);
  assert.equal(namedAllow.delay, 10);
});

test('global robots records do not split consecutive agents and missing groups allow access', () => {
  const policy = robotsPolicy('User-agent: *\nSitemap: https://dealer.example.com/sitemap.xml\nUser-agent: OtherBot\nDisallow: /private/\nUser-agent: NamedBot\nAllow: /private/');
  assert.equal(robotsAllows(policy, 'https://dealer.example.com/private/inventory'), false);
  for (const text of ['Sitemap: https://dealer.example.com/sitemap.xml', '# No exclusions']) {
    assert.equal(robotsAllows(robotsPolicy(text), 'https://dealer.example.com/searchall.aspx'), true);
  }
});

test('robots matching normalizes encoded unreserved and Unicode paths without decoding reserved octets', () => {
  const policy = robotsPolicy('User-agent: *\nDisallow: /private/\nAllow: /private/public/\nDisallow: /%72estricted/\nDisallow: /café/\nDisallow: /literal%2A$\nDisallow: /literal%24$');
  for (const path of ['/%70rivate/inventory', '/private/%69nventory', '/restricted/list', '/caf%C3%A9/list', '/literal*', '/literal$']) {
    assert.equal(robotsAllows(policy, `https://dealer.example.com${path}`), false, path);
  }
  for (const path of ['/%70rivate/%70ublic/list', '/private%2Finventory', '/restricted%2Flist', '/literalx']) {
    assert.equal(robotsAllows(policy, `https://dealer.example.com${path}`), true, path);
  }
  const equalRules = robotsPolicy('User-agent: *\nDisallow: /%70rivate/\nAllow: /private/');
  assert.equal(robotsAllows(equalRules, 'https://dealer.example.com/private/list'), true);
});
