import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const REMINDER = 'Tax and fee rules are reviewed through Dec 31, 2026. Have them reviewed and the app updated before January 1, or estimates dated 2027 will be blocked.';
const reminder = page => page.getByRole('note').filter({ hasText: 'Tax and fee rules are reviewed through' });
const price = page => page.getByRole('textbox', { name: 'Selling price', exact: true });

// Noon in Detroit, so the Eastern calendar day is unambiguous.
async function openOn(page, isoDate) {
  await page.clock.setFixedTime(new Date(`${isoDate}T17:00:00Z`));
  await page.goto('/');
  await expect(price(page)).toBeVisible();
}

test('the reminder stays hidden through November 30', async ({ page }) => {
  await openOn(page, '2026-11-30');
  await expect(page.getByRole('heading', { name: 'Build the deal. See the payment.' })).toBeAttached();
  await expect(reminder(page)).toHaveCount(0);
  await expect(page.getByText('Tax and fee rules are reviewed through')).toHaveCount(0);
});

for (const isoDate of ['2026-12-01', '2026-12-31']) {
  test(`on ${isoDate} Dealer view shows the reminder under the header and Customer view does not`, async ({ page }) => {
    await openOn(page, isoDate);
    const note = reminder(page);
    await expect(note).toBeVisible();
    await expect(note).toContainText(REMINDER);
    // It sits directly under the header and is not dismissible.
    const header = await page.locator('.app-header').boundingBox();
    const box = await note.boundingBox();
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    await expect(note.getByRole('button')).toHaveCount(0);
    // An information color, never the error red.
    const colors = await note.evaluate(node => {
      const style = getComputedStyle(node);
      return [style.backgroundColor, style.color, style.borderTopColor, style.borderLeftColor, style.borderBottomColor];
    });
    for (const color of colors) expect(color).not.toMatch(/rgb\(180, 35, 24\)|rgb\(253, 241, 240\)/);

    await price(page).fill('30000');
    await price(page).press('Tab');
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your purchase estimate', exact: true })).toBeVisible();
    await expect(reminder(page)).toHaveCount(0);
    // A December estimate is still within the review window, so it can be exported.
    await expect(page.getByRole('button', { name: 'Copy summary', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Dealer view', exact: true }).click();
    await expect(reminder(page)).toBeVisible();
  });
}

// A desk left open across Eastern midnight updates without anyone touching it.
for (const [label, before, shownAfter] of [
  ['appears at midnight on December 1', '2026-12-01T04:59:30Z', true],
  ['leaves at midnight on January 1', '2027-01-01T04:59:30Z', false],
]) {
  test(`with the page left open, the reminder ${label}`, async ({ page }) => {
    await page.clock.install({ time: new Date(before) });
    await page.goto('/');
    await expect(price(page)).toBeVisible();
    await expect(reminder(page)).toHaveCount(shownAfter ? 0 : 1);
    await page.clock.runFor(90_000);
    await expect(reminder(page)).toHaveCount(shownAfter ? 1 : 0);
  });
}

// 11:59:30 PM Eastern on October 6. Ninety seconds later it is October 7.
const BEFORE_MIDNIGHT = new Date('2026-10-07T03:59:30Z');
const estimateDate = page => page.getByRole('textbox', { name: 'Estimate date' });

test('a blank desk left open overnight moves to the new day and still resets and closes without a prompt', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/');
  await page.locator('details.deal-details > summary').click();
  await expect(estimateDate(page)).toHaveValue('10/06/26');
  // A click gives the page the user activation browsers require before warning on leave.
  await price(page).click();
  await price(page).blur();
  await page.clock.runFor(90_000);
  await expect(estimateDate(page)).toHaveValue('10/07/26');
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  // Reset closes Deal details.
  await page.locator('details.deal-details > summary').click();
  await expect(estimateDate(page)).toHaveValue('10/07/26');
  // No "Leave site?" prompt: the page closes (or, in WebKit, stays put) without asking.
  const closing = page.close({ runBeforeUnload: true });
  const prompt = await page.waitForEvent('dialog', { timeout: 3_000 }).then(dialog => dialog.type(), () => null);
  await closing;
  expect(prompt).toBeNull();
  expect(dialogs).toEqual([]);
});

test('a saved deal keeps its date overnight and asks before Reset but can safely close', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/');
  await page.locator('details.deal-details > summary').click();
  await price(page).fill('30000');
  await price(page).press('Tab');
  await page.clock.runFor(90_000);
  await expect(estimateDate(page)).toHaveValue('10/06/26');
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect.poll(() => dialogs).toEqual(['confirm']);
  await expect(price(page)).toHaveValue('30,000');
  await page.close({ runBeforeUnload: true });
  expect(dialogs).toEqual(['confirm']);
});

test('Reset in the first minute after midnight starts the new day, not yesterday', async ({ page }) => {
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/');
  await price(page).fill('30000');
  await price(page).press('Tab');
  // 12:00:10 AM: the new day has begun, but the app's once-a-minute check has not run yet.
  await page.clock.runFor(40_000);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset deal', exact: true }).click();
  await expect(price(page)).toHaveValue('');
  await page.locator('details.deal-details > summary').click();
  await expect(estimateDate(page)).toHaveValue('10/07/26');
  await page.clock.runFor(60_000);
  await expect(estimateDate(page)).toHaveValue('10/07/26');
});

test('clearing a deal kept overnight moves it to the new day without interrupting typing', async ({ page }) => {
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/');
  await page.locator('details.deal-details > summary').click();
  await price(page).fill('30000');
  await price(page).press('Tab');
  await page.clock.runFor(90_000);
  await expect(estimateDate(page)).toHaveValue('10/06/26');
  // Clearing the only figure makes the desk blank again, mid-keystroke. Raw key presses
  // go wherever focus is, as a person's typing does; a remount would swallow them.
  await price(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('25000');
  await expect(price(page)).toBeFocused();
  await expect(price(page)).toHaveValue('25000');
  await expect(estimateDate(page)).toHaveValue('10/07/26');
});

test('a date picked on a desk kept overnight stays picked, and the date field keeps focus', async ({ page }) => {
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/');
  await page.locator('details.deal-details > summary').click();
  await estimateDate(page).fill('10/05/26');
  await page.clock.runFor(90_000);
  // Choosing the desk's first day again makes it blank; the choice must still stand.
  await estimateDate(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10/06/26');
  await page.clock.runFor(90_000);
  await expect(estimateDate(page)).toHaveValue('10/06/26');
  await expect(estimateDate(page)).toBeFocused();
});

test('a blank desk moves to the new day without taking focus from the date field', async ({ page }) => {
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.goto('/');
  await page.locator('details.deal-details > summary').click();
  await estimateDate(page).click();
  await page.clock.runFor(90_000);
  await expect(estimateDate(page)).toHaveValue('10/07/26');
  await expect(estimateDate(page)).toBeFocused();
});

test('on January 2, 2027 the reminder is gone and the per-deal review warning takes over', async ({ page }) => {
  await openOn(page, '2027-01-02');
  await expect(reminder(page)).toHaveCount(0);
  await price(page).fill('30000');
  await price(page).press('Tab');
  const summary = page.locator('.desktop-results:visible, .mobile-results:visible');
  await expect(summary.locator('.result-warning')).toContainText('fee and tax policy must be reviewed for this date');
});

test('the reminder passes an accessibility scan', async ({ page }) => {
  await openOn(page, '2026-12-15');
  await expect(reminder(page)).toBeVisible();
  const scan = await new AxeBuilder({ page }).include('.policy-reminder').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
});

// Distinct line tops of the text a sighted reader sees (visually hidden text is skipped).
const visibleLines = note => note.evaluate(node => {
  const tops = new Set();
  for (const element of [node, ...node.querySelectorAll('*')]) {
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1 || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    for (const child of element.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const rect of range.getClientRects()) if (rect.width > 1 && rect.height > 1) tops.add(Math.round(rect.top));
    }
  }
  return tops.size;
});
// The text assistive technology reads: everything outside aria-hidden subtrees.
const spokenText = note => note.evaluate(node => {
  const walk = current => current.nodeType === Node.TEXT_NODE ? current.textContent
    : current.nodeType === Node.ELEMENT_NODE && current.getAttribute('aria-hidden') === 'true' ? ''
      : [...current.childNodes].map(walk).join('');
  return walk(node).replace(/\s+/g, ' ').trim();
});

for (const [width, height] of [[320, 640], [360, 740], [375, 667], [390, 844], [430, 932], [600, 900], [601, 900], [800, 900], [801, 900], [1440, 1000]]) {
  test(`at ${width}px the reminder keeps to ${width >= 1280 ? 'one line' : 'two lines'} without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openOn(page, '2026-12-01');
    const note = reminder(page);
    await expect(note).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await visibleLines(note)).toBeGreaterThanOrEqual(1);
    expect(await visibleLines(note)).toBeLessThanOrEqual(width >= 1280 ? 1 : 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // Screen readers always get the complete sentence, once.
    expect(await spokenText(note)).toBe(REMINDER);
  });
}

test('on a phone the reminder keeps Selling price in the top half of the opening screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOn(page, '2026-12-01');
  await expect(reminder(page)).toBeVisible();
  const bottom = await price(page).evaluate(element => element.getBoundingClientRect().bottom + window.scrollY);
  expect(bottom).toBeLessThanOrEqual(844 * 0.45);
});

// In December the reminder moves the phone worksheet down by its own height and no more:
// Selling price and Cash down stay on the first screen; on compact phones Trade allowance
// becomes a short scroll away.
for (const [label, width, height] of [['iPhone 14 in Safari', 390, 664], ['Galaxy S23 in Chrome', 360, 668], ['regular phone', 390, 844]]) {
  test(`${label} (${width}x${height}): the reminder moves the worksheet by its own height only`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.setViewportSize({ width, height });
    const measure = async isoDate => {
      await openOn(page, isoDate);
      await price(page).fill('30000');
      await price(page).press('Tab');
      await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
      await page.evaluate(() => window.scrollTo(0, 0));
      return page.evaluate(() => {
        const bottom = selector => document.querySelector(selector).getBoundingClientRect().bottom + window.scrollY;
        return {
          price: bottom('#sale-price'),
          cash: bottom('#cash-down'),
          trade: bottom('#trade-allowance'),
          bar: document.querySelector('.mobile-nav').getBoundingClientRect().top,
          reminder: document.querySelector('.policy-reminder')?.getBoundingClientRect().height ?? 0,
        };
      });
    };
    const before = await measure('2026-11-30');
    const during = await measure('2026-12-01');
    expect(before.reminder).toBe(0);
    expect(during.reminder).toBeGreaterThan(0);
    expect(during.reminder).toBeLessThanOrEqual(48);
    expect(during.trade - before.trade).toBeCloseTo(during.reminder, 0);
    expect(during.price).toBeLessThanOrEqual(during.bar);
    expect(during.cash).toBeLessThanOrEqual(during.bar);
  });
}
