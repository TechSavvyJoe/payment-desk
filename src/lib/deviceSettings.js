import { BRAND_STORAGE_KEY, normalizeBrandSettings, saveBrandSettings } from "./brandSettings.js";
import { FEE_STORAGE_KEY, normalizeFeeSettings, saveFeeSettings } from "./feeSettings.js";

// Best-effort rollback of two synchronous writes, not crash-atomic persistence.
const KEYS = [BRAND_STORAGE_KEY, FEE_STORAGE_KEY];

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(storage) {
  try {
    return KEYS.map((key) => [key, storage?.getItem(key) ?? null]);
  } catch {
    return null;
  }
}

function restore(storage, saved) {
  const failed = [];
  // Free any newly enlarged values first, so aggregate quota can restore the
  // original pair. Avoid touching keys that already match the snapshot.
  const changed = saved.filter(([key, raw]) => {
    try { return storage.getItem(key) !== raw; } catch { return true; }
  });
  for (const [key] of changed) {
    try { storage.removeItem(key); } catch { /* Verify restoration below. */ }
  }
  for (const [key, raw] of changed) {
    try {
      if (raw === null) storage.removeItem(key);
      else storage.setItem(key, raw);
    } catch { /* Verify the final bytes, including failed removals. */ }
  }
  for (const [key, raw] of saved) {
    try { if (storage.getItem(key) !== raw) failed.push(key); }
    catch { failed.push(key); }
  }
  return failed;
}

export function saveDeviceSettings(brand, fees, storage = defaultStorage()) {
  const normalized = { brand: normalizeBrandSettings(brand), fees: normalizeFeeSettings(fees) };
  const saved = storage ? snapshot(storage) : null;
  if (!saved) return { ok: false, ...normalized, persistence: storage ? "snapshot-failed" : "unavailable", rollbackOk: null, rollbackFailedKeys: [] };
  const brandOutcome = saveBrandSettings(brand, storage);
  const feeOutcome = brandOutcome.ok ? saveFeeSettings(fees, storage) : { ok: false };
  const ok = brandOutcome.ok && feeOutcome.ok;
  const rollbackFailedKeys = ok ? [] : restore(storage, saved);
  return { ok, ...normalized, persistence: ok ? "saved" : rollbackFailedKeys.length ? "rollback-failed" : "rolled-back",
    rollbackOk: ok ? null : rollbackFailedKeys.length === 0, rollbackFailedKeys };
}

export function clearDeviceSettings(storage = defaultStorage()) {
  return saveDeviceSettings(null, null, storage);
}
