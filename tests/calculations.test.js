import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CALCULATION_DEFAULTS,
  CALCULATION_LIMITS,
  RATE_GRID_DEFAULTS,
  calculateDeal as calculateUndatedDeal,
  calculatePayment,
  calculateRateGrid as calculateUndatedGrid,
  fromCents,
  paymentFactor,
  normalizeApr,
  solveAmountFinancedForPayment,
  solveCentValueForTarget,
  solveOptionalItemAmountForTarget as solveUndatedItem,
  solveSalePriceForTarget as solveUndatedPrice,
  toCents,
} from '../src/lib/calculations.js';
import { createHash } from 'node:crypto';
import { getMichiganPolicy, POLICY_CONFIG, todayDealDate } from '../src/lib/policy.js';

// Keep historical fixtures deterministic when policy dates roll over.
const dated = (input = {}) => ({ dealDate: '2026-09-24', ...input });
const calculateDeal = (input) => calculateUndatedDeal(dated(input));
const calculateRateGrid = (input, options) => calculateUndatedGrid(dated(input), options);
const solveSalePriceForTarget = (input, options) => solveUndatedPrice(dated(input), options);
const solveOptionalItemAmountForTarget = (input, options) => solveUndatedItem(dated(input), options);

test('currency helpers round decimal values to exact cents', () => {
  assert.equal(toCents('$1,234.565'), 123_457);
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(-1.005), -101);
  assert.equal(toCents('1e2'), 10_000);
  assert.equal(fromCents(123_457), 1_234.57);
  assert.throws(() => toCents(Number.NaN), /finite/);
});

test('exports the current Michigan constants and standard RATE grid terms', () => {
  assert.deepEqual(CALCULATION_DEFAULTS, {
    salesTaxRate: 0.06,
    tradeTaxCreditCap: 12_000,
    documentFee: 280,
    crvFee: 34,
    plateTransferFee: 10,
    additionalTransferFee: 5,
    cashTitleFee: 15,
    financeTitleFee: 16,
  });
  assert.deepEqual(RATE_GRID_DEFAULTS.termMonths, [36, 48, 60, 72, 84]);
  assert.deepEqual(RATE_GRID_DEFAULTS.downPayments, [0, 1_000, 2_000, 3_000, 5_000]);
});

test('matrix 1: standard financed deal includes taxable fixed fees', () => {
  const deal = calculateDeal({ salePrice: 30_000, apr: 6, termMonths: 60 });

  assert.equal(deal.fees.documentFee, 280);
  assert.equal(deal.fees.crvFee, 34);
  assert.equal(deal.fees.titleFee, 16);
  assert.equal(deal.fees.totalFees, 345);
  assert.equal(deal.taxBase, 30_314);
  assert.equal(deal.salesTax, 1_818.84);
  assert.equal(deal.outTheDoor, 32_163.84);
  assert.equal(deal.amountFinanced, 32_163.84);
  assert.equal(deal.payment, 621.82);
  assert.equal(deal.totalOfPayments, 37_309.03);
  assert.equal(deal.totalInterest, 5_145.19);
});

test('blank deal stays at zero until a vehicle price is entered', () => {
  const deal = calculateDeal({ salePrice: '', apr: '', termMonths: 72 });

  assert.equal(deal.outTheDoor, 0);
  assert.equal(deal.amountFinanced, 0);
  assert.equal(deal.monthlyPayment, 0);
  assert.equal(deal.fees.totalFees, 0);
});

test('matrix 2: down only reduces amount financed and 0% interest stays zero', () => {
  const deal = calculateDeal({
    salePrice: 25_000,
    cashDown: 3_000,
    apr: 0,
    termMonths: 60,
  });

  assert.equal(deal.taxBase, 25_314);
  assert.equal(deal.salesTax, 1_518.84);
  assert.equal(deal.outTheDoor, 26_863.84);
  assert.equal(deal.amountFinanced, 23_863.84);
  assert.equal(deal.payment, 397.73);
  assert.equal(deal.totalOfPayments, 23_863.84);
  assert.equal(deal.totalInterest, 0);
  assert.equal(deal.dueAtSigning, 3_000);
});

test('trade deduction and tax savings explain the cap and zero-tax floor in cents', () => {
  for (const dealType of ['cash', 'finance']) {
    for (const [salePrice, tradeAllowance, deduction, savings] of [
      [30000, 10000, 10000, 600], [30000, 18000, 12000, 720], [1000, 18000, 1084, 65.04],
    ]) {
      const input = { dealDate: '2026-09-25', dealType, salePrice, tradeAllowance, tradePayoff: 20000 };
      const deal = calculateDeal(input);
      const withoutTrade = calculateDeal({ ...input, tradeAllowance: 0 });
      assert.equal(deal.tradeTaxDeduction, deduction);
      assert.equal(deal.tradeTaxSavings, savings);
      assert.equal(deal.cents.tradeTaxSavings, withoutTrade.cents.salesTax - deal.cents.salesTax);
      assert.equal(deal.cents.taxBase, deal.cents.taxableTotalBeforeCredit - deal.cents.tradeTaxDeduction);
      assert.ok(deal.salesTax >= 0);
    }
  }
});

