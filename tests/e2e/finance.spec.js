import { test as base, expect } from '@playwright/test';

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
    expect(errors, 'The finance workflow must not produce browser or React errors.').toEqual([]);
  }, { auto: true }],
});

const currentSummary = page => page.locator('.desktop-results:visible, .mobile-results:visible');
const selectedPayment = page => currentSummary(page).locator('.results-payment .payment-number strong');
const target = page => page.getByRole('textbox', { name: 'Target payment', exact: true });

async function enterVehicle(page) {
  const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
  await price.fill('30000');
  await price.press('Tab');
  await expect(selectedPayment(page)).toHaveText('$540.67');
}

async function applyCashTarget(page, payment) {
  await target(page).fill(String(payment));
  const apply = page.getByRole('button', { name: 'Apply Add cash down', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(selectedPayment(page)).toHaveText(`$${payment.toFixed(2)}`);
}

test.beforeEach(async ({ page }) => {
  // Freeze only Date, leaving animation and event timers running normally.
  // This makes dated financial rules deterministic on later CI run dates.
  await page.clock.setFixedTime(new Date('2026-09-24T16:00:00Z'));
  await page.goto('/');
  await expect(page.locator('#worksheet-heading')).toBeVisible();
});

test('successive payment targets from blank down preserve the deal and reach both payments', async ({ page }) => {
  await enterVehicle(page);
  const cash = page.getByRole('textbox', { name: 'Cash down', exact: true });
  await cash.fill('');
  await cash.press('Tab');
  await applyCashTarget(page, 450);
  await expect(cash).toHaveValue('5,393.95');
  await applyCashTarget(page, 400);
  await expect(cash).toHaveValue('8,368.38');
  await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toHaveValue('30,000');
  await expect(page.getByRole('heading', { name: 'Something went wrong', exact: true })).toHaveCount(0);
});

test('finance term is a visible target option and only Apply changes the worksheet', async ({ page }) => {
  await enterVehicle(page);
  await target(page).fill('450');
  const termOption = page.locator('.suggestion').filter({ has: page.getByRole('heading', { name: 'Change finance term', exact: true }) });
  await expect(termOption).toBeVisible();
  await expect(termOption).toContainText('84 months');
  await expect(termOption).toContainText('remaining to target');
  await expect(page.getByRole('button', { name: 'See all options', exact: true })).toBeVisible();
  await expect(currentSummary(page)).toContainText('72 months at 6.50% interest rate');
  await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toHaveValue('30,000');
  await expect(page.getByRole('textbox', { name: 'Cash down', exact: true })).toHaveValue('0');
  await target(page).fill('500');
  await expect(termOption).toContainText('Within target');
  const previewPayment = await termOption.locator('.suggestion-preview>strong').innerText();
  await termOption.getByRole('button', { name: 'Apply Change finance term', exact: true }).click();
  await expect(selectedPayment(page)).toHaveText(previewPayment.replace('/mo', ''));
  await expect(currentSummary(page)).toContainText('84 months at 7.00% interest rate');
  await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toHaveValue('30,000');
  await expect(page.getByRole('textbox', { name: 'Cash down', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Undo adjustment', exact: true }).click();
  await expect(currentSummary(page)).toContainText('72 months at 6.50% interest rate');
  await expect(selectedPayment(page)).toHaveText('$540.67');
});

test('roll backs out an unknown selling price then supports a cash target and undo', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Selling price', exact: true }).fill('30000');
  await page.getByRole('textbox', { name: 'Selling price', exact: true }).fill('');
  await target(page).fill('450');
  await expect(page.locator('.suggestion').first()).toContainText('Required selling price');
  await expect(page.locator('.suggestion-price')).toContainText('Resulting selling price');
  await page.getByRole('button', { name: 'Apply Required selling price', exact: true }).click();
  await expect(selectedPayment(page)).toHaveText('$450.00');
  const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
  const financedPrice = await price.inputValue();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('textbox', { name: 'Trade allowance', exact: true }).fill('8000');
  await page.getByRole('textbox', { name: 'Trade payoff', exact: true }).fill('2500');
  await page.getByRole('textbox', { name: 'Target cash due after trade', exact: true }).fill('15000');
  const priceScenario = page.locator('.suggestion').filter({ has: page.getByRole('heading', { name: 'Reduce selling price', exact: true }) });
  await expect(priceScenario).toContainText('Cash due $15,000.00');
  await priceScenario.getByRole('button', { name: 'Apply Reduce selling price', exact: true }).click();
  await expect(page.locator('.target-current')).toContainText('$15,000');
  await page.getByRole('button', { name: 'Undo adjustment', exact: true }).click();
  await expect(price).toHaveValue(financedPrice);
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await expect(target(page)).toHaveValue('450');
});

test('a later payoff edit expires Undo without removing the new payoff', async ({ page }) => {
  await enterVehicle(page);
  await applyCashTarget(page, 450);
  await expect(page.getByRole('button', { name: 'Undo adjustment', exact: true })).toBeVisible();
  const payoff = page.getByRole('textbox', { name: 'Trade payoff', exact: true });
  await payoff.fill('3000');
  await payoff.press('Tab');
  await expect(page.getByRole('button', { name: 'Undo adjustment', exact: true })).toHaveCount(0);
  await expect(payoff).toHaveValue('3,000');
  await expect(page.getByRole('textbox', { name: 'Cash down', exact: true })).toHaveValue('5,393.95');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toContainText(/trade payoff/i);
  await expect(page.locator('.customer-layout')).toContainText('3,000.00');
  await page.getByRole('button', { name: 'Dealer view', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Trade payoff', exact: true })).toHaveValue('3,000');
});

test('excess rate precision blocks exports until the entered rate is corrected', async ({ page }) => {
  await enterVehicle(page);
  const apr = page.getByRole('textbox', { name: 'Annual interest rate', exact: true });
  await apr.fill('6.005');
  await apr.press('Tab');
  await expect(apr).toHaveValue('6.005');
  await expect(apr).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(apr).toBeFocused();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await apr.fill('6.01');
  await apr.press('Tab');
  await expect(apr).not.toHaveAttribute('aria-invalid', 'true');
  await expect(currentSummary(page)).toContainText('72 months at 6.01% interest rate');
  await expect(selectedPayment(page)).toHaveText('$533.20');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.results-panel--customer')).toContainText('72 months at 6.01% interest rate');
  await expect(page.locator('.results-panel--customer .payment-number strong')).toHaveText('$533.20');
});

for (const plateAmount of [0, 250]) {
  test(`unknown registration blocks a proposal until ${plateAmount === 0 ? 'zero is explicitly confirmed' : 'the $250 fee is entered'}`, async ({ page }) => {
    await enterVehicle(page);
    await page.getByRole('button', { name: 'New plate', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'New plate amount', exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
    await expect(page.locator('.customer-content .estimate-readiness')).toContainText('New plate cost has not been entered');
    await page.getByRole('button', { name: 'Dealer view', exact: true }).click();
    const plate = page.getByRole('textbox', { name: 'New plate amount', exact: true });
    await plate.fill(String(plateAmount));
    await plate.press('Tab');
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
    await expect(page.locator('.customer-content .estimate-readiness')).toHaveCount(0);
    await expect(page.locator('.results-panel--customer')).toContainText(plateAmount === 0 ? '$32,148.84' : '$32,398.84');
  });
}

test('an invalid date keeps the last valid deal and prevents customer presentation until corrected', async ({ page }) => {
  await enterVehicle(page);
  const details = page.locator('details.deal-details');
  await details.locator('summary').click();
  const date = page.locator('#estimate-date');
  // An invalid draft must preserve the committed estimate date.
  await date.fill('');
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await details.locator('summary').click();
  await expect(date).toBeHidden();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('#worksheet-heading')).toBeVisible();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await expect(date).toBeVisible();
  await expect(date).toBeFocused();
  await expect(selectedPayment(page)).toHaveText('$540.67');
  await date.fill('02/30/26');
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await expect(date).toHaveValue('02/30/26');
  await expect(details.locator('time')).toHaveAttribute('datetime', '2026-09-24');
  await expect(selectedPayment(page)).toHaveText('$540.67');
  await date.fill('09/24/26');
  await expect(date).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeEnabled();
});

test('calendar supports keyboard selection, month navigation, and invalid-date recovery', async ({ page }) => {
  await page.locator('details.deal-details > summary').click();
  const date = page.getByRole('textbox', { name: 'Estimate date', exact: true });
  await date.fill('02/30/26');
  const open = page.getByRole('button', { name: 'Open estimate date calendar' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Choose estimate date' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Thursday, September 24, 2026', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(date).toHaveValue('09/25/26');
  await expect(date).not.toHaveAttribute('aria-invalid', 'true');
  await expect(open).toBeFocused();
  await open.click();
  await dialog.getByRole('button', { name: 'Next month' }).click();
  await dialog.getByRole('button', { name: 'Thursday, October 1, 2026', exact: true }).click();
  await expect(date).toHaveValue('10/01/26');
  await date.fill('02/28/26');
  await open.click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(date).toHaveValue('03/01/26');
  await open.click();
  await dialog.getByRole('combobox', { name: 'Calendar year' }).selectOption('2028');
  await dialog.getByRole('combobox', { name: 'Calendar month' }).selectOption('1');
  await dialog.getByRole('button', { name: 'Tuesday, February 29, 2028', exact: true }).click();
  await expect(date).toHaveValue('02/29/28');
  await date.fill('10/01/26');
  await open.click();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(date).toHaveValue('10/01/26');
});

test('Michigan trade deduction and tax savings stay visible through payoff changes and customer view', async ({ page }) => {
  await enterVehicle(page);
  await page.getByLabel('Trade allowance', { exact: true }).fill('10000');
  const tax = page.getByRole('region', { name: 'Michigan trade tax calculation' });
  await expect(tax).toContainText('−$10,000.00');
  await expect(tax).toContainText('$20,314.00');
  await expect(tax).toContainText('$600.00');
  await page.getByLabel('Trade payoff', { exact: true }).fill('15000');
  await expect(tax).toContainText('$600.00');
  await page.getByLabel('Trade allowance', { exact: true }).fill('18000');
  await expect(tax).toContainText('−$12,000.00');
  await expect(tax).toContainText('$720.00');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(tax).toContainText('$720.00');
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});

test('letters in a price never become a different number or an exportable proposal', async ({ page }) => {
  await enterVehicle(page);
  const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
  await price.fill('30k');
  await price.press('Tab');
  await expect(price).toHaveValue('30k');
  await expect(price).toHaveAttribute('aria-invalid', 'true');
  await expect(selectedPayment(page)).toHaveText('$540.67');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await expect(price).toBeFocused();
  await price.fill('30000');
  await price.press('Tab');
  await expect(price).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeEnabled();
});

test('trade-only work requires reset confirmation and survives cancel', async ({ page }) => {
  const trade = page.getByRole('textbox', { name: 'Trade allowance', exact: true });
  await trade.fill('15000');
  await trade.press('Tab');
  let prompt = '';
  page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  expect(prompt).toContain('Reset this deal?');
  await expect(trade).toHaveValue('15,000');
  page.once('dialog', async dialog => { await dialog.accept(); });
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Trade allowance', exact: true })).toHaveValue('0');
  await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toHaveValue('');
});
