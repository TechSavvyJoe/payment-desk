import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const FEES_KEY = 'payment-desk.fees.v1';
const BRAND_KEY = 'payment-desk.dealership.v1';
const DOC_HELP = 'Michigan maximum $280; never more than 5% of the selling price';
const CRV_HELP = 'Taxable dealer fee';

const test = base.extend({
  clientErrors: [async ({ page }, use) => {
    const errors = [];
    const onPageError = error => errors.push(error.message);
    const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    await use(errors);
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    expect(errors, 'Fee settings must not produce browser or React errors.').toEqual([]);
  }, { auto: true }],
});

// Seed once per tab so reload tests see what the app itself saved or cleared.
const seedFees = (page, value) => page.addInitScript(([key, raw]) => {
  if (sessionStorage.getItem('test-fees-seeded')) return;
  localStorage.setItem(key, raw);
  sessionStorage.setItem('test-fees-seeded', '1');
}, [FEES_KEY, typeof value === 'string' ? value : JSON.stringify(value)]);
const storedFees = page => page.evaluate(key => localStorage.getItem(key), FEES_KEY);

const currentSummary = page => page.locator('.desktop-results:visible, .mobile-results:visible');
const selectedPayment = page => currentSummary(page).locator('.results-payment .payment-number strong');
const price = page => page.getByRole('textbox', { name: 'Selling price', exact: true });
const feeLine = (page, label) => page.locator('.fixed-fees > div').filter({ hasText: label }).locator('dd');

async function enterPrice(page, value = '30000') {
  await price(page).fill(value);
  await price(page).press('Tab');
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Dealership settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dealership settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const feeInputs = dialog => ({
  documentFee: dialog.getByRole('textbox', { name: 'Document fee', exact: true }),
  crvFee: dialog.getByRole('textbox', { name: 'CRV dealer fee', exact: true }),
});

async function saveFees(page, { documentFee, crvFee }) {
  const dialog = await openSettings(page);
  const inputs = feeInputs(dialog);
  if (documentFee !== undefined) await inputs.documentFee.fill(documentFee);
  if (crvFee !== undefined) await inputs.crvFee.fill(crvFee);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  // A fixed September date keeps the December rules reminder out of these checks.
  await page.clock.setFixedTime(new Date('2026-09-24T16:00:00Z'));
  await page.goto('/');
  await expect(price(page)).toBeVisible();
});

test('the Fees fieldset follows the logo and shows the defaults as placeholders', async ({ page }) => {
  const dialog = await openSettings(page);
  const legends = await dialog.locator('fieldset > legend').allTextContents();
  expect(legends.map(text => text.replace(/\s*Optional$/, ''))).toEqual(['Logo', 'Fees']);
  const fees = dialog.getByRole('group', { name: 'Fees' });
  const { documentFee, crvFee } = feeInputs(fees);
  await expect(documentFee).toHaveValue('');
  await expect(documentFee).toHaveAttribute('placeholder', '280.00');
  await expect(documentFee).toHaveAccessibleDescription(DOC_HELP);
  await expect(crvFee).toHaveValue('');
  await expect(crvFee).toHaveAttribute('placeholder', '34.00');
  await expect(crvFee).toHaveAccessibleDescription(CRV_HELP);
  // Saving untouched fees keeps the defaults and stores nothing.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await storedFees(page)).toBeNull();
});

