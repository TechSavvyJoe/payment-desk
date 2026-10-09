import { calculatePayment, fromCents, toCents } from "./calculations.js";
import { formatCurrency, formatNumber, formatShortDate } from "./formatters.js";
import { resolveBrand } from "./brandSettings.js";
import { POLICY_CONFIG } from "./policy.js";
import { FINANCE_MODEL_EXPLANATION } from "./financeModel.js";
import { getPurchaseScope } from "./purchaseScope.js";

export const ESTIMATE_QUALIFICATION = "Estimate only, not a financing approval or contract. Actual payments, taxes, fees, product eligibility, and final figures must be confirmed with the lender and the dealership's approved systems.";

const money = (value) => formatCurrency(value, { cents: true });
const blank = (value) => value === "" || value === null || value === undefined;
const productName = (item, index) => item.category === "service-contract"
  ? "Service Contract"
  : item.category === "gap" ? "GAP" : item.name?.trim() || `Product or add-on ${index + 1}`;

export function getProposalStatus({ dealInput = {}, result, hasInputErrors = false }) {
  const reasons = [];
  const productIssues = [];
  const purchaseScope = getPurchaseScope(dealInput);
  if (hasInputErrors) reasons.push("Correct the highlighted input errors before creating a proposal.");
  if (!(result.salePrice > 0) && result.isComplete !== false) reasons.push("Enter a selling price before creating a proposal.");
  if (result.isComplete === false) reasons.push(...(result.incompleteReasons?.length ? result.incompleteReasons : ["Complete the required deal information."]));
  if (result.plateMode === "new" && blank(dealInput.newPlateAmount) && result.newPlateAmountKnown === undefined) {
    reasons.push("Enter the new-plate amount; registration is not yet included in this estimate.");
  }
  for (const [index, item] of (dealInput.optionalItems ?? []).entries()) {
    if (Number(item.amount) > 0 && !["service-contract", "gap"].includes(item.category) && !item.name?.trim()) {
      const reason = `Name product or add-on ${index + 1} before creating a proposal.`;
      reasons.push(reason);
      productIssues.push({ reason, fieldId: `product-${item.id}-name`, actionLabel: `Name product ${index + 1}` });
    }
    if (Number(item.amount) > 0 && item.category === "other" && item.taxTreatmentConfirmed !== true) {
      const reason = `Choose Taxable or Not taxable for ${productName(item, index)} before creating a proposal.`;
      reasons.push(reason);
      productIssues.push({ reason, fieldId: `${item.id}-tax-treatment`, actionLabel: `Review product ${index + 1} tax` });
    }
  }
  if (result.isFinanced && result.amountFinanced < 0) reasons.push("Credits exceed the financed balance. Adjust the deal before creating a proposal.");
  reasons.push(...(result.warnings ?? []));
  const uniqueReasons = [...new Set(reasons)];
  // Recovery is presentation metadata attached to the existing export reasons.
  // It never decides whether a financial estimate is valid.
  const issues = uniqueReasons.flatMap(reason => {
    const matchingProductIssues = productIssues.filter(issue => issue.reason === reason);
    if (matchingProductIssues.length) return matchingProductIssues;
    let fieldId, actionLabel;
    if (reason === "Correct the highlighted input errors before creating a proposal.") {
      fieldId = 'first-error'; actionLabel = 'Correct inputs';
    } else if (reason.startsWith('Enter a selling price')) {
      fieldId = 'sale-price'; actionLabel = 'Enter selling price';
    } else if (reason.startsWith('New plate cost') || reason.startsWith('Enter the new-plate amount')) {
      fieldId = 'new-plate-amount'; actionLabel = 'Enter registration estimate';
    } else if (!purchaseScope.supported && reason === purchaseScope.reason) {
      fieldId = purchaseScope.errorField;
      actionLabel = fieldId === 'registration-state' ? 'Review registration state' : 'Review transaction coverage';
    } else if (reason.startsWith('Credits exceed')) {
      // Cash cannot repair a balance already negative before cash is applied.
      fieldId = result.amountBeforeCashDown < 0 ? 'trade-allowance' : 'cash-down';
      actionLabel = 'Review cash and trade';
    }
    return [{ reason, ...(fieldId ? { fieldId, actionLabel } : {}) }];
  });
  return { canExport: uniqueReasons.length === 0, reasons: uniqueReasons, issues };
}

export function getDealSummary({ dealInput = {}, result, hasInputErrors = false }) {
  const hasCashCredit = !result.isFinanced && result.customerCredit > 0;
  return {
    headline: result.isFinanced ? "Estimated payment" : hasCashCredit ? "Estimated customer credit" : "Cash due after trade",
    headlineAmount: result.isFinanced ? result.monthlyPayment : hasCashCredit ? result.customerCredit : result.dueAtSigning,
    isFinanced: result.isFinanced,
    hasCashCredit,
    apr: result.apr,
    termMonths: result.termMonths,
    amountFinanced: result.amountFinanced,
    outTheDoor: result.outTheDoor,
    dueAtSigning: result.dueAtSigning,
    customerCredit: result.customerCredit,
    totalInterest: result.totalInterest,
    totalOfPayments: result.totalOfPayments,
    ...getProposalStatus({ dealInput, result, hasInputErrors }),
  };
}

