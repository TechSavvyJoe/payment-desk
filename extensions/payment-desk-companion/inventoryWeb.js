import { INVENTORY_KEY, MAX_VEHICLES, cleanText, dealershipSite, vehicleRecord } from './inventoryModel.js';
import { PAYMENT_DESK_URL } from './vehicleHandoff.js';

export const COMPANION_PREFIX = '#pd-companion=';
export const CATALOG_PAGE_SIZE = 100;

export function isInventoryWebSender(sender) {
  try {
    const origin = new URL(PAYMENT_DESK_URL).origin;
    return !sender.id && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0
      && sender.origin === origin && new URL(sender.url).origin === origin;
  } catch { return false; }
}

function publicVehicle(value, site) {
  if (!value || typeof value !== 'object') return null;
  const seen = Number.isFinite(value.lastSeenAt) && value.lastSeenAt > 0 ? value.lastSeenAt : 0;
  const vehicle = vehicleRecord({ ...value, currency: 'USD',
    photos: [], features: Array.isArray(value.features) ? value.features : [],
  }, site, seen);
  return vehicle ? { ...vehicle, listed: value.listed === true } : null;
}

// A bounded, read-only projection. Customer/deal fields, credentials, settings,
// refresh queues and website permission controls never cross this boundary.
export function catalogPage(state, request = {}) {
  let site = '';
  try { site = dealershipSite(state.config?.site ?? ''); } catch { /* Not connected. */ }
  const query = cleanText(request.query, 80).toLowerCase();
  const condition = ['new', 'used'].includes(request.condition) ? request.condition : '';
  const offset = Number.isInteger(request.offset) && request.offset >= 0 ? Math.min(request.offset, MAX_VEHICLES) : 0;
  const vehicles = site && Array.isArray(state.vehicles) ? state.vehicles.slice(0, MAX_VEHICLES)
    .map(value => publicVehicle(value, site)).filter(Boolean)
    .filter(vehicle => (request.includeOld === true || vehicle.listed)
      && (!condition || vehicle.condition === condition || condition === 'used' && vehicle.condition === 'certified')
      && [vehicle.name, vehicle.vin, vehicle.stock].join(' ').toLowerCase().includes(query)) : [];
  return {
    ok: true, version: 1, site, vehicles: vehicles.slice(offset, offset + CATALOG_PAGE_SIZE), total: vehicles.length,
    nextOffset: offset + CATALOG_PAGE_SIZE < vehicles.length ? offset + CATALOG_PAGE_SIZE : null,
    lastCompletedAt: Number.isFinite(state.lastCompletedAt) ? state.lastCompletedAt : null,
    refreshing: Boolean(state.job), error: cleanText(state.error, 500),
  };
}

export function validateCatalogPage(value) {
  if (!value?.ok || value.version !== 1 || !Array.isArray(value.vehicles) || value.vehicles.length > CATALOG_PAGE_SIZE) return null;
  let site = '';
  try { if (value.site) site = dealershipSite(value.site); } catch { return null; }
  const vehicles = value.vehicles.map(vehicle => publicVehicle(vehicle, site)).filter(Boolean);
  return { ok: true, version: 1, site, vehicles,
    total: Number.isInteger(value.total) && value.total >= 0 && value.total <= MAX_VEHICLES ? value.total : vehicles.length,
    nextOffset: Number.isInteger(value.nextOffset) && value.nextOffset > 0 && value.nextOffset < MAX_VEHICLES ? value.nextOffset : null,
    lastCompletedAt: Number.isFinite(value.lastCompletedAt) ? value.lastCompletedAt : null,
    refreshing: value.refreshing === true, error: cleanText(value.error, 500),
  };
}

export function installInventoryWeb() {
  const respondToCatalog = (message, respond) => {
    if (message?.target !== 'inventory.catalog' || message.action !== 'read') return;
    chrome.storage.local.get(INVENTORY_KEY).then(saved => respond(catalogPage(saved[INVENTORY_KEY] ?? {}, message)),
      () => respond({ ok: false, error: 'The saved inventory could not be read.' }));
    return true;
  };
  chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
    if (!isInventoryWebSender(sender)) return;
    return respondToCatalog(message, respond);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('desk/'))) return;
    return respondToCatalog(message, respond);
  });
}
