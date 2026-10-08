import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskState, deskReducer, hasDealEdits } from '../src/lib/dealState.js';
import { parseFinancialInput } from '../src/lib/inputValidation.js';
import { calculateDeal } from '../src/lib/calculations.js';
import { buildSuggestions } from '../src/lib/suggestions.js';

test('numeric drafts reject silent coercion and excess interest-rate precision', () => {
  for (const text of ['30k', 'abc', '-1', '1,23', '1..2', '1.001', '1e5', '1000001']) assert.ok(parseFinancialInput(text).error, text);
  assert.deepEqual(parseFinancialInput('$ 30,000.25'), { value: 30000.25 });
  assert.deepEqual(parseFinancialInput(''), { value: '' });
  assert.ok(parseFinancialInput('6.005', { kind: 'rate' }).error);
  assert.equal(parseFinancialInput('6.010', { kind: 'rate' }).value, 6.01);
  assert.ok(parseFinancialInput('', { kind: 'rate', required: true }).error);
  assert.ok(parseFinancialInput('51', { kind: 'rate' }).error);
});

test('blank down plus repeated targets stays normalized through the full state contract', () => {
  let state = createDeskState('2026-09-24');
  state = deskReducer(state, { type: 'field', field: 'salePrice', value: 30000 });
  state = deskReducer(state, { type: 'field', field: 'cashDown', value: '' });
  for (const targetValue of [450, 400]) {
    const suggestion = buildSuggestions({ dealInput: state.deal, result: calculateDeal(state.deal), targetType: 'payment', targetValue, gridRates: state.gridRates }).suggestions.find(item => item.id === 'cash-down');
    assert.ok(suggestion);
    state = deskReducer(state, { type: 'apply', patch: suggestion.patch, label: suggestion.title });
    assert.equal(typeof state.deal.cashDown, 'number');
    assert.equal(calculateDeal(state.deal).monthlyPayment, targetValue);
  }
  assert.ok(Math.abs(state.deal.cashDown - 8368.38) <= 0.02);
});

test('Undo cannot remove any subsequent payoff, product or grid edit', () => {
  const base = deskReducer(createDeskState('2026-09-24'), { type: 'field', field: 'salePrice', value: 30000 });
  const adjusted = deskReducer(base, { type: 'apply', patch: { salePrice: 25000 }, label: 'Reduce selling price' });
  assert.equal(deskReducer(adjusted, { type: 'undo' }).deal.salePrice, 30000);
  for (const action of [{ type: 'field', field: 'tradePayoff', value: 2000 }, { type: 'add-item' }, { type: 'rate', term: 60, value: 5.5 }]) {
    const edited = deskReducer(adjusted, action);
    assert.equal(edited.lastRoll, null);
    assert.deepEqual(deskReducer(edited, { type: 'undo' }), edited);
  }
});

test('view and purchase transitions cannot retain a hidden mobile grid', () => {
  let state = deskReducer(createDeskState('2026-09-24'), { type: 'grid-visibility', open: true });
  state = deskReducer(state, { type: 'view', view: 'customer' });
  assert.equal(state.mobileGridOpen, false);
  assert.equal(deskReducer(state, { type: 'grid-visibility', open: true }).mobileGridOpen, false);
  state = deskReducer(state, { type: 'view', view: 'dealer' });
  state = deskReducer(state, { type: 'field', field: 'cashDown', value: 2000 });
  state = deskReducer(state, { type: 'field', field: 'dealType', value: 'cash' });
  assert.equal(state.deal.cashDown, 0);
  assert.equal(state.mobileGridOpen, false);
});

test('product categories, IDs, cash conversion and reset remain consistent', () => {
  let state = deskReducer(createDeskState('2026-09-24'), { type: 'add-item' });
  assert.equal(state.deal.optionalItems[0].category, 'service-contract');
  state = deskReducer(state, { type: 'item', index: 0, patch: { category: 'gap', name: 'Gap', amount: '750.50' } });
  assert.equal(state.deal.optionalItems[0].amount, 750.5);
  state = deskReducer(state, { type: 'add-item', preset: { category: 'other', name: 'Accessories', amount: 500, taxable: true } });
  assert.notEqual(state.deal.optionalItems[0].id, state.deal.optionalItems[1].id);
  assert.equal(deskReducer(state, { type: 'field', field: 'dealType', value: 'cash' }).deal.optionalItems.length, 2);
  assert.deepEqual(deskReducer(state, { type: 'reset' }).deal.optionalItems, []);
});

