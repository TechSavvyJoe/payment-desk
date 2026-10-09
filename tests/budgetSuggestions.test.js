import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeal } from '../src/lib/calculations.js';
import { buildBudgetSuggestions, buildSuggestions } from '../src/lib/suggestions.js';

const dealInput = { dealDate: '2026-09-24', salePrice: 30000, cashDown: 0, tradeAllowance: 0, tradePayoff: 0, apr: 6.5, termMonths: 72, optionalItems: [] };
const gridRates = { 36: 6, 48: 6, 60: 6, 72: 6.5, 84: 7 };
const budget = (changes = {}) => buildBudgetSuggestions({ dealInput, gridRates, targetValue: 450, cashLimit: 4000, ...changes });

test('bounded synthetic options reproduce independent exact-cent expectations and only patch cash/term/rate', () => {
  const before = structuredClone(dealInput);
  const solution = budget();
  assert.equal(solution.status, 'ready');
  assert.equal(solution.suggestions.length, 1);
  const option = solution.suggestions[0];
  assert.deepEqual(option.patch, { termMonths: 84, apr: 7, cashDown: 2347.74 });
  assert.equal(option.previewDeal.cents.monthlyPayment, 45000);
  assert.equal(option.previewDeal.cents.dueAtSigning, 234774);
  assert.equal(option.previewDeal.cents.totalInterest, 798431);
  assert.equal(option.previewDeal.cents.amountFinanced, 2981610);
  assert.equal(option.interestDeltaCents, 121977);
  assert.deepEqual(calculateDeal({ ...dealInput, ...option.patch }).cents, option.previewDeal.cents);
  assert.deepEqual(dealInput, before);
  for (const cashLimit of [2348.05, 2348, 2347.74]) {
    assert.deepEqual(budget({ cashLimit }).suggestions[0].patch, option.patch);
  }
  assert.equal(budget({ cashLimit: 2347.73 }).status, 'no-match');
  assert.equal(calculateDeal({ ...dealInput, ...option.patch, cashDown: 2347.73 }).cents.monthlyPayment, 45001);
});

test('total signing cash includes upfront negative equity and upfront products/payments', () => {
  const negative = { ...dealInput, tradePayoff: 2000, rollNegativeEquity: false };
  assert.equal(budget({ dealInput: negative }).status, 'no-match');
  const option = budget({ dealInput: negative, cashLimit: 5000 }).suggestions[0];
  assert.equal(option.previewDeal.cents.cashDown, 234774);
  assert.equal(option.previewDeal.cents.dueAtSigning, 434774);
  assert.equal(budget({ dealInput: negative, cashLimit: 4347.74 }).suggestions[0].previewDeal.cents.dueAtSigning, 434774);
  assert.equal(budget({ dealInput: negative, cashLimit: 4347.73 }).status, 'no-match');
  const upfront = { ...dealInput, upfrontAmount: 1000 };
  const upfrontOption = budget({ dealInput: upfront }).suggestions.at(-1);
  assert.equal(upfrontOption.previewDeal.cents.cashDown, 134774);
  assert.equal(upfrontOption.previewDeal.cents.dueAtSigning, 234774);
  assert.equal(upfrontOption.previewDeal.cents.upfrontAmount, 100000);
});

test('already-fitting current scenario is visible even if entered grid rate differs', () => {
  const current = { ...dealInput, cashDown: 3000, termMonths: 84, apr: 6.5 };
  const option = budget({ dealInput: current }).suggestions.find(s => s.id === 'budget-current');
  assert.ok(option);
  assert.deepEqual(option.patch, { cashDown: 3000, termMonths: 84, apr: 6.5 });
  assert.equal(option.interestDeltaCents, 0);
});

test('current scenario is informational while a distinct grid-rate option remains available', () => {
  const current = { ...dealInput, cashDown: 0, termMonths: 72, apr: 6.5 };
  const solution = budget({ dealInput: current, gridRates: { ...gridRates, 72: 8 }, targetValue: 600 });
  const currentOption = solution.suggestions.find(option => option.id === 'budget-current');
  const gridOption = solution.suggestions.find(option => option.id === 'budget-72');
  assert.equal(currentOption.informational, true);
  assert.equal(currentOption.previewDeal.cents.monthlyPayment, calculateDeal(current).cents.monthlyPayment);
  assert.ok(gridOption);
  assert.deepEqual(gridOption.patch, { termMonths: 72, apr: 8, cashDown: 0 });
  assert.equal(gridOption.informational, false);
});

