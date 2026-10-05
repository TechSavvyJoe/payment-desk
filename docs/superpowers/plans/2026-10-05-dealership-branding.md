# Optional Dealership Name and Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any dealership optionally save its name and logo on a device. They show in the header, on the customer estimate, the printout and the copied or shared summary, with a small "PAYMENT DESK" credit. With nothing saved, the app is unchanged.

**Architecture:** A pure `brandSettings` module owns the saved record (normalize, load, save, clear, resolve), with storage injected for unit tests. A browser-only `logoImage` module turns an uploaded file into a resized PNG data URL. `App` holds the settings in state and passes a resolved `brand` to the header and the customer view. The proposal snapshot carries `brand` so the estimate card, printout and copied text all read one frozen value. A native `<dialog>` edits a draft and saves through `App`.

**Tech Stack:** React 19 + Vite 8, plain CSS (`src/redesign.css`, `src/customer-print.css`), `node --test` unit tests, Playwright e2e with `@axe-core/playwright` and `pdf-lib`.

**Spec:** `docs/superpowers/specs/2026-10-05-dealership-branding-design.md`

## Global Constraints

- Storage key `payment-desk.dealership.v1`; stored JSON `{ "name": string, "logo": string | null }`.
- Dealership name: optional, whitespace collapsed and trimmed, at most **60** characters (`MAX_DEALERSHIP_NAME_LENGTH = 60`).
- Logo stored only as a PNG data URL matching `^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$`, at most **1,500,000** characters (`MAX_LOGO_DATA_URL_LENGTH`).
- Logo upload: PNG, JPEG, WebP, GIF or SVG; input at most **10 MB**; output fits within **600 × 200 px** and is never upscaled; exported as PNG.
- Default identity text "Payment Desk"; header wordmark and credit text "PAYMENT DESK".
- Customer figures are never stored. Reset deal and the error-boundary reset never clear dealership settings.
- No new npm dependencies. No change to `public/_headers` (CSP already allows `img-src 'self' data: blob:`).
- The browser tab title and install manifest stay "Payment Desk".
- Match each file's existing quote style and idiom (`src/lib/*` and most components use double quotes; `App.jsx` and `CustomerPrintout.jsx` use single quotes).
- Unit tests: `node --test tests/<file>.test.js` (all: `npm test`). Lint: `npm run lint`.
- **E2E on this machine:** port 4173 is held by an unrelated local project, and the repo config reuses any server already listening there. Always run `npm run build` first, then:
  `npx playwright test --config /private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-bob-maxey-payment-desk/b716654b-d6fc-4fbb-8af4-2a1347df0ede/scratchpad/playwright.alt.config.mjs <spec file>`
  (serves `dist` on port 4317; same projects: chromium, mobile at 390px, webkit).
- Work on branch `remove-bob-maxey-branding`. Commit after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push until the final section.

## Review Focus

1. **A 60-character unbroken name** (no spaces) must truncate in the header and wrap in the printed masthead, never overflowing or covering the date. Tests: Task 3 (header at 375px), Task 4 (print masthead).
2. **Extreme logo shapes** (very tall, very wide, tiny) must fit 600×200 without enlarging, and the header must keep its height. Tests: Task 5 (`fitWithin` unit cases, plus e2e uploads of 100×1000 and 16×16).
3. **Special characters in the name** (`&`, `'`, `<`, emoji) must display literally everywhere, and the 60-character cut must not split an emoji. Tests: Task 1 (emoji cut), Task 4 (literal name in card, copied text, share title and printout).
4. **The settings dialog on a phone** must fit the screen, use at least 16px inputs (no iOS zoom), and keep the file picker reachable by keyboard. Test: Task 5.
5. **Browser storage blocked or full** (reading or writing throws) must still load with "Payment Desk", and a failed save shows the warning while the dealership applies for this visit. Tests: Task 1 (unit), Task 3 (read throws), Task 5 (write throws).

---

### Task 1: Saved dealership settings module

**Files:**
- Create: `src/lib/brandSettings.js`
- Test: `tests/brandSettings.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2–5):
  - `BRAND_STORAGE_KEY = "payment-desk.dealership.v1"`, `DEFAULT_BRAND_NAME = "Payment Desk"`, `MAX_DEALERSHIP_NAME_LENGTH = 60`, `MAX_LOGO_DATA_URL_LENGTH = 1_500_000`
  - `normalizeBrandSettings(value) → { name: string, logo: string | null }`
  - `loadBrandSettings(storage?) → { name, logo }` (never throws)
  - `saveBrandSettings(settings, storage?) → { ok: true, settings } | { ok: false, reason: "unavailable" | "quota", settings }` (never throws; `settings` is the normalized record to apply)
  - `clearBrandSettings(storage?) → same shape as saveBrandSettings, with empty settings`
  - `resolveBrand(settings?) → { dealershipName: string, logo: string | null, isCustom: boolean, displayName: string }`
  - `storage` defaults to `window.localStorage`, read inside try/catch; it is `null` when unavailable (including in Node).

- [ ] **Step 1: Write the failing tests**

Create `tests/brandSettings.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_STORAGE_KEY, DEFAULT_BRAND_NAME, MAX_DEALERSHIP_NAME_LENGTH, MAX_LOGO_DATA_URL_LENGTH,
  clearBrandSettings, loadBrandSettings, normalizeBrandSettings, resolveBrand, saveBrandSettings,
} from "../src/lib/brandSettings.js";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
};
const throwingStorage = (name) => ({
  getItem() { throw new DOMException("blocked", name); },
  setItem() { throw new DOMException("blocked", name); },
  removeItem() { throw new DOMException("blocked", name); },
});

test("names are collapsed, trimmed, and cut to 60 characters without splitting emoji", () => {
  assert.equal(normalizeBrandSettings({ name: "  Lakeside \n  Motors\t" }).name, "Lakeside Motors");
  assert.equal(normalizeBrandSettings({ name: "W".repeat(80) }).name, "W".repeat(MAX_DEALERSHIP_NAME_LENGTH));
  const emojiName = "A".repeat(59) + "🚗🚗";
  assert.equal(normalizeBrandSettings({ name: emojiName }).name, "A".repeat(59) + "🚗");
  assert.equal(normalizeBrandSettings({ name: "   " }).name, "");
  assert.equal(normalizeBrandSettings({ name: 42 }).name, "");
});

test("only PNG data URLs within the size limit are accepted as logos", () => {
  assert.equal(normalizeBrandSettings({ logo: LOGO }).logo, LOGO);
  for (const logo of [
    "data:image/jpeg;base64,/9j/4AAQ",
    "javascript:alert(1)",
    "https://example.test/logo.png",
    "data:image/png;base64,<script>",
    "data:image/png;base64," + "A".repeat(MAX_LOGO_DATA_URL_LENGTH),
    42,
  ]) assert.equal(normalizeBrandSettings({ logo }).logo, null, String(logo).slice(0, 40));
});

test("non-object settings normalize to the empty record", () => {
  for (const value of [undefined, null, "Lakeside", 7, true]) {
    assert.deepEqual(normalizeBrandSettings(value), { name: "", logo: null });
  }
});

test("loading never throws and ignores missing, damaged, or blocked storage", () => {
  assert.deepEqual(loadBrandSettings(memoryStorage()), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(memoryStorage({ [BRAND_STORAGE_KEY]: '{"name": "Broken' })), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(throwingStorage("SecurityError")), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(null), { name: "", logo: null });
  assert.deepEqual(loadBrandSettings(), { name: "", logo: null }, "Node has no window.localStorage");
  const saved = memoryStorage({ [BRAND_STORAGE_KEY]: JSON.stringify({ name: " Lakeside Motors ", logo: LOGO, extra: true }) });
  assert.deepEqual(loadBrandSettings(saved), { name: "Lakeside Motors", logo: LOGO });
});

