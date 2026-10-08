const currencyFormatters = Array(4);
const numberFormatters = Array(21);

export const formatCurrency = (value, { cents = false, sign = false } = {}) => {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const hasCents = Math.abs(numeric - Math.round(numeric)) > 0.0001;
  const digits = cents || hasCents ? 2 : 0;
  const key = digits + (sign ? 1 : 0);
  const formatter = currencyFormatters[key] ??= new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: sign ? "always" : "auto",
  });
  const formatted = formatter.format(numeric);

  return formatted.replace("+$", "+$").replace("-$", "−$");
};

export const formatWholeCurrency = (value, { sign = false } = {}) =>
  formatCurrency(Math.round(Number(value) || 0), { sign });

export const formatNumber = (value, digits = 2) => {
  // Other precisions still go through Intl, preserving coercion and range errors.
  const cacheable = typeof digits === "number" && Number.isInteger(digits) && digits >= 0 && digits <= 20;
  let formatter = cacheable ? numberFormatters[digits] : undefined;
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    if (cacheable) numberFormatters[digits] = formatter;
  }
  return formatter.format(Number(value) || 0);
};

const isCalendarDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Format an ISO calendar date without moving it across time zones. */
export function formatShortDate(isoDate) {
  if (!isCalendarDate(isoDate)) throw new RangeError('A valid ISO calendar date is required.');
  return `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}/${isoDate.slice(2, 4)}`;
}

/** Two-digit entry years explicitly represent 2000–2099. */
export function parseShortDate(raw) {
  const text = String(raw ?? '').trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text);
  const value = match ? `20${match[3]}-${match[1]}-${match[2]}` : null;
  return value && isCalendarDate(value)
    ? { value }
    : { error: 'Enter a valid date as MM/DD/YY (years 2000–2099).' };
}
