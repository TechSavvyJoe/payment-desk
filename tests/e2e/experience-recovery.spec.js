import { test, expect } from '@playwright/test';

const summary = page => page.getByRole('complementary', { name: 'Current estimate summary', exact: true }).filter({ visible: true });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-09T16:00:00Z'));
  await page.goto('/');
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
});

test('payment-target shortcut preserves the customer number and unfinished input', async ({ page }) => {
  await page.locator('#target-value').fill('450');
  await page.locator('#target-value').blur();
  await summary(page).getByRole('button', { name: 'Set payment target', exact: true }).click();
  await expect(page.locator('#target-value')).toBeFocused();
  await expect(page.locator('#target-value')).toHaveValue('450');
  await page.getByRole('group', { name: 'Target type', exact: true }).getByRole('button', { name: 'Out-the-door', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Target type', exact: true }).getByRole('button', { name: 'Out-the-door', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#target-value')).toHaveAttribute('aria-label', 'Target out-the-door total');
  await page.locator('#target-value').fill('35000');
  await page.locator('#target-value').blur();
  await summary(page).getByRole('button', { name: 'Set payment target', exact: true }).click();
  await expect(page.locator('#target-value')).toBeFocused();
  await expect(page.locator('#target-value')).toHaveValue('450');
  await page.locator('#target-value').fill('4xx');
  await summary(page).getByRole('button', { name: 'Set payment target', exact: true }).click();
  await expect(page.locator('#target-value')).toHaveValue('4xx');
  await expect(page.locator('#target-value')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
});

test('a missing product name leads straight back to its collapsed field', async ({ page }) => {
  await page.locator('#add-product').click();
  await page.getByLabel('Product 1 type', { exact: true }).selectOption('other');
  await page.getByLabel('Product 1 amount', { exact: true }).fill('500');
  await page.getByLabel('Tax treatment for product or add-on 1', { exact: true }).selectOption('not-taxable');
  await page.locator('#products-addons-heading').click();
  await summary(page).getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Name product 1', exact: true }).click();
  const name = page.getByLabel('Product name for add-on 1', { exact: true });
  await expect(name).toBeFocused();
  await expect(page.locator('#products-addons-heading')).toHaveAttribute('aria-expanded', 'true');
  await name.fill('Wheel protection');
  await expect(page.getByLabel('Wheel protection amount', { exact: true })).toHaveValue('500');
  await summary(page).getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
});

test('unknown registration is repairable but never becomes an implicit zero', async ({ page }) => {
  await page.getByRole('group', { name: 'Plate type', exact: true }).getByRole('button', { name: 'New plate', exact: true }).click();
  await page.locator('#taxes-fees-heading').click();
  await summary(page).getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Enter registration estimate', exact: true }).click();
  await expect(page.locator('#new-plate-amount')).toBeFocused();
  await expect(page.locator('#new-plate-amount')).toHaveValue('');
  await page.locator('#new-plate-amount').fill('180');
  await page.locator('#new-plate-amount').blur();
  await summary(page).getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
});

test('cash switching explains the cleared down payment and can undo the entire switch', async ({ page }) => {
  await page.locator('#cash-down').fill('2000');
  await page.locator('#cash-down').blur();
  await expect(page.locator('.purchase-type-note')).toContainText('$2,000');
  await page.getByRole('group', { name: 'Purchase type', exact: true }).getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(summary(page).locator('.payment-number strong')).toHaveText('$32,162.84');
  await expect(summary(page).locator('.estimate-applied')).toContainText('financing down cleared');
  await summary(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#cash-down')).toHaveValue('2,000');
  await expect(summary(page).locator('.payment-number strong')).toHaveText('$507.05');
  await expect(page.getByRole('group', { name: 'Target type', exact: true }).getByRole('button', { name: 'Payment', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('customer alternatives open the guarded grid without changing the quote', async ({ page }) => {
  await page.locator('#cash-down').fill('1000.49');
  await page.locator('#cash-down').blur();
  const before = await summary(page).locator('.payment-number strong').innerText();
  await summary(page).getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust payment options', exact: true }).click();
  await expect(page.locator('#payment-grid-heading')).toBeFocused();
  await expect(page.getByRole('region', { name: 'Current worksheet scenario', exact: true })).toContainText('$1,000.49');
  await expect(page.getByRole('region', { name: 'Current worksheet scenario', exact: true })).toContainText(before);
});
