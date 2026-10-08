import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPage, installInventoryWeb, isInventoryWebSender, validateCatalogPage } from '../extensions/payment-desk-companion/inventoryWeb.js';

const site = 'https://dealer.example.com/';
const vehicle = (number, overrides = {}) => ({ name: '2024 Ford Explorer', url: `${site}vehicle/${number}`, stock: `S${number}`, price: 25000, websitePrice: 26000, condition: 'used', listed: true, lastSeenAt: 1000, features: ['Rear camera'], ...overrides });

test('only the production web origin can read public inventory', async () => {
  const sender = { url: 'https://desking.mysoldlog.com/', origin: 'https://desking.mysoldlog.com', tab: { id: 1 } };
  assert.equal(isInventoryWebSender(sender), true);
  for (const changed of [
    { url: 'https://desking.mysoldlog.com.evil.example/' },
    { url: 'http://desking.mysoldlog.com/' },
    { origin: 'null' }, { origin: 'https://evil.example/' },
    { id: 'other-extension' }, { tab: undefined },
  ]) assert.equal(isInventoryWebSender({ ...sender, ...changed }), false);
});

test('catalog read is bounded, filtered, and contains only public vehicle data', async () => {
  const state = { config: { site, secret: 'private' }, dealershipFees: { secret: 'private' },
    job: { credentials: 'private' }, vehicles: Array.from({ length: 105 }, (_, number) => vehicle(number, { customer: 'private' })), lastCompletedAt: 1000 };
  const first = await catalogPage(state);
  assert.equal(first.total, 105);
  assert.equal(first.vehicles.length, 100);
  assert.equal(first.nextOffset, 100);
  assert.equal((await catalogPage(state, { offset: 100, revision: first.revision })).vehicles.length, 5);
  assert.equal((await catalogPage(state, { query: 'S104' })).vehicles[0].stock, 'S104');
  assert.equal(JSON.stringify(first).includes('private'), false);
  assert.equal(first.refreshing, true);
  assert.equal(first.vehicles[0].price, 25000);
  assert.equal(first.vehicles[0].websitePrice, 26000);
});

test('old, certified and unverified-price vehicles retain their meaning', async () => {
  const state = { config: { site }, vehicles: [vehicle(1, { listed: false }), vehicle(2, { condition: 'certified' }), vehicle(3, { price: null, websitePrice: 25000 })] };
  assert.equal((await catalogPage(state)).total, 2);
  assert.equal((await catalogPage(state, { includeOld: true, condition: 'used' })).total, 3);
  assert.equal((await catalogPage(state, { query: 'S3' })).vehicles[0].price, null);
  assert.equal((await catalogPage(state, { condition: 'new' })).total, 0);
});

test('response validation rejects malformed pages and unsafe listing URLs', async () => {
  assert.equal(validateCatalogPage({ ok: true, version: 2, vehicles: [] }), null);
  assert.equal(validateCatalogPage({ ok: true, version: 1, site: 'javascript:alert(1)', vehicles: [] }), null);
  const page = await catalogPage({ config: { site }, vehicles: [vehicle(1), vehicle(2, { url: 'https://evil.example/vehicle/2' })] });
  assert.equal(page.vehicles.length, 1);
  assert.deepEqual(validateCatalogPage(page), page);
  assert.equal(validateCatalogPage({ ...page, vehicles: Array(101).fill(vehicle(1)) }), null);
});

test('continuation pages cannot combine different catalog snapshots or filters', async () => {
  const state = { config: { site }, vehicles: Array.from({ length: 101 }, (_, n) => vehicle(n)), lastCompletedAt: 1000 };
  const first = await catalogPage(state);
  const next = await catalogPage(state, { offset: 100, revision: first.revision });
  assert.equal(next.vehicles[0].stock, 'S100');
  assert.equal(next.revision, first.revision);
  for (const changed of [
    { ...state, vehicles: [...state.vehicles].reverse() },
    { ...state, vehicles: state.vehicles.map((v, n) => n === 0 ? { ...v, price: 26000 } : v) },
    { ...state, lastCompletedAt: 2000 },
    { ...state, config: { site: 'https://other.example.com/' } },
  ]) assert.deepEqual(await catalogPage(changed, { offset: 100, revision: first.revision }), { ok: false, code: 'catalog_changed' });
  assert.deepEqual(await catalogPage(state, { offset: 100 }), { ok: false, code: 'catalog_changed' });
  assert.deepEqual(await catalogPage(state, { offset: 100, revision: first.revision, query: 'Ford' }), { ok: false, code: 'catalog_changed' });
  // Private changes cannot affect the public fingerprint or disclose their data.
  const privateChange = await catalogPage({ ...state, credentials: 'synthetic-private', customer: 'synthetic-private' });
  assert.equal(privateChange.revision, first.revision);
  assert.equal(JSON.stringify(privateChange).includes('synthetic-private'), false);
});

test('an older companion may provide a first page but cannot claim snapshot consistency', async () => {
  const current = await catalogPage({ config: { site }, vehicles: [vehicle(1)] });
  const legacy = { ...current };
  delete legacy.revision;
  assert.equal(validateCatalogPage(legacy).revision, null);
  assert.equal(validateCatalogPage({ ...current, revision: 'unbounded-or-invalid' }).revision, null);
});

test('native catalog callbacks preserve sender checks and report storage failures', async t => {
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  let external, internal, reads = 0, failure = false, throws = false;
  const state = { config: { site, secret: 'private' }, vehicles: [vehicle(1, { customer: 'private' })] };
  const runtime = {
    id: 'companion', getURL: path => `chrome-extension://companion/${path}`,
    onMessageExternal: { addListener: fn => { external = fn; } },
    onMessage: { addListener: fn => { internal = fn; } },
  };
  globalThis.chrome = { runtime, storage: { local: { get(key, callback) {
    reads += 1;
    if (throws) throw new Error('storage unavailable');
    queueMicrotask(() => {
      runtime.lastError = failure ? { message: 'storage unavailable' } : undefined;
      callback({ [key]: state });
      delete runtime.lastError;
    });
  } } } };
  installInventoryWeb();
  const message = { target: 'inventory.catalog', action: 'read' };
  const sender = { url: 'https://desking.mysoldlog.com/', origin: 'https://desking.mysoldlog.com', tab: { id: 1 } };
  assert.equal(external(message, { ...sender, origin: 'https://evil.example' }, () => assert.fail('untrusted response')), undefined);
  assert.equal(internal(message, { id: 'another-extension', url: runtime.getURL('desk/') }, () => assert.fail('untrusted response')), undefined);
  assert.equal(reads, 0);
  const read = (listener, source) => new Promise(resolve => {
    assert.equal(listener(message, source, resolve), true);
  });
  const response = await read(external, sender);
  assert.equal(response.vehicles[0].stock, 'S1');
  assert.match(response.revision, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(response).includes('private'), false);
  assert.deepEqual(await read(internal, { id: 'companion', url: runtime.getURL('desk/index.html') }), response);
  failure = true;
  const failed = { ok: false, error: 'The saved inventory could not be read.' };
  assert.deepEqual(await read(external, sender), failed);
  throws = true;
  assert.deepEqual(await read(external, sender), failed);
});
