import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskState, deskReducer } from '../src/lib/dealState.js';
import { getPurchaseScope } from '../src/lib/purchaseScope.js';
import {
  SAVED_WORKSHEETS_KEY, SAVED_WORKSHEETS_LOCK_KEY, MAX_WORKSHEET_COLLECTION_LENGTH,
  normalizeWorksheetName, captureWorksheetSnapshot, decodeWorksheetCollection,
  encodeWorksheetCollection, applyWorksheetCommand, prepareWorksheetRestore, createSavedWorksheetSession,
} from '../src/lib/savedWorksheets.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-11T12:00:00.000Z';
const snapshot = () => ({ desk: createDeskState('2026-10-11'), targetType: 'payment',
  targetValues: { payment: '', outTheDoor: '', amountFinanced: '', cashDue: '', cashLimit: '' }, inputDrafts: {} });
const command = (n = 1) => ({ type: 'create', id: id(n), name: 'Option A', snapshot: snapshot() });
const apply = (collection, operation, n = 100) => applyWorksheetCommand(collection, operation, { revision: id(n), now });
const collection = () => apply(null, command()).value;
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const locks = () => {
  let pending = Promise.resolve();
  const names = [];
  return { names, request: (name, callback) => {
    names.push(name);
    const next = pending.then(callback);
    pending = next.catch(() => {});
    return next;
  } };
};
const assertFailure = (result, reason, status = 'invalid') => {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.equal(result.status, status);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length);
};

test('snapshot round trip preserves committed and unfinished inputs, excludes settings and runtime state', () => {
  const value = snapshot();
  value.desk = deskReducer(value.desk, { type: 'add-item', preset: { category: 'other', name: 'Accessory', amount: 750 } });
  Object.assign(value.desk.deal, { salePrice: 30000, registrationState: 'OH', dealershipFees: { documentFee: 1 } });
  Object.assign(value.desk, { view: 'customer', mobileGridOpen: true, resetCount: 9, lastRoll: { label: 'Undo' } });
  value.desk.gridRates[72] = 8;
  value.targetValues.payment = 450;
  value.targetValues.cashLimit = 4000;
  value.inputDrafts = { 'sale-price': { raw: '30k', error: 'untrusted' }, 'budget-cash-limit': { raw: '4.' },
    'product-add-on-1-amount': { raw: '7.' }, 'product-add-on-2-amount': { raw: 'bad' } };
  value.brandSettings = { name: 'Synthetic branding' };
  const saved = apply(null, { ...command(), snapshot: value }).value;
  const encoded = encodeWorksheetCollection(saved);
  const decoded = decodeWorksheetCollection(encoded.value);
  assert.equal(decoded.kind, 'valid');
  const persisted = decoded.collection.worksheets[0].snapshot;
  for (const key of ['view', 'mobileGridOpen', 'resetCount', 'lastRoll']) assert.equal(key in persisted.desk, false);
  assert.equal('dealershipFees' in persisted.desk.deal, false);
  assert.equal('brandSettings' in persisted, false);
  assert.deepEqual(persisted.inputDrafts['sale-price'], { raw: '30k' });
  assert.equal('product-add-on-2-amount' in persisted.inputDrafts, false);
  const restored = prepareWorksheetRestore(decoded.collection, id(1)).value;
  assert.equal(restored.desk.deal.salePrice, 30000);
  assert.equal(restored.desk.deal.apr, 6.5);
  assert.equal(restored.desk.gridRates[72], 8);
  assert.equal(restored.desk.nextItemId, 2);
  assert.equal(restored.desk.deal.optionalItems[0].taxTreatmentConfirmed, false);
  assert.equal(restored.targetValues.cashLimit, 4000);
  assert.equal(restored.desk.lastRoll, null);
  assert.equal(restored.desk.view, 'dealer');
  assert.equal(restored.desk.resetCount, 0);
  assert.equal(getPurchaseScope(restored.desk.deal).supported, false);
  restored.desk.deal.salePrice = 1;
  assert.equal(decoded.collection.worksheets[0].snapshot.desk.deal.salePrice, 30000);
});