test('matrix 3: trade tax credit is capped at $12,000 and uses allowance, not payoff', () => {
  const deal = calculateDeal({
    salePrice: 40_000,
    tradeAllowance: 15_000,
    tradePayoff: 7_000,
    apr: 6.9,
    termMonths: 72,
  });

  assert.equal(deal.tradeTaxCredit, 12_000);
  assert.equal(deal.tradeEquity, 8_000);
  assert.equal(deal.taxBase, 28_314);
  assert.equal(deal.salesTax, 1_698.84);
  assert.equal(deal.amountFinanced, 34_043.84);
  assert.equal(deal.payment, 578.78);

  const differentPayoff = calculateDeal({
    salePrice: 40_000,
    tradeAllowance: 15_000,
    tradePayoff: 20_000,
    apr: 6.9,
    termMonths: 72,
  });
  assert.equal(differentPayoff.tradeTaxCredit, 12_000);
  assert.equal(differentPayoff.salesTax, deal.salesTax);
  assert.notEqual(differentPayoff.amountFinanced, deal.amountFinanced);
});

test('matrix 4: negative equity can be rolled or paid upfront', () => {
  const input = {
    salePrice: 35_000,
    tradeAllowance: 10_000,
    tradePayoff: 14_500,
    apr: 7.5,
    termMonths: 72,
  };
  const rolled = calculateDeal({ ...input, rollNegativeEquity: true });
  const paidUpfront = calculateDeal({ ...input, rollNegativeEquity: false });

  assert.equal(rolled.tradeEquity, -4_500);
  assert.equal(rolled.salesTax, 1_518.84);
  assert.equal(rolled.amountFinanced, 41_363.84);
  assert.equal(rolled.payment, 715.19);
  assert.equal(rolled.dueAtSigning, 0);

  assert.equal(paidUpfront.amountFinanced, 36_863.84);
  assert.equal(paidUpfront.payment, 637.38);
  assert.equal(paidUpfront.dueAtSigning, 4_500);
});

test('matrix 5: obsolete rebate keys cannot silently change a deal', () => {
  const baseDeal = calculateDeal({
    salePrice: 30_000,
    apr: 5,
    termMonths: 60,
  });
  const legacyKeys = calculateDeal({
    salePrice: 30_000,
    manufacturerRebate: 3_000,
    rebate: 5_000,
    apr: 5,
    termMonths: 60,
  });

  assert.equal(legacyKeys.outTheDoor, baseDeal.outTheDoor);
  assert.equal(legacyKeys.amountFinanced, baseDeal.amountFinanced);
  assert.equal(legacyKeys.payment, baseDeal.payment);
  assert.equal('manufacturerRebate' in legacyKeys, false);
});

test('matrix 6: only optional items marked taxable enter the tax base', () => {
  const deal = calculateDeal({
    salePrice: 32_000,
    cashDown: 2_000,
    apr: 8,
    termMonths: 72,
    optionalItems: [
      { id: 'service-contract', amount: 1_800, taxable: false },
      { id: 'accessory', amount: 500, taxable: true },
    ],
  });

  assert.equal(deal.taxableOptions, 500);
  assert.equal(deal.nonTaxableOptions, 1_800);
  assert.equal(deal.taxBase, 32_814);
  assert.equal(deal.salesTax, 1_968.84);
  assert.equal(deal.outTheDoor, 36_613.84);
  assert.equal(deal.amountFinanced, 34_613.84);
  assert.equal(deal.payment, 606.89);
});

test('matrix 7: new plate amount replaces transfer fees while title remains automatic', () => {
  const newPlate = calculateDeal({
    salePrice: 28_000,
    plateMode: 'new',
    newPlateAmount: 250,
    apr: 6.5,
    termMonths: 60,
  });
  const transfer = calculateDeal({
    salePrice: 28_000,
    plateMode: 'transfer',
    apr: 6.5,
    termMonths: 60,
  });

  assert.equal(newPlate.fees.newPlateAmount, 250);
  assert.equal(newPlate.fees.plateTransferFee, 0);
  assert.equal(newPlate.fees.additionalTransferFee, 0);
  assert.equal(newPlate.fees.titleFee, 16);
  assert.equal(newPlate.fees.totalFees, 580);
  assert.equal(newPlate.salesTax, 1_698.84);
  assert.equal(newPlate.outTheDoor, 30_278.84);
  assert.equal(newPlate.payment, 592.44);
  assert.equal(transfer.outTheDoor, 30_043.84);
  assert.equal(newPlate.outTheDoor - transfer.outTheDoor, 235);
});

test('matrix 8: cash transfer deal uses the $15 title fee', () => {
  const deal = calculateDeal({ salePrice: 20_000, dealType: 'cash' });
  const newPlate = calculateDeal({
    salePrice: 20_000,
    dealType: 'cash',
    plateMode: 'new',
    newPlateAmount: 100,
  });

  assert.equal(deal.fees.titleFee, 15);
  assert.equal(deal.fees.totalFees, 344);
  assert.equal(deal.taxBase, 20_314);
  assert.equal(deal.salesTax, 1_218.84);
  assert.equal(deal.outTheDoor, 21_562.84);
  assert.equal(deal.dueAtSigning, 21_562.84);
  assert.equal(deal.amountFinanced, 0);
  assert.equal(deal.payment, 0);
  assert.equal(newPlate.fees.titleFee, 15);
  assert.equal(newPlate.fees.newPlateAmount, 100);
  assert.equal(newPlate.fees.totalFees, 429);
});

