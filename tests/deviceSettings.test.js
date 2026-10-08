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

test("a failed snapshot stops all writes and returns normalized visit settings", () => {
  for (const deniedKey of [BRAND_STORAGE_KEY, FEE_STORAGE_KEY]) {
    const storage = limitedStorage(previous);
    const get = storage.getItem;
    let mutations = 0;
    storage.getItem = key => { if (key === deniedKey) throw new Error("snapshot denied"); return get(key); };
    storage.setItem = storage.removeItem = () => { mutations++; };
    const outcome = saveDeviceSettings({ name: "  Visit  Motors " }, { documentFee: "199", crvFee: 30 }, storage);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.persistence, "snapshot-failed");
    assert.equal(outcome.rollbackOk, null);
    assert.equal(outcome.brand.name, "Visit Motors");
    assert.deepEqual(outcome.fees, { documentFee: 199, crvFee: 30 });
    assert.equal(mutations, 0);
    assert.deepEqual(Object.fromEntries(storage.data), previous);
    assert.equal(clearDeviceSettings(storage).persistence, "snapshot-failed");
    assert.equal(mutations, 0);
  }
});

test("second-write failure restores exact previous bytes and reports verified rollback", () => {
  const storage = limitedStorage(previous);
  const set = storage.setItem;
  storage.setItem = (key, raw) => {
    if (key === FEE_STORAGE_KEY && raw !== previous[key]) throw new Error("fee denied");
    set(key, raw);
  };
  const outcome = saveDeviceSettings({ name: "New Motors" }, { documentFee: 199, crvFee: 30 }, storage);
  assert.equal(outcome.persistence, "rolled-back");
  assert.equal(outcome.rollbackOk, true);
  assert.deepEqual(outcome.rollbackFailedKeys, []);
  assert.deepEqual(Object.fromEntries(storage.data), previous);
});

test("failed removal rolls back a clear rather than claiming successful cleanup", () => {
  const storage = limitedStorage(previous);
  const remove = storage.removeItem;
  storage.removeItem = key => { if (key === FEE_STORAGE_KEY) throw new Error("removal denied"); remove(key); };
  const outcome = clearDeviceSettings(storage);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.persistence, "rolled-back");
  assert.deepEqual(Object.fromEntries(storage.data), previous);
});

test("denied rollback reports incomplete persistence and the affected key", () => {
  const storage = limitedStorage(previous);
  const set = storage.setItem;
  storage.setItem = (key, raw) => {
    if (key === FEE_STORAGE_KEY || raw === previous[BRAND_STORAGE_KEY]) throw new Error("denied");
    set(key, raw);
  };
  storage.removeItem = () => { throw new Error("removal denied"); };
  const outcome = saveDeviceSettings({ name: "New Motors" }, { documentFee: 199 }, storage);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.persistence, "rollback-failed");
  assert.equal(outcome.rollbackOk, false);
  assert.deepEqual(outcome.rollbackFailedKeys, [BRAND_STORAGE_KEY]);
  assert.equal(JSON.parse(storage.data.get(BRAND_STORAGE_KEY)).name, "New Motors");
  assert.equal(storage.data.get(FEE_STORAGE_KEY), previous[FEE_STORAGE_KEY]);
});

test("aggregate quota failure restores the original pair without requiring extra capacity", () => {
  const storage = limitedStorage(previous);
  const newBrand = { name: "A somewhat longer dealership name", logo: null };
  const newFees = { documentFee: 199.99, crvFee: 999.99 };
  const capacity = JSON.stringify(newBrand).length + previous[FEE_STORAGE_KEY].length;
  storage.setItem = (key, value) => {
    const candidate = new Map(storage.data); candidate.set(key, String(value));
    const size = [...candidate.values()].reduce((sum, raw) => sum + raw.length, 0);
    if (size > capacity) throw new DOMException("aggregate full", "QuotaExceededError");
    storage.data.set(key, String(value));
  };
  const outcome = saveDeviceSettings(newBrand, newFees, storage);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.persistence, "rolled-back");
  assert.equal(outcome.rollbackOk, true);
  assert.deepEqual(Object.fromEntries(storage.data), previous);
});
