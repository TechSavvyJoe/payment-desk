## Integrated application direction

The integration review selected **03 — Desk D** for the application icon: its D/desk shape better relates to Payment Desk than the E-like Open Ledger concept. App assets preserve the established navy `#00095b` / blue `#066fef` palette. The standalone presentation below records the original designer recommendation and all three explorations. The app header retains readable Payment Desk text and custom dealer branding; it does not add width to the narrow companion header.

# Payment Desk brand concepts

Recommendation: **02 — Open ledger**. The original 32-unit construction reduces a worksheet to its perimeter, entry and total. Its straight four-unit strokes rasterize cleanly at 16 px; the two curved alternatives lose more edge clarity. It works in one color and gives the neutral product an identity without automotive badges, dollar signs, lender symbols or borrowed logos. It can also read as an E: pair it with the Payment Desk name during introduction. This is a concept recommendation, not a trademark clearance.

## Directions and assets

- `01-shared-stem-color.svg`: P and a secondary D contour share a compact footprint. Strongest relationship to the existing PD initials; more abstract when small.
- `02-open-ledger-color.svg`: recommended worksheet symbol. Strongest small-size clarity and category relevance.
- `03-desk-d-color.svg`: an open D surrounds a desk edge. Memorable geometry, less immediate meaning.
- Each direction has `-mono.svg`, `-reversed.svg`, transparent 3× PNG counterparts and actual `-16px.png`, `-24px.png`, `-32px.png` raster proofs.
- `comparison-sheet.svg`, `comparison-sheet.png`, `comparison-sheet.pdf`: one-page presentation, color and monochrome tests, actual vector-size samples, recommendation, palette, typography and dealer hierarchy.
- `pixel-inspection.png`: actual-size raster exports magnified 4× with nearest-neighbor sampling, not redrawn at larger resolution.
- `recommended-primary.svg`: horizontal color lockup.
- `recommended-stacked.svg`: alternate stacked lockup.
- `recommended-icon.svg`: standalone winner.
- `recommended-reversed.svg`: white horizontal lockup, transparent background.
- `recommended-mono.svg`: black horizontal lockup.
- `recommended-app-tile.svg`: optional navy container for app/favicons; icon itself remains frameless.
- All recommended SVGs also have high-resolution PNG versions.

## System

Navy `#102B4E`, electric blue `#066FEF`, paper `#F4F7FB`. The accent inherits the app's existing blue; the proposed navy is a neutral concept color. No UI palette changes were made.

Type: IBM Plex Sans SemiBold, from the project's installed font, SIL Open Font License (`public/IBM-Plex-Sans-OFL.txt`). Wordmark spacing is tightened by 0.25 units at a 32-unit font size. All lettering is outlined: delivered SVGs require no installed fonts, network requests, scripts or external images.

Minimum icon canvas: 16 px (visible symbol 12 px). At 16 px the four-unit strokes become 2 px. Horizontal lockup minimum: 146 px wide; use icon only below that size. Maintain at least one four-unit stroke of clear space beyond the visible geometry. Use solid white on dark; avoid blue accents on navy. Over photography, use the opaque navy app tile or an opaque paper backing rather than place the transparent mark directly on variable contrast.

Payment Desk keeps its name. In customized estimates, the dealership's name/logo remain primary and PAYMENT DESK remains a secondary product credit. No concept presumes changes to local-device storage, Michigan-only scope, fee protections or provider availability.

## Verification and reproducibility

Built SVGs, transparent PNGs and vector PDF with hand-authored paths, fontTools and CairoSVG; personally inspected the rendered comparison, primary lockup and pixel inspection sheet. Color, black and white-on-navy versions were inspected. Direct placement over a photographic background was not tested; use the opaque tile treatment for that context.

`generate.py` is the editable geometry source. It requires Python, Pillow, fontTools, Brotli, CairoSVG and system Cairo. This host used isolated Python packages under `/tmp/payment-desk-vector-tools` and `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`. Rebuild from repository root:

```
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib python3 design/brand/generate.py
python3 design/brand/validate.py
```

Only design assets were authored in this task. App build/browser suites are reserved for the coordinating agent; no source/public integration, commit, push or deployment occurred. Other agents' concurrent workspace changes are outside this brand task.
