import { test, expect } from '@playwright/test';
import { DESK_DRAFT_KEY } from '../../src/lib/deskDraft.js';

for (const [label, raw] of [['malformed', '{invalid'], ['newer version', JSON.stringify({ version: 99 })]]) {
  test(`${label} saved draft stays intact until an explicit confirmed discard`, async ({ page }) => {
    await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key: DESK_DRAFT_KEY, raw });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('saved worksheet could not be restored');
    await page.locator('#sale-price').fill('25000');
    await page.locator('#sale-price').blur();
    await expect(page.locator('.app-footer')).toContainText('Unreadable saved worksheet preserved');
    expect(await page.evaluate(key => localStorage.getItem(key), DESK_DRAFT_KEY)).toBe(raw);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Discard unreadable draft' }).click();
    expect(await page.evaluate(key => localStorage.getItem(key), DESK_DRAFT_KEY)).toBe(raw);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Discard unreadable draft' }).click();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).desk?.deal.salePrice, DESK_DRAFT_KEY)).toBe(25000);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#sale-price')).toHaveValue('25,000');
  });
}

test('external settings invalidate an open customer PDF until reload', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#sale-price').fill('25000');
  await page.locator('#sale-price').blur();
  await expect(page.locator('.app-footer')).toContainText('Draft saved');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Dealership settings', exact: true }).click();
  await other.getByRole('textbox', { name: 'Dealership name', exact: false }).fill('Synthetic Motors');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#settings-changed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload settings' }).click();
  await expect(page.locator('#settings-changed')).toHaveCount(0);
  await expect(page.locator('.brand')).toContainText('Synthetic Motors');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  await other.close();
});

test('external settings do not overwrite an open settings draft or permit stale saves', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dealership settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Dealership name', exact: false }).fill('Unsaved local name');
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: 'Dealership settings', exact: true }).click();
  await other.getByRole('textbox', { name: 'Dealership name', exact: false }).fill('Saved elsewhere');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Settings changed in another tab');
  await expect(page.getByRole('textbox', { name: 'Dealership name', exact: false })).toHaveValue('Unsaved local name');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear dealership settings', exact: true })).toBeDisabled();
  await other.close();
});

test('switching target types clears only the old raw error and retains committed targets', async ({ page }) => {
  await page.goto('/'); await page.locator('#sale-price').fill('25000');
  const input = page.locator('#target-value');
  await input.fill('abc'); await expect(input).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Out-the-door', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await input.pressSequentially('20000.25'); await expect(input).toBeFocused(); await input.blur();
  await page.getByRole('button', { name: 'Loan balance', exact: true }).click(); await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Out-the-door', exact: true }).click(); await expect(input).toHaveValue('20,000.25');
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(input).toHaveAccessibleName('Target cash due after trade'); await expect(input).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('phone and panel worksheet return focus is visible', async ({ page }) => {
  for (const width of [390, 450]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/');
    await page.locator('#sale-price').fill('25000');
    await page.getByRole('button', { name: 'Payment grid', exact: true }).click();
    await page.getByRole('button', { name: 'Back to calculator', exact: true }).press('Enter');
    await expect(page.locator('#calculator-top')).toBeFocused();
    const box = await page.locator('#calculator-top').boundingBox(); expect(box.width).toBeGreaterThan(300);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y).toBeLessThan(844);
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await page.getByRole('button', { name: 'Edit deal', exact: true }).press('Enter');
    await expect(page.locator('#calculator-top')).toBeFocused();
  }
});
