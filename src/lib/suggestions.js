import {
  CALCULATION_LIMITS,
  RATE_GRID_DEFAULTS,
  calculateDeal,
  calculatePayment,
  fromCents,
  normalizeApr,
  solveAmountFinancedForPayment,
  solveCentValueForTarget,
  solveOptionalItemAmountForTarget,
  solveSalePriceForTarget,
  toCents,
} from './calculations.js';
import { getProposalStatus } from './proposal.js';
import { getPurchaseScope } from './purchaseScope.js';
import { parseFinancialInput } from './inputValidation.js';
import { formatCurrency, formatNumber } from './formatters.js';

const money = (value) => formatCurrency(value, { cents: true });
const blank = (value) => value === null || value === undefined || String(value).trim() === '';
const maxInputCents = CALCULATION_LIMITS.maxAmount * 100;

/** Highest supported 0.01%-interest-rate increment whose cent payment fits the ceiling. */
export function solveAprForPayment(principal, termMonths, targetPayment) {
  const targetCents = toCents(targetPayment);
  if (targetCents < 0) throw new RangeError('Target payment cannot be negative.');
  if (toCents(principal) <= 0) return null;
  const paymentAt = (basisPoints) => calculatePayment({
    principal, termMonths, apr: basisPoints / 100,
  }).cents.monthlyPayment;
  if (paymentAt(0) > targetCents) return null;
  let low = 0;
  let high = CALCULATION_LIMITS.maxApr * 100;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (paymentAt(middle) <= targetCents) low = middle;
    else high = middle - 1;
  }
  return low / 100;
}

function resultLine(deal) {
  if (!deal.isFinanced) {
    return `${deal.customerCredit > 0 ? `Credit ${money(deal.customerCredit)}` : `Cash due ${money(deal.dueAtSigning)}`} · OTD ${money(deal.outTheDoor)}`;
  }
  return `${money(deal.monthlyPayment)}/mo · AF ${money(deal.amountFinanced)} · OTD ${money(deal.outTheDoor)}`;
}

/**
 * Pure target domain. Every preview is calculated from the exact patch that
 * Apply receives. Money arithmetic uses integer cents, never UI draft strings.
 * `gap` retains the previous amount-financed/OTD units for the summary UI;
 * per-suggestion `difference` and `remainingGap` use the selected target units.
 */
