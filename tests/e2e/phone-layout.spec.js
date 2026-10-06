import { test as base, expect } from '@playwright/test';

// A fixed September date: from December 1 the rules-review reminder sits under the header and
// moves the worksheet down by its own height (policy-reminder.spec.js measures that case).
const REFERENCE_TIME = new Date('2026-09-24T16:00:00Z');
const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(REFERENCE_TIME);
    await use(page);
  },
});

// Position within the whole page, so the checks don't depend on the current scroll.
const pageBox = locator => locator.evaluate(element => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, height: rect.height };
});
const enterPrice = async page => {
  const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
  await price.fill('30000');
  await price.press('Tab');
};

test.describe('phone worksheet starts at the inputs', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toBeVisible();
  });

  test('the opening screen shows Selling price in the top half with no intro or start box', async ({ page }) => {
    const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
    expect((await pageBox(price)).bottom).toBeLessThanOrEqual(page.viewportSize().height * 0.45);
    await expect(page.getByRole('heading', { name: 'Build the deal. See the payment.' })).toBeAttached();
    expect((await pageBox(page.locator('#worksheet-heading'))).height).toBeLessThanOrEqual(1);
    await expect(page.locator('.mobile-results')).toBeHidden();
    await expect(page.locator('.estimate-start:visible')).toHaveCount(0);
  });

  test('the bottom bar starts the estimate at the selling price', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Mobile calculator shortcuts' }).getByRole('button', { name: 'Enter selling price', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toBeFocused();
  });

  test('after a price, the payment card stays slim and Trade allowance is on the first screen', async ({ page }) => {
    await enterPrice(page);
    const card = page.locator('.mobile-results');
    await expect(card.locator('.payment-number strong')).toHaveText('$540.67');
    expect((await pageBox(card)).height).toBeLessThanOrEqual(160);
    expect((await pageBox(card.getByRole('button', { name: 'Review customer estimate', exact: true }))).height).toBeLessThanOrEqual(52);
    const details = card.getByRole('button', { name: 'Details', exact: true });
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('.result-totals').getByText('Amount financed')).toBeHidden();
    await expect(card.getByRole('button', { name: 'Review customer estimate', exact: true })).toBeVisible();
    const navHeight = (await page.locator('.mobile-nav').boundingBox()).height;
    const trade = page.getByRole('textbox', { name: 'Trade allowance', exact: true });
    expect((await pageBox(trade)).bottom).toBeLessThanOrEqual(page.viewportSize().height - navHeight);
    await details.click();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('.result-totals').getByText('Amount financed')).toBeVisible();
    await expect(card.getByText('View itemized deal breakdown')).toBeVisible();
    await details.click();
    await expect(card.locator('.result-totals').getByText('Amount financed')).toBeHidden();
  });

  for (const width of [390, 320]) {
    test(`the Set payment target label fits inside its button at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await enterPrice(page);
      const button = page.locator('.mobile-results .payment-edit-button');
      await expect(button).toBeVisible();
      const fit = await button.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { textLeft: text.left, textRight: text.right, left: box.left, right: box.right, height: box.height, scroll: element.scrollWidth, client: element.clientWidth };
      });
      expect(fit.textLeft).toBeGreaterThanOrEqual(fit.left);
      expect(fit.textRight).toBeLessThanOrEqual(fit.right);
      expect(fit.scroll).toBeLessThanOrEqual(fit.client);
      expect(fit.height).toBeGreaterThanOrEqual(44);
      // At 320px the Review label wraps to two lines by design, so that width keeps the looser budget.
      expect((await pageBox(page.locator('.mobile-results'))).height).toBeLessThanOrEqual(width >= 360 ? 160 : 170);
    });
  }

  for (const width of [320, 360, 390]) {
    test(`the Review customer estimate label fits inside its button at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await enterPrice(page);
      const button = page.locator('.mobile-results').getByRole('button', { name: 'Review customer estimate', exact: true });
      await expect(button).toBeVisible();
      const fit = await button.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const arrow = element.querySelector('svg').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { textLeft: text.left, textRight: text.right, arrowRight: arrow.right, left: box.left, right: box.right, height: box.height, scroll: element.scrollWidth, client: element.clientWidth };
      });
      expect(fit.textLeft).toBeGreaterThanOrEqual(fit.left);
      expect(fit.textRight).toBeLessThanOrEqual(fit.right);
      expect(fit.arrowRight).toBeLessThanOrEqual(fit.right);
      expect(fit.scroll).toBeLessThanOrEqual(fit.client);
      expect(fit.height).toBeGreaterThanOrEqual(44);
      if (width >= 360) expect(fit.height).toBeLessThanOrEqual(52);
    });
  }

  test('warnings stay visible while the card is slim', async ({ page }) => {
    await enterPrice(page);
    await page.getByRole('button', { name: 'New plate', exact: true }).click();
    const warning = page.locator('.mobile-results .result-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('New plate cost has not been entered');
  });

  test('a cash deal shows its cash line and keeps totals behind Details', async ({ page }) => {
    await enterPrice(page);
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    const card = page.locator('.mobile-results');
    await expect(card.locator('.results-payment h2')).toContainText(/cash/i);
    await expect(card.locator('.result-totals').getByText('Out-the-door total')).toBeHidden();
    await card.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(card.locator('.result-totals').getByText('Out-the-door total')).toBeVisible();
  });
});

test('desktop keeps the full heading and start card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop layout only.');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Build the deal. See the payment.' })).toBeVisible();
  expect((await page.locator('#worksheet-heading').boundingBox()).height).toBeGreaterThan(20);
  await expect(page.locator('.desktop-results').getByRole('button', { name: 'Enter selling price', exact: true })).toBeVisible();
});

