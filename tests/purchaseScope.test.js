import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeal } from '../src/lib/calculations.js';
import { createDeskState } from '../src/lib/dealState.js';
import { normalizeDeskDraft } from '../src/lib/deskDraft.js';
import { REGISTRATION_STATES, TRANSACTION_SCOPES, UnsupportedPurchaseError, getPurchaseScope } from '../src/lib/purchaseScope.js';

const input = { salePrice: 30000, dealDate: '2026-10-08' };
test('only the reviewed Michigan resident purchase can produce a complete estimate', () => {
  assert.equal(REGISTRATION_STATES.length, 51);
  for (const { value } of REGISTRATION_STATES) {
    if (value === 'MI') assert.equal(calculateDeal({ ...input, registrationState: value }).isComplete, true);
    else assert.throws(() => calculateDeal({ ...input, registrationState: value }), UnsupportedPurchaseError);
  }
  for (const value of ['', null, 'unknown', 'mi', 'PR']) {
    assert.throws(() => calculateDeal({ ...input, registrationState: value }), UnsupportedPurchaseError);
  }
});

test('special transactions cannot silently reuse the resident purchase rules', () => {
  for (const { value } of TRANSACTION_SCOPES) {
    const scope = getPurchaseScope({ transactionScope: value });
    if (value === 'resident-retail') assert.equal(scope.supported, true);
    else {
      assert.equal(scope.errorField, 'transaction-scope');
      assert.throws(() => calculateDeal({ ...input, transactionScope: value }), UnsupportedPurchaseError);
    }
  }
});

function draft(deal) {
  return { version: 1, desk: { ...createDeskState('2026-10-08'), deal },
    targetType: 'payment', targetValues: { payment: '', outTheDoor: '', amountFinanced: '', cashDue: '' }, inputDrafts: {} };
}

test('older Michigan-only worksheets retain explicit coverage on migration', () => {
  const legacy = { ...createDeskState('2026-10-08').deal };
  delete legacy.registrationState;
  delete legacy.transactionScope;
  const restored = normalizeDeskDraft(draft(legacy));
  assert.equal(restored.desk.deal.registrationState, 'MI');
  assert.equal(restored.desk.deal.transactionScope, 'resident-retail');
});

test('unsupported coverage survives refresh without becoming a Michigan quote', () => {
  const deal = { ...createDeskState('2026-10-08').deal, salePrice: 30000, registrationState: 'NY' };
  const restored = normalizeDeskDraft(draft(deal));
  assert.equal(restored.desk.deal.registrationState, 'NY');
  assert.throws(() => calculateDeal(restored.desk.deal), UnsupportedPurchaseError);
  assert.equal(normalizeDeskDraft(draft({ ...deal, registrationState: 'bad-state' })), null);
  assert.equal(normalizeDeskDraft(draft({ ...deal, transactionScope: 'bad-scope' })), null);
});
