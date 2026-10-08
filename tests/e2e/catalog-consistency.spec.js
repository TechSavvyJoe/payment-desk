import { test, expect } from '@playwright/test';

async function catalogFixture(page, mode) {
  await page.addInitScript(mode => {
    const site = 'https://dealer.example.com/';
    const vehicles = Array.from({ length: 101 }, (_, n) => ({
      name: '2024 Ford Explorer', url: `${site}vehicle/${n}`, stock: `S${n}`,
      price: 25000, websitePrice: 26000, condition: 'used', listed: true,
      lastSeenAt: 1000, features: [],
    }));
    let changed = false;
    window.catalogReads = [];
    window.paymentDeskCompanionId = 'a'.repeat(32);
    window.chrome = { runtime: { id: 'a'.repeat(32), sendMessage(message, respond) {
      window.catalogReads.push(message);
      if (mode === 'changed' && message.offset === 100 && !changed) {
        changed = true;
        respond({ ok: false, code: 'catalog_changed' });
        return;
      }
      const offset = message.offset || 0;
      respond({ ok: true, version: 1, site, revision: mode === 'legacy' ? undefined : (changed ? 'b' : 'a').repeat(64),
        vehicles: vehicles.slice(offset, offset + 100), total: vehicles.length,
        nextOffset: offset + 100 < vehicles.length ? offset + 100 : null,
        lastCompletedAt: 1000, refreshing: false, error: '',
      });
    } } };
  }, mode);
  await page.goto('/');
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Dealership inventory' });
  await expect(picker.locator('.inventory-picker__vehicle')).toHaveCount(100);
  return picker;
}

test('stable catalog pages are pinned and can navigate in both directions', async ({ page }) => {
  const picker = await catalogFixture(page, 'stable');
  await picker.getByRole('button', { name: 'Next vehicles' }).click();
  await expect(picker.locator('.inventory-picker__vehicle')).toHaveCount(1);
  await expect(picker).toContainText('Stock S100');
  expect(await page.evaluate(() => window.catalogReads.at(-1).revision)).toBe('a'.repeat(64));
  await picker.getByRole('button', { name: 'Previous vehicles' }).click();
  await expect(picker.locator('.inventory-picker__vehicle')).toHaveCount(100);
});

test('catalog changes stop pagination and reload starts from the first updated page', async ({ page }) => {
  const picker = await catalogFixture(page, 'changed');
  await picker.getByRole('button', { name: 'Next vehicles' }).click();
  await expect(picker).toContainText('Inventory changed while you were browsing');
  await expect(picker.locator('.inventory-picker__vehicle')).toHaveCount(0);
  await picker.getByRole('button', { name: 'Reload catalog' }).click();
  await expect(picker.locator('.inventory-picker__vehicle')).toHaveCount(100);
  expect(await page.evaluate(() => window.catalogReads.at(-1).offset)).toBe(0);
  await picker.getByRole('button', { name: 'Next vehicles' }).click();
  await expect(picker.locator('.inventory-picker__vehicle')).toHaveCount(1);
  expect(await page.evaluate(() => window.catalogReads.at(-1).revision)).toBe('b'.repeat(64));
});

test('legacy companions keep first-page access and explain the safe update requirement', async ({ page }) => {
  const picker = await catalogFixture(page, 'legacy');
  await expect(picker).toContainText('Update the companion to browse the remaining vehicles safely');
  await expect(picker.getByRole('button', { name: 'Next vehicles' })).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Reload catalog' })).toBeEnabled();
});
