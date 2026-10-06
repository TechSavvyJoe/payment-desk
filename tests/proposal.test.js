import test from "node:test";
import assert from "node:assert/strict";
import { calculateDeal } from "../src/lib/calculations.js";
import { buildProposalGroups, createProposalSnapshot, formatProposalText, getProposalStatus } from "../src/lib/proposal.js";
import { resolveBrand } from "../src/lib/brandSettings.js";

const base = { salePrice: 30_000, cashDown: 2_000, apr: 6.5, termMonths: 72, dealDate: "2026-09-24", dealType: "finance", plateMode: "transfer", optionalItems: [] };
const create = (patch = {}, options = {}) => {
  const dealInput = { ...base, ...patch };
  const result = calculateDeal(dealInput);
  return createProposalSnapshot({ dealInput, result, createdAt: "2026-09-24T19:00:00.000Z", version: "2.0.0 (test-build)", ...options });
};

test("each proposal ledger reconciles independently for all trade settlement modes", () => {
  const cases = [
    {},
    { tradeAllowance: 10_000, tradePayoff: 6_000 },
    { tradeAllowance: 10_000, tradePayoff: 14_000, rollNegativeEquity: true },
    { tradeAllowance: 10_000, tradePayoff: 14_000, rollNegativeEquity: false },
    { tradeAllowance: 10_000, tradePayoff: 14_000, rollNegativeEquity: false, upfrontAmount: 250 },
    { dealType: "cash", tradeAllowance: 10_000, tradePayoff: 14_000 },
    { dealType: "cash", tradeAllowance: 40_000, tradePayoff: 0 },
  ];
  for (const patch of cases) {
    const groups = buildProposalGroups(calculateDeal({ ...base, ...patch }));
    for (const section of groups) {
      assert.equal(section.rows.reduce((sum, item) => sum + item.cents, 0), section.total.cents, `${JSON.stringify(patch)}: ${section.id}`);
    }
  }
});

test("negative equity paid at signing never appears as a financed addition", () => {
  const snapshot = create({ tradeAllowance: 10_000, tradePayoff: 14_000, rollNegativeEquity: false });
  const financed = snapshot.groups.find((section) => section.id === "financing");
  const cash = snapshot.groups.find((section) => section.id === "cashDue");
  assert.equal(financed.rows.some((item) => item.id === "financedNegativeEquity"), false);
  assert.equal(financed.total.amount, 29_563.84);
  assert.equal(cash.rows.find((item) => item.id === "upfrontNegativeEquity").amount, 4_000);
  assert.equal(cash.total.amount, 6_000);
});

test("a valid cash customer credit can be exported while negative financing is blocked", () => {
  const cash = create({ dealType: "cash", tradeAllowance: 40_000, tradePayoff: 0 });
  assert.equal(cash.summary.canExport, true);
  assert.equal(cash.summary.headline, "Estimated customer credit");
  assert.ok(cash.summary.headlineAmount > 0);
  assert.equal(cash.summary.dueAtSigning, 0);
  const finance = create({ cashDown: 50_000 });
  assert.equal(finance.summary.canExport, false);
  assert.match(finance.summary.reasons.join(" "), /exceed/i);
});

test("unknown plate cost, input errors and missing Other product names block proposals", () => {
  const blankPlate = create({ plateMode: "new", newPlateAmount: null });
  assert.equal(blankPlate.summary.canExport, false);
  assert.match(blankPlate.summary.reasons.join(" "), /plate|registration/i);
  assert.equal(create({ plateMode: "new", newPlateAmount: 250 }).summary.canExport, true);
  assert.equal(create({}, { hasInputErrors: true }).summary.canExport, false);
  assert.equal(create({ optionalItems: [{ id: "other", category: "other", name: "", amount: 300, taxable: false }] }).summary.canExport, false);
  assert.equal(create({ optionalItems: [{ id: "other", category: "other", name: "Wheel protection", amount: 300, taxable: false, taxTreatmentConfirmed: true }] }).summary.canExport, true);
});

test("a named Other charge requires an explicit tax choice before export", () => {
  const item = { id: "other", category: "other", name: "Bed liner", amount: 800, taxable: false };
  for (const taxTreatmentConfirmed of [undefined, false, "true", 1]) {
    const snapshot = create({ optionalItems: [{ ...item, taxTreatmentConfirmed }] });
    assert.equal(snapshot.summary.canExport, false);
    assert.match(snapshot.summary.reasons.join(" "), /Choose Taxable or Not taxable for Bed liner/);
    assert.match(formatProposalText(snapshot), /INCOMPLETE ESTIMATE/);
  }
  for (const taxable of [false, true]) {
    const snapshot = create({ optionalItems: [{ ...item, taxable, taxTreatmentConfirmed: true }] });
    assert.equal(snapshot.summary.canExport, true);
    assert.equal(snapshot.summary.reasons.length, 0);
  }
  assert.equal(create({ optionalItems: [{ ...item, amount: 0 }] }).summary.canExport, true);
});

test("engine incompleteness and warnings cannot be lost in export eligibility", () => {
  const result = calculateDeal(base);
  const status = getProposalStatus({ dealInput: base, result: { ...result, isComplete: false, incompleteReasons: ["Review this rule version."], warnings: ["Verify lender eligibility."] } });
  assert.equal(status.canExport, false);
  assert.deepEqual(status.reasons, ["Review this rule version.", "Verify lender eligibility."]);
});

