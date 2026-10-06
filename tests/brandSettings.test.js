import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_STORAGE_KEY, DEFAULT_BRAND_NAME, MAX_DEALERSHIP_NAME_LENGTH, MAX_LOGO_DATA_URL_LENGTH,
  clearBrandSettings, loadBrandSettings, normalizeBrandSettings, resolveBrand, saveBrandSettings,
} from "../src/lib/brandSettings.js";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";
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

test("names are collapsed, trimmed, and cut to 60 characters without splitting emoji", () => {
  assert.equal(normalizeBrandSettings({ name: "  Lakeside \n  Motors\t" }).name, "Lakeside Motors");
  assert.equal(normalizeBrandSettings({ name: "W".repeat(80) }).name, "W".repeat(MAX_DEALERSHIP_NAME_LENGTH));
  const emojiName = "A".repeat(59) + "🚗🚗";
  assert.equal(normalizeBrandSettings({ name: emojiName }).name, "A".repeat(59) + "🚗");
  assert.equal(normalizeBrandSettings({ name: "   " }).name, "");
  assert.equal(normalizeBrandSettings({ name: 42 }).name, "");
});

test("zero-width and format characters are stripped so they cannot leave an invisible name", () => {
  assert.equal(normalizeBrandSettings({ name: "\u200B\u200C\u200D\u2060\uFEFF" }).name, "");
  assert.equal(normalizeBrandSettings({ name: "Lake\u200Bside" }).name, "Lakeside");
  assert.equal(resolveBrand({ name: "\u200B\uFEFF" }).isCustom, false);
});

test("only PNG data URLs within the size limit are accepted as logos", () => {
  assert.equal(normalizeBrandSettings({ logo: LOGO }).logo, LOGO);
  for (const logo of [
    "data:image/jpeg;base64,/9j/4AAQ",
    "javascript:alert(1)",
    "https://example.test/logo.png",
    "data:image/png;base64,<script>",
    "data:image/png;base64," + "A".repeat(MAX_LOGO_DATA_URL_LENGTH),
    42,
  ]) assert.equal(normalizeBrandSettings({ logo }).logo, null, String(logo).slice(0, 40));
});

test("non-object settings normalize to the empty record", () => {
  for (const value of [undefined, null, "Lakeside", 7, true]) {
    assert.deepEqual(normalizeBrandSettings(value), { name: "", logo: null });
  }
});

test("loading never throws and ignores missing, damaged, or blocked storage", () => {
  assert.deepEqual(loadBrandSettings(memoryStorage()), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(memoryStorage({ [BRAND_STORAGE_KEY]: '{"name": "Broken' })), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(throwingStorage("SecurityError")), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(null), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(), { name: "", logo: null }, "Node has no window.localStorage");
  const saved = memoryStorage({ [BRAND_STORAGE_KEY]: JSON.stringify({ name: " Lakeside Motors ", logo: LOGO, extra: true }) });
  assert.deepEqual(loadBrandSettings(saved), { name: "Lakeside Motors", logo: LOGO });
});

test("saving stores the normalized record and an empty record removes the key", () => {
  const storage = memoryStorage();
  assert.deepEqual(saveBrandSettings({ name: "  Lakeside  Motors ", logo: LOGO }, storage), { ok: true, settings: { name: "Lakeside Motors", logo: LOGO } });
  assert.equal(storage.data.get(BRAND_STORAGE_KEY), JSON.stringify({ name: "Lakeside Motors", logo: LOGO }));
  assert.deepEqual(saveBrandSettings({ name: "   ", logo: "javascript:alert(1)" }, storage), { ok: true, settings: { name: "", logo: null } });
  assert.equal(storage.data.has(BRAND_STORAGE_KEY), false);
});

test("saving reports quota and unavailable storage instead of throwing", () => {
  assert.deepEqual(saveBrandSettings({ name: "Lakeside" }, throwingStorage("QuotaExceededError")), { ok: false, reason: "quota", settings: { name: "Lakeside", logo: null } });
  assert.deepEqual(saveBrandSettings({ name: "Lakeside" }, throwingStorage("SecurityError")), { ok: false, reason: "unavailable", settings: { name: "Lakeside", logo: null } });
  assert.deepEqual(saveBrandSettings({ name: "Lakeside" }, null), { ok: false, reason: "unavailable", settings: { name: "Lakeside", logo: null } });
});

test("clearing removes the saved dealership", () => {
  const storage = memoryStorage({ [BRAND_STORAGE_KEY]: JSON.stringify({ name: "Lakeside", logo: null }) });
  assert.deepEqual(clearBrandSettings(storage), { ok: true, settings: { name: "", logo: null } });
  assert.equal(storage.data.has(BRAND_STORAGE_KEY), false);
  assert.equal(clearBrandSettings(throwingStorage("SecurityError")).ok, false);
});

test("resolveBrand falls back to Payment Desk and marks any saved name or logo as custom", () => {
  assert.deepEqual(resolveBrand(), { dealershipName: "", logo: null, isCustom: false, displayName: DEFAULT_BRAND_NAME });
  assert.deepEqual(resolveBrand({ name: "Lakeside Motors" }), { dealershipName: "Lakeside Motors", logo: null, isCustom: true, displayName: "Lakeside Motors" });
  assert.deepEqual(resolveBrand({ logo: LOGO }), { dealershipName: "", logo: LOGO, isCustom: true, displayName: "Payment Desk" });
  assert.deepEqual(resolveBrand({ name: "   ", logo: "javascript:alert(1)" }), { dealershipName: "", logo: null, isCustom: false, displayName: "Payment Desk" });
});

test("a PNG logo of exactly the maximum length is kept and one character more is rejected", () => {
  const prefix = "data:image/png;base64,";
  const exact = prefix + "A".repeat(MAX_LOGO_DATA_URL_LENGTH - prefix.length);
  assert.equal(exact.length, MAX_LOGO_DATA_URL_LENGTH);
  assert.equal(normalizeBrandSettings({ logo: exact }).logo, exact);
  assert.equal(normalizeBrandSettings({ logo: exact + "A" }).logo, null);
});

test("a stored record with a bad logo keeps the name and drops the logo", () => {
  const storage = memoryStorage({ [BRAND_STORAGE_KEY]: JSON.stringify({ name: "Lakeside", logo: "javascript:alert(1)" }) });
  assert.deepEqual(loadBrandSettings(storage), { name: "Lakeside", logo: null });
});
