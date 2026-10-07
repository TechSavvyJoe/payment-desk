import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const output = new URL('../extensions/payment-desk-companion/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const artwork = await readFile(new URL('../public/payment-desk-icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${artwork}`);
    await page.screenshot({ path: fileURLToPath(new URL(`icon-${size}.png`, output)) });
  }
} finally { await browser.close(); }