test('matrix 9: reverse payment and dealer-price solvers hit target cents', () => {
  const target550 = solveAmountFinancedForPayment({
    targetPayment: 550,
    apr: 6,
    termMonths: 60,
  });
  const target650 = solveAmountFinancedForPayment({
    targetPayment: 650,
    apr: 6,
    termMonths: 60,
  });

  assert.equal(target550.amountFinanced, 28_449.06);
  assert.equal(target550.payment, 550);
  assert.equal(target550.exact, true);
  assert.equal(target650.amountFinanced, 33_621.61);
  assert.equal(target650.payment, 650);
  assert.equal(target650.exact, true);

  const dealerDiscount = solveSalePriceForTarget(
    { salePrice: 30_000, apr: 6, termMonths: 60 },
    { target: target550.amountFinanced, metric: 'amountFinanced' },
  );
  assert.equal(dealerDiscount.salePrice, 26_495.49);
  assert.equal(dealerDiscount.adjustment, 3_504.51);
  assert.equal(dealerDiscount.deal.salesTax, 1_608.57);
  assert.equal(dealerDiscount.deal.amountFinanced, 28_449.06);
  assert.equal(dealerDiscount.deal.payment, 550);

  const taxableRoom = solveOptionalItemAmountForTarget(
    {
      salePrice: 30_000,
      apr: 6,
      termMonths: 60,
      optionalItems: [{ id: 'taxable-accessory', amount: 0, taxable: true }],
    },
    { itemIndex: 0, target: target650.amountFinanced, metric: 'amountFinanced' },
  );
  assert.equal(taxableRoom.optionalItemAmount, 1_375.25);
  assert.equal(taxableRoom.deal.salesTax, 1_901.36);
  assert.equal(taxableRoom.deal.amountFinanced, 33_621.61);
  assert.equal(taxableRoom.deal.payment, 650);
});

test('matrix 10: target amount financed exposes the remaining gap after removing an item', () => {
  const base = {
    salePrice: 32_000,
    cashDown: 2_000,
    apr: 8,
    termMonths: 72,
    optionalItems: [
      { id: 'service-contract', amount: 1_800, taxable: false },
      { id: 'accessory', amount: 500, taxable: true },
    ],
  };
  const deal = calculateDeal(base);
  assert.equal(deal.cents.amountFinanced - toCents(33_000), toCents(1_613.84));

  const removeAccessory = solveOptionalItemAmountForTarget(base, {
    itemIndex: 1,
    target: 33_000,
    metric: 'amountFinanced',
  });
  assert.equal(removeAccessory.optionalItemAmount, 0);
  assert.equal(removeAccessory.deal.amountFinanced, 34_083.84);
  assert.equal(removeAccessory.difference, 1_083.84);
  assert.equal(removeAccessory.exact, false);

  const solvedWithExtraDown = calculateDeal({ ...base, cashDown: 3_613.84 });
  assert.equal(solvedWithExtraDown.amountFinanced, 33_000);
  assert.equal(solvedWithExtraDown.payment, 578.6);
});

test('matrix 11: OTD solver accounts for tax rounding at every candidate cent', () => {
  const solved = solveSalePriceForTarget(
    { salePrice: 30_000, apr: 6, termMonths: 60 },
    { target: 31_000, metric: 'outTheDoor' },
  );

  assert.equal(solved.salePrice, 28_902.04);
  assert.equal(solved.adjustment, 1_097.96);
  assert.equal(solved.deal.salesTax, 1_752.96);
  assert.equal(solved.deal.outTheDoor, 31_000);
  assert.equal(solved.exact, true);

});

test('matrix 12: RATE grid uses total down and independently editable row APRs', () => {
  const grid = calculateRateGrid(
    { salePrice: 30_000, apr: 6, termMonths: 60, cashDown: 777 },
    {
      rows: [
        { termMonths: 60, apr: 6 },
        { termMonths: 72, apr: 7 },
      ],
      downPayments: [0, 1_000, 2_000, 3_000, 5_000],
      customDownPayment: 4_321,
    },
  );

  assert.equal(grid.amountBeforeCashDown, 32_163.84);
  assert.deepEqual(
    grid.rows[0].cells.slice(0, 5).map((cell) => cell.payment),
    [621.82, 602.48, 583.15, 563.82, 525.15],
  );
  assert.deepEqual(
    grid.rows[1].cells.slice(0, 5).map((cell) => cell.payment),
    [548.36, 531.31, 514.26, 497.21, 463.12],
  );
  assert.equal(grid.columns.at(-1).label, 'Custom');
  assert.equal(grid.columns.at(-1).cashDown, 4_321);

  const selected = grid.rows[1].cells[2];
  assert.equal(selected.termMonths, 72);
  assert.equal(selected.apr, 7);
  assert.equal(selected.cashDown, 2_000);
  assert.equal(selected.amountFinanced, 30_163.84);
  assert.equal(selected.payment, 514.26);
});

