import { test, expect } from '@playwright/test';

const widths = [320, 390, 450, 600, 900];
const detailsFor = page => page.locator('details.deal-details');

async function openDetails(page, width) {
  await page.setViewportSize({ width, height: 650 });
  await page.goto('/');
  await detailsFor(page).locator('summary').click();
  await expect(detailsFor(page)).toHaveAttribute('open', '');
  await expect(page.getByLabel('Buyer registration state', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectSelectedLabelFits(control) {
  const fit = await control.evaluate(element => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const label = element.selectedOptions[0].textContent.trim();
    const spacing = parseFloat(style.letterSpacing) || 0;
    return {
      label,
      textWidth: context.measureText(label).width + Math.max(0, label.length - 1) * spacing,
      // Leave room for the native select arrow as well as the authored padding.
      available: element.clientWidth - parseFloat(style.paddingLeft) - Math.max(20, parseFloat(style.paddingRight)),
    };
  });
  expect(fit.textWidth, `${fit.label} must fit the select without clipping`).toBeLessThanOrEqual(fit.available + 1);
}

async function expectSummaryClearOfInventory(page) {
  const overlaps = await page.locator('.deal-tools').evaluate(tools => {
    const button = tools.querySelector('button').getBoundingClientRect();
    const summary = tools.querySelector('summary');
    const walker = document.createTreeWalker(summary, NodeFilter.SHOW_TEXT);
    const overlaps = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
        // Only rendered text counts: a summary preview may intentionally ellipsize.
        for (let parent = node.parentElement; parent !== summary; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const clip = parent.getBoundingClientRect();
          if (style.overflowX !== 'visible') { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
          if (style.overflowY !== 'visible') { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
        }
        if (right > left && bottom > top && left < button.right && right > button.left && top < button.bottom && bottom > button.top) overlaps.push(node.textContent.trim());
      }
    }
    return overlaps;
  });
  expect(overlaps, 'Inventory must not cover visible summary text').toEqual([]);
}

for (const width of widths) {
  test(`expanded Deal details fills its toolbar and keeps fields and selected labels readable at ${width}px`, async ({ page }) => {
    await openDetails(page, width);
    const body = detailsFor(page).locator('.deal-context');
    const state = page.getByLabel('Buyer registration state', { exact: true });
    const scope = page.getByLabel('Transaction coverage', { exact: true });
    await expect(state).toHaveAccessibleName('Buyer registration state');
    await expect(scope).toHaveAccessibleName('Transaction coverage');
    await expect(body.locator('label[for="registration-state"]')).toBeVisible();
    await expect(body.locator('label[for="registration-state"]')).toContainText(/registration state/i);
    await expect(body.locator('label[for="transaction-scope"]')).toBeVisible();
    await expect(body.locator('label[for="transaction-scope"]')).toContainText(/transaction (type|coverage)/i);
    const layout = await page.locator('.deal-tools').evaluate(tools => {
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const content = element => {
        const rect = box(element), style = getComputedStyle(element);
        const left = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        const right = rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        return { left, right, width: right - left };
      };
      const card = tools.querySelector('details'), body = card.querySelector('.deal-context');
      return {
        tools: content(tools), card: box(card), cardContent: content(card), body: box(body), bodyContent: content(body),
        vehicle: box(body.querySelector('#vehicle-reference')),
        controls: [...body.querySelectorAll('input, select, button')].filter(element => element.getClientRects().length).map(element => ({ id: element.id || element.getAttribute('aria-label'), ...box(element) })),
      };
    });
    expect(Math.abs(layout.card.left - layout.tools.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.card.right - layout.tools.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.body.left - layout.cardContent.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.body.right - layout.cardContent.right)).toBeLessThanOrEqual(2);
    expect(layout.vehicle.width).toBeGreaterThanOrEqual(layout.bodyContent.width * 0.9);
    for (const control of layout.controls) {
      expect(control.height, `${control.id} minimum target height`).toBeGreaterThanOrEqual(44);
      expect(control.left, `${control.id} left containment`).toBeGreaterThanOrEqual(layout.bodyContent.left - 1);
      expect(control.right, `${control.id} right containment`).toBeLessThanOrEqual(layout.bodyContent.right + 1);
      expect(control.top).toBeGreaterThanOrEqual(layout.body.top);
      expect(control.bottom).toBeLessThanOrEqual(layout.body.bottom);
    }
    await expectSelectedLabelFits(state);
    if (width === 450) {
      await state.selectOption('DC');
      await expect(state.locator('option:checked')).toHaveText('District of Columbia');
      await expectSelectedLabelFits(state);
    }
    // Cover the longest choices too, without coupling the test to their wording.
    const options = await scope.locator('option').evaluateAll(options => options.filter(option => option.value).map(option => option.value));
    for (const value of options) {
      await scope.selectOption(value);
      await expectSelectedLabelFits(scope);
    }
    await expectSummaryClearOfInventory(page);
    await page.locator('#vehicle-reference').fill('2024 Explorer · H12345 · vehicle reference for this estimate');
    await expectSummaryClearOfInventory(page);
  });
}

for (const width of [320, 450]) {
  test(`native summary toggles by keyboard and Inventory stays reachable and restores focus at ${width}px`, async ({ page }) => {
    await openDetails(page, width);
    const details = detailsFor(page), summary = details.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();
    await expect(page.getByLabel('Transaction coverage', { exact: true })).toBeHidden();
    await page.keyboard.press('Space');
    await expect(details).toHaveAttribute('open', '');
    await expect(page.getByLabel('Transaction coverage', { exact: true })).toBeVisible();
    const inventory = page.getByRole('button', { name: 'Inventory', exact: true });
    await expectSummaryClearOfInventory(page);
    await inventory.click();
    const dialog = page.getByRole('dialog', { name: 'Dealership inventory' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reload catalog' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(inventory).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(inventory).toBeFocused();
    await expect(details).toHaveAttribute('open', '');
  });
}

for (const width of [320, 450]) {
  test(`unsupported state and transaction survive refresh and focus the rearranged fields at ${width}px`, async ({ page }) => {
    await openDetails(page, width);
    await page.locator('#sale-price').fill('30000');
    await page.locator('#sale-price').blur();
    const state = page.getByLabel('Buyer registration state', { exact: true });
    const scope = page.getByLabel('Transaction coverage', { exact: true });
    const warning = page.locator('.validation-banner').filter({ hasText: 'Tax rules unavailable' });
    for (const [control, value, field, message] of [
      [state, 'DC', 'registrationState', 'District of Columbia automatic tax and registration rules are not connected'],
      [scope, 'manufacturer-rebate', 'transactionScope', 'outside the reviewed Michigan resident retail purchase rules'],
    ]) {
      await control.selectOption(value);
      await expect(warning).toContainText(message);
      await expect(control).toHaveAttribute('aria-invalid', 'true');
      await page.getByRole('button', { name: 'Customer view', exact: true }).click();
      await expect(control).toBeFocused();
      await expect(page.locator('.customer-actions')).toHaveCount(0);
      await expect.poll(() => page.evaluate(field => JSON.parse(localStorage.getItem('payment-desk.draft.v2'))?.desk.deal[field], field)).toBe(value);
      await page.reload();
      await expect(warning).toContainText(message);
      await page.getByRole('button', { name: 'Review tax coverage' }).click();
      await expect(control).toHaveValue(value);
      // Review enters at the state; attempting customer view targets the actual invalid field.
      await page.getByRole('button', { name: 'Customer view', exact: true }).click();
      await expect(control).toBeFocused();
      await control.selectOption(field === 'registrationState' ? 'MI' : 'resident-retail');
      await expect(warning).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
  });
}
