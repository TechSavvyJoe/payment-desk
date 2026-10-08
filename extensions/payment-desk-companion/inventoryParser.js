import { cleanText, inventoryFeedUrl, inventoryUrl, publicImage, unfilteredInventoryUrl, usdPrice, vehicleRecord } from './inventoryModel.js';

// Only inert, detached markup is parsed. Remote scripts are never evaluated.
const markup = html => { const template = document.createElement('template'); template.innerHTML = html; return template.content; };
const text = node => cleanText(node?.textContent ?? '');
function cardDetails(card) {
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  const parts = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest('script, style')) parts.push(cleanText(node.textContent, 800));
  }
  // Separate adjacent text nodes so </h4><p>Stock does not become EscapeStock.
  return cleanText(parts.join(' '), 6000);
}

export function dealerOnUrl(config, origin, page = 1) {
  const url = new URL(`/api/vhcliaa/vehicle-pages/cosmos/srp/vehicles/${config.DealerId}/${config.PageId}`, origin);
  url.search = new URLSearchParams({ host: url.hostname, baseFilter: btoa(config.BaseFilter), pn: '48', pt: String(page), displayCardsShown: String((page - 1) * 48) });
  return url.href;
}
function pricing(html, used) {
  const root = markup(html ?? '');
  const rows = [...root.querySelectorAll('.priceBlockItemPrice, .price')].map(row => ({
    label: text(row.querySelector('.priceBlocItemPriceLabel, .price-label')),
    value: usdPrice(text(row.querySelector('.priceBlocItemPriceValue, .price-price'))),
  })).filter(row => row.value !== null);
  const featured = root.querySelector('.featuredPrice, .CustomPricing_Main');
  const websitePrice = usdPrice(text(featured?.querySelector('.vehiclePricingHighlightAmount, .price-price')));
  const base = rows.find(row => /^(?:selling|sale|internet|dealer) price:?$/i.test(row.label) || (used && /^retail price:?$/i.test(row.label)));
  return {
    // A labeled base price avoids charging a website's included document fee twice.
    // MSRP and conditional rebates are never substituted for a selling price.
    price: base?.value ?? null, websitePrice,
    msrp: rows.find(row => /^msrp:?$/i.test(row.label))?.value ?? null,
    priceNote: base ? `Source: ${base.label}. Verify the price, included fees and discount conditions.` : 'Confirm the selling price with the listing. Advertised totals may include fees or conditional rebates.',
  };
}

export function parseDealerOn(data, task, site, now) {
  const paging = data?.Paging?.PaginationDataModel;
  if (!Array.isArray(data?.DisplayCards) || !paging || paging.PageNumber !== task.page
    || !Number.isInteger(paging.TotalPages) || paging.TotalPages < 0
    || !Number.isInteger(paging.TotalCount) || paging.TotalCount < 0) throw new Error('The inventory response changed. The previous catalog was kept.');
  const vehicles = data.DisplayCards.filter(item => !item.IsAdCard && item.VehicleCard).map(item => {
    const v = item.VehicleCard;
    const condition = v.VehicleCondition?.toLowerCase() ?? task.condition;
    const stack = v.WasabiVehiclePricingPanelViewModel?.PriceStakViewModel?.PriceStakTabsModel;
    const prices = pricing(stack?.BuyContent, condition !== 'new');
    const image = v.VehicleImageModel;
    return vehicleRecord({
      name: text(markup(image?.VehicleNameHtmlEncoded ?? '')) || [v.VehicleYear, v.VehicleMake, v.VehicleModel, v.VehicleTrim].filter(Boolean).join(' '),
      vin: v.VehicleVin, stock: v.VehicleStockNumber, url: v.VehicleDetailUrl,
      condition, make: v.VehicleMake, model: v.VehicleModel, trim: v.VehicleTrim, mileage: v.VehicleMileage,
      exterior: v.ExteriorColorLabel, interior: v.InteriorColorLabel, body: v.VehicleBodyStyle, transmission: v.VehicleTransmission,
      location: v.VehicleLocationLabel || image?.DealerName,
      availability: v.VehicleInStock === false ? 'Not in stock at this location' : v.VehicleStatusModel?.StatusText || 'Confirm availability',
      photos: image?.VehicleImageCarouselModel?.PhotoList ?? [image?.VehiclePhotoSrc].filter(Boolean), features: v.Features,
      currency: task.config.DealerModel?.CurrencyCode, ...prices,
    }, site, now);
  }).filter(Boolean);
  const next = task.page < paging.TotalPages ? [{ ...task, page: task.page + 1, url: dealerOnUrl(task.config, task.url, task.page + 1) }] : [];
  return { vehicles, tasks: next, expected: paging.TotalCount, group: String(task.config.PageId), scope: task.condition === 'new' ? 'new' : 'used', finalPage: !next.length, provider: 'DealerOn' };
}

