import { test, expect } from '@playwright/test';

test('a keyboard section jump focuses its accordion control so Space can reopen it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const accordion = page.locator('#trade-cash-heading');
  await accordion.focus();
  await page.keyboard.press('Space');
  await expect(accordion).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Cash down', { exact: true })).toBeHidden();

  const shortcut = page.getByRole('navigation', { name: 'Jump to deal section' }).getByRole('button', { name: 'Trade', exact: true });
  await shortcut.focus();
  await page.keyboard.press('Enter');
  await expect(accordion).toBeFocused();
  await page.keyboard.press('Space');
  await expect(accordion).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Cash down', { exact: true })).toBeFocused();
});

test('financial inputs expose helper instructions together with validation errors', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Selling price', { exact: true }).fill('30000');
  const apr = page.getByLabel('Annual interest rate', { exact: true });
  await expect(apr).toHaveAccessibleDescription('Assumed annual rate · up to 2 decimals');
  await apr.fill('6x');
  await apr.blur();
  await expect(apr).toHaveAccessibleDescription(/Assumed annual rate · up to 2 decimals.*Enter a number/);
  await apr.fill('6.5');
  await apr.blur();
  await expect(apr).toHaveAccessibleDescription('Assumed annual rate · up to 2 decimals');

  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  const plate = page.getByLabel('New plate amount', { exact: true });
  await expect(plate).toHaveAccessibleDescription(/Enter registration estimate\. Title .* added separately\./);
  await plate.fill('-1');
  await plate.blur();
  await expect(plate).toHaveAccessibleDescription(/Enter registration estimate\. Title .* added separately\..*Enter a number/);
});
