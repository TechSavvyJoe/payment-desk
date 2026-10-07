import { test, expect } from '@playwright/test';
import { captureListing } from '../../extensions/payment-desk-companion/captureListing.js';

const car = { '@context': 'https://schema.org', '@type': 'Car', name: '2024 Ford Explorer XLT', sku: 'H12345', offers: { '@type': 'Offer', price: '29995', priceCurrency: 'USD' } };
const structured = (value, details = '') => `<section data-vehicle-detail><h1>2024 Ford Explorer XLT</h1><script type="application/ld+json">${JSON.stringify(value)}</script>${details}</section>`;
const unstructured = details => `<meta property="product:price:currency" content="USD"><section data-vehicle-detail><h1>2024 Ford Explorer</h1>${details}</section>`;
const capture = async (page, html) => { await page.setContent(html); return page.evaluate(captureListing); };
test('capture reads a vehicle and its own USD offer from structured data', async ({ page }) => {
  const result = await capture(page, structured({ '@graph': [car] }));
  expect(result).toMatchObject({ name: car.name, stock: 'H12345', price: 29995 });
  expect(Object.keys(result).sort()).toEqual(['name', 'notice', 'price', 'sourceHost', 'stock']);
});
test('capture rejects search results rather than mixing vehicles', async ({ page }) => {
  const result = await capture(page, structured([car, { ...car, name: '2023 Ford Escape', sku: 'E100', offers: { price: '20000' } }]));
  expect(result).toMatchObject({ name: '', stock: '', price: null });
  expect(result.notice).toContain('Several vehicles');
});
test('capture does not choose between conflicting offers or combine a widget with structured data', async ({ page }) => {
  const result = await capture(page, structured({ ...car, offers: [{ ...car.offers }, { ...car.offers, price: '30995' }] }));
  expect(result.price).toBeNull();
  expect(result.notice).toContain('Several prices');
  expect((await capture(page, structured({ ...car, offers: undefined }) + '<div class="internet-price">$399</div>')).price).toBeNull();
});
test('foreign currency, range prices and installment specifications stay blank', async ({ page }) => {
  for (const offers of [
    { ...car.offers, priceCurrency: 'CAD' },
    { '@type': 'AggregateOffer', lowPrice: 20000, highPrice: 30000, price: 25000, priceCurrency: 'USD' },
    { '@type': 'Offer', priceSpecification: { price: 399, priceCurrency: 'USD', billingDuration: 'P1M' } },
    { '@type': 'Offer', price: 399, name: 'Monthly payment', priceCurrency: 'USD' },
    { '@type': 'Offer', priceSpecification: { price: 399, unitText: 'month', priceCurrency: 'USD' } },
    { '@type': 'Offer', priceSpecification: { price: 35000, priceType: 'https://schema.org/MSRP', priceCurrency: 'USD' } },
    { '@type': 'Offer', price: 35000, name: 'MSRP', priceCurrency: 'USD' },
    { '@type': 'Offer', price: 35000, description: 'List Price', priceCurrency: 'USD' },
    { '@type': 'Offer', price: 35000, priceSpecification: { name: 'Manufacturer suggested retail price' }, priceCurrency: 'USD' },
    { '@type': 'Offer', price: 3000, name: 'Down payment', priceCurrency: 'USD' },
    { ...car.offers, price: '$399/month' },
  ]) expect((await capture(page, structured({ ...car, offers }))).price).toBeNull();
});
test('visible labeled selling price and stock work without structured data', async ({ page }) => {
  const result = await capture(page, unstructured('<p>Stock #: H12345</p><section>Internet price: <span class="internet-price">$29,995</span></section>'));
  expect(result).toMatchObject({ name: '2024 Ford Explorer', stock: 'H12345', price: 29995 });
});
test('monthly and down-payment labels do not become the selling price', async ({ page }) => {
  for (const html of [
    '<p>Internet price: $399/month</p>',
    '<p>Internet price: $399 monthly payment</p>',
    '<p>Down payment <span class="internet-price">$1,000</span></p>',
    '<p>Lease monthly payment <span itemprop="price">$399</span></p>',
    '<p>MSRP <span class="internet-price">$35,000</span></p>',
  ]) expect((await capture(page, unstructured(html))).price).toBeNull();
});
test('malformed widgets, hidden prices and arbitrary articles require manual entry', async ({ page }) => {
  expect((await capture(page, '<h1>Dealership news</h1><p>Sale price: $10</p><script type="application/ld+json">{oops</script>')).price).toBeNull();
  expect((await capture(page, unstructured('<span hidden class="internet-price">$10</span>'))).price).toBeNull();
  expect((await capture(page, unstructured('<script type="application/ld+json">{oops</script><p>Internet price: $29,995</p>'))).price).toBe(29995);
});
test('duplicate structured records use a shared VIN without requiring matching descriptions', async ({ page }) => {
  const vin = '1FM5K8GC9RGA12345';
  const result = await capture(page, structured([ { ...car, vehicleIdentificationNumber: vin }, { '@type': 'Vehicle', vehicleIdentificationNumber: vin, name: 'Ford Explorer', offers: car.offers } ]));
  expect(result).toMatchObject({ name: car.name, stock: 'H12345', price: 29995 });
  const skuOnly = await capture(page, structured([ { ...car, vehicleIdentificationNumber: vin }, { ...car, name: 'Ford Explorer', vehicleIdentificationNumber: undefined } ]));
  expect(skuOnly).toMatchObject({ stock: 'H12345', price: 29995 });
});
test('ambiguous unstructured stock labels are not attached to the selected vehicle', async ({ page }) => {
  const result = await capture(page, '<aside>Stock #: OTHER1</aside>' + structured({ ...car, sku: undefined }) + '<p>Stock #: H12345</p>');
  expect(result).toMatchObject({ stock: '', price: 29995 });
  const single = await capture(page, structured({ ...car, sku: undefined }, '<p>Stock #: H12345</p>'));
  expect(single.stock).toBe('H12345');
});
test('same-name and unnamed vehicles require stable identifiers before deduplication', async ({ page }) => {
  for (const name of [car.name, undefined]) {
    const entity = { ...car, sku: undefined, name };
    const result = await capture(page, structured([entity, { ...entity }]));
    expect(result.price).toBeNull();
    expect(result.notice).toContain('Several vehicles');
  }
});
test('missing offer currency uses explicit page metadata or requires manual entry', async ({ page }) => {
  const entity = { ...car, offers: { price: 35000 } };
  expect((await capture(page, structured(entity))).price).toBeNull();
  expect((await capture(page, '<meta property="product:price:currency" content="CAD">' + structured(entity))).price).toBeNull();
  expect((await capture(page, '<meta property="product:price:currency" content="USD">' + structured(entity))).price).toBe(35000);
});
test('prices outside the primary vehicle scope or in related widgets stay blank', async ({ page }) => {
  for (const html of [
    unstructured('') + '<div class="internet-price">$999</div>',
    unstructured('<aside><div class="internet-price">$999</div></aside>'),
    unstructured('<div class="related-inventory"><div class="internet-price">$999</div></div>'),
    '<meta property="product:price:currency" content="USD"><h1>2024 Ford Explorer</h1><div class="internet-price">$999</div>',
  ]) expect((await capture(page, html)).price).toBeNull();
});