export function buildSuggestions({ dealInput = {}, result: suppliedResult, targetType = 'payment', targetValue, gridRates = {} }) {
  if (!['payment', 'outTheDoor', 'amountFinanced', 'cashDue'].includes(targetType)) {
    throw new RangeError('Unsupported target type.');
  }
  const metric = targetType === 'cashDue' ? 'dueAtSigning' : targetType === 'outTheDoor' ? 'outTheDoor' : 'amountFinanced';
  const actualMetric = targetType === 'payment' ? 'monthlyPayment' : targetType === 'cashDue' ? 'dueAtSigning' : targetType;
  const initial = {
    direction: 'reduce', gap: 0, metric, targetMetric: 0,
    targetPaymentSolution: null, suggestions: [], alreadyMet: false,
    withinTarget: false, empty: false, status: 'ready', limitations: [],
  };
  if (blank(targetValue)) return { ...initial, empty: true, status: 'empty' };
  let targetCents;
  try {
    targetCents = toCents(targetValue);
    if (targetCents < 0 || targetCents > maxInputCents) {
      throw new RangeError(`Target must be between $0 and $${CALCULATION_LIMITS.maxAmount.toLocaleString('en-US')}.`);
    }
  } catch (error) {
    return { ...initial, status: 'invalid', error: error.message };
  }

  const currentResult = suppliedResult ?? calculateDeal(dealInput);
  const findingPrice = currentResult.salePrice <= 0;
  const result = findingPrice ? calculateDeal({ ...dealInput, salePrice: 0.01 }) : currentResult;
  if ((!result.isFinanced && !['outTheDoor', 'cashDue'].includes(targetType)) || (result.isFinanced && targetType === 'cashDue')) {
    return { ...initial, status: 'incomplete', error: 'Enter a selling price and select an applicable target type.' };
  }
  const base = {
    ...dealInput,
    dealDate: result.dealDate,
    salePrice: result.salePrice,
    cashDown: result.cashDown,
    tradeAllowance: result.tradeAllowance,
    tradePayoff: result.tradePayoff,
    apr: result.apr,
    termMonths: result.termMonths,
    optionalItems: result.optionalItems,
  };
  const actualCents = result.cents[actualMetric];
  if (!findingPrice && actualCents === targetCents) {
    return {
      ...initial, targetMetric: result[metric], alreadyMet: true,
      withinTarget: true, status: 'already-met',
    };
  }
  let targetPaymentSolution = null;
  try {
    if (targetType === 'payment') {
      targetPaymentSolution = solveAmountFinancedForPayment({
        targetPayment: fromCents(targetCents), apr: result.apr, termMonths: result.termMonths,
      });
    }
  } catch (error) {
    return { ...initial, status: 'invalid', error: error.message };
  }
  const targetMetricCents = targetPaymentSolution?.cents.amountFinanced ?? targetCents;
  const signedGapCents = result.cents[metric] - targetMetricCents;
  const gapCents = Math.abs(signedGapCents);
  const direction = signedGapCents >= 0 ? 'reduce' : 'increase';
  const targetMetric = fromCents(targetMetricCents);
  const suggestions = [];
  const limitations = [];

  const add = (suggestion, previewDeal, note = '') => {
    if (!(suggestion.amount > 0)) return;
    const differenceCents = previewDeal.cents[actualMetric] - targetCents;
    const exact = differenceCents === 0;
    const withinTarget = differenceCents <= 0;
    const status = exact ? 'exact' : withinTarget ? 'below-target' : 'partial';
    const suffix = targetType === 'payment' ? '/mo' : '';
    const qualification = exact ? 'Target reached.' : `${money(fromCents(Math.abs(differenceCents)))}${suffix} ${withinTarget ? 'below' : 'above'} target.`;
    suggestions.push({
      ...suggestion, previewDeal, exact, withinTarget, status, note,
      ...(suggestion.id === 'term' ? { interestDeltaCents: previewDeal.cents.totalInterest - result.cents.totalInterest } : {}),
      difference: fromCents(differenceCents), remainingGap: fromCents(Math.abs(differenceCents)),
      detail: `${resultLine(previewDeal)} · ${qualification}${note ? ` ${note}` : ''}`,
    });
  };
  const bounded = (label, action) => {
    try { action(); } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      limitations.push(`${label}: ${error.message}`);
    }
  };
  const addPatch = (suggestion, note) => add(suggestion, calculateDeal({ ...base, ...suggestion.patch }), note);

  if (!findingPrice && ['payment', 'amountFinanced'].includes(targetType)) {
    bounded('Cash-down option', () => {
      const nextCents = direction === 'reduce'
        ? result.cents.cashDown + gapCents
        : Math.max(0, result.cents.cashDown - gapCents);
      const deltaCents = nextCents - result.cents.cashDown;
      addPatch({
        id: 'cash-down', title: deltaCents >= 0 ? 'Add cash down' : 'Lower cash down',
        value: `${deltaCents >= 0 ? '+' : '−'}${money(fromCents(Math.abs(deltaCents)))}`,
        amount: fromCents(Math.abs(deltaCents)), patch: { cashDown: fromCents(nextCents) },
        iconDirection: deltaCents >= 0 ? 'up' : 'down',
      });
    });
  }

  bounded('Selling-price option', () => {
    const solved = solveSalePriceForTarget(base, {
      target: targetMetric, metric, minSalePrice: 0.01,
      maxSalePrice: findingPrice ? undefined : fromCents(direction === 'increase'
        ? Math.min(maxInputCents, result.cents.salePrice + gapCents * 2 + 1_000_000)
        : result.cents.salePrice),
    });
    const delta = solved.cents.salePrice - result.cents.salePrice;
    addPatch({
      id: 'sale-price', title: findingPrice ? 'Required selling price' : delta < 0 ? 'Reduce selling price' : 'Selling-price room',
      value: findingPrice ? money(solved.salePrice) : `${delta < 0 ? '−' : '+'}${money(fromCents(Math.abs(delta)))}`,
      amount: findingPrice ? solved.salePrice : fromCents(Math.abs(delta)), patch: { salePrice: solved.salePrice },
      iconDirection: delta < 0 ? 'down' : 'up',
    }, 'Subject to dealer approval.');
  });

  if (!findingPrice && direction === 'increase' && gapCents <= maxInputCents && base.optionalItems.length < CALCULATION_LIMITS.maxOptionalItems) {
    const amount = fromCents(gapCents);
    const previewDeal = calculateDeal({
      ...base, optionalItems: [...base.optionalItems, { name: 'Product allowance', amount, taxable: false }],
    });
    add({
      id: 'roll-room', title: 'Available product room', value: `+${money(amount)}`,
      amount, addRoomItem: amount, requiresProductSelection: true, iconDirection: 'up',
    }, previewDeal, 'Non-taxable estimate only; select an applicable product and verify its tax and lender eligibility.');
  }

  if (!findingPrice && targetType !== 'outTheDoor' && direction === 'reduce') {
    bounded('Trade option', () => {
      const solved = solveCentValueForTarget({
        target: targetMetric, min: result.tradeAllowance,
        max: fromCents(Math.min(maxInputCents, result.cents.tradeAllowance + gapCents * 2 + 2_000_000)),
        direction: 'decreasing',
        evaluate: (candidateCents) => {
          const deal = calculateDeal({ ...base, tradeAllowance: fromCents(candidateCents) });
          return { metricCents: deal.cents[metric], result: deal };
        },
      });
      const delta = solved.cents.value - result.cents.tradeAllowance;
      addPatch({
        id: 'trade', title: 'Increase trade allowance', value: `+${money(fromCents(delta))}`,
        amount: fromCents(delta), patch: { tradeAllowance: solved.value }, iconDirection: 'up',
      }, 'Manager-controlled; verify the actual trade value.');
    });
  }

  if (!findingPrice && direction === 'reduce') {
    const itemIndex = base.optionalItems
      .map((item, index) => ({ cents: toCents(item.amount), index }))
      .filter((item) => item.cents > 0).sort((a, b) => b.cents - a.cents)[0]?.index;
    if (Number.isInteger(itemIndex)) bounded('Product option', () => {
      const item = base.optionalItems[itemIndex];
      const solved = solveOptionalItemAmountForTarget(base, {
        itemIndex, target: targetMetric, metric, maxAmount: item.amount,
      });
      const delta = toCents(item.amount) - solved.cents.optionalItemAmount;
      const itemPatch = { index: itemIndex, amount: solved.optionalItemAmount };
      const previewDeal = calculateDeal({ ...base, optionalItems: base.optionalItems.map((entry, index) =>
        index === itemIndex ? { ...entry, amount: itemPatch.amount } : entry) });
      add({
        id: 'option', title: `Reduce ${item.name.trim() || 'product or add-on'}`,
        value: `−${money(fromCents(delta))}`, amount: fromCents(delta), itemPatch, iconDirection: 'down',
      }, previewDeal);
    });
  }

  if (!findingPrice && targetType === 'payment' && direction === 'reduce') {
    const terms = RATE_GRID_DEFAULTS.termMonths.filter((months) => months > result.termMonths)
      .map((months) => {
        const apr = normalizeApr(gridRates[months] ?? result.apr);
        const deal = calculateDeal({ ...base, apr, termMonths: months });
        return { months, apr, deal };
      }).filter(candidate => candidate.deal.cents.monthlyPayment < actualCents);
    // Offer the shortest term that fits the target, or the largest available
    // reduction when a term change alone cannot reach it. The preview labels
    // that remaining gap, rather than hiding the option entirely.
    const term = terms.find(candidate => candidate.deal.cents.monthlyPayment <= targetCents)
      ?? terms.reduce((best, candidate) => !best || candidate.deal.cents.monthlyPayment < best.deal.cents.monthlyPayment ? candidate : best, null);
    if (term) addPatch({
      id: 'term', title: 'Change finance term', value: `${term.months} months`,
      amount: term.months, patch: { termMonths: term.months, apr: term.apr }, iconDirection: 'right',
    }, `${formatNumber(term.apr)}% annual interest rate assumption; verify lender approval.`);
    const apr = solveAprForPayment(Math.max(0, result.amountFinanced), result.termMonths, fromCents(targetCents));
    if (apr !== null && apr < result.apr) addPatch({
      id: 'apr', title: 'Interest rate needed', value: `${formatNumber(apr)}%`,
      amount: fromCents(toCents(result.apr) - toCents(apr)), patch: { apr }, iconDirection: 'down',
    }, 'Only if lender-approved.');
  }

  return {
    ...initial, direction, gap: fromCents(gapCents), targetMetric, targetPaymentSolution,
    withinTarget: !findingPrice && actualCents <= targetCents,
    suggestions: suggestions.sort((a, b) => ({ 'sale-price': 0, 'cash-down': 1, term: 2 }[a.id] ?? 3) - ({ 'sale-price': 0, 'cash-down': 1, term: 2 }[b.id] ?? 3)), limitations,
    status: suggestions.length ? 'ready' : 'unavailable',
  };
}


