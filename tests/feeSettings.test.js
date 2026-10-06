import test from "node:test";
import assert from "node:assert/strict";
import {
  CRV_FEE_MAXIMUM, FEE_STORAGE_KEY,
  clearFeeSettings, loadFeeSettings, normalizeFeeSettings, resolveFees, saveFeeSettings,
} from "../src/lib/feeSettings.js";
import { POLICY_CONFIG } from "../src/lib/policy.js";

const DEFAULTS = { documentFee: null, crvFee: null };
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
};
const throwingStorage = (name) => ({
  getItem() { throw new DOMException("blocked", name); },
  setItem() { throw new DOMException("blocked", name); },
  removeItem() { throw new DOMException("blocked", name); },
});

test("the storage key and CRV ceiling are fixed, and the document fee ceiling is the policy maximum", () => {
  assert.equal(FEE_STORAGE_KEY, "payment-desk.fees.v1");
  assert.equal(CRV_FEE_MAXIMUM, 999.99);
  assert.equal(POLICY_CONFIG.documentFeeMaximum, 280);
  assert.deepEqual(normalizeFeeSettings({ documentFee: 280, crvFee: 999.99 }), { documentFee: 280, crvFee: 999.99 });
  assert.deepEqual(normalizeFeeSettings({ documentFee: 280.01, crvFee: 1_000 }), DEFAULTS);
});

test("numbers and numeric strings with up to two decimals are kept as dollars", () => {
  assert.deepEqual(normalizeFeeSettings({ documentFee: 199, crvFee: 125.5 }), { documentFee: 199, crvFee: 125.5 });
  assert.deepEqual(normalizeFeeSettings({ documentFee: "199.99", crvFee: "125.50" }), { documentFee: 199.99, crvFee: 125.5 });
  assert.deepEqual(normalizeFeeSettings({ documentFee: " 150 ", crvFee: ".5" }), { documentFee: 150, crvFee: 0.5 });
  assert.deepEqual(normalizeFeeSettings({ documentFee: 0, crvFee: "0" }), { documentFee: 0, crvFee: 0 });
  assert.deepEqual(normalizeFeeSettings({ documentFee: "0.00", crvFee: -0 }), { documentFee: 0, crvFee: 0 });
});

test("values equal to the defaults are kept rather than dropped", () => {
  assert.deepEqual(normalizeFeeSettings({ documentFee: 280, crvFee: 34 }), { documentFee: 280, crvFee: 34 });
  assert.deepEqual(normalizeFeeSettings({ documentFee: "280.00", crvFee: "34" }), { documentFee: 280, crvFee: 34 });
});

test("out-of-range, negative, three-decimal, and malformed values become null", () => {
  for (const documentFee of [-1, -0.01, "-5", 280.01, "281", 1e3, 12.345, "12.345", "1e2", "$100", "1,000", "abc", "", "  ",
    Number.NaN, Number.POSITIVE_INFINITY, true, {}, [], [100]]) {
    assert.equal(normalizeFeeSettings({ documentFee, crvFee: 34 }).documentFee, null, `documentFee ${String(documentFee)}`);
  }
  for (const crvFee of [-34, 1_000, "999.991", 0.001, "1e1", "34 dollars", null, undefined, false]) {
    assert.equal(normalizeFeeSettings({ documentFee: 199, crvFee }).crvFee, null, `crvFee ${String(crvFee)}`);
  }
  assert.equal(normalizeFeeSettings({ documentFee: 199, crvFee: 999.99 }).documentFee, 199, "one bad field never drops the other");
});

test("non-object settings normalize to the all-default record", () => {
  for (const value of [undefined, null, "280", 34, true, []]) {
    assert.deepEqual(normalizeFeeSettings(value), DEFAULTS);
  }
  assert.deepEqual(normalizeFeeSettings({ documentFee: 150, extra: "ignored" }), { documentFee: 150, crvFee: null });
});

test("loading never throws and ignores missing, damaged, out-of-range, or blocked storage", () => {
  assert.deepEqual(loadFeeSettings(memoryStorage()), DEFAULTS);
  assert.deepEqual(loadFeeSettings(memoryStorage({ [FEE_STORAGE_KEY]: '{"documentFee": 1' })), DEFAULTS);
  assert.deepEqual(loadFeeSettings(memoryStorage({ [FEE_STORAGE_KEY]: "null" })), DEFAULTS);
  assert.deepEqual(loadFeeSettings(throwingStorage("SecurityError")), DEFAULTS);
  assert.deepEqual(loadFeeSettings(null), DEFAULTS);
  assert.deepEqual(loadFeeSettings(), DEFAULTS, "Node has no window.localStorage");
  const saved = memoryStorage({ [FEE_STORAGE_KEY]: JSON.stringify({ documentFee: 199, crvFee: 5_000 }) });
  assert.deepEqual(loadFeeSettings(saved), { documentFee: 199, crvFee: null });
});

