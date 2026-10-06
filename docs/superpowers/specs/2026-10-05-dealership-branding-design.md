# Optional dealership name and logo — design

Date: 2026-10-05 · Status: approved in conversation, awaiting spec review · Branch/PR: `remove-bob-maxey-branding` / #15

## Goal

Payment Desk no longer carries any dealership's branding. Any dealership using it can optionally show its own name and logo on the app and on customer estimates. With nothing set, the app looks and behaves exactly as it does today ("Payment Desk").

## Decisions (agreed with the owner)

| Question | Decision |
| --- | --- |
| Where settings live | On each device, in that browser's `localStorage`. Each salesperson sets it once per device. No account, backend, or redeploy. |
| Placement | Dealership logo and name everywhere the app identifies itself, with a small "PAYMENT DESK" credit beneath them in the header and printout. |
| Logo storage | A resized copy (PNG data URL) is stored, not the original file. |

## Non-goals

Syncing across devices, per-salesperson profiles, a site-wide built-in default, dealership address/phone/colors, logo cropping or whitespace trimming, changing the browser-tab title or install-manifest name, and cross-tab live updates.

## User experience

### Settings entry and dialog
- A gear **Settings** button sits in the header beside **Reset deal**, shown only in Dealer view (customers never see it). Icon plus "Settings" label on wide screens; icon-only with `aria-label="Dealership settings"` where Reset deal is already icon-only.
- It opens a modal native `<dialog>` titled **Dealership settings** (`showModal`, Esc closes, focus returns to the gear button) containing:
  - **Dealership name** — optional text input, `maxLength` 60.
  - **Logo** — optional file input (`accept` PNG, JPEG, WebP, GIF, SVG), a preview of the processed logo as it will appear on the header chip, and **Remove logo**.
  - **Save** and **Cancel**.
  - **Clear dealership settings** — confirms, then removes the saved name and logo from this device and returns to "Payment Desk".
  - Note: "Saved on this device only. Customer figures are never saved."
- Editing happens on a draft; nothing changes until Save. Cancel/Esc discards the draft.
- Logo processing errors appear inline in the dialog in an `aria-live="polite"` region; the previous logo is kept.

### Where the brand appears

| Surface | Nothing set (today) | Dealership set |
| --- | --- | --- |
| Header (both views) | "PAYMENT DESK" wordmark | Logo (if any) on a small white rounded chip so dark logos stay visible on navy; dealership name (if any); small "PAYMENT DESK" credit beneath |
| Customer estimate card | "Payment Desk" line above "Vehicle purchase estimate" | Logo (if any) and dealership name (if any) in place of that line |
| Estimate footer meta | `Payment Desk · ref · App ver` | `<display name> · ref · App ver` |
| Printout masthead | PD icon + "Payment Desk" | Logo (if any; otherwise PD icon) + dealership name (if any) + small "PAYMENT DESK" credit |
| Copy summary / Share | First line and share title use "Payment Desk" | Use the dealership name; "Payment Desk" if only a logo is set |
| Browser tab, install manifest | "Payment Desk" | Unchanged |

