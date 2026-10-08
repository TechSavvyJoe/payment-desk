import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeal, calculatePayment, toCents } from '../src/lib/calculations.js';
import { buildSuggestions, solveAprForPayment } from '../src/lib/suggestions.js';

const initial = {
  dealDate: '2026-09-24', salePrice: 30_000, cashDown: '', tradeAllowance: '', tradePayoff: '',
  apr: 6.5, termMonths: 72, optionalItems: [],
};
const gridRates = { 36: 6, 48: 6, 60: 6, 72: 6.5, 84: 7 };
const suggest = (dealInput = initial, targetValue = 450, targetType = 'payment') =>
  buildSuggestions({ dealInput, result: calculateDeal(dealInput), targetType, targetValue, gridRates });

function apply(deal, suggestion) {
  if (suggestion.patch) return { ...deal, ...suggestion.patch };
  if (suggestion.itemPatch) return {
    ...deal, optionalItems: deal.optionalItems.map((item, index) =>
      index === suggestion.itemPatch.index ? { ...item, amount: suggestion.itemPatch.amount } : item),
  };
  return { ...deal, optionalItems: [...deal.optionalItems, { name: 'Selected product', amount: suggestion.addRoomItem, taxable: false }] };
}

test('two successive target edits from blank cash down remain numeric and hit both targets', () => {
  const first = suggest().suggestions.find((item) => item.id === 'cash-down');
  assert.equal(first.patch.cashDown, 5_393.95);
  assert.equal(typeof first.patch.cashDown, 'number');
  const firstDeal = apply(initial, first);
  assert.equal(calculateDeal(firstDeal).monthlyPayment, 450);
  const second = suggest(firstDeal, 400).suggestions.find((item) => item.id === 'cash-down');
  assert.equal(second.patch.cashDown, 8_368.38);
  assert.equal(calculateDeal(apply(firstDeal, second)).monthlyPayment, 400);
  assert.equal(suggest(initial).suggestions.find((item) => item.id === 'cash-down').patch.cashDown, 5_393.95);
});

test('formatted numeric strings and blank trades use normalized domain money', () => {
  const deal = { ...initial, salePrice: '$30,000', cashDown: '1000.00', tradeAllowance: '' };
  const solution = suggest(deal, 400);
  assert.ok(solution.suggestions.some((item) => item.id === 'trade'));
  for (const suggestion of solution.suggestions) {
    if (suggestion.patch?.cashDown !== undefined) assert.equal(typeof suggestion.patch.cashDown, 'number');
    assert.deepEqual(calculateDeal(apply(deal, suggestion)).cents, suggestion.previewDeal.cents);
  }
});

test('every patch, product patch and product-room preview reproduces applied cents', () => {
  const deal = { ...initial, cashDown: 2_000, optionalItems: [{ name: 'Service contract', amount: 1_000, taxable: false }] };
  for (const [target, type] of [[400, 'payment'], [600, 'payment'], [20_000, 'amountFinanced'], [40_000, 'outTheDoor']]) {
    for (const suggestion of suggest(deal, target, type).suggestions) {
      const actual = calculateDeal(apply(deal, suggestion));
      assert.deepEqual(actual.cents, suggestion.previewDeal.cents, suggestion.id);
      const metric = type === 'payment' ? 'monthlyPayment' : type;
      assert.equal(toCents(suggestion.difference), actual.cents[metric] - toCents(target));
      assert.equal(suggestion.exact, actual.cents[metric] === toCents(target));
      assert.match(suggestion.detail, /Target reached|below target|above target/);
    }
  }
});

test('APR solver returns the highest available cent rate below the payment ceiling', () => {
  const principal = calculateDeal(initial).amountFinanced;
  for (const target of [450, 450.07, 480, 500]) {
    const apr = solveAprForPayment(principal, 72, target);
    assert.notEqual(apr, null);
    assert.equal(toCents(apr), Math.round(apr * 100));
    assert.ok(calculatePayment({ principal, apr, termMonths: 72 }).payment <= target);
    assert.ok(calculatePayment({ principal, apr: (toCents(apr) + 1) / 100, termMonths: 72 }).payment > target);
    const suggestion = suggest(initial, target).suggestions.find((item) => item.id === 'apr');
    assert.equal(suggestion.patch.apr, apr);
    assert.equal(suggestion.withinTarget, true);
    assert.equal(calculateDeal(apply(initial, suggestion)).payment, suggestion.previewDeal.payment);
  }
  assert.equal(solveAprForPayment(principal, 72, 1), null);
  assert.equal(solveAprForPayment(0, 72, 0), null);
});

test('finance term appears beside price and cash options with an honest payment preview', () => {
  for (const target of [450, 500]) {
    const solution = suggest(initial, target);
    assert.deepEqual(solution.suggestions.slice(0, 3).map(item => item.id), ['sale-price', 'cash-down', 'term']);
    const term = solution.suggestions.find(item => item.id === 'term');
    assert.deepEqual(term.patch, { termMonths: 84, apr: 7 });
    assert.equal(term.previewDeal.salePrice, 30000);
    assert.equal(term.previewDeal.cashDown, 0);
    assert.deepEqual(calculateDeal(apply(initial, term)).cents, term.previewDeal.cents);
    assert.equal(term.withinTarget, target === 500);
    assert.equal(term.status, target === 500 ? 'below-target' : 'partial');
    assert.match(term.detail, target === 500 ? /below target/ : /above target/);
  }
  assert.equal(suggest({ ...initial, termMonths: 84 }, 450).suggestions.some(item => item.id === 'term'), false);
  assert.equal(initial.termMonths, 72);
});

