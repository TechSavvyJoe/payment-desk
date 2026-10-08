import { test, expect } from '@playwright/test';

const KEY = 'payment-desk.draft.v1';
const openGrid = async page => {
  const jump = page.locator('.grid-jump');
  if (await jump.isVisible()) await jump.click();
  else await page.locator('.mobile-nav button').first().click();
};
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-07T16:00:00Z'));
  await page.goto('/');
});

for (const restored of [false, true]) {
  test(`${restored ? 'restored' : 'live'} baseline price and target edits leave no draft or replacement/reset warnings`, async ({ page }) => {
    await page.locator('#sale-price').fill('30000');
    await page.locator('#target-value').fill('450');
    await page.locator('#target-value').blur();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.targetValues.payment, KEY)).toBe(450);
    if (restored) {
      await page.evaluate(key => {
        const saved = JSON.parse(localStorage.getItem(key));
        saved.desk.deal.salePrice = null;
        saved.targetValues.payment = '';
        saved.inputDrafts = { 'sale-price': { raw: '' }, 'target-value': { raw: '' } };
        localStorage.setItem(key, JSON.stringify(saved));
      }, KEY);
      await page.reload();
    } else {
      await page.locator('#sale-price').fill('');
      await page.locator('#target-value').fill('');
      await page.locator('#target-value').blur();
    }
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
    await expect(page.locator('#sale-price')).toHaveValue('');
    await expect(page.locator('#target-value')).toHaveValue('');
    await page.evaluate(hash => { location.hash = hash; }, '#pd-vehicle=' + encodeURIComponent(JSON.stringify({ version: 1, salePrice: 30000, vehicleDescription: 'Example vehicle' })));
    const review = page.getByRole('dialog', { name: 'Review captured vehicle' });
    await expect(review).toBeVisible();
    await expect(review.locator('.vehicle-import__warning')).toHaveCount(0);
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    const confirmations = [];
    page.on('dialog', async dialog => { confirmations.push(dialog.message()); await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
    expect(confirmations).toEqual([]);
    await page.reload();
    await expect(page.locator('#sale-price')).toHaveValue('');
    await expect(page.locator('#target-value')).toHaveValue('');
  });
}

test('refresh restores the worksheet, products, grid and target; Reset clears the draft', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await page.locator('#cash-down').fill('2500');
  await page.locator('#trade-allowance').fill('8000');
  await page.locator('#trade-payoff').fill('3000');
  await page.getByRole('group', { name: 'Loan term', exact: true }).getByRole('button', { name: '60', exact: true }).click();
  await page.locator('details.deal-details > summary').click();
  await page.locator('#vehicle-reference').fill('Test Explorer / H12345');
  await page.locator('#estimate-date').fill('10/06/26');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product 1 type').selectOption('other');
  await page.getByLabel('Name for product or add-on 1').fill('Accessories');
  await page.getByLabel('Accessories amount').fill('750');
  await page.getByLabel('Tax treatment for Accessories').selectOption('not-taxable');
  await openGrid(page);
  await page.locator('#grid-down-3').fill('3500');
  await page.locator('#grid-apr-60').fill('5.75');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await page.locator('#target-value').fill('450');
  await page.locator('#target-value').blur();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.targetValues.payment, KEY)).toBe(450);
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  await expect(page.locator('#cash-down')).toHaveValue('2,500');
  await expect(page.locator('#trade-allowance')).toHaveValue('8,000');
  await expect(page.locator('#trade-payoff')).toHaveValue('3,000');
  await expect(page.locator('#apr')).toHaveValue('5.75');
  await expect(page.locator('#target-value')).toHaveValue('450');
  await expect(page.getByLabel('Accessories amount')).toHaveValue('750');
  await expect(page.getByLabel('Tax treatment for Accessories')).toHaveValue('not-taxable');
  await page.locator('details.deal-details > summary').click();
  await expect(page.locator('#vehicle-reference')).toHaveValue('Test Explorer / H12345');
  await expect(page.locator('#estimate-date')).toHaveValue('10/06/26');
  await openGrid(page);
  await expect(page.locator('#grid-down-3')).toHaveValue('3,500');
  await expect(page.locator('#grid-apr-60')).toHaveValue('5.75');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('');
  await expect(page.locator('#cash-down')).toHaveValue('0');
  await expect(page.locator('#target-value')).toHaveValue('');
  await expect(page.locator('.option-row')).toHaveCount(0);
});

test('invalid price and date drafts stay invalid after refresh and cannot become an export', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').fill('30k');
  await page.locator('details.deal-details > summary').click();
  await page.locator('#estimate-date').fill('02/30/26');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.inputDrafts['estimate-date']?.raw, KEY)).toBe('02/30/26');
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('30k');
  await expect(page.locator('#sale-price')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#estimate-date')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await page.locator('#sale-price').fill('30000');
  if (!await page.locator('#estimate-date').isVisible()) await page.locator('details.deal-details > summary').click();
  await page.locator('#estimate-date').fill('10/07/26');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});

