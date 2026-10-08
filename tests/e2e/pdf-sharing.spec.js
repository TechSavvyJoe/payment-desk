import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { DESK_DRAFT_KEY } from '../../src/lib/deskDraft.js';
import { mkdir, writeFile } from 'node:fs/promises';

test.setTimeout(120_000);

async function mockShare(page, mode = 'ok') {
  await page.addInitScript(mode => {
    window.pdfCalls = [];
    document.addEventListener('click', event => {
      if (event.target.closest('button')?.textContent.includes('Share PDF')) {
        window.fileBeforeShareClick = window.capabilityFile;
      }
    }, true);
    window.printCalls = 0;
    window.print = () => window.printCalls++;
    const canShare = mode === 'missing' ? undefined : data => {
      window.capabilityFile = data.files[0];
      if (mode === 'throw') throw new Error('unsupported');
      return mode !== 'false';
    };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
    Object.defineProperty(navigator, 'share', { configurable: true, value: data => {
      // Capture activation at invocation, before reading bytes asynchronously.
      window.pdfCalls.push({ keys: Object.keys(data), active: navigator.userActivation.isActive, preparedBeforeClick: window.fileBeforeShareClick === data.files[0], capabilityMatched: window.capabilityFile === data.files[0], file: data.files[0], title: data.title });
      if (mode === 'cancel') return Promise.reject(new DOMException('cancel', 'AbortError'));
      if (mode === 'error') return Promise.reject(new Error('share failed'));
      return Promise.resolve();
    } });
  }, mode);
}
async function openEstimate(page, waitForPdf = true) {
  await page.goto('/');
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Estimate date', { exact: true }).fill('09/24/26');
  await page.getByLabel('Vehicle / stock reference').fill('José 東京 🚗 / stock 123');
  await page.locator('details.deal-details > summary').click();
  await page.getByLabel('Selling price', { exact: true }).fill('30000');
  await page.getByLabel('Selling price', { exact: true }).blur();
  await page.getByLabel('Cash down', { exact: true }).fill('2000');
  await page.getByLabel('Cash down', { exact: true }).blur();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  if (waitForPdf) await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
}
async function sharedPdf(page) {
  const result = await page.evaluate(async () => {
    const call = window.pdfCalls.at(-1);
    const bytes = new Uint8Array(await call.file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { keys: call.keys, active: call.active, preparedBeforeClick: call.preparedBeforeClick, capabilityMatched: call.capabilityMatched, title: call.title, isFile: call.file instanceof File, name: call.file.name, type: call.file.type, bytes: btoa(binary) };
  });
  return { ...result, bytes: Buffer.from(result.bytes, 'base64') };
}

test('shares prepared current PDF synchronously with activation and regenerates after edits', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockShare(page); await openEstimate(page);
  await expect(page).toHaveTitle(/Payment Desk/);
  await expect(page.locator('.customer-layout')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  const first = await sharedPdf(page);
  expect(first.keys.sort()).toEqual(['files', 'title']);
  expect(first.active).toBe(true); expect(first.preparedBeforeClick).toBe(true); expect(first.capabilityMatched).toBe(true); expect(first.isFile).toBe(true);
  expect(first.type).toBe('application/pdf'); expect(first.name).toMatch(/^Estimate-PD-\d{8}-[A-F0-9]{8}\.pdf$/);
  expect(Buffer.from(first.bytes).subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await PDFDocument.load(new Uint8Array(first.bytes));
  expect(pdf.getSubject()).toContain('José 東京 🚗 / stock 123');
  expect(pdf.getSubject()).not.toMatch(/total interest|interest paid|total (?:of |loan )?payments/i);
  await expect(page.getByRole('status')).toContainText('PDF passed to sharing app.');
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await page.getByLabel('Selling price', { exact: true }).fill('31000');
  await page.getByLabel('Selling price', { exact: true }).blur();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  const second = await sharedPdf(page);
  expect(second.name).not.toBe(first.name);
  expect((await PDFDocument.load(new Uint8Array(second.bytes))).getSubject()).toContain('Vehicle selling price: $31,000.00');
  expect(errors).toEqual([]);
  await mkdir('/tmp/payment-desk-pdf-sharing', { recursive: true });
  await writeFile(`/tmp/payment-desk-pdf-sharing/finance-${info.project.name}.pdf`, new Uint8Array(first.bytes));
  await page.screenshot({ path: `/tmp/payment-desk-pdf-sharing/customer-${info.project.name}.png`, fullPage: true });
});

for (const mode of ['cancel', 'error', 'missing', 'false', 'throw']) {
  test(`${mode}: explicit download fallback without print or automatic download`, async ({ page }) => {
    await mockShare(page, mode);
    let downloads = 0; page.on('download', () => downloads++);
    await openEstimate(page);
    if (['cancel', 'error'].includes(mode)) {
      await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
      await expect(page.getByRole('status')).toContainText(mode === 'cancel' ? 'Sharing canceled.' : 'PDF sharing failed.');
    } else {
      await expect(page.getByRole('button', { name: 'Share PDF', exact: true })).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText('File sharing is unavailable');
    }
    expect(downloads).toBe(0); expect(await page.evaluate(() => window.printCalls)).toBe(0);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
    expect((await pending).suggestedFilename()).toMatch(/\.pdf$/);
  });
}

for (const type of ['cash', 'max-products']) {
  test(`${type} PDF is complete, paginated and locally generated`, async ({ page }, info) => {
    if (type === 'max-products') test.setTimeout(240_000);
    await mockShare(page);
    await openEstimate(page);
    await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
    if (type === 'cash') await page.getByRole('button', { name: 'Cash', exact: true }).click();
    else {
      // Use the existing draft schema to load the supported upper bound without
      // making fifty UI clicks; the export itself still runs through Customer view.
      await expect.poll(() => page.evaluate(key => Boolean(localStorage.getItem(key)), DESK_DRAFT_KEY)).toBe(true);
      await page.evaluate(key => {
        const draft = JSON.parse(localStorage.getItem(key));
        draft.desk.deal.optionalItems = Array.from({ length: 50 }, (_, i) => ({ id: `add-on-${i + 1}`, category: 'other', name: `Protection ${i + 1} — José 東京 🚗 extended coverage details`, amount: 12.34, taxable: true, taxTreatmentConfirmed: true }));
        draft.desk.nextItemId = 51;
        localStorage.setItem(key, JSON.stringify(draft));
      }, DESK_DRAFT_KEY);
      await page.reload();
    }
    await page.getByRole('button', { name: 'Customer view', exact: true }).click();
    await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
    const data = await sharedPdf(page);
    const pdf = await PDFDocument.load(new Uint8Array(data.bytes));
    if (type === 'cash') {
      expect(pdf.getSubject()).toContain('Cash due after trade:');
      expect(pdf.getSubject()).not.toContain('Payment comparisons');
    } else {
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
      expect(pdf.getSubject()).toContain('Protection 50 — José 東京 🚗 extended coverage details');
      expect(pdf.getSubject()).toContain('Assumptions');
    }
    await mkdir('/tmp/payment-desk-pdf-sharing', { recursive: true });
    await writeFile(`/tmp/payment-desk-pdf-sharing/${type}-${info.project.name}.pdf`, new Uint8Array(data.bytes));
    // All PDF assets are bundled; no cloud PDF or network font execution.
    expect(pdf.getSubject()).not.toMatch(/% APR/);
  });
}

test('raw invalid input cannot export an older complete PDF', async ({ page }) => {
  await mockShare(page); await openEstimate(page);
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await page.getByLabel('Selling price', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.pdfCalls.length)).toBe(0);
});

test('dealership changes revoke old URLs and regenerate with the current identity', async ({ page }) => {
  await mockShare(page);
  await page.addInitScript(() => {
    window.pdfUrls = []; window.revokedPdfUrls = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); if (blob.type === 'application/pdf') window.pdfUrls.push(url); return url; };
    URL.revokeObjectURL = url => { window.revokedPdfUrls.push(url); revoke(url); };
  });
  await openEstimate(page);
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  const before = await sharedPdf(page);
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await page.getByRole('button', { name: 'Dealership settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dealership settings' });
  await dialog.getByLabel('Dealership name').fill('Étoile 東京 Motors');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await expect(page.locator('.proposal-brand')).toHaveText('Étoile 東京 Motors');
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  const after = await sharedPdf(page);
  expect(after.title).toContain('Étoile 東京 Motors');
  expect((await PDFDocument.load(new Uint8Array(after.bytes))).getSubject()).toContain('Étoile 東京 Motors');
  // Branding can preserve the estimate reference, but never the actual PDF bytes.
  expect(after.bytes).not.toEqual(before.bytes);
  await expect.poll(() => page.evaluate(() => window.revokedPdfUrls.includes(window.pdfUrls[0]))).toBe(true);
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pdfUrls.every(url => window.revokedPdfUrls.includes(url)))).toBe(true);
});

