import { test, expect } from '@playwright/test';

const runtimeErrors = new WeakMap();

const openGrid = async page => {
  await (page.viewportSize().width <= 800 ? page.locator('#mobile-grid-trigger') : page.locator('.grid-jump')).click();
  await expect(page.getByRole('heading', { name: 'Payment grid', exact: true })).toBeVisible();
};
const option = (page, term, cash) => page.locator('#payment-grid').getByRole('button', {
  name: new RegExp(`Use ${term} months.*with \\$${cash.replaceAll('.', '\\.')} down`),
});
const payment = page => page.locator('.results-panel:visible .payment-number strong').first();
const undo = page => page.getByRole('button', { name: /Undo/ }).filter({ visible: true }).first();

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  runtimeErrors.set(page, []);
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.get(page).push(message.text()); });
  page.on('pageerror', error => runtimeErrors.get(page).push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#worksheet-heading')).toBeVisible();
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Estimate date', { exact: true }).fill('09/24/26');
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Selling price', { exact: true }).fill('30000');
  await page.getByLabel('Selling price', { exact: true }).blur();
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), 'No runtime errors').toEqual([]);
});

test('comparison rates stay independent, persist on reload, and select with shared Undo', async ({ page }) => {
  await openGrid(page);
  const reference = page.getByRole('region', { name: 'Current worksheet scenario' });
  await expect(reference).toContainText('6.50%');
  await expect(reference).toContainText('$540.67/mo');
  for (const term of [72, 60]) {
    await page.locator(`#grid-apr-${term}`).fill('8');
    await page.locator(`#grid-apr-${term}`).blur();
    await expect(reference).toContainText('6.50%');
    await expect(reference).toContainText('$540.67/mo');
  }
  await expect.poll(() => page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('payment-desk.draft.v2'));
    return draft && [draft.desk.deal.apr, draft.desk.gridRates[72], draft.desk.gridRates[60]];
  })).toEqual([6.5, 8, 8]);
  await page.reload();
  await openGrid(page);
  await expect(reference).toContainText('6.50%');
  await expect(page.locator('#grid-apr-72')).toHaveValue('8.00');
  const candidate = option(page, 60, '2,000');
  const preview = (await candidate.getAttribute('aria-label')).match(/for (\$[\d,.]+) per month/)[1];
  await candidate.click();
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,000');
  await expect(payment(page)).toHaveText(preview);
  await expect(undo(page)).toBeVisible();
  await undo(page).click();
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('0');
  await expect(payment(page)).toHaveText('$540.67');
  await openGrid(page);
  await expect(page.locator('#grid-apr-60')).toHaveValue('8.00');
  await option(page, 60, '2,000').click();
  await page.getByLabel('Trade payoff', { exact: true }).fill('2000');
  await expect(page.getByRole('button', { name: /Undo/ }).filter({ visible: true })).toHaveCount(0);
});

test('valid candidates repair current excess cash but negative candidate balances stay blocked', async ({ page }) => {
  await page.getByLabel('Cash down', { exact: true }).fill('40000');
  await openGrid(page);
  await expect(option(page, 72, '0')).toBeEnabled();
  await expect(option(page, 72, '1,000')).toBeEnabled();
  await page.locator('#grid-down-3').fill('40000');
  await page.locator('#grid-down-3').blur();
  await expect(option(page, 72, '40,000')).toBeDisabled();
  await option(page, 72, '0').click();
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('0');
  await expect(payment(page)).toHaveText('$540.67');
});

test('an otherwise valid worksheet recovers excessive grid cash at the offending column', async ({ page }) => {
  await openGrid(page);
  for (let index = 0; index < 4; index += 1) {
    await page.locator(`#grid-down-${index}`).fill('40000');
    await page.locator(`#grid-down-${index}`).blur();
  }
  await expect(page.locator('#payment-grid button[aria-label^="Use "]:enabled')).toHaveCount(0);
  await page.locator('.grid-readiness').getByRole('button', { name: 'Review worksheet', exact: true }).click();
  await expect(page.locator('#grid-down-0')).toBeFocused();
  await expect(page.locator('#payment-grid')).toBeVisible();
  await page.locator('#grid-down-0').fill('0');
  await page.locator('#grid-down-0').blur();
  await expect(option(page, 72, '0')).toBeEnabled();
});

for (const [label, value] of [['Out-the-door', '31000'], ['Loan balance', '25000']]) {
  test(`Cash Undo restores the ${label} target workflow and its value`, async ({ page }) => {
    await page.getByLabel('Cash down', { exact: true }).fill('2000');
    await page.getByRole('group', { name: 'Target type', exact: true }).getByRole('button', { name: label, exact: true }).click();
    await page.locator('#target-value').fill(value);
    await page.locator('#target-value').blur();
    await page.getByRole('group', { name: 'Purchase type', exact: true }).getByRole('button', { name: 'Cash', exact: true }).click();
    await undo(page).click();
    await expect(page.getByRole('group', { name: 'Target type', exact: true }).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#target-value')).toHaveValue(Number(value).toLocaleString('en-US'));
    await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,000');
  });
}

for (const flow of ['grid', 'cash']) {
  for (const field of ['sale-price', 'target-value']) {
    test(`${flow} Undo expires immediately when ${field} receives invalid typing`, async ({ page }) => {
      if (flow === 'grid') { await openGrid(page); await option(page, 60, '2,000').click(); }
      else {
        await page.getByLabel('Cash down', { exact: true }).fill('2000');
        await page.getByRole('group', { name: 'Purchase type', exact: true }).getByRole('button', { name: 'Cash', exact: true }).click();
      }
      await expect(undo(page)).toBeVisible();
      const before = await payment(page).innerText();
      await page.locator(`#${field}`).fill('bad');
      await expect(page.locator(`#${field}`)).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('button', { name: /Undo/ }).filter({ visible: true })).toHaveCount(0);
      await expect(payment(page)).toHaveText(before);
      await expect(page.locator(`#${field}`)).toHaveValue('bad');
    });
  }
}

