import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskState, deskReducer } from '../src/lib/dealState.js';
import { createDeskDraftSession, DESK_DRAFT_KEY, hasDeskDraftEdits, isBaselineDeskInput, loadDeskDraft, normalizeDeskDraft, saveDeskDraft } from '../src/lib/deskDraft.js';

const empty = () => ({ version: 1, desk: createDeskState('2026-10-07'), targetType: 'payment', targetValues: { payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' }, inputDrafts: {} });
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
  assert.equal(device.getItem(DESK_DRAFT_KEY), null);
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
  assert.equal(device.getItem(DESK_DRAFT_KEY), null);
  assert.deepEqual(await b.save(second), { ok: false, conflict: true });
});

test('draft sessions retain the previous draft when locking or storage is unavailable', async () => {
  const device = storage(), value = empty(); value.desk.deal.salePrice = 30000;
  saveDeskDraft(value, device);
  const previous = device.getItem(DESK_DRAFT_KEY);
  assert.deepEqual(await createDeskDraftSession(device, null).save(empty()), { ok: false });
  assert.equal(device.getItem(DESK_DRAFT_KEY), previous);
  device.removeItem = () => { throw new Error('blocked'); };
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
  assert.equal(device.getItem(DESK_DRAFT_KEY), null);
  assert.equal(device.getItem('payment-desk.dealership.v1'), 'saved dealership');
});

test('corrupt, unsupported, oversized and out-of-range drafts are ignored', () => {
  const device = storage();
  for (const raw of ['{', JSON.stringify({ ...empty(), version: 2 }), ' '.repeat(200001)]) {
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
