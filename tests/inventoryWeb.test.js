import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPage, isInventoryWebSender, validateCatalogPage } from '../extensions/payment-desk-companion/inventoryWeb.js';

const site = 'https://dealer.example.com/';
const vehicle = (number, overrides = {}) => ({ name: '2024 Ford Explorer', url: `${site}vehicle/${number}`, stock: `S${number}`, price: 25000, websitePrice: 26000, condition: 'used', listed: true, lastSeenAt: 1000, features: ['Rear camera'], ...overrides });

test('only the production web origin can read public inventory', () => {
  const sender = { url: 'https://desking.mysoldlog.com/', origin: 'https://desking.mysoldlog.com', tab: { id: 1 } };
  assert.equal(isInventoryWebSender(sender), true);
  for (const changed of [
    { url: 'https://desking.mysoldlog.com.evil.example/' },
    { url: 'http://desking.mysoldlog.com/' },
    { origin: 'null' }, { origin: 'https://evil.example/' },
    { id: 'other-extension' }, { tab: undefined },
  ]) assert.equal(isInventoryWebSender({ ...sender, ...changed }), false);
});

test('catalog read is bounded, filtered, and contains only public vehicle data', () => {
  const state = { config: { site, secret: 'private' }, dealershipFees: { secret: 'private' },
    job: { credentials: 'private' }, vehicles: Array.from({ length: 105 }, (_, number) => vehicle(number, { customer: 'private' })), lastCompletedAt: 1000 };
  const first = catalogPage(state);
  assert.equal(first.total, 105);
  assert.equal(first.vehicles.length, 100);
  assert.equal(first.nextOffset, 100);
  assert.equal(catalogPage(state, { offset: 100 }).vehicles.length, 5);
  assert.equal(catalogPage(state, { query: 'S104' }).vehicles[0].stock, 'S104');
  assert.equal(JSON.stringify(first).includes('private'), false);
  assert.equal(first.refreshing, true);
  assert.equal(first.vehicles[0].price, 25000);
  assert.equal(first.vehicles[0].websitePrice, 26000);
});

test('old, certified and unverified-price vehicles retain their meaning', () => {
  const state = { config: { site }, vehicles: [vehicle(1, { listed: false }), vehicle(2, { condition: 'certified' }), vehicle(3, { price: null, websitePrice: 25000 })] };
  assert.equal(catalogPage(state).total, 2);
  assert.equal(catalogPage(state, { includeOld: true, condition: 'used' }).total, 3);
  assert.equal(catalogPage(state, { query: 'S3' }).vehicles[0].price, null);
  assert.equal(catalogPage(state, { condition: 'new' }).total, 0);
});

test('response validation rejects malformed pages and unsafe listing URLs', () => {
  assert.equal(validateCatalogPage({ ok: true, version: 2, vehicles: [] }), null);
  assert.equal(validateCatalogPage({ ok: true, version: 1, site: 'javascript:alert(1)', vehicles: [] }), null);
  const page = catalogPage({ config: { site }, vehicles: [vehicle(1), vehicle(2, { url: 'https://evil.example/vehicle/2' })] });
  assert.equal(page.vehicles.length, 1);
  assert.deepEqual(validateCatalogPage(page), page);
  assert.equal(validateCatalogPage({ ...page, vehicles: Array(101).fill(vehicle(1)) }), null);
});