test('optional products always follow the purchase with no per-item upfront switch', () => {
  const financeWithoutProduct = calculateDeal({
    salePrice: 30_000,
    apr: 6,
    termMonths: 60,
  });
  const financed = calculateDeal({
    salePrice: 30_000,
    apr: 6,
    termMonths: 60,
    optionalItems: [{ amount: 1_000, taxable: false }],
  });
  const cashWithoutProduct = calculateDeal({
    salePrice: 30_000,
    dealType: 'cash',
  });
  const cash = calculateDeal({
    salePrice: 30_000,
    dealType: 'cash',
    optionalItems: [{ amount: 1_000, taxable: false }],
  });

  assert.equal(
    financed.cents.amountFinanced - financeWithoutProduct.cents.amountFinanced,
    toCents(1_000),
  );
  assert.equal(financed.dueAtSigning, financeWithoutProduct.dueAtSigning);
  assert.equal(cash.cents.outTheDoor - cashWithoutProduct.cents.outTheDoor, toCents(1_000));
  assert.equal(cash.cents.dueAtSigning - cashWithoutProduct.cents.dueAtSigning, toCents(1_000));
});

test('cash trade settlement changes cash due, never tax, and retains add-ons', () => {
  const positiveEquity = calculateDeal({
    salePrice: 30_000,
    dealType: 'cash',
    tradeAllowance: 10_000,
    tradePayoff: 0,
    optionalItems: [{ amount: 2_000, taxable: false }],
  });
  const negativeEquity = calculateDeal({
    salePrice: 30_000,
    dealType: 'cash',
    tradeAllowance: 10_000,
    tradePayoff: 14_000,
    optionalItems: [{ amount: 2_000, taxable: false }],
  });

  assert.equal(positiveEquity.outTheDoor, 33_562.84);
  assert.equal(positiveEquity.dueAtSigning, 23_562.84);
  assert.equal(negativeEquity.dueAtSigning, 37_562.84);
  assert.equal(negativeEquity.salesTax, positiveEquity.salesTax);
});

test('excess trade equity becomes a cash customer credit instead of negative due', () => {
  const deal = calculateDeal({
    salePrice: 5_000,
    dealType: 'cash',
    tradeAllowance: 12_000,
    tradePayoff: 0,
  });

  assert.equal(deal.dueAtSigning, 0);
  assert.equal(deal.customerCredit, 6_686);
  assert.equal(deal.balanceAfterTrade, -6_686);
});

test('negative amount financed remains visible while payment is zero with a warning', () => {
  const deal = calculateDeal({ salePrice: 1_000, cashDown: 10_000 });

  assert.ok(deal.amountFinanced < 0);
  assert.equal(deal.payment, 0);
  assert.match(deal.paymentWarning, /Credits exceed/);
  assert.ok(deal.warnings.some((warning) => /Credits exceed/.test(warning)));
});

test('generic cent solver returns the closest attainable cent and calculation result', () => {
  const solution = solveCentValueForTarget({
    target: 5,
    min: 0,
    max: 10,
    evaluate: (candidateCents) => ({
      metricCents: candidateCents * 2,
      result: { candidateCents },
    }),
  });

  assert.equal(solution.value, 2.5);
  assert.equal(solution.metric, 5);
  assert.equal(solution.exact, true);
  assert.deepEqual(solution.result, { candidateCents: 250 });
});

test('view-only state never changes a deal result', () => {
  const input = {
    salePrice: 31_234.56,
    tradeAllowance: 7_500,
    tradePayoff: 2_500,
    cashDown: 1_250,
    apr: 7.25,
    termMonths: 72,
    optionalItems: [{ amount: 900, taxable: false }],
  };
  const dealer = calculateDeal({ ...input, view: 'dealer' });
  const customer = calculateDeal({ ...input, view: 'customer' });

  assert.deepEqual(customer, dealer);
});

test('payment helper uses full precision and validates term and APR', () => {
  const payment = calculatePayment({ principal: 32_163.84, apr: 6, termMonths: 60 });
  assert.equal(paymentFactor(0, 60), 1 / 60);
  assert.equal(payment.payment, 621.82);
  assert.equal(payment.totalOfPayments, 37_309.03);
  assert.throws(
    () => calculatePayment({ principal: 10_000, apr: -1, termMonths: 60 }),
    /Interest rate cannot be negative/,
  );
  assert.throws(
    () => calculatePayment({ principal: 10_000, apr: 5, termMonths: 0 }),
    /positive whole number/,
  );
});

test('APR is normalized once with half-up precision across payment, deal and grid', () => {
  assert.equal(normalizeApr('6.005'), 6.01);
  assert.equal(normalizeApr(6.004), 6);
  assert.equal(normalizeApr(''), 0);
  const input = { salePrice: 30_000, apr: 6.005, termMonths: 72 };
  const deal = calculateDeal(input);
  assert.equal(deal.apr, 6.01);
  assert.equal(deal.monthlyPayment, 533.20);
  assert.equal(calculatePayment({ principal: deal.amountFinanced, apr: '6.005', termMonths: 72 }).payment, 533.20);
  const grid = calculateRateGrid(input, { rows: [72], downPayments: [0], includeCustom: false });
  assert.equal(grid.rows[0].apr, 6.01);
  assert.equal(grid.rows[0].cells[0].payment, 533.20);
});