function discovery(root, url, site) {
  const candidates = [...root.querySelectorAll('a[href]')].map(a => ({ url: inventoryUrl(a.getAttribute('href'), site, url), label: text(a) })).filter(item => item.url);
  const find = patterns => {
    const matches = candidates.filter(item => patterns.some(pattern => pattern.test(new URL(item.url).pathname)) && !/special|certified|under|truck|suv|electric|lease|offer/i.test(new URL(item.url).pathname));
    const full = matches.find(item => unfilteredInventoryUrl(item.url));
    if (!full && matches.length) throw new Error('Only filtered inventory links were found. Connect an unfiltered inventory page. The previous catalog was kept.');
    return full;
  };
  const newPage = find([/\/searchnew\.aspx$/i, /\/(?:new|new-inventory)(?:\/index\.htm)?\/?$/i, /\/inventory\/new\/?$/i]);
  const usedPage = find([/\/searchused\.aspx$/i, /\/(?:used|used-inventory|pre-owned)(?:\/index\.htm)?\/?$/i, /\/inventory\/used\/?$/i, /used-vehicle-inventory[^/]*\.html$/i]);
  const all = find([/\/inventory\/?$/i, /\/cars-for-sale\/?$/i, /\/searchall\.aspx$/i]);
  const chosen = newPage || usedPage ? [newPage && { ...newPage, condition: 'new' }, usedPage && { ...usedPage, condition: 'used' }] : [all && { ...all, condition: 'unknown' }];
  return chosen.filter(Boolean).filter(item => item.url !== url).map(item => ({ url: item.url, kind: 'html', condition: item.condition, feed: true }));
}
export function parseInventoryHtml(html, task, site, now) {
  const root = markup(html);
  if (inventoryFeedUrl(task.url) && !unfilteredInventoryUrl(task.url, task.page ?? 1)) throw new Error('Connect an unfiltered inventory page to read the complete dealership inventory.');
  // A direct inventory URL still needs the dealership's other inventory.
  // Follow its navigation, or visit the home page when the feed omits it.
  const discoverMore = () => {
    if ((task.page ?? 1) !== 1) return [];
    const siblings = discovery(root, task.url, site);
    const home = new URL('/', task.url).href;
    return siblings.length ? siblings : task.url !== home ? [{ url: home, kind: 'html', condition: 'unknown' }] : [];
  };
  const configNode = root.querySelector('#dlron-srp-model');
  if (configNode) {
    const config = JSON.parse(configNode.textContent);
    if (!Number.isInteger(config.DealerId) || config.DealerId <= 0 || !Number.isInteger(config.PageId) || config.PageId <= 0
      || typeof config.BaseFilter !== 'string' || config.BaseFilter.length > 1000 || !/^[\x20-\x7e]*$/.test(config.BaseFilter)) throw new Error('This inventory configuration is unsupported.');
    return { vehicles: [], tasks: [{ kind: 'dealeron', url: dealerOnUrl(config, task.url), page: 1, config: { DealerId: config.DealerId, PageId: config.PageId, BaseFilter: config.BaseFilter, DealerModel: { CurrencyCode: config.DealerModel?.CurrencyCode } }, condition: /new/i.test(config.PageVehicleType) ? 'new' : 'used' }, ...discoverMore()], provider: 'DealerOn' };
  }
  const cards = [...root.querySelectorAll('.invMainCell')];
  if (cards.length) {
    const path = new URL(task.url).pathname;
    const feedCondition = ['new', 'used', 'certified'].includes(task.condition) ? task.condition
      : /\/(?:searchnew\.aspx|inventory\/new|new(?:-inventory)?)(?:\/index\.htm)?\/?$/i.test(path) ? 'new'
      : /\/(?:searchused\.aspx|inventory\/used|used(?:-inventory)?|pre-owned)(?:\/index\.htm)?\/?$/i.test(path) || /\/used-vehicle-inventory[^/]*\.html$/i.test(path) ? 'used' : 'unknown';
    const usAddress = /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s+\d{5}(?:-\d{4})?\b/.test(text(root.querySelector('.LabelCityStateZip1')));
    const vehicles = cards.map(card => {
      const a = card.querySelector('.vehicleTitleH4 a');
      const details = cardDetails(card.querySelector('.i18r_description, .i18r_details, .details-list') ?? card);
      const priceRows = card.querySelector('.i18r_customPricing')?.innerHTML ?? '';
      const name = a?.getAttribute('aria-label') || text(a);
      const href = a?.getAttribute('href') ?? '';
      const condition = /\/New-/i.test(href) ? 'new' : /\/(?:Used|Certified)-/i.test(href) ? 'used' : feedCondition;
      return vehicleRecord({ name, url: inventoryUrl(href, site, task.url),
        vin: card.querySelector('[data-vin]')?.getAttribute('data-vin') || details.match(/\bVIN\s*:?\s*([A-HJ-NPR-Z0-9]{17})/i)?.[1],
        stock: details.match(/\bStock\s*(?:#|No\.?|Number)?\s*:\s*(\S+)/i)?.[1],
        mileage: text(card.querySelector('.i18r_optMileage p')).match(/\bMileage\s*:\s*([\d,]+)/i)?.[1] ?? details.match(/\bMileage\s*:\s*([\d,]+)/i)?.[1],
        trim: text(card.querySelector('.i18r_TrimLevel')),
        exterior: text(card.querySelector('.i18r_optColor p')).replace(/^Color:\s*/i, ''),
        transmission: text(card.querySelector('.i18r_optTrans p')).replace(/^Transmission:\s*/i, ''),
        features: [...card.querySelectorAll('.i18r_optDrive p, .i18r_optEngine p, .i18r_optFuel p')].map(text),
        condition,
        photos: [...card.querySelectorAll('.mainImgWrap img')].map(img => publicImage(img.getAttribute('data-src') || img.getAttribute('src'), task.url)),
        currency: usAddress ? 'USD' : '', ...pricing(priceRows, condition === 'used' || condition === 'certified'),
      }, site, now);
    }).filter(Boolean);
    const summary = text(root.querySelector('.pager-summary')).match(/Page:\s*(\d+)\s*of\s*(\d+)\s*\((\d+) vehicles\)/i);
    if (!summary) throw new Error('The inventory page count could not be verified.');
    const page = Number(summary[1]);
    if (page !== (task.page ?? 1)) throw new Error('The website returned the wrong inventory page.');
    const nextUrl = new URL(task.url);
    nextUrl.searchParams.set('page', String(page + 1));
    const tasks = page < Number(summary[2]) ? [{ ...task, page: page + 1, url: nextUrl.href }] : [];
    const groupUrl = new URL(task.url);
    groupUrl.searchParams.delete('page');
    groupUrl.hash = '';
    return { vehicles, tasks: [...tasks, ...discoverMore()], group: `dealercarsearch:${groupUrl.href}`, scope: feedCondition === 'unknown' ? 'all' : feedCondition === 'new' ? 'new' : 'used', expected: Number(summary[3]), finalPage: !tasks.length, provider: 'DealerCarSearch' };
  }
  if (task.feed || inventoryFeedUrl(task.url)) throw new Error('An inventory feed could not be verified. The previous catalog was kept.');
  const tasks = discovery(root, task.url, site);
  if (!tasks.length) throw new Error('This website needs a different inventory connector. Capture individual listings or enter vehicles manually for now.');
  return { vehicles: [], tasks, provider: '' };
}
