import { test, expect } from '@playwright/test';

const companionId = 'abcdefghijklmnopabcdefghijklmnop';

async function openPicker(page, catalog) {
  await page.addInitScript(({ id, response }) => {
    window.paymentDeskCompanionId = id;
    Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: {
      id: 'ponmlkjihgfedcbaponmlkjihgfedcba',
      sendMessage: (...args) => queueMicrotask(() => args.at(-1)(response)),
    } } });
  }, { id: companionId, response: catalog });
  await page.goto('/');
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  return page.getByRole('dialog', { name: 'Dealership inventory' });
}

test('missing companion connection shows the in-app recovery paragraph', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Dealership inventory' });
  await expect(picker.getByText(/Open Payment Desk Companion in Chrome and select Web app to connect this browser/)).toBeVisible();
});

test('an empty companion catalog shows the first-time connection sequence', async ({ page }) => {
  const picker = await openPicker(page, {
    ok: true, version: 1, revision: 'a'.repeat(64), site: '', vehicles: [], total: 0,
    nextOffset: null, lastCompletedAt: null, refreshing: false, error: '',
  });
  await expect(picker.locator('ol')).toContainText('Connect and refresh');
  await expect(picker.locator('ol')).toContainText('Web app ↗');
  await expect(picker.getByRole('button', { name: 'Reload catalog' })).toBeEnabled();
});

test('empty catalog states distinguish never refreshed, partial, and completed filters', async ({ page }) => {
  const cases = [
    { lastCompletedAt: null, error: '', text: 'No complete refresh has finished yet' },
    { lastCompletedAt: null, error: 'Source was incomplete.', text: 'The refresh was incomplete' },
    { lastCompletedAt: 1_790_000_000_000, error: 'One source failed.', text: 'last refresh was partial' },
    { lastCompletedAt: 1_790_000_000_000, error: '', text: 'No matching vehicles. Adjust the filters' },
  ];
  for (const state of cases) {
    const picker = await openPicker(page, {
      ok: true, version: 1, revision: 'b'.repeat(64), site: 'https://dealer.example.com/', vehicles: [], total: 0,
      nextOffset: null, refreshing: false, ...state,
    });
    await expect(picker.getByText(new RegExp(state.text))).toBeVisible();
    await picker.getByRole('button', { name: 'Close' }).click();
  }
});