test('dated trade policy handles every scheduled boundary and flags fee review', () => {
  const expected = [
    ['2026-01-01', 12_000, 1_098.84, true],
    ['2026-12-31', 12_000, 1_098.84, true],
    ['2027-01-01', 13_000, 1_038.84, false],
    ['2027-12-31', 13_000, 1_038.84, false],
    ['2028-01-01', 14_000, 978.84, false],
    ['2028-12-31', 14_000, 978.84, false],
    ['2029-01-01', null, 918.84, false],
    ['2030-01-01', null, 918.84, false],
  ];
  for (const [dealDate, cap, tax, complete] of expected) {
    const deal = calculateDeal({ salePrice: 30_000, tradeAllowance: 15_000, dealDate });
    assert.equal(deal.tradeTaxCreditCap, cap, dealDate);
    assert.equal(deal.salesTax, tax, dealDate);
    assert.equal(deal.isComplete, complete, dealDate);
    assert.equal(deal.policy.dealDate, dealDate);
    assert.equal(deal.policy.reviewRequired, !complete);
  }
  assert.equal(POLICY_CONFIG.sources.length, 3);
  assert.equal(getMichiganPolicy().dealDate, todayDealDate());
  assert.equal(todayDealDate(new Date('2027-01-01T03:00:00Z')), '2026-12-31');
});

test('unsupported dates are qualified and malformed calendar dates are rejected', () => {
  const historical = calculateDeal({ salePrice: 30_000, tradeAllowance: 15_000, dealDate: '2025-12-31' });
  assert.equal(historical.tradeTaxCredit, 0);
  assert.equal(historical.isComplete, false);
  assert.match(historical.warnings[0], /outside the supported/);
  for (const date of ['2026-02-30', '2026-13-01', 'not-a-date', '09/24/2026']) {
    assert.throws(() => getMichiganPolicy(date), /date/);
  }
  assert.equal(getMichiganPolicy('2028-02-29').year, 2028);
});

test('document fee uses a conservative lower cap and reverse pricing follows it', () => {
  const low = calculateDeal({ salePrice: 1_000, apr: 0 });
  assert.equal(low.fees.documentFee, 50);
  assert.equal(low.salesTax, 65.04);
  assert.equal(low.outTheDoor, 1_180.04);
  assert.equal(calculateDeal({ salePrice: 5_599.99 }).fees.documentFee, 279.99);
  assert.equal(calculateDeal({ salePrice: 5_600 }).fees.documentFee, 280);
  assert.equal(calculateDeal({ salePrice: 5_600.01 }).fees.documentFee, 280);
  assert.equal(calculateDeal({ salePrice: 0.01 }).fees.documentFee, 0);
  assert.equal(calculateDeal({ salePrice: 1_000, dealType: 'cash' }).fees.documentFee, 50);
  const solved = solveSalePriceForTarget({ salePrice: 30_000 }, { target: 1_180.04 });
  assert.equal(solved.salePrice, 1_000);
  assert.equal(solved.exact, true);
  assert.equal(solved.deal.fees.documentFee, 50);
});

test('missing new registration fee is incomplete while explicit zero is distinguishable', () => {
  for (const newPlateAmount of [undefined, null, '', ' ']) {
    const deal = calculateDeal({ salePrice: 30_000, plateMode: 'new', newPlateAmount });
    assert.equal(deal.isComplete, false);
    assert.equal(deal.newPlateAmountKnown, false);
    assert.match(deal.incompleteReasons.join(' '), /Registration costs are excluded/);
  }
  const zero = calculateDeal({ salePrice: 30_000, plateMode: 'new', newPlateAmount: 0 });
  const known = calculateDeal({ salePrice: 30_000, plateMode: 'new', newPlateAmount: 250 });
  assert.equal(zero.isComplete, true);
  assert.equal(known.isComplete, true);
  assert.equal(known.cents.outTheDoor - zero.cents.outTheDoor, 25_000);
  assert.equal(calculateDeal().isComplete, false);
});

test('financed versus upfront negative equity produces explicit reconciling amounts', () => {
  const input = { salePrice: 30_000, cashDown: 2_000, tradeAllowance: 10_000, tradePayoff: 14_000 };
  for (const rollNegativeEquity of [true, false]) {
    const deal = calculateDeal({ ...input, rollNegativeEquity });
    assert.equal(deal.cents.amountFinanced,
      deal.cents.outTheDoor - deal.cents.cashDown + deal.cents.financedNegativeEquity);
    assert.equal(deal.cents.dueAtSigning, deal.cents.cashDown + deal.cents.upfrontNegativeEquity);
    assert.equal(deal.financedNegativeEquity, rollNegativeEquity ? 4_000 : 0);
    assert.equal(deal.upfrontNegativeEquity, rollNegativeEquity ? 0 : 4_000);
  }
});

