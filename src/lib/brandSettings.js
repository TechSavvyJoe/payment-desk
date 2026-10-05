// The optional dealership name and logo are the only things Payment Desk saves,
// and only in this browser. Customer figures are never stored.
export const BRAND_STORAGE_KEY = "payment-desk.dealership.v1";
export const DEFAULT_BRAND_NAME = "Payment Desk";
export const MAX_DEALERSHIP_NAME_LENGTH = 60;
export const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const empty = () => ({ name: "", logo: null });

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

export function normalizeBrandSettings(value) {
  if (!value || typeof value !== "object") return empty();
  const collapsed = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
  // Cut by code point so an emoji at the limit is never split in half.
  const name = [...collapsed].slice(0, MAX_DEALERSHIP_NAME_LENGTH).join("").trim();
  const logo = typeof value.logo === "string"
    && value.logo.length <= MAX_LOGO_DATA_URL_LENGTH
    && PNG_DATA_URL.test(value.logo) ? value.logo : null;
  return { name, logo };
}

export function loadBrandSettings(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(BRAND_STORAGE_KEY);
    return raw ? normalizeBrandSettings(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

export function saveBrandSettings(settings, storage = defaultStorage()) {
  const normalized = normalizeBrandSettings(settings);
  if (!storage) return { ok: false, reason: "unavailable", settings: normalized };
  try {
    if (!normalized.name && !normalized.logo) storage.removeItem(BRAND_STORAGE_KEY);
    else storage.setItem(BRAND_STORAGE_KEY, JSON.stringify(normalized));
    return { ok: true, settings: normalized };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable", settings: normalized };
  }
}

export function clearBrandSettings(storage = defaultStorage()) {
  return saveBrandSettings(empty(), storage);
}

export function resolveBrand(settings) {
  const { name, logo } = normalizeBrandSettings(settings);
  return { dealershipName: name, logo, isCustom: Boolean(name || logo), displayName: name || DEFAULT_BRAND_NAME };
}
