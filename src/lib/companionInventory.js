import { COMPANION_PREFIX, validateCatalogPage } from '../../extensions/payment-desk-companion/inventoryWeb.js';

const STORAGE_KEY = 'payment-desk.companion.v1';
const validId = value => typeof value === 'string' && /^[a-p]{32}$/.test(value);

export function rememberCompanion() {
  if (!window.location.hash.startsWith(COMPANION_PREFIX)) return;
  const id = window.location.hash.slice(COMPANION_PREFIX.length);
  if (validId(id)) {
    // Only the public extension identifier is saved, never inventory/deal data.
    window.paymentDeskCompanionId = id;
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* This visit still works. */ }
  }
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

function companionId() {
  if (validId(globalThis.chrome?.runtime?.id)) return globalThis.chrome.runtime.id;
  if (validId(window.paymentDeskCompanionId)) return window.paymentDeskCompanionId;
  try { const id = window.localStorage.getItem(STORAGE_KEY); return validId(id) ? id : null; } catch { return null; }
}

export function readCompanionInventory(query) {
  const id = companionId();
  const runtime = globalThis.chrome?.runtime;
  if (!id || !runtime?.sendMessage) return Promise.reject(new Error('Open Payment Desk Companion in Chrome and select Web app to connect this browser. Then open inventory here.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The companion did not respond. Reload it in Chrome’s Extensions page, then try again.')), 10_000);
    const callback = result => {
      clearTimeout(timer);
      if (runtime.lastError) { reject(new Error('The companion is unavailable. Open the updated companion and select Web app, then try again.')); return; }
      const page = validateCatalogPage(result);
      if (!page) { reject(new Error('The companion could not provide inventory. Update the companion and try again.')); return; }
      resolve(page);
    };
    const message = { target: 'inventory.catalog', action: 'read', ...query };
    try {
      if (runtime.id === id) runtime.sendMessage(message, callback);
      else runtime.sendMessage(id, message, callback);
    } catch { clearTimeout(timer); reject(new Error('The companion is unavailable in this browser. Use Chrome with Payment Desk Companion installed.')); }
  });
}