test('invalid and excessive core inputs fail with explicit range errors', () => {
  assert.throws(() => calculateDeal({ salePrice: '30k' }), /Invalid currency/);
  assert.throws(() => calculateDeal({ salePrice: 1_000_001 }), /cannot exceed/);
  assert.throws(() => calculateDeal({ apr: 50.001 }), /Interest rate cannot exceed/);
  assert.throws(() => calculatePayment({ principal: 1_000, termMonths: 121 }), /Term cannot exceed/);
  assert.throws(() => calculatePayment({ principal: 1_000, apr: true }), /number/);
  assert.throws(() => calculateDeal({ optionalItems: Array.from({ length: 51 }, () => ({ amount: 1 })) }), /more than 50/);
  assert.throws(() => toCents('1'.repeat(1_025)), /too long/);
  assert.equal(CALCULATION_LIMITS.maxAmount, 1_000_000);
});

test('zero-interest cents and independent amortization fixtures remain stable', () => {
  const zero = calculatePayment({ principal: 1, apr: 0, termMonths: 72 });
  assert.equal(zero.payment, 0.01);
  assert.equal(zero.totalOfPayments, 1);
  assert.equal(zero.totalInterest, 0);
  assert.equal(calculatePayment({ principal: 0.01, apr: 0, termMonths: 36 }).payment, 0);
  // Independent Decimal PMT fixtures, rounded half-up to cents.
  assert.equal(calculatePayment({ principal: 30_000, apr: 6, termMonths: 60 }).payment, 579.98);
  assert.equal(calculatePayment({ principal: 30_000, apr: 6, termMonths: 72 }).payment, 497.19);
  assert.equal(calculatePayment({ principal: 32_163.84, apr: 6.5, termMonths: 72 }).payment, 540.67);
  const pennyTax = calculateDeal({ salePrice: 10_000.01, tradeAllowance: 9_000 });
  assert.equal(pennyTax.salesTax, 78.84);
});

// ---------- Dealership-configurable document and CRV fees ----------

test('a custom document fee below both caps is used as entered and stays taxable', () => {
  const standard = calculateDeal({ salePrice: 30_000, apr: 6, termMonths: 60 });
  const deal = calculateDeal({ salePrice: 30_000, apr: 6, termMonths: 60, dealershipFees: { documentFee: 199.5, crvFee: 34 } });
  assert.equal(deal.fees.documentFee, 199.5);
  assert.equal(deal.fees.crvFee, 34);
  assert.equal(deal.fees.taxableFixedFees, 233.5);
  assert.equal(deal.fees.totalFees, 264.5);
  assert.equal(deal.taxableTotalBeforeCredit, 30_233.5);
  assert.equal(deal.taxBase, 30_233.5);
  assert.equal(deal.salesTax, 1_814.01);
  assert.equal(deal.outTheDoor, 32_078.51);
  assert.equal(deal.amountFinanced, 32_078.51);
  assert.equal(deal.payment, 620.17);
  // $80.50 less fee and the 6% tax on it.
  assert.equal(standard.cents.outTheDoor - deal.cents.outTheDoor, 8_050 + 483);
});

test('a custom document fee above the 5% cap or the legal maximum is capped', () => {
  const low = calculateDeal({ salePrice: 1_000, apr: 0, dealershipFees: { documentFee: 199, crvFee: 34 } });
  assert.equal(low.fees.documentFee, 50, '5% of $1,000');
  assert.equal(low.salesTax, 65.04);
  assert.equal(low.outTheDoor, 1_180.04);
  const mid = calculateDeal({ salePrice: 3_000, dealershipFees: { documentFee: 199 } });
  assert.equal(mid.fees.documentFee, 150, '5% of $3,000');
  assert.equal(calculateDeal({ salePrice: 3_990, dealershipFees: { documentFee: 199.5 } }).fees.documentFee, 199.5, 'exactly at 5%');
  assert.equal(calculateDeal({ salePrice: 3_989.99, dealershipFees: { documentFee: 199.5 } }).fees.documentFee, 199.49, '5% rounded down to cents');
  // A bad value that slips past the settings still cannot exceed $280.
  for (const documentFee of [280.01, 500, '9999', 1_000_000]) {
    assert.equal(calculateDeal({ salePrice: 30_000, dealershipFees: { documentFee } }).fees.documentFee, 280, String(documentFee));
  }
  assert.equal(calculateDeal({ salePrice: 2_000, dealershipFees: { documentFee: 500 } }).fees.documentFee, 100, 'both caps apply together');
});

test('a zero document fee and a zero CRV fee remove both charges and their tax', () => {
  const deal = calculateDeal({ salePrice: 30_000, apr: 6, termMonths: 60, dealershipFees: { documentFee: 0, crvFee: 0 } });
  assert.equal(deal.fees.documentFee, 0);
  assert.equal(deal.fees.crvFee, 0);
  assert.equal(deal.fees.taxableFixedFees, 0);
  assert.equal(deal.fees.totalFees, 31);
  assert.equal(deal.taxBase, 30_000);
  assert.equal(deal.salesTax, 1_800);
  assert.equal(deal.outTheDoor, 31_831);
  const crvOnly = calculateDeal({ salePrice: 30_000, dealershipFees: { crvFee: 0 } });
  assert.equal(crvOnly.fees.documentFee, 280);
  assert.equal(crvOnly.fees.crvFee, 0);
  assert.equal(crvOnly.taxBase, 30_280);
});

