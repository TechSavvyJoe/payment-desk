import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { REGISTRATION_STATES, TRANSACTION_SCOPES } from '../src/lib/purchaseScope.js';
import { createDeskState, deskReducer } from '../src/lib/dealState.js';
import { createDeskDraftSession, DESK_DRAFT_KEY, DESK_DRAFT_LOCK_KEY, LEGACY_DESK_DRAFT_KEY, readDeskDraftRecord, hasDeskDraftEdits, isBaselineDeskInput, loadDeskDraft, normalizeDeskDraft, saveDeskDraft } from '../src/lib/deskDraft.js';

const empty = () => ({ version: 2, desk: createDeskState('2026-10-07'), targetType: 'payment', targetValues: { payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' }, inputDrafts: {} });
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const locks = () => {
  let pending = Promise.resolve();
  return { request: (_name, callback) => { pending = pending.then(callback); return pending; } };
};

test('draft-only targets, dates and unfinished inputs count as meaningful edits', () => {
  assert.equal(hasDeskDraftEdits(empty()), false);
  for (const target of ['payment', 'outTheDoor', 'amountFinanced', 'cashDue']) {
    const value = empty(); value.targetValues[target] = 0;
    assert.equal(hasDeskDraftEdits(value), true);
  }
  const dated = empty(); dated.desk.dateChosen = true;
  assert.equal(hasDeskDraftEdits(dated), true);
  const unfinished = empty(); unfinished.inputDrafts['target-value'] = { raw: '5.' };
  assert.equal(hasDeskDraftEdits(unfinished), true);
});

test('returning financial fields to their baseline removes live and restored raw edits', () => {
  const value = empty();
  const baseline = {
    'sale-price': '', 'target-value': ' ', 'cash-down': '0', 'trade-allowance': '', 'trade-payoff': '$0.00', apr: '6.50%',
    'grid-down-0': '0', 'grid-down-1': '1,000', 'grid-down-2': '2000', 'grid-down-3': '3000',
    'grid-apr-36': '6', 'grid-apr-48': '6.00', 'grid-apr-60': '6', 'grid-apr-72': '6.5', 'grid-apr-84': '7',
  };
  for (const [id, raw] of Object.entries(baseline)) {
    assert.equal(isBaselineDeskInput(id, raw, value.desk.startDate), true, id);
    value.inputDrafts[id] = { raw };
  }
  assert.equal(hasDeskDraftEdits(value), false);
  assert.deepEqual(normalizeDeskDraft(value).inputDrafts, {});
  const device = storage();
  device.setItem(DESK_DRAFT_KEY, JSON.stringify(value));
  assert.deepEqual(loadDeskDraft(device).inputDrafts, {});
  assert.equal(saveDeskDraft(value, device).ok, true);
  assert.equal(readDeskDraftRecord(device).kind, 'absent');
});

test('baseline pruning preserves explicit optional zeros, invalid entries and unfinished decimals', () => {
  for (const [id, raw] of [
    ['sale-price', '0'], ['target-value', '0'], ['new-plate-amount', '0'],
    ['new-plate-amount', ''], ['apr', ''], ['grid-apr-60', ''], ['cash-down', 'bad'],
    ['cash-down', '0.'], ['apr', '6.50.'], ['target-value', '5.'], ['grid-down-1', '0'], ['grid-apr-84', '6.5'],
  ]) {
    const value = empty(); value.inputDrafts[id] = { raw };
    assert.equal(isBaselineDeskInput(id, raw, value.desk.startDate), false, `${id}: ${raw}`);
    assert.equal(hasDeskDraftEdits(value), true, `${id}: ${raw}`);
    assert.deepEqual(normalizeDeskDraft(value).inputDrafts, value.inputDrafts);
  }
});

test('draft sessions serialize simultaneous writes and refuse stale saves and resets', async () => {
  const device = storage(), coordinator = locks();
  const a = createDeskDraftSession(device, coordinator), b = createDeskDraftSession(device, coordinator);
  const first = empty(), second = empty();
  first.desk.deal.salePrice = 30000; second.desk.deal.salePrice = 20000;
  const outcomes = await Promise.all([a.save(first), b.save(second)]);
  assert.deepEqual(outcomes, [{ ok: true }, { ok: false, conflict: true }]);
  assert.equal(loadDeskDraft(device).desk.deal.salePrice, 30000);
  assert.deepEqual(await b.save(empty()), { ok: false, conflict: true });
  assert.equal(loadDeskDraft(device).desk.deal.salePrice, 30000);
  assert.deepEqual(await a.save(empty()), { ok: true });
  assert.equal(readDeskDraftRecord(device).kind, 'absent');
  assert.deepEqual(await b.save(second), { ok: false, conflict: true });
});

test('draft sessions retain the previous draft when locking or storage is unavailable', async () => {
  const device = storage(), value = empty(); value.desk.deal.salePrice = 30000;
  saveDeskDraft(value, device);
  const previous = device.getItem(DESK_DRAFT_KEY);
  assert.deepEqual(await createDeskDraftSession(device, null).save(empty()), { ok: false });
  assert.equal(device.getItem(DESK_DRAFT_KEY), previous);
  device.setItem = () => { throw new Error('blocked'); };
  assert.deepEqual(await createDeskDraftSession(device, locks()).save(empty()), { ok: false });
  assert.equal(device.getItem(DESK_DRAFT_KEY), previous);
});

test('a draft round trip restores figures, products, grid and targets without serializing settings or undo', () => {
  const value = empty();
  value.desk = deskReducer(value.desk, { type: 'field', field: 'salePrice', value: 30000 });
  value.desk = deskReducer(value.desk, { type: 'add-item', preset: { name: 'Service Contract', amount: 750 } });
  value.desk = deskReducer(value.desk, { type: 'apply', patch: { cashDown: 2500 }, label: 'Add cash down' });
  value.desk = deskReducer(value.desk, { type: 'rate', term: 60, value: 5.5 });
  value.desk = deskReducer(value.desk, { type: 'down', index: 3, value: 3500 });
  value.desk.deal.dealershipFees = { documentFee: 200 };
  value.targetValues.payment = 450;
  value.inputDrafts['sale-price'] = { raw: '30k', error: 'untrusted error text' };
  const device = storage();
  assert.equal(saveDeskDraft(value, device).ok, true);
  const restored = loadDeskDraft(device);
  assert.equal(restored.desk.deal.salePrice, 30000);
  assert.equal(restored.desk.deal.cashDown, 2500);
  assert.equal(restored.desk.gridRates[60], 5.5);
  assert.equal(restored.desk.gridDownPayments[3], 3500);
  assert.equal(restored.targetValues.payment, 450);
  assert.deepEqual(restored.inputDrafts['sale-price'], { raw: '30k' });
  assert.equal(restored.desk.deal.optionalItems[0].amount, 750);
  assert.equal(restored.desk.nextItemId, 2);
  assert.equal(restored.desk.view, 'dealer');
  assert.equal(restored.desk.lastRoll, null);
  assert.equal('dealershipFees' in restored.desk.deal, false);
});

test('reset removes the draft while leaving other device settings intact', () => {
  const device = storage();
  device.setItem('payment-desk.dealership.v1', 'saved dealership');
  const edited = empty(); edited.desk.deal.tradeAllowance = 10000;
  assert.equal(saveDeskDraft(edited, device).ok, true);
  assert.notEqual(device.getItem(DESK_DRAFT_KEY), null);
  assert.equal(saveDeskDraft(empty(), device).ok, true);
  assert.equal(readDeskDraftRecord(device).kind, 'absent');
  assert.equal(device.getItem('payment-desk.dealership.v1'), 'saved dealership');
});

test('corrupt, unsupported, oversized and out-of-range drafts are ignored', () => {
  const device = storage();
  for (const raw of ['{', JSON.stringify({ ...empty(), version: 4 }), ' '.repeat(200001)]) {
    device.setItem(DESK_DRAFT_KEY, raw); assert.equal(loadDeskDraft(device), null);
  }
  for (const mutate of [
    v => { v.desk.deal.salePrice = -1; }, v => { v.desk.deal.apr = 51; },
    v => { v.desk.deal.dealDate = '2026-02-30'; }, v => { v.desk.deal.termMonths = 999; },
    v => { v.desk.gridDownPayments = [0]; }, v => { v.desk.gridRates[60] = '5.5'; },
    v => { v.inputDrafts['sale-price'] = { raw: 'x'.repeat(1001) }; },
    v => { v.inputDrafts.__unexpected = { raw: 'not an input' }; },
  ]) { const value = empty(); mutate(value); assert.equal(normalizeDeskDraft(value), null); }
});

test('saved APRs require cent precision in both the deal and every grid term', () => {
  const value = empty();
  value.desk.deal.apr = 6.55;
  for (const term of Object.keys(value.desk.gridRates)) value.desk.gridRates[term] = 6.55;
  assert.notEqual(normalizeDeskDraft(value), null);
  for (const mutate of [
    draft => { draft.desk.deal.apr = 6.555; },
    ...Object.keys(value.desk.gridRates).map(term => draft => { draft.desk.gridRates[term] = 6.555; }),
  ]) {
    const malformed = structuredClone(value);
    mutate(malformed);
    assert.equal(normalizeDeskDraft(malformed), null);
  }
});

test('restored deal APR must match the selected term in the grid', () => {
  for (const term of [36, 48, 60, 72, 84]) {
    const value = empty();
    value.desk.deal.termMonths = term;
    value.desk.deal.apr = value.desk.gridRates[term];
    assert.notEqual(normalizeDeskDraft(value), null);
    value.desk.gridRates[term] += .25;
    assert.equal(normalizeDeskDraft(value), null);
    const device = storage(); device.setItem(DESK_DRAFT_KEY, JSON.stringify(value));
    assert.equal(loadDeskDraft(device), null);
  }
});

test('restored date drafts retain invalid entry but discard a valid date that disagrees with the deal', () => {
  const value = empty();
  value.inputDrafts['estimate-date'] = { raw: '10/08/26' };
  assert.deepEqual(normalizeDeskDraft(value).inputDrafts, {});
  value.inputDrafts['estimate-date'] = { raw: '10/07/26' };
  assert.deepEqual(normalizeDeskDraft(value).inputDrafts, value.inputDrafts);
  value.inputDrafts['estimate-date'] = { raw: '10/99/26' };
  assert.deepEqual(normalizeDeskDraft(value).inputDrafts, value.inputDrafts);
});

test('storage failures never throw or overwrite the previous saved draft', () => {
  const value = empty(); value.desk.deal.salePrice = 30000;
  const device = storage(); saveDeskDraft(value, device);
  const before = device.getItem(DESK_DRAFT_KEY);
  device.setItem = () => { throw new Error('quota'); };
  value.desk.deal.cashDown = 2000;
  assert.equal(saveDeskDraft(value, device).ok, false);
  assert.equal(device.getItem(DESK_DRAFT_KEY), before);
  assert.equal(saveDeskDraft(value, null).ok, false);
  assert.equal(loadDeskDraft({ getItem() { throw new Error('blocked'); } }), null);
});

test('removed product drafts are discarded and restored product IDs are never reused', () => {
  const value = empty();
  value.desk = deskReducer(value.desk, { type: 'add-item' });
  value.desk = deskReducer(value.desk, { type: 'add-item' });
  value.desk = deskReducer(value.desk, { type: 'remove-item', index: 1 });
  value.inputDrafts['product-add-on-2-amount'] = { raw: 'invalid old product amount' };
  const restored = normalizeDeskDraft(value);
  assert.deepEqual(restored.inputDrafts, {});
  assert.equal(deskReducer(restored.desk, { type: 'add-item' }).deal.optionalItems[1].id, 'add-on-3');
});

for (const [reason, raw] of [
  ['malformed-json', '{'], ['malformed-json', ''],
  ['unsupported-version', JSON.stringify({ ...empty(), version: 4 })],
  ['oversized', ' '.repeat(200001)],
  ['invalid-fields', JSON.stringify({ ...empty(), inputDrafts: { 'sale-price': { raw: 10 } } })],
  ['invalid-fields', JSON.stringify({ ...empty(), discarded: true, revision: 'synthetic' })],
]) {
  test(`rejected ${reason} bytes survive blank and edited autosave until explicit discard`, async () => {
    const device = storage(); device.setItem(DESK_DRAFT_KEY, raw);
    const session = createDeskDraftSession(device, locks());
    assert.equal(session.record.kind, 'rejected');
    assert.equal(session.record.reason, reason);
    assert.equal(session.status(), 'rejected');
    for (const value of [empty(), { ...empty(), targetValues: { ...empty().targetValues, payment: 400 } }]) {
      assert.equal((await session.save(value)).rejected, true);
      assert.equal(saveDeskDraft(value, device).rejected, true);
      assert.equal(device.getItem(DESK_DRAFT_KEY), raw);
    }
    assert.deepEqual(await session.discard(), { ok: true });
    assert.equal(session.status(), 'saved');
    assert.equal(session.record.kind, 'absent');
    assert.equal(readDeskDraftRecord(device).kind, 'absent');
  });
}

test('absent, valid and unreadable records are distinct and denied reads latch until reload', async () => {
  const device = storage();
  assert.equal(readDeskDraftRecord(device).kind, 'absent');
  assert.equal(readDeskDraftRecord(null).kind, 'unreadable');
  let denied = true, writes = 0;
  const blocked = { getItem() { if (denied) throw new Error('denied'); return null; }, setItem() { writes++; } };
  const session = createDeskDraftSession(blocked, locks());
  assert.equal(session.record.kind, 'unreadable');
  denied = false;
  assert.equal(session.status(), 'error');
  assert.equal((await session.save(empty())).ok, false);
  assert.equal((await session.discard()).ok, false);
  assert.equal(writes, 0);
  const value = empty(); value.desk.deal.salePrice = 20000;
  saveDeskDraft(value, device);
  assert.equal(readDeskDraftRecord(device).kind, 'valid');
});

test('v2 precedence, rejected legacy preservation and migration do not fall back to stale v1', async () => {
  const device = storage();
  const legacy = empty(); legacy.version = 1;
  delete legacy.desk.deal.registrationState; delete legacy.desk.deal.transactionScope;
  legacy.desk.deal.salePrice = 10000;
  const raw = JSON.stringify(legacy); device.setItem(LEGACY_DESK_DRAFT_KEY, raw);
  const session = createDeskDraftSession(device, locks());
  assert.equal(session.record.key, LEGACY_DESK_DRAFT_KEY);
  assert.equal(session.record.raw, raw);
  assert.equal(session.draft.version, 3);
  assert.equal(session.draft.desk.deal.registrationState, 'MI');
  assert.equal(session.draft.desk.deal.transactionScope, 'resident-retail');
  assert.equal((await session.save(session.draft)).ok, true);
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), raw);
  assert.equal(JSON.parse(device.getItem(DESK_DRAFT_KEY)).version, 3);
  device.setItem(DESK_DRAFT_KEY, '{');
  assert.equal(readDeskDraftRecord(device).kind, 'rejected');
  assert.equal(loadDeskDraft(device), null);
  const rejected = createDeskDraftSession(device, locks());
  assert.equal((await rejected.discard()).ok, true);
  assert.equal(loadDeskDraft(device), null);
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), null);
  device.removeItem(DESK_DRAFT_KEY); device.setItem(LEGACY_DESK_DRAFT_KEY, 'bad legacy');
  const badLegacy = createDeskDraftSession(device, locks());
  assert.equal((await badLegacy.save(empty())).ok, false);
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), 'bad legacy');
  assert.equal((await badLegacy.discard()).ok, true);
  assert.equal(loadDeskDraft(device), null);
});

