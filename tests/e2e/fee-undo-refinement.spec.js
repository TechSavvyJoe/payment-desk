import { test, expect } from '@playwright/test';

const price = page => page.getByRole('textbox', { name: 'Selling price', exact: true });
const currentPayment = page => page.locator('.desktop-results:visible, .mobile-results:visible')
  .locator('.results-payment .payment-number strong');
const appliedStatus = page => page.locator('.estimate-applied:visible');

async function applyGridAdjustment(page) {
  await price(page).fill('30000');
  await price(page).press('Tab');
  await (page.viewportSize().width <= 800 ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
  const grid = page.locator('#payment-grid');
  await grid.getByRole('button', { name: /Use 60 months.*with \$1,000 down/ }).click();
  await expect(appliedStatus(page)).toBeVisible();
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Dealership settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dealership settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saveFee(page, field, value) {
  const dialog = await openSettings(page);
  await dialog.getByRole('textbox', { name: field, exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date('2026-09-24T16:00:00Z'));
  await page.goto('/');
  await expect(price(page)).toBeVisible();
});

for (const [feeName, field, value] of [
  ['document fee', 'Document fee', '199'],
  ['CRV fee', 'CRV dealer fee', '75'],
]) {
  test(`changing the ${feeName} expires Undo after a grid adjustment`, async ({ page }) => {
    await applyGridAdjustment(page);
    const previousPayment = await currentPayment(page).innerText();

    await saveFee(page, field, value);

    await expect(appliedStatus(page)).toHaveCount(0);
    await expect(currentPayment(page)).not.toHaveText(previousPayment);
  });
}

test('clearing a changed fee expires Undo after a grid adjustment', async ({ page }) => {
  await saveFee(page, 'CRV dealer fee', '75');
  await applyGridAdjustment(page);
  const previousPayment = await currentPayment(page).innerText();

  const dialog = await openSettings(page);
  page.once('dialog', confirm => confirm.accept());
  await dialog.getByRole('button', { name: 'Clear dealership settings', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(appliedStatus(page)).toHaveCount(0);
  await expect(currentPayment(page)).not.toHaveText(previousPayment);
});

test('brand-only settings preserve Undo after a grid adjustment', async ({ page }) => {
  await applyGridAdjustment(page);

  const dialog = await openSettings(page);
  await dialog.getByRole('textbox', { name: /^Dealership name/ }).fill('Lakeside Motors');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(appliedStatus(page)).toBeVisible();
  await expect(appliedStatus(page).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});

test('a changed fee applied in memory still expires Undo when storage fails', async ({ page }) => {
  await applyGridAdjustment(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });

  const dialog = await openSettings(page);
  await dialog.getByRole('textbox', { name: 'CRV dealer fee', exact: true }).fill('75');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText("Couldn't save on this device");
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(appliedStatus(page)).toHaveCount(0);
  await expect(page.locator('.fixed-fees > div').filter({ hasText: 'CRV fee' }).locator('dd')).toHaveText('$75');
});