test('a stale valid date draft cannot disagree with the restored estimate date', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.desk.deal.salePrice, KEY)).toBe(30000);
  await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.desk.deal.dealDate = '2026-10-06';
    saved.desk.dateChosen = true;
    saved.inputDrafts['estimate-date'] = { raw: '10/08/26' };
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  await page.locator('details.deal-details > summary').click();
  await expect(page.locator('#estimate-date')).toHaveValue('10/06/26');
  await expect(page.locator('#estimate-date')).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toContainText('10/06/26');
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});

test('blocked draft storage gives an honest warning while the current worksheet still works', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
  await page.reload();
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
  await expect(page.locator('.app-footer')).toContainText('Draft could not be saved');
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});

for (const raw of ['750', 'invalid']) {
  test(`removing the only product clears its ${raw === '750' ? 'valid' : 'invalid'} input draft and replacement/reset warnings`, async ({ page }) => {
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    await page.getByLabel('Service Contract amount', { exact: true }).fill(raw);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.inputDrafts['product-add-on-1-amount']?.raw, KEY)).toBe(raw);
    await page.getByRole('button', { name: 'Remove Service Contract', exact: true }).click();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
    await expect(page.locator('.validation-banner')).toBeHidden();
    await page.evaluate(hash => { location.hash = hash; }, '#pd-vehicle=' + encodeURIComponent(JSON.stringify({ version: 1, salePrice: 30000, vehicleDescription: 'Example vehicle' })));
    const review = page.getByRole('dialog', { name: 'Review captured vehicle' });
    await expect(review).toBeVisible();
    await expect(review.locator('.vehicle-import__warning')).toHaveCount(0);
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    const confirmations = [];
    page.on('dialog', async dialog => { confirmations.push(dialog.message()); await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
    expect(confirmations).toEqual([]);
  });
}

for (const edit of ['target', 'date']) {
  test(`Reset confirms ${edit}-only work; Cancel keeps it and confirmation clears its saved draft`, async ({ page }) => {
    const field = page.locator(edit === 'target' ? '#target-value' : '#estimate-date');
    if (edit === 'date') await page.locator('details.deal-details > summary').click();
    const value = edit === 'target' ? '450' : '10/06/26';
    await field.fill(value);
    await field.blur();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).not.toBeNull();
    let confirmations = 0;
    page.once('dialog', async dialog => { confirmations++; expect(dialog.message()).toContain('targets and the selected date'); await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
    expect(confirmations).toBe(1);
    await expect(field).toHaveValue(value);
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).not.toBeNull();
    page.once('dialog', async dialog => { confirmations++; await dialog.accept(); });
    await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
    expect(confirmations).toBe(2);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
    await page.reload();
    await expect(page.locator('#target-value')).toHaveValue('');
    await expect(page.locator('#estimate-date')).toHaveValue('10/07/26');
  });
}

for (const blockedRemoval of [false, true]) {
  test(`crash recovery starts a blank worksheet when draft removal is ${blockedRemoval ? 'blocked' : 'available'}`, async ({ page }) => {
    await page.locator('#sale-price').fill('30000');
    await page.locator('#sale-price').blur();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.desk.deal.salePrice, KEY)).toBe(30000);
    await page.addInitScript(({ key, blockedRemoval }) => {
      // A deterministic render fault tied to the saved deal exercises the real
      // React boundary. A new blank deal must recover with this fault still active.
      const descriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, 'format');
      Object.defineProperty(Intl.NumberFormat.prototype, 'format', {
        ...descriptor, get() {
          const format = descriptor.get.call(this);
          return value => {
            if (value === 30000) throw new Error('Synthetic saved-deal render fault');
            return format(value);
          };
        },
      });
      if (blockedRemoval) {
        const remove = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (name) {
          if (name === key) throw new Error('Draft removal blocked');
          return remove.call(this, name);
        };
      }
    }, { key: KEY, blockedRemoval });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Something went wrong');
    await expect(page.getByRole('alert')).toContainText('A worksheet draft may be saved on this device');
    await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
    await expect(page.locator('#sale-price')).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (blockedRemoval) {
      await expect(page.locator('.app-footer')).toContainText('Draft could not be saved');
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).desk.deal.salePrice, KEY)).toBe(30000);
    } else {
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
      await page.reload();
      await expect(page.locator('#sale-price')).toHaveValue('');
    }
    await page.locator('#sale-price').fill('20000');
    await page.locator('#sale-price').blur();
    await expect(page.locator('#sale-price')).toHaveValue('20,000');
  });
}

