import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#worksheet-heading')).toBeVisible();
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Estimate date', { exact: true }).fill('09/24/26');
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Selling price', { exact: true }).fill('30000');
  await page.getByLabel('Selling price', { exact: true }).blur();
});

test('product categories, explicit Other tax treatment, and complete customer export', async ({ page }, testInfo) => {
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Vehicle / stock reference').fill('Test Explorer / stock 123');
  await page.locator('details.deal-details > summary').click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByLabel('Product 1 type')).toHaveValue('service-contract');
  await expect(page.getByLabel('Product 1 type').locator('option')).toHaveText(['Service Contract', 'Gap', 'Other']);
  await page.getByLabel('Service Contract amount').fill('2000');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product 2 type').selectOption('gap');
  await page.getByLabel('Gap amount').fill('900');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product 3 type').selectOption('other');
  await page.getByLabel('Product name for add-on 3').fill('Accessories');
  await page.getByLabel('Accessories amount').fill('1000');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('#worksheet-heading')).toBeVisible();
  await expect(page.getByLabel('Tax treatment for Accessories')).toBeFocused();
  await page.getByLabel('Tax treatment for Accessories').selectOption('taxable');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
  await expect(page.locator('.customer-ledger').filter({ hasText: 'Service Contract' })).toContainText('Accessories');
  await expect(page.getByRole('table', { name: 'Customer payment options' })).toContainText('Selected');
  await expect(page.getByRole('table', { name: 'Customer payment options' })).not.toContainText(/total interest|interest paid|total (?:loan )?payments/i);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedEstimate = text; } } }));
  await page.getByRole('button', { name: 'Copy summary' }).click();
  await expect(page.getByRole('status')).toContainText('copied');
  const copied = await page.evaluate(() => window.testCopiedEstimate);
  expect(copied).toContain('Test Explorer / stock 123');
  expect(copied).toContain('Service Contract');
  expect(copied).toContain('Accessories');
  expect(copied).toContain('does not restore this proposal');
  expect(copied).toContain('not a financing approval or contract');
  expect(copied).not.toMatch(/total interest|interest paid|total (?:loan )?payments/i);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-qualification')).toBeVisible();
  await expect(page.locator('.customer-actions')).toBeHidden();
  await expect(page.locator('.print-brand')).toContainText('Payment Desk');
  await expect(page.locator('.customer-print-root')).toBeVisible();
  await expect(page.locator('.customer-print-root')).not.toContainText(/total interest|interest paid|total (?:loan )?payments/i);
  await expect(page.locator('.print-tax-credit')).toContainText('2026 trade deduction limit: $12,000.00');
  if (testInfo.project.name === 'chromium') {
    const pdf = await page.pdf({ path: testInfo.outputPath('customer-estimate.pdf'), printBackground: false, preferCSSPageSize: true });
    expect(pdf.byteLength).toBeGreaterThan(10000);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    await testInfo.attach('customer-estimate', { body: pdf, contentType: 'application/pdf' });
  }
});

