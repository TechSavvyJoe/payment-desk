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