test('blank snapshots, duplicate names, replace, rename and delete form immutable commands', () => {
  const first = collection(), before = structuredClone(first);
  const second = apply(first, command(2), 101).value;
  assert.deepEqual(first, before);
  assert.equal(second.worksheets.length, 2);
  const changed = snapshot(); changed.desk.deal.salePrice = 25000;
  const replaced = apply(second, { type: 'replace', id: id(1), snapshot: changed }, 102).value;
  assert.equal(replaced.worksheets[0].name, 'Option A');
  assert.equal(replaced.worksheets[0].createdAt, now);
  assert.equal(replaced.worksheets[0].snapshot.desk.deal.salePrice, 25000);
  assert.equal(replaced.worksheets[1].snapshot.desk.deal.salePrice, null);
  const renamed = apply(replaced, { type: 'rename', id: id(2), name: '  Option\nB\u200b ' }, 103).value;
  assert.equal(renamed.worksheets[1].name, 'Option B');
  const deleted = apply(renamed, { type: 'delete', id: id(1) }, 104).value;
  assert.deepEqual(deleted.worksheets.map(entry => entry.id), [id(2)]);
  assert.equal(second.worksheets[0].snapshot.desk.deal.salePrice, null);
});

test('name validation counts Unicode characters and removes control/format characters', () => {
  assert.equal(normalizeWorksheetName('🚙'.repeat(80)).ok, true);
  for (const name of ['', ' \n\u200b ', null, 123, 'a'.repeat(81), '🚙'.repeat(81)]) {
    assertFailure(normalizeWorksheetName(name), 'invalid-name');
  }
});

test('snapshot validation retains draft protections and refuses future versions', () => {
  for (const mutate of [
    value => { value.desk.deal.salePrice = -1; },
    value => { value.desk.deal.apr = 6.555; },
    value => { value.desk.deal.dealDate = '2026-02-30'; },
    value => { value.desk.gridDownPayments = [0]; },
    value => { value.targetValues.cashLimit = '4000'; },
    value => { value.targetType = 'cashDue'; },
    value => { value.inputDrafts = []; },
    value => { value.inputDrafts['unknown-field'] = { raw: '1' }; },
    value => { value.inputDrafts.apr = { raw: 'x'.repeat(1001) }; },
    value => { value.desk = deskReducer(value.desk, { type: 'add-item' }); value.desk.nextItemId = 1; },
    value => { value.desk = deskReducer(value.desk, { type: 'add-item' }); value.desk.deal.optionalItems.push({ ...value.desk.deal.optionalItems[0] }); },
  ]) {
    const value = snapshot(); mutate(value);
    assertFailure(captureWorksheetSnapshot(value), 'invalid-snapshot');
  }
  assertFailure(captureWorksheetSnapshot({ ...snapshot(), version: 99 }), 'unsupported-snapshot-version');
  for (const version of [1, 2]) {
    const legacy = { ...snapshot(), version };
    delete legacy.targetValues.cashLimit;
    if (version === 1) { delete legacy.desk.deal.registrationState; delete legacy.desk.deal.transactionScope; }
    const result = captureWorksheetSnapshot(legacy);
    assert.equal(result.value.version, 3);
    assert.equal(result.value.targetValues.cashLimit, '');
    assert.equal(result.value.desk.deal.registrationState, 'MI');
  }
});

test('commands validate IDs, metadata, missing entries and revision reuse without mutation', () => {
  const value = collection(), before = structuredClone(value);
  for (const [operation, reason] of [
    [command(), 'duplicate-id'], [{ type: 'delete', id: id(2) }, 'not-found'],
    [{ type: 'rename', id: id(1), name: '' }, 'invalid-name'],
    [{ type: 'delete', id: 'invalid' }, 'invalid-id'], [{ type: 'other', id: id(1) }, 'invalid-command'],
  ]) assertFailure(apply(value, operation, 101), reason);
  assertFailure(applyWorksheetCommand(value, command(2), { revision: id(100), now }), 'unchanged-revision');
  assertFailure(applyWorksheetCommand(value, command(2), { revision: id(101), now: 'bad' }), 'invalid-metadata');
  assert.deepEqual(value, before);
  assertFailure(prepareWorksheetRestore(value, id(9)), 'not-found');
});

test('clock rollback does not reverse entry timestamps', () => {
  const value = collection();
  const next = applyWorksheetCommand(value, { type: 'rename', id: id(1), name: 'B' },
    { revision: id(101), now: '2026-10-10T12:00:00.000Z' });
  assert.equal(next.value.worksheets[0].updatedAt, now);
});