test('invalid comparison rate and date drafts expire the pending adjustment', async ({ page }) => {
  await openGrid(page);
  await option(page, 60, '2,000').click();
  await expect(undo(page)).toBeVisible();
  await openGrid(page);
  await page.locator('#grid-apr-60').fill('6.123');
  await expect(page.locator('#grid-apr-60')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /Undo/, includeHidden: true })).toHaveCount(0);
  await page.locator('#grid-apr-60').fill('6');
  await page.locator('#grid-apr-60').blur();
  await option(page, 72, '1,000').click();
  await expect(undo(page)).toBeVisible();
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Estimate date', { exact: true }).fill('invalid');
  await expect(page.getByLabel('Estimate date', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /Undo/, includeHidden: true })).toHaveCount(0);
});

for (const cash of ['1000.01', '1000.49']) {
  test(`current custom cash stays referenced and visible option cash retains ${cash}`, async ({ page }, testInfo) => {
    await page.getByLabel('Cash down', { exact: true }).fill('5393.95');
    await openGrid(page);
    const reference = page.getByRole('region', { name: 'Current worksheet scenario' });
    await expect(reference).toContainText('Read-only reference');
    await expect(reference).toContainText('$5,393.95 cash down');
    await expect(reference).toContainText('72 months at 6.50%');
    await expect(reference).toContainText('$450.00/mo');
    await expect(page.locator('#payment-grid button[aria-pressed="true"]')).toHaveCount(0);
    if (cash === '1000.01') await page.screenshot({ path: `/tmp/payment-desk-grid-current-${testInfo.project.name}.png` });
    await page.locator('#grid-down-1').fill(cash);
    await page.locator('#grid-down-1').blur();
    const formatted = cash.replace('1000', '1,000');
    const candidate = option(page, 72, formatted);
    if (page.viewportSize().width <= 800) await expect(candidate).toContainText(`$${formatted} down`);
    else await expect(page.locator('#grid-down-1')).toHaveValue(formatted);
    const preview = (await candidate.getAttribute('aria-label')).match(/for (\$[\d,.]+) per month/)[1];
    await candidate.click();
    await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue(formatted);
    await expect(payment(page)).toHaveText(preview);
  });
}

for (const blocker of ['missing registration', 'invalid money', 'invalid rate', 'unnamed product', 'unconfirmed tax', 'unsupported state', 'policy warning']) {
  test(`all comparisons retain the ${blocker} guard and show a readiness action`, async ({ page }) => {
    if (blocker === 'missing registration') await page.getByRole('button', { name: 'New plate', exact: true }).click();
    if (blocker === 'invalid money') await page.getByLabel('Cash down', { exact: true }).fill('bad');
    if (blocker === 'unnamed product' || blocker === 'unconfirmed tax') {
      await page.getByRole('button', { name: 'Add product', exact: true }).click();
      await page.getByLabel('Product 1 type').selectOption('other');
      await page.getByLabel('Product name for add-on 1').fill(blocker === 'unnamed product' ? '' : 'Accessories');
      await page.locator('#product-add-on-1-amount').fill('500');
      if (blocker === 'unnamed product') await page.getByLabel(/Tax treatment for/).selectOption('not-taxable');
    }
    if (blocker === 'unsupported state' || blocker === 'policy warning') {
      await page.locator('details.deal-details > summary').click();
      if (blocker === 'unsupported state') await page.getByLabel('Buyer registration state').selectOption('OH');
      else await page.getByLabel('Estimate date', { exact: true }).fill('09/24/30');
      await page.locator('details.deal-details > summary').click();
    }
    const mobileRecovery = page.viewportSize().width <= 800 && ['invalid money', 'unconfirmed tax', 'unsupported state'].includes(blocker);
    if (mobileRecovery) {
      await page.locator('#mobile-grid-trigger').click();
      const field = blocker === 'invalid money' ? page.getByLabel('Cash down', { exact: true })
        : blocker === 'unsupported state' ? page.getByLabel('Buyer registration state') : page.getByLabel(/Tax treatment for/);
      await expect(field).toBeFocused();
      await expect(page.locator('#payment-grid')).toBeHidden();
    } else await openGrid(page);
    if (blocker === 'invalid rate') await page.locator('#grid-apr-72').fill('bad');
    await expect(page.locator('#payment-grid button[aria-label^="Use "]:enabled')).toHaveCount(0);
    await expect(page.locator('.grid-readiness')).toContainText('No comparison is ready to apply');
    await expect(page.locator('.grid-readiness p')).not.toBeEmpty();
    const repair = page.locator('.grid-readiness').getByRole('button', { name: 'Review worksheet', includeHidden: mobileRecovery });
    if (mobileRecovery) await expect(repair).toBeAttached();
    else await expect(repair).toBeVisible();
  });
}
