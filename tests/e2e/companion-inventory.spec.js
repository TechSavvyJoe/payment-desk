import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('inventory explains how to connect the companion, closes by keyboard, and preserves the deal', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
  const trigger = page.getByRole('button', { name: 'Inventory', exact: true });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Dealership inventory' });
  await expect(picker).toContainText('select Web app to connect this browser');
  await expect(picker.getByRole('button', { name: 'Reload catalog' })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include('.inventory-picker').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['payment-desk.draft.v2']);
});