// Compact mode: main.jsx decides it once at load from window.innerHeight, the height the browser
// leaves visible, so these tests drive it with the viewport. The phone viewports below are what
// common phones show inside their browser, after the status bar, address bar and toolbars.
const tradeAndBar = async page => {
  const trade = page.getByRole('textbox', { name: 'Trade allowance', exact: true });
  await expect(trade).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const tradeBox = await pageBox(trade);
  const barTop = (await page.locator('.mobile-nav').boundingBox()).y;
  return { tradeBottom: tradeBox.bottom, barTop };
};
const primaryHeights = page => page.evaluate(() => {
  const buttons = [
    ...document.querySelectorAll('.view-toggle button, .header-actions button'),
    ...[...document.querySelectorAll('.mobile-results button')].filter(button => /Details|Review customer estimate/.test(button.textContent)),
  ];
  return buttons.map(button => Math.round(button.getBoundingClientRect().height));
});
const tradeLift = async page => {
  // How much higher compact mode puts Trade allowance than the regular layout at the same size.
  const compact = (await tradeAndBar(page)).tradeBottom;
  await page.evaluate(() => document.documentElement.classList.remove('compact-height'));
  const regular = (await pageBox(page.getByRole('textbox', { name: 'Trade allowance', exact: true }))).bottom;
  await page.evaluate(() => document.documentElement.classList.add('compact-height'));
  return regular - compact;
};

for (const [label, width, height, tradeOnFirstScreen] of [
  ['iPhone SE in Safari', 375, 553, false],
  ['iPhone 14 in Safari', 390, 664, true],
  ['Galaxy S23 in Chrome', 360, 668, true],
  ['Pixel 7 in Chrome', 412, 740, true],
]) {
  test.describe(`compact phone worksheet: ${label} (${width}x${height} visible)`, () => {
    test.use({ viewport: { width, height } });
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
      await page.goto('/');
      await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toBeVisible();
    });

    test('compact mode tightens the worksheet and keeps 44px primary controls', async ({ page }) => {
      await expect(page.locator('html')).toHaveClass(/compact-height/);
      await expect(page.locator('.quick-jump-nav')).toBeHidden();
      const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
      expect((await pageBox(price)).bottom).toBeLessThanOrEqual(height);
      await enterPrice(page);
      await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
      for (const h of await primaryHeights(page)) expect(h).toBeGreaterThanOrEqual(44);
      expect((await pageBox(page.locator('.app-header'))).height).toBeLessThanOrEqual(64);
      expect((await pageBox(page.locator('.mobile-results'))).height).toBeLessThanOrEqual(145);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // Cash down (the next field after the price) is above the bottom bar on every phone listed.
      const cash = await pageBox(page.getByRole('textbox', { name: 'Cash down', exact: true }));
      const barTop = (await page.locator('.mobile-nav').boundingBox()).y;
      if (height >= 600) expect(cash.bottom).toBeLessThanOrEqual(barTop);
    });

    test(`after a price, Trade allowance ${tradeOnFirstScreen ? 'is above the bottom bar' : 'sits at least 130px higher than the regular layout'}`, async ({ page }) => {
      await enterPrice(page);
      await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
      const { tradeBottom, barTop } = await tradeAndBar(page);
      if (tradeOnFirstScreen) expect(tradeBottom).toBeLessThanOrEqual(barTop);
      expect(await tradeLift(page)).toBeGreaterThanOrEqual(130);
    });
  });
}

// The decision follows the visible height, not the device screen: an iPhone 14 screen is 844px tall,
// but Safari leaves about 664px visible, where the regular layout puts Trade allowance under the bar.
// (The page fixture's window.screen follows the viewport, so this builds its own context.)
test('a tall phone screen with a short browser viewport goes compact', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(REFERENCE_TIME);
    await page.goto('/');
    expect(await page.evaluate(() => [window.screen.height, window.innerHeight])).toEqual([844, 664]);
    await expect(page.locator('html')).toHaveClass(/compact-height/);
    await enterPrice(page);
    await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
    const { tradeBottom, barTop } = await tradeAndBar(page);
    expect(tradeBottom).toBeLessThanOrEqual(barTop);
  } finally {
    await context.close();
  }
});

// A phone that shows 804px or more (for example an installed, full-screen app on a tall phone)
// already fits Trade allowance in the regular layout, so it keeps the shortcut row.
test.describe('regular phone worksheet (390x844 visible)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('keeps the shortcut row and the 70px header, and Trade allowance fits', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.goto('/');
    await enterPrice(page);
    await expect(page.locator('html')).not.toHaveClass(/compact-height/);
    await expect(page.locator('.quick-jump-nav')).toBeVisible();
    expect(Math.abs((await pageBox(page.locator('.app-header'))).height - 70)).toBeLessThanOrEqual(2);
    const { tradeBottom, barTop } = await tradeAndBar(page);
    expect(tradeBottom).toBeLessThanOrEqual(barTop - 6);
  });
});

// The decision is made once at load, so a keyboard shrinking the viewport (or a toolbar collapsing)
// never switches layouts while someone is typing.
test.describe('compact decision is fixed after load', () => {
  test('a regular layout stays regular when the viewport shrinks', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/compact-height/);
    await page.setViewportSize({ width: 390, height: 500 });
    await enterPrice(page);
    await expect(page.locator('html')).not.toHaveClass(/compact-height/);
    await expect(page.locator('.quick-jump-nav')).toBeVisible();
  });

  test('a compact layout stays compact when the viewport grows', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/compact-height/);
    await page.setViewportSize({ width: 390, height: 844 });
    await enterPrice(page);
    await expect(page.locator('html')).toHaveClass(/compact-height/);
    await expect(page.locator('.quick-jump-nav')).toBeHidden();
  });
});
