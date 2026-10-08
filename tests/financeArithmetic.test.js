import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayment, calculateRateGrid, fromCents, solveAmountFinancedForPayment, solveCentValueForTarget } from '../src/lib/calculations.js';
import { solveAprForPayment } from '../src/lib/suggestions.js';

// Independent present-value oracle: sum each monthly discount factor, then
// divide principal by that annuity. No production PMT formula or float rounding.
function annuity(rate, months) {
  const q = 120000n;
  const a = q + BigInt(rate);
  let power = 1n;
  let sum = 0n;
  for (let month = 0; month < months; month++) {
    sum = q * (sum + power);
    power *= a;
  }
  return { power, sum };
}
function halfUp(numerator, denominator) {
  const whole = numerator / denominator;
  return Number(whole + (numerator % denominator >= (denominator + 1n) / 2n ? 1n : 0n));
}
function oracle(cents, rate, months) {
  const { power, sum } = annuity(rate, months);
  return { payment: halfUp(BigInt(cents) * power, sum), total: halfUp(BigInt(cents) * power * BigInt(months), sum), power, sum };
}

test('exact half-cent fixtures and inverse skipped-payment boundary', () => {
  assert.equal(calculatePayment({ principal: 30001, apr: 6, termMonths: 1 }).payment, 30151.01);
  assert.equal(calculatePayment({ principal: 1.47, apr: 0, termMonths: 98 }).payment, 0.02);
  const inverse = solveAmountFinancedForPayment({ targetPayment: 10051.01, apr: 6, termMonths: 1 });
  assert.equal(inverse.amountFinanced, 10001);
  assert.equal(inverse.exact, true);
});

test('60,000 exact zero-rate half cents over every accepted even term', () => {
  for (let months = 2; months <= 120; months += 2) {
    for (let k = 0; k < 1000; k++) {
      const principal = months * k + months / 2;
      const actual = calculatePayment({ principal: fromCents(principal), apr: 0, termMonths: months });
      assert.equal(actual.cents.payment, k + 1, `principal=${principal}, months=${months}`);
      assert.equal(actual.cents.totalOfPayments, principal);
      assert.equal(actual.cents.totalInterest, 0);
    }
  }
});

test('7,247 adversarial and seeded payments/totals match independent annuity division', () => {
  let seed = 0xabc123;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let i = 0; i < 7247; i++) {
    const months = i < 6000 ? 1 : (i - 6000) % 120 + 1;
    const rate = i < 6000 ? 600 : [0, 1, 600, 601, 725, 5000, random(5001)][i % 7];
    // $odd principal at 6% / one month creates an exact half cent.
    const principal = i < 6000 ? (2 * i + 1) * 100 : random(12000000000) + 1;
    const expected = oracle(principal, rate, months);
    const actual = calculatePayment({ principal: fromCents(principal), apr: rate / 100, termMonths: months });
    assert.equal(actual.cents.payment, expected.payment, `case=${i}, P=${principal}, b=${rate}, n=${months}`);
    assert.equal(actual.cents.totalOfPayments, expected.total, `total case=${i}`);
    assert.equal(actual.cents.totalInterest, expected.total - principal);
  }
});

test('inverse chooses the closest oracle payment and nearest analytical principal', () => {
  for (const rate of [0, 1, 600, 725, 5000]) {
    for (const months of [1, 2, 36, 60, 72, 98, 120]) {
      const { power, sum } = annuity(rate, months);
      for (const target of [0, 1, 3, 45000, 55000, 65000, 1005101, 99999999, 100000000]) {
        const center = BigInt(target) * sum / power;
        let best;
        // Two cents of payment either side covers the entire closest plateau.
        const radius = Number(2n * sum / power) + 5;
        for (let p = Math.max(0, Number(center) - radius); p <= Number(center) + radius; p++) {
          const payment = halfUp(BigInt(p) * power, sum);
          const distance = Math.abs(payment - target);
          const offset = BigInt(p) * power - BigInt(target) * sum;
          const principalDistance = offset < 0n ? -offset : offset;
          if (!best || distance < best.distance || (distance === best.distance && principalDistance < best.principalDistance)) best = { p, payment, distance, principalDistance };
        }
        const actual = solveAmountFinancedForPayment({ targetPayment: fromCents(target), apr: rate / 100, termMonths: months });
        assert.equal(actual.cents.amountFinanced, best.p, `b=${rate}, n=${months}, target=${target}`);
        assert.equal(actual.cents.payment, best.payment);
        assert.equal(actual.exact, best.distance === 0);
      }
    }
  }
});

