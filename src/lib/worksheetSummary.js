import { calculateDeal } from './calculations.js';
import { normalizeDeskDraft } from './deskDraft.js';
import { parseFinancialInput } from './inputValidation.js';
import { parseShortDate } from './formatters.js';
import { getDealSummary } from './proposal.js';

// Saved copies contain inputs, not quoted totals. Always recheck unfinished text
// and recalculate under this app's policy and the current device's fees.
export function summarizeWorksheet(snapshot, dealershipFees, { blocked = false } = {}) {
  const normalized = normalizeDeskDraft(snapshot);
  if (!normalized) return { ready: false, label: 'Needs attention', reason: 'This worksheet could not be read.' };
  const { deal } = normalized.desk;
  const base = { vehicle: deal.vehicleDescription || 'Vehicle not specified', date: deal.dealDate, salePrice: deal.salePrice,
    isFinanced: deal.dealType === 'finance', termMonths: deal.termMonths, apr: deal.apr };
  const invalidTyping = Object.entries(normalized.inputDrafts).some(([id, { raw }]) => {
    if (id === 'estimate-date') return Boolean(parseShortDate(raw).error);
    const kind = id === 'apr' || id.startsWith('grid-apr-') ? 'rate' : 'money';
    return Boolean(parseFinancialInput(raw, { kind, required: kind === 'rate' || id === 'new-plate-amount' }).error);
  });
  try {
    const dealInput = { ...deal, dealershipFees };
    const result = calculateDeal(dealInput);
    const summary = getDealSummary({ dealInput, result, hasInputErrors: invalidTyping || blocked });
    if (!summary.canExport) return { ...base, ready: false, label: 'Needs attention', reason: summary.reasons[0] };
    return { ...base, ready: true, label: summary.headline, payment: summary.headlineAmount,
      cashDue: summary.dueAtSigning, customerCredit: summary.customerCredit,
      amountFinanced: summary.isFinanced ? summary.amountFinanced : null,
      totalInterest: summary.isFinanced ? summary.totalInterest : null, outTheDoor: summary.outTheDoor };
  } catch (error) {
    return { ...base, ready: false, label: 'Needs attention', reason: error.message || 'Review the figures before using this estimate.' };
  }
}
