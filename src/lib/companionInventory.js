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

function abortError() {
  return new DOMException('The inventory request was cancelled.', 'AbortError');
}

function requestCatalog(id, query, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  const runtime = globalThis.chrome?.runtime;
  if (!id || !runtime?.sendMessage) return Promise.reject(new Error('Open Payment Desk Companion in Chrome and select Web app to connect this browser. Then open inventory here.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    // Loaded Chrome profiles can take over 16 seconds to read local storage.
    const timer = setTimeout(() => settle(reject, new Error('The companion did not respond. Reload it in Chrome’s Extensions page, then try again.')), 45_000);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => settle(reject, abortError());
    const callback = result => {
      const error = runtime.lastError;
      if (settled) return;
      if (error) { settle(reject, new Error('The companion is unavailable. Open the updated companion and select Web app, then try again.')); return; }
      if (result?.ok === false && result.code === 'storage_unavailable') {
        settle(reject, new Error('The companion could not read its saved inventory from Chrome storage. Check Chrome storage availability, then retry.'));
        return;
      }
      if (result?.ok === false && result.code === 'catalog_changed') {
        settle(reject, new Error('Inventory changed while you were browsing. Select Reload catalog to start with the updated vehicles.'));
        return;
      }
      const page = validateCatalogPage(result);
      if (!page) { settle(reject, new Error('The companion could not provide inventory. Update the companion and try again.')); return; }
      settle(resolve, page);
    };
    const message = { target: 'inventory.catalog', action: 'read', ...query };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (runtime.id === id) runtime.sendMessage(message, callback);
      else runtime.sendMessage(id, message, callback);
    } catch { settle(reject, new Error('The companion is unavailable in this browser. Use Chrome with Payment Desk Companion installed.')); }
  });
}

export async function readCompanionInventory(query, { signal } = {}) {
  const previous = companionId();
  let fallback = previous;
  const candidate = pendingConnection;
  if (candidate) {
    if (signal?.aborted) throw abortError();
    candidate.attempts++;
    let cancelled = false;
    try {
      const page = await requestCatalog(candidate.id, query, signal);
      if (signal?.aborted) throw abortError();
      if (pendingConnection === candidate) {
        pendingConnection = null;
        // Save only the confirmed public identifier, never inventory/deal data.
        window.paymentDeskCompanionId = candidate.id;
        try { window.localStorage.setItem(STORAGE_KEY, candidate.id); } catch { /* This visit still works. */ }
      }
      return page;
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') { cancelled = true; throw error; }
      const confirmed = companionId();
      if (!confirmed || confirmed === candidate.id && confirmed === previous) throw error;
      fallback = confirmed;
      // A broken connection link must not disable the saved companion.
    } finally {
      candidate.attempts--;
      // An earlier failed filter read cannot invalidate another pending read.
      // A filter change or closing the picker cancels only this read. Keep the
      // scrubbed link's candidate available for the user's next attempt.
      if (!candidate.attempts && !cancelled && pendingConnection === candidate) pendingConnection = null;
    }
  }
  return requestCatalog(fallback, query, signal);
}
