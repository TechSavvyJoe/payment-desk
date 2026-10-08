import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinancialInput } from '../src/lib/inputValidation.js';
import { normalizeApr, calculatePayment } from '../src/lib/calculations.js';

test('entered rates reject unsupported fractional precision with explicit feedback', () => {
  for (const raw of ['6.005', '6.125', '6.0050%', '.001', '0.0001', 6.005]) {
    assert.deepEqual(parseFinancialInput(raw, { kind: 'rate' }), { error: 'Use no more than two decimal places for an interest rate.' }, String(raw));
  }
});

test('two-decimal rates and trailing zero digits retain their values', () => {
  for (const [raw, value] of [['6.01', 6.01], ['6.0100', 6.01], ['6.0100%', 6.01], ['6.000', 6], ['.0100', .01], ['50.00', 50], ['0.000', 0]]) {
    assert.deepEqual(parseFinancialInput(raw, { kind: 'rate' }), { value });
  }
  assert.deepEqual(parseFinancialInput('', { kind: 'rate' }), { value: '' });
  assert.ok(parseFinancialInput('50.01', { kind: 'rate' }).error);
  assert.ok(parseFinancialInput('1e-2', { kind: 'rate' }).error);
});

test('legacy public numeric rate API still normalizes extra precision', () => {
  assert.equal(normalizeApr('6.005'), 6.01);
  assert.equal(normalizeApr(6.004), 6);
  const normalized = calculatePayment({ principal: 30000, apr: 6.01, termMonths: 60 });
  assert.deepEqual(calculatePayment({ principal: 30000, apr: 6.005, termMonths: 60 }), normalized);
});