test('a custom CRV fee reaches the worksheet, payment, grid, target solver, customer estimate and copied text', async ({ page }) => {
  await enterPrice(page);
  await expect(selectedPayment(page)).toHaveText('$540.67');
  await expect(feeLine(page, 'CRV fee')).toHaveText('$34');

  await saveFees(page, { crvFee: '125.50' });
  expect(JSON.parse(await storedFees(page))).toEqual({ documentFee: null, crvFee: 125.5 });

  // Worksheet fee lines and the selected payment.
  await expect(feeLine(page, 'CRV fee')).toHaveText('$125.50');
  await expect(feeLine(page, 'Document fee')).toHaveText('$280');
  await expect(selectedPayment(page)).toHaveText('$542.30');

  // Payment grid: the selected 72-month cell and another term/down cell.
  if (page.viewportSize().width <= 800) {
    await page.getByRole('navigation', { name: 'Mobile calculator shortcuts' }).getByRole('button', { name: /Payment grid/ }).click();
  } else {
    await currentSummary(page).getByRole('button', { name: 'Compare payments', exact: true }).click();
  }
  const grid = page.locator('#payment-grid');
  await expect(grid.getByRole('button', { name: /^Use 72 months at 6\.50 percent with \$0 down for \$542\.30 per month$/ }).filter({ visible: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(grid.getByRole('button', { name: /^Use 60 months at 6\.00 percent with \$1,000 down for \$604\.36 per month$/ }).filter({ visible: true })).toBeVisible();
  await grid.getByRole('button', { name: 'Back to calculator', exact: true }).click();

  // Target solver: the applied cash down reaches the payment exactly, so the
  // solver and the deal agree on the fees.
  await page.getByRole('textbox', { name: 'Target payment', exact: true }).fill('500');
  const apply = page.getByRole('button', { name: 'Apply Add cash down', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(selectedPayment(page)).toHaveText('$500.00');
  await expect(page.getByRole('textbox', { name: 'Cash down', exact: true })).toHaveValue('2,516.51');

  // Customer estimate and copied text.
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your purchase estimate', exact: true })).toBeVisible();
  const ledger = page.locator('.customer-ledger').first();
  await expect(ledger.locator('.customer-ledger__row').filter({ hasText: 'CRV dealer fee (taxable)' })).toContainText('$125.50');
  await expect(ledger.locator('.customer-ledger__row').filter({ hasText: 'Document fee (taxable)' })).toContainText('$280.00');
  await expect(ledger.locator('.customer-ledger__row.is-total')).toContainText('$32,260.83');
  await expect(page.locator('.results-panel--customer .payment-number strong')).toHaveText('$500.00');
  const assumption = 'Document fee $280.00 (dealership setting; never more than $280 or 5% of the selling price) and CRV dealer fee $125.50 are set by the dealership.';
  await expect(page.locator('.proposal-qualification li').filter({ hasText: 'CRV dealer fee $125.50' })).toHaveText(assumption);

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedEstimate = text; } } }));
  await page.getByRole('button', { name: 'Copy summary', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'copied' })).toBeVisible();
  const copied = (await page.evaluate(() => window.testCopiedEstimate)).split('\n');
  expect(copied).toEqual(expect.arrayContaining([
    'Estimated payment: $500.00/mo',
    'CRV dealer fee (taxable): $125.50',
    'Document fee (taxable): $280.00',
    'Out-the-door total: $32,260.83',
    'Less cash down: −$2,516.51',
    assumption,
    'Product tax treatment must be confirmed for this transaction.',
  ]));
});

test('a custom document fee is capped at 5% of a low selling price on every surface', async ({ page }) => {
  await saveFees(page, { documentFee: '199' });
  await enterPrice(page, '3000');
  await expect(feeLine(page, 'Document fee')).toHaveText('$150');
  await enterPrice(page, '30000');
  await expect(feeLine(page, 'Document fee')).toHaveText('$199');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-ledger__row').filter({ hasText: 'Document fee (taxable)' })).toContainText('$199.00');
  await expect(page.locator('.proposal-qualification li').filter({ hasText: 'Document fee $199.00' })).toBeVisible();
});

