import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatWholeCurrency, formatNumber, formatShortDate, parseShortDate } from '../src/lib/formatters.js';
import { calculateDeal, calculateRateGrid } from '../src/lib/calculations.js';
import { buildSuggestions } from '../src/lib/suggestions.js';

// Uncached formatter behavior before the optimization, including coercion and signs.
const referenceCurrency = (value, { cents = false, sign = false } = {}) => {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const hasCents = Math.abs(numeric - Math.round(numeric)) > 0.0001;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: cents || hasCents ? 2 : 0,
    maximumFractionDigits: cents || hasCents ? 2 : 0,
    signDisplay: sign ? 'always' : 'auto',
  }).format(numeric).replace('+$', '+$').replace('-$', '−$');
};
const referenceNumber = (value, digits = 2) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(Number(value) || 0);

test('cached money strings match prior coercion, rounding, precision and signs', () => {
  const values = [0, -0, 1, -1, 1.005, -1.005, 1.00009, 1.00011, 1234.565, -1234.565,
    '1234.56', '', 'invalid', null, undefined, NaN, Infinity, -Infinity, true, false, 123n,
    { valueOf: () => 450.25 }];
  for (const value of values) {
    for (const cents of [false, true, '', 'yes']) {
      for (const sign of [false, true, 0, 1]) {
        assert.equal(formatCurrency(value, { cents, sign }), referenceCurrency(value, { cents, sign }));
      }
    }
    for (const sign of [false, true]) {
      assert.equal(formatWholeCurrency(value, { sign }), referenceCurrency(Math.round(Number(value) || 0), { sign }));
    }
  }
  assert.equal(formatCurrency(1.005, { cents: true }), '$1.01');
  assert.equal(formatCurrency(-1.005, { cents: true }), '−$1.01');
  assert.equal(formatWholeCurrency(-1.5), '−$1');
  assert.equal(formatCurrency(-0, { sign: true }), '−$0');
});

test('number precision retains prior values, coercion and Intl range errors', () => {
  const precisions = [...Array.from({ length: 21 }, (_, i) => i), 21, 100, '2', 2.9, null, false,
    { valueOf: () => 3 }, -1, 101, NaN, Infinity];
  for (const digits of precisions) {
    for (const value of [0, -0, 6.005, '1234.565', '', null, undefined, NaN, Infinity, -Infinity, 12n]) {
      let expected;
      try { expected = referenceNumber(value, digits); }
      catch (error) { assert.throws(() => formatNumber(value, digits), { name: error.name, message: error.message }); continue; }
      assert.equal(formatNumber(value, digits), expected);
    }
  }
  assert.equal(formatNumber(6), '6.00');
  assert.equal(formatNumber(6.005), '6.01');
  // Coercible objects must not be cached: Intl evaluates their precision each time.
  let digits = 1;
  const precision = { valueOf: () => digits };
  assert.equal(formatNumber(6.005, precision), '6.0');
  digits = 3;
  assert.equal(formatNumber(6.005, precision), '6.005');
  assert.throws(() => formatCurrency(Symbol('money')), TypeError);
  assert.throws(() => formatNumber(Symbol('number')), TypeError);
});

test('currency cache reuses four combinations and number cache stays within 21 precisions', async (t) => {
  const NumberFormat = Intl.NumberFormat;
  let constructions = 0;
  t.mock.method(Intl, 'NumberFormat', function (...args) {
    constructions += 1;
    return new NumberFormat(...args);
  });
  const fresh = await import('../src/lib/formatters.js?cache-bounds');
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const value of [450, 450.25]) for (const sign of [false, true, 'yes']) {
      fresh.formatCurrency(value, { sign });
      fresh.formatCurrency(value, { cents: true, sign });
    }
  }
  assert.equal(constructions, 4);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (let digits = 0; digits <= 20; digits += 1) fresh.formatNumber(6.005, digits);
  }
  assert.equal(constructions, 25);
  // Each non-cacheable precision still constructs Intl rather than adding keys.
  for (const digits of ['2', 2.9, 21, 100]) {
    for (let repeat = 0; repeat < 2; repeat += 1) {
      try { fresh.formatNumber(6.005, digits); } catch (error) { assert.ok(error instanceof RangeError); }
    }
  }
  assert.equal(constructions, 33);
  fresh.formatCurrency(450.25, { sign: true });
  fresh.formatNumber(6.005, 2);
  assert.equal(constructions, 33);
});

test('reference deal, grid labels and target suggestion strings retain their cents', () => {
  const dealInput = { dealDate: '2026-09-24', salePrice: 30000, apr: 6, termMonths: 60 };
  const result = calculateDeal(dealInput);
  assert.equal(result.monthlyPayment, 621.82);
  assert.equal(formatCurrency(result.monthlyPayment, { cents: true }), '$621.82');
  assert.equal(formatCurrency(result.outTheDoor, { cents: true }), '$32,163.84');
  const grid = calculateRateGrid(dealInput, { rows: [60], downPayments: [0], includeCustom: false });
  const cell = grid.rows[0].cells[0];
  assert.equal(`Use ${cell.termMonths} months at ${formatNumber(cell.apr)} percent with ${formatCurrency(cell.cashDown)} down for ${formatCurrency(cell.monthlyPayment)} per month`,
    'Use 60 months at 6.00 percent with $0 down for $621.82 per month');
  const targetInput = { ...dealInput, apr: 6.5, termMonths: 72, optionalItems: [] };
  const solution = buildSuggestions({ dealInput: targetInput, result: calculateDeal(targetInput), targetType: 'payment', targetValue: 450,
    gridRates: { 36: 6, 48: 6, 60: 6, 72: 6.5, 84: 7 } });
  const cashDown = solution.suggestions.find(item => item.id === 'cash-down');
  assert.equal(cashDown.patch.cashDown, 5393.95);
  assert.equal(cashDown.value, '+$5,393.95');
  assert.equal(cashDown.previewDeal.monthlyPayment, 450);
  assert.match(cashDown.detail, /^\$450\.00\/mo .*Target reached\.$/);
});

test('short dates preserve the ISO calendar day and always use MM/DD/YY', () => {
  for (const [iso, display] of [
    ['2026-09-24', '09/24/26'],
    ['2026-01-01', '01/01/26'],
    ['2028-02-29', '02/29/28'],
    ['2000-02-29', '02/29/00'],
    ['2099-12-31', '12/31/99'],
  ]) {
    assert.equal(formatShortDate(iso), display);
    assert.deepEqual(parseShortDate(display), { value: iso });
  }
});

test('short date input rejects impossible dates and ambiguous formats', () => {
  for (const draft of ['', '02/29/26', '04/31/26', '13/01/26', '00/24/26', '09/00/26', '09/31/26', '9/24/26', '09/24/2026', '2026-09-24', '09-24-26', 'date']) {
    const parsed = parseShortDate(draft);
    assert.equal(parsed.value, undefined, draft);
    assert.match(parsed.error, /MM\/DD\/YY/, draft);
  }
  for (const iso of ['2026-02-29', '2026-13-01', '2026-04-31', '09/24/26']) {
    assert.throws(() => formatShortDate(iso), RangeError, iso);
  }
});
