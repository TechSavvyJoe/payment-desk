import { INVENTORY_KEY, MAX_PAGES, MAX_VEHICLES, NIGHT_ALARM, WORK_ALARM, dealershipSite, inventoryFeedUrl, inventoryUrl, mergeInventory, nextNightAt, refreshDue, robotsAllows, robotsPolicy, siteOrigins, unfilteredInventoryUrl } from './inventoryModel.js';

let running;
let mutation = Promise.resolve();
let creatingParser;
const read = async () => (await chrome.storage.local.get(INVENTORY_KEY))[INVENTORY_KEY] ?? {};
const write = state => {
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 7_000_000) throw new Error('The inventory reached this device’s catalog storage limit. The previous catalog and earlier pages were kept.');
  return chrome.storage.local.set({ [INVENTORY_KEY]: state });
};
// Serialize only storage transactions. Network waits never block Disconnect.
const transaction = fn => {
  const result = mutation.then(async () => fn(await read()));
  mutation = result.catch(() => {});
  return result;
};
async function ensureParser() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('inventory-offscreen.html')] });
  if (contexts.length) return;
  if (!creatingParser) creatingParser = chrome.offscreen.createDocument({ url: 'inventory-offscreen.html', reasons: ['DOM_PARSER'], justification: 'Read public dealership inventory as inert markup without opening tabs or running website scripts.' }).finally(() => { creatingParser = null; });
  await creatingParser;
}
async function schedule(state) {
  if (state.config?.nightly) await chrome.alarms.create(NIGHT_ALARM, { when: state.nextRefreshAt ?? nextNightAt() });
  else await chrome.alarms.clear(NIGHT_ALARM);
  if (state.job) await chrome.alarms.create(WORK_ALARM, { delayInMinutes: 1 });
  else await chrome.alarms.clear(WORK_ALARM);
}
function newJob(config) {
  return { id: crypto.randomUUID(), startedAt: Date.now(), queue: [{ url: config.site, kind: 'robots' }, { url: config.site, kind: 'html', condition: 'unknown' }], visited: [], vehicles: [], groups: {}, policies: {}, warnings: [], provider: '', nextRequestAt: 0 };
}
async function releaseWebsite(site) {
  // Chrome cannot withdraw permissions required by a manifest. Production uses
  // optional hosts; explicit required hosts may exist in an enterprise/test build.
  const required = chrome.runtime.getManifest().host_permissions ?? [];
  const origins = siteOrigins(site).filter(origin => !required.includes(origin) && !required.includes('https://*/*') && !required.includes('<all_urls>'));
  const access = await Promise.all(origins.map(origin => chrome.permissions.contains({ origins: [origin] })));
  const granted = origins.filter((_origin, index) => access[index]);
  if (granted.length && !await chrome.permissions.remove({ origins: granted })) throw new Error('Website access could not be removed.');
}
async function startRefresh() {
  const state = await transaction(async state => {
    if (!state.config || state.job) return state;
    const next = { ...state, job: newJob(state.config), status: 'syncing', error: '', lastAttemptAt: Date.now(), nextRefreshAt: nextNightAt() };
    await write(next);
    return next;
  });
  await schedule(state);
  void pump();
}

async function inventoryResponse(url) {
  // Fetch deliberately stops at redirects. Chrome's read-only network event
  // supplies the hidden Location header for this worker's own request only.
  // No browsing traffic, cookies, or other headers are retained.
  const event = chrome.webRequest?.onHeadersReceived;
  let resolveHeaders;
  const headers = new Promise(resolve => { resolveHeaders = resolve; });
  const initiator = chrome.runtime.getURL('').replace(/\/$/, '');
  const observe = details => {
    if (details.url !== url || details.initiator !== initiator || details.method !== 'GET' || details.tabId !== -1) return;
    resolveHeaders(details.responseHeaders?.find(header => header.name.toLowerCase() === 'location')?.value ?? null);
  };
  event?.addListener(observe, { urls: [`${new URL(url).origin}/*`], types: ['xmlhttprequest'], tabId: -1 }, ['responseHeaders']);
  let timer;
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000), referrerPolicy: 'no-referrer' });
    if (response.type === 'opaqueredirect' || [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location') ?? (event ? await Promise.race([headers, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); })]) : null);
      await response.body?.cancel();
      return { location };
    }
    return { response };
  } finally {
    clearTimeout(timer);
    event?.removeListener(observe);
  }
}

