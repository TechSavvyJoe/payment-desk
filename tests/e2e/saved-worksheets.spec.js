import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const LIBRARY_KEY = 'payment-desk.worksheets.v1';
const DRAFT_KEY = 'payment-desk.draft.v2';
const REFERENCE_TIME = new Date('2026-10-11T16:00:00Z');

const library = page => page.getByRole('dialog', { name: 'Saved worksheets' });
const entry = (dialog, name) => dialog.locator('.worksheet-row').filter({ has: dialog.page().getByRole('heading', { name, exact: true }) });
const storedLibrary = page => page.evaluate(key => localStorage.getItem(key), LIBRARY_KEY);
const storedDraft = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), DRAFT_KEY);
const openLibrary = async (page, button = 'Saved worksheets') => {
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = library(page);
  await expect(dialog).toBeVisible();
  return dialog;
};
const closeLibrary = async dialog => {
  await dialog.getByRole('button', { name: 'Close saved worksheets', exact: true }).click();
  await expect(dialog).toBeHidden();
};
const saveCopy = async (page, name) => {
  const dialog = await openLibrary(page, 'Save worksheet');
  await dialog.getByRole('textbox', { name: 'Worksheet name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save a copy', exact: true }).click();
  await expect(entry(dialog, name)).toBeVisible();
  await expect.poll(async () => JSON.parse(await storedLibrary(page))?.worksheets.map(copy => copy.name)).toContain(name);
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  return dialog;
};
const fillReadyDeal = async (page, price = '30000') => {
  await page.getByRole('textbox', { name: 'Selling price', exact: true }).fill(price);
  await page.getByRole('textbox', { name: 'Selling price', exact: true }).blur();
};
const openDealDetails = async page => {
  if (!await page.locator('#vehicle-reference').isVisible()) await page.locator('details.deal-details > summary').click();
  await expect(page.locator('#vehicle-reference')).toBeVisible();
};
const openProducts = async page => {
  const toggle = page.locator('#products-addons-heading');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.locator('#products-addons-content')).toBeVisible();
};
const openSavedOverEditedDraft = async (page, dialog, name) => {
  const confirmation = page.waitForEvent('dialog');
  const opening = entry(dialog, name).getByRole('button', { name: 'Open', exact: true }).click();
  const prompt = await confirmation;
  expect(prompt.type()).toBe('confirm');
  expect(prompt.message()).toContain('This replaces your current draft.');
  await prompt.accept();
  await opening;
  await expect(dialog).toBeHidden();
};

// Assert the presentation the user can see, locating columns by name rather than saved-date order.
const expectComparisonValue = async (dialog, name, label, value) => {
  const table = dialog.locator('.worksheet-comparison-table');
  if (await table.isVisible()) {
    const headers = await table.locator('thead th').allTextContents();
    const column = headers.findIndex(header => header.startsWith(name));
    expect(column, 'Comparison column for ' + name).toBeGreaterThan(0);
    const row = table.getByRole('row').filter({ has: dialog.page().getByRole('rowheader', { name: label, exact: true }) });
    const cell = row.getByRole('cell').nth(column - 1);
    await expect(cell).toBeVisible();
    await expect(cell).toHaveText(value);
  } else {
    const card = dialog.locator('.worksheet-comparison-card').filter({ has: dialog.page().getByRole('heading', { name, exact: true }) });
    const cell = card.locator('dl > div').filter({ has: dialog.page().getByText(label, { exact: true }) }).locator('dd');
    await expect(card).toBeVisible();
    await expect(cell).toBeVisible();
    await expect(cell).toHaveText(value);
  }
};

test.beforeEach(async ({ page }) => {
  // Playwright supplies fresh storage for each test; reloads must retain the app's writes.
  await page.clock.setFixedTime(REFERENCE_TIME);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toBeVisible();
});

