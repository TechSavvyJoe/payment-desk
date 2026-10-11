# Payment Desk workspace design QA — October 11, 2026

Result: **passed for the revised workspace surfaces**. Full release CI, packaged-extension verification and production smoke checks are separate gates; see the associated release PR for those results. This is not nationwide or physical-phone acceptance.

## Sources and rendered evidence

- Grounding: existing Payment Desk desktop and narrow worksheet, inspected in the in-app browser; IBM Plex Sans and established navy/blue bordered sections.
- Generated concept: `design/workspace-concept.png`. It is a visual proposal, not financial test evidence.
- Same-pass comparison: `design/qa/workspace-comparison.png`, concept worksheet crop and fresh actual worksheet normalized to equal widths without stretching.
- Fresh actual app captures: `design/qa/desktop-1280.png` and `library-desktop-1280.png` at 1280×900; `phone-390.png` and `library-phone-390.png` at 390×844; `library-more-320.png` at 320×800.
- Local actual URL: `http://127.0.0.1:4941/`, upgrade worktree. Chromium, bundled fonts awaited, synthetic $25,000 vehicle, no trade, 72-month and 60-month copies. Financial figures come from the app. No customer data.
- Capture fallback: initial in-app-browser viewport changes produced stale/scaled viewport captures. Final dimension-specific evidence uses isolated Playwright browser contexts. The mismatched captures were excluded.

## Fidelity and interaction review

| Surface | Inspected result |
| --- | --- |
| Typography | Bundled IBM Plex Sans retained; actual font metrics, 16px dialog inputs, clear numeric hierarchy. Payment remains dominant. Heading is smaller than the illustrative concept to preserve working density. |
| Layout and spacing | Desktop keeps the existing two input columns and payment rail. Current worksheet replaces the old slogan. Phone actions reuse Deal details / Inventory instead of adding a row. Browse mode collapses the save form. Library body scrolls independently with Close reachable. |
| Colors and surfaces | Existing navy, blue actions, white sections, gray background, defined borders, green readiness and clear focus treatment retained. Library uses the established navy dialog heading rather than the concept's white title area. |
| Assets | Neutral Desk D app/extension icon inspected at 192px; vector and size variants included. Dealer-provided logo behavior is preserved. No invented vehicle imagery or decorative illustrations. |
| Copy and numbers | Local-only storage, current-fee recalculation, different vehicle references and explicit replacement/deletion are stated. Mockup zero taxes/invented product controls were rejected; existing product editor and actual calculations remain. |
| Responsive behavior | New controls inspected at 320, 390, 450 and desktop widths. More menu constrained within populated rows. Labeled comparison cards replace the desktop table on phones. No horizontal scroll in measured narrow states. |
| Keyboard/accessibility | Native dialog, initial focus, Escape/return focus, labeled controls, rename/cancel focus and visible focus rings. Axe scans of selected comparison/More/Rename passed in Chromium, mobile and WebKit. |

## Findings repaired before acceptance

1. Initial phone toolbar added height and pushed Trade allowance behind the bottom bar. Moved Save/Saved into the existing tool row. Existing phone density/reminder tests passed 49 cases, with one desktop-only case skipped.
2. Expanded save form buried the saved list in browse mode. Collapse it for browse, keep it open/focused for Save.
3. Old success copy masked a later cross-tab conflict. Prioritize current storage errors; retain pending name text and require Reload list.
4. More menu overflowed at 320px and, after the first alignment fix, at 450px. Right-align and bound its width at all narrow sizes; test populated menus and cancellation focus, not just an empty modal.
5. Independent review found that aborting the first inventory handshake discarded the scrubbed connection candidate. Keep it for a subsequent read; aborted responses still cannot persist it.

## Evidence and limits

- Lint, production build and all 295 unit tests passed before final release integration.
- All 30 new saved-worksheet browser checks passed across Chromium, mobile and WebKit after repairs. The 60 fee/settings cases in the preceding combined run passed; its only three failures were the subsequently repaired menu-width cases.
- Restore tests overwrite deliberately changed drafts after reload, retain products/date/raw invalid input and targets, preserve immutable saved copies during Open, and verify cross-tab conflict recovery. Comparison checks exact recomputed totals under current fees.
- Long restore scenarios have a 60-second overall test budget; field/value expectations remain unchanged. Initial 30-second whole-scenario deadlines were exhausted in Chromium during the heavier combined run.
- This UI acceptance does not claim Chrome Web Store publication, nationwide tax coverage, legal approval, actual customer delivery, or physical iOS/Android share-sheet acceptance. Existing financial scope gates remain in force.