test('50 entry boundary accepts the last slot and refuses additional creates', () => {
  let value = null;
  for (let n = 1; n <= 50; n++) value = apply(value, command(n), 100 + n).value;
  assert.equal(value.worksheets.length, 50);
  assertFailure(apply(value, command(51), 151), 'too-many-worksheets');
  const excess = structuredClone(value); excess.worksheets.push({ ...excess.worksheets[0], id: id(51) });
  assert.equal(decodeWorksheetCollection(JSON.stringify(excess)).reason, 'too-many-worksheets');
});

test('malformed envelopes, duplicate IDs and nested future versions reject the complete collection', () => {
  assert.equal(decodeWorksheetCollection(null).kind, 'absent');
  assert.equal(decodeWorksheetCollection('{').reason, 'malformed-json');
  for (const [mutate, reason] of [
    [value => { value.version = 2; }, 'unsupported-version'],
    [value => { value.revision = ''; }, 'invalid-fields'],
    [value => { value.extra = true; }, 'invalid-fields'],
    [value => { value.worksheets.push(value.worksheets[0]); }, 'invalid-fields'],
    [value => { value.worksheets[0].updatedAt = '2026-10-10T12:00:00.000Z'; }, 'invalid-fields'],
    [value => { value.worksheets[0].createdAt = '2026-02-30T12:00:00.000Z'; }, 'invalid-fields'],
    [value => { delete value.worksheets[0].snapshot.version; }, 'invalid-fields'],
    [value => { value.worksheets[0].snapshot.version = 99; }, 'unsupported-snapshot-version'],
  ]) {
    const value = collection(); mutate(value);
    const result = decodeWorksheetCollection(JSON.stringify(value));
    assert.equal(result.kind, 'rejected');
    assertFailure(result, reason, 'rejected');
    assert.equal(result.collection, null);
  }
});

test('collection size is bounded on reads and writes without evicting entries', () => {
  assert.equal(decodeWorksheetCollection(' '.repeat(MAX_WORKSHEET_COLLECTION_LENGTH + 1)).reason, 'collection-too-large');
  const value = snapshot();
  for (let n = 0; n < 10; n++) value.desk = deskReducer(value.desk, { type: 'add-item' });
  const fields = ['sale-price', 'cash-down', 'trade-allowance', 'trade-payoff', 'apr', 'new-plate-amount',
    'target-value', 'budget-cash-limit', 'estimate-date', ...[0, 1, 2, 3].map(n => `grid-down-${n}`),
    ...[36, 48, 60, 72, 84].map(n => `grid-apr-${n}`), ...value.desk.deal.optionalItems.map(item => `product-${item.id}-amount`)];
  value.inputDrafts = Object.fromEntries(fields.map(field => [field, { raw: 'x'.repeat(1000) }]));
  let saved = null, failureResult;
  for (let n = 1; n <= 50; n++) {
    const result = apply(saved, { ...command(n), snapshot: value }, 100 + n);
    if (!result.ok) { failureResult = result; break; }
    saved = result.value;
  }
  assertFailure(failureResult, 'collection-too-large');
  const encoded = encodeWorksheetCollection(saved);
  assert.ok(encoded.value.length <= MAX_WORKSHEET_COLLECTION_LENGTH);
  const tooLarge = structuredClone(saved); tooLarge.worksheets.push({ ...tooLarge.worksheets[0], id: id(99) });
  assertFailure(encodeWorksheetCollection(tooLarge), 'collection-too-large');
});

