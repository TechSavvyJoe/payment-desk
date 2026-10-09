import { test, expect } from '@playwright/test';

test('duplicate Other products recover focus to each outstanding tax choice', async ({ page }) => {
  const externalRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      externalRequests.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();

  await page.locator('#add-product').click();
  await page.getByLabel('Product 1 type', { exact: true }).selectOption('other');
  await page.getByLabel('Product name for add-on 1', { exact: true }).fill('Protection');
  await expect(page.getByLabel('Product name for add-on 1', { exact: true })).toHaveValue('Protection');
  await page.locator('#product-add-on-1-amount').fill('500');
  await expect(page.locator('#product-add-on-1-amount')).toHaveValue('500');
  await page.locator('#add-product').click();
  await page.getByLabel('Product 2 type', { exact: true }).selectOption('other');
  await page.getByLabel('Product name for add-on 2', { exact: true }).fill('Protection');
  await expect(page.getByLabel('Product name for add-on 2', { exact: true })).toHaveValue('Protection');
  await page.locator('#product-add-on-2-amount').fill('500');
  await expect(page.locator('#product-add-on-2-amount')).toHaveValue('500');

  await page.locator('#products-addons-heading').click();
  const summary = page.getByRole('complementary', { name: 'Current estimate summary', exact: true }).filter({ visible: true });
  await summary.getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.locator('#customer-heading')).toHaveCount(0);
  await expect(summary.getByRole('button', { name: 'Review product 1 tax', exact: true })).toBeVisible();
  await expect(summary.getByRole('button', { name: 'Review product 2 tax', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  await page.locator('#products-addons-heading').click();
  await summary.getByRole('button', { name: 'Review product 2 tax', exact: true }).click();
  await expect(page.locator('#add-on-2-tax-treatment')).toBeFocused();
  await page.locator('#add-on-2-tax-treatment').selectOption('not-taxable');
  await expect(summary.getByRole('button', { name: 'Review product 2 tax', exact: true })).toHaveCount(0);
  await page.locator('#products-addons-heading').click();
  await summary.getByRole('button', { name: 'Review product 1 tax', exact: true }).click();
  await expect(page.locator('#add-on-1-tax-treatment')).toBeFocused();
  await expect(page.locator('#add-on-1-tax-treatment')).toHaveValue('');

  await page.locator('#add-on-1-tax-treatment').selectOption('not-taxable');
  await summary.getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
