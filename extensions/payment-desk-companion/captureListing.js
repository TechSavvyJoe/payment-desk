/** Self-contained: Chrome copies this function into the clicked tab's isolated world. */
export function captureListing() {
  /* eslint-disable no-control-regex -- Strip controls and directional overrides from untrusted listing text. */
  const clean = (value, limit) => typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit) : '';
  const priceFor = value => {
    const text = String(value ?? '').trim().replace(/^(?:USD\s*|\$\s*)/i, '').replace(/\s*USD$/i, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
    const price = Number(text.replaceAll(',', ''));
    return price > 0 && price <= 1_000_000 ? price : null;
  };
  const types = node => [node?.['@type']].flat().map(type => String(type).split('/').at(-1));
  const isVehicle = node => types(node).some(type => type === 'Car' || type === 'Vehicle')
    || (types(node).includes('Product') && /\b(?:19|20)\d{2}\b/.test(String(node.name)) && Boolean(node.vehicleIdentificationNumber || node.vehicleModelDate || /^(?:vehicles?|cars?|trucks?|suvs?|automobiles?)$/i.test(String(node.category).trim())));
  const entities = [];
  let visited = 0;
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 8 || ++visited > 2000) return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, depth + 1)); return; }
    if (isVehicle(node)) entities.push(node);
    Object.values(node).forEach(item => { if (item && typeof item === 'object') visit(item, depth + 1); });
  };
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20)) {
    if (script.textContent.length > 128_000) continue;
    try { visit(JSON.parse(script.textContent)); } catch { /* A malformed widget does not block manual entry. */ }
  }
  const vinBySku = new Map();
  for (const entity of entities) {
    const vin = clean(entity.vehicleIdentificationNumber, 64).toUpperCase();
    const sku = clean(entity.sku, 64).toUpperCase();
    if (vin && sku) vinBySku.set(sku, vinBySku.has(sku) && vinBySku.get(sku) !== vin ? null : vin);
  }
  const grouped = new Map();
  for (const [index, entity] of entities.entries()) {
    const vin = clean(entity.vehicleIdentificationNumber, 64).toUpperCase();
    const sku = clean(entity.sku, 64).toUpperCase();
    const linkedVin = vin || vinBySku.get(sku);
    const identity = linkedVin ? `vin:${linkedVin}` : sku ? `sku:${sku}` : clean(entity['@id'], 200) || `anonymous:${index}`;
    if (!grouped.has(identity)) grouped.set(identity, []);
    grouped.get(identity).push(entity);
  }
  const result = { name: '', stock: '', price: null, sourceHost: location.hostname, notice: '' };
  const scopeSelector = '[itemscope][itemtype$="/Vehicle"], [itemscope][itemtype$="/Car"], [itemscope][itemtype$="/Product"], [data-vehicle-detail], #vehicle-details, .vehicle-detail, .vehicle-details';
  const unrelatedSelector = 'aside, nav, footer, .related-vehicles, .related-inventory, [data-related-inventory]';
  const headingNodes = [...document.querySelectorAll('h1')].filter(node => node.getClientRects().length);
  const headings = headingNodes.map(node => clean(node.textContent, 67));
  const primaryScope = headingNodes.length === 1 ? headingNodes[0].closest(scopeSelector) : null;
  const belongsToVehicle = node => primaryScope && node.closest(scopeSelector) === primaryScope && !node.closest(unrelatedSelector);
  const walker = primaryScope ? document.createTreeWalker(primaryScope, NodeFilter.SHOW_TEXT) : null;
  let bodyText = '';
  let textNode;
  let textCount = 0;
  while (walker && (textNode = walker.nextNode()) && ++textCount <= 2000 && bodyText.length < 40_000) {
    const parent = textNode.parentElement;
    if (parent && belongsToVehicle(parent) && parent.getClientRects().length && !parent.closest('script, style')) bodyText += textNode.nodeValue + '\n';
  }
  bodyText = bodyText.slice(0, 40_000);
  const stockLabels = new Set([...bodyText.matchAll(/\bstock\s*(?:number|no\.?|#|:)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{1,23})\b/gi)].map(match => match[1].toUpperCase()));
  const uniqueStock = stockLabels.size === 1 ? [...stockLabels][0] : '';
  const pageCurrencies = new Set([...document.querySelectorAll('meta[property="product:price:currency"], meta[itemprop="priceCurrency"]')].map(node => clean(node.content, 12).toUpperCase()).filter(Boolean));
  const pageCurrency = pageCurrencies.size === 1 ? [...pageCurrencies][0] : '';
  const uniquePrices = new Set();
  let foreignCurrency = false;
  let unknownCurrency = false;
  if (grouped.size > 1 || document.querySelectorAll('[itemtype$="/Vehicle"], [itemtype$="/Car"]').length > 1) {
    result.notice = 'Several vehicles are listed. Open one vehicle listing, or enter its details below.';
    return result;
  }
  if (grouped.size === 1) {
    const group = [...grouped.values()][0];
    result.name = group.map(node => clean(node.name, 67)).find(Boolean) || '';
    const stockNumbers = new Set(group.map(node => clean(node.sku, 24)).filter(Boolean));
    result.stock = stockNumbers.size === 1 ? [...stockNumbers][0] : stockNumbers.size > 1 ? '' : uniqueStock;
    for (const vehicle of group) {
      for (const offer of [vehicle.offers].flat()) {
        if (!offer || typeof offer !== 'object') continue;
        // Ranges and loan/lease installments are not a selling price.
        if (types(offer).includes('AggregateOffer')) continue;
        const spec = offer.priceSpecification;
        if (offer.billingDuration || spec?.billingDuration || spec?.billingIncrement || spec?.unitCode
          || /month|lease|installment|finance|\bpayment\b|down[\s-]*payment|deposit|\/mo\b|MSRP|list\s*price|suggested\s*retail/i.test([offer.name, offer.description, spec?.name, spec?.unitText, spec?.priceType, offer.priceType].join(' '))) continue;
        const price = priceFor(offer.price ?? spec?.price);
        if (price === null) continue;
        const currency = clean(offer.priceCurrency ?? spec?.priceCurrency ?? pageCurrency, 12).toUpperCase();
        if (!currency) { unknownCurrency = true; continue; }
        if (currency !== 'USD') { foreignCurrency = true; continue; }
        uniquePrices.add(price);
      }
    }
  } else if (primaryScope && headings.length === 1 && /\b(?:19|20)\d{2}\b/.test(headings[0])) {
    result.name = headings[0];
    result.stock = uniqueStock;
  } else {
    result.notice = 'No single vehicle was identified. Enter the vehicle and price below.';
    return result;
  }
  // Structured data must supply its own price. Never mix an unrelated widget's offer into it.
  if (!grouped.size && primaryScope) {
    const scopedCurrencies = new Set([...primaryScope.querySelectorAll('[itemprop="priceCurrency"]')].filter(belongsToVehicle).map(node => clean(node.content || node.textContent, 12).toUpperCase()).filter(Boolean));
    const currency = scopedCurrencies.size === 1 ? [...scopedCurrencies][0] : pageCurrency;
    foreignCurrency = Boolean(currency && currency !== 'USD');
    unknownCurrency = !currency;
    if (!foreignCurrency && !unknownCurrency) {
      for (const node of primaryScope.querySelectorAll('[itemprop="price"], .sale-price, .internet-price, .internetPrice, [data-testid="price"]')) {
        if (!belongsToVehicle(node)) continue;
        if (node.tagName !== 'META' && !node.getClientRects().length) continue;
        const context = clean(node.parentElement?.textContent, 250);
        if (/\b(?:month|monthly|lease|down payment|msrp|list price|suggested retail|was|starting at)\b|\/mo\b/i.test(context)) continue;
        const price = priceFor(node.content || node.textContent);
        if (price !== null) uniquePrices.add(price);
      }
      for (const row of primaryScope.querySelectorAll('p, li, dd')) {
        if (!belongsToVehicle(row) || !row.getClientRects().length) continue;
        // Read the whole rendered row so qualifiers split across spans cannot disappear.
        const match = clean(row.innerText, 300).match(/^(?:selling|sale|internet|our) price\s*:?\s*(\$?\s*[\d,]+(?:\.\d{1,2})?)(?:\s+USD)?$/i);
        if (!match) continue;
        const price = priceFor(match[1]);
        if (price !== null) uniquePrices.add(price);
      }
    }
  }
  if (uniquePrices.size === 1 && !foreignCurrency && !unknownCurrency) result.price = [...uniquePrices][0];
  result.notice = foreignCurrency ? 'Payment Desk uses USD. Enter the verified USD selling price.'
    : unknownCurrency ? 'Currency could not be confirmed. Enter the verified USD selling price.'
    : uniquePrices.size > 1 ? 'Several prices were found. Enter the confirmed selling price.'
    : result.price === null ? 'Vehicle details found. Enter the confirmed selling price.'
    : 'Details captured. Check the advertised price and any conditions before continuing.';
  return result;
}