test('reset and navigation protection cover trade-only, rate and grid edits', () => {
  const state = createDeskState();
  assert.equal(hasDealEdits(state), false);
  for (const action of [
    { type: 'field', field: 'tradeAllowance', value: 15000 },
    { type: 'field', field: 'apr', value: 7 },
    { type: 'rate', term: 60, value: 4.9 },
    { type: 'down', index: 1, value: 1500 },
  ]) assert.equal(hasDealEdits(deskReducer(state, action)), true);
  assert.equal(hasDealEdits(deskReducer(state, { type: 'view', view: 'customer' })), false);
  const other = deskReducer(state, { type: 'add-item', preset: { category: 'other', amount: 1000 } });
  assert.equal(other.deal.optionalItems[0].taxTreatmentConfirmed, false);
});

test('money drafts can carry a lower ceiling with a dollar-range message', () => {
  assert.deepEqual(parseFinancialInput('280', { max: 280 }), { value: 280 });
  assert.deepEqual(parseFinancialInput('$199.50', { max: 280 }), { value: 199.5 });
  assert.deepEqual(parseFinancialInput('0', { max: 280 }), { value: 0 });
  assert.deepEqual(parseFinancialInput('', { max: 280 }), { value: '' });
  assert.deepEqual(parseFinancialInput('280.01', { max: 280 }), { error: 'Enter an amount from $0 to $280.00.' });
  assert.deepEqual(parseFinancialInput('1,000', { max: 999.99 }), { error: 'Enter an amount from $0 to $999.99.' });
  assert.match(parseFinancialInput('-5', { max: 280 }).error, /negative amounts are not supported/);
  assert.match(parseFinancialInput('12.345', { max: 280 }).error, /two decimal places/);
  // Without a ceiling the general money message is unchanged.
  assert.deepEqual(parseFinancialInput('1000001'), { error: 'Enter a value from 0 to 1,000,000.' });
});

test('an untouched desk never looks edited after midnight and rolls over to the new day', () => {
  const blank = deskReducer(createDeskState('2026-11-30'), { type: 'view', view: 'customer' });
  // Measured against its own start day, whatever today is.
  assert.equal(hasDealEdits(blank), false);
  assert.equal(deskReducer(blank, { type: 'new-day', date: '2026-11-30' }), blank, 'same day changes nothing');
  const next = deskReducer(blank, { type: 'new-day', date: '2026-12-01' });
  // Only the date moves; nothing else resets or remounts.
  assert.deepEqual(next, { ...blank, startDate: '2026-12-01', deal: { ...blank.deal, dealDate: '2026-12-01' } });
  assert.equal(hasDealEdits(next), false);
});

test('the new day only moves a desk forward', () => {
  // Reset already dated the desk with the new day while the app's clock still said yesterday.
  const reset = createDeskState('2027-01-01');
  assert.equal(deskReducer(reset, { type: 'new-day', date: '2026-12-31' }), reset);
});

test('a desk with edits keeps its date at midnight and stays protected', () => {
  for (const action of [
    { type: 'field', field: 'salePrice', value: 30000 },
    { type: 'field', field: 'dealDate', value: '2026-11-15' },
    { type: 'rate', term: 60, value: 4.9 },
  ]) {
    const edited = deskReducer(createDeskState('2026-11-30'), action);
    assert.equal(deskReducer(edited, { type: 'new-day', date: '2026-12-01' }), edited);
    assert.equal(hasDealEdits(edited), true);
  }
});

test('a date someone picked is kept at midnight, even when it makes the desk blank again', () => {
  let state = createDeskState('2026-10-06');
  state = deskReducer(state, { type: 'field', field: 'dealDate', value: '2026-10-05' });
  state = deskReducer(state, { type: 'field', field: 'dealDate', value: '2026-10-06' });
  assert.equal(hasDealEdits(state), false);
  assert.equal(state.dateChosen, true);
  assert.equal(deskReducer(state, { type: 'new-day', date: '2026-10-07' }), state);
  // Reset hands the date back to the calendar.
  assert.equal(deskReducer(state, { type: 'reset' }).dateChosen, false);
});