const centsFor = (result, key) => result.cents?.[key] ?? toCents(result[key] ?? 0);
const row = (id, label, cents) => ({ id, label, cents, amount: fromCents(cents) });
const group = (id, title, rows, total) => ({ id, title, rows, total });

// Every group is an independent reconciliation. Trade reference figures are
// kept separate so allowance and equity never look like two loan deductions.
export function buildProposalGroups(result) {
  const cents = (key) => centsFor(result, key);
  const fee = (key) => result.cents?.fees?.[key] ?? toCents(result.fees?.[key] ?? 0);
  const rows = [row("vehicle", "Vehicle selling price", cents("salePrice"))];
  (result.optionalItems ?? []).forEach((item, index) => {
    if (Number(item.amount) > 0) rows.push(row(`product-${index}`, `${productName(item, index)}${item.taxable ? " (taxable)" : " (not taxable)"}`, toCents(item.amount)));
  });
  [
    ["documentFee", "Document fee (taxable)"],
    ["crvFee", "CRV dealer fee (taxable)"],
    ["plateTransferFee", "Plate transfer"],
    ["additionalTransferFee", "State transfer fee"],
    ["titleFee", "Title fee"],
    ["newPlateAmount", "New plate / registration"],
  ].forEach(([key, label]) => { if (fee(key)) rows.push(row(key, label, fee(key))); });
  rows.push(row("salesTax", "Sales tax", cents("salesTax")));
  const groups = [group("transaction", "Vehicle, products, taxes & fees", rows, row("outTheDoor", "Out-the-door total", cents("outTheDoor")))];

  if (cents("tradeAllowance") || cents("tradePayoff")) {
    groups.push(group("trade", "Trade settlement", [
      row("tradeAllowance", "Trade allowance", cents("tradeAllowance")),
      row("tradePayoff", "Less trade payoff", -cents("tradePayoff")),
    ], row("tradeEquity", result.tradeEquity < 0 ? "Negative trade equity" : "Positive trade equity", cents("tradeEquity"))));
  }
  if (result.isFinanced) {
    const financedNegative = result.cents?.financedNegativeEquity ?? (result.rollNegativeEquity ? cents("negativeEquity") : 0);
    const upfrontNegative = result.cents?.upfrontNegativeEquity ?? (result.rollNegativeEquity ? 0 : cents("negativeEquity"));
    const balanceRows = [row("outTheDoor", "Out-the-door total", cents("outTheDoor"))];
    if (cents("positiveEquity")) balanceRows.push(row("positiveEquity", "Less positive trade equity", -cents("positiveEquity")));
    if (financedNegative) balanceRows.push(row("financedNegativeEquity", "Negative equity financed", financedNegative));
    balanceRows.push(row("cashDown", "Less cash down", -cents("cashDown")));
    if (cents("upfrontAmount")) balanceRows.push(row("upfrontAmount", "Less other upfront payment", -cents("upfrontAmount")));
    groups.push(group("financing", "Financed balance", balanceRows, row("amountFinanced", "Estimated loan balance", cents("amountFinanced"))));
    const cashRows = [row("cashDown", "Cash down", cents("cashDown"))];
    if (upfrontNegative) cashRows.push(row("upfrontNegativeEquity", "Negative equity paid at signing", upfrontNegative));
    if (cents("upfrontAmount")) cashRows.push(row("upfrontAmount", "Other upfront payment", cents("upfrontAmount")));
    groups.push(group("cashDue", "Cash required", cashRows, row("dueAtSigning", "Total due at signing", cents("dueAtSigning"))));
  } else {
    const cashRows = [row("outTheDoor", "Out-the-door total", cents("outTheDoor"))];
    if (cents("tradeAllowance")) cashRows.push(row("tradeAllowance", "Less trade allowance", -cents("tradeAllowance")));
    if (cents("tradePayoff")) cashRows.push(row("tradePayoff", "Trade payoff", cents("tradePayoff")));
    groups.push(group("cashSettlement", "Cash settlement", cashRows, row("balanceAfterTrade", result.customerCredit > 0 ? "Balance in customer's favor" : "Cash due after trade", cents("balanceAfterTrade"))));
  }
  return groups;
}

