import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskState } from '../src/lib/dealState.js';
import { summarizeWorksheet } from '../src/lib/worksheetSummary.js';
const snapshot = () => ({ version: 3, desk: { ...createDeskState('2026-10-11'), deal: { ...createDeskState('2026-10-11').deal, salePrice: 25000 } }, targetType: 'payment', targetValues: { payment: '', outTheDoor: '', amountFinanced: '', cashDue: '', cashLimit: '' }, inputDrafts: {} });
test('saved worksheet summaries recalculate with current fees, never snapshot totals', () => {
  const value = snapshot(); value.monthlyPayment = 1;
  const low = summarizeWorksheet(value, { documentFee: 0, crvFee: 0 });
  const high = summarizeWorksheet(value, { documentFee: 280, crvFee: 34 });
  assert.equal(low.ready, true); assert.ok(high.payment > low.payment); assert.ok(high.outTheDoor > low.outTheDoor);
  assert.notEqual(high.payment, 1);
});
test('invalid saved typing, missing registration and unsupported scope cannot show ready figures', () => {
  for (const mutate of [
    v => { v.inputDrafts['cash-down'] = { raw: '12x' }; },
    v => { v.inputDrafts['estimate-date'] = { raw: '02/30/26' }; },
    v => { v.inputDrafts['grid-apr-48'] = { raw: '' }; },
    v => { v.desk.deal.plateMode = 'new'; },
    v => { v.desk.deal.registrationState = 'OH'; },
  ]) {
    const value = snapshot(); mutate(value); const result = summarizeWorksheet(value);
    assert.equal(result.ready, false); assert.equal(result.payment, undefined);
  }
  assert.equal(summarizeWorksheet(snapshot(), undefined, { blocked: true }).ready, false);
});
test('cash credit is labeled distinctly and excludes finance-only metrics', () => {
  const value = snapshot(); value.desk.deal.dealType = 'cash'; value.desk.deal.tradeAllowance = 40000; value.targetType = 'cashDue';
  const result = summarizeWorksheet(value);
  assert.equal(result.ready, true); assert.equal(result.label, 'Estimated customer credit'); assert.ok(result.customerCredit > 0);
  assert.equal(result.totalInterest, null); assert.equal(result.amountFinanced, null);
});

test('inactive drafts do not block comparisons, and become invalid again when reactivated', () => {
  for (const id of ['cash-down', 'apr', 'grid-apr-48', 'grid-down-0']) {
    const value = snapshot();
    value.inputDrafts[id] = { raw: 'invalid' };
    value.desk.deal.dealType = 'cash'; value.targetType = 'cashDue';
    assert.equal(summarizeWorksheet(value).ready, true, id);
    assert.equal(value.inputDrafts[id].raw, 'invalid');
    value.desk.deal.dealType = 'finance'; value.targetType = 'payment';
    assert.equal(summarizeWorksheet(value).ready, false, id);
  }
  const plate = snapshot(); plate.inputDrafts['new-plate-amount'] = { raw: 'invalid' };
  assert.equal(summarizeWorksheet(plate).ready, true);
  plate.desk.deal.plateMode = 'new'; plate.desk.deal.newPlateAmount = 200;
  assert.equal(summarizeWorksheet(plate).ready, false);
  const budget = snapshot(); budget.inputDrafts['budget-cash-limit'] = { raw: 'invalid' };
  budget.targetType = 'outTheDoor';
  assert.equal(summarizeWorksheet(budget).ready, true);
  budget.targetType = 'payment';
  assert.equal(summarizeWorksheet(budget).ready, false);
});
