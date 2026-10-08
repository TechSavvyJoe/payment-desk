import { getMichiganPolicy, POLICY_CONFIG } from './policy.js';
import { CRV_FEE_MAXIMUM } from './feeSettings.js';
import { assertSupportedPurchase } from './purchaseScope.js';

const CENTS_PER_DOLLAR = 100;

// Technical input boundaries, not lender approvals or market-rate guidance.
export const CALCULATION_LIMITS = Object.freeze({
  maxAmount: 1_000_000,
  maxApr: 50,
  maxTermMonths: 120,
  maxOptionalItems: 50,
});

export const CALCULATION_DEFAULTS = Object.freeze({
  salesTaxRate: POLICY_CONFIG.salesTaxRate,
  tradeTaxCreditCap: 12_000,
  ...POLICY_CONFIG.feeDefaults,
});

export const RATE_GRID_DEFAULTS = Object.freeze({
  termMonths: Object.freeze([36, 48, 60, 72, 84]),
  downPayments: Object.freeze([0, 1_000, 2_000, 3_000, 5_000]),
});

const DEFAULT_CENTS = Object.freeze(Object.fromEntries(
  Object.entries(POLICY_CONFIG.feeDefaults).map(([name, dollars]) => [name, dollars * CENTS_PER_DOLLAR]),
));

/**
 * Convert a currency value into integer cents without relying on binary
 * floating-point multiplication for the rounding step.
 */
export function toCents(value) {
  if (value === undefined || value === null || value === '') return 0;

  let source;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Currency values must be finite numbers.');
    }
    source = String(value);
  } else if (typeof value === 'string') {
    source = value.replace(/[$,\s]/g, '');
    if (source === '') return 0;
  } else {
    throw new TypeError('Currency values must be numbers or numeric strings.');
  }
  if (source.length > 1_024) throw new RangeError('Currency input is too long.');

  const match = source.match(
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/,
  );
  if (!match) throw new TypeError(`Invalid currency value: ${String(value)}`);

  const sign = match[1] === '-' ? -1 : 1;
  const integerPart = match[2] ?? '';
  const fractionalPart = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    throw new RangeError('Currency exponent is outside the supported range.');
  }

  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, '') || '0';
  const coefficient = BigInt(digits);
  const power = 2 + exponent - fractionalPart.length;

  let absoluteCents;
  if (power >= 0) {
    absoluteCents = coefficient * 10n ** BigInt(power);
  } else {
    const divisor = 10n ** BigInt(-power);
    const quotient = coefficient / divisor;
    const remainder = coefficient % divisor;
    absoluteCents = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }

  const signedCents = sign < 0 ? -absoluteCents : absoluteCents;
  const result = Number(signedCents);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Currency value is too large to represent safely.');
  }
  return Object.is(result, -0) ? 0 : result;
}

export function fromCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError('Cents must be a safe integer.');
  }
  const value = cents / CENTS_PER_DOLLAR;
  return Object.is(value, -0) ? 0 : value;
}

function nonNegativeCents(value, name) {
  const cents = toCents(value);
  if (cents < 0) throw new RangeError(`${name} cannot be negative.`);
  if (cents > CALCULATION_LIMITS.maxAmount * CENTS_PER_DOLLAR) {
    throw new RangeError(`${name} cannot exceed $${CALCULATION_LIMITS.maxAmount.toLocaleString('en-US')}.`);
  }
  return cents;
}