- **Reset deal** and the error-boundary reset never clear dealership settings.
- Narrow phones (≤440px): measured at 375px, the header leaves about 90px for the brand once the gear button is added. Header gaps tighten and the two header buttons become 38px wide. With a logo, the phone header shows the logo chip with the credit beneath it and hides the name text (the name stays in the link's accessible name). Without a logo, the name truncates with an ellipsis above the credit. The default wordmark shrinks slightly so it still fits. The header must not overflow horizontally at 375px.
- Accessibility: when the name is visible beside the logo, the logo `alt` is empty (decorative); with a logo only, `alt="Dealership logo"`. The header home link's accessible name becomes "<Dealership> Payment Desk home" when a name is set.

## Data and processing

### Stored record
Key `payment-desk.dealership.v1`, JSON `{ "name": string, "logo": string | null }`.

### `src/lib/brandSettings.js` (pure, unit-tested; storage is injected)
- `BRAND_STORAGE_KEY`, `DEFAULT_BRAND_NAME = "Payment Desk"`, `MAX_DEALERSHIP_NAME_LENGTH = 60`, `MAX_LOGO_DATA_URL_LENGTH = 1_500_000`.
- `normalizeBrandSettings(value)` → `{ name, logo }`. Name: string, whitespace collapsed and trimmed, cut to 60 characters, otherwise `""`. Logo: accepted only if it is a string matching `^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$` and within the length limit, otherwise `null`. Any non-object input yields the empty record.
- `loadBrandSettings(storage)` → normalized record; missing key, blocked storage, or bad JSON yields the empty record and never throws.
- `saveBrandSettings(settings, storage)` → `{ ok: true }` or `{ ok: false, reason: "unavailable" | "quota" }`; saves the normalized record and never throws. An empty record removes the key.
- `clearBrandSettings(storage)` → `{ ok }`.
- `resolveBrand(settings)` → `{ dealershipName, logo, isCustom, displayName }`, where `isCustom = Boolean(name || logo)` and `displayName = name || "Payment Desk"`.
- The default storage accessor wraps `window.localStorage` access in try/catch (Safari private mode and blocked storage throw on access).

### `src/lib/logoImage.js` (browser-only; covered by end-to-end tests)
- `prepareLogo(file)` → `Promise<string>` (PNG data URL); rejects with an error whose `message` is user-facing.
- Accept by MIME type, falling back to the file extension when the type is empty. Reject files over 10 MB.
- Decode through an object URL into an `Image` (SVG supported), then scale to fit within **600 × 200 px** without upscaling, draw on a canvas with high-quality smoothing, and export PNG (transparency kept).
- Errors: unsupported type; too large; unreadable/zero-size image (for example an SVG without dimensions: "export it as PNG"); canvas export blocked; result above the length limit. Object URLs are always revoked.
- CSP already allows `img-src 'self' data: blob:`, so no header change is needed.

### Proposal snapshot (`src/lib/proposal.js`)
- `createProposalSnapshot({ …, brand = resolveBrand({}) })` stores `snapshot.brand = { name: displayName, dealershipName, logo, isCustom }`, replacing the current string field.
- `formatProposalText` uses `snapshot.brand.name` for its first line.

## Components and wiring

- `App.jsx`: `brandSettings` state initialized from `loadBrandSettings()`, `settingsOpen` state, `brand = resolveBrand(brandSettings)`. Passes `brand` to `ViewToggle` and `CustomerView`, and save/clear handlers to the dialog. If saving fails, the settings still apply for this page session, and the dialog stays open with a warning ("Couldn't save on this device — storage is blocked or full. The dealership will show until this page is closed.") and a **Done** button.
- `ViewToggle.jsx`: renders the default wordmark or the logo/name/credit lockup; adds the gear button in Dealer view.
- `DealershipSettingsDialog.jsx` (new): draft state, file processing via `prepareLogo`, preview, save/cancel/clear.
- `CustomerView.jsx`: passes `brand` into the snapshot; renders the logo and name in the identity card; uses `snapshot.brand.name` for the share title and footer meta.
- `CustomerPrintout.jsx`: masthead logo or PD icon, name, and credit.
- `Icons.jsx`: `SettingsIcon` (gear) in the existing icon style.
- CSS: header lockup, chip, credit, narrow-screen rules and dialog in `redesign.css`; print logo and credit in `customer-print.css`.

## Documentation

- README privacy paragraph and HANDOFF "no persistence" section: only the dealership name and logo are saved in this browser, never customer figures; on a shared device use **Clear dealership settings**.
- ACCEPTANCE: manual checks for setting, printing, and clearing a dealership.
- DESIGN-SYSTEM: header lockup variant and logo chip rule.

## Testing

- **Unit (`node --test`)**: normalize, load, save, and clear with a fake storage (bad JSON, wrong types, overlong name, non-PNG or `javascript:` logo, oversize logo, storage that throws on access, quota error); `resolveBrand` combinations; snapshot and text using the dealership name and the "Payment Desk" fallback.
- **End-to-end (Playwright, all three projects)**:
  - set a name and a committed 1200×400 transparent PNG fixture; check the header, customer card, printout masthead, and copied text
  - the stored logo decodes at no more than 600×200
  - settings survive a reload and Reset deal
  - Clear restores "Payment Desk"
  - a non-image file shows an error and keeps the previous logo
  - the gear button is hidden in Customer view
  - axe scan of the open dialog
  - no horizontal overflow at 390px with a long name and a logo
- Existing suites (`npm run check:release`) stay green.

## Delivery

Same branch and PR #15. Retitle it "Remove Bob Maxey branding and add optional dealership name and logo" and extend the description. The live Cloudflare site changes only after a manual upload.
