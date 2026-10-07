import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDOFF_PREFIX, parseAdvertisedPrice, parseVehicleHandoff, validateVehicle, vehicleHandoffUrl, PAYMENT_DESK_URL } from '../extensions/payment-desk-companion/vehicleHandoff.js';

const vehicle = { version: 1, salePrice: 29995.12, vehicleDescription: '2024 Explorer · Stock H12345' };
test('handoff round-trips a price and reference in the fragment on the fixed production origin', () => {
  const url = new URL(vehicleHandoffUrl(vehicle));
  assert.equal(url.origin + '/', PAYMENT_DESK_URL);
  assert.equal(url.search, '');
  assert.deepEqual(parseVehicleHandoff(url.hash), { vehicle: { salePrice: vehicle.salePrice, vehicleDescription: vehicle.vehicleDescription }, error: null });
});
test('handoff allowlist discards unrelated deal fields and untrusted destinations', () => {
  assert.deepEqual(validateVehicle({ ...vehicle, apr: 0, tradeAllowance: 100000, url: 'https://evil.invalid', optionalItems: [{ amount: 1 }] }), { salePrice: vehicle.salePrice, vehicleDescription: vehicle.vehicleDescription });
});
test('partial vehicle details are permitted, but empty imports are rejected', () => {
  assert.ok(validateVehicle({ ...vehicle, salePrice: null }));
  assert.ok(validateVehicle({ ...vehicle, vehicleDescription: '' }));
  assert.equal(validateVehicle({ version: 1, salePrice: null, vehicleDescription: '  ' }), null);
});
test('prices are positive USD amounts within worksheet bounds and at most two decimals', () => {
  for (const price of [-1, 0, Infinity, NaN, 1_000_000.01, 0.001, '29995', undefined]) assert.equal(validateVehicle({ ...vehicle, salePrice: price }), null);
  for (const text of ['1e4', '$399/month', '-100', '1,00', '1.234', '€10', '0', '$1,000,001']) assert.equal(parseAdvertisedPrice(text), null);
  for (const text of ['$29,995.12', 'USD 29995.12', '29995.12 USD']) assert.equal(parseAdvertisedPrice(text), 29995.12);
  assert.equal(parseAdvertisedPrice('1,000,000'), 1_000_000);
});
test('invalid, oversized and unsupported imports fail without exceptions', () => {
  for (const hash of [HANDOFF_PREFIX + '%GG', HANDOFF_PREFIX + 'null', HANDOFF_PREFIX + 'x'.repeat(4096), HANDOFF_PREFIX + encodeURIComponent(JSON.stringify({ ...vehicle, version: 2 }))]) {
    assert.equal(parseVehicleHandoff(hash).vehicle, null);
    assert.ok(parseVehicleHandoff(hash).error);
  }
  assert.deepEqual(parseVehicleHandoff('#payment-grid'), { vehicle: null, error: null });
});
test('reference length and control characters are rejected; markup remains plain text', () => {
  for (const reference of ['x'.repeat(101), 'dealer\nStock X', 'Stock\u202eX']) assert.equal(validateVehicle({ ...vehicle, vehicleDescription: reference }), null);
  assert.equal(validateVehicle({ ...vehicle, vehicleDescription: '<script>alert(1)</script>' }).vehicleDescription, '<script>alert(1)</script>');
});