test("saving stores the normalized record and an empty record removes the key", () => {
  const storage = memoryStorage();
  assert.deepEqual(saveBrandSettings({ name: "  Lakeside  Motors ", logo: LOGO }, storage), { ok: true, settings: { name: "Lakeside Motors", logo: LOGO } });
  assert.equal(storage.data.get(BRAND_STORAGE_KEY), JSON.stringify({ name: "Lakeside Motors", logo: LOGO }));
  assert.deepEqual(saveBrandSettings({ name: "   ", logo: "javascript:alert(1)" }, storage), { ok: true, settings: { name: "", logo: null } });
  assert.equal(storage.data.has(BRAND_STORAGE_KEY), false);
});

test("saving reports quota and unavailable storage instead of throwing", () => {
  assert.deepEqual(saveBrandSettings({ name: "Lakeside" }, throwingStorage("QuotaExceededError")), { ok: false, reason: "quota", settings: { name: "Lakeside", logo: null } });
  assert.deepEqual(saveBrandSettings({ name: "Lakeside" }, throwingStorage("SecurityError")), { ok: false, reason: "unavailable", settings: { name: "Lakeside", logo: null } });
  assert.deepEqual(saveBrandSettings({ name: "Lakeside" }, null), { ok: false, reason: "unavailable", settings: { name: "Lakeside", logo: null } });
});

test("clearing removes the saved dealership", () => {
  const storage = memoryStorage({ [BRAND_STORAGE_KEY]: JSON.stringify({ name: "Lakeside", logo: null }) });
  assert.deepEqual(clearBrandSettings(storage), { ok: true, settings: { name: "", logo: null } });
  assert.equal(storage.data.has(BRAND_STORAGE_KEY), false);
  assert.equal(clearBrandSettings(throwingStorage("SecurityError")).ok, false);
});

