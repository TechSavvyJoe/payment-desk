import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberCompanion, readCompanionInventory } from '../src/lib/companionInventory.js';
import { catalogPage } from '../extensions/payment-desk-companion/inventoryWeb.js';

const KEY = 'payment-desk.companion.v1';
const candidate = 'a'.repeat(32);
const previous = 'b'.repeat(32);
const page = await catalogPage({});

test('a changed catalog produces an actionable recovery error without accepting a new connection', async t => {
  const storage = browser(t, null, (_runtime, _id, _message, callback) => callback({ ok: false, code: 'catalog_changed' }));
  await assert.rejects(readCompanionInventory({ offset: 100, revision: 'a'.repeat(64) }), /Inventory changed.*Reload catalog/);
  assert.equal(storage.has(KEY), false);
});

function browser(t, savedId, send) {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const storage = new Map(savedId ? [[KEY, savedId]] : []);
  const runtime = { sendMessage: (...args) => send(runtime, ...args) };
  globalThis.chrome = { runtime };
  globalThis.window = {
    location: { hash: `#pd-companion=${candidate}`, pathname: '/', search: '' },
    history: { replaceState() { window.location.hash = ''; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  };
  t.after(() => {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else delete globalThis.window;
    if (savedChrome) Object.defineProperty(globalThis, 'chrome', savedChrome); else delete globalThis.chrome;
  });
  rememberCompanion();
  assert.equal(window.location.hash, '');
  return storage;
}

test('a candidate connection is saved only after a valid catalog handshake', async t => {
  let respond;
  const storage = browser(t, previous, (_runtime, id, _message, callback) => { assert.equal(id, candidate); respond = callback; });
  assert.equal(storage.get(KEY), previous);
  const result = readCompanionInventory({});
  assert.equal(storage.get(KEY), previous);
  respond(page);
  assert.deepEqual(await result, page);
  assert.equal(storage.get(KEY), candidate);
  assert.deepEqual([...storage.keys()], [KEY]);
});

test('an unavailable connection link falls back to the saved companion', async t => {
  const ids = [];
  const storage = browser(t, previous, (runtime, id, _message, callback) => {
    ids.push(id);
    if (id === candidate) { runtime.lastError = { message: 'not installed' }; callback(); delete runtime.lastError; }
    else callback(page);
  });
  assert.deepEqual(await readCompanionInventory({}), page);
  assert.equal(storage.get(KEY), previous);
  assert.deepEqual(ids, [candidate, previous]);
  assert.deepEqual(await readCompanionInventory({}), page);
  assert.deepEqual(ids, [candidate, previous, previous]);
});

test('a malformed handshake cannot replace a working companion', async t => {
  const storage = browser(t, previous, (_runtime, id, _message, callback) => callback(id === candidate ? { ok: true, version: 99, vehicles: [] } : page));
  assert.deepEqual(await readCompanionInventory({}), page);
  assert.equal(storage.get(KEY), previous);
});

test('a catalog response after sixteen seconds still succeeds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = browser(t, null, (_runtime, _id, _message, callback) => setTimeout(() => callback(page), 16_001));
  const result = readCompanionInventory({});
  const check = assert.doesNotReject(result);
  t.mock.timers.tick(16_001);
  await check;
  assert.deepEqual(await result, page);
  assert.equal(storage.get(KEY), candidate);
});

test('the bounded timeout ignores a late handshake instead of saving its identifier', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let respond;
  const storage = browser(t, null, (_runtime, _id, _message, callback) => { respond = callback; });
  const check = assert.rejects(readCompanionInventory({}), /did not respond/);
  t.mock.timers.tick(45_000);
  await check;
  respond(page);
  await Promise.resolve();
  assert.equal(storage.has(KEY), false);
});

test('a failed concurrent read cannot discard a candidate verified by another read', async t => {
  const callbacks = [];
  const storage = browser(t, null, (_runtime, _id, _message, callback) => callbacks.push(callback));
  const failed = assert.rejects(readCompanionInventory({ search: 'first' }), /could not provide inventory/);
  const successful = readCompanionInventory({ search: 'second' });
  callbacks[0]({ ok: false });
  await failed;
  callbacks[1](page);
  assert.deepEqual(await successful, page);
  assert.equal(storage.get(KEY), candidate);
  const following = readCompanionInventory({});
  callbacks[2](page);
  assert.deepEqual(await following, page);
});

for (const savedId of [null, previous]) {
  test(`a later failed read retries the concurrently confirmed companion with ${savedId ? 'an older connection' : 'no prior connection'}`, async t => {
    const calls = [];
    const storage = browser(t, savedId, (_runtime, id, message, callback) => calls.push({ id, message, callback }));
    const first = readCompanionInventory({ search: 'first' });
    const second = readCompanionInventory({ search: 'second' });
    calls[0].callback(page);
    assert.deepEqual(await first, page);
    calls[1].callback({ ok: false });
    await Promise.resolve();
    assert.equal(calls.length, 3);
    assert.equal(calls[2].id, candidate);
    assert.equal(calls[2].message.search, 'second');
    calls[2].callback(page);
    assert.deepEqual(await second, page);
    assert.equal(storage.get(KEY), candidate);
  });
}

test('a superseded candidate cannot replace the companion verified by a newer link', async t => {
  const callbacks = [];
  const storage = browser(t, previous, (_runtime, id, _message, callback) => callbacks.push({ id, callback }));
  const oldRead = readCompanionInventory({});
  const replacement = 'c'.repeat(32);
  window.location.hash = `#pd-companion=${replacement}`;
  rememberCompanion();
  const newRead = readCompanionInventory({});
  callbacks[1].callback(page);
  await newRead;
  callbacks[0].callback(page);
  await oldRead;
  assert.equal(storage.get(KEY), replacement);
});