test('current cent payment is already met with no phantom adjustment or longer term', () => {
  const current = calculateDeal(initial);
  assert.equal(current.payment, 540.67);
  const solution = suggest(initial, current.payment);
  assert.equal(solution.alreadyMet, true);
  assert.equal(solution.status, 'already-met');
  assert.equal(solution.gap, 0);
  assert.deepEqual(solution.suggestions, []);
});

test('partial removal identifies the remaining target gap', () => {
  const deal = { ...initial, optionalItems: [{ name: 'Service contract', amount: 1_000, taxable: false }] };
  const option = suggest(deal, 20_000, 'amountFinanced').suggestions.find((item) => item.id === 'option');
  assert.equal(option.itemPatch.amount, 0);
  assert.equal(option.status, 'partial');
  assert.equal(option.exact, false);
  assert.equal(option.remainingGap, 12_163.84);
  assert.match(option.detail, /12,163.84.*above target/);
});

test('room is a qualified product-selection request and never increases APR to spend a budget', () => {
  const solution = suggest(initial, 600);
  assert.equal(solution.direction, 'increase');
  assert.equal(solution.withinTarget, true);
  assert.equal(solution.suggestions.some((item) => item.id === 'apr'), false);
  assert.equal(solution.suggestions.some((item) => item.id === 'term'), false);
  const room = solution.suggestions.find((item) => item.id === 'roll-room');
  assert.equal(room.requiresProductSelection, true);
  assert.match(room.detail, /select an applicable product/);
});

test('zero payment target can clear finance balance without blank-target confusion', () => {
  const solution = suggest({ ...initial, apr: 0 }, 0);
  assert.equal(solution.empty, false);
  const cash = solution.suggestions.find((item) => item.id === 'cash-down');
  assert.equal(cash.previewDeal.amountFinanced, 0);
  assert.equal(cash.previewDeal.payment, 0);
  assert.equal(cash.exact, true);
});

test('blank, invalid, excessive and missing-vehicle targets give safe structured states', () => {
  assert.equal(suggest(initial, '').status, 'empty');
  for (const target of ['30k', -1, 1_000_001]) {
    const solution = suggest(initial, target);
    assert.equal(solution.status, 'invalid');
    assert.ok(solution.error);
    assert.deepEqual(solution.suggestions, []);
  }
  assert.equal(suggest({ ...initial, salePrice: '' }, 450).status, 'ready');
});

test('unknown selling price can be backed out from payment, OTD, finance, or cash due', () => {
  for (const [targetType, targetValue, metric, dealType] of [
    ['payment', 450, 'monthlyPayment', 'finance'],
    ['outTheDoor', 25000, 'outTheDoor', 'finance'],
    ['amountFinanced', 22000, 'amountFinanced', 'finance'],
    ['cashDue', 20000, 'dueAtSigning', 'cash'],
  ]) {
    const deal = { ...initial, salePrice: '', dealType, tradeAllowance: 8000, tradePayoff: 2500, cashDown: 1000,
      optionalItems: [{ name: 'Service Contract', amount: 1200, taxable: false }] };
    const solution = suggest(deal, targetValue, targetType);
    assert.equal(solution.suggestions.length, 1);
    const price = solution.suggestions[0];
    assert.equal(price.id, 'sale-price');
    assert.ok(price.patch.salePrice > 0);
    const applied = calculateDeal(apply(deal, price));
    assert.deepEqual(applied.cents, price.previewDeal.cents);
    assert.ok(Math.abs(applied.cents[metric] - toCents(targetValue)) <= 1, `${targetType}: ${applied[metric]}`);
    assert.equal(applied.isComplete, true);
  }
});

test('cash due scenarios account for trade payoff and never treat cash down as a discount', () => {
  for (const tradePayoff of [2500, 15000]) {
    const deal = { ...initial, dealType: 'cash', tradeAllowance: 8000, tradePayoff, cashDown: 1000 };
    const solution = suggest(deal, 20000, 'cashDue');
    assert.equal(solution.suggestions[0].id, 'sale-price');
    assert.equal(solution.suggestions.some(item => ['cash-down', 'term', 'apr'].includes(item.id)), false);
    for (const scenario of solution.suggestions) {
      assert.deepEqual(calculateDeal(apply(deal, scenario)).cents, scenario.previewDeal.cents);
      assert.ok(Math.abs(scenario.previewDeal.dueAtSigning - 20000) <= .01);
    }
    assert.deepEqual(suggest({ ...deal, cashDown: 9000 }, 20000, 'cashDue').suggestions.map(s => s.patch), solution.suggestions.map(s => s.patch));
  }
  assert.equal(suggest(initial, 20000, 'cashDue').status, 'incomplete');
  assert.equal(suggest({ ...initial, dealType: 'cash' }, 450, 'payment').status, 'incomplete');
});

test('price-only partial solutions retain a positive vehicle and the lower doc fee', () => {
  const suggestion = suggest(initial, 1, 'outTheDoor').suggestions.find((item) => item.id === 'sale-price');
  assert.equal(suggestion.patch.salePrice, 0.01);
  assert.equal(suggestion.previewDeal.fees.documentFee, 0);
  assert.equal(suggestion.status, 'partial');
  assert.ok(suggestion.remainingGap > 0);
});

test('suggestion rate labels say interest rate while retaining apr patches', () => {
  const solution = suggest(initial, 450);
  const rate = solution.suggestions.find(item => item.id === 'apr');
  assert.equal(rate.title, 'Interest rate needed');
  assert.equal(typeof rate.patch.apr, 'number');
  const term = solution.suggestions.find(item => item.id === 'term');
  assert.match(term.detail, /annual interest rate assumption/);
  for (const item of solution.suggestions) assert.doesNotMatch(`${item.title} ${item.detail} ${item.note}`, /\bAPR\b/);
});
