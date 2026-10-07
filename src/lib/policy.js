// This is an estimate policy, not a lender rate or eligibility table.
// Source review does not replace dealership verification of vendor fees.
export const POLICY_CONFIG = Object.freeze({
  id: 'mi-retail-2026-09-24',
  version: '2026.09.24',
  jurisdiction: 'Michigan',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  reviewedAt: '2026-09-24',
  salesTaxRate: 0.06,
  salesTaxBasisPoints: 600,
  documentFeeMaximum: 280,
  documentFeeSalePricePercent: 5,
  feeDefaults: Object.freeze({
    documentFee: 280,
    crvFee: 34,
    plateTransferFee: 10,
    additionalTransferFee: 5,
    cashTitleFee: 15,
    financeTitleFee: 16,
  }),
  documentFeeBasis: 'Conservative estimate: the lesser of $280 and 5% of selling price, rounded down to cents, for both cash and finance.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Michigan Treasury RAB 2022-17: trade-in credit',
      url: 'https://www.michigan.gov/taxes/rep-legal/rab/2022-revenue-administrative-bulletins/revenue-administrative-bulletin-2022-17',
    }),
    Object.freeze({
      title: 'Michigan DIFS Bulletin 2025-03-CF: documentary fee maximum',
      url: 'https://www.michigan.gov/difs/-/media/Project/Websites/difs/Bulletins/2025/Bulletin_2025-03-CF.pdf',
    }),
    Object.freeze({
      title: 'Michigan SOS Dealer Manual Chapter 8: sales tax',
      url: 'https://www.michigan.gov/documents/sos/Dealer_Manual_Chapter_8_186065_7.pdf',
    }),
  ]),
  assumptions: Object.freeze([
    'Michigan taxable retail vehicle purchase with an eligible owned motor-vehicle trade; leases, nonresident transactions and tax exemptions are outside this estimate.',
    'The $34 taxable CRV charge is a dealership assumption and must be verified; it is not presented as a state-mandated fee.',
    'New registration costs must be supplied. Standard transfer and title amounts do not cover every renewal, replacement or commercial registration case.',
    'Optional product taxability must be verified. Manufacturer rebates are not supported and must not be deducted from the taxable selling price.',
    'Payments assume equal monthly periods and a two-decimal annual rate. Lender timing, fees, eligibility and final contract figures require separate verification.',
  ]),
  tradeCreditSchedule: Object.freeze([
    Object.freeze({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', cap: 12_000 }),
    Object.freeze({ effectiveFrom: '2027-01-01', effectiveTo: '2027-12-31', cap: 13_000 }),
    Object.freeze({ effectiveFrom: '2028-01-01', effectiveTo: '2028-12-31', cap: 14_000 }),
    Object.freeze({ effectiveFrom: '2029-01-01', effectiveTo: null, cap: null }),
  ]),
});

export function todayDealDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function getMichiganPolicy(dealDate) {
  const date = dealDate === undefined || dealDate === null || dealDate === ''
    ? todayDealDate()
    : dealDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('Deal date must be a valid YYYY-MM-DD date.');
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError('Deal date must be a valid calendar date.');
  }
  const rule = POLICY_CONFIG.tradeCreditSchedule.find((entry) =>
    date >= entry.effectiveFrom && (!entry.effectiveTo || date <= entry.effectiveTo));
  const supportedDate = Boolean(rule);
  const reviewRequired = date > POLICY_CONFIG.effectiveTo;
  const warnings = [];
  if (!supportedDate) {
    warnings.push('This deal date is outside the supported policy dates. No trade tax credit has been estimated; verify the applicable rules.');
  }
  if (reviewRequired) {
    warnings.push('The scheduled trade tax credit is applied, but fee and tax policy must be reviewed for this date before using the estimate.');
  }
  return {
    ...POLICY_CONFIG,
    dealDate: date,
    year: Number(date.slice(0, 4)),
    tradeTaxCreditCap: rule?.cap ?? (supportedDate ? null : 0),
    tradeRuleEffectiveFrom: rule?.effectiveFrom ?? null,
    tradeRuleEffectiveTo: rule?.effectiveTo ?? null,
    supportedDate,
    reviewRequired,
    warnings,
  };
}

const DAY_MS = 86_400_000;
const REVIEW_REMINDER_DAYS = 30;
const isIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const utcFormat = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });

// The review end, the following day, and what that day blocks, while the
// reminder window is open; otherwise null.
function reviewReminderParts(today, policy) {
  const end = policy?.effectiveTo;
  if (!isIsoDate(today) || !isIsoDate(end)) return null;
  const endTime = Date.parse(`${end}T00:00:00Z`);
  const start = new Date(endTime - REVIEW_REMINDER_DAYS * DAY_MS).toISOString().slice(0, 10);
  if (today < start || today > end) return null;
  const next = new Date(endTime + DAY_MS);
  const nextDay = utcFormat({ month: 'long', day: 'numeric' }).format(next);
  return {
    through: utcFormat({ month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(endTime)),
    nextDay,
    blocked: next.getUTCMonth() === 0 && next.getUTCDate() === 1
      ? `estimates dated ${next.getUTCFullYear()}`
      : `estimates dated from ${nextDay}, ${next.getUTCFullYear()}`,
  };
}

/**
 * From 30 days before the review window ends through its last day, the text
 * reminding the dealership to have the rules reviewed; otherwise null.
 * `today` is an Eastern-time calendar date such as todayDealDate() returns.
 */
export function policyReviewReminder(today, policy = POLICY_CONFIG) {
  const parts = reviewReminderParts(today, policy);
  return parts && `Tax and fee rules are reviewed through ${parts.through}. Have them reviewed and the app updated before ${parts.nextDay}, or ${parts.blocked} will be blocked.`;
}

/** The same reminder, short enough for two lines on a 320px phone. */
export function policyReviewReminderShort(today, policy = POLICY_CONFIG) {
  const parts = reviewReminderParts(today, policy);
  return parts && `Rules reviewed through ${parts.through}. Update the app before ${parts.blocked} are blocked.`;
}