test('discard and reset respect locks, failed writes, stale tabs and reset ABA', async () => {
  const device = storage(), coordinator = locks();
  device.setItem(DESK_DRAFT_KEY, '{');
  const a = createDeskDraftSession(device, coordinator), b = createDeskDraftSession(device, coordinator);
  const outcomes = await Promise.all([a.discard(), b.discard()]);
  assert.deepEqual(outcomes, [{ ok: true }, { ok: false, conflict: true }]);
  const old = createDeskDraftSession(device, coordinator);
  const value = empty(); value.desk.deal.salePrice = 20000;
  assert.equal((await a.save(value)).ok, true);
  assert.equal((await a.save(empty())).ok, true);
  assert.equal((await old.save(value)).conflict, true);
  const before = device.getItem(DESK_DRAFT_KEY);
  assert.equal((await createDeskDraftSession(device, null).discard()).ok, false);
  device.setItem = () => { throw new Error('quota'); };
  assert.equal((await a.discard()).ok, false);
  assert.equal(device.getItem(DESK_DRAFT_KEY), before);
});

test('legacy changes before migration conflict; after v2 reset they never resurrect', async () => {
  const device = storage(), coordinator = locks(), legacy = empty(); legacy.version = 1;
  legacy.desk.deal.salePrice = 10000;
  device.setItem(LEGACY_DESK_DRAFT_KEY, JSON.stringify(legacy));
  const session = createDeskDraftSession(device, coordinator);
  legacy.desk.deal.salePrice = 20000;
  device.setItem(LEGACY_DESK_DRAFT_KEY, JSON.stringify(legacy));
  assert.equal((await session.save(session.draft)).conflict, true);
  assert.equal((await session.discard()).conflict, true);
  const fresh = createDeskDraftSession(device, coordinator);
  assert.equal((await fresh.save(empty())).ok, true);
  legacy.desk.deal.salePrice = 30000;
  device.setItem(LEGACY_DESK_DRAFT_KEY, JSON.stringify(legacy));
  assert.equal(loadDeskDraft(device), null);
  assert.equal(fresh.status(), 'saved');
});

