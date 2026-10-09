import { test, expect } from '@playwright/test';

const summary = page => page.getByRole('complementary', { name: 'Current estimate summary', exact: true }).filter({ visible: true });
const openGrid = async page => {
  await (page.viewportSize().width <= 800 ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
  await expect(page.locator('#payment-grid')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T16:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
});

test('excess trade recovery leaves the mobile grid and focuses the contributing allowance', async ({ page }) => {
  await page.locator('#sale-price').fill('1000');
  await page.locator('#trade-allowance').fill('5000');
  await page.locator('#trade-allowance').blur();
  await expect(page.locator('#cash-down')).toHaveValue('0');
  const repairs = summary(page).getByRole('button', { name: 'Review cash and trade', exact: true });
  expect(await repairs.count()).toBeGreaterThan(0);
  for (let index = 0; index < await repairs.count(); index += 1) {
    await repairs.nth(index).click();
    await expect(page.locator('#trade-allowance')).toBeFocused();
  }
  await openGrid(page);
  await page.locator('.grid-readiness').getByRole('button', { name: 'Review worksheet', exact: true }).click();
  await expect(page.locator('#trade-allowance')).toBeVisible();
  await expect(page.locator('#trade-allowance')).toBeFocused();
  await page.locator('#trade-allowance').fill('500');
  await page.locator('#trade-allowance').blur();
  await expect(summary(page).locator('.estimate-readiness')).toHaveCount(0);
});

for (const [field, value, valid] of [
  ['registration-state', 'NY', 'MI'],
  ['transaction-scope', 'exempt', 'resident-retail'],
]) {
  test(`unsupported ${field} grid recovery opens the actual scope selector`, async ({ page }) => {
    await page.locator('details.deal-details > summary').click();
    await page.locator(`#${field}`).selectOption(value);
    await page.locator('details.deal-details > summary').click();
    await expect(page.locator('#payment-grid button[aria-label^="Use "]:enabled')).toHaveCount(0);
    if (page.viewportSize().width <= 800) {
      // The phone shortcut already routes calculation errors to their field;
      // it must not expose a grid of unsupported financial estimates.
      await page.locator('#mobile-grid-trigger').click();
      await expect(page.locator('#payment-grid')).toBeHidden();
    } else {
      await page.locator('.grid-readiness').getByRole('button', { name: 'Review worksheet', exact: true }).click();
    }
    await expect(page.locator('details.deal-details')).toHaveAttribute('open', '');
    await expect(page.locator(`#${field}`)).toBeVisible();
    await expect(page.locator(`#${field}`)).toBeFocused();
    await expect(page.locator(`#${field}`)).toHaveValue(value);
    await page.locator(`#${field}`).selectOption(valid);
    await page.locator('details.deal-details > summary').click();
    await openGrid(page);
    await expect(page.locator('#payment-grid button[aria-label^="Use "]:enabled').first()).toBeEnabled();
  });
}
