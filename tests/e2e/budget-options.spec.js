import { test as base, expect } from '@playwright/test';

const test = base.extend({
  clientErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await use(errors);
    expect(errors, 'Budget comparisons must not produce browser or React errors.').toEqual([]);
  }, { auto: true }],
});

const summary = page => page.locator('.desktop-results:visible, .mobile-results:visible');
const payment = page => summary(page).locator('.results-payment .payment-number strong');
const ceiling = page => page.getByLabel('Maximum total due at signing', { exact: true });

// Synthetic local worksheet only; prevent vendor or profile traffic in every run.
test.beforeEach(async ({ page, context, baseURL }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date('2026-09-24T16:00:00Z'));
  test.setTimeout(90_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Payment Desk/);
  await expect(page.locator('#worksheet-heading')).toBeVisible();
  await page.getByLabel('Selling price', { exact: true }).fill('30000');
  await page.getByLabel('Selling price', { exact: true }).blur();
  await page.getByLabel('Target payment', { exact: true }).fill('450');
});

test('bounded option applies exact cents and Undo restores cash, term and rate', async ({ page }) => {
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('4000');
  const option = page.locator('.budget-option').filter({ hasText: '84 months' });
  await expect(option).toContainText('7.00%');
  await expect(option).toContainText('$2,347.74');
  await expect(option).toContainText('$450.00/mo');
  await expect(option).toContainText('$7,984.31');
  await expect(payment(page)).toHaveText('$540.67');
  await option.getByRole('button', { name: 'Apply Payment + cash limits: 84 months', exact: true }).click();
  await expect(payment(page)).toHaveText('$450.00');
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,347.74');
  await expect(summary(page)).toContainText('84 months at 7.00% interest rate');
  await expect(page.getByLabel('Selling price', { exact: true })).toHaveValue('30,000');
  await page.getByRole('button', { name: 'Undo adjustment', exact: true }).click();
  await expect(payment(page)).toHaveText('$540.67');
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('0');
  await expect(summary(page)).toContainText('72 months at 6.50% interest rate');
  await page.locator('#target-solver').screenshot({ path: `/tmp/payment-desk-budget-${page.viewportSize().width}.png` });
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('cash ceiling uses the minimum cent that satisfies the displayed payment limit', async ({ page }) => {
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('2348');
  const option = page.locator('.budget-option');
  await expect(option).toHaveCount(1);
  await expect(option).toContainText('$2,347.74');
  await expect(option).toContainText('$450.00/mo');
  await ceiling(page).fill('2347.73');
  await expect(option).toHaveCount(0);
  await expect(page.locator('.target-summary')).toContainText('No option meets both limits');
  await ceiling(page).fill('2347.74');
  await expect(option).toHaveCount(1);
  await option.getByRole('button', { name: 'Apply Payment + cash limits: 84 months', exact: true }).click();
  await expect(payment(page)).toHaveText('$450.00');
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,347.74');
  await page.getByRole('button', { name: 'Undo adjustment', exact: true }).click();
  await expect(payment(page)).toHaveText('$540.67');
});

test('clearing an applied cash ceiling expires Undo and preserves the applied deal', async ({ page }) => {
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('4000');
  await page.getByRole('button', { name: 'Apply Payment + cash limits: 84 months', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo adjustment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo adjustment', exact: true })).toHaveCount(0);
  await expect(summary(page).locator('.estimate-applied')).toHaveCount(0);
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,347.74');
  await expect(payment(page)).toHaveText('$450.00');
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(ceiling(page)).toHaveValue('');
  await expect(page.getByLabel('Target payment', { exact: true })).toHaveValue('450');
});

test('closing an already-empty cash ceiling preserves Undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Add cash down', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo adjustment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo adjustment', exact: true })).toBeVisible();
  await expect(payment(page)).toHaveText('$450.00');
  await page.getByRole('button', { name: 'Undo adjustment', exact: true }).click();
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('0');
  await expect(payment(page)).toHaveText('$540.67');
});

test('blank ceiling preserves one-part options; no match and invalid draft are explicit and recoverable', async ({ page }) => {
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Add cash down', exact: true })).toBeEnabled();
  await ceiling(page).fill('1000');
  await expect(page.locator('.target-summary')).toContainText('No option meets both limits');
  await expect(page.locator('.budget-option')).toHaveCount(0);
  await ceiling(page).fill('4x');
  await expect(ceiling(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(ceiling(page)).toBeEnabled();
  await expect(page.locator('.budget-option')).toHaveCount(0);
  await ceiling(page).fill('4000');
  await expect(page.locator('.budget-option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(ceiling(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply Add cash down', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(ceiling(page)).toHaveValue('');
});

test('term disclosure uses calculated total interest and signed change before Apply', async ({ page }) => {
  await page.getByLabel('Target payment', { exact: true }).fill('500');
  const term = page.locator('.suggestion').filter({ has: page.getByRole('heading', { name: 'Change finance term', exact: true }) });
  await expect(term).toContainText('$8,613.00');
  await expect(term).toContainText('+$1,848.46');
  await expect(term).toContainText('72 months / 6.50%');
  await expect(term).toContainText('equal monthly periods');
  await expect(payment(page)).toHaveText('$540.67');
});

test('upfront negative equity counts against cash ceiling and unresolved products block options', async ({ page }) => {
  await page.getByLabel('Trade payoff', { exact: true }).fill('2000');
  await page.getByLabel('Include negative equity in financing').uncheck();
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('4000');
  await expect(page.locator('.budget-option')).toHaveCount(0);
  await ceiling(page).fill('5000');
  await expect(page.locator('.budget-option')).toContainText('$4,347.74');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product 1 type').selectOption('other');
  await page.getByLabel('Product 1 amount', { exact: true }).fill('100');
  await expect(page.locator('.budget-option')).toHaveCount(0);
});

test('valid and invalid cash-limit drafts restore visibly, and Reset clears the comparison', async ({ page }) => {
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('4000');
  await ceiling(page).blur();
  await page.reload();
  await expect(ceiling(page)).toHaveValue('4,000');
  await expect(page.locator('.budget-option')).toHaveCount(1);
  await ceiling(page).fill('4x');
  await ceiling(page).blur();
  await page.reload();
  await expect(ceiling(page)).toHaveValue('4x');
  await expect(ceiling(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.budget-option')).toHaveCount(0);
  await expect(ceiling(page)).toBeEnabled();
  await ceiling(page).fill('4000');
  await expect(page.locator('.budget-option')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect(ceiling(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await expect(ceiling(page)).toHaveValue('');
});

test('already-fitting current remains visible and a negative financed balance stays blocked', async ({ page }) => {
  await page.getByLabel('Target payment', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('4000');
  await expect(page.locator('.budget-option').filter({ hasText: 'Current scenario' })).toContainText('$540.67/mo');
  await page.getByLabel('Cash down', { exact: true }).fill('40000');
  await expect(page.locator('.budget-option')).toHaveCount(0);
  await expect(page.locator('.target-summary')).toContainText('Credits exceed the financed balance');
});

test('current scenario has no Apply and preserves an independent grid rate', async ({ page }) => {
  const mobile = page.viewportSize().width <= 800;
  if (mobile) await page.locator('#mobile-grid-trigger').click();
  const rate72 = page.locator('#grid-apr-72');
  await rate72.fill('8');
  await rate72.blur();
  if (mobile) await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await page.getByLabel('Target payment', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Payment + cash limits', exact: true }).click();
  await ceiling(page).fill('4000');

  const current = page.locator('.budget-option').filter({ hasText: 'Current scenario' });
  await expect(current).toContainText('$540.67/mo');
  await expect(current.getByRole('button', { name: 'Apply Current scenario', exact: true })).toHaveCount(0);
  await expect(rate72).toHaveValue('8.00');

  const option = page.locator('.budget-option').filter({ hasText: 'Payment + cash limits: 84 months' });
  await expect(option.getByRole('button', { name: 'Apply Payment + cash limits: 84 months', exact: true })).toBeEnabled();
  await option.getByRole('button', { name: 'Apply Payment + cash limits: 84 months', exact: true }).click();
  await expect(summary(page)).toContainText('84 months at 7.00% interest rate');
  await expect(rate72).toHaveValue('8.00');
  await page.getByRole('button', { name: 'Undo adjustment', exact: true }).click();
  await expect(summary(page)).toContainText('72 months at 6.50% interest rate');
  await expect(rate72).toHaveValue('8.00');
});