test('zero-rate and zero-payment budgets preserve exact cents without negative finance', () => {
  const rates = Object.fromEntries([36, 48, 60, 72, 84].map(term => [term, 0]));
  const options = budget({ gridRates: rates, cashLimit: 40000, targetValue: 0 }).suggestions;
  assert.equal(options.length, 5);
  for (const option of options) {
    assert.equal(option.previewDeal.cents.amountFinanced, 0);
    assert.equal(option.previewDeal.cents.totalInterest, 0);
    assert.equal(option.previewDeal.cents.dueAtSigning, 3216384);
  }
  const nearPaid = budget({ dealInput: { ...dealInput, apr: 0, cashDown: 32163.67 }, gridRates: rates, cashLimit: 40000, targetValue: 0 });
  assert.equal(nearPaid.suggestions.some(option => option.id === 'budget-current'), false);
  assert.ok(nearPaid.suggestions.every(option => option.previewDeal.cents.amountFinanced === 0));
});

test('guards reject invalid drafts, range, unknown registration, unresolved products, policy and unsupported purchases', () => {
  for (const change of [
    { cashDown: 40000 }, { salePrice: '' }, { salePrice: '30k' }, { salePrice: 1000001 },
    { plateMode: 'new', newPlateAmount: '' }, { registrationState: 'OH' }, { transactionScope: 'lease' },
    { optionalItems: [{ name: '', amount: 1000, category: 'other', taxable: false, taxTreatmentConfirmed: true }] },
    { optionalItems: [{ name: 'Accessory', amount: 1000, category: 'other', taxable: false }] },
    { dealDate: '2030-09-24' }, { apr: 51 }, { termMonths: 0 }, { dealType: 'cash' },
  ]) {
    const solution = budget({ dealInput: { ...dealInput, ...change } });
    assert.deepEqual(solution.suggestions, [], JSON.stringify(change));
    assert.ok(solution.error, JSON.stringify(change));
  }
  for (const changes of [{ hasInputErrors: true }, { cashLimit: '4k' }, { cashLimit: -1 }, { cashLimit: 1000001 }, { targetValue: '45x' }, { gridRates: { ...gridRates, 36: '' } }, { gridRates: { ...gridRates, 84: 51 } }]) {
    assert.deepEqual(budget(changes).suggestions, []);
    assert.ok(budget(changes).error);
  }
});

test('blank ceiling retains the existing single-change solver path; explicit infeasibility is distinct', () => {
  assert.equal(budget({ cashLimit: '' }).status, 'empty');
  assert.equal(budget({ cashLimit: 0 }).status, 'no-match');
  const single = buildSuggestions({ dealInput, gridRates, targetValue: 450 });
  assert.deepEqual(single.suggestions.slice(0, 3).map(s => s.id), ['sale-price', 'cash-down', 'term']);
  assert.equal(single.suggestions.find(s => s.id === 'cash-down').patch.cashDown, 5393.95);
});

test('term interest deltas use calculated cents, including signed lower/equal and 0% interest', () => {
  const term = buildSuggestions({ dealInput, gridRates, targetValue: 500 }).suggestions.find(s => s.id === 'term');
  assert.equal(term.previewDeal.cents.totalInterest, 861300);
  assert.equal(term.interestDeltaCents, 184846);
  assert.notEqual(term.previewDeal.cents.totalInterest, term.previewDeal.cents.monthlyPayment * 84 - term.previewDeal.cents.amountFinanced);
  const zero = buildSuggestions({ dealInput, gridRates: { ...gridRates, 84: 0 }, targetValue: 500 }).suggestions.find(s => s.id === 'term');
  assert.equal(zero.previewDeal.cents.totalInterest, 0);
  assert.equal(zero.interestDeltaCents, -676454);
  const equal = buildSuggestions({ dealInput: { ...dealInput, apr: 0 }, gridRates: { ...gridRates, 84: 0 }, targetValue: 400 }).suggestions.find(s => s.id === 'term');
  assert.equal(equal.interestDeltaCents, 0);
});