test("resolveBrand falls back to Payment Desk and marks any saved name or logo as custom", () => {
  assert.deepEqual(resolveBrand(), { dealershipName: "", logo: null, isCustom: false, displayName: DEFAULT_BRAND_NAME });
  assert.deepEqual(resolveBrand({ name: "Lakeside Motors" }), { dealershipName: "Lakeside Motors", logo: null, isCustom: true, displayName: "Lakeside Motors" });
  assert.deepEqual(resolveBrand({ logo: LOGO }), { dealershipName: "", logo: LOGO, isCustom: true, displayName: "Payment Desk" });
  assert.deepEqual(resolveBrand({ name: "   ", logo: "javascript:alert(1)" }), { dealershipName: "", logo: null, isCustom: false, displayName: "Payment Desk" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/brandSettings.test.js`
Expected: FAIL. The module `../src/lib/brandSettings.js` can't be found.

- [ ] **Step 3: Implement the module**

Create `src/lib/brandSettings.js`:

```js
// The optional dealership name and logo are the only things Payment Desk saves,
// and only in this browser. Customer figures are never stored.
export const BRAND_STORAGE_KEY = "payment-desk.dealership.v1";
export const DEFAULT_BRAND_NAME = "Payment Desk";
export const MAX_DEALERSHIP_NAME_LENGTH = 60;
export const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const empty = () => ({ name: "", logo: null });

// Safari private mode and blocked site data throw on access, not only on write.
function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isQuotaError = (error) => error?.name === "QuotaExceededError"
  || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
  || error?.code === 22
  || error?.code === 1014;

export function normalizeBrandSettings(value) {
  if (!value || typeof value !== "object") return empty();
  const collapsed = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
  // Cut by code point so an emoji at the limit is never split in half.
  const name = [...collapsed].slice(0, MAX_DEALERSHIP_NAME_LENGTH).join("").trim();
  const logo = typeof value.logo === "string"
    && value.logo.length <= MAX_LOGO_DATA_URL_LENGTH
    && PNG_DATA_URL.test(value.logo) ? value.logo : null;
  return { name, logo };
}

export function loadBrandSettings(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(BRAND_STORAGE_KEY);
    return raw ? normalizeBrandSettings(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

export function saveBrandSettings(settings, storage = defaultStorage()) {
  const normalized = normalizeBrandSettings(settings);
  if (!storage) return { ok: false, reason: "unavailable", settings: normalized };
  try {
    if (!normalized.name && !normalized.logo) storage.removeItem(BRAND_STORAGE_KEY);
    else storage.setItem(BRAND_STORAGE_KEY, JSON.stringify(normalized));
    return { ok: true, settings: normalized };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable", settings: normalized };
  }
}

export function clearBrandSettings(storage = defaultStorage()) {
  return saveBrandSettings(empty(), storage);
}

export function resolveBrand(settings) {
  const { name, logo } = normalizeBrandSettings(settings);
  return { dealershipName: name, logo, isCustom: Boolean(name || logo), displayName: name || DEFAULT_BRAND_NAME };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/brandSettings.test.js && npm run lint`
Expected: all tests pass and lint is clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brandSettings.js tests/brandSettings.test.js
git commit -m "Add saved dealership settings module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Brand in the proposal snapshot

**Files:**
- Modify: `src/lib/proposal.js` (imports; `createProposalSnapshot` signature near line 118; `snapshot.brand` near line 150; `formatProposalText` first line near line 170)
- Modify: `src/components/CustomerView.jsx` (share title near line 50, identity line near line 69, footer meta near line 132)
- Modify: `src/components/CustomerPrintout.jsx` (masthead near line 72)
- Test: `tests/proposal.test.js`

**Interfaces:**
- Consumes: `resolveBrand` from Task 1.
- Produces: `createProposalSnapshot({ …, brand })`, where `brand` is a `resolveBrand(...)` result and defaults to `resolveBrand()`. `snapshot.brand` is a frozen `{ name: string, dealershipName: string, logo: string | null, isCustom: boolean }`, where `name` is the display name. `formatProposalText` starts with `snapshot.brand.name`.

- [ ] **Step 1: Write the failing test**

In `tests/proposal.test.js`, add to the imports:

```js
import { resolveBrand } from "../src/lib/brandSettings.js";
```

Append this test:

```js
test("estimate identity defaults to Payment Desk and uses a saved dealership", () => {
  const plain = create();
  assert.deepEqual({ ...plain.brand }, { name: "Payment Desk", dealershipName: "", logo: null, isCustom: false });
  assert.equal(formatProposalText(plain).split("\n")[0], "Payment Desk");

  const named = create({}, { brand: resolveBrand({ name: "Lakeside Motors" }) });
  assert.equal(named.brand.name, "Lakeside Motors");
  assert.equal(named.brand.isCustom, true);
  assert.equal(formatProposalText(named).split("\n")[0], "Lakeside Motors");
  assert.equal(named.reference, plain.reference, "branding does not change the deal reference");
  assert.ok(Object.isFrozen(named.brand));

  const logo = "data:image/png;base64,iVBORw0KGgo=";
  const logoOnly = create({}, { brand: resolveBrand({ logo }) });
  assert.deepEqual({ ...logoOnly.brand }, { name: "Payment Desk", dealershipName: "", logo, isCustom: true });
  assert.equal(formatProposalText(logoOnly).split("\n")[0], "Payment Desk");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/proposal.test.js`
Expected: FAIL in the new test, because `plain.brand` is the string `"Payment Desk"` and not an object.

- [ ] **Step 3: Implement the snapshot change**

In `src/lib/proposal.js`, add after the existing imports:

```js
import { resolveBrand } from "./brandSettings.js";
```

Change the signature:

```js
export function createProposalSnapshot({ dealInput = {}, result, createdAt = new Date().toISOString(), version = "development", policy = result.policy, hasInputErrors = false, gridRates = {}, brand = resolveBrand() }) {
```

Replace `brand: "Payment Desk",` in the snapshot literal with:

```js
    brand: { name: brand.displayName, dealershipName: brand.dealershipName, logo: brand.logo, isCustom: brand.isCustom },
```

In `formatProposalText`, change the first element of `lines` from `snapshot.brand` to `snapshot.brand.name`:

```js
  const lines = [snapshot.brand.name, snapshot.title, `Reference: ${snapshot.reference}`, `Created: ${snapshot.createdLabel} (Eastern time)`, `App version: ${snapshot.version}`];
```

In `src/components/CustomerView.jsx`, replace the three `snapshot.brand` reads with `snapshot.brand.name`:

```jsx
      await navigator.share({ title: snapshot.brand.name + " — " + snapshot.title, text: summaryText() });
```
```jsx
          <p className="proposal-brand">{snapshot.brand.name}</p>
```
```jsx
          <p className="proposal-meta">{snapshot.brand.name} · {snapshot.reference} · App {snapshot.version}</p>
```

In `src/components/CustomerPrintout.jsx`, replace `<strong>{snapshot.brand}</strong>` with:

```jsx
<strong>{snapshot.brand.name}</strong>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run lint`
Expected: all unit tests pass (existing proposal tests included) and lint is clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/proposal.js src/components/CustomerView.jsx src/components/CustomerPrintout.jsx tests/proposal.test.js
git commit -m "Carry the resolved brand in proposal snapshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Load the saved dealership and show it in the header

**Files:**
- Modify: `src/App.jsx` (imports; state after the `useReducer` line; `<ViewToggle>` and `<CustomerView>` props)
- Modify: `src/components/ViewToggle.jsx` (brand lockup)
- Modify: `src/components/CustomerView.jsx` (accept `brand`, pass it to the snapshot)
- Modify: `src/redesign.css` (lockup rules after the `.brand strong` block near line 152; responsive block at end of file)
- Create: `tests/e2e/dealership.spec.js`

**Interfaces:**
- Consumes: `loadBrandSettings`, `resolveBrand`, `BRAND_STORAGE_KEY` (Task 1); `createProposalSnapshot({ brand })` (Task 2).
- Produces: `ViewToggle({ view, onViewChange, onReset, brand })`; `CustomerView({ …, brand })`. CSS classes `brand--custom`, `brand--has-logo`, `brand__chip`, `brand__logo`, `brand__text`, `brand__name`, `brand__credit` (Task 5 reuses `brand__chip` and `brand__logo` in its preview). The e2e helpers `STORAGE_KEY`, `LOGO` and `seedBrand` sit at the top of `tests/e2e/dealership.spec.js` (Tasks 4 and 5 append to this file).

- [ ] **Step 1: Write the failing e2e tests**

Create `tests/e2e/dealership.spec.js`:

```js
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'payment-desk.dealership.v1';
// 120×40 PNG: a red block and a navy bar on a transparent background.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAABDklEQVR4AezRMQ7CQAxE0ZCOjpNwIc7HXbgRZZC2RDK2033zI2Ub70rjefvrdj/84w42+LfD8xs/aUDgpCD6WGC6YJJf4KQg+lhgumCSX+CkIPpYYLpgkv9fgZNaCuPr49gAv8AFS/IVgcl6hewCF0oiXxGYrFfILnChJPIVgcl6hewCF0oiXxGYrFfI/gVceOEVVAMCo7j6YQXud4Z6ITCKqx9W4H5nqBcCo7j6YQXud4Z6ITCKqx9W4NXZ3EPgubZrM4FXDXMPgefars0EXjXMPQSea7s2E3jVMPcQ+Kzt+3nZAL/AZ4Eh734DQ5YwZtyAwHE3IyYCj2CMlxA47mbEROARjPESAsfdjJh8AAAA//9I3+EKAAAABklEQVQDALXOD8gV2DjBAAAAAElFTkSuQmCC';

// Seed once per tab so reload tests see what the app itself saved or cleared.
const seedBrand = (page, value) => page.addInitScript(([key, raw]) => {
  if (sessionStorage.getItem('test-brand-seeded')) return;
  localStorage.setItem(key, raw);
  sessionStorage.setItem('test-brand-seeded', '1');
}, [STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value)]);

test.describe('dealership header', () => {
  test('default header is unchanged when no dealership is saved', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    await expect(page.locator('.brand__credit')).toHaveCount(0);
  });

  test('a saved dealership shows its logo and name with a Payment Desk credit', async ({ page }) => {
    await seedBrand(page, { name: 'Lakeside Motors', logo: LOGO });
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' });
    await expect(home.locator('.brand__credit')).toHaveText('PAYMENT DESK');
    await expect(home.locator('img.brand__logo')).toHaveAttribute('src', LOGO);
    const name = home.locator('.brand__name');
    await expect(name).toHaveText('Lakeside Motors');
    // Phones (≤440px) show the logo chip without the name text.
    if (page.viewportSize().width <= 440) await expect(name).toBeHidden();
    else await expect(name).toBeVisible();
  });

  test('a name-only dealership shows the name above the credit', async ({ page }) => {
    await seedBrand(page, { name: 'Lakeside Motors' });
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' });
    await expect(home.locator('.brand__name')).toBeVisible();
    await expect(home.locator('.brand__credit')).toBeVisible();
    await expect(home.locator('img')).toHaveCount(0);
  });

  for (const [label, value] of [
    ['default wordmark', null],
    ['60-character unbroken name with a logo', { name: 'W'.repeat(60), logo: LOGO }],
    ['long name only', { name: 'Superior Chevrolet Buick GMC of Southwest Michigan Lakeshore' }],
  ]) {
    test(`header fits a 375px phone: ${label}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      if (value) await seedBrand(page, value);
      await page.goto('/');
      await expect(page.locator('#worksheet-heading')).toBeVisible();
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        const brand = header.querySelector('.brand').getBoundingClientRect();
        const actions = header.querySelector('.header-actions').getBoundingClientRect();
        return {
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          headerOverflow: header.scrollWidth - header.clientWidth,
          brandPastActions: Math.round(brand.right - actions.left),
        };
      });
      expect(layout.pageOverflow).toBeLessThanOrEqual(0);
      expect(layout.headerOverflow).toBeLessThanOrEqual(0);
      expect(layout.brandPastActions).toBeLessThanOrEqual(0);
    });
  }

  test('Reset deal keeps the saved dealership', async ({ page }) => {
    await seedBrand(page, { name: 'Lakeside Motors' });
    await page.goto('/');
    await page.getByLabel('Selling price', { exact: true }).fill('30000');
    await page.getByLabel('Selling price', { exact: true }).blur();
    let confirmed = false;
    page.once('dialog', dialog => { confirmed = true; return dialog.accept(); });
    await page.getByRole('button', { name: 'Reset deal' }).click();
    await expect.poll(() => confirmed).toBe(true);
    await expect(page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' })).toBeVisible();
  });

  test('damaged or unreadable storage falls back to Payment Desk without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await seedBrand(page, '{"name": "Broken');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    });
    await page.reload();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    expect(errors).toEqual([]);
  });
});
```

Init scripts run in registration order in each new document. On reload, `seedBrand` runs first, sees its `sessionStorage` flag and returns before the second script replaces `Storage.prototype.getItem`. The app's own `loadBrandSettings` call then hits the throwing `getItem`, which is the path this test covers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx playwright test --config <alt config from Global Constraints> tests/e2e/dealership.spec.js`
Expected: the default test and the 375px default-wordmark test pass. The seeded-dealership tests FAIL because no `Lakeside Motors Payment Desk home` link exists.

- [ ] **Step 3: Wire the settings into App and CustomerView**

In `src/App.jsx`, add the import after the `release.js` import:

```js
import { loadBrandSettings, resolveBrand } from './lib/brandSettings.js';
```

After `const { deal: dealInput, view, mobileGridOpen, gridRates, gridDownPayments, lastRoll, resetCount } = state;` add:

```js
  const [brandSettings] = useState(loadBrandSettings);
  const brand = useMemo(() => resolveBrand(brandSettings), [brandSettings]);
```

Change the header element to:

```jsx
        <ViewToggle brand={brand} onReset={resetDeal} onViewChange={changeView} view={view} />
```

Change the customer view element to pass `brand`:

```jsx
            <CustomerView brand={brand} dealInput={dealInput} gridRates={gridRates} result={result} hasInputErrors={hasInputErrors} onEditDeal={() => changeView('dealer')} />
```

In `src/components/CustomerView.jsx`, change the signature and snapshot memo:

```jsx
export default function CustomerView({ dealInput, result, gridRates, hasInputErrors = false, onEditDeal, brand }) {
  const [createdAt] = useState(() => new Date().toISOString());
  const snapshot = useMemo(() => createProposalSnapshot({
    dealInput, result, gridRates, hasInputErrors, createdAt, brand, version: APP_VERSION + " (" + BUILD_ID + ")",
  }), [dealInput, result, gridRates, hasInputErrors, createdAt, brand]);
```

- [ ] **Step 4: Render the header lockup**

Replace the body of `src/components/ViewToggle.jsx` up to `<div className="header-actions">` so the file reads:

```jsx
import { SegmentedControl } from "./Fields.jsx";
import { ResetIcon } from "./Icons.jsx";

export default function ViewToggle({ view, onViewChange, onReset, brand }) {
  const custom = Boolean(brand?.isCustom);
  const homeLabel = brand?.dealershipName ? `${brand.dealershipName} Payment Desk home` : "Payment Desk home";
  const brandClass = ["brand", custom && "brand--custom", custom && brand.logo && "brand--has-logo"].filter(Boolean).join(" ");
  return (
    <header className="app-header">
      <a aria-label={homeLabel} className={brandClass} href="#worksheet-heading"
        onClick={(event) => { event.preventDefault(); onViewChange("dealer"); }}>
        {custom ? (
          <>
            {brand.logo ? <span className="brand__chip"><img alt="" className="brand__logo" src={brand.logo} /></span> : null}
            <span className="brand__text">
              {brand.dealershipName ? <strong className="brand__name">{brand.dealershipName}</strong> : null}
              <span className="brand__credit">PAYMENT DESK</span>
            </span>
          </>
        ) : <strong>PAYMENT DESK</strong>}
      </a>
      <div className="header-actions">
```

Leave the rest of the file (segmented control, reset button, closing tags) unchanged.

- [ ] **Step 5: Add the lockup CSS**

In `src/redesign.css`, insert directly after the `.brand strong { … }` block (before `.header-actions {`):

```css
.brand--custom {
  gap: 10px;
  min-width: 0;
}

/* Logos sit on a white chip so dark artwork stays visible on the navy header. */
.brand__chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 4px 8px;
  border-radius: 7px;
  background: #ffffff;
  box-sizing: border-box;
}

.brand__logo {
  display: block;
  max-width: 150px;
  max-height: 32px;
  object-fit: contain;
}

.brand__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.brand .brand__name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.02em;
}

.brand__credit {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #d6ddff;
}
```

Append to the end of `src/redesign.css`:

```css
/* Dealership lockup on tablets and phones. */
@media (max-width: 800px) {
  .brand__chip { height: 34px; padding: 3px 6px; }
  .brand__logo { max-width: 120px; max-height: 26px; }
  .brand .brand__name { max-width: 200px; font-size: 0.9rem; }
}

/* At 375px the header leaves about 90px for the brand beside the view toggle and
   two header buttons, so tighten spacing and show the logo chip without the name. */
@media (max-width: 440px) {
  .app-header { gap: 8px; }
  .header-actions { gap: 4px; }
  .header-actions .reset-button { width: 38px; }
  .brand { min-width: 0; overflow: hidden; }
  .brand > strong { font-size: 0.72rem; letter-spacing: 0.03em; }
  .brand--custom { flex-direction: column; align-items: flex-start; gap: 2px; }
  .brand__chip { height: 26px; padding: 3px 5px; border-radius: 5px; }
  .brand__logo { max-width: 90px; max-height: 20px; }
  .brand .brand__name { max-width: 100%; font-size: 0.72rem; }
  .brand--has-logo .brand__name { display: none; }
  .brand__credit { font-size: 0.5rem; letter-spacing: 0.14em; }
}
```

(`.brand .brand__name` is two classes on purpose: it must beat the existing `.brand strong` rules. `.header-actions .reset-button` keeps the error screen's text button full width.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && npx playwright test --config <alt config> tests/e2e/dealership.spec.js && npm run lint && npm test`
Expected: all `dealership header` tests pass in chromium, mobile and webkit; lint and unit tests are clean.

- [ ] **Step 7: Run the existing e2e suite for regressions**

Run: `npx playwright test --config <alt config>`
Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/ViewToggle.jsx src/components/CustomerView.jsx src/redesign.css tests/e2e/dealership.spec.js
git commit -m "Show a saved dealership name and logo in the header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dealership on the customer estimate and printout

**Files:**
- Modify: `src/components/CustomerView.jsx` (identity header near line 68)
- Modify: `src/components/CustomerPrintout.jsx` (top of component body near line 50; masthead near line 72)
- Modify: `src/redesign.css` (`.proposal-brand` rule near line 2344)
- Modify: `src/customer-print.css` (masthead rules, lines 8–12)
- Test: append to `tests/e2e/dealership.spec.js`

**Interfaces:**
- Consumes: `snapshot.brand = { name, dealershipName, logo, isCustom }` (Task 2); `brand` prop wiring (Task 3); the `LOGO` and `seedBrand` helpers (Task 3).
- Produces: CSS classes `proposal-logo` and `print-brand__logo`.

- [ ] **Step 1: Write the failing e2e tests**

Add `import { PDFDocument } from 'pdf-lib';` below the existing import in `tests/e2e/dealership.spec.js`, then append:

```js
test.describe('dealership on customer estimates', () => {
  const NAME = "Lakeside Motors & Sons' <Fleet> 🚗";
  const openEstimate = async page => {
    await page.goto('/');
    await page.locator('details.deal-details > summary').click();
    await page.getByLabel('Estimate date', { exact: true }).fill('09/24/26');
    await page.locator('details.deal-details > summary').click();
    await page.getByLabel('Selling price', { exact: true }).fill('30000');
    await page.getByLabel('Selling price', { exact: true }).blur();
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
  };
  const copySummary = async page => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedEstimate = text; } } }));
    await page.getByRole('button', { name: 'Copy summary' }).click();
    await expect(page.getByRole('status')).toContainText('copied');
    return page.evaluate(() => window.testCopiedEstimate);
  };

  test('estimate card, copied text, share title, and printout use the dealership literally', async ({ page }, testInfo) => {
    await seedBrand(page, { name: NAME, logo: LOGO });
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.testSharedEstimate = data; } }));
    await openEstimate(page);
    const identity = page.locator('.proposal-identity');
    await expect(identity.locator('img.proposal-logo')).toHaveAttribute('src', LOGO);
    await expect(identity.locator('img.proposal-logo')).toHaveAttribute('alt', '');
    await expect(identity.locator('.proposal-brand')).toHaveText(NAME);
    await expect(page.locator('.proposal-qualification .proposal-meta')).toContainText(`${NAME} · PD-`);
    const copied = await copySummary(page);
    expect(copied.split('\n').slice(0, 2)).toEqual([NAME, 'Vehicle purchase estimate']);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.testSharedEstimate?.title)).toBe(`${NAME} — Vehicle purchase estimate`);
    await page.emulateMedia({ media: 'print' });
    const masthead = page.locator('.print-brand');
    await expect(masthead.locator('strong')).toHaveText(NAME);
    await expect(masthead.locator('span')).toHaveText('PAYMENT DESK');
    await expect(masthead.locator('img')).toHaveAttribute('src', LOGO);
    if (testInfo.project.name === 'chromium') {
      const pdf = await page.pdf({ printBackground: false, preferCSSPageSize: true });
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    }
  });

  test('a logo-only dealership keeps Payment Desk in the text and labels the logo', async ({ page }) => {
    await seedBrand(page, { logo: LOGO });
    await openEstimate(page);
    await expect(page.getByRole('img', { name: 'Dealership logo' })).toBeVisible();
    await expect(page.locator('.proposal-identity .proposal-brand')).toHaveCount(0);
    expect((await copySummary(page)).split('\n')[0]).toBe('Payment Desk');
    await expect(page.locator('.print-brand strong')).toHaveCount(0);
    await expect(page.locator('.print-brand span')).toHaveText('PAYMENT DESK');
  });

  test('without a dealership the estimate and printout keep the Payment Desk identity', async ({ page }) => {
    await openEstimate(page);
    await expect(page.locator('.proposal-identity .proposal-brand')).toHaveText('Payment Desk');
    await expect(page.locator('.proposal-identity img')).toHaveCount(0);
    await expect(page.locator('.print-brand img')).toHaveAttribute('src', './payment-desk-icon.svg');
    await expect(page.locator('.print-brand strong')).toHaveText('Payment Desk');
    await expect(page.locator('.print-brand span')).toHaveCount(0);
  });

  test('a 60-character unbroken name wraps inside the printed masthead', async ({ page }) => {
    await seedBrand(page, { name: 'W'.repeat(60), logo: LOGO });
    await openEstimate(page);
    await page.emulateMedia({ media: 'print' });
    const fits = await page.evaluate(() => {
      const masthead = document.querySelector('.print-masthead').getBoundingClientRect();
      const brand = document.querySelector('.print-brand').getBoundingClientRect();
      const date = document.querySelector('.print-date').getBoundingClientRect();
      return { brandInside: brand.right <= masthead.right + 0.5, clearOfDate: brand.right <= date.left + 0.5, dateInside: date.right <= masthead.right + 0.5 };
    });
    expect(fits).toEqual({ brandInside: true, clearOfDate: true, dateInside: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx playwright test --config <alt config> tests/e2e/dealership.spec.js -g "customer estimates"`
Expected: FAIL. No `img.proposal-logo` exists, and the printout has no credit `span`.

- [ ] **Step 3: Render the logo and name on the estimate card**

In `src/components/CustomerView.jsx`, after the `snapshot` `useMemo`, add:

```jsx
  // With a saved logo but no name, the logo alone identifies the dealership.
  const brandLine = snapshot.brand.isCustom ? snapshot.brand.dealershipName : snapshot.brand.name;
```

Replace `<p className="proposal-brand">{snapshot.brand.name}</p>` with:

```jsx
          {snapshot.brand.logo ? <img alt={brandLine ? "" : "Dealership logo"} className="proposal-logo" src={snapshot.brand.logo} /> : null}
          {brandLine ? <p className="proposal-brand">{brandLine}</p> : null}
```

- [ ] **Step 4: Render the printout masthead**

In `src/components/CustomerPrintout.jsx`, after `const { summary, groups } = snapshot;` add:

```jsx
  const { brand } = snapshot;
  const brandLine = brand.isCustom ? brand.dealershipName : brand.name;
```

Replace the masthead brand line:

```jsx
        <div className="print-brand"><img src="./payment-desk-icon.svg" width="40" height="40" alt="" /><div><strong>{snapshot.brand.name}</strong></div></div>
```

with:

```jsx
        <div className="print-brand">
          {brand.logo
            ? <img alt="" className="print-brand__logo" src={brand.logo} />
            : <img alt="" height="40" src="./payment-desk-icon.svg" width="40" />}
          <div>
            {brandLine ? <strong>{brandLine}</strong> : null}
            {brand.isCustom ? <span>PAYMENT DESK</span> : null}
          </div>
        </div>
```

- [ ] **Step 5: Add the estimate and print CSS**

In `src/redesign.css`, replace `.proposal-brand { font-weight:800; color:var(--navy); }` with:

```css
.proposal-brand { font-weight:800; color:var(--navy); overflow-wrap:anywhere; }
.proposal-logo { display:block; max-width:240px; max-height:56px; margin:0 0 8px; object-fit:contain; }
```

In `src/customer-print.css`, replace lines 8–12 (`.print-masthead` through `.print-date`) with:

```css
.print-masthead { display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:4px solid #00095b; padding:13px 0 12px; }
.print-brand { display:flex; align-items:center; gap:11px; min-width:0; }
.print-brand > div { min-width:0; }
.print-brand img { display:block; border-radius:9px; }
.print-brand img.print-brand__logo { width:auto; height:auto; max-width:190px; max-height:44px; object-fit:contain; border-radius:0; }
.print-brand strong { display:block; font-size:17px; letter-spacing:.08em; text-transform:uppercase; color:#00095b; overflow-wrap:anywhere; }
.print-brand span { display:block; font-size:8px; letter-spacing:.23em; color:#3c618e; margin-top:3px; }
.print-date { flex:0 0 auto; text-align:right; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && npx playwright test --config <alt config> tests/e2e/dealership.spec.js && npx playwright test --config <alt config> tests/e2e/experience.spec.js && npm run lint`
Expected: all pass, including the existing one-page PDF check in `experience.spec.js`.

- [ ] **Step 7: Commit**

```bash
git add src/components/CustomerView.jsx src/components/CustomerPrintout.jsx src/redesign.css src/customer-print.css tests/e2e/dealership.spec.js
git commit -m "Show the dealership on customer estimates and printouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Settings dialog, logo processing, and documentation

**Files:**
- Create: `src/lib/logoImage.js`
- Create: `src/components/DealershipSettingsDialog.jsx`
- Modify: `src/components/Icons.jsx` (add `SettingsIcon`)
- Modify: `src/components/ViewToggle.jsx` (gear button)
- Modify: `src/App.jsx` (settings state, handlers, dialog)
- Modify: `src/redesign.css` (dialog styles, appended)
- Modify: `README.md`, `docs/HANDOFF.md`, `docs/ACCEPTANCE.md`, `docs/DESIGN-SYSTEM.md`
- Test: `tests/logoImage.test.js`; append to `tests/e2e/dealership.spec.js`

**Interfaces:**
- Consumes: `MAX_DEALERSHIP_NAME_LENGTH`, `MAX_LOGO_DATA_URL_LENGTH`, `saveBrandSettings`, `clearBrandSettings` (Task 1); the `brand__chip` and `brand__logo` classes (Task 3); the `STORAGE_KEY` and `seedBrand` e2e helpers (Task 3).
- Produces:
  - `logoImage.js`: `ACCEPTED_LOGO_TYPES`, `MAX_LOGO_FILE_BYTES = 10485760`, `LOGO_MAX_WIDTH = 600`, `LOGO_MAX_HEIGHT = 200`, `class LogoError extends Error`, `logoTypeFor(file) → string | null`, `fitWithin(width, height, maxWidth?, maxHeight?) → { width, height }`, `prepareLogo(file) → Promise<string>` (rejects with `LogoError`).
  - `DealershipSettingsDialog({ settings, onSave, onClear, onClose })`. It is mounted only while open. `onSave({ name, logo })` and `onClear()` return the save-result shape from Task 1. `onClose()` runs after the native dialog closes.
  - `ViewToggle({ …, onOpenSettings, settingsButtonRef })`.

- [ ] **Step 1: Write the failing unit tests for the pure logo helpers**

Create `tests/logoImage.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, MAX_LOGO_FILE_BYTES, fitWithin, logoTypeFor } from "../src/lib/logoImage.js";

test("logo type uses the MIME type and falls back to the extension only when the type is missing", () => {
  assert.equal(logoTypeFor({ type: "image/png", name: "logo.png" }), "image/png");
  assert.equal(logoTypeFor({ type: "image/svg+xml", name: "logo.svg" }), "image/svg+xml");
  assert.equal(logoTypeFor({ type: "", name: "Dealer Logo.SVG" }), "image/svg+xml");
  assert.equal(logoTypeFor({ type: "", name: "logo.jpeg" }), "image/jpeg");
  assert.equal(logoTypeFor({ type: "text/plain", name: "logo.png" }), null);
  assert.equal(logoTypeFor({ type: "image/bmp", name: "logo.bmp" }), null);
  assert.equal(logoTypeFor({ type: "", name: "logo" }), null);
  assert.equal(logoTypeFor(undefined), null);
});

test("logos scale down to fit 600×200 and are never enlarged", () => {
  assert.equal(LOGO_MAX_WIDTH, 600);
  assert.equal(LOGO_MAX_HEIGHT, 200);
  assert.equal(MAX_LOGO_FILE_BYTES, 10 * 1024 * 1024);
  assert.deepEqual(fitWithin(1200, 400), { width: 600, height: 200 });
  assert.deepEqual(fitWithin(100, 1000), { width: 20, height: 200 });
  assert.deepEqual(fitWithin(3000, 100), { width: 600, height: 20 });
  assert.deepEqual(fitWithin(16, 16), { width: 16, height: 16 });
  assert.deepEqual(fitWithin(5000, 1), { width: 600, height: 1 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/logoImage.test.js`
Expected: FAIL. The module `../src/lib/logoImage.js` can't be found.

- [ ] **Step 3: Implement the logo module**

Create `src/lib/logoImage.js`:

```js
import { MAX_LOGO_DATA_URL_LENGTH } from "./brandSettings.js";

export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
export const MAX_LOGO_FILE_BYTES = 10 * 1024 * 1024;
export const LOGO_MAX_WIDTH = 600;
export const LOGO_MAX_HEIGHT = 200;

const EXTENSION_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

/** A logo problem whose message can be shown to the person choosing the file. */
export class LogoError extends Error {}
const fail = (message) => { throw new LogoError(message); };

export function logoTypeFor(file) {
  if (file?.type) return ACCEPTED_LOGO_TYPES.includes(file.type) ? file.type : null;
  const extension = String(file?.name ?? "").split(".").pop().toLowerCase();
  return EXTENSION_TYPES[extension] ?? null;
}

export function fitWithin(width, height, maxWidth = LOGO_MAX_WIDTH, maxHeight = LOGO_MAX_HEIGHT) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function decode(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode failed"));
    image.src = url;
  });
}

/** Resizes an uploaded logo on this device and returns it as a PNG data URL. */
export async function prepareLogo(file) {
  if (!file) fail("Choose a logo file.");
  const type = logoTypeFor(file);
  if (!type) fail("Use a PNG, JPG, WebP, GIF, or SVG image for the logo.");
  if (file.size > MAX_LOGO_FILE_BYTES) fail("That logo file is larger than 10 MB. Use a smaller image.");
  // A file with no MIME type (common for SVG on some systems) decodes from a typed copy.
  const url = URL.createObjectURL(file.type ? file : new Blob([file], { type }));
  try {
    let image;
    try {
      image = await decode(url);
    } catch {
      fail("That file couldn't be read as an image. Try saving the logo as a PNG.");
    }
    if (!image.naturalWidth || !image.naturalHeight) fail("That image has no size information. Export the logo as a PNG and try again.");
    const size = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) fail("This browser couldn't process the logo. Try a different browser.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size.width, size.height);
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      fail("The browser blocked reading this logo. Save it as a PNG and try again.");
    }
    if (!dataUrl.startsWith("data:image/png;base64,")) fail("This browser couldn't process the logo. Try a different browser.");
    if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) fail("That logo is too detailed to save. Use a simpler PNG.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `node --test tests/logoImage.test.js && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 5: Write the failing dialog e2e tests**

Add `import AxeBuilder from '@axe-core/playwright';` below the existing imports in `tests/e2e/dealership.spec.js`, then append:

```js
test.describe('dealership settings dialog', () => {
  const makePng = (page, width, height) => page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.fillStyle = '#c8102e';
    context.fillRect(0, 0, Math.ceil(w * 0.6), h);
    context.fillStyle = '#00095b';
    context.fillRect(Math.floor(w * 0.65), Math.floor(h * 0.2), Math.ceil(w * 0.35), Math.ceil(h * 0.6));
    return canvas.toDataURL('image/png').split(',')[1];
  }, [width, height]).then(base64 => ({ name: 'dealer-logo.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }));
  const openSettings = async page => {
    await page.getByRole('button', { name: 'Dealership settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dealership settings' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const storedLogoSize = page => page.evaluate(async key => {
    const image = new Image();
    image.src = JSON.parse(localStorage.getItem(key)).logo;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, STORAGE_KEY);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#worksheet-heading')).toBeVisible();
  });

  test('settings are offered only in Dealer view', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toBeVisible();
    await page.getByLabel('Selling price', { exact: true }).fill('30000');
    await page.getByLabel('Selling price', { exact: true }).blur();
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your purchase estimate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toHaveCount(0);
  });

  test('saving a name and logo updates the app, survives reload, and Clear restores Payment Desk', async ({ page }) => {
    let dialog = await openSettings(page);
    await dialog.getByLabel('Dealership name').fill('Lakeside Motors');
    await dialog.getByLabel('Choose logo').setInputFiles(await makePng(page, 1200, 400));
    await expect(dialog.getByRole('img', { name: 'Logo preview' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toBeFocused();
    const home = page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' });
    await expect(home.locator('img.brand__logo')).toBeVisible();
    expect(await storedLogoSize(page)).toEqual({ width: 600, height: 200 });
    await page.reload();
    await expect(home).toBeVisible();
    dialog = await openSettings(page);
    await expect(dialog.getByLabel('Dealership name')).toHaveValue('Lakeside Motors');
    page.once('dialog', confirm => confirm.accept());
    await dialog.getByRole('button', { name: 'Clear dealership settings' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
  });

  test('Cancel and Escape discard draft changes and return focus', async ({ page }) => {
    let dialog = await openSettings(page);
    await dialog.getByLabel('Dealership name').fill('Draft Motors');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    dialog = await openSettings(page);
    await expect(dialog.getByLabel('Dealership name')).toHaveValue('');
    await dialog.getByLabel('Dealership name').fill('Draft Motors');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Dealership settings' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Payment Desk home' })).toHaveText('PAYMENT DESK');
  });

  test('unusable files explain the problem and keep the current logo', async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.getByLabel('Choose logo').setInputFiles(await makePng(page, 240, 80));
    const preview = dialog.getByRole('img', { name: 'Logo preview' });
    await expect(preview).toBeVisible();
    const before = await preview.getAttribute('src');
    const status = dialog.getByRole('status');
    await dialog.getByLabel('Replace logo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await expect(status).toHaveText('Use a PNG, JPG, WebP, GIF, or SVG image for the logo.');
    await dialog.getByLabel('Replace logo').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
    await expect(status).toHaveText("That file couldn't be read as an image. Try saving the logo as a PNG.");
    await dialog.getByLabel('Replace logo').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(status).toHaveText('That logo file is larger than 10 MB. Use a smaller image.');
    await expect(preview).toHaveAttribute('src', before);
  });

  test('very tall and tiny logos fit the limits without enlarging and keep the header height', async ({ page }) => {
    const headerHeight = (await page.locator('.app-header').boundingBox()).height;
    for (const [width, height, expected] of [[100, 1000, { width: 20, height: 200 }], [16, 16, { width: 16, height: 16 }]]) {
      const dialog = await openSettings(page);
      await dialog.getByLabel(/^(Choose|Replace) logo$/).setInputFiles(await makePng(page, width, height));
      await expect(dialog.getByRole('img', { name: 'Logo preview' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      expect(await storedLogoSize(page)).toEqual(expected);
      expect((await page.locator('.app-header').boundingBox()).height).toBeLessThanOrEqual(headerHeight + 1);
    }
  });

  test('when the browser refuses to save, the dealership still shows for this visit with a warning', async ({ page }) => {
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    const dialog = await openSettings(page);
    await dialog.getByLabel('Dealership name').fill('Lakeside Motors');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('status')).toContainText("Couldn't save on this device");
    await expect(page.locator('.app-header .brand__name')).toHaveText('Lakeside Motors');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Lakeside Motors Payment Desk home' })).toBeVisible();
  });

  test('the dialog fits a phone, avoids iOS zoom, keeps the file picker focusable, and passes an accessibility scan', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const dialog = await openSettings(page);
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
    const fontSize = await dialog.getByLabel('Dealership name').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    await dialog.getByLabel('Choose logo').focus();
    await expect(dialog.getByLabel('Choose logo')).toBeFocused();
    const scan = await new AxeBuilder({ page }).include('.settings-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npm run build && npx playwright test --config <alt config> tests/e2e/dealership.spec.js -g "settings dialog"`
Expected: FAIL. There's no "Dealership settings" button.

- [ ] **Step 7: Add the gear icon**

Append to `src/components/Icons.jsx`:

```jsx
export const SettingsIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.9" />
    <circle cx="12" cy="12" r="6.6" stroke="currentColor" strokeWidth="1.9" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
  </Icon>
);
```

- [ ] **Step 8: Create the dialog component**

Create `src/components/DealershipSettingsDialog.jsx`:

```jsx
import { useEffect, useId, useRef, useState } from "react";
import { MAX_DEALERSHIP_NAME_LENGTH } from "../lib/brandSettings.js";
import { LogoError, prepareLogo } from "../lib/logoImage.js";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg";
const SAVE_FAILED = "Couldn't save on this device — private browsing or storage is full. The dealership will show until this page is closed.";
const CLEAR_FAILED = "Couldn't remove the saved dealership on this device. It is hidden until this page is closed.";

/** Edits a draft of the dealership name and logo. Nothing changes until Save. */
export default function DealershipSettingsDialog({ settings, onSave, onClear, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState(settings.name);
  const [logo, setLogo] = useState(settings.logo);
  const [notice, setNotice] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [finished, setFinished] = useState(false);

  // Mounted only while open; the native modal supplies focus containment and Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  const chooseLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    setNotice({ tone: "info", text: "Preparing logo…" });
    try {
      setLogo(await prepareLogo(file));
      setNotice({ tone: "info", text: "Logo ready. Select Save to use it." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof LogoError ? error.message : "That logo couldn't be processed. Try a PNG or JPG." });
    } finally {
      setProcessing(false);
    }
  };

  const save = (event) => {
    event.preventDefault();
    if (processing) return;
    const outcome = onSave({ name, logo });
    if (outcome.ok) { close(); return; }
    setFinished(true);
    setNotice({ tone: "error", text: SAVE_FAILED });
  };

  const clear = () => {
    if (!window.confirm("Clear the dealership name and logo on this device?")) return;
    const outcome = onClear();
    if (outcome.ok) { close(); return; }
    setName("");
    setLogo(null);
    setFinished(true);
    setNotice({ tone: "error", text: CLEAR_FAILED });
  };

  const removeLogo = () => {
    setLogo(null);
    setNotice({ tone: "info", text: "Logo removed. Select Save to keep this change." });
  };

  return (
    <dialog aria-labelledby={titleId} className="settings-dialog" onClose={onClose} ref={dialogRef}>
      <form className="settings-dialog__form" noValidate onSubmit={save}>
        <h2 id={titleId}>Dealership settings</h2>
        <p className="settings-dialog__note">Saved on this device only. Customer figures are never saved.</p>
        <div className="settings-dialog__field">
          <label htmlFor={nameId}>Dealership name <span>Optional</span></label>
          <input autoComplete="organization" className="text-input" disabled={finished} id={nameId} maxLength={MAX_DEALERSHIP_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)} placeholder="e.g. Lakeside Motors" type="text" value={name} />
        </div>
        <fieldset className="settings-dialog__logo" disabled={finished}>
          <legend>Logo <span>Optional</span></legend>
          <div className="settings-dialog__preview">
            {logo
              ? <span className="brand__chip"><img alt="Logo preview" className="brand__logo" src={logo} /></span>
              : <span>No logo selected</span>}
          </div>
          <div className="settings-dialog__logo-actions">
            <label className="settings-dialog__button settings-dialog__file">
              {logo ? "Replace logo" : "Choose logo"}
              <input accept={LOGO_ACCEPT} className="sr-only" disabled={processing || finished} onChange={chooseLogo} type="file" />
            </label>
            {logo ? <button className="settings-dialog__button" onClick={removeLogo} type="button">Remove logo</button> : null}
          </div>
          <p className="settings-dialog__hint">PNG, JPG, WebP, GIF, or SVG up to 10 MB. Large logos are resized to fit 600 × 200 pixels.</p>
        </fieldset>
        <p aria-live="polite" className={"settings-dialog__notice" + (notice?.tone === "error" ? " is-error" : "")} role="status">{notice?.text ?? ""}</p>
        <div className="settings-dialog__actions">
          {!finished ? <button className="settings-dialog__button settings-dialog__button--danger" onClick={clear} type="button">Clear dealership settings</button> : null}
          <span>
            <button className="settings-dialog__button" onClick={close} type="button">{finished ? "Done" : "Cancel"}</button>
            {!finished ? <button className="settings-dialog__button settings-dialog__button--primary" disabled={processing} type="submit">Save</button> : null}
          </span>
        </div>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 9: Add the gear button to the header**

In `src/components/ViewToggle.jsx`, change the icon import and signature:

```jsx
import { ResetIcon, SettingsIcon } from "./Icons.jsx";

export default function ViewToggle({ view, onViewChange, onReset, brand, onOpenSettings, settingsButtonRef }) {
```

Insert between the `<SegmentedControl … />` element and the Reset button:

```jsx
        {view === "dealer" ? (
          // Reuses the header's .reset-button styling: icon-only below 800px, 38px wide below 440px.
          <button aria-label="Dealership settings" className="reset-button settings-button" onClick={onOpenSettings} ref={settingsButtonRef} type="button">
            <SettingsIcon size={20} />
            <span>Settings</span>
          </button>
        ) : null}
```

- [ ] **Step 10: Wire the dialog into App**

In `src/App.jsx`, replace the Task 3 brand import with:

```js
import { clearBrandSettings, loadBrandSettings, resolveBrand, saveBrandSettings } from './lib/brandSettings.js';
```

Add after the `EstimateDateField` import:

```js
import DealershipSettingsDialog from './components/DealershipSettingsDialog.jsx';
```

Replace the Task 3 brand state lines with:

```js
  const [brandSettings, setBrandSettings] = useState(loadBrandSettings);
  const brand = useMemo(() => resolveBrand(brandSettings), [brandSettings]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef(null);
  // Even when the browser refuses to store them, the settings apply for this visit.
  const saveBrand = next => { const outcome = saveBrandSettings(next); setBrandSettings(outcome.settings); return outcome; };
  const clearBrand = () => { const outcome = clearBrandSettings(); setBrandSettings(outcome.settings); return outcome; };
  const closeSettings = () => { setSettingsOpen(false); requestAnimationFrame(() => settingsButtonRef.current?.focus()); };
```

Replace the header element with this and render the dialog right after it:

```jsx
        <ViewToggle brand={brand} onOpenSettings={() => setSettingsOpen(true)} onReset={resetDeal} onViewChange={changeView} settingsButtonRef={settingsButtonRef} view={view} />
        {settingsOpen ? <DealershipSettingsDialog settings={brandSettings} onClear={clearBrand} onClose={closeSettings} onSave={saveBrand} /> : null}
```

(The dialog sits inside `.app-frame`, so the existing `.app-frame :is(input,select,textarea) { font-size:max(16px,1rem); }` rule prevents iOS focus zoom.)

- [ ] **Step 11: Add the dialog CSS**

Append to `src/redesign.css`:

```css
/* ---------- Dealership settings dialog ---------- */
.settings-dialog {
  width: min(460px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-lg);
}
.settings-dialog::backdrop { background: rgba(0, 9, 91, 0.45); }
.settings-dialog__form { display: grid; gap: 14px; padding: 20px; }
.settings-dialog h2 { margin: 0; font-size: 1.2rem; font-weight: 800; color: var(--navy); }
.settings-dialog__note, .settings-dialog__hint { margin: 0; font-size: 0.8rem; color: var(--muted); }
.settings-dialog__field { display: grid; gap: 6px; }
.settings-dialog__field label, .settings-dialog__logo legend { font-weight: 700; color: var(--ink-soft); }
.settings-dialog__field label span, .settings-dialog__logo legend span { font-size: 0.78rem; font-weight: 500; color: var(--muted); }
.settings-dialog__logo { display: grid; gap: 10px; margin: 0; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); }
.settings-dialog__logo legend { padding: 0 4px; }
.settings-dialog__preview { display: flex; align-items: center; min-height: 52px; padding: 8px; border-radius: 8px; background: var(--navy); color: #d6ddff; font-size: 0.8rem; }
.settings-dialog__logo-actions, .settings-dialog__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.settings-dialog__actions { justify-content: space-between; }
.settings-dialog__actions > span { display: flex; gap: 8px; margin-left: auto; }
.settings-dialog__button { display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border: 1.5px solid var(--input-border); border-radius: 8px; background: var(--surface); color: var(--ink-soft); font-size: 0.88rem; font-weight: 700; cursor: pointer; }
.settings-dialog__button:hover { background: var(--blue-tint); }
.settings-dialog__button:disabled, .settings-dialog__logo:disabled .settings-dialog__button { opacity: 0.55; cursor: not-allowed; }
.settings-dialog__button--primary { border-color: var(--blue); background: var(--blue); color: #ffffff; }
.settings-dialog__button--primary:hover { background: var(--blue-dark); }
.settings-dialog__button--danger { border-color: transparent; padding-inline: 4px; color: var(--red); }
.settings-dialog__button--danger:hover { background: var(--red-bg); }
.settings-dialog__file:focus-within { outline: 3px solid var(--blue); outline-offset: 2px; }
.settings-dialog__notice { margin: 0; min-height: 1.2em; font-size: 0.85rem; color: var(--ink-soft); }
.settings-dialog__notice.is-error { color: var(--red); font-weight: 700; }
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npm run build && npx playwright test --config <alt config> tests/e2e/dealership.spec.js && npm test && npm run lint`
Expected: all dealership e2e tests pass in all three projects, including the Task 3 375px header tests now that the gear button is present. Unit tests and lint are clean.

- [ ] **Step 13: Update the documentation**

`README.md`: insert this paragraph immediately before `## Rules and limits`:

```markdown
**Dealership name and logo.** In Dealer view, select **Settings** (the gear) to add an optional dealership name and logo. They appear in the header, on the customer estimate, on the printout, and on the first line of copied or shared summaries, with a small Payment Desk credit in the header and printout. They are saved only on that device; with nothing saved, the app shows Payment Desk.
```

In `## Data and operation`, replace the first sentence (`Entered figures remain in browser memory unless the user copies, shares, or prints them.`) with:

```markdown
Entered figures remain in browser memory unless the user copies, shares, or prints them. The only thing the app saves is the optional dealership name and logo, in this browser's local storage on this device; customer figures are never saved. On a shared device, use **Settings → Clear dealership settings** to remove them.
```

`docs/HANDOFF.md`: replace `The app has no persistence or offline worker.` with:

```markdown
The app saves only the optional dealership name and logo, in each browser's local storage (`payment-desk.dealership.v1`); it never saves deal figures and has no offline worker. On shared devices, **Clear dealership settings** removes them.
```

`docs/ACCEPTANCE.md`: add this row under the `Browser tests` row of the test table:

```markdown
| Dealership tests | Saved name/logo normalization and fallback, logo type and sizing limits, header/estimate/printout/copied-text display, persistence, Clear, storage failure, and dialog accessibility |
```

and add this checklist item after the `Copy finance and cash summaries…` item:

```markdown
- [ ] In Dealer view, open Settings, add a dealership name and a wide transparent logo, and save. Confirm the header (desktop and a 375px phone), customer estimate, printed estimate, and copied/shared summary show the dealership; reload and Reset deal keep it; Clear dealership settings restores Payment Desk. Repeat in a private window and confirm the could-not-save message.
```

`docs/DESIGN-SYSTEM.md`: add this bullet after the `**Print:**` bullet:

```markdown
- **Dealership identity:** an optional saved name and logo replace the PAYMENT DESK wordmark, with a small PAYMENT DESK credit. Logos sit on a white chip in the navy header so dark artwork stays visible; on phones (≤440px) the header shows the chip and credit without the name text. The printout uses the logo in place of the PD icon. With nothing saved, the default wordmark and PD icon remain.
```

- [ ] **Step 14: Commit**

```bash
git add src/lib/logoImage.js src/components/DealershipSettingsDialog.jsx src/components/Icons.jsx src/components/ViewToggle.jsx src/App.jsx src/redesign.css tests/logoImage.test.js tests/e2e/dealership.spec.js README.md docs/HANDOFF.md docs/ACCEPTANCE.md docs/DESIGN-SYSTEM.md
git commit -m "Add dealership settings dialog with on-device logo resizing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final: release verification and delivery

- [ ] Run `npm run check` (lint, unit tests, build). Expected: clean.
- [ ] Run the full e2e suite: `npx playwright test --config <alt config>`. Expected: every test passes in chromium, mobile and webkit.
- [ ] Visually check in a browser at 1440px and 375px: the default header, the dealership with logo, a name-only dealership, the open settings dialog, the customer estimate card, and print preview.
- [ ] Confirm the built `dist/` has no "Maxey" (`grep -ri maxey dist`) and no `localStorage` writes other than the dealership key (`grep -o "localStorage[^;]*" dist/assets/*.js`).
- [ ] Push `remove-bob-maxey-branding`, retitle PR #15 "Remove Bob Maxey branding and add optional dealership name and logo", and add the dealership feature, its tests and the narrow-screen header behavior to the description.
