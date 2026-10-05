import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import AxeBuilder from '@axe-core/playwright';

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
    // The dealership lives in App state, so reload to prove Reset did not wipe storage.
    await page.reload();
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

test.describe('dealership settings dialog', () => {
  const makePng = (page, width, height) => page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.fillStyle = '#c8102e';
    context.fillRect(0, 0, Math.ceil(w * 0.6), h);
    context.fillStyle = '#00095b';
    context.fillRect(Math.floor(w * 0.65), Math.floor(h * 0.2), Math.ceil(w * 0.35), Math.ceil(h * 0.6));
    return canvas.toDataURL('image/png').split(',')[1];
  }, [width, height]).then(base64 => ({ name: 'dealer-logo.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }));
  const openSettings = async page => {
    await page.getByRole('button', { name: 'Dealership settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dealership settings' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const storedLogoSize = page => page.evaluate(async key => {
    const image = new Image();
    image.src = JSON.parse(localStorage.getItem(key)).logo;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, STORAGE_KEY);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#worksheet-heading')).toBeVisible();
  });

  test('settings are offered only in Dealer view', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toBeVisible();
    await page.getByLabel('Selling price', { exact: true }).fill('30000');
    await page.getByLabel('Selling price', { exact: true }).blur();
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your purchase estimate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toHaveCount(0);
  });

  test('saving a name and logo updates the app, survives reload, and Clear restores Payment Desk', async ({ page }) => {
    let dialog = await openSettings(page);
    await dialog.getByLabel('Dealership name').fill('Lakeside Motors');
    await dialog.getByLabel('Choose logo').setInputFiles(await makePng(page, 1200, 400));
    await expect(dialog.getByRole('img', { name: 'Logo preview' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toBeFocused();
    const home = page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' });
    await expect(home.locator('img.brand__logo')).toBeVisible();
    expect(await storedLogoSize(page)).toEqual({ width: 600, height: 200 });
    await page.reload();
    await expect(home).toBeVisible();
    dialog = await openSettings(page);
    await expect(dialog.getByLabel('Dealership name')).toHaveValue('Lakeside Motors');
    page.once('dialog', confirm => confirm.accept());
    await dialog.getByRole('button', { name: 'Clear dealership settings' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
  });

  test('Cancel and Escape discard draft changes and return focus', async ({ page }) => {
    let dialog = await openSettings(page);
    await dialog.getByLabel('Dealership name').fill('Draft Motors');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    dialog = await openSettings(page);
    await expect(dialog.getByLabel('Dealership name')).toHaveValue('');
    await dialog.getByLabel('Dealership name').fill('Draft Motors');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
  });

  test('unusable files explain the problem and keep the current logo', async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.getByLabel('Choose logo').setInputFiles(await makePng(page, 240, 80));
    const preview = dialog.getByRole('img', { name: 'Logo preview' });
    await expect(preview).toBeVisible();
    const before = await preview.getAttribute('src');
    const status = dialog.getByRole('status');
    await dialog.getByLabel('Replace logo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await expect(status).toHaveText('Use a PNG, JPG, WebP, GIF, or SVG image for the logo.');
    await dialog.getByLabel('Replace logo').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
    await expect(status).toHaveText("That file couldn't be read as an image. Try saving the logo as a PNG.");
    await dialog.getByLabel('Replace logo').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(status).toHaveText('That logo file is larger than 10 MB. Use a smaller image.');
    await expect(preview).toHaveAttribute('src', before);
  });

  test('very tall and tiny logos fit the limits without enlarging and keep the header height', async ({ page }) => {
    const headerHeight = (await page.locator('.app-header').boundingBox()).height;
    for (const [width, height, expected] of [[100, 1000, { width: 20, height: 200 }], [16, 16, { width: 16, height: 16 }]]) {
      const dialog = await openSettings(page);
      await dialog.getByLabel(/^(Choose|Replace) logo$/).setInputFiles(await makePng(page, width, height));
      await expect(dialog.getByRole('img', { name: 'Logo preview' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      expect(await storedLogoSize(page)).toEqual(expected);
      expect((await page.locator('.app-header').boundingBox()).height).toBeLessThanOrEqual(headerHeight + 1);
    }
  });

  test('when the browser refuses to save, the dealership still shows for this visit with a warning', async ({ page }) => {
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    const dialog = await openSettings(page);
    await dialog.getByLabel('Dealership name').fill('Lakeside Motors');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('status')).toContainText("Couldn't save on this device");
    await expect(page.locator('.app-header .brand__name')).toHaveText('Lakeside Motors');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' })).toBeVisible();
  });

  test('the dialog fits a phone, avoids iOS zoom, keeps the file picker focusable, and passes an accessibility scan', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const dialog = await openSettings(page);
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
    const fontSize = await dialog.getByLabel('Dealership name').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    await dialog.getByLabel('Choose logo').focus();
    await expect(dialog.getByLabel('Choose logo')).toBeFocused();
    const scan = await new AxeBuilder({ page }).include('.settings-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
  });
});
