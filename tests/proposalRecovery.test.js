import test from "node:test";
import assert from "node:assert/strict";
import { calculateDeal } from "../src/lib/calculations.js";
import { getProposalStatus } from "../src/lib/proposal.js";
import { getPurchaseScope } from "../src/lib/purchaseScope.js";

const deal = confirmations => ({
  salePrice: 30_000,
  cashDown: 0,
  apr: 6.5,
  termMonths: 72,
  dealType: "finance",
  plateMode: "transfer",
  optionalItems: confirmations.map((taxTreatmentConfirmed, index) => ({
    id: `add-on-${index + 1}`,
    category: "other",
    name: "Protection",
    amount: 500,
    taxable: false,
    taxTreatmentConfirmed,
  })),
});

const statusFor = confirmations => {
  const dealInput = deal(confirmations);
  return getProposalStatus({ dealInput, result: calculateDeal(dealInput) });
};

test("duplicate Other product names retain one recovery issue per unconfirmed product", () => {
  const bothUnconfirmed = statusFor([false, false]);
  assert.equal(bothUnconfirmed.canExport, false);
  assert.equal(bothUnconfirmed.reasons.length, 1);
  assert.deepEqual(bothUnconfirmed.issues.map(({ fieldId }) => fieldId), [
    "add-on-1-tax-treatment",
    "add-on-2-tax-treatment",
  ]);

  const secondConfirmed = statusFor([false, true]);
  assert.equal(secondConfirmed.canExport, false);
  assert.equal(secondConfirmed.reasons.length, 1);
  assert.deepEqual(secondConfirmed.issues.map(({ fieldId }) => fieldId), ["add-on-1-tax-treatment"]);

  const firstConfirmed = statusFor([true, false]);
  assert.equal(firstConfirmed.canExport, false);
  assert.equal(firstConfirmed.reasons.length, 1);
  assert.deepEqual(firstConfirmed.issues.map(({ fieldId }) => fieldId), ["add-on-2-tax-treatment"]);

  const bothConfirmed = statusFor([true, true]);
  assert.equal(bothConfirmed.canExport, true);
  assert.deepEqual(bothConfirmed.reasons, []);
  assert.deepEqual(bothConfirmed.issues, []);
});

test("excess credit recovery selects a field that can actually repair the balance", () => {
  for (const [patch, fieldId] of [
    [{ salePrice: 1000, tradeAllowance: 5000, cashDown: 0 }, "trade-allowance"],
    [{ salePrice: 1000, tradeAllowance: 5000, cashDown: 100 }, "trade-allowance"],
    [{ salePrice: 1000, tradeAllowance: 0, cashDown: 5000 }, "cash-down"],
  ]) {
    const dealInput = { ...deal([]), ...patch };
    const status = getProposalStatus({ dealInput, result: calculateDeal(dealInput) });
    assert.equal(status.canExport, false);
    const creditIssues = status.issues.filter(issue => issue.reason.startsWith("Credits exceed"));
    assert.ok(creditIssues.length > 0);
    assert.ok(creditIssues.every(issue => issue.fieldId === fieldId));
  }
});

test("unsupported jurisdiction and transaction reasons retain the scope field identity", () => {
  for (const [patch, fieldId] of [
    [{ registrationState: "NY" }, "registration-state"],
    [{ registrationState: "MI", transactionScope: "exempt" }, "transaction-scope"],
  ]) {
    const dealInput = { ...deal([]), ...patch };
    const scope = getPurchaseScope(dealInput);
    const result = { ...calculateDeal(deal([])), isComplete: false, incompleteReasons: [scope.reason] };
    const status = getProposalStatus({ dealInput, result, hasInputErrors: true });
    assert.equal(status.canExport, false);
    const issue = status.issues.find(issue => issue.reason === scope.reason);
    assert.equal(issue.fieldId, fieldId);
    assert.equal(issue.actionLabel, fieldId === "registration-state" ? "Review registration state" : "Review transaction coverage");
  }
});