for (const scenario of [
  { name: 'cash purchase', field: '#apr', group: 'Purchase type', inactive: 'Cash', active: 'Finance' },
  { name: 'plate transfer', field: '#new-plate-amount', group: 'Plate type', inactive: 'Transfer', active: 'New plate' },
]) {
  test(`saved ${scenario.name} ignores inactive invalid text and restores it on reactivation`, async ({ page }) => {
    await fillReadyDeal(page);
    const mode = page.getByRole('group', { name: scenario.group, exact: true });
    await mode.getByRole('button', { name: scenario.active, exact: true }).click();
    await page.locator(scenario.field).fill('invalid');
    await expect(page.locator(scenario.field)).toHaveAttribute('aria-invalid', 'true');
    await mode.getByRole('button', { name: scenario.inactive, exact: true }).click();
    const dialog = await saveCopy(page, scenario.name);
    await expect(entry(dialog, scenario.name).getByRole('checkbox', { name: `Compare ${scenario.name}`, exact: true })).toBeEnabled();
    await closeLibrary(dialog);
    await fillReadyDeal(page, '40000');
    const reopened = await openLibrary(page);
    await openSavedOverEditedDraft(page, reopened, scenario.name);
    await expect(page.locator('#sale-price')).toHaveValue('30,000');
    await expect(mode.getByRole('button', { name: scenario.inactive, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await mode.getByRole('button', { name: scenario.active, exact: true }).click();
    await expect(page.locator(scenario.field)).toHaveValue('invalid');
    await expect(page.locator(scenario.field)).toHaveAttribute('aria-invalid', 'true');
  });
}

test('restores a named deal, products, and chosen date over a changed draft after reload', async ({ page }) => {
  test.setTimeout(60_000); // Full edit/save/edit/reload/restore flow across browser engines.
  await fillReadyDeal(page);
  await page.getByLabel('Cash down', { exact: true }).fill('2500');
  await page.getByLabel('Trade allowance', { exact: true }).fill('8000');
  await page.getByLabel('Trade payoff', { exact: true }).fill('3000');
  const terms = page.getByRole('group', { name: 'Loan term', exact: true });
  await terms.getByRole('button', { name: '60', exact: true }).click();
  await page.locator('#apr').fill('5.75');
  await openDealDetails(page);
  await page.locator('#vehicle-reference').fill('2024 Explorer / H12345');
  await page.getByLabel('Estimate date', { exact: true }).fill('10/10/26');
  await openProducts(page);
  await page.locator('#add-product').click();
  await page.getByLabel('Product 1 type', { exact: true }).selectOption('other');
  await page.getByLabel('Product name for add-on 1', { exact: true }).fill('Accessories');
  await page.locator('#product-add-on-1-amount').fill('750');
  await page.locator('#add-on-1-tax-treatment').selectOption('not-taxable');
  const dialog = await saveCopy(page, 'Explorer alternative');
  const originalLibrary = await storedLibrary(page);
  await closeLibrary(dialog);

  await fillReadyDeal(page, '41000');
  await page.getByLabel('Cash down', { exact: true }).fill('1000');
  await page.getByLabel('Trade allowance', { exact: true }).fill('6000');
  await page.getByLabel('Trade payoff', { exact: true }).fill('1500');
  await terms.getByRole('button', { name: '72', exact: true }).click();
  await page.locator('#vehicle-reference').fill('Different vehicle / H99999');
  await page.getByLabel('Estimate date', { exact: true }).fill('10/11/26');
  await page.getByLabel('Product name for add-on 1', { exact: true }).fill('Cargo mat');
  await page.locator('#product-add-on-1-amount').fill('250');
  await page.locator('#add-on-1-tax-treatment').selectOption('taxable');
  await expect.poll(async () => (await storedDraft(page))?.desk.deal).toMatchObject({
    salePrice: 41000, cashDown: 1000, tradeAllowance: 6000, tradePayoff: 1500, termMonths: 72,
    vehicleDescription: 'Different vehicle / H99999', dealDate: '2026-10-11',
    optionalItems: [{ name: 'Cargo mat', amount: 250, taxable: true }],
  });
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('41,000');
  const reopened = await openLibrary(page);
  await expect(entry(reopened, 'Explorer alternative')).toContainText('2024 Explorer / H12345');
  await openSavedOverEditedDraft(page, reopened, 'Explorer alternative');
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  await expect(page.getByLabel('Cash down', { exact: true })).toHaveValue('2,500');
  await expect(page.getByLabel('Trade allowance', { exact: true })).toHaveValue('8,000');
  await expect(page.getByLabel('Trade payoff', { exact: true })).toHaveValue('3,000');
  await expect(terms.getByRole('button', { name: '60', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#apr')).toHaveValue('5.75');
  await openProducts(page);
  await expect(page.getByLabel('Product 1 type', { exact: true })).toHaveValue('other');
  await expect(page.getByLabel('Product name for add-on 1', { exact: true })).toHaveValue('Accessories');
  await expect(page.locator('#product-add-on-1-amount')).toHaveValue('750');
  await expect(page.locator('#add-on-1-tax-treatment')).toHaveValue('not-taxable');
  await openDealDetails(page);
  await expect(page.locator('#vehicle-reference')).toHaveValue('2024 Explorer / H12345');
  await expect(page.getByLabel('Estimate date', { exact: true })).toHaveValue('10/10/26');
  expect(await storedLibrary(page)).toBe(originalLibrary);
});

test('restores invalid typing and saved targets over corrected inputs after reload', async ({ page }) => {
  test.setTimeout(60_000); // Full edit/save/edit/reload/restore flow across browser engines.
  await fillReadyDeal(page);
  const targets = page.getByRole('group', { name: 'Target type', exact: true });
  await page.locator('#target-value').fill('450');
  await targets.getByRole('button', { name: 'Out-the-door', exact: true }).click();
  await page.locator('#target-value').fill('31000');
  await page.locator('#target-value').fill('bad target');
  await page.locator('#sale-price').fill('30k');
  const dialog = await saveCopy(page, 'Unfinished target');
  const originalLibrary = await storedLibrary(page);
  await expect(entry(dialog, 'Unfinished target').getByRole('checkbox', { name: 'Compare Unfinished target', exact: true })).toBeDisabled();
  await closeLibrary(dialog);

  await fillReadyDeal(page, '35000');
  await page.locator('#target-value').fill('37000');
  await targets.getByRole('button', { name: 'Payment', exact: true }).click();
  await page.locator('#target-value').fill('500');
  await page.locator('#target-value').blur();
  await expect.poll(() => storedDraft(page)).toMatchObject({
    desk: { deal: { salePrice: 35000 } }, targetType: 'payment',
    targetValues: { payment: 500, outTheDoor: 37000 },
  });
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('35,000');
  await expect(page.locator('#target-value')).toHaveValue('500');
  const reopened = await openLibrary(page);
  await openSavedOverEditedDraft(page, reopened, 'Unfinished target');
  await expect(page.locator('#sale-price')).toHaveValue('30k');
  await expect(page.locator('#sale-price')).toHaveAttribute('aria-invalid', 'true');
  await expect(targets.getByRole('button', { name: 'Out-the-door', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#target-value')).toHaveValue('bad target');
  await expect(page.locator('#target-value')).toHaveAttribute('aria-invalid', 'true');
  await targets.getByRole('button', { name: 'Payment', exact: true }).click();
  await expect(page.locator('#target-value')).toHaveValue('450');
  await targets.getByRole('button', { name: 'Out-the-door', exact: true }).click();
  await expect(page.locator('#target-value')).toHaveValue('31,000');
  expect(await storedLibrary(page)).toBe(originalLibrary);
});

test('Reset deal clears the draft while saved copies survive reset and reload', async ({ page }) => {
  await fillReadyDeal(page);
  const dialog = await saveCopy(page, 'Keep this copy');
  const originalLibrary = await storedLibrary(page);
  await closeLibrary(dialog);
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect(page.locator('#sale-price')).toHaveValue('');
  await expect.poll(async () => {
    const draft = await storedDraft(page);
    return draft?.discarded ?? draft === null;
  }).toBe(true);
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('');
  expect(await storedLibrary(page)).toBe(originalLibrary);
  const reopened = await openLibrary(page);
  await entry(reopened, 'Keep this copy').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(reopened).toBeHidden();
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
});

test('searches saved copies and commits rename, update, and delete only after cancelling each once', async ({ page }) => {
  await fillReadyDeal(page);
  let dialog = await saveCopy(page, 'First version');
  const original = JSON.parse(await storedLibrary(page)).worksheets[0];
  await closeLibrary(dialog);
  await fillReadyDeal(page, '32000');
  dialog = await openLibrary(page);
  const search = dialog.getByRole('searchbox', { name: 'Search worksheets', exact: true });
  await search.fill('fIrSt');
  await expect(entry(dialog, 'First version')).toBeVisible();
  await search.fill('no match');
  await expect(dialog.getByText('No worksheets match this search.', { exact: true })).toBeVisible();
  await expect(dialog.locator('.worksheet-row')).toHaveCount(0);
  await search.fill('');
  const row = entry(dialog, 'First version');
  const beforeRename = await storedLibrary(page);
  await row.locator('summary').click();
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await row.getByRole('textbox', { name: 'Rename worksheet', exact: true }).fill('Cancelled name');
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row.locator('.worksheet-row__confirmation')).toHaveCount(0);
  expect(await storedLibrary(page)).toBe(beforeRename);
  await row.locator('summary').click();
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await row.getByRole('textbox', { name: 'Rename worksheet', exact: true }).fill('Renamed version');
  await row.getByRole('button', { name: 'Save name', exact: true }).click();
  const renamed = entry(dialog, 'Renamed version');
  await expect(renamed).toBeVisible();
  const afterRename = await storedLibrary(page);
  expect(JSON.parse(afterRename).worksheets[0]).toMatchObject({
    id: original.id, name: 'Renamed version', snapshot: original.snapshot,
  });

  await renamed.locator('summary').click();
  await renamed.getByRole('button', { name: 'Update with current worksheet', exact: true }).click();
  await expect(renamed.getByText(/Replace “Renamed version”\?/)).toBeVisible();
  await renamed.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(renamed.locator('.worksheet-row__confirmation')).toHaveCount(0);
  expect(await storedLibrary(page)).toBe(afterRename);
  await renamed.locator('summary').click();
  await renamed.getByRole('button', { name: 'Update with current worksheet', exact: true }).click();
  await renamed.getByRole('button', { name: 'Replace saved copy', exact: true }).click();
  await expect(renamed.locator('.worksheet-row__confirmation')).toHaveCount(0);
  await expect.poll(async () => JSON.parse(await storedLibrary(page)).worksheets[0]).toMatchObject({
    id: original.id, name: 'Renamed version', snapshot: { desk: { deal: { salePrice: 32000 } } },
  });
  await closeLibrary(dialog);
  await fillReadyDeal(page, '34000');
  dialog = await openLibrary(page);
  await openSavedOverEditedDraft(page, dialog, 'Renamed version');
  await expect(page.locator('#sale-price')).toHaveValue('32,000');

  dialog = await openLibrary(page);
  const deleteRow = entry(dialog, 'Renamed version');
  const beforeDelete = await storedLibrary(page);
  await deleteRow.locator('summary').click();
  await deleteRow.getByRole('button', { name: 'Delete', exact: true }).click();
  await deleteRow.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteRow.locator('.worksheet-row__confirmation')).toHaveCount(0);
  expect(await storedLibrary(page)).toBe(beforeDelete);
  await deleteRow.locator('summary').click();
  await deleteRow.getByRole('button', { name: 'Delete', exact: true }).click();
  await deleteRow.getByRole('button', { name: 'Delete saved copy', exact: true }).click();
  await expect(deleteRow).toHaveCount(0);
  await expect(dialog.getByText(/^No saved worksheets yet\./)).toBeVisible();
  await expect.poll(async () => JSON.parse(await storedLibrary(page)).worksheets).toEqual([]);
  await closeLibrary(dialog);
  await expect(page.locator('#sale-price')).toHaveValue('32,000');
});

test('limits comparison to two saved copies and recalculates current fees even with an invalid current draft', async ({ page }) => {
  await fillReadyDeal(page);
  let dialog = await saveCopy(page, 'Baseline');
  const baselineSnapshot = JSON.parse(await storedLibrary(page)).worksheets[0].snapshot;
  await entry(dialog, 'Baseline').getByRole('checkbox', { name: 'Compare Baseline', exact: true }).check();
  await expectComparisonValue(dialog, 'Baseline', 'Out-the-door total', '$32,163.84');
  await closeLibrary(dialog);
  await page.getByRole('button', { name: 'Dealership settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Dealership settings' });
  await settings.getByRole('textbox', { name: 'Document fee', exact: true }).fill('199');
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).toBeHidden();
  await fillReadyDeal(page, '31000');
  dialog = await saveCopy(page, 'Second');
  await closeLibrary(dialog);
  await fillReadyDeal(page, '32000');
  dialog = await saveCopy(page, 'Third');
  await entry(dialog, 'Baseline').getByRole('checkbox', { name: 'Compare Baseline', exact: true }).check();
  await entry(dialog, 'Second').getByRole('checkbox', { name: 'Compare Second', exact: true }).check();
  const selected = dialog.getByRole('status').filter({ hasText: 'Selected:' });
  await expect(selected).toContainText('Baseline');
  await expect(selected).toContainText('Second');
  await expect(dialog.locator('.worksheet-row input:checked')).toHaveCount(2);
  await expect(entry(dialog, 'Third').getByRole('checkbox', { name: 'Compare Third', exact: true })).toBeDisabled();
  // OTD = (price + $199 document fee + $34 CRV) * 1.06 + $10 + $5 + $16.
  // The baseline was saved at $280, so its $85.86 reduction proves recalculation.
  await expectComparisonValue(dialog, 'Baseline', 'Out-the-door total', '$32,077.98');
  await expectComparisonValue(dialog, 'Second', 'Out-the-door total', '$33,137.98');
  await expectComparisonValue(dialog, 'Current worksheet', 'Out-the-door total', '$34,197.98');
  expect(JSON.parse(await storedLibrary(page)).worksheets.find(copy => copy.name === 'Baseline').snapshot).toEqual(baselineSnapshot);
  await entry(dialog, 'Second').getByRole('checkbox', { name: 'Compare Second', exact: true }).uncheck();
  await expect(entry(dialog, 'Third').getByRole('checkbox', { name: 'Compare Third', exact: true })).toBeEnabled();
  await closeLibrary(dialog);

  await page.locator('#sale-price').fill('invalid');
  dialog = await openLibrary(page);
  await entry(dialog, 'Baseline').getByRole('checkbox', { name: 'Compare Baseline', exact: true }).check();
  await expectComparisonValue(dialog, 'Current worksheet', 'Status', 'Correct the highlighted input errors before creating a proposal.');
  await expectComparisonValue(dialog, 'Current worksheet', 'Payment / cash due / credit', 'Needs attention');
  await expectComparisonValue(dialog, 'Current worksheet', 'Out-the-door total', '—');
  await expectComparisonValue(dialog, 'Baseline', 'Out-the-door total', '$32,077.98');
});

test('preserves another tab’s library change and requires Reload list before saving the pending copy', async ({ page, context }) => {
  await fillReadyDeal(page);
  const dialog = await saveCopy(page, 'Original');
  await dialog.getByRole('textbox', { name: 'Worksheet name', exact: true }).fill('Pending copy');
  const otherPage = await context.newPage();
  try {
    await otherPage.clock.setFixedTime(REFERENCE_TIME);
    await otherPage.goto('/');
    const otherDialog = await openLibrary(otherPage);
    const original = entry(otherDialog, 'Original');
    await original.locator('summary').click();
    await original.getByRole('button', { name: 'Rename', exact: true }).click();
    await original.getByRole('textbox', { name: 'Rename worksheet', exact: true }).fill('External copy');
    await original.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(entry(otherDialog, 'External copy')).toBeVisible();
    const external = await storedLibrary(otherPage);
    await expect(dialog.getByRole('status')).toContainText('Another tab changed the saved worksheets.');
    await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toHaveValue('Pending copy');
    expect(await storedLibrary(page)).toBe(external);

    await dialog.getByRole('button', { name: 'Reload list', exact: true }).click();
    await expect(entry(dialog, 'External copy')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeEnabled();
    expect(await storedLibrary(page)).toBe(external);
    await dialog.getByRole('button', { name: 'Save a copy', exact: true }).click();
    await expect(entry(dialog, 'Pending copy')).toBeVisible();
    const after = JSON.parse(await storedLibrary(page));
    expect(after.worksheets).toHaveLength(2);
    expect(after.worksheets.find(copy => copy.name === 'External copy')).toEqual(JSON.parse(external).worksheets[0]);
    expect(after.worksheets.find(copy => copy.name === 'Pending copy').snapshot.desk.deal.salePrice).toBe(30000);
  } finally {
    await otherPage.close();
  }
});

for (const [kind, raw] of [
  ['malformed', '{malformed'],
  ['future-version', JSON.stringify({ version: 999, revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', worksheets: [] })],
]) {
  test('preserves a ' + kind + ' library through list reload and page reload', async ({ page }) => {
    await fillReadyDeal(page);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: LIBRARY_KEY, value: raw });
    let dialog = await openLibrary(page, 'Save worksheet');
    await expect(dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText('Their data has been preserved.');
    await dialog.getByRole('button', { name: 'Reload list', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeDisabled();
    expect(await storedLibrary(page)).toBe(raw);
    await closeLibrary(dialog);
    await page.reload();
    dialog = await openLibrary(page, 'Save worksheet');
    await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeDisabled();
    expect(await storedLibrary(page)).toBe(raw);
  });
}

test('saved-worksheet controls and populated More menu fit at 320px and 450px widths', async ({ page }) => {
  await fillReadyDeal(page);
  await closeLibrary(await saveCopy(page, 'Narrow screen copy'));
  for (const width of [320, 450]) {
    await page.setViewportSize({ width, height: 850 });
    const dialog = await openLibrary(page, 'Save worksheet');
    await expect(dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save a copy', exact: true })).toBeVisible();
    const fit = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('input, button')].filter(control => control.getClientRects().length);
      return {
        left: rect.left,
        right: rect.right,
        controlsFit: controls.every(control => {
          const box = control.getBoundingClientRect();
          return box.left >= rect.left && box.right <= rect.right;
        }),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(fit.left).toBeGreaterThanOrEqual(0);
    expect(fit.right).toBeLessThanOrEqual(width);
    expect(fit.controlsFit).toBe(true);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    const row = entry(dialog, 'Narrow screen copy');
    await row.locator('summary').click();
    const menuFit = await row.locator('.worksheet-row__more > div').evaluate(menu => {
      const bounds = menu.closest('dialog').getBoundingClientRect();
      const box = menu.getBoundingClientRect();
      const body = menu.closest('.worksheet-library__body');
      return { within: box.left >= bounds.left && box.right <= bounds.right, overflow: body.scrollWidth > body.clientWidth };
    });
    expect(menuFit).toEqual({ within: true, overflow: false });
    await row.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(row.getByRole('textbox', { name: 'Rename worksheet', exact: true })).toBeFocused();
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row.locator('summary')).toBeFocused();
    await closeLibrary(dialog);
  }
});

test('selected comparisons, More, and Rename pass Axe and Escape restores the opener focus', async ({ page }) => {
  await fillReadyDeal(page);
  let dialog = await saveCopy(page, 'Option A');
  await closeLibrary(dialog);
  dialog = await saveCopy(page, 'Option B');
  await closeLibrary(dialog);
  const beforeRename = await storedLibrary(page);
  const opener = page.getByRole('button', { name: 'Saved worksheets', exact: true });
  dialog = await openLibrary(page);
  await entry(dialog, 'Option A').getByRole('checkbox', { name: 'Compare Option A', exact: true }).check();
  await entry(dialog, 'Option B').getByRole('checkbox', { name: 'Compare Option B', exact: true }).check();
  await expectComparisonValue(dialog, 'Option A', 'Out-the-door total', '$32,163.84');
  const row = entry(dialog, 'Option A');
  await row.locator('summary').click();
  await expect(row.getByRole('button', { name: 'Rename', exact: true })).toBeVisible();
  const moreScan = await new AxeBuilder({ page }).include('.worksheet-library')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(moreScan.violations).toEqual([]);

  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  const name = row.getByRole('textbox', { name: 'Rename worksheet', exact: true });
  await expect(name).toBeFocused();
  await name.fill('Unsaved rename');
  const renameScan = await new AxeBuilder({ page }).include('.worksheet-library')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(renameScan.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await storedLibrary(page)).toBe(beforeRename);
});
