import { test, expect } from '@playwright/test';

const currentSummary = page => page
  .getByRole('complementary', { name: 'Current estimate summary', exact: true })
  .filter({ visible: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T16:00:00Z'));
  await page.goto('/');
  // The heading is visually hidden on phones, so check it is attached and the first input is visible.
  await expect(page.locator('#worksheet-heading')).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toBeVisible();
});

test('a new deal leads from selling price to customer review and back to editing', async ({ page }) => {
  const summary = currentSummary(page);
  const price = page.getByRole('textbox', { name: 'Selling price', exact: true });

  // Phones start from the bottom bar; their summary card appears once a price exists.
  const start = page.viewportSize().width <= 800
    ? page.getByRole('navigation', { name: 'Mobile calculator shortcuts' }).getByRole('button', { name: 'Enter selling price', exact: true })
    : summary.getByRole('button', { name: 'Enter selling price', exact: true });
  await start.click();
  await expect(price).toBeFocused();
  await price.fill('30000');
  await price.blur();
  await expect(summary.locator('.payment-number strong')).toHaveText('$540.67');

  await summary.getByRole('button', { name: 'Review customer estimate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your purchase estimate', exact: true })).toBeVisible();
  await expect(page.locator('#customer-heading')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeEnabled();
  await expect(page.locator('.results-panel--customer .payment-number strong')).toHaveText('$540.67');

  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await expect(page.locator('#worksheet-heading')).toBeFocused();
  await expect(price).toHaveValue('30,000');
  await expect(currentSummary(page).locator('.payment-number strong')).toHaveText('$540.67');
});

test('the summary comparison shortcut opens the current payment grid and returns to the deal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Mobile uses the sticky Payment grid action covered by the existing navigation journey.');
  const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
  await price.fill('30000');
  await price.blur();
  await currentSummary(page).getByRole('button', { name: 'Compare payments', exact: true }).click();

  const grid = page.locator('#payment-grid');
  await expect(page.getByRole('heading', { name: 'Payment grid', exact: true })).toBeVisible();
  await expect(page.locator('#payment-grid-heading')).toBeFocused();
  await expect(grid.getByRole('button', { name: /Use 72 months.*\$0 down.*\$540\.67 per month/ }).filter({ visible: true }))
    .toHaveAttribute('aria-pressed', 'true');

  await grid.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await expect(page.locator('#worksheet-heading')).toBeFocused();
  await expect(price).toHaveValue('30,000');
  await expect(currentSummary(page).locator('.payment-number strong')).toHaveText('$540.67');
});
