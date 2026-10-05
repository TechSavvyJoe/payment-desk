import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

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
    await expect(home.locator('img.brand__logo')).toHaveAttribute('alt', '');
    const name = home.locator('.brand__name');
    await expect(name).toHaveText('Lakeside Motors');
    // Phones (≤440px) show the logo chip without the name text.
    if (page.viewportSize().width <= 440) await expect(name).toBeHidden();
    else await expect(name).toBeVisible();
  });

  test('a logo-only dealership gives the header logo an accessible name', async ({ page }) => {
    await seedBrand(page, { logo: LOGO });
    await page.goto('/');
    const logo = page.getByRole('link', { name: 'Payment Desk home' }).locator('img.brand__logo');
    await expect(logo).toHaveAttribute('alt', 'Dealership logo');
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

test.describe('dealership on customer estimates', () => {
  const NAME = "Lakeside Motors & Sons' <Fleet> 🚗";
  const openEstimate = async page => {
    await page.goto('/');
    await page.locator('details.deal-details > summary').click();
    await page.getByLabel('Estimate date', { exact: true }).fill('09/24/26');
    await page.locator('details.deal-details > summary').click();
    await page.getByLabel('Selling price', { exact: true }).fill('30000');
    await page.getByLabel('Selling price', { exact: true }).blur();
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
  };
  const copySummary = async page => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedEstimate = text; } } }));
    await page.getByRole('button', { name: 'Copy summary' }).click();
    await expect(page.getByRole('status')).toContainText('copied');
    return page.evaluate(() => window.testCopiedEstimate);
  };

  test('estimate card, copied text, share title, and printout use the dealership literally', async ({ page }, testInfo) => {
    await seedBrand(page, { name: NAME, logo: LOGO });
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.testSharedEstimate = data; } }));
    await openEstimate(page);
    const identity = page.locator('.proposal-identity');
    await expect(identity.locator('img.proposal-logo')).toHaveAttribute('src', LOGO);
    await expect(identity.locator('img.proposal-logo')).toHaveAttribute('alt', '');
    await expect(identity.locator('.proposal-brand')).toHaveText(NAME);
    await expect(page.locator('.proposal-qualification .proposal-meta')).toContainText(`${NAME} · PD-`);
    const copied = await copySummary(page);
    expect(copied.split('\n').slice(0, 2)).toEqual([NAME, 'Vehicle purchase estimate']);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.testSharedEstimate?.title)).toBe(`${NAME} — Vehicle purchase estimate`);
    await page.emulateMedia({ media: 'print' });
    const masthead = page.locator('.print-brand');
    await expect(masthead.locator('strong')).toHaveText(NAME);
    await expect(masthead.locator('span')).toHaveText('PAYMENT DESK');
    await expect(masthead.locator('img')).toHaveAttribute('src', LOGO);
    if (testInfo.project.name === 'chromium') {
      const pdf = await page.pdf({ printBackground: false, preferCSSPageSize: true });
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    }
  });

  test('a logo-only dealership keeps Payment Desk in the text and labels the logo', async ({ page }) => {
    await seedBrand(page, { logo: LOGO });
    await openEstimate(page);
    await expect(page.locator('.proposal-identity').getByRole('img', { name: 'Dealership logo' })).toBeVisible();
    await expect(page.locator('.proposal-identity .proposal-brand')).toHaveCount(0);
    expect((await copySummary(page)).split('\n')[0]).toBe('Payment Desk');
    await expect(page.locator('.print-brand strong')).toHaveCount(0);
    await expect(page.locator('.print-brand span')).toHaveText('PAYMENT DESK');
  });

  test('without a dealership the estimate and printout keep the Payment Desk identity', async ({ page }) => {
    await openEstimate(page);
    await expect(page.locator('.proposal-identity .proposal-brand')).toHaveText('Payment Desk');
    await expect(page.locator('.proposal-identity img')).toHaveCount(0);
    await expect(page.locator('.print-brand img')).toHaveAttribute('src', './payment-desk-icon.svg');
    await expect(page.locator('.print-brand strong')).toHaveText('Payment Desk');
    await expect(page.locator('.print-brand span')).toHaveCount(0);
  });

  test('a 60-character unbroken name wraps inside the printed masthead', async ({ page }) => {
    await seedBrand(page, { name: 'W'.repeat(60), logo: LOGO });
    await openEstimate(page);
    await page.emulateMedia({ media: 'print' });
    const fits = await page.evaluate(() => {
      const masthead = document.querySelector('.print-masthead').getBoundingClientRect();
      const brand = document.querySelector('.print-brand').getBoundingClientRect();
      const date = document.querySelector('.print-date').getBoundingClientRect();
      return { brandInside: brand.right <= masthead.right + 0.5, clearOfDate: brand.right <= date.left + 0.5, dateInside: date.right <= masthead.right + 0.5 };
    });
    expect(fits).toEqual({ brandInside: true, clearOfDate: true, dateInside: true });
  });
});