async function getPage(url, site, policies) {
  let current = inventoryUrl(url, site);
  if (!current || !await chrome.permissions.contains({ origins: [`${new URL(current).origin}/*`] })) throw new Error('Website access is missing. Reconnect the dealership to allow it.');
  const policy = policies?.[new URL(current).origin];
  if (policy && !robotsAllows(policy, current)) throw new Error('The website excludes this inventory path from automated reads.');
  const fetched = policies ? await inventoryResponse(current) : { response: await fetch(current, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(15_000), referrerPolicy: 'no-referrer' }) };
  if ('location' in fetched) {
    if (!fetched.location) throw new Error(`The inventory URL redirects (${new URL(current).pathname}), but its final address could not be read. Open it in Chrome and connect the final inventory address. The previous catalog was kept.`);
    const redirect = inventoryUrl(fetched.location, site, current);
    if (!redirect) throw new Error('The inventory URL redirects outside this dealership. Connect the actual inventory website. The previous catalog was kept.');
    return { redirect };
  }
  const response = fetched.response;
  current = inventoryUrl(response.url, site);
  const finalPolicy = current && policies?.[new URL(current).origin];
  if (!current || finalPolicy && !robotsAllows(finalPolicy, current)) { await response.body?.cancel(); throw new Error('The website redirected outside this dealership or to an excluded path. Connect the actual inventory website.'); }
  if (policies && !finalPolicy) {
    await response.body?.cancel();
    // Do not read a redirected document until that origin's own policy is known.
    return { redirect: current };
  }
  // Policy reads omit policies; their final pathname can change after a redirect.
  if (response.status === 404 && !policies) { await response.body?.cancel(); return { body: '', url: current }; }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`The website refused the inventory request (${response.status}). The previous catalog was kept.`); }
  if (!response.body) {
    if (!policies) return { body: '', url: current };
    throw new Error('The website returned no inventory content. The previous catalog was kept.');
  }
  if (Number(response.headers.get('content-length')) > 4_000_000) { await response.body?.cancel(); throw new Error('The inventory response is too large.'); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '', bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4_000_000) throw new Error('The inventory response is too large.');
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  return { body, url: current };
}
async function finish(jobId, error = '') {
  const state = await transaction(async state => {
    if (state.job?.id !== jobId) return state;
    const job = state.job;
    const countsMatch = Object.values(job.groups).every(group => group.finalPage && group.acceptedRows === group.expected);
    const seen = new Set(job.vehicles.map(vehicle => vehicle.id));
    const scopes = new Set(Object.values(job.groups).map(group => group.scope));
    const fullScope = scopes.has('all') || scopes.has('new') && scopes.has('used');
    const unknownScope = scopes.has('unknown') && !fullScope;
    const missingScope = (state.vehicles ?? []).some(vehicle => {
      const condition = vehicle.condition === 'certified' ? 'used' : vehicle.condition;
      return vehicle.listed && !seen.has(vehicle.id) && (['new', 'used'].includes(condition)
        ? !scopes.has('all') && !scopes.has(condition) : !fullScope);
    });
    const complete = !error && !job.warnings.length && countsMatch && fullScope && !missingScope && Object.keys(job.groups).length > 0;
    const errors = [...new Set([error, ...job.warnings, !countsMatch && 'The website page counts did not match the vehicles received.', missingScope && 'A cached inventory condition was not verified. The previous vehicles were kept.', unknownScope && 'The inventory feed condition could not be verified. The previous vehicles were kept.', !fullScope && !unknownScope && 'Both new and used inventory feeds were not verified. The previous vehicles were kept.'].filter(Boolean))];
    const next = { ...state, job: null, vehicles: mergeInventory(state.vehicles ?? [], job.vehicles, complete), provider: job.provider,
      status: complete ? 'ready' : job.vehicles.length ? 'partial' : 'error', error: errors.join(' ') || (complete ? '' : 'The inventory could not be verified.'),
      lastCompletedAt: complete ? Date.now() : state.lastCompletedAt, lastUpdatedAt: job.vehicles.length ? Date.now() : state.lastUpdatedAt };
    await write(next);
    return next;
  });
  await schedule(state);
}
async function processBatch() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const state = await read();
    const job = state.job;
    if (!job) return;
    const task = job.queue[0];
    if (!task) { await finish(job.id); return; }
    if (job.visited.length >= MAX_PAGES || job.vehicles.length >= MAX_VEHICLES) { await finish(job.id, 'The refresh reached its size limit; the catalog may be incomplete.'); return; }
    if (Date.now() - job.startedAt > 24 * 60 * 60_000) { await finish(job.id, 'The refresh was interrupted for more than a day. Select Refresh now.'); return; }
    const delay = job.nextRequestAt - Date.now();
    if (delay > 0) {
      // A long site Crawl-delay is resumed by the persisted work alarm.
      if (delay > 15_000 || Date.now() + delay >= deadline) return;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    const fresh = await read();
    if (fresh.job?.id !== job.id) continue;
    const fetchUrl = task.kind === 'robots' ? new URL('/robots.txt', task.url).href : task.url;
    const origin = new URL(fetchUrl).origin;
    if (task.kind !== 'robots' && !job.policies[origin]) {
      await transaction(async current => {
        if (current.job?.id !== job.id) return;
        current.job.queue.unshift({ url: `${origin}/robots.txt`, kind: 'robots' });
        await write(current);
      });
      continue;
    }
    let result;
    try {
      const fetched = await getPage(fetchUrl, state.config.site, task.kind === 'robots' ? null : job.policies);
      if (fetched.redirect) result = { redirect: fetched.redirect };
      else if (task.kind === 'robots') {
        // Robots comments have no policy meaning, even when they mention HTML.
        const policyText = fetched.body.replace(/#.*$/gm, '');
        if (/<(?:!doctype|html|body|script)\b/i.test(policyText)) throw new Error('The website returned HTML instead of a robots policy.');
        result = { policy: robotsPolicy(fetched.body), origin: new URL(fetched.url).origin, url: fetched.url };
      } else {
        await ensureParser();
        const parsed = await chrome.runtime.sendMessage({ target: 'inventory.parser', task: { ...task, url: fetched.url }, body: fetched.body, site: state.config.site, now: Date.now() });
        if (!parsed?.ok) throw new Error(parsed?.error ?? 'The inventory could not be read.');
        result = { ...parsed.result, url: fetched.url };
        if (!result.tasks?.length && !result.group) throw new Error('No verifiable inventory pages were found.');
      }
    } catch (error) {
      // Failed pages leave previously seen vehicles intact and do not imply sales.
      result = { failure: error.name === 'TimeoutError' ? 'The website timed out. The previous catalog was kept.' : error.message };
    }
    await transaction(async current => {
      if (current.job?.id !== job.id) return;
      const next = current.job;
      next.queue.shift();
      next.visited.push(fetchUrl);
      if (result.failure) {
        next.warnings.push(result.failure);
        // A denied robots read means no subsequent source requests.
        if (task.kind === 'robots') next.queue = [];
      } else if (result.policy) {
        // A robots redirect delegates the requested origin to the returned policy.
        next.policies[origin] = result.policy;
        // A redirected resource governs the requesting origin. It also governs
        // the destination only when that origin's own robots URL was fetched.
        if (result.url === new URL('/robots.txt', result.url).href) next.policies[result.origin] = result.policy;
      } else if (result.redirect) {
        const trail = [...(task.redirectTrail ?? []), fetchUrl];
        if (trail.includes(result.redirect) || trail.length > 5) next.warnings.push('The inventory redirect chain loops or exceeds five steps. The previous catalog was kept.');
        else if (!next.visited.includes(result.redirect) && !next.queue.some(item => item.url === result.redirect)) next.queue.unshift({ ...task, url: result.redirect, redirectTrail: trail });
      }
      else {
        if (result.provider) next.provider = result.provider;
        const known = new Set([...next.visited, ...next.queue.map(item => item.url)]);
        for (const item of result.tasks ?? []) {
          const url = inventoryUrl(item.url, current.config.site);
          if (!url) { next.warnings.push('An inventory page was outside this dealership.'); continue; }
          if (!known.has(url)) { next.queue.push({ ...item, url }); known.add(url); }
        }
        const records = new Map(next.vehicles.map(vehicle => [vehicle.id, vehicle]));
        (result.vehicles ?? []).forEach(vehicle => records.set(vehicle.id, vehicle));
        next.vehicles = [...records.values()];
        if (next.vehicles.length > MAX_VEHICLES) next.warnings.push('The inventory exceeded the catalog size limit.');
        if (result.group) {
          const group = next.groups[result.group] ?? { ids: [], acceptedRows: 0, expected: result.expected };
          if (group.expected !== result.expected) next.warnings.push('Inventory changed during this refresh; counts are incomplete.');
          // Source totals count listing rows, including syndicated or location
          // duplicates. Catalog IDs are deduplicated independently for display.
          // Older paused jobs retain their conservative unique-row count.
          group.acceptedRows = (group.acceptedRows ?? group.ids.length) + (result.vehicles ?? []).length;
          group.ids = [...new Set([...group.ids, ...(result.vehicles ?? []).map(vehicle => vehicle.id)])];
          group.scope = result.scope;
          group.finalPage = result.finalPage;
          next.groups[result.group] = group;
        }
      }
      next.nextRequestAt = Date.now() + Math.max(1, ...Object.values(next.policies).map(policy => policy.delay)) * 1000;
      await write(current);
      await chrome.alarms.create(WORK_ALARM, { delayInMinutes: 1 });
    });
  }
}
function pump() {
  if (!running) running = processBatch().catch(async error => {
    const state = await read();
    if (state.job) await finish(state.job.id, error.message);
  }).finally(() => { running = null; });
  return running;
}