test('all scope selections survive v2 normalization; only v1 permits missing scope defaults', () => {
  for (const state of ['', ...REGISTRATION_STATES.map(s => s.value)]) {
    for (const scope of ['', ...TRANSACTION_SCOPES.map(s => s.value)]) {
      const value = empty(); value.desk.deal.registrationState = state; value.desk.deal.transactionScope = scope;
      const normalized = normalizeDeskDraft(value);
      assert.equal(normalized.desk.deal.registrationState, state);
      assert.equal(normalized.desk.deal.transactionScope, scope);
      assert.deepEqual(normalizeDeskDraft(normalized), normalized);
    }
  }
  for (const field of ['registrationState', 'transactionScope']) {
    const value = empty(); delete value.desk.deal[field];
    assert.equal(normalizeDeskDraft(value), null);
    assert.notEqual(normalizeDeskDraft({ ...value, version: 1 }), null);
    for (const bad of [null, 1, {}, 'unknown']) {
      value.desk.deal[field] = bad;
      assert.equal(normalizeDeskDraft(value), null);
      assert.equal(normalizeDeskDraft({ ...value, version: 1 }), null);
    }
  }
});

// Load the actual released writer and its released dependencies, not a mock of
// its projection. Git history is required for this bounded compatibility test.
const releasedModules = new Map();
function releasedModule(path, revision = '4832f6f99882f264977dd9b95369e70fe52828c8') {
  const cacheKey = revision + path;
  if (releasedModules.has(cacheKey)) return releasedModules.get(cacheKey);
  const source = execFileSync('git', ['show', `${revision}:${path}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const rewritten = source.replace(/from (['"])(\.\/[^'"]+)\1/g, (_match, _quote, relative) => {
    const dependency = path.slice(0, path.lastIndexOf('/') + 1) + relative.slice(2);
    return `from '${releasedModule(dependency, revision)}'`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
  releasedModules.set(cacheKey, url);
  return url;
}

test('actual released writer cannot overwrite v2 scope or revive v1 after discard', async () => {
  const released = await import(releasedModule('src/lib/deskDraft.js'));
  const device = storage(), coordinator = locks();
  assert.equal(released.DESK_DRAFT_KEY, LEGACY_DESK_DRAFT_KEY);
  assert.equal(DESK_DRAFT_LOCK_KEY, LEGACY_DESK_DRAFT_KEY);
  const oldValue = empty(); oldValue.version = 1; oldValue.desk.deal.salePrice = 10000;
  assert.equal(released.saveDeskDraft(oldValue, device).ok, true);
  for (const scope of ['nonresident', 'exempt']) {
    const legacyRaw = device.getItem(LEGACY_DESK_DRAFT_KEY);
    const current = createDeskDraftSession(device, coordinator);
    const value = current.draft ?? empty(); value.desk.deal.salePrice = 20000;
    value.desk.deal.registrationState = 'NY'; value.desk.deal.transactionScope = scope;
    assert.equal((await current.save(value)).ok, true);
    assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), legacyRaw);
    assert.equal(released.loadDeskDraft(device).desk.deal.salePrice, 10000);
    const oldTab = released.createDeskDraftSession(device, coordinator);
    oldValue.desk.deal.cashDown += 1000;
    assert.equal((await oldTab.save(oldValue)).ok, true);
    assert.equal(JSON.parse(device.getItem(LEGACY_DESK_DRAFT_KEY)).desk.deal.registrationState, undefined);
    assert.equal(loadDeskDraft(device).desk.deal.registrationState, 'NY');
    assert.equal(loadDeskDraft(device).desk.deal.transactionScope, scope);
    assert.equal(current.status(), 'saved');
  }
  assert.equal(released.normalizeDeskDraft({ ...empty(), version: 2 }), null);
  const current = createDeskDraftSession(device, coordinator);
  const staleOld = released.createDeskDraftSession(device, coordinator);
  assert.equal((await current.discard()).ok, true);
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), null);
  assert.equal((await staleOld.save(oldValue)).conflict, true);
  assert.equal(released.saveDeskDraft(oldValue, device).ok, true);
  assert.equal(loadDeskDraft(device), null);
});

test('blank autosave does not rewrite a discarded record or conflict with another blank tab', async () => {
  const device = storage(), coordinator = locks();
  assert.equal((await createDeskDraftSession(device, coordinator).discard()).ok, true);
  const raw = device.getItem(DESK_DRAFT_KEY);
  const a = createDeskDraftSession(device, coordinator), b = createDeskDraftSession(device, coordinator);
  assert.equal((await a.save(empty())).ok, true);
  assert.equal((await b.save(empty())).ok, true);
  assert.equal(device.getItem(DESK_DRAFT_KEY), raw);
});

test('existing v2 does not require legacy reads and rejected v2 never replaces metadata', async () => {
  const device = storage(), value = empty();
  value.desk.deal.registrationState = 'NY'; value.desk.deal.transactionScope = 'exempt';
  value.desk.deal.salePrice = 20000;
  const raw = JSON.stringify({ ...value, version: 4 }); device.setItem(DESK_DRAFT_KEY, raw);
  const get = device.getItem;
  device.getItem = key => { if (key === LEGACY_DESK_DRAFT_KEY) throw new Error('legacy denied'); return get(key); };
  const rejected = createDeskDraftSession(device, locks());
  assert.equal(rejected.record.kind, 'rejected');
  assert.equal((await rejected.save(empty())).ok, false);
  assert.equal(device.getItem(DESK_DRAFT_KEY), raw);
  device.setItem(DESK_DRAFT_KEY, JSON.stringify(value));
  assert.equal(loadDeskDraft(device).desk.deal.transactionScope, 'exempt');
});

test('explicit discard removes legacy figures, reports removal failure and permits a locked retry', async () => {
  const device = storage(), value = empty(); value.version = 1; value.desk.deal.salePrice = 20000;
  const raw = JSON.stringify(value); device.setItem(LEGACY_DESK_DRAFT_KEY, raw);
  const session = createDeskDraftSession(device, locks());
  const remove = device.removeItem;
  device.removeItem = () => { throw new Error('cleanup denied'); };
  assert.deepEqual(await session.discard(), { ok: false, reason: 'legacy-removal-failed' });
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), raw);
  assert.equal(readDeskDraftRecord(device).kind, 'absent');
  assert.equal(session.status(), 'error');
  assert.equal((await session.save(empty())).ok, false);
  device.removeItem = remove;
  assert.deepEqual(await session.discard(), { ok: true });
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), null);
  assert.equal(session.status(), 'saved');
});

test('valid v2 wins over legacy changes, but explicit cleanup cannot erase a mismatched legacy snapshot', async () => {
  const device = storage(), value = empty(); value.desk.deal.registrationState = 'NY'; value.desk.deal.salePrice = 20000;
  saveDeskDraft(value, device);
  device.setItem(LEGACY_DESK_DRAFT_KEY, 'old raw');
  const session = createDeskDraftSession(device, locks());
  device.setItem(LEGACY_DESK_DRAFT_KEY, 'new old-app work');
  assert.equal(session.status(), 'saved');
  assert.equal(loadDeskDraft(device).desk.deal.registrationState, 'NY');
  assert.equal((await session.save(empty())).ok, true);
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), 'new old-app work');
  assert.deepEqual(await session.discard(), { ok: false, conflict: true });
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), 'new old-app work');
  assert.equal((await createDeskDraftSession(device, locks()).discard()).ok, true);
  assert.equal(device.getItem(LEGACY_DESK_DRAFT_KEY), null);
});


test('v3 preserves independent comparison rates, cash limits and unfinished typing', () => {
  const value = empty(); value.version = 3; value.desk.deal.salePrice = 30000;
  value.desk.gridRates[72] = 8; value.targetValues.payment = 450; value.targetValues.cashLimit = 4000;
  value.inputDrafts['budget-cash-limit'] = { raw: '4k' };
  const device = storage();
  assert.equal(saveDeskDraft(value, device).ok, true);
  const restored = loadDeskDraft(device);
  assert.equal(restored.version, 3);
  assert.equal(restored.desk.deal.apr, 6.5);
  assert.equal(restored.desk.gridRates[72], 8);
  assert.equal(restored.targetValues.cashLimit, 4000);
  assert.deepEqual(restored.inputDrafts['budget-cash-limit'], { raw: '4k' });
  for (const invalid of [-1, 1.001, '4000', null, Infinity]) {
    const bad = structuredClone(value); bad.targetValues.cashLimit = invalid;
    assert.equal(normalizeDeskDraft(bad), null);
  }
});

test('v1 and v2 migrate without creating a cash ceiling or changing figures', () => {
  for (const version of [1, 2]) {
    const value = empty(); value.version = version; value.desk.deal.salePrice = 30000;
    const migrated = normalizeDeskDraft(value);
    assert.equal(migrated.version, 3);
    assert.equal(migrated.targetValues.cashLimit, '');
    assert.deepEqual(migrated.desk.deal, value.desk.deal);
    assert.deepEqual(migrated.desk.gridRates, value.desk.gridRates);
  }
});

test('actual released v2 writer preserves v3 records and conflicts instead of replacing them', async () => {
  const released = await import(releasedModule('src/lib/deskDraft.js', '2ceffd2fc3e082e4e0d9653cbf2135d782670699'));
  const device = storage(), coordinator = locks();
  const value = empty(); value.desk.deal.salePrice = 30000;
  assert.equal(released.saveDeskDraft(value, device).ok, true);
  const oldTab = released.createDeskDraftSession(device, coordinator);
  const current = createDeskDraftSession(device, coordinator);
  const next = current.draft; next.desk.gridRates[72] = 8; next.targetValues.cashLimit = 4000;
  assert.equal((await current.save(next)).ok, true);
  const saved = device.getItem(DESK_DRAFT_KEY);
  assert.equal(released.readDeskDraftRecord(device).kind, 'rejected');
  assert.equal(released.saveDeskDraft(value, device).rejected, true);
  assert.equal((await oldTab.save(value)).conflict, true);
  assert.equal(device.getItem(DESK_DRAFT_KEY), saved);
  assert.equal((await current.discard()).ok, true);
  const tombstone = device.getItem(DESK_DRAFT_KEY);
  assert.equal(released.saveDeskDraft(value, device).rejected, true);
  assert.equal(device.getItem(DESK_DRAFT_KEY), tombstone);
  assert.equal(loadDeskDraft(device), null);
});
