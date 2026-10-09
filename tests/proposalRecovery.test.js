import test from "node:test";
import assert from "node:assert/strict";
import { calculateDeal } from "../src/lib/calculations.js";
import { getProposalStatus } from "../src/lib/proposal.js";

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