test('a stale tab cannot replace or clear the newer draft and reload recovers it', async ({ page, context }) => {
  await page.locator('#sale-price').fill('30000');
  await page.locator('#sale-price').blur();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.desk.deal.salePrice, KEY)).toBe(30000);
  const other = await context.newPage();
  other.on('dialog', dialog => dialog.accept());
  page.on('dialog', dialog => dialog.accept());
  await other.goto('/');
  await expect(other.locator('#sale-price')).toHaveValue('30,000');
  await page.locator('#cash-down').fill('2500');
  await page.locator('#cash-down').blur();
  await expect(other.locator('.app-footer')).toContainText('Another tab changed the saved draft');
  await other.locator('#target-value').fill('500');
  await other.locator('#target-value').blur();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).targetValues.payment, KEY)).toBe('');
  await other.reload();
  await expect(other.locator('#cash-down')).toHaveValue('2,500');
  await other.locator('#target-value').fill('500');
  await other.locator('#target-value').blur();
  await expect(page.locator('.app-footer')).toContainText('Another tab changed the saved draft');
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).targetValues.payment, KEY)).toBe(500);
  await page.reload();
  await expect(page.locator('#sale-price')).toHaveValue('30,000');
  await expect(page.locator('#cash-down')).toHaveValue('2,500');
  await expect(page.locator('#target-value')).toHaveValue('500');
});

test('simultaneous tab edits keep one saved draft and warn the other tab', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('#sale-price')).toBeVisible();
  await expect(page.locator('.app-footer')).toContainText('Draft saved on this device');
  await expect(other.locator('.app-footer')).toContainText('Draft saved on this device');
  await Promise.all([page.locator('#sale-price').fill('30000'), other.locator('#sale-price').fill('20000')]);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.desk.deal.salePrice, KEY)).toBeTruthy();
  const price = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).desk.deal.salePrice, KEY);
  expect([20000, 30000]).toContain(price);
  const stale = price === 30000 ? other : page;
  const active = price === 30000 ? page : other;
  await expect(stale.locator('.app-footer')).toContainText('Another tab changed the saved draft');
  await expect(active.locator('.app-footer')).toContainText('Draft saved on this device');
  await stale.locator('#cash-down').fill('5000');
  await stale.locator('#cash-down').blur();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).desk.deal.cashDown, KEY)).toBe(0);
});

for (const reason of ['blocked', 'conflicted']) {
  test(`unsaved target-only work warns before leaving when storage is ${reason}`, async ({ page, context }) => {
    if (reason === 'blocked') {
      await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
      await page.reload();
    }
    await page.locator('#target-value').click();
    await page.locator('#target-value').fill('500');
    await page.locator('#target-value').blur();
    if (reason === 'conflicted') {
      await expect(page.locator('.app-footer')).toContainText('Draft saved on this device');
      const other = await context.newPage();
      await other.goto('/');
      await other.locator('#sale-price').fill('30000');
      await other.locator('#sale-price').blur();
      await expect(page.locator('.app-footer')).toContainText('Another tab changed the saved draft');
    } else await expect(page.locator('.app-footer')).toContainText('Draft could not be saved');
    await expect(page.locator('#sale-price')).toHaveValue('');
    const prompt = page.waitForEvent('dialog', { timeout: 3000 });
    await page.close({ runBeforeUnload: true });
    const dialog = await prompt;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await expect(page.locator('#target-value')).toHaveValue('500');
  });
}

for (const reason of ['queued', 'blocked']) {
  test(`Reset warns before leaving until draft removal is confirmed when saves are ${reason}`, async ({ page }) => {
    await page.locator('#sale-price').fill('30000');
    await page.locator('#sale-price').blur();
    await expect(page.locator('.app-footer')).toContainText('Draft saved on this device');
    if (reason === 'queued') {
      await page.evaluate(async key => {
        let acquired;
        const ready = new Promise(resolve => { acquired = resolve; });
        void navigator.locks.request(key, async () => {
          acquired();
          await new Promise(resolve => { window.releaseDraftLock = resolve; });
        });
        await ready;
      }, KEY);
      await page.locator('#cash-down').fill('2500');
      await page.locator('#cash-down').blur();
    } else await page.evaluate(key => {
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (name) {
        if (name === key) throw new Error('Draft removal blocked');
        return remove.call(this, name);
      };
    }, KEY);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
    await expect(page.locator('#sale-price')).toHaveValue('');
    await expect(page.locator('.app-footer')).toContainText(reason === 'queued' ? 'Saving draft' : 'Draft could not be saved');
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).not.toBeNull();
    const prompt = page.waitForEvent('dialog', { timeout: 10_000 });
    await page.close({ runBeforeUnload: true });
    const dialog = await prompt;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    if (reason === 'queued') {
      await page.evaluate(() => window.releaseDraftLock());
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
      await expect(page.locator('.app-footer')).toContainText('Draft saved on this device');
      await page.reload();
      await expect(page.locator('#sale-price')).toHaveValue('');
    }
  });
}

test('an invalid grid rate survives refresh and blocks an estimate until corrected', async ({ page }) => {
  await page.locator('#sale-price').fill('30000');
  await openGrid(page);
  await page.locator('#grid-apr-60').fill('bad rate');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.inputDrafts['grid-apr-60']?.raw, KEY)).toBe('bad rate');
  await expect(page.locator('.app-footer')).toContainText('Draft saved on this device');
  await page.reload();
  await expect(page.locator('#grid-apr-60')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.customer-layout')).toHaveCount(0);
  await expect(page.locator('#grid-apr-60')).toHaveValue('bad rate');
  await page.locator('#grid-apr-60').fill('6');
  await page.getByRole('button', { name: 'Back to calculator', exact: true }).click();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
});