function finiteNumber(value, name, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError(`${name} must be a number or numeric string.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`${name} must be a finite number.`);
  return result;
}

export function normalizeApr(value) {
  const apr = finiteNumber(value, 'Interest rate');
  if (apr < 0) throw new RangeError('Interest rate cannot be negative.');
  if (apr > CALCULATION_LIMITS.maxApr) throw new RangeError(`Interest rate cannot exceed ${CALCULATION_LIMITS.maxApr}%.`);
  return fromCents(toCents(apr));
}

function normalizeTerm(value) {
  const termMonths = finiteNumber(value, 'Term', 60);
  if (!Number.isInteger(termMonths) || termMonths <= 0) {
    throw new RangeError('Term must be a positive whole number of months.');
  }
  if (termMonths > CALCULATION_LIMITS.maxTermMonths) {
    throw new RangeError(`Term cannot exceed ${CALCULATION_LIMITS.maxTermMonths} months.`);
  }
  return termMonths;
}

// Exact cents-per-principal-cent ratio for the normalized hundredth-percent
// annual rate. Compute powers once per inverse solve, not for each candidate.
function paymentRatio(rateBasisPoints, termMonths) {
  if (rateBasisPoints === 0) return { numerator: 1n, denominator: BigInt(termMonths) };
  const q = 120_000n;
  const b = BigInt(rateBasisPoints);
  const growth = (q + b) ** BigInt(termMonths);
  return { numerator: b * growth, denominator: q * (growth - q ** BigInt(termMonths)) };
}

function roundPaymentRatio(numerator, denominator) {
  const cents = Number((2n * numerator + denominator) / (2n * denominator));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('Calculated currency value is outside the supported range.');
  }
  return cents;
}

function roundRatio(numerator, denominator) {
  const numeratorBigInt = BigInt(numerator);
  const denominatorBigInt = BigInt(denominator);
  return Number((numeratorBigInt + denominatorBigInt / 2n) / denominatorBigInt);
}

export function paymentFactor(apr, termMonths) {
  const normalizedApr = normalizeApr(apr);
  const normalizedTerm = normalizeTerm(termMonths);
  if (normalizedApr === 0) return 1 / normalizedTerm;

  const monthlyRate = normalizedApr / 1_200;
  const growthMinusOne = Math.expm1(normalizedTerm * Math.log1p(monthlyRate));
  return (monthlyRate * (growthMinusOne + 1)) / growthMinusOne;
}

/**
 * Calculate an amortized payment. `principal` is in dollars; all displayed
 * monetary outputs are rounded to cents. At 0% interest, total interest is exactly 0.
 */
export function calculatePayment({ principal, amountFinanced, apr = 0, termMonths = 60 }) {
  const principalCents = toCents(principal ?? amountFinanced ?? 0);
  if (Math.abs(principalCents) > CALCULATION_LIMITS.maxAmount * CALCULATION_LIMITS.maxTermMonths * CENTS_PER_DOLLAR) {
    throw new RangeError('Principal is outside the supported calculation range.');
  }
  const normalizedApr = normalizeApr(apr);
  const normalizedTerm = normalizeTerm(termMonths);
  const factor = paymentFactor(normalizedApr, normalizedTerm);

  if (principalCents <= 0) {
    const warning =
      principalCents < 0
        ? 'Credits exceed the balance. Reduce credits or move money out of the deal.'
        : null;
    return {
      principal: fromCents(principalCents),
      amountFinanced: fromCents(principalCents),
      apr: normalizedApr,
      termMonths: normalizedTerm,
      factor,
      rawPayment: 0,
      monthlyPayment: 0,
      payment: 0,
      totalOfPayments: 0,
      totalInterest: 0,
      warning,
      cents: {
        principal: principalCents,
        amountFinanced: principalCents,
        monthlyPayment: 0,
        payment: 0,
        totalOfPayments: 0,
        totalInterest: 0,
      },
    };
  }

  const rawMonthlyCents = principalCents * factor;
  const ratio = paymentRatio(toCents(normalizedApr), normalizedTerm);
  const paymentNumerator = BigInt(principalCents) * ratio.numerator;
  const monthlyPaymentCents = roundPaymentRatio(paymentNumerator, ratio.denominator);
  const totalOfPaymentsCents =
    normalizedApr === 0
      ? principalCents
      : roundPaymentRatio(paymentNumerator * BigInt(normalizedTerm), ratio.denominator);
  const totalInterestCents =
    normalizedApr === 0 ? 0 : totalOfPaymentsCents - principalCents;

  return {
    principal: fromCents(principalCents),
    amountFinanced: fromCents(principalCents),
    apr: normalizedApr,
    termMonths: normalizedTerm,
    factor,
    rawPayment: rawMonthlyCents / CENTS_PER_DOLLAR,
    monthlyPayment: fromCents(monthlyPaymentCents),
    payment: fromCents(monthlyPaymentCents),
    totalOfPayments: fromCents(totalOfPaymentsCents),
    totalInterest: fromCents(totalInterestCents),
    warning: null,
    cents: {
      principal: principalCents,
      amountFinanced: principalCents,
      monthlyPayment: monthlyPaymentCents,
      payment: monthlyPaymentCents,
      totalOfPayments: totalOfPaymentsCents,
      totalInterest: totalInterestCents,
    },
  };
}

function normalizeDealType(value) {
  const dealType = String(value ?? 'finance').trim().toLowerCase();
  if (dealType === 'finance' || dealType === 'financed') return 'finance';
  if (dealType === 'cash') return 'cash';
  throw new RangeError(`Unsupported deal type: ${String(value)}`);
}

function normalizePlateMode(value) {
  const plateMode = String(value ?? 'transfer')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (plateMode === 'transfer') return 'transfer';
  if (plateMode === 'new' || plateMode === 'newplate') return 'new';
  throw new RangeError(`Unsupported plate mode: ${String(value)}`);
}

function normalizeOptionalItems(items) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw new TypeError('optionalItems must be an array.');
  if (items.length > CALCULATION_LIMITS.maxOptionalItems) {
    throw new RangeError(`A deal cannot have more than ${CALCULATION_LIMITS.maxOptionalItems} optional items.`);
  }

  return items.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new TypeError(`Optional item ${index + 1} must be an object.`);
    }
    const amountCents = nonNegativeCents(item.amount ?? 0, `Optional item ${index + 1}`);
    return {
      id: item.id ?? `optional-${index + 1}`,
      name: String(item.name ?? `Optional item ${index + 1}`),
      ...(item.category === undefined ? {} : { category: String(item.category) }),
      amount: fromCents(amountCents),
      amountCents,
      taxable: item.taxable === true,
    };
  });
}

// The dealership's own document and CRV fees, in dollars. Missing or unreadable
// values use the policy default; readable values are clamped to [0, maximum].
function dealershipFeeCents(value, defaultCents, maximumCents) {
  if (value === undefined || value === null || value === '') return defaultCents;
  let cents;
  try {
    cents = toCents(value);
  } catch {
    return defaultCents;
  }
  return Math.min(Math.max(cents, 0), maximumCents);
}

function normalizeDealershipFees(fees, policy) {
  const source = fees && typeof fees === 'object' ? fees : {};
  const documentFeeMaximumCents = toCents(policy.documentFeeMaximum);
  return {
    documentFeeCents: dealershipFeeCents(source.documentFee, DEFAULT_CENTS.documentFee, documentFeeMaximumCents),
    crvFeeCents: dealershipFeeCents(source.crvFee, DEFAULT_CENTS.crvFee, toCents(CRV_FEE_MAXIMUM)),
  };
}

function dollarsForCentsObject(centsObject) {
  return Object.fromEntries(
    Object.entries(centsObject).map(([key, value]) => [key, fromCents(value)]),
  );
}

/**
 * Calculate the complete Michigan deal. Monetary inputs and top-level outputs
 * are dollars. `result.cents` mirrors every computed money value as exact cents.
 */
export function calculateDeal(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Deal input must be an object.');
  }
  assertSupportedPurchase(input);
  const policy = getMichiganPolicy(input.dealDate);

  const salePriceCents = nonNegativeCents(
    input.salePrice ?? input.sellingPrice ?? 0,
    'Sale price',
  );
  const tradeAllowanceCents = nonNegativeCents(input.tradeAllowance ?? 0, 'Trade allowance');
  const tradePayoffCents = nonNegativeCents(input.tradePayoff ?? 0, 'Trade payoff');
  const cashDownCents = nonNegativeCents(input.cashDown ?? input.downPayment ?? 0, 'Cash down');
  const additionalUpfrontCents = nonNegativeCents(
    input.upfrontAmount ?? 0,
    'Upfront amount',
  );
  const newPlateInput = input.newPlateAmount ?? input.newPlateFee;
  const newPlateAmountKnown = newPlateInput !== undefined && newPlateInput !== null && String(newPlateInput).trim() !== '';
  const newPlateAmountCents = nonNegativeCents(
    newPlateInput ?? 0,
    'New plate amount',
  );
  const apr = normalizeApr(input.apr ?? 0);
  const termMonths = normalizeTerm(input.termMonths ?? input.term ?? 60);
  const dealType = normalizeDealType(input.dealType ?? input.purchaseType ?? 'finance');
  const plateMode = normalizePlateMode(input.plateMode ?? 'transfer');
  const rollNegativeEquity = input.rollNegativeEquity !== false;
  const optionalItems = normalizeOptionalItems(input.optionalItems);

  const taxableOptionsCents = optionalItems
    .filter((item) => item.taxable)
    .reduce((total, item) => total + item.amountCents, 0);
  const nonTaxableOptionsCents = optionalItems
    .filter((item) => !item.taxable)
    .reduce((total, item) => total + item.amountCents, 0);
  const optionalItemsTotalCents = taxableOptionsCents + nonTaxableOptionsCents;
  // Products and add-ons always follow the purchase: financed on loan deals,
  // included in the cash total on cash deals. Per-item roll/upfront switches
  // are intentionally not supported.
  const upfrontOptionalItemsCents = 0;
  const upfrontAmountCents = additionalUpfrontCents + upfrontOptionalItemsCents;

  const isFinanced = dealType === 'finance';
  const hasVehicle = salePriceCents > 0;
  const dealershipFees = normalizeDealershipFees(input.dealershipFees, policy);
  // The dealership's fee never overrides the legal maximum or the 5% cap.
  // Selling price is a conservative base, not a claim about the complete
  // statutory contract cash-price definition. Floor prevents exceeding 5%.
  const documentFeeCents = hasVehicle
    ? Math.min(dealershipFees.documentFeeCents, toCents(policy.documentFeeMaximum),
      Number(BigInt(salePriceCents) * BigInt(policy.documentFeeSalePricePercent) / 100n))
    : 0;
  const crvFeeCents = hasVehicle ? dealershipFees.crvFeeCents : 0;
  const taxableFixedFeesCents = documentFeeCents + crvFeeCents;
  const plateTransferFeeCents = hasVehicle && plateMode === 'transfer' ? DEFAULT_CENTS.plateTransferFee : 0;
  const additionalTransferFeeCents =
    hasVehicle && plateMode === 'transfer' ? DEFAULT_CENTS.additionalTransferFee : 0;
  const titleFeeCents = hasVehicle
    ? (isFinanced ? DEFAULT_CENTS.financeTitleFee : DEFAULT_CENTS.cashTitleFee)
    : 0;
  const appliedNewPlateAmountCents = hasVehicle && plateMode === 'new' ? newPlateAmountCents : 0;
  const plateFeesCents =
    plateTransferFeeCents +
    additionalTransferFeeCents +
    titleFeeCents +
    appliedNewPlateAmountCents;
  const totalFeesCents = taxableFixedFeesCents + plateFeesCents;

  const tradeTaxCreditCents = Math.min(
    tradeAllowanceCents,
    policy.tradeTaxCreditCap === null ? Infinity : toCents(policy.tradeTaxCreditCap),
  );
  const tradeEquityCents = tradeAllowanceCents - tradePayoffCents;
  const positiveEquityCents = Math.max(tradeEquityCents, 0);
  const negativeEquityCents = Math.max(-tradeEquityCents, 0);
  const taxableTotalBeforeCreditCents =
    salePriceCents + taxableFixedFeesCents + taxableOptionsCents;
  const taxBaseCents = Math.max(0, taxableTotalBeforeCreditCents - tradeTaxCreditCents);
  const salesTaxCents = roundRatio(BigInt(taxBaseCents) * BigInt(policy.salesTaxBasisPoints), 10_000);
  const tradeTaxDeductionCents = taxableTotalBeforeCreditCents - taxBaseCents;
  const tradeTaxSavingsCents = roundRatio(BigInt(taxableTotalBeforeCreditCents) * BigInt(policy.salesTaxBasisPoints), 10_000) - salesTaxCents;

  const outTheDoorCents =
    salePriceCents +
    totalFeesCents +
    optionalItemsTotalCents +
    salesTaxCents;
  const balanceAfterTradeCents = outTheDoorCents - tradeEquityCents;
  const customerCreditCents = Math.max(-balanceAfterTradeCents, 0);

  let amountBeforeCashDownCents;
  let amountFinancedCents;
  let dueAtSigningCents;
  if (isFinanced) {
    amountBeforeCashDownCents =
      outTheDoorCents -
      upfrontAmountCents -
      positiveEquityCents +
      (rollNegativeEquity ? negativeEquityCents : 0);
    amountFinancedCents = amountBeforeCashDownCents - cashDownCents;
    dueAtSigningCents =
      cashDownCents +
      upfrontAmountCents +
      (rollNegativeEquity ? 0 : negativeEquityCents);
  } else {
    amountBeforeCashDownCents = 0;
    amountFinancedCents = 0;
    dueAtSigningCents = Math.max(balanceAfterTradeCents, 0);
  }

  const paymentResult = calculatePayment({
    principal: fromCents(amountFinancedCents),
    apr,
    termMonths,
  });

  const warnings = [...policy.warnings];
  const incompleteReasons = [...policy.warnings];
  if (!hasVehicle) incompleteReasons.push('Enter a selling price to complete this estimate.');
  if (plateMode === 'new' && !newPlateAmountKnown) {
    const reason = 'New plate cost has not been entered. Registration costs are excluded from this incomplete estimate.';
    incompleteReasons.push(reason);
    if (hasVehicle) warnings.push(reason);
  }
  if (isFinanced && amountFinancedCents < 0) {
    warnings.push('Credits exceed the balance. Reduce cash down or trade equity.');
  }
  if (!hasVehicle && (tradeAllowanceCents > 0 || tradePayoffCents > 0 || optionalItemsTotalCents > 0)) {
    warnings.push('Enter a selling price to include fees and tax in this estimate.');
  }

  const feeCents = {
    documentFee: documentFeeCents,
    crvFee: crvFeeCents,
    taxableFixedFees: taxableFixedFeesCents,
    plateTransferFee: plateTransferFeeCents,
    additionalTransferFee: additionalTransferFeeCents,
    titleFee: titleFeeCents,
    newPlateAmount: appliedNewPlateAmountCents,
    plateFees: plateFeesCents,
    totalFees: totalFeesCents,
  };

  const cents = {
    salePrice: salePriceCents,
    tradeAllowance: tradeAllowanceCents,
    tradePayoff: tradePayoffCents,
    tradeTaxCredit: tradeTaxCreditCents,
    tradeTaxDeduction: tradeTaxDeductionCents,
    tradeTaxSavings: tradeTaxSavingsCents,
    tradeEquity: tradeEquityCents,
    positiveEquity: positiveEquityCents,
    negativeEquity: negativeEquityCents,
    financedNegativeEquity: isFinanced && rollNegativeEquity ? negativeEquityCents : 0,
    upfrontNegativeEquity: isFinanced && !rollNegativeEquity ? negativeEquityCents : 0,
    cashDown: cashDownCents,
    taxableOptions: taxableOptionsCents,
    nonTaxableOptions: nonTaxableOptionsCents,
    optionalItemsTotal: optionalItemsTotalCents,
    additionalUpfrontAmount: additionalUpfrontCents,
    upfrontOptionalItems: upfrontOptionalItemsCents,
    upfrontAmount: upfrontAmountCents,
    taxableTotalBeforeCredit: taxableTotalBeforeCreditCents,
    taxBase: taxBaseCents,
    salesTax: salesTaxCents,
    outTheDoor: outTheDoorCents,
    balanceAfterTrade: balanceAfterTradeCents,
    customerCredit: customerCreditCents,
    amountBeforeCashDown: amountBeforeCashDownCents,
    amountFinanced: amountFinancedCents,
    dueAtSigning: dueAtSigningCents,
    monthlyPayment: paymentResult.cents.monthlyPayment,
    payment: paymentResult.cents.payment,
    totalOfPayments: paymentResult.cents.totalOfPayments,
    totalInterest: paymentResult.cents.totalInterest,
    fees: feeCents,
  };

  return {
    dealDate: policy.dealDate,
    policy,
    isComplete: incompleteReasons.length === 0,
    incompleteReasons,
    newPlateAmountKnown,
    dealType,
    plateMode,
    isFinanced,
    rollNegativeEquity,
    salesTaxRate: policy.salesTaxRate,
    tradeTaxCreditCap: policy.tradeTaxCreditCap,
    salePrice: fromCents(salePriceCents),
    tradeAllowance: fromCents(tradeAllowanceCents),
    tradePayoff: fromCents(tradePayoffCents),
    tradeTaxCredit: fromCents(tradeTaxCreditCents),
    tradeEquity: fromCents(tradeEquityCents),
    positiveEquity: fromCents(positiveEquityCents),
    negativeEquity: fromCents(negativeEquityCents),
    financedNegativeEquity: fromCents(cents.financedNegativeEquity),
    upfrontNegativeEquity: fromCents(cents.upfrontNegativeEquity),
    cashDown: fromCents(cashDownCents),
    optionalItems: optionalItems.map(({ amountCents: _amountCents, ...item }) => item),
    taxableOptions: fromCents(taxableOptionsCents),
    nonTaxableOptions: fromCents(nonTaxableOptionsCents),
    optionalItemsTotal: fromCents(optionalItemsTotalCents),
    additionalUpfrontAmount: fromCents(additionalUpfrontCents),
    upfrontOptionalItems: fromCents(upfrontOptionalItemsCents),
    upfrontAmount: fromCents(upfrontAmountCents),
    fees: dollarsForCentsObject(feeCents),
    taxableTotalBeforeCredit: fromCents(taxableTotalBeforeCreditCents),
    tradeTaxDeduction: fromCents(tradeTaxDeductionCents),
    tradeTaxSavings: fromCents(tradeTaxSavingsCents),
    taxBase: fromCents(taxBaseCents),
    salesTax: fromCents(salesTaxCents),
    outTheDoor: fromCents(outTheDoorCents),
    balanceAfterTrade: fromCents(balanceAfterTradeCents),
    customerCredit: fromCents(customerCreditCents),
    amountBeforeCashDown: fromCents(amountBeforeCashDownCents),
    amountFinanced: fromCents(amountFinancedCents),
    dueAtSigning: fromCents(dueAtSigningCents),
    apr,
    termMonths,
    monthlyPayment: paymentResult.monthlyPayment,
    payment: paymentResult.payment,
    totalOfPayments: paymentResult.totalOfPayments,
    totalInterest: paymentResult.totalInterest,
    paymentWarning: paymentResult.warning,
    warnings,
    cents,
  };
}

function normalizeRateRows(dealInput, options) {
  const baseApr = normalizeApr(dealInput.apr ?? 0);
  const aprByTerm = options.aprByTerm ?? {};
  const configuredRows = options.rows ?? RATE_GRID_DEFAULTS.termMonths;
  if (!Array.isArray(configuredRows) || configuredRows.length === 0) {
    throw new TypeError('RATE grid rows must be a non-empty array.');
  }

  return configuredRows.map((row) => {
    const termMonths = normalizeTerm(
      typeof row === 'object' && row !== null ? row.termMonths ?? row.term : row,
    );
    const rowApr =
      typeof row === 'object' && row !== null && row.apr !== undefined
        ? row.apr
        : aprByTerm[termMonths] ?? baseApr;
    return { termMonths, apr: normalizeApr(rowApr) };
  });
}

/**
 * Build the desktop/mobile RATE grid. Each column is total cash down, never
 * additional down. The Custom column defaults to the deal's current cash down.
 */
export function calculateRateGrid(dealInput = {}, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('RATE grid options must be an object.');
  }

  const baseDeal = calculateDeal({ ...dealInput, dealType: 'finance', cashDown: 0 });
  const rows = normalizeRateRows(dealInput, options);
  const standardDownPayments = options.downPayments ?? RATE_GRID_DEFAULTS.downPayments;
  if (!Array.isArray(standardDownPayments)) {
    throw new TypeError('RATE grid down payments must be an array.');
  }

  const columns = standardDownPayments.map((cashDown, index) => {
    const cashDownCents = nonNegativeCents(cashDown, `Down-payment column ${index + 1}`);
    return {
      key: `down-${index}-${cashDownCents}`,
      label: fromCents(cashDownCents),
      cashDown: fromCents(cashDownCents),
      custom: false,
      cents: { cashDown: cashDownCents },
    };
  });

  if (options.includeCustom !== false) {
    const customDownCents = nonNegativeCents(
      options.customDownPayment ?? dealInput.cashDown ?? dealInput.downPayment ?? 0,
      'Custom down payment',
    );
    columns.push({
      key: 'custom',
      label: 'Custom',
      cashDown: fromCents(customDownCents),
      custom: true,
      cents: { cashDown: customDownCents },
    });
  }

  const calculatedRows = rows.map((row) => ({
    ...row,
    cells: columns.map((column) => {
      const amountFinancedCents =
        baseDeal.cents.amountBeforeCashDown - column.cents.cashDown;
      const paymentResult = calculatePayment({
        principal: fromCents(amountFinancedCents),
        apr: row.apr,
        termMonths: row.termMonths,
      });
      return {
        key: `${row.termMonths}-${column.key}`,
        termMonths: row.termMonths,
        apr: row.apr,
        cashDown: column.cashDown,
        amountFinanced: fromCents(amountFinancedCents),
        monthlyPayment: paymentResult.monthlyPayment,
        payment: paymentResult.payment,
        warning: paymentResult.warning,
        cents: {
          cashDown: column.cents.cashDown,
          amountFinanced: amountFinancedCents,
          monthlyPayment: paymentResult.cents.monthlyPayment,
          payment: paymentResult.cents.payment,
        },
      };
    }),
  }));

  return {
    amountBeforeCashDown: baseDeal.amountBeforeCashDown,
    columns,
    rows: calculatedRows,
    cents: { amountBeforeCashDown: baseDeal.cents.amountBeforeCashDown },
  };
}

/**
 * Find the cent principal closest to the analytical principal whose displayed
 * monthly payment matches the requested cent when possible.
 */
export function solveAmountFinancedForPayment({ targetPayment, apr = 0, termMonths = 60 }) {
  const targetPaymentCents = nonNegativeCents(targetPayment, 'Target payment');
  const normalizedApr = normalizeApr(apr);
  const normalizedTerm = normalizeTerm(termMonths);
  const factor = paymentFactor(normalizedApr, normalizedTerm);
  const ratio = paymentRatio(toCents(normalizedApr), normalizedTerm);
  const targetPrincipalNumerator = BigInt(targetPaymentCents) * ratio.denominator;
  const analyticalPrincipalCents = targetPaymentCents / factor;
  const center = Math.max(0, Math.round(analyticalPrincipalCents));
  const radius = Math.max(100, Math.min(100_000, Math.ceil(2 / factor) + 10));
  const minimum = Math.max(0, center - radius);
  const maximum = center + radius;

  let best = null;
  for (let principalCents = minimum; principalCents <= maximum; principalCents += 1) {
    const principalNumerator = BigInt(principalCents) * ratio.numerator;
    const displayedPaymentCents = roundPaymentRatio(principalNumerator, ratio.denominator);
    const principalDifference = principalNumerator - targetPrincipalNumerator;
    const paymentDifferenceCents = displayedPaymentCents - targetPaymentCents;
    const candidate = {
      principalCents,
      displayedPaymentCents,
      paymentDifferenceCents,
      paymentDistance: Math.abs(paymentDifferenceCents),
      principalDistance: principalDifference < 0n ? -principalDifference : principalDifference,
    };
    if (
      best === null ||
      candidate.paymentDistance < best.paymentDistance ||
      (candidate.paymentDistance === best.paymentDistance &&
        candidate.principalDistance < best.principalDistance) ||
      (candidate.paymentDistance === best.paymentDistance &&
        candidate.principalDistance === best.principalDistance &&
        candidate.principalCents < best.principalCents)
    ) {
      best = candidate;
    }
  }

  return {
    targetPayment: fromCents(targetPaymentCents),
    apr: normalizedApr,
    termMonths: normalizedTerm,
    analyticalAmountFinanced: analyticalPrincipalCents / CENTS_PER_DOLLAR,
    amountFinanced: fromCents(best.principalCents),
    payment: fromCents(best.displayedPaymentCents),
    monthlyPayment: fromCents(best.displayedPaymentCents),
    difference: fromCents(best.paymentDifferenceCents),
    exact: best.paymentDifferenceCents === 0,
    cents: {
      targetPayment: targetPaymentCents,
      amountFinanced: best.principalCents,
      payment: best.displayedPaymentCents,
      monthlyPayment: best.displayedPaymentCents,
      difference: best.paymentDifferenceCents,
    },
  };
}

function unpackMetricEvaluation(evaluation) {
  if (Number.isSafeInteger(evaluation)) {
    return { metricCents: evaluation, result: evaluation };
  }
  if (
    evaluation &&
    typeof evaluation === 'object' &&
    Number.isSafeInteger(evaluation.metricCents)
  ) {
    return { metricCents: evaluation.metricCents, result: evaluation.result ?? evaluation };
  }
  throw new TypeError('evaluate must return integer metric cents or { metricCents, result }.');
}

/**
 * Binary-search a monotonic deal input in one-cent increments. target/min/max
 * are dollar values; evaluate receives candidate cents and returns metric cents.
 */
export function solveCentValueForTarget({
  target,
  min = 0,
  max,
  evaluate,
  direction = 'increasing',
}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate must be a function.');
  if (direction !== 'increasing' && direction !== 'decreasing') {
    throw new RangeError("direction must be 'increasing' or 'decreasing'.");
  }

  const targetCents = toCents(target);
  const minCents = toCents(min);
  const maxCents = toCents(max);
  if (minCents > maxCents) throw new RangeError('min cannot exceed max.');
  const multiplier = direction === 'increasing' ? 1 : -1;
  const comparableTarget = targetCents * multiplier;
  const cache = new Map();
  const evaluateAt = (candidateCents) => {
    if (!cache.has(candidateCents)) {
      cache.set(candidateCents, unpackMetricEvaluation(evaluate(candidateCents)));
    }
    return cache.get(candidateCents);
  };

  let low = minCents;
  let high = maxCents;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const comparableMetric = evaluateAt(middle).metricCents * multiplier;
    if (comparableMetric < comparableTarget) low = middle + 1;
    else high = middle;
  }

  const candidateCents = new Set([minCents, maxCents, low]);
  if (low > minCents) candidateCents.add(low - 1);
  if (low < maxCents) candidateCents.add(low + 1);

  let best = null;
  for (const valueCents of candidateCents) {
    const evaluation = evaluateAt(valueCents);
    const differenceCents = evaluation.metricCents - targetCents;
    const candidate = {
      valueCents,
      metricCents: evaluation.metricCents,
      differenceCents,
      distance: Math.abs(differenceCents),
      result: evaluation.result,
    };
    if (
      best === null ||
      candidate.distance < best.distance ||
      (candidate.distance === best.distance && candidate.valueCents < best.valueCents)
    ) {
      best = candidate;
    }
  }

  // The neighbor below a target can be the *last* cent of its plateau.
  // Return the first cent attaining the winning metric for the lower-value tie.
  low = minCents;
  high = best.valueCents;
  const winningMetric = best.metricCents * multiplier;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (evaluateAt(middle).metricCents * multiplier < winningMetric) low = middle + 1;
    else high = middle;
  }
  best.valueCents = low;
  best.result = evaluateAt(low).result;

  return {
    value: fromCents(best.valueCents),
    metric: fromCents(best.metricCents),
    target: fromCents(targetCents),
    difference: fromCents(best.differenceCents),
    exact: best.differenceCents === 0,
    result: best.result,
    cents: {
      value: best.valueCents,
      metric: best.metricCents,
      target: targetCents,
      difference: best.differenceCents,
    },
  };
}

function metricCentsFromDeal(deal, metric) {
  const aliases = {
    otd: 'outTheDoor',
    payment: 'monthlyPayment',
  };
  const normalizedMetric = aliases[metric] ?? metric;
  const metricCents = deal.cents[normalizedMetric];
  if (!Number.isSafeInteger(metricCents)) {
    throw new RangeError(`Unsupported deal metric: ${String(metric)}`);
  }
  return metricCents;
}

function upperBoundForMonotonicDealValue({ currentValueCents, targetCents, evaluate }) {
  let upperCents = Math.max(0, currentValueCents);
  if (evaluate(upperCents).metricCents >= targetCents) return upperCents;

  upperCents = Math.max(100_000, upperCents);
  const maximumSupportedCents = CALCULATION_LIMITS.maxAmount * CENTS_PER_DOLLAR;
  while (evaluate(upperCents).metricCents < targetCents) {
    if (upperCents >= maximumSupportedCents) {
      throw new RangeError('Target is outside the supported solver range.');
    }
    upperCents = Math.min(maximumSupportedCents, upperCents * 2 + 100);
  }
  return upperCents;
}

export function solveSalePriceForTarget(
  dealInput,
  { target, metric = 'outTheDoor', minSalePrice = 0, maxSalePrice } = {},
) {
  if (target === undefined) throw new TypeError('A target is required.');
  const currentSalePriceCents = nonNegativeCents(
    dealInput.salePrice ?? dealInput.sellingPrice ?? 0,
    'Sale price',
  );
  const targetCents = toCents(target);
  const evaluate = (salePriceCents) => {
    const deal = calculateDeal({ ...dealInput, salePrice: fromCents(salePriceCents) });
    return { metricCents: metricCentsFromDeal(deal, metric), result: deal };
  };
  const upperCents =
    maxSalePrice === undefined
      ? upperBoundForMonotonicDealValue({
          currentValueCents: currentSalePriceCents,
          targetCents,
          evaluate,
        })
      : nonNegativeCents(maxSalePrice, 'Maximum sale price');

  const solution = solveCentValueForTarget({
    target,
    min: minSalePrice,
    max: fromCents(upperCents),
    evaluate,
  });
  return {
    ...solution,
    metricName: metric,
    salePrice: solution.value,
    adjustment: fromCents(currentSalePriceCents - solution.cents.value),
    deal: solution.result,
    cents: {
      ...solution.cents,
      salePrice: solution.cents.value,
      adjustment: currentSalePriceCents - solution.cents.value,
    },
  };
}

export function solveOptionalItemAmountForTarget(
  dealInput,
  {
    itemIndex,
    target,
    metric = 'amountFinanced',
    minAmount = 0,
    maxAmount,
  } = {},
) {
  if (target === undefined) throw new TypeError('A target is required.');
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    throw new RangeError('itemIndex must be a non-negative integer.');
  }
  const items = Array.isArray(dealInput.optionalItems) ? dealInput.optionalItems : [];
  if (!items[itemIndex]) throw new RangeError(`Optional item ${itemIndex} does not exist.`);

  const currentAmountCents = nonNegativeCents(
    items[itemIndex].amount ?? 0,
    `Optional item ${itemIndex + 1}`,
  );
  const targetCents = toCents(target);
  const evaluate = (amountCents) => {
    const optionalItems = items.map((item, index) =>
      index === itemIndex ? { ...item, amount: fromCents(amountCents) } : item,
    );
    const deal = calculateDeal({ ...dealInput, optionalItems });
    return { metricCents: metricCentsFromDeal(deal, metric), result: deal };
  };
  const upperCents =
    maxAmount === undefined
      ? upperBoundForMonotonicDealValue({
          currentValueCents: currentAmountCents,
          targetCents,
          evaluate,
        })
      : nonNegativeCents(maxAmount, 'Maximum optional item amount');

  const solution = solveCentValueForTarget({
    target,
    min: minAmount,
    max: fromCents(upperCents),
    evaluate,
  });
  return {
    ...solution,
    metricName: metric,
    itemIndex,
    itemId: items[itemIndex].id,
    optionalItemAmount: solution.value,
    adjustment: fromCents(currentAmountCents - solution.cents.value),
    deal: solution.result,
    cents: {
      ...solution.cents,
      optionalItemAmount: solution.cents.value,
      adjustment: currentAmountCents - solution.cents.value,
    },
  };
}