test('session uses its own lock/key and returns independent read and restore values', async () => {
  const device = storage(), coordinator = locks();
  for (const key of ['payment-desk.draft.v1', 'payment-desk.draft.v2', 'payment-desk.fees.v1', 'payment-desk.dealership.v1']) device.setItem(key, 'synthetic sentinel');
  const session = createSavedWorksheetSession(device, coordinator);
  assert.deepEqual(session.read().value, { collection: null, worksheets: [] });
  const operation = command(); delete operation.id;
  const result = await session.execute(operation);
  assert.equal(result.ok, true);
  const savedId = result.value.worksheets[0].id;
  assert.deepEqual(coordinator.names, [SAVED_WORKSHEETS_LOCK_KEY]);
  const read = session.read().value;
  assert.equal('snapshot' in read.worksheets[0], false);
  read.collection.worksheets[0].name = 'Mutated copy';
  result.value.worksheets[0].name = 'Mutated result';
  assert.equal(session.read().value.worksheets[0].name, 'Option A');
  assert.equal(session.prepareRestore(savedId).value.desk.view, 'dealer');
  assert.equal((await session.execute({ type: 'delete', id: savedId })).ok, true);
  const empty = JSON.parse(device.getItem(SAVED_WORKSHEETS_KEY));
  assert.deepEqual(empty.worksheets, []);
  assert.ok(empty.revision);
  for (const [key, raw] of device.values) if (key !== SAVED_WORKSHEETS_KEY) assert.equal(raw, 'synthetic sentinel');
});

test('concurrent sessions refuse stale mutations and restore until explicit reload', async () => {
  const device = storage(), coordinator = locks();
  const a = createSavedWorksheetSession(device, coordinator), b = createSavedWorksheetSession(device, coordinator);
  const results = await Promise.all([a.execute(command()), b.execute(command(2))]);
  assert.equal(results[0].ok, true);
  assertFailure(results[1], 'changed-record', 'conflict');
  assertFailure(b.read(), 'changed-record', 'conflict');
  assertFailure(b.prepareRestore(id(1)), 'changed-record', 'conflict');
  assertFailure(await b.execute({ type: 'delete', id: id(1) }), 'changed-record', 'conflict');
  assert.equal(b.reload().value.worksheets.length, 1);
  assert.equal((await b.execute(command(2))).ok, true);
  assertFailure(a.read(), 'changed-record', 'conflict');
  assert.equal(a.reload().value.worksheets.length, 2);
});

test('revisioned final deletion prevents absent and existing-record ABA', async () => {
  const device = storage(), coordinator = locks();
  const absent = createSavedWorksheetSession(device, coordinator), active = createSavedWorksheetSession(device, coordinator);
  await active.execute(command());
  await active.execute({ type: 'delete', id: id(1) });
  assertFailure(await absent.execute(command(2)), 'changed-record', 'conflict');
  const stale = createSavedWorksheetSession(device, coordinator);
  await active.execute(command());
  await active.execute({ type: 'delete', id: id(1) });
  assertFailure(await stale.execute(command(2)), 'changed-record', 'conflict');
});

test('all rejected records remain byte-for-byte intact across every mutation and reload', async () => {
  const future = collection(); future.worksheets[0].snapshot.version = 99;
  for (const raw of ['{', JSON.stringify({ version: 2 }), JSON.stringify(future), 'x'.repeat(MAX_WORKSHEET_COLLECTION_LENGTH + 1)]) {
    const device = storage(); device.setItem(SAVED_WORKSHEETS_KEY, raw);
    const session = createSavedWorksheetSession(device, locks());
    assert.equal(session.read().status, 'rejected');
    for (const operation of [command(), { type: 'rename', id: id(1), name: 'B' },
      { type: 'replace', id: id(1), snapshot: snapshot() }, { type: 'delete', id: id(1) }]) {
      assert.equal((await session.execute(operation)).status, 'rejected');
      assert.equal(device.getItem(SAVED_WORKSHEETS_KEY), raw);
    }
    assert.equal(session.reload().status, 'rejected');
    assert.equal(session.prepareRestore(id(1)).status, 'rejected');
  }
});

test('unavailable locks and quota/write failures preserve bytes and allow safe retry', async () => {
  const device = storage(), coordinator = locks();
  device.setItem(SAVED_WORKSHEETS_KEY, encodeWorksheetCollection(collection()).value);
  const previous = device.getItem(SAVED_WORKSHEETS_KEY);
  assertFailure(await createSavedWorksheetSession(device, null).execute(command(2)), 'locks-unavailable', 'error');
  assertFailure(await createSavedWorksheetSession(device, { request: () => Promise.reject(new Error('denied')) }).execute(command(2)), 'lock-or-metadata-unavailable', 'error');
  const session = createSavedWorksheetSession(device, coordinator), setItem = device.setItem;
  for (const name of ['QuotaExceededError', 'SecurityError']) {
    device.setItem = () => { const error = new Error('Synthetic failure'); error.name = name; throw error; };
    assertFailure(await session.execute(command(2)), name === 'QuotaExceededError' ? 'storage-full' : 'storage-write-failed', 'error');
    assert.equal(device.getItem(SAVED_WORKSHEETS_KEY), previous);
  }
  device.setItem = setItem;
  assert.equal((await session.execute(command(2))).ok, true);
});