test('a $125.50 CRV fee is charged in cents and taxed at 6%', () => {
  const standard = calculateDeal({ salePrice: 30_000, apr: 6, termMonths: 60 });
  const deal = calculateDeal({ salePrice: 30_000, apr: 6, termMonths: 60, dealershipFees: { documentFee: 280, crvFee: 125.5 } });
  assert.equal(deal.fees.crvFee, 125.5);
  assert.equal(deal.cents.fees.crvFee, 12_550);
  assert.equal(deal.fees.taxableFixedFees, 405.5);
  assert.equal(deal.taxBase, 30_405.5);
  assert.equal(deal.salesTax, 1_824.33);
  assert.equal(deal.outTheDoor, 32_260.83);
  assert.equal(deal.payment, 623.69);
  assert.equal(deal.cents.salesTax - standard.cents.salesTax, 549, '6% of the extra $91.50');
  assert.equal(deal.cents.outTheDoor - standard.cents.outTheDoor, 9_150 + 549);
});

test('the CRV fee is clamped to $0–$999.99 and only charged with a vehicle', () => {
  assert.equal(calculateDeal({ salePrice: 30_000, dealershipFees: { crvFee: 999.99 } }).fees.crvFee, 999.99);
  assert.equal(calculateDeal({ salePrice: 30_000, dealershipFees: { crvFee: 1_000 } }).fees.crvFee, 999.99);
  assert.equal(calculateDeal({ salePrice: 30_000, dealershipFees: { crvFee: 50_000 } }).fees.crvFee, 999.99);
  assert.equal(calculateDeal({ salePrice: 30_000, dealershipFees: { crvFee: -5 } }).fees.crvFee, 0);
  assert.equal(calculateDeal({ salePrice: 30_000, dealershipFees: { documentFee: -5 } }).fees.documentFee, 0);
  const noVehicle = calculateDeal({ dealershipFees: { documentFee: 199, crvFee: 125.5 } });
  assert.equal(noVehicle.fees.documentFee, 0);
  assert.equal(noVehicle.fees.crvFee, 0);
  assert.equal(noVehicle.outTheDoor, 0);
});

test('missing or invalid dealership fees fall back to the defaults', () => {
  const standard = calculateDeal({ salePrice: 30_000 });
  for (const dealershipFees of [undefined, null, {}, 'custom', 42, { documentFee: null, crvFee: null },
    { documentFee: '', crvFee: '' }, { documentFee: 'abc', crvFee: '1..2' }, { documentFee: Number.NaN, crvFee: Number.POSITIVE_INFINITY },
    { documentFee: true, crvFee: {} }]) {
    const deal = calculateDeal({ salePrice: 30_000, dealershipFees });
    assert.deepEqual(deal.cents, standard.cents, JSON.stringify(dealershipFees));
  }
  const partial = calculateDeal({ salePrice: 30_000, dealershipFees: { documentFee: 'abc', crvFee: 50 } });
  assert.equal(partial.fees.documentFee, 280);
  assert.equal(partial.fees.crvFee, 50);
});

test('custom fees flow through cash deals and trade credit', () => {
  const fees = { documentFee: 150, crvFee: 99 };
  const cash = calculateDeal({ dealType: 'cash', salePrice: 20_000, dealershipFees: fees });
  assert.equal(cash.fees.titleFee, 15);
  assert.equal(cash.taxBase, 20_249);
  assert.equal(cash.salesTax, 1_214.94);
  assert.equal(cash.outTheDoor, 21_493.94);
  assert.equal(cash.dueAtSigning, 21_493.94);
  // A large trade credit can absorb the fees' tax entirely.
  const covered = calculateDeal({ dealType: 'cash', salePrice: 10_000, tradeAllowance: 11_000, dealershipFees: fees });
  assert.equal(covered.tradeTaxCredit, 11_000);
  assert.equal(covered.taxableTotalBeforeCredit, 10_249);
  assert.equal(covered.taxBase, 0);
  assert.equal(covered.salesTax, 0);
  assert.equal(covered.tradeTaxDeduction, 10_249);
  assert.equal(covered.tradeTaxSavings, 614.94);
  assert.equal(covered.outTheDoor, 10_279);
  assert.equal(covered.customerCredit, 721);
  // The $12,000 cap leaves the fees taxable on a financed deal.
  const capped = calculateDeal({ salePrice: 40_000, tradeAllowance: 15_000, tradePayoff: 7_000, apr: 6.9, termMonths: 72, dealershipFees: fees });
  assert.equal(capped.tradeTaxCredit, 12_000);
  assert.equal(capped.taxBase, 28_249);
  assert.equal(capped.salesTax, 1_694.94);
  assert.equal(capped.amountFinanced, 33_974.94);
  assert.equal(capped.payment, 577.61);
});

