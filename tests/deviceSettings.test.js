import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_STORAGE_KEY } from "../src/lib/brandSettings.js";
import { FEE_STORAGE_KEY } from "../src/lib/feeSettings.js";
import { clearDeviceSettings, saveDeviceSettings } from "../src/lib/deviceSettings.js";

const LOGO = `data:image/png;base64,${"A".repeat(400)}`;
// A storage that refuses any value longer than `limit`, the way a full quota does.
const limitedStorage = (initial = {}, limit = Infinity) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (String(value).length > limit) throw new DOMException("full", "QuotaExceededError");
      data.set(key, String(value));
    },
    removeItem: (key) => { data.delete(key); },
  };
};
const previous = {
  [BRAND_STORAGE_KEY]: JSON.stringify({ name: "Old Motors", logo: null }),
  [FEE_STORAGE_KEY]: JSON.stringify({ documentFee: 150, crvFee: 20 }),
};

test("both records save together", () => {
  const storage = limitedStorage();
  const outcome = saveDeviceSettings({ name: "Lakeside Ford", logo: LOGO }, { documentFee: 199, crvFee: 30 }, storage);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.fees, { documentFee: 199, crvFee: 30 });
  assert.equal(JSON.parse(storage.data.get(BRAND_STORAGE_KEY)).name, "Lakeside Ford");
  assert.deepEqual(JSON.parse(storage.data.get(FEE_STORAGE_KEY)), { documentFee: 199, crvFee: 30 });
});

test("a logo too large to store leaves the fees as they were, not half-saved", () => {
  const storage = limitedStorage(previous, 200);
  const outcome = saveDeviceSettings({ name: "Lakeside Ford", logo: LOGO }, { documentFee: 199, crvFee: 30 }, storage);
  assert.equal(outcome.ok, false);
  // The new values still come back, so they apply for this visit.
  assert.equal(outcome.brand.name, "Lakeside Ford");
  assert.deepEqual(outcome.fees, { documentFee: 199, crvFee: 30 });
  assert.equal(storage.data.get(BRAND_STORAGE_KEY), previous[BRAND_STORAGE_KEY]);
  assert.equal(storage.data.get(FEE_STORAGE_KEY), previous[FEE_STORAGE_KEY]);
});

test("a fee write that fails puts the dealership record back, including removing a new one", () => {
  const storage = limitedStorage();
  storage.setItem = ((set) => (key, value) => {
    if (key === FEE_STORAGE_KEY) throw new DOMException("blocked", "SecurityError");
    set(key, value);
  })(storage.setItem);
  const outcome = saveDeviceSettings({ name: "Lakeside Ford", logo: null }, { documentFee: 199, crvFee: null }, storage);
  assert.equal(outcome.ok, false);
  assert.equal(storage.data.has(BRAND_STORAGE_KEY), false);
  assert.equal(storage.data.has(FEE_STORAGE_KEY), false);
});

test("clearing removes both records, and blocked storage reports failure without throwing", () => {
  const storage = limitedStorage(previous);
  assert.equal(clearDeviceSettings(storage).ok, true);
  assert.equal(storage.data.size, 0);
  assert.equal(saveDeviceSettings({ name: "X" }, { documentFee: 1 }, null).ok, false);
  assert.equal(clearDeviceSettings().ok, false, "Node has no window.localStorage");
});