async function command(message) {
  if (message.action === 'connect') {
    const site = dealershipSite(message.site);
    if (inventoryFeedUrl(site) && !unfilteredInventoryUrl(site)) throw new Error('Connect an unfiltered inventory page to read the complete dealership inventory.');
    const warning = await transaction(async previous => {
      if (!await chrome.permissions.contains({ origins: siteOrigins(site) })) throw new Error('Allow access to this dealership website to connect it.');
      const previousSite = previous.config?.site;
      const same = previous.config?.site === site;
      const config = { site, nightly: Boolean(message.nightly) };
      const next = { ...(same ? previous : {}), config, job: newJob(config), status: 'syncing', error: '', permissionWarning: '', lastAttemptAt: Date.now(), nextRefreshAt: nextNightAt() };
      // Prepare alarms and the refresh job before replacing the working catalog.
      // No old website access is withdrawn until this setup has committed.
      try { await schedule(next); await write(next); }
      catch (error) {
        try { await schedule(previous); }
        catch { throw new Error(`${error.message} The previous catalog was kept, but automatic refresh could not be restored. Try connecting again.`, { cause: error }); }
        throw error;
      }
      let warning = '';
      if (previousSite && previousSite !== site && !siteOrigins(previousSite).every(origin => siteOrigins(site).includes(origin))) {
        try { await releaseWebsite(previousSite); }
        catch {
          warning = 'Previous website access could not be removed. The new dealership is connected. Remove the previous website in Chrome’s extension settings.';
          // Cleanup failure does not turn successful setup into a failed connection
          // (which would cause the panel to withdraw the newly approved website).
          try { await write({ ...next, permissionWarning: warning }); }
          catch { /* The command also returns the warning for the current panel. */ }
        }
      }
      // Keep local permission cleanup serialized with connection changes so an
      // earlier switch cannot withdraw access needed by a later connection.
      return warning;
    });
    void pump();
    return { ok: true, warning };
  } else if (message.action === 'refresh') await startRefresh();
  else if (message.action === 'nightly') {
    const state = await transaction(async state => {
      if (!state.config) throw new Error('Connect a dealership first.');
      state.config.nightly = Boolean(message.nightly);
      if (!state.nextRefreshAt) state.nextRefreshAt = nextNightAt();
      await write(state);
      return state;
    });
    await schedule(state);
  } else if (message.action === 'disconnect') {
    await transaction(async state => {
      // Stop refresh work first, retaining the site/catalog as a retry path until
      // both alarms and website access have been withdrawn successfully.
      const stopped = { ...state, job: null, config: state.config && { ...state.config, nightly: false }, status: 'idle', error: '' };
      await write(stopped);
      try {
        await schedule({});
        if (state.config) await releaseWebsite(state.config.site);
        await chrome.storage.local.remove(INVENTORY_KEY);
      } catch (error) {
        try { await write({ ...stopped, status: 'error', error: `${error.message} Disconnect did not finish. Try Disconnect again.` }); }
        catch { /* The retained site still provides the same retry action. */ }
        throw error;
      }
    });
  } else throw new Error('Unknown inventory action.');
  return { ok: true };
}
async function resume() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const state = await transaction(async state => {
    // A refresh already running at the nightly time fulfills that night's run.
    // Advance the date instead of repeatedly recreating an elapsed alarm.
    if (state.job && state.config?.nightly && (state.nextRefreshAt ?? 0) <= Date.now()) {
      state.nextRefreshAt = nextNightAt();
      await write(state);
    }
    return state;
  });
  await schedule(state);
  if (state.job) void pump();
  else if (refreshDue(state)) await startRefresh();
}
export function installInventory() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || message?.target !== 'inventory.background') return;
    command(message).then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === WORK_ALARM) void pump();
    if (alarm.name === NIGHT_ALARM) void resume();
  });
  chrome.runtime.onStartup.addListener(() => { void resume(); });
  chrome.runtime.onInstalled.addListener(() => { void resume(); });
  chrome.permissions.onRemoved.addListener(() => {
    void transaction(async state => {
      if (state.config && !await chrome.permissions.contains({ origins: siteOrigins(state.config.site) })) {
        state.job = null; state.config.nightly = false; state.status = 'error'; state.error = 'Website access was removed. Reconnect the dealership to refresh.';
        await write(state); await schedule(state);
      }
    });
  });
  void resume();
}