test('denied reads latch until reload and prevent mutations even when storage recovers', async () => {
  const device = storage(), getItem = device.getItem;
  device.getItem = () => { throw new Error('Denied'); };
  const session = createSavedWorksheetSession(device, locks());
  assertFailure(session.read(), 'storage-unavailable', 'error');
  device.getItem = getItem;
  assertFailure(await session.execute(command()), 'storage-unavailable', 'error');
  assert.equal(device.getItem(SAVED_WORKSHEETS_KEY), null);
  assert.equal(session.reload().ok, true);
  assert.equal((await session.execute(command())).ok, true);
  device.getItem = () => { throw new Error('Denied again'); };
  assertFailure(session.prepareRestore(id(1)), 'storage-unavailable', 'error');
  device.getItem = getItem;
  assertFailure(session.read(), 'storage-unavailable', 'error');
  assert.equal(session.reload().ok, true);
  assertFailure(createSavedWorksheetSession(null, locks()).read(), 'storage-unavailable', 'error');
});

test('queued commands capture caller inputs before acquiring the lock', async () => {
  const device = storage();
  let release;
  const coordinator = { request: (_name, callback) => new Promise(resolve => { release = () => resolve(callback()); }) };
  const session = createSavedWorksheetSession(device, coordinator), operation = command();
  const pending = session.execute(operation);
  operation.name = 'Changed'; operation.snapshot.desk.deal.salePrice = 999;
  release();
  assert.equal((await pending).ok, true);
  const result = session.prepareRestore(id(1));
  assert.equal(result.value.desk.deal.salePrice, null);
  assert.equal(session.read().value.worksheets[0].name, 'Option A');
});

test('adapter replace and rename retain metadata; invalid commands never write', async () => {
  const device = storage(), session = createSavedWorksheetSession(device, locks());
  await session.execute(command());
  const createdAt = session.read().value.worksheets[0].createdAt;
  const cash = snapshot(); cash.desk.deal.dealType = 'cash'; cash.targetType = 'cashDue';
  cash.targetValues.cashDue = 20000; cash.desk.dateChosen = true;
  assert.equal((await session.execute({ type: 'replace', id: id(1), snapshot: cash })).ok, true);
  assert.equal((await session.execute({ type: 'rename', id: id(1), name: 'Cash option' })).ok, true);
  const restored = session.prepareRestore(id(1)).value;
  assert.equal(restored.targetType, 'cashDue');
  assert.equal(restored.targetValues.cashDue, 20000);
  assert.equal(restored.desk.dateChosen, true);
  assert.equal(session.read().value.worksheets[0].createdAt, createdAt);
  const before = device.getItem(SAVED_WORKSHEETS_KEY);
  for (const operation of [null, {}, { type: 'delete', id: id(9) },
    { type: 'rename', id: id(1), name: ' ' }, { type: 'replace', id: id(1), snapshot: { ...cash, version: 99 } }]) {
    assert.equal((await session.execute(operation)).ok, false);
    assert.equal(device.getItem(SAVED_WORKSHEETS_KEY), before);
  }
});

test('external removal or future-version change conflicts first, reload explicitly classifies latest bytes', async () => {
  const device = storage(), session = createSavedWorksheetSession(device, locks());
  await session.execute(command());
  device.values.delete(SAVED_WORKSHEETS_KEY);
  assertFailure(session.read(), 'changed-record', 'conflict');
  assert.equal(session.reload().value.collection, null);
  const future = JSON.stringify({ version: 99 });
  device.setItem(SAVED_WORKSHEETS_KEY, future);
  assertFailure(await session.execute(command()), 'changed-record', 'conflict');
  assertFailure(session.reload(), 'unsupported-version', 'rejected');
  assertFailure(await session.execute(command()), 'unsupported-version', 'rejected');
  assert.equal(device.getItem(SAVED_WORKSHEETS_KEY), future);
});
