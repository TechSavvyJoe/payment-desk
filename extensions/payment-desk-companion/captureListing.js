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
    || (types(node).includes('Product') && /\b(?:19|20)\d{2}\b/.test(String(node.name)) && Boolean(node.vehicleIdentificationNumber || node.vehicleModelDate || /vehicle|automotive|car|truck/i.test(String(node.category))));
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
  const grouped = new Map();
  for (const entity of entities) {
    const identity = [entity.vehicleIdentificationNumber, entity.sku, entity.name].map(value => clean(value, 100)).join('|');
    if (!grouped.has(identity)) grouped.set(identity, []);
    grouped.get(identity).push(entity);
  }
  const result = { name: '', stock: '', price: null, sourceHost: location.hostname, notice: '' };
  const bodyText = (document.body?.innerText ?? '').slice(0, 40_000);
  const headings = [...document.querySelectorAll('h1')].filter(node => node.getClientRects().length).map(node => clean(node.textContent, 67));
  const stockMatch = bodyText.match(/\bstock\s*(?:number|no\.?|#|:)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{1,23})\b/i);
  const uniquePrices = new Set();
  let foreignCurrency = false;
  if (grouped.size > 1 || document.querySelectorAll('[itemtype$="/Vehicle"], [itemtype$="/Car"]').length > 1) {
    result.notice = 'Several vehicles are listed. Open one vehicle listing, or enter its details below.';
    return result;
  }
  if (grouped.size === 1) {
    const group = [...grouped.values()][0];
    result.name = clean(group[0].name, 67);
    result.stock = clean(group[0].sku, 24) || clean(stockMatch?.[1], 24);
    for (const vehicle of group) {
      for (const offer of [vehicle.offers].flat()) {
        if (!offer || typeof offer !== 'object') continue;
        // Ranges and loan/lease installments are not a selling price.
        if (types(offer).includes('AggregateOffer')) continue;
        const currency = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency;
        if (currency && String(currency).toUpperCase() !== 'USD') { foreignCurrency = true; continue; }
        const spec = offer.priceSpecification;
        if (offer.billingDuration || spec?.billingDuration || spec?.billingIncrement || spec?.unitCode
          || /month|lease|installment|\/mo\b/i.test([offer.name, offer.description, spec?.name, spec?.unitText].join(' '))
          || /MSRP|ListPrice/i.test(String(spec?.priceType ?? offer.priceType))) continue;
        const price = priceFor(offer.price ?? spec?.price);
        if (price !== null) uniquePrices.add(price);
      }
    }
  } else if (headings.length === 1 && /\b(?:19|20)\d{2}\b/.test(headings[0])) {
    result.name = headings[0];
    result.stock = clean(stockMatch?.[1], 24);
  } else {
    result.notice = 'No single vehicle was identified. Enter the vehicle and price below.';
    return result;
  }
  // Structured data must supply its own price. Never mix an unrelated widget's offer into it.
  if (!grouped.size) {
    const currency = document.querySelector('meta[property="product:price:currency"], [itemprop="priceCurrency"]');
    if (currency && (currency.content || currency.textContent).trim().toUpperCase() !== 'USD') foreignCurrency = true;
    if (!foreignCurrency) {
      for (const node of document.querySelectorAll('meta[property="product:price:amount"], [itemprop="price"], .sale-price, .internet-price, .internetPrice, [data-testid="price"]')) {
        if (node.tagName !== 'META' && !node.getClientRects().length) continue;
        const context = clean(node.parentElement?.textContent, 250);
        if (/\b(?:month|monthly|lease|down payment|msrp|was|starting at)\b|\/mo\b/i.test(context)) continue;
        const price = priceFor(node.content || node.textContent);
        if (price !== null) uniquePrices.add(price);
      }
      const labeled = [...bodyText.matchAll(/(?:selling|sale|internet|our) price\s*[:\n]?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)([^\n]{0,30})/gi)];
      for (const match of labeled) {
        if (/month|monthly|\/mo|lease|down payment/i.test(match[2])) continue;
        const price = priceFor(match[1]);
        if (price !== null) uniquePrices.add(price);
      }
    }
  }
  if (uniquePrices.size === 1 && !foreignCurrency) result.price = [...uniquePrices][0];
  result.notice = foreignCurrency ? 'Payment Desk uses USD. Enter the verified USD selling price.'
    : uniquePrices.size > 1 ? 'Several prices were found. Enter the confirmed selling price.'
    : result.price === null ? 'Vehicle details found. Enter the confirmed selling price.'
    : 'Details captured. Check the advertised price and any conditions before continuing.';
  return result;
}
