import { POLICY_CONFIG } from "./policy.js";

// The dealership's document and CRV fees, saved per device next to the
// dealership name and logo. Amounts are dollars; null means the policy default.
// calculateDeal applies the legal caps again, so a bad value can never raise a fee.
export const FEE_STORAGE_KEY = "payment-desk.fees.v1";
export const CRV_FEE_MAXIMUM = 999.99;
export const DOCUMENT_FEE_MAXIMUM = POLICY_CONFIG.documentFeeMaximum;
export const FEE_DEFAULTS = Object.freeze({
  documentFee: POLICY_CONFIG.feeDefaults.documentFee,
  crvFee: POLICY_CONFIG.feeDefaults.crvFee,
});

const empty = () => ({ documentFee: null, crvFee: null });
const AMOUNT = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;

// Safari private mode and blocked site data throw on access, not only on write.
function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isQuotaError = (error) => error?.name === "QuotaExceededError"
  || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
  || error?.code === 22
  || error?.code === 1014;

/** A dollar amount from 0 to `maximum` with at most two decimals, or null. */
function normalizeAmount(value, maximum) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  if (!AMOUNT.test(text)) return null;
  const amount = Number(text);
  return amount >= 0 && amount <= maximum ? amount : null;
}

export function normalizeFeeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty();
  return {
    documentFee: normalizeAmount(value.documentFee, DOCUMENT_FEE_MAXIMUM),
    crvFee: normalizeAmount(value.crvFee, CRV_FEE_MAXIMUM),
  };
}

export function loadFeeSettings(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(FEE_STORAGE_KEY);
    return raw ? normalizeFeeSettings(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

export function saveFeeSettings(settings, storage = defaultStorage()) {
  const normalized = normalizeFeeSettings(settings);
  if (!storage) return { ok: false, reason: "unavailable", settings: normalized };
  try {
    if (normalized.documentFee === null && normalized.crvFee === null) storage.removeItem(FEE_STORAGE_KEY);
    else storage.setItem(FEE_STORAGE_KEY, JSON.stringify(normalized));
    return { ok: true, settings: normalized };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable", settings: normalized };
  }
}

export function clearFeeSettings(storage = defaultStorage()) {
  return saveFeeSettings(empty(), storage);
}

/** The fees to charge, with the defaults filled in. */
export function resolveFees(settings) {
  const { documentFee, crvFee } = normalizeFeeSettings(settings);
  const resolved = {
    documentFee: documentFee ?? FEE_DEFAULTS.documentFee,
    crvFee: crvFee ?? FEE_DEFAULTS.crvFee,
  };
  return {
    ...resolved,
    isCustom: resolved.documentFee !== FEE_DEFAULTS.documentFee || resolved.crvFee !== FEE_DEFAULTS.crvFee,
  };
}
