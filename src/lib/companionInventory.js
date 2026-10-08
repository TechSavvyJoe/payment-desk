import { COMPANION_PREFIX, validateCatalogPage } from '../../extensions/payment-desk-companion/inventoryWeb.js';

const STORAGE_KEY = 'payment-desk.companion.v1';
const validId = value => typeof value === 'string' && /^[a-p]{32}$/.test(value);
let pendingConnection = null;

export function rememberCompanion() {
  if (!window.location.hash.startsWith(COMPANION_PREFIX)) return;
  const id = window.location.hash.slice(COMPANION_PREFIX.length);
  // Treat the link as a candidate. A valid catalog response must confirm it
  // before it can replace an already working companion connection.
  pendingConnection = validId(id) ? { id, attempts: 0 } : null;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

function companionId() {
  if (validId(globalThis.chrome?.runtime?.id)) return globalThis.chrome.runtime.id;
  if (validId(window.paymentDeskCompanionId)) return window.paymentDeskCompanionId;
  try { const id = window.localStorage.getItem(STORAGE_KEY); return validId(id) ? id : null; } catch { return null; }
}

function requestCatalog(id, query) {
  const runtime = globalThis.chrome?.runtime;
  if (!id || !runtime?.sendMessage) return Promise.reject(new Error('Open Payment Desk Companion in Chrome and select Web app to connect this browser. Then open inventory here.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    // Loaded Chrome profiles can take over 16 seconds to read local storage.
    const timer = setTimeout(() => { settled = true; reject(new Error('The companion did not respond. Reload it in Chrome’s Extensions page, then try again.')); }, 45_000);
    const callback = result => {
      const error = runtime.lastError;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { reject(new Error('The companion is unavailable. Open the updated companion and select Web app, then try again.')); return; }
      if (result?.ok === false && result.code === 'catalog_changed') {
        reject(new Error('Inventory changed while you were browsing. Select Reload catalog to start with the updated vehicles.'));
        return;
      }
      const page = validateCatalogPage(result);
      if (!page) { reject(new Error('The companion could not provide inventory. Update the companion and try again.')); return; }
      resolve(page);
    };
    const message = { target: 'inventory.catalog', action: 'read', ...query };
    try {
      if (runtime.id === id) runtime.sendMessage(message, callback);
      else runtime.sendMessage(id, message, callback);
    } catch { settled = true; clearTimeout(timer); reject(new Error('The companion is unavailable in this browser. Use Chrome with Payment Desk Companion installed.')); }
  });
}

export async function readCompanionInventory(query) {
  const previous = companionId();
  let fallback = previous;
  const candidate = pendingConnection;
  if (candidate) {
    candidate.attempts++;
    try {
      const page = await requestCatalog(candidate.id, query);
      if (pendingConnection === candidate) {
        pendingConnection = null;
        // Save only the confirmed public identifier, never inventory/deal data.
        window.paymentDeskCompanionId = candidate.id;
        try { window.localStorage.setItem(STORAGE_KEY, candidate.id); } catch { /* This visit still works. */ }
      }
      return page;
    } catch (error) {
      const confirmed = companionId();
      if (!confirmed || confirmed === candidate.id && confirmed === previous) throw error;
      fallback = confirmed;
      // A broken connection link must not disable the saved companion.
    } finally {
      candidate.attempts--;
      // An earlier failed filter read cannot invalidate another pending read.
      if (!candidate.attempts && pendingConnection === candidate) pendingConnection = null;
    }
  }
  return requestCatalog(fallback, query);
}