test('storage unavailable does not prevent local PDF sharing', async ({ page }) => {
  await mockShare(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
    Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
  });
  await openEstimate(page);
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  expect((await sharedPdf(page)).type).toBe('application/pdf');
});

test('unmounted pending generation never exposes a stale file', async ({ page }) => {
  await mockShare(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/es-*.js', async route => { await gate; await route.continue(); });
  await openEstimate(page, false);
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await page.getByLabel('Selling price', { exact: true }).fill('32000');
  await page.getByLabel('Selling price', { exact: true }).blur();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  release();
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  const data = await sharedPdf(page);
  const subject = (await PDFDocument.load(new Uint8Array(data.bytes))).getSubject();
  expect(subject).toContain('Vehicle selling price: $32,000.00');
  expect(subject).not.toContain('Vehicle selling price: $30,000.00');
});

test('loaded worksheet regenerates a cash PDF offline without external assets', async ({ page, context }) => {
  await mockShare(page); await openEstimate(page);
  const externalRequests = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4938/') && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Edit deal', exact: true }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: 'Customer view', exact: true }).click();
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  expect(await page.evaluate(() => window.pdfCalls.at(-1).file.type)).toBe('application/pdf');
  // WebKit's Playwright offline emulation also blocks blob I/O used by the
  // inspection harness. Preparation and share invocation above remain offline.
  await context.setOffline(false);
  const data = await sharedPdf(page);
  expect((await PDFDocument.load(new Uint8Array(data.bytes))).getSubject()).toContain('Cash due after trade:');
  expect(externalRequests).toEqual([]);
});

test('generation failure stays explicit and Retry PDF recovers the current snapshot', async ({ page }) => {
  await mockShare(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    let fail = true;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (fail) { fail = false; throw new Error('Temporary PDF renderer failure'); }
      return original.apply(this, args);
    };
  });
  await openEstimate(page, false);
  await expect(page.getByRole('status')).toContainText('PDF could not be generated: Temporary PDF renderer failure');
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Share PDF', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  const data = await sharedPdf(page);
  expect((await PDFDocument.load(new Uint8Array(data.bytes))).getSubject()).toContain('José 東京 🚗 / stock 123');
  await expect(page.getByRole('button', { name: 'Retry PDF', exact: true })).toHaveCount(0);
});