test('rate ceiling solver fits the independent oracle and rejects the next increment', () => {
  for (const principal of [1, 147, 1000100, 3000100, 12000000000]) {
    for (const months of [1, 36, 72, 98, 120]) {
      for (const rate of [0, 1, 600, 5000]) {
        const target = oracle(principal, rate, months).payment;
        const actual = solveAprForPayment(fromCents(principal), months, fromCents(target));
        const chosen = Math.round(actual * 100);
        assert.ok(oracle(principal, chosen, months).payment <= target);
        if (chosen < 5000) assert.ok(oracle(principal, chosen + 1, months).payment > target);
      }
      const zeroPayment = oracle(principal, 0, months).payment;
      if (zeroPayment > 0) assert.equal(solveAprForPayment(fromCents(principal), months, fromCents(zeroPayment - 1)), null);
    }
  }
});

test('generic solver agrees with exhaustive lowest-cent ties for both plateau directions', () => {
  for (const direction of ['increasing', 'decreasing']) {
    for (const width of [1, 2, 7, 100]) {
      for (let target = -14; target <= 14; target++) {
        const evaluate = c => (direction === 'increasing' ? 1 : -1) * Math.floor(c / width) * 2;
        let best = 0;
        for (let c = 1; c <= 500; c++) if (Math.abs(evaluate(c) - target) < Math.abs(evaluate(best) - target)) best = c;
        const actual = solveCentValueForTarget({ target: target / 100, min: 0, max: 5, direction, evaluate });
        assert.equal(actual.cents.value, best, `${direction}, width=${width}, target=${target}`);
        assert.equal(actual.cents.metric, evaluate(best));
      }
    }
  }
});

test('20-cell normal grid matches independent cent oracle', () => {
  const grid = calculateRateGrid({ dealDate: '2026-10-08', salePrice: 30000, apr: 6 }, { rows: [36, 48, 60, 72, 84], downPayments: [0, 1000, 2000, 5000], includeCustom: false });
  assert.equal(grid.rows.flatMap(row => row.cells).length, 20);
  for (const row of grid.rows) for (const cell of row.cells) {
    assert.equal(cell.cents.payment, oracle(cell.cents.amountFinanced, 600, row.termMonths).payment);
  }
});

test('payment target solver uses oracle-optimal first plateau cent', () => {
  for (const rate of [0, 1, 600, 5000]) {
    for (const months of [1, 36, 98, 120]) {
      const values = Array.from({ length: 501 }, (_, p) => oracle(p, rate, months).payment);
      for (const target of [0, 1, 2, 3, 10, 100, 550]) {
        let best = 0;
        for (let p = 1; p <= 500; p++) if (Math.abs(values[p] - target) < Math.abs(values[best] - target)) best = p;
        const actual = solveCentValueForTarget({ target: target / 100, min: 0, max: 5, evaluate: p => calculatePayment({ principal: p / 100, apr: rate / 100, termMonths: months }).cents.payment });
        assert.equal(actual.cents.value, best, `rate=${rate}, months=${months}, target=${target}`);
        assert.equal(actual.cents.metric, values[best]);
      }
    }
  }
});

test('maximum aggregate principal and rate remain safe with exact totals', () => {
  for (const principal of [5606034884, 12000000000]) {
    for (const rate of [0, 1, 5000]) {
      for (const months of [1, 120]) {
        const expected = oracle(principal, rate, months);
        const actual = calculatePayment({ principal: principal / 100, apr: rate / 100, termMonths: months });
        assert.equal(actual.cents.payment, expected.payment);
        assert.equal(actual.cents.totalOfPayments, expected.total);
        assert.ok(Number.isSafeInteger(actual.cents.totalInterest));
      }
    }
  }
  assert.throws(() => calculatePayment({ principal: 120000000.01 }), /Principal is outside/);
});
