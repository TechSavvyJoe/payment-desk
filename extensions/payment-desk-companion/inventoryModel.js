// Public vehicle data only. This catalog never contains customer or deal figures.
export const INVENTORY_KEY = 'payment-desk.inventory.v1';
export const NIGHT_ALARM = 'payment-desk-inventory-night';
export const WORK_ALARM = 'payment-desk-inventory-work';
export const MAX_PAGES = 80;
export const MAX_VEHICLES = 3000;
export const cleanText = (value, max = 180) => typeof value === 'string'
  ? value.replace(/[\p{Cc}\u200b-\u200d\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function dealershipSite(value) {
  const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)
    || /\.(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) {
    throw new Error('Enter a public HTTPS dealership website.');
  }
  url.hash = '';
  return url.href;
}
export function siteOrigins(site) {
  const host = new URL(dealershipSite(site)).hostname.replace(/^www\./, '');
  return [`https://${host}/*`, `https://www.${host}/*`];
}
export function inventoryUrl(value, site, base = site) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    dealershipSite(url.href);
    if (!siteOrigins(site).includes(`${url.origin}/*`)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
export function inventoryFeedUrl(value) {
  const path = new URL(value).pathname;
  return /\/(?:search(?:new|used|all)\.aspx|inventory(?:\/(?:new|used))?|new(?:-inventory)?|used(?:-inventory)?|pre-owned|cars-for-sale)(?:\/index\.htm)?\/?$/i.test(path)
    || /\/used-vehicle-inventory[^/]*\.html$/i.test(path);
}
export function unfilteredInventoryUrl(value, page = 1) {
  return [...new URL(value).searchParams].every(([key, value]) =>
    key.toLowerCase() === 'clearall' && value === '1'
    || key.toLowerCase() === 'page' && /^\d+$/.test(value) && Number(value) === page);
}
export function publicImage(value, site) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null;
  try { const url = new URL(value, site); return dealershipSite(url.href); }
  catch { return null; }
}
export function nextNightAt(now = Date.now()) {
  // Local calendar time handles daylight saving changes; a 24-hour interval does not.
  const current = new Date(now);
  let night = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 2);
  if (night.getTime() <= now) night = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, 2);
  return night.getTime();
}
export function refreshDue(state, now = Date.now()) {
  return Boolean(state?.config?.nightly && !state.job && now >= (state.nextRefreshAt ?? 0));
}
export function usdPrice(value) {
  const text = String(value ?? '').trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return number > 0 && number <= 1_000_000 ? number : null;
}
export function vehicleRecord(value, site, now) {
  const url = inventoryUrl(value.url, site);
  const name = cleanText(value.name);
  const vin = cleanText(value.vin, 17).toUpperCase();
  if (!url || !name || !/^(?:19|20)\d{2}\b/.test(name)) return null;
  const validVin = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : '';
  const stock = cleanText(value.stock, 40);
  const mileage = String(value.mileage ?? '').trim().replace(/,/g, '');
  const number = /^\d+(?:\.\d+)?$/.test(mileage) ? Number(mileage) : NaN;
  return {
    id: validVin || url, vin: validVin, stock, name, url,
    condition: /^(new|used|certified)$/i.test(value.condition) ? value.condition.toLowerCase() : 'unknown',
    year: Number(name.slice(0, 4)), make: cleanText(value.make, 40), model: cleanText(value.model, 60), trim: cleanText(value.trim, 90),
    price: value.currency === 'USD' ? usdPrice(value.price) : null,
    websitePrice: value.currency === 'USD' ? usdPrice(value.websitePrice) : null,
    msrp: value.currency === 'USD' ? usdPrice(value.msrp) : null,
    mileage: Number.isFinite(number) && number >= 0 && number <= 2_000_000 ? number : null,
    exterior: cleanText(value.exterior, 60), interior: cleanText(value.interior, 60), body: cleanText(value.body, 60), transmission: cleanText(value.transmission, 80),
    location: cleanText(value.location, 100), availability: cleanText(value.availability, 70) || 'Confirm availability',
    photos: [...new Set((value.photos ?? []).map(photo => publicImage(photo, site)).filter(Boolean))].slice(0, 12),
    features: (value.features ?? []).map(feature => cleanText(feature, 100)).filter(Boolean).slice(0, 30),
    priceNote: cleanText(value.priceNote, 300), lastSeenAt: now, listed: true,
  };
}
export function mergeInventory(previous, observed, complete) {
  const map = new Map(previous.map(vehicle => [vehicle.id, { ...vehicle, listed: complete ? false : vehicle.listed }]));
  observed.forEach(vehicle => map.set(vehicle.id, vehicle));
  // Preserve recently seen vehicles first. A partial run never implies a sale.
  const sorted = [...map.values()].sort((a, b) => Number(b.listed) - Number(a.listed) || b.lastSeenAt - a.lastSeenAt);
  if (complete) return sorted.slice(0, MAX_VEHICLES);
  const previousIds = new Set(previous.map(vehicle => vehicle.id));
  // On partial runs, capacity is filled by the old catalog first. A newly seen
  // vehicle must not evict a missing old vehicle just because a run was interrupted.
  return [...previous.map(vehicle => map.get(vehicle.id)), ...sorted.filter(vehicle => !previousIds.has(vehicle.id))].slice(0, MAX_VEHICLES);
}

export function robotsPolicy(text) {
  const groups = [];
  let group = { agents: [], rules: [], delay: 1 };
  let hadRule = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (hadRule) { groups.push(group); group = { agents: [], rules: [], delay: 1 }; hadRule = false; }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length && ['allow', 'disallow', 'crawl-delay'].includes(key)) {
      hadRule = true;
      if ((key === 'allow' || key === 'disallow') && value.startsWith('/')) group.rules.push({ allow: key === 'allow', path: value });
      if (key === 'crawl-delay' && Number.isFinite(Number(value))) group.delay = Math.min(60, Math.max(1, Number(value)));
    }
  }
  groups.push(group);
  // Fetch sends Chrome's ordinary user agent, not a named crawler identity.
  const selected = groups.filter(g => g.agents.includes('*'));
  return { rules: selected.flatMap(g => g.rules), delay: Math.max(1, ...selected.map(g => g.delay)) };
}
// RFC 9309 compares equivalent unreserved octets, while escaped reserved
// characters remain distinct. Normalize rules too, including UTF-8 paths.
const robotsPath = value => value.replace(/[\u0080-\u{10ffff}]/gu, character => encodeURIComponent(character)).replace(/%[0-9a-f]{2}/gi, encoded => {
  const character = String.fromCharCode(parseInt(encoded.slice(1), 16));
  return /[a-z0-9._~-]/i.test(character) ? character : encoded.toUpperCase();
});
const ruleLength = path => path.replace(/[*$]/g, '').replace(/%[0-9A-F]{2}/g, 'x').length;
export function robotsAllows(policy, url) {
  const parsed = new URL(url);
  const path = robotsPath(parsed.pathname + parsed.search).replace(/\*/g, '%2A').replace(/\$/g, '%24');
  const matches = (policy?.rules ?? []).map(rule => ({ ...rule, path: robotsPath(rule.path) })).filter(rule => {
    const pattern = rule.path.split('*').map(part => part.replace(/[.+?^{}()|[\]\\]/g, '\\$&')).join('.*').replace(/\$$/, '$');
    return new RegExp(`^${pattern}`).test(path);
  }).sort((a, b) => ruleLength(b.path) - ruleLength(a.path) || Number(b.allow) - Number(a.allow));
  return !matches.length || matches[0].allow;
}
