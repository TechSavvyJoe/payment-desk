import { test, expect } from '@playwright/test';

const KEY = 'payment-desk.draft.v1';
const openGrid = async page => {
  const jump = page.locator('.grid-jump');
  if (await jump.isVisible()) await jump.click();
  else await page.locator('.mobile-nav button').first().click();
};
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-07T16:00:00Z'));
  await page.goto('/');
});

test('refresh restores the worksheet, products, grid and target; Reset clears the draft', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await page.locator('#cash-down').fill('2500');
  await page.locator('#trade-allowance').fill('8000');
  await page.locator('#trade-payoff').fill('3000');
  await page.getByRole('group', { name: 'Loan term', exact: true }).getByRole('button', { name: '60', exact: true }).click();
  await page.locator('details.deal-details > summary').click();
  await page.locator('#vehicle-reference').fill('Test Explorer / H12345');
  await page.locator('#estimate-date').fill('10/06/26');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product 1 type').selectOption('other');
  await page.getByLabel('Name for product or add-on 1').fill('Accessories');
  await page.getByLabel('Accessories amount').fill('750');
  await page.getByLabel('Tax treatment for Accessories').selectOption('not-taxable');
  await openGrid(page);
  await page.locator('#grid-down-3').fill('3500');
  await page.locator('#grid-apr-60').fill('5.75');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await page.locator('#target-value').fill('450');
  await page.locator('#target-value').blur();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.targetValues.payment, KEY)).toBe(450);
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  await expect(page.locator('#cash-down')).toHaveValue('2,500');
  await expect(page.locator('#trade-allowance')).toHaveValue('8,000');
  await expect(page.locator('#trade-payoff')).toHaveValue('3,000');
  await expect(page.locator('#apr')).toHaveValue('5.75');
  await expect(page.locator('#target-value')).toHaveValue('450');
  await expect(page.getByLabel('Accessories amount')).toHaveValue('750');
  await expect(page.getByLabel('Tax treatment for Accessories')).toHaveValue('not-taxable');
  await page.locator('details.deal-details > summary').click();
  await expect(page.locator('#vehicle-reference')).toHaveValue('Test Explorer / H12345');
  await expect(page.locator('#estimate-date')).toHaveValue('10/06/26');
  await openGrid(page);
  await expect(page.locator('#grid-down-3')).toHaveValue('3,500');
  await expect(page.locator('#grid-apr-60')).toHaveValue('5.75');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('');
  await expect(page.locator('#cash-down')).toHaveValue('0');
  await expect(page.locator('#target-value')).toHaveValue('');
  await expect(page.locator('.option-row')).toHaveCount(0);
});

test('invalid price and date drafts stay invalid after refresh and cannot become an export', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').fill('30k');
  await page.locator('details.deal-details > summary').click();
  await page.locator('#estimate-date').fill('02/30/26');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.inputDrafts['estimate-date']?.raw, KEY)).toBe('02/30/26');
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('30k');
  await expect(page.locator('#sale-price')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#estimate-date')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await page.locator('#sale-price').fill('30000');
  if (!await page.locator('#estimate-date').isVisible()) await page.locator('details.deal-details > summary').click();
  await page.locator('#estimate-date').fill('10/07/26');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});

test('blocked draft storage gives an honest warning while the current worksheet still works', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
  await page.reload();
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
  await expect(page.locator('.app-footer')).toContainText('Draft could not be saved');
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});

test('an invalid grid rate survives refresh and blocks an estimate until corrected', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await openGrid(page);
  await page.locator('#grid-apr-60').fill('bad rate');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await page.reload();
  await expect(page.locator('#grid-apr-60')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await expect(page.locator('#grid-apr-60')).toHaveValue('bad rate');
  await page.locator('#grid-apr-60').fill('6');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});
