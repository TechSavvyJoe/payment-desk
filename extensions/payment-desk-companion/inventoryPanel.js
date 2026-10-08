import { INVENTORY_KEY, dealershipSite, inventoryFeedUrl, inventoryUrl, siteOrigins, unfilteredInventoryUrl } from './inventoryModel.js';

export function installInventoryPanel(onChoose, onOpen) {
  const panel = document.getElementById('inventory-controls');
  const toggle = document.getElementById('toggle-inventory');
  const site = document.getElementById('dealership-site');
  const nightly = document.getElementById('inventory-nightly');
  const search = document.getElementById('inventory-search');
  const condition = document.getElementById('inventory-condition');
  const status = document.getElementById('inventory-status');
  const notice = document.getElementById('inventory-notice');
  const list = document.getElementById('inventory-list');
  const money = value => value === null || value === undefined ? 'USD price unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const date = value => value ? new Date(value).toLocaleString() : 'Never';
  let state = {};
  let permissionWarning;
  let limit = 30;
  let connecting = false;
  let wasConnected = false;
  const show = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) { onOpen(); (state.config ? search : site).focus(); }
  };
  const command = async value => {
    const result = await chrome.runtime.sendMessage({ target: 'inventory.background', ...value });
    if (!result?.ok) throw new Error(result?.error ?? 'The inventory action could not be completed.');
    return result;
  };
  const message = (value, error = false) => {
    const warning = state.permissionWarning || (permissionWarning?.site === state.config?.site ? permissionWarning.text : '');
    notice.textContent = [warning, value].filter(Boolean).join(' ');
    notice.classList.toggle('is-error', error || Boolean(warning));
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function renderList() {
    const needle = search.value.trim().toLowerCase();
    const old = document.getElementById('inventory-include-old').checked;
    const vehicles = (state.vehicles ?? []).filter(vehicle => (old || vehicle.listed)
      && (!condition.value || vehicle.condition === condition.value || condition.value === 'used' && vehicle.condition === 'certified')
      && [vehicle.name, vehicle.vin, vehicle.stock].join(' ').toLowerCase().includes(needle));
    list.replaceChildren();
    for (const vehicle of vehicles.slice(0, limit)) {
      const card = element('article', undefined, 'inventory-card');
      const top = element('div', undefined, 'inventory-card__top');
      if (vehicle.photos?.[0]) {
        const image = document.createElement('img');
        image.src = vehicle.photos[0]; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.width = 70; image.height = 52;
        image.addEventListener('error', () => { image.hidden = true; });
        top.append(image);
      }
      const identity = element('div');
      identity.append(element('h3', vehicle.name), element('p', [vehicle.condition, vehicle.stock && `Stock ${vehicle.stock}`, vehicle.mileage !== null && `${vehicle.mileage.toLocaleString()} mi`].filter(Boolean).join(' · '), 'inventory-card__meta'));
      identity.append(element('strong', money(vehicle.price ?? vehicle.websitePrice)));
      if (vehicle.price === null && vehicle.websitePrice !== null) identity.append(element('span', ' Advertised; confirm selling price', 'inventory-card__meta'));
      top.append(identity); card.append(top);
      const detail = element('details');
      detail.append(element('summary', 'Vehicle details'));
      const data = element('dl');
      for (const [label, value] of [['VIN', vehicle.vin], ['Trim', vehicle.trim], ['Body', vehicle.body], ['Transmission', vehicle.transmission], ['Exterior', vehicle.exterior], ['Interior', vehicle.interior], ['Location', vehicle.location], ['Availability', vehicle.listed ? vehicle.availability : 'Not seen in the last complete refresh'], ['MSRP', vehicle.msrp ? money(vehicle.msrp) : ''], ['Last seen', date(vehicle.lastSeenAt)]]) {
        if (value) data.append(element('dt', label), element('dd', value));
      }
      detail.append(data);
      if (vehicle.features?.length) detail.append(element('p', vehicle.features.join(' · ')));
      detail.append(element('p', vehicle.priceNote || 'Confirm the selling price, fees, discounts and availability.'));
      card.append(detail);
      const actions = element('div', undefined, 'inventory-card__actions');
      const choose = element('button', 'Use vehicle', 'capture'); choose.type = 'button';
      choose.addEventListener('click', () => { show(false); onChoose(vehicle); });
      const listing = element('button', 'Listing ↗', 'quiet'); listing.type = 'button';
      listing.addEventListener('click', async () => {
        const url = inventoryUrl(vehicle.url, state.config?.site);
        if (!url) { message('The listing URL could not be verified.', true); return; }
        try { await chrome.tabs.create({ url }); } catch { message('The listing could not be opened.', true); }
      });
      actions.append(choose, listing); card.append(actions); list.append(card);
    }
    const more = document.getElementById('inventory-more');
    more.hidden = vehicles.length <= limit;
    document.getElementById('inventory-count').textContent = `${vehicles.length} vehicles${vehicles.length > limit ? ` · showing ${limit}` : ''}`;
    if (!vehicles.length) list.append(element('p', state.job ? 'Your inventory is being read. The catalog will appear here when the refresh finishes.' : state.config ? 'No matching vehicles. Check refresh status or adjust your search.' : 'Connect your dealership website to browse inventory here.', 'source'));
  }
  function render() {
    if (document.activeElement !== site) site.value = state.config?.site ?? '';
    nightly.checked = state.config?.nightly ?? true;
    if (!state.config || !wasConnected) document.getElementById('inventory-settings').open = !state.config;
    wasConnected = Boolean(state.config);
    document.getElementById('inventory-disconnect').hidden = !state.config;
    document.getElementById('inventory-refresh').hidden = !state.config;
    document.getElementById('inventory-refresh').disabled = Boolean(state.job);
    document.getElementById('inventory-connect').disabled = connecting;
    if (state.job) status.textContent = `Refreshing · ${state.job.vehicles.length} vehicles read · ${state.job.visited.length} pages checked`;
    else if (state.config) status.textContent = `${state.provider || 'Inventory'} · Last complete refresh: ${date(state.lastCompletedAt)}`;
    else status.textContent = 'Both new and used vehicles, when offered by your website.';
    if (state.error) message(`${state.status === 'partial' ? 'Partial refresh. ' : ''}${state.error} Check last-seen dates before using cached vehicles.`, true);
    else message(state.config?.nightly ? `Nightly refresh: about 2 AM in this computer’s time zone. Next: ${date(state.nextRefreshAt)}. Missed updates run when Chrome starts again.` : 'Automatic refresh is off. Use Refresh now while Chrome is online.');
    renderList();
  }
  toggle.addEventListener('click', () => show(panel.hidden));
  document.getElementById('inventory-close').addEventListener('click', () => { show(false); toggle.focus(); });
  document.getElementById('inventory-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (connecting) return;
    let url;
    try { url = dealershipSite(site.value); } catch { message('Enter a public HTTPS dealership website.', true); site.focus(); return; }
    if (inventoryFeedUrl(url) && !unfilteredInventoryUrl(url)) { message('Connect an unfiltered inventory page to read the complete dealership inventory.', true); site.focus(); return; }
    const selectedNightly = nightly.checked;
    // Call request synchronously from the user's submit gesture. The permission
    // is for this site's apex/www hosts, not every website in the optional pattern.
    const origins = siteOrigins(url);
    // Snapshot each host before requesting access, preserving the submit gesture.
    const previousAccess = Promise.all(origins.map(origin => chrome.permissions.contains({ origins: [origin] }))).catch(() => null);
    const permission = chrome.permissions.request({ origins });
    let granted = false;
    connecting = true; document.getElementById('inventory-connect').disabled = true;
    try {
      granted = await permission;
      if (!granted) throw new Error('Website access was not granted. The connection was not changed.');
      const result = await command({ action: 'connect', site: url, nightly: selectedNightly });
      permissionWarning = { site: url, text: result.warning };
      render();
    } catch (error) {
      if (granted) {
        try {
          const before = await previousAccess;
          if (!before) throw new Error('The previous website access could not be verified.', { cause: error });
          const newlyGranted = origins.filter((_origin, index) => !before[index]);
          if (newlyGranted.length && !await chrome.permissions.remove({ origins: newlyGranted })) throw new Error('Website access was not withdrawn.', { cause: error });
        } catch { message(`${error.message} Website access could not be withdrawn. Remove it in Chrome’s extension settings.`, true); return; }
      }
      message(error.message, true);
    }
    finally { connecting = false; document.getElementById('inventory-connect').disabled = false; }
  });
  nightly.addEventListener('change', async () => {
    if (!state.config) return;
    try { await command({ action: 'nightly', nightly: nightly.checked }); }
    catch (error) { nightly.checked = state.config.nightly; message(error.message, true); }
  });
  document.getElementById('inventory-refresh').addEventListener('click', async () => {
    try { await command({ action: 'refresh' }); } catch (error) { message(error.message, true); }
  });
  document.getElementById('inventory-disconnect').addEventListener('click', async () => {
    try { await command({ action: 'disconnect' }); } catch (error) { message(error.message, true); }
  });
  for (const field of [search, condition, document.getElementById('inventory-include-old')]) field.addEventListener('input', () => { limit = 30; renderList(); });
  document.getElementById('inventory-more').addEventListener('click', () => { limit += 30; renderList(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[INVENTORY_KEY]) return;
    state = changes[INVENTORY_KEY].newValue ?? {}; render();
  });
  chrome.storage.local.get(INVENTORY_KEY).then(saved => { state = saved[INVENTORY_KEY] ?? {}; render(); }).catch(() => message('The saved inventory could not be loaded.', true));
  return { close: () => show(false) };
}