test("saving stores the normalized record and an all-default record removes the key", () => {
  const storage = memoryStorage();
  assert.deepEqual(saveFeeSettings({ documentFee: "199.50", crvFee: 125.5 }, storage), { ok: true, settings: { documentFee: 199.5, crvFee: 125.5 } });
  assert.equal(storage.data.get(FEE_STORAGE_KEY), JSON.stringify({ documentFee: 199.5, crvFee: 125.5 }));
  assert.deepEqual(saveFeeSettings({ documentFee: null, crvFee: "" }, storage), { ok: true, settings: DEFAULTS });
  assert.equal(storage.data.has(FEE_STORAGE_KEY), false);
  assert.deepEqual(saveFeeSettings({ documentFee: 500, crvFee: -1 }, storage), { ok: true, settings: DEFAULTS }, "invalid values save as defaults");
  assert.equal(storage.data.has(FEE_STORAGE_KEY), false);
});

test("saved values round-trip through storage unchanged", () => {
  for (const settings of [
    { documentFee: 0, crvFee: 0 },
    { documentFee: 280, crvFee: 34 },
    { documentFee: 149.99, crvFee: null },
    { documentFee: null, crvFee: 999.99 },
    { documentFee: 0.01, crvFee: 125.5 },
  ]) {
    const storage = memoryStorage();
    assert.equal(saveFeeSettings(settings, storage).ok, true);
    assert.deepEqual(loadFeeSettings(storage), settings, JSON.stringify(settings));
  }
});

test("saving reports quota and unavailable storage instead of throwing", () => {
  assert.deepEqual(saveFeeSettings({ crvFee: 50 }, throwingStorage("QuotaExceededError")), { ok: false, reason: "quota", settings: { documentFee: null, crvFee: 50 } });
  assert.deepEqual(saveFeeSettings({ crvFee: 50 }, throwingStorage("SecurityError")), { ok: false, reason: "unavailable", settings: { documentFee: null, crvFee: 50 } });
  assert.deepEqual(saveFeeSettings({ crvFee: 50 }, null), { ok: false, reason: "unavailable", settings: { documentFee: null, crvFee: 50 } });
  const legacyQuota = { getItem: () => null, removeItem() {}, setItem() { const error = new Error("full"); error.code = 22; throw error; } };
  assert.equal(saveFeeSettings({ crvFee: 50 }, legacyQuota).reason, "quota");
});

test("clearing removes the saved fees and reports a blocked removal", () => {
  const storage = memoryStorage({ [FEE_STORAGE_KEY]: JSON.stringify({ documentFee: 199, crvFee: 50 }) });
  assert.deepEqual(clearFeeSettings(storage), { ok: true, settings: DEFAULTS });
  assert.equal(storage.data.has(FEE_STORAGE_KEY), false);
  assert.deepEqual(clearFeeSettings(throwingStorage("SecurityError")), { ok: false, reason: "unavailable", settings: DEFAULTS });
});

test("resolveFees fills in the policy defaults and flags any difference as custom", () => {
  const { documentFee: defaultDocumentFee, crvFee: defaultCrvFee } = POLICY_CONFIG.feeDefaults;
  assert.deepEqual(resolveFees(), { documentFee: defaultDocumentFee, crvFee: defaultCrvFee, isCustom: false });
  assert.deepEqual(resolveFees(DEFAULTS), { documentFee: 280, crvFee: 34, isCustom: false });
  assert.deepEqual(resolveFees({ documentFee: 280, crvFee: 34 }), { documentFee: 280, crvFee: 34, isCustom: false }, "explicit defaults are not custom");
  assert.deepEqual(resolveFees({ documentFee: 199 }), { documentFee: 199, crvFee: 34, isCustom: true });
  assert.deepEqual(resolveFees({ crvFee: 0 }), { documentFee: 280, crvFee: 0, isCustom: true });
  assert.deepEqual(resolveFees({ documentFee: "0", crvFee: "125.50" }), { documentFee: 0, crvFee: 125.5, isCustom: true });
  assert.deepEqual(resolveFees({ documentFee: 900, crvFee: -2 }), { documentFee: 280, crvFee: 34, isCustom: false }, "invalid values resolve to defaults");
});
