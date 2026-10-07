import { BRAND_STORAGE_KEY, saveBrandSettings } from "./brandSettings.js";
import { FEE_STORAGE_KEY, saveFeeSettings } from "./feeSettings.js";

// Settings saves from one dialog, so they save as one: if either the dealership
// record or the fee record cannot be written, the other is put back as it was.
// The device then keeps its previous settings in full, never half of the new ones.
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
  for (const [key, raw] of saved ?? []) {
    try {
      if (raw === null) storage.removeItem(key);
      else storage.setItem(key, raw);
    } catch {
      // The previous value fit before this save, so this only fails if storage is gone.
    }
  }
}

export function saveDeviceSettings(brand, fees, storage = defaultStorage()) {
  const saved = snapshot(storage);
  const brandOutcome = saveBrandSettings(brand, storage);
  const feeOutcome = saveFeeSettings(fees, storage);
  const ok = brandOutcome.ok && feeOutcome.ok;
  if (!ok) restore(storage, saved);
  return { ok, brand: brandOutcome.settings, fees: feeOutcome.settings };
}

export function clearDeviceSettings(storage = defaultStorage()) {
  return saveDeviceSettings(null, null, storage);
}