function freezeSnapshot(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

function referenceFor(value) {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function createProposalSnapshot({ dealInput = {}, result, createdAt = new Date().toISOString(), version = "development", policy = result.policy, hasInputErrors = false, gridRates = {}, brand = resolveBrand() }) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError("A valid proposal creation date is required.");
  const groups = buildProposalGroups(result);
  const summary = getDealSummary({ dealInput, result, hasInputErrors });
  const rule = policy ? {
    id: policy.id,
    version: policy.version,
    jurisdiction: policy.jurisdiction,
    year: policy.year,
    effectiveFrom: policy.effectiveFrom,
    effectiveTo: policy.effectiveTo,
    reviewedAt: policy.reviewedAt,
    dealDate: policy.dealDate,
  } : { jurisdiction: "Michigan", dealDate: result.dealDate ?? "Not specified" };
  // The amounts actually charged on this deal, after the legal caps.
  const fee = (key) => fromCents(result.cents?.fees?.[key] ?? toCents(result.fees?.[key] ?? 0));
  const feeRules = result.policy ?? POLICY_CONFIG;
  const assumptions = [
    `${rule.jurisdiction ?? "Michigan"} purchase estimate; sales tax ${formatNumber(result.salesTaxRate * 100)}%.`,
    `Trade allowance deducted from taxable price: ${money(result.tradeTaxDeduction)}; sales tax saved: ${money(result.tradeTaxSavings)}. ${rule.year ?? result.policy?.year ?? 'Applicable'} trade deduction limit: ${result.tradeTaxCreditCap === null ? 'no cap' : money(result.tradeTaxCreditCap)}.`,
    `Document fee ${money(fee("documentFee"))} (dealership setting; never more than ${formatCurrency(feeRules.documentFeeMaximum)} or ${feeRules.documentFeeSalePricePercent}% of the selling price) and CRV dealer fee ${money(fee("crvFee"))} are set by the dealership.`,
    "Product tax treatment must be confirmed for this transaction.",
  ];
  if (rule.version) assumptions.push(`Rules ${rule.version}; effective ${formatShortDate(rule.effectiveFrom)} through ${formatShortDate(rule.effectiveTo)}; reviewed ${formatShortDate(rule.reviewedAt)}.`);
  if (rule.dealDate) assumptions.push(`Deal date: ${rule.dealDate === "Not specified" ? rule.dealDate : formatShortDate(rule.dealDate)}.`);
  if (result.isFinanced) assumptions.push(FINANCE_MODEL_EXPLANATION);
  const comparisonRows = result.isFinanced ? [...new Set([result.termMonths, 60, 72, 84])].sort((a, b) => a - b).map((termMonths) => {
    const selected = termMonths === result.termMonths;
    const apr = selected ? result.apr : Number(gridRates[termMonths] ?? result.apr);
    const payment = calculatePayment({ principal: result.amountFinanced, apr, termMonths });
    return { termMonths, apr, selected, monthlyPayment: payment.monthlyPayment, totalInterest: payment.totalInterest, totalOfPayments: payment.totalOfPayments };
  }) : [];
  const vehicleReference = String(dealInput.vehicleDescription ?? dealInput.vehicleReference ?? "").trim();
  const isoDate = timestamp.toISOString();
  const snapshot = {
    brand: { name: brand.displayName, dealershipName: brand.dealershipName, logo: brand.logo, isCustom: brand.isCustom },
    title: "Vehicle purchase estimate",
    reference: `PD-${isoDate.slice(0, 10).replaceAll("-", "")}-${referenceFor({ isoDate, groups, apr: result.apr, term: result.termMonths, vehicleReference, version, rule })}`,
    createdAt: isoDate,
    createdLabel: new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "2-digit", hour: "numeric", minute: "2-digit", timeZone: "America/Detroit" }).format(timestamp),
    timeZone: "America/Detroit",
    version: String(version),
    vehicleReference,
    policy: rule,
    groups,
    summary,
    comparisonRows,
    assumptions,
    qualification: ESTIMATE_QUALIFICATION,
  };
  return freezeSnapshot(snapshot);
}

export function formatProposalText(snapshot, { calculatorUrl } = {}) {
  const { summary } = snapshot;
  const lines = [snapshot.brand.name, snapshot.title, `Reference: ${snapshot.reference}`, `Created: ${snapshot.createdLabel} (Eastern time)`, `App version: ${snapshot.version}`];
  if (snapshot.vehicleReference) lines.push(`Vehicle / stock: ${snapshot.vehicleReference}`);
  if (!summary.canExport) lines.push("INCOMPLETE ESTIMATE", ...summary.reasons);
  lines.push("", `${summary.headline}: ${money(summary.headlineAmount)}${summary.isFinanced ? "/mo" : ""}`);
  if (summary.isFinanced) lines.push(`${summary.termMonths} months at ${formatNumber(summary.apr)}% interest rate`, `Estimated loan balance: ${money(summary.amountFinanced)}`, `Due at signing: ${money(summary.dueAtSigning)}`);
  for (const section of snapshot.groups) {
    lines.push("", section.title);
    section.rows.forEach((item) => lines.push(`${item.label}: ${money(item.amount)}`));
    lines.push(`${section.total.label}: ${money(section.total.amount)}`);
  }
  lines.push("", "Assumptions", ...snapshot.assumptions, "", snapshot.qualification);
  if (calculatorUrl) lines.push("", `Open calculator: ${calculatorUrl}`, "This calculator link opens a new estimate; it does not restore this proposal.");
  return lines.join("\n");
}