test('cash down and every grid down-payment input retain focus through complete amounts', async ({ page }) => {
  test.setTimeout(90_000);
  const cashDown = page.getByLabel('Cash down', { exact: true });
  await cashDown.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('1234.56', { delay: 30 });
  await expect(cashDown).toBeFocused();
  await expect(cashDown).toHaveValue('1234.56');
  await cashDown.blur();
  await expect(cashDown).toHaveValue('1,234.56');

  const mobile = page.viewportSize().width <= 800;
  await (mobile ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
  const amounts = ['1234.56', '2345.67', '3456.78', '4567.89'];
  for (const [index, amount] of amounts.entries()) {
    const input = page.getByLabel(`Down payment ${mobile ? 'option' : 'column'} ${index + 1}`, { exact: true });
    await input.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(amount, { delay: 30 });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(amount);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(String(2000 + index * 1000), { delay: 30 });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(String(2000 + index * 1000));
    await input.blur();
    await expect(input).toHaveValue(`${index + 2},000`);
  }
  await page.getByRole('button', { name: /Use 60 months.*5,000.*down/ }).filter({ visible: true }).click();
  await expect(cashDown).toHaveValue('5,000');
});

test('grid selection and customer navigation retain visible totals on every device', async ({ page }) => {
  const mobile = page.viewportSize().width <= 800;
  await (mobile ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
  await expect(page.getByRole('heading', { name: 'Payment grid', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Use 60 months.*2,000.*down/ }).filter({ visible: true }).click();
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,000');
  await expect(page.getByRole('button', { name: '60', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await (mobile ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your purchase estimate' })).toBeVisible();
  const summary = page.getByRole('complementary', { name: 'Selected estimate summary' });
  for (const text of ['Estimated loan balance', 'Out-the-door total', 'Due at signing']) await expect(summary).toContainText(text);
  await expect(summary).toBeVisible();
});

test('maximum product estimate prints one complete page and returns to editing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Actual PDF pagination is available in Chromium.');
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Vehicle / stock reference').fill('2026 Explorer / stock reference '.repeat(4).slice(0, 100));
  await page.locator('details.deal-details > summary').click();
  await page.getByRole('group', { name: 'Loan term', exact: true }).getByRole('button', { name: '48', exact: true }).click();
  await page.getByLabel('Trade allowance', { exact: true }).fill('10000');
  await page.getByLabel('Trade payoff', { exact: true }).fill('17000');
  await page.getByLabel('Include negative equity in financing').uncheck();
  const names = [];
  for (let index = 0; index < 50; index++) {
    const detail = index % 2 ? 'LONGUNBROKENPRODUCTDESCRIPTION' : ' wheel tire interior protection coverage ';
    const name = `Product ${index + 1} ${detail.repeat(8)}`.slice(0, 120);
    names.push(name);
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    const row = page.locator('.option-row').nth(index);
    await row.getByLabel(`Product ${index + 1} type`, { exact: true }).selectOption('other');
    await row.getByLabel(`Product name for add-on ${index + 1}`, { exact: true }).fill(name);
    await row.getByLabel(`Tax treatment for ${name}`, { exact: true }).selectOption(index % 2 ? 'taxable' : 'not-taxable');
    await row.getByLabel(`${name} amount`, { exact: true }).fill(String(100 + index));
  }
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  for (const printBackground of [false, true]) {
    const pdf = await page.pdf({ printBackground, preferCSSPageSize: true });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    await testInfo.attach(`maximum-products-background-${printBackground}`, { body: pdf, contentType: 'application/pdf' });
  }
  await expect(page.locator('.print-product-name')).toHaveText(names);
  await expect(page.locator('.print-option')).toHaveCount(4);
  await expect(page.locator('.customer-print-sheet')).toContainText('Negative equity paid at signing');
  await page.emulateMedia({ media: 'print' });
  const layout = await page.locator('.customer-print-root').evaluate(root => {
    const page = root.getBoundingClientRect();
    const clipped = [...root.querySelectorAll('.print-product-name, .print-row, .print-option, .print-qualification')].some(element => {
      const box = element.getBoundingClientRect();
      return box.left < page.left - 1 || box.right > page.right + 1 || box.bottom > page.bottom + 1;
    });
    return { clipped, height: page.height };
  });
  expect(layout.clipped).toBe(false);
  expect(layout.height).toBeLessThanOrEqual(953);
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await expect(page.locator('.customer-print-root')).toHaveCount(0);
  await expect(page.getByLabel('Selling price', { exact: true })).toHaveValue('30,000');
});

test('collapsed sections remove inputs from keyboard navigation and restore focus', async ({ page }) => {
  const button = page.locator('#trade-cash-heading');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Trade allowance', { exact: true })).toBeHidden();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('#trade-cash-content') === null)).toBe(true);
  await button.click();
  await expect(page.getByLabel('Trade allowance', { exact: true })).toBeVisible();
});

test('copy fallback is explicit and share failure does not invoke print', async ({ page }) => {
  await page.evaluate(() => {
    window.testPrintCount = 0;
    window.print = () => window.testPrintCount++;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new Error('unavailable'); } });
  });
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await page.getByRole('button', { name: 'Copy summary' }).click();
  await expect(page.getByLabel('Copyable estimate summary')).toBeVisible();
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('PDF sharing failed');
  expect(await page.evaluate(() => window.testPrintCount)).toBe(0);
});

test('add product keeps readable text on hover', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Touch devices do not expose pointer hover.');
  const button = page.getByRole('button', { name: 'Add product', exact: true });
  await button.hover();
  await expect(button).toHaveCSS('color', 'rgb(4, 80, 180)');
  const scan = await new AxeBuilder({ page }).include('#add-product').withRules(['color-contrast']).analyze();
  expect(scan.violations).toEqual([]);
});

test('estimate calendar has accessible controls and fits the viewport', async ({ page }) => {
  await page.locator('details.deal-details > summary').click();
  await page.getByRole('button', { name: 'Open estimate date calendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose estimate date' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
});

test('automated accessibility scan covers dealer, products, grid, and customer', async ({ page }) => {
  test.setTimeout(90000);
  // Scan settled surfaces rather than controls moving during smooth section scrolling.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product 1 type').selectOption('other');
  await page.getByLabel('Target payment', { exact: true }).fill('350');
  for (const surface of ['dealer', 'grid', 'customer']) {
    if (surface === 'grid') {
      await page.getByLabel('Tax treatment for product or add-on 1').selectOption('not-taxable');
      await (page.viewportSize().width <= 800 ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
      await expect(page.getByRole('heading', { name: 'Payment grid', exact: true })).toBeVisible();
    }
    if (surface === 'customer') {
      await page.getByRole('button', { name: 'Customer view', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Your purchase estimate' })).toBeVisible();
    }
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(scan.violations.map(v => ({ id: v.id, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })), surface).toEqual([]);
  }
});

test('an invalid mobile grid rate can be recovered after returning to the worksheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Hidden grid recovery is a mobile navigation regression.');
  await page.locator('#mobile-grid-trigger').click();
  const rate = page.getByLabel('Interest rate for 60 months', { exact: true }).filter({ visible: true });
  await rate.fill('6x');
  await page.getByRole('button', { name: 'Back to calculator' }).click();
  await expect(page.locator('#worksheet-heading')).toBeVisible();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payment grid', exact: true })).toBeVisible();
  await expect(rate).toBeFocused();
  await page.setViewportSize({ width: 1024, height: 900 });
  const desktopRate = page.getByLabel('Interest rate for 60 months', { exact: true }).filter({ visible: true });
  await expect(desktopRate).toHaveValue('6x');
  await expect(desktopRate).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Go to field' }).click();
  await expect(desktopRate).toBeFocused();
  await desktopRate.fill('6');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your purchase estimate' })).toBeVisible();
});

test('responsive worksheets keep amounts and target controls within their containers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Breakpoint sweep is run once; user journeys run on all projects.');
  await page.getByLabel('Target payment', { exact: true }).fill('350');
  for (const width of [320, 390, 760, 800, 801, 900, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.evaluate(() => {
      const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
      return {
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        clipped: [...document.querySelectorAll('.field-row, .payment-number, .target-setup, .suggestion, .suggestion-metrics, .term-buttons, .option-row')]
          .filter(visible).filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.className),
      };
    });
    expect(bounds, `Viewport ${width}`).toEqual({ pageOverflow: false, clipped: [] });
  }
});
