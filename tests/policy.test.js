import test from "node:test";
import assert from "node:assert/strict";
import { POLICY_CONFIG, policyReviewReminder, policyReviewReminderShort, todayDealDate } from "../src/lib/policy.js";

const REMINDER = "Tax and fee rules are reviewed through Dec 31, 2026. Have them reviewed and the app updated before January 1, or estimates dated 2027 will be blocked.";

test("the rules-review reminder runs from 30 days before the review window ends through its last day", () => {
  assert.equal(POLICY_CONFIG.effectiveTo, "2026-12-31");
  for (const date of ["2026-01-01", "2026-09-24", "2026-11-01", "2026-11-30"]) assert.equal(policyReviewReminder(date), null, date);
  for (const date of ["2026-12-01", "2026-12-15", "2026-12-30", "2026-12-31"]) assert.equal(policyReviewReminder(date), REMINDER, date);
  for (const date of ["2027-01-01", "2027-01-02", "2028-12-01"]) assert.equal(policyReviewReminder(date), null, date);
});

test("the reminder follows the Eastern-time calendar day", () => {
  // 11:30 PM on Nov 30 in New York is already Dec 1 in UTC.
  assert.equal(policyReviewReminder(todayDealDate(new Date("2026-12-01T04:30:00Z"))), null);
  assert.equal(policyReviewReminder(todayDealDate(new Date("2026-12-01T05:30:00Z"))), REMINDER);
  // 11:30 PM on Dec 31 in New York is already Jan 1 in UTC.
  assert.equal(policyReviewReminder(todayDealDate(new Date("2027-01-01T04:30:00Z"))), REMINDER);
  assert.equal(policyReviewReminder(todayDealDate(new Date("2027-01-01T05:30:00Z"))), null);
});

test("the reminder text and window are computed from the policy's review end date", () => {
  const policy = { effectiveTo: "2027-06-30" };
  assert.equal(policyReviewReminder("2027-05-30", policy), null);
  assert.equal(policyReviewReminder("2027-05-31", policy),
    "Tax and fee rules are reviewed through Jun 30, 2027. Have them reviewed and the app updated before July 1, or estimates dated from July 1, 2027 will be blocked.");
  assert.equal(policyReviewReminder("2027-06-30", policy)?.startsWith("Tax and fee rules are reviewed through Jun 30, 2027."), true);
  assert.equal(policyReviewReminder("2027-07-01", policy), null);
  // Across a leap day the 30-day window still counts calendar days: Mar 29 less 30 days is Feb 28.
  assert.equal(policyReviewReminder("2028-02-27", { effectiveTo: "2028-03-29" }), null);
  assert.match(policyReviewReminder("2028-02-28", { effectiveTo: "2028-03-29" }), /through Mar 29, 2028\..*before March 30, or estimates dated from March 30, 2028 will be blocked\.$/);
});

test("an unreadable date or missing review end never shows a reminder", () => {
  for (const date of [undefined, null, "", "12/01/26", "2026-12-32", 20261201]) assert.equal(policyReviewReminder(date), null, String(date));
  assert.equal(policyReviewReminder("2026-12-15", { effectiveTo: null }), null);
  assert.equal(policyReviewReminder("2026-12-15", { effectiveTo: "soon" }), null);
});

test("phones get a shorter reminder over the same window", () => {
  const short = "Rules reviewed through Dec 31, 2026. Update the app before estimates dated 2027 are blocked.";
  for (const date of ["2026-11-30", "2027-01-01", "", null]) assert.equal(policyReviewReminderShort(date), null, String(date));
  for (const date of ["2026-12-01", "2026-12-31"]) assert.equal(policyReviewReminderShort(date), short, date);
  assert.ok(short.length < REMINDER.length);
  assert.equal(policyReviewReminderShort("2027-06-15", { effectiveTo: "2027-06-30" }),
    "Rules reviewed through Jun 30, 2027. Update the app before estimates dated from July 1, 2027 are blocked.");
});
