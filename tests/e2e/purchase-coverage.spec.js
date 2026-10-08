import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('coverage is visible and unsupported jurisdictions block estimates and survive refresh', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.coverage-note')).toContainText('Michigan resident purchases only');
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
  await page.getByRole('button', { name: 'Review tax coverage' }).click();
  const state = page.getByLabel('Buyer registration state', { exact: true });
  await expect(state).toBeFocused();
  await state.selectOption('NY');
  await expect(page.locator('.validation-banner').filter({ hasText: 'Tax rules unavailable' })).toContainText('New York automatic tax and registration rules are not connected');
  await expect(page.locator('#taxes-fees-content')).not.toContainText('Michigan sales tax');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(state).toBeFocused();
  await expect(page.locator('.customer-actions')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('payment-desk.draft.v2'))?.desk.deal.registrationState)).toBe('NY');
  await page.reload();
  await expect(page.locator('.validation-banner').filter({ hasText: 'Tax rules unavailable' })).toContainText('New York automatic tax and registration rules are not connected');
  await page.getByRole('button', { name: 'Review tax coverage' }).click();
  await expect(state).toHaveValue('NY');
  await state.selectOption('MI');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
});

test('unsupported transaction types are explicit, accessible and recoverable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sale-price').fill('30000');
  await page.getByRole('button', { name: 'Review tax coverage' }).click();
  const scope = page.getByLabel('Transaction coverage', { exact: true });
  await scope.selectOption('manufacturer-rebate');
  await expect(page.locator('.validation-banner').filter({ hasText: 'Tax rules unavailable' })).toContainText('outside the reviewed Michigan resident retail purchase rules');
  await expect(scope).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(scope).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await scope.selectOption('resident-retail');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});