/** Bounded term/cash composition. Never changes locked vehicle or purchase inputs. */
export function buildBudgetSuggestions({ dealInput = {}, targetValue, cashLimit, gridRates = {}, hasInputErrors = false }) {
  const initial = { suggestions: [], status: 'empty', empty: true };
  if (hasInputErrors) return { ...initial, empty: false, status: 'blocked', error: 'Correct the highlighted figures to compare payment and cash limits.' };
  const scope = getPurchaseScope(dealInput);
  if (!scope.supported) return { ...initial, empty: false, status: 'blocked', error: scope.reason };
  for (const [label, value] of [['Payment limit', targetValue], ['Cash limit', cashLimit]]) {
    const parsed = parseFinancialInput(value);
    if (parsed.error) return { ...initial, empty: false, status: 'invalid', error: `${label}: ${parsed.error}` };
    if (parsed.value === '') return initial;
  }
  try {
    const result = calculateDeal(dealInput);
    const currentStatus = getProposalStatus({ dealInput, result });
    if (!result.isFinanced || !currentStatus.canExport) return {
      ...initial, empty: false, status: 'blocked',
      error: currentStatus.reasons.join(' ') || 'Select a complete financed purchase to compare payment and cash limits.',
    };
    const paymentCents = toCents(targetValue);
    const cashCents = toCents(cashLimit);
    // Validate every entered comparison rate before presenting any options.
    const rates = RATE_GRID_DEFAULTS.termMonths.map(termMonths => {
      const parsed = parseFinancialInput(gridRates[termMonths], { kind: 'rate', required: true });
      if (parsed.error) throw new RangeError(`${termMonths}-month interest rate: ${parsed.error}`);
      return { termMonths, apr: parsed.value };
    });
    const suggestions = [];
    const add = (id, title, patch, previewDeal) => {
      const candidate = { ...dealInput, ...patch };
      if (!getPurchaseScope(candidate).supported || !getProposalStatus({ dealInput: candidate, result: previewDeal }).canExport
        || previewDeal.cents.amountFinanced < 0 || previewDeal.cents.monthlyPayment > paymentCents
        || (paymentCents === 0 && previewDeal.cents.amountFinanced !== 0)
        || previewDeal.cents.dueAtSigning > cashCents) return;
      suggestions.push({ id, title, patch, previewDeal, withinTarget: true,
        informational: id === 'budget-current',
        interestDeltaCents: previewDeal.cents.totalInterest - result.cents.totalInterest });
    };
    add('budget-current', 'Current scenario', { termMonths: result.termMonths, apr: result.apr, cashDown: result.cashDown }, result);
    for (const { termMonths, apr } of rates) {
      const beforeCash = calculateDeal({ ...dealInput, termMonths, apr, cashDown: 0 });
      const signingRoom = cashCents - beforeCash.cents.dueAtSigning;
      if (signingRoom < 0) continue;
      // A ceiling uses the calculated cent payment, including its rounding
      // plateau. The exact-target inverse can demand unnecessary cash here.
      // A zero-payment request must fully pay the balance; sub-cent monthly
      // rounding must never make an unpaid principal look like a cash purchase.
      let low = paymentCents === 0 ? beforeCash.cents.amountBeforeCashDown : 0;
      let high = Math.min(maxInputCents, beforeCash.cents.amountBeforeCashDown, signingRoom);
      const paymentAt = cash => calculatePayment({
        principal: fromCents(beforeCash.cents.amountBeforeCashDown - cash), apr, termMonths,
      }).cents.monthlyPayment;
      if (high < low || paymentAt(high) > paymentCents) continue;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (paymentAt(middle) <= paymentCents) high = middle;
        else low = middle + 1;
      }
      const cashDownCents = low;
      const patch = { termMonths, apr, cashDown: fromCents(cashDownCents) };
      if (suggestions.some(option => option.patch.termMonths === termMonths && option.patch.apr === apr && toCents(option.patch.cashDown) === cashDownCents)) continue;
      add(`budget-${termMonths}`, `Payment + cash limits: ${termMonths} months`, patch, calculateDeal({ ...dealInput, ...patch }));
    }
    return { suggestions, empty: false, status: suggestions.length ? 'ready' : 'no-match' };
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
    return { ...initial, empty: false, status: 'invalid', error: error.message };
  }
}
