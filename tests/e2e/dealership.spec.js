import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'payment-desk.dealership.v1';
// 120×40 PNG: a red block and a navy bar on a transparent background.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAABDklEQVR4AezRMQ7CQAxE0ZCOjpNwIc7HXbgRZZC2RDK2033zI2Ub70rjefvrdj/84w42+LfD8xs/aUDgpCD6WGC6YJJf4KQg+lhgumCSX+CkIPpYYLpgkv9fgZNaCuPr49gAv8AFS/IVgcl6hewCF0oiXxGYrFfILnChJPIVgcl6hewCF0oiXxGYrFfI/gVceOEVVAMCo7j6YQXud4Z6ITCKqx9W4H5nqBcCo7j6YQXud4Z6ITCKqx9W4NXZ3EPgubZrM4FXDXMPgefars0EXjXMPQSea7s2E3jVMPcQ+Kzt+3nZAL/AZ4Eh734DQ5YwZtyAwHE3IyYCj2CMlxA47mbEROARjPESAsfdjJh8AAAA//9I3+EKAAAABklEQVQDALXOD8gV2DjBAAAAAElFTkSuQmCC';

// Seed once per tab so reload tests see what the app itself saved or cleared.
const seedBrand = (page, value) => page.addInitScript(([key, raw]) => {
  if (sessionStorage.getItem('test-brand-seeded')) return;
  localStorage.setItem(key, raw);
  sessionStorage.setItem('test-brand-seeded', '1');
}, [STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value)]);

test.describe('dealership header', () => {
  test('default header is unchanged when no dealership is saved', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    await expect(page.locator('.brand__credit')).toHaveCount(0);
  });

  test('a saved dealership shows its logo and name with a Payment Desk credit', async ({ page }) => {
    await seedBrand(page, { name: 'Lakeside Motors', logo: LOGO });
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' });
    await expect(home.locator('.brand__credit')).toHaveText('PAYMENT DESK');
    await expect(home.locator('img.brand__logo')).toHaveAttribute('src', LOGO);
    const name = home.locator('.brand__name');
    await expect(name).toHaveText('Lakeside Motors');
    // Phones (≤440px) show the logo chip without the name text.
    if (page.viewportSize().width <= 440) await expect(name).toBeHidden();
    else await expect(name).toBeVisible();
  });

  test('a name-only dealership shows the name above the credit', async ({ page }) => {
    await seedBrand(page, { name: 'Lakeside Motors' });
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' });
    await expect(home.locator('.brand__name')).toBeVisible();
    await expect(home.locator('.brand__credit')).toBeVisible();
    await expect(home.locator('img')).toHaveCount(0);
  });

  for (const [label, value] of [
    ['default wordmark', null],
    ['60-character unbroken name with a logo', { name: 'W'.repeat(60), logo: LOGO }],
    ['long name only', { name: 'Superior Chevrolet Buick GMC of Southwest Michigan Lakeshore' }],
  ]) {
    test(`header fits a 375px phone: ${label}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      if (value) await seedBrand(page, value);
      await page.goto('/');
      await expect(page.locator('#worksheet-heading')).toBeVisible();
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        const brand = header.querySelector('.brand').getBoundingClientRect();
        const actions = header.querySelector('.header-actions').getBoundingClientRect();
        return {
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          headerOverflow: header.scrollWidth - header.clientWidth,
          brandPastActions: Math.round(brand.right - actions.left),
        };
      });
      expect(layout.pageOverflow).toBeLessThanOrEqual(0);
      expect(layout.headerOverflow).toBeLessThanOrEqual(0);
      expect(layout.brandPastActions).toBeLessThanOrEqual(0);
    });
  }

  test('Reset deal keeps the saved dealership', async ({ page }) => {
    await seedBrand(page, { name: 'Lakeside Motors' });
    await page.goto('/');
    await page.getByLabel('Selling price', { exact: true }).fill('30000');
    await page.getByLabel('Selling price', { exact: true }).blur();
    let confirmed = false;
    page.once('dialog', dialog => { confirmed = true; return dialog.accept(); });
    await page.getByRole('button', { name: 'Reset deal' }).click();
    await expect.poll(() => confirmed).toBe(true);
    await expect(page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' })).toBeVisible();
  });

  test('damaged or unreadable storage falls back to Payment Desk without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await seedBrand(page, '{"name": "Broken');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    });
    await page.reload();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    expect(errors).toEqual([]);
  });
});
