import { test, expect } from '@playwright/test';

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

// Short phones: compact mode is keyed to the device screen (not the viewport), so Playwright's
// `screen` option is what decides it; `viewport` is only the layout size.
const tradeAndBar = async page => {
  const trade = page.getByRole('textbox', { name: 'Trade allowance', exact: true });
  const bar = page.locator('.mobile-nav');
  await expect(trade).toBeVisible();
  const tradeBox = await pageBox(trade);
  const barTop = (await bar.boundingBox()).y;
  return { tradeBottom: tradeBox.bottom, barTop };
};

test.describe('short phone worksheet (375x667)', () => {
  test.use({ viewport: { width: 375, height: 667 }, screen: { width: 375, height: 667 } });
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Selling price', exact: true })).toBeVisible();
  });

  test('Selling price is fully visible before a price is entered', async ({ page }) => {
    const price = page.getByRole('textbox', { name: 'Selling price', exact: true });
    await expect(price).toBeVisible();
    expect((await pageBox(price)).bottom).toBeLessThanOrEqual(page.viewportSize().height);
  });

  test('after a price, Trade allowance sits fully above the bottom bar at the top of the page', async ({ page }) => {
    await enterPrice(page);
    await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('html')).toHaveClass(/compact-height/);
    const { tradeBottom, barTop } = await tradeAndBar(page);
    expect(tradeBottom).toBeLessThanOrEqual(barTop - 6);
    await expect(page.locator('.quick-jump-nav')).toBeHidden();
    expect((await pageBox(page.locator('.app-header'))).height).toBeLessThanOrEqual(60);
    const card = page.locator('.mobile-results');
    expect((await pageBox(card)).height).toBeLessThanOrEqual(140);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(card.getByRole('button', { name: 'Details', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Review customer estimate', exact: true })).toBeVisible();
  });
});

test.describe('short phone worksheet (412x732)', () => {
  test.use({ viewport: { width: 412, height: 732 }, screen: { width: 412, height: 732 } });
  test('Trade allowance is on the first screen after a price', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.goto('/');
    await enterPrice(page);
    await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
    const { tradeBottom, barTop } = await tradeAndBar(page);
    expect(tradeBottom).toBeLessThanOrEqual(barTop - 6);
  });
});

test.describe('keyboard-shrunk viewport on a regular phone screen', () => {
  test('compact mode stays off and the shortcut row stays', async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    // The test-level `screen` option is ignored for the page fixture here (window.screen follows the
    // viewport), so build the context directly: a 390x844 screen whose viewport the keyboard shrank to 500.
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 500 }, screen: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto('/');
      expect(await page.evaluate(() => [window.screen.height, window.innerHeight])).toEqual([844, 500]);
      await enterPrice(page);
      await expect(page.locator('.mobile-results .payment-number strong')).toHaveText('$540.67');
      await expect(page.locator('html')).not.toHaveClass(/compact-height/);
      await expect(page.locator('.quick-jump-nav')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe('regular phone worksheet (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } });
  test('keeps the shortcut row and the 70px header', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
    await page.goto('/');
    await enterPrice(page);
    await expect(page.locator('html')).not.toHaveClass(/compact-height/);
    await expect(page.locator('.quick-jump-nav')).toBeVisible();
    expect(Math.abs((await pageBox(page.locator('.app-header'))).height - 70)).toBeLessThanOrEqual(2);
  });
});