test('the rate grid and target solvers use the dealership fees', () => {
  const fees = { documentFee: 199, crvFee: 125.5 };
  const grid = calculateRateGrid({ salePrice: 30_000, apr: 6.5, termMonths: 72, dealershipFees: fees });
  const deal = calculateDeal({ salePrice: 30_000, apr: 6.5, termMonths: 72, dealershipFees: fees });
  assert.equal(grid.amountBeforeCashDown, deal.amountBeforeCashDown);
  const cell = grid.rows.find((row) => row.termMonths === 72).cells.find((item) => item.cashDown === 0);
  assert.equal(cell.payment, deal.payment);
  assert.notEqual(cell.payment, calculateDeal({ salePrice: 30_000, apr: 6.5, termMonths: 72 }).payment);
  const solved = solveSalePriceForTarget({ salePrice: 30_000, dealershipFees: fees }, { target: deal.outTheDoor });
  assert.equal(solved.salePrice, 30_000);
  assert.equal(solved.exact, true);
  assert.equal(solved.deal.fees.crvFee, 125.5);
});

// Digests of calculateDeal output captured from the implementation before
// dealership fees existed. Without dealershipFees every result stays identical.
const PRE_FEE_SETTINGS_DIGESTS = {
  'blank': [{ dealDate: '2026-09-24' }, '71e04ff261b62817a24e980088a6823a043057113676e6d39ff413ec257cd949'],
  'finance 30k': [{ dealDate: '2026-09-24', salePrice: 30_000, apr: 6, termMonths: 60 }, '7a90bdf32f274989ddbcacccd0cf06e0913f7da2378d56a7c0b3aef3ab120697'],
  'finance with down 0% apr': [{ dealDate: '2026-09-24', salePrice: 25_000, cashDown: 3_000, apr: 0, termMonths: 60 }, '39a7022884d8b4b40a40cb2499edb8aff335ed3fc71edc76a785ee8bd44b2d3d'],
  'trade capped credit': [{ dealDate: '2026-09-24', salePrice: 40_000, tradeAllowance: 15_000, tradePayoff: 7_000, apr: 6.9, termMonths: 72 }, '9c0b2cb1593686adac18dfe0c050b0888954c276826931f9962586cd371decdc'],
  'negative equity upfront': [{ dealDate: '2026-09-24', salePrice: 30_000, cashDown: 2_000, tradeAllowance: 10_000, tradePayoff: 14_000, rollNegativeEquity: false, upfrontAmount: 250 }, '50e03ce7c52399f41c1ac17c38962dbc31ae35cd319f905661adc10aecff6ab2'],
  'cash credit': [{ dealDate: '2026-09-24', dealType: 'cash', salePrice: 30_000, tradeAllowance: 40_000 }, '715292c157f8de00a05852e7f5a79e48e41a6f0aa9794c7eba266b23eb1b01c3'],
  'cash low price': [{ dealDate: '2026-09-24', dealType: 'cash', salePrice: 1_000 }, '207355bf87de773aaf7e4521ff6add466e3fea33318e9df69b278d75eb2daecb'],
  'penny price': [{ dealDate: '2026-09-24', salePrice: 0.01 }, '76e9a40b7eada7c004275cf508b5a82b74917315406e076649069f141095c63d'],
  'doc fee boundary': [{ dealDate: '2026-09-24', salePrice: 5_599.99 }, 'b644f040936ff5863795eccbdc41ac3fc3169506e98c3adb134d3860dbd0d968'],
  'products and new plate': [{ dealDate: '2026-09-24', salePrice: 32_500, plateMode: 'new', newPlateAmount: 185, apr: 7.25, termMonths: 84,
    optionalItems: [{ id: 'a', category: 'service-contract', name: 'Service Contract', amount: 1_995, taxable: false }, { id: 'b', category: 'other', name: 'Tint', amount: 399.99, taxable: true }] },
  '22526a679eb1aef61dcfd4ea6abafd43c4910494677af8a2b09d44c45a5c6a02'],
  '2027 review': [{ dealDate: '2027-03-01', salePrice: 30_000, tradeAllowance: 15_000 }, 'a2feee107e5514d9522dbbe6d3c14b03329780b31385aba18229cb19fc245238'],
  'trade without vehicle': [{ dealDate: '2026-09-24', tradeAllowance: 8_000, tradePayoff: 2_500 }, 'f0362c03869d13000627eb0de37cd2a4bbfb885e1717ab76aaf6866c5a0c0164'],
};

test('default-fee regression cases retain their financial results apart from clarified rate wording', () => {
  const digest = (value) => {
    const historicWording = structuredClone(value);
    historicWording.policy.assumptions = historicWording.policy.assumptions.map(text => text.replace(
      'Payments assume equal monthly periods and a two-decimal annual interest rate. Lender APR, credit-specific charges, timing, eligibility and final contract figures require separate verification.',
      'Payments assume equal monthly periods and a two-decimal annual rate. Lender timing, fees, eligibility and final contract figures require separate verification.',
    ));
    return createHash('sha256').update(JSON.stringify(historicWording)).digest('hex');
  };
  for (const [name, [input, expected]] of Object.entries(PRE_FEE_SETTINGS_DIGESTS)) {
    const plain = calculateUndatedDeal(input);
    assert.equal(digest(plain), expected, name);
    for (const dealershipFees of [{ documentFee: 280, crvFee: 34 }, { documentFee: '280.00', crvFee: '34' }, {}, null]) {
      assert.equal(JSON.stringify(calculateUndatedDeal({ ...input, dealershipFees })), JSON.stringify(plain), `${name} with ${JSON.stringify(dealershipFees)}`);
    }
  }
});
