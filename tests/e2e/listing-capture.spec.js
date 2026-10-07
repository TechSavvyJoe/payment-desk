import { test, expect } from '@playwright/test';
import { captureListing } from '../../extensions/payment-desk-companion/captureListing.js';

const car = { '@context': 'https://schema.org', '@type': 'Car', name: '2024 Ford Explorer XLT', sku: 'H12345', offers: { '@type': 'Offer', price: '29995', priceCurrency: 'USD' } };
const structured = value => `<h1>2024 Ford Explorer XLT</h1><script type="application/ld+json">${JSON.stringify(value)}</script>`;
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
    { '@type': 'AggregateOffer', lowPrice: 20000, highPrice: 30000 },
    { '@type': 'Offer', priceSpecification: { price: 399, priceCurrency: 'USD', billingDuration: 'P1M' } },
    { '@type': 'Offer', price: 399, name: 'Monthly payment' },
    { '@type': 'Offer', priceSpecification: { price: 399, unitText: 'month' } },
    { '@type': 'Offer', priceSpecification: { price: 35000, priceType: 'https://schema.org/MSRP' } },
    { ...car.offers, price: '$399/month' },
  ]) expect((await capture(page, structured({ ...car, offers }))).price).toBeNull();
});
test('visible labeled selling price and stock work without structured data', async ({ page }) => {
  const result = await capture(page, '<h1>2024 Ford Explorer</h1><p>Stock #: H12345</p><section>Internet price: <span class="internet-price">$29,995</span></section>');
  expect(result).toMatchObject({ name: '2024 Ford Explorer', stock: 'H12345', price: 29995 });
});
test('monthly and down-payment labels do not become the selling price', async ({ page }) => {
  for (const html of [
    '<p>Internet price: $399/month</p>',
    '<p>Internet price: $399 monthly payment</p>',
    '<p>Down payment <span class="internet-price">$1,000</span></p>',
    '<p>Lease monthly payment <span itemprop="price">$399</span></p>',
    '<p>MSRP <span class="internet-price">$35,000</span></p>',
  ]) expect((await capture(page, '<h1>2024 Ford Explorer</h1>' + html)).price).toBeNull();
});
test('malformed widgets, hidden prices and arbitrary articles require manual entry', async ({ page }) => {
  expect((await capture(page, '<h1>Dealership news</h1><p>Sale price: $10</p><script type="application/ld+json">{oops</script>')).price).toBeNull();
  expect((await capture(page, '<h1>2024 Ford Explorer</h1><span hidden class="internet-price">$10</span>')).price).toBeNull();
});