test("proposal copies itemized products, cash requirements, identity, policy and qualifications", () => {
  const snapshot = create({
    vehicleDescription: "2026 F-150 / stock X123",
    tradeAllowance: 10_000, tradePayoff: 14_000, rollNegativeEquity: false,
    optionalItems: [
      { id: "service", category: "service-contract", name: "Service Contract", amount: 1_500, taxable: false },
      { id: "gap", category: "gap", name: "Gap", amount: 500, taxable: false },
      { id: "other", category: "other", name: "Bed liner", amount: 800, taxable: true, taxTreatmentConfirmed: true },
    ],
  }, { policy: { id: "policy-test", version: "2026.09.24", jurisdiction: "Michigan", year: 2026, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", reviewedAt: "2026-09-24", dealDate: "2026-09-24" } });
  const text = formatProposalText(snapshot, { calculatorUrl: "https://example.test/calculator/" });
  assert.doesNotMatch(text, /interest|total (?:loan )?payments/i);
  assert.match(text, /2026 trade deduction limit: \$12,000\.00/);
  for (const expected of ["Payment Desk", "2026 F-150 / stock X123", snapshot.reference, "2.0.0 (test-build)", "Service Contract", "GAP", "Bed liner", "trade payoff", "$14,000.00", "Negative equity paid at signing", "$6,000.00", "6.50% APR", "12/31/26", "Estimate only", "not a financing approval or contract", "Open calculator: https://example.test/calculator/", "does not restore this proposal"]) assert.ok(text.includes(expected), expected);
  assert.equal(snapshot.groups[0].rows.reduce((total, item) => total + item.cents, 0), snapshot.groups[0].total.cents);
});

test("snapshot identity and amounts remain fixed after source deal objects change", () => {
  const dealInput = { ...base, optionalItems: [{ id: "addon", category: "other", name: "Bed liner", amount: 800, taxable: true, taxTreatmentConfirmed: true }] };
  const result = calculateDeal(dealInput);
  const args = { dealInput, result, createdAt: "2026-09-24T19:00:00Z", version: "test" };
  const snapshot = createProposalSnapshot(args);
  const same = createProposalSnapshot(args);
  assert.equal(snapshot.reference, same.reference);
  const before = formatProposalText(snapshot);
  dealInput.optionalItems[0].name = "Changed";
  result.optionalItems[0].amount = 99;
  result.fees.documentFee = 99;
  assert.equal(formatProposalText(snapshot), before);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.groups[0].rows[0]), true);
  assert.throws(() => { snapshot.groups[0].rows[0].amount = 1; }, TypeError);
});

test("selected comparison always uses the selected deal rate and cent payment", () => {
  const snapshot = create({}, { gridRates: { 60: 6, 72: 99, 84: 7 } });
  const selected = snapshot.comparisonRows.filter((item) => item.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].apr, snapshot.summary.apr);
  assert.equal(selected[0].monthlyPayment, snapshot.summary.headlineAmount);
  assert.match(formatProposalText(snapshot), /6\.50% APR/);
});

test("proposal display dates use MM/DD/YY while policy and creation values stay ISO", () => {
  const snapshot = create({}, { createdAt: "2026-09-25T00:30:00Z" });
  assert.equal(snapshot.createdAt, "2026-09-25T00:30:00.000Z");
  assert.equal(snapshot.policy.dealDate, "2026-09-24");
  assert.equal(snapshot.policy.effectiveTo, "2026-12-31");
  assert.equal(snapshot.createdLabel, "09/24/26, 8:30 PM");
  assert.match(snapshot.reference, /^PD-20260925-/);
  const text = formatProposalText(snapshot);
  assert.match(text, /Created: 09\/24\/26, 8:30 PM/);
  assert.match(text, /effective 01\/01\/26 through 12\/31\/26; reviewed 09\/24\/26/);
  assert.match(text, /Deal date: 09\/24\/26\./);
});

test("estimate identity defaults to Payment Desk and uses a saved dealership", () => {
  const plain = create();
  assert.deepEqual({ ...plain.brand }, { name: "Payment Desk", dealershipName: "", logo: null, isCustom: false });
  assert.equal(formatProposalText(plain).split("\n")[0], "Payment Desk");

  const named = create({}, { brand: resolveBrand({ name: "Lakeside Motors" }) });
  assert.equal(named.brand.name, "Lakeside Motors");
  assert.equal(named.brand.isCustom, true);
  assert.equal(formatProposalText(named).split("\n")[0], "Lakeside Motors");
  assert.equal(named.reference, plain.reference, "branding does not change the deal reference");
  assert.ok(Object.isFrozen(named.brand));

  const logo = "data:image/png;base64,iVBORw0KGgo=";
  const logoOnly = create({}, { brand: resolveBrand({ logo }) });
  assert.deepEqual({ ...logoOnly.brand }, { name: "Payment Desk", dealershipName: "", logo, isCustom: true });
  assert.equal(formatProposalText(logoOnly).split("\n")[0], "Payment Desk");
});