test('out-of-range and malformed fees explain the problem and block Save', async ({ page }) => {
  await enterPrice(page);
  const dialog = await openSettings(page);
  const { documentFee, crvFee } = feeInputs(dialog);

  await documentFee.fill('300');
  await expect(documentFee).toHaveAttribute('aria-invalid', 'true');
  await expect(documentFee).toHaveAccessibleDescription(`${DOC_HELP} Enter an amount from $0 to $280.00.`);
  await expect(dialog.getByText('Enter an amount from $0 to $280.00.')).toBeVisible();
  // The dialog's own errors never raise the worksheet's validation banner.
  await expect(page.locator('.validation-banner')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible();
  await expect(documentFee).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText('Correct the highlighted fee before saving.');
  expect(await storedFees(page)).toBeNull();

  for (const [text, message] of [
    ['1000', 'Enter an amount from $0 to $999.99.'],
    ['-5', 'Enter a number, such as 30,000. Letters and negative amounts are not supported.'],
    ['12.345', 'Use no more than two decimal places for an amount.'],
    ['abc', 'Enter a number, such as 30,000. Letters and negative amounts are not supported.'],
  ]) {
    await crvFee.fill(text);
    await expect(crvFee).toHaveAttribute('aria-invalid', 'true');
    await expect(crvFee).toHaveAccessibleDescription(`${CRV_HELP} ${message}`);
  }

  await documentFee.fill('199');
  await crvFee.fill('0');
  await expect(documentFee).not.toHaveAttribute('aria-invalid', 'true');
  await expect(crvFee).not.toHaveAttribute('aria-invalid', 'true');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(JSON.parse(await storedFees(page))).toEqual({ documentFee: 199, crvFee: 0 });
  await expect(feeLine(page, 'Document fee')).toHaveText('$199');
  await expect(feeLine(page, 'CRV fee')).toHaveText('$0');
  await expect(page.locator('.validation-banner')).toHaveCount(0);
});

test('Cancel discards fee drafts, including invalid ones', async ({ page }) => {
  await enterPrice(page);
  let dialog = await openSettings(page);
  await feeInputs(dialog).crvFee.fill('99');
  await feeInputs(dialog).documentFee.fill('999');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.validation-banner')).toHaveCount(0);
  await expect(feeLine(page, 'CRV fee')).toHaveText('$34');
  dialog = await openSettings(page);
  await expect(feeInputs(dialog).crvFee).toHaveValue('');
  await expect(feeInputs(dialog).documentFee).toHaveValue('');
  await expect(feeInputs(dialog).documentFee).not.toHaveAttribute('aria-invalid', 'true');
});

test('saved fees survive reload and Reset deal, and Clear restores the defaults', async ({ page }) => {
  await seedFees(page, { documentFee: 199, crvFee: 50 });
  await page.reload();
  await enterPrice(page);
  await expect(feeLine(page, 'Document fee')).toHaveText('$199');
  await expect(feeLine(page, 'CRV fee')).toHaveText('$50');

  page.once('dialog', confirm => confirm.accept());
  await page.getByRole('button', { name: 'Reset deal' }).click();
  await expect(price(page)).toHaveValue('');
  await enterPrice(page);
  await expect(feeLine(page, 'CRV fee')).toHaveText('$50');

  await page.reload();
  await enterPrice(page);
  await expect(feeLine(page, 'CRV fee')).toHaveText('$50');
  const dialog = await openSettings(page);
  await expect(feeInputs(dialog).documentFee).toHaveValue('199');
  await expect(feeInputs(dialog).crvFee).toHaveValue('50');

  let confirmText = '';
  page.once('dialog', confirm => { confirmText = confirm.message(); return confirm.accept(); });
  await dialog.getByRole('button', { name: 'Clear dealership settings' }).click();
  await expect(dialog).toBeHidden();
  expect(confirmText).toBe('Clear the dealership name, logo, and fees on this device? Fees return to the defaults.');
  expect(await storedFees(page)).toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), BRAND_KEY)).toBeNull();
  await expect(feeLine(page, 'Document fee')).toHaveText('$280');
  await expect(feeLine(page, 'CRV fee')).toHaveText('$34');
});

test('damaged or out-of-range saved fees fall back to the defaults without errors', async ({ page }) => {
  await seedFees(page, { documentFee: 900, crvFee: '12.345' });
  await page.reload();
  await enterPrice(page);
  await expect(feeLine(page, 'Document fee')).toHaveText('$280');
  await expect(feeLine(page, 'CRV fee')).toHaveText('$34');
  const dialog = await openSettings(page);
  await expect(feeInputs(dialog).documentFee).toHaveValue('');
  await expect(feeInputs(dialog).crvFee).toHaveValue('');
});

test('when the browser refuses to save, the fees still apply for this visit with a warning', async ({ page }) => {
  await enterPrice(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  const dialog = await openSettings(page);
  await feeInputs(dialog).crvFee.fill('75');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status')).toContainText("Couldn't save on this device");
  await expect(feeLine(page, 'CRV fee')).toHaveText('$75');
  await expect(feeInputs(dialog).crvFee).toBeDisabled();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(feeLine(page, 'CRV fee')).toHaveText('$75');
});

test('the dialog with fees fits a 375×667 phone, scrolls inside, uses 16px inputs, and passes an accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const dialog = await openSettings(page);
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(667);
  expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
  const { documentFee, crvFee } = feeInputs(dialog);
  for (const input of [documentFee, crvFee]) {
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(40);
  }
  await crvFee.scrollIntoViewIfNeeded();
  await expect(crvFee).toBeInViewport();
  // Show an error so the scan covers the invalid state too.
  await documentFee.fill('300');
  await expect(dialog.getByText('Enter an amount from $0 to $280.00.')).toBeVisible();
  expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
  const fees = dialog.getByRole('group', { name: 'Fees' });
  const feesBox = await fees.boundingBox();
  expect(feesBox.x + feesBox.width).toBeLessThanOrEqual(box.x + box.width);
  const scan = await new AxeBuilder({ page }).include('.settings-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
  await dialog.getByRole('button', { name: 'Save' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeInViewport();
});
