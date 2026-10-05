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
      expect((await pageBox(page.locator('.mobile-results'))).height).toBeLessThanOrEqual(170);
    });
  }

  for (const width of [360, 390]) {
    test(`the Review customer estimate label stays on one line at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await enterPrice(page);
      const review = page.locator('.mobile-results').getByRole('button', { name: 'Review customer estimate', exact: true });
      expect((await pageBox(review)).height).toBeLessThanOrEqual(52);
      expect((await pageBox(review)).height).toBeGreaterThanOrEqual(44);
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
