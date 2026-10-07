export const PAYMENT_DESK_URL = 'https://desking.mysoldlog.com/';
export const HANDOFF_PREFIX = '#pd-vehicle=';
export const MAX_PRICE = 1_000_000;
// eslint-disable-next-line no-control-regex -- Reject control and directional override characters at the import boundary.
const disallowedText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/** Only an advertised vehicle price and reference may cross into the worksheet. */
export function validateVehicle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return null;
  const { salePrice, vehicleDescription } = value;
  if (salePrice !== null && (typeof salePrice !== 'number' || !Number.isFinite(salePrice)
    || salePrice <= 0 || salePrice > MAX_PRICE || Math.abs(salePrice * 100 - Math.round(salePrice * 100)) > 0.000001)) return null;
  if (typeof vehicleDescription !== 'string' || vehicleDescription.length > 100
    || disallowedText.test(vehicleDescription)) return null;
  const reference = vehicleDescription.trim().replace(/\s+/gu, ' ');
  if (salePrice === null && !reference) return null;
  return { salePrice, vehicleDescription: reference };
}

export function parseVehicleHandoff(hash) {
  if (!hash.startsWith(HANDOFF_PREFIX)) return { vehicle: null, error: null };
  try {
    if (hash.length > 4096) throw new Error('Too long');
    const vehicle = validateVehicle(JSON.parse(decodeURIComponent(hash.slice(HANDOFF_PREFIX.length))));
    if (!vehicle) throw new Error('Invalid vehicle');
    return { vehicle, error: null };
  } catch {
    return { vehicle: null, error: 'These vehicle details could not be imported. Enter the selling price and vehicle reference manually.' };
  }
}

export function vehicleHandoffUrl(value) {
  const vehicle = validateVehicle({ ...value, version: 1 });
  if (!vehicle) throw new Error('Enter a vehicle reference or a valid selling price.');
  // A fragment is not included in the request to the hosting server.
  return PAYMENT_DESK_URL + HANDOFF_PREFIX + encodeURIComponent(JSON.stringify({ version: 1, ...vehicle }));
}

export function parseAdvertisedPrice(value) {
  const text = String(value ?? '').trim().replace(/^(?:USD\s*|\$\s*)/i, '').replace(/\s*USD$/i, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const price = Number(text.replaceAll(',', ''));
  return price > 0 && price <= MAX_PRICE ? price : null;
}
