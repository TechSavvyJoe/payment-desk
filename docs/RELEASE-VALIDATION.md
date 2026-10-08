# Production-readiness validation — September 25, 2026

Historical evidence for the September release, not current-source acceptance. October changes include local draft persistence, PDF file sharing, clarified interest-rate labels and explicit supported-purchase controls. Use the current [README](../README.md), [operating handoff](HANDOFF.md) and [October readiness dossier](PRODUCTION-READINESS-2026-10-08.md). In particular, `pdf-lib` is now a runtime PDF dependency; earlier text-sharing and no-persistence statements below describe their dated release.

The September 24 audit was implemented on `codex/production-ready-payment-desk`. The application was published to Cloudflare Pages on September 24 and to `https://desking.mysoldlog.com/` on September 25. Subsequent production releases include reverse targets, professional customer printouts, calendar selection, and visible Michigan trade tax savings. Pull request #10 records final source, CI, merge, and deployment evidence; deployment status must not be inferred from this document alone.

The visual direction retains the established navy-blue identity: raised individual section cards, shaded icon headers, bold labels, a complete navy payment summary, and compact financing/target sections. IBM Plex Sans is bundled locally with its SIL Open Font License. Vehicle reference/date fields are available under Deal details. Calculation and validation repairs remain in place.

The refinement adds compact, separately bordered target cards with a grid of resulting figures, section accent colors, financing beside the deal inputs, a shorter mobile summary, and direct Compare payments / Review customer estimate / Edit deal actions. Empty estimates guide entry without presenting zero as a completed payment. Visible and entered dates use MM/DD/YY, with calendar validation and ISO rule dates retained internally. See `DESIGN-SYSTEM.md` for the component conventions and accessibility references.

## Original September 24 evidence

- ESLint, 58 unit/regression tests, and the Vite production build pass.
- All 52 applicable Playwright checks passed across the full run and targeted recheck, with 5 intentionally inapplicable project cases skipped. The initial run passed 50; two WebKit checks exceeded their setup budget during slow browser startup and passed unchanged with one worker. After the target-card refinements, 13 targeted browser checks passed across Chromium, mobile Chromium, and WebKit (2 inapplicable cases skipped), covering product/export, grid navigation, populated-target accessibility, responsive boundaries, and successive target applications. The breakpoint sweep runs once; the hidden mobile-grid recovery test includes resizing to desktop with an invalid draft.
- Automated WCAG-tagged axe scans pass on the dealer, grid, and customer surfaces in all three projects. This does not establish complete accessibility conformance.
- Responsive checks cover 320, 390, 760, 800, 801, 900, 1024, 1280, and 1440 CSS pixels. Desktop, tablet, mobile, and customer screens were also inspected visually.
- The requested product choices are Service Contract, Gap, and Other. Positive Other charges need a custom name and an explicit tax choice. The same products and taxes reach the customer proposal.
- The browser tests exercise repeated payment targets, Undo after subsequent edits, malformed amount/date recovery, APR rounding, new registration unknown versus explicit zero, copy fallback, share failure without printing, mobile grid/customer transitions, and keyboard collapse behavior.
- New regressions cover start → review → edit with preserved figures, the desktop summary comparison shortcut, keyboard section jumps, field helper/error descriptions, MM/DD/YY input, and impossible-date recovery. Date unit tests include leap days and Eastern-time creation timestamps.
- A synthetic multi-product proposal was generated as an actual headless Chromium PDF without background graphics, then its pages were rendered and visually checked. Physical printer and operating-system share dialogs remain manual acceptance items.
- Dependency installation reported no known npm vulnerabilities. The app uses local fonts and browser memory; no saved-deal backend or analytics service is introduced.

## September 25 CI follow-up

GitHub runs 36066241694 and 36143119550 exposed a WebKit contrast regression missed by the earlier local validation: the Add product hover background inherited white text from the original style. The hover now explicitly retains dark blue text. Header view buttons also switch their foreground and background together to avoid a low-contrast transition. A dedicated pointer-hover regression covers Chromium and WebKit, and accessibility diagnostics now include the failing contrast/target details. The multi-surface accessibility scan requests reduced motion so smooth section scrolling cannot move touch targets while axe measures them; no accessibility rules are disabled.

## Roll to a target

Salespeople can enter a payment, out-the-door total, or amount-financed target on a financed deal, or cash due after trade / out-the-door on a cash deal. The selling-price scenario appears first and every scenario displays its resulting selling price. A blank selling price returns a price-only scenario using the entered taxes, fees, products, trade/payoff, cash down, and loan terms. Applying it still requires a complete calculated estimate and confirmed product tax treatment. Cash due means the final cash purchase balance after trade equity or payoff, not a second deduction for cash down. Each scenario changes one input; Apply recalculates the other options and supports Undo. Cent rounding can leave an explicitly displayed difference from a requested target.

Validation includes reverse-price scenarios for all four targets, positive and negative trade equity on cash purchases, preview/apply reconciliation, and a browser flow from unknown price to payment, cash target, Apply, and Undo. The first full local browser run passed 57 checks with 6 project-specific skips; a final targeted recheck covers clearing an existing price before solving.

## September 25 final release review

Three independent reviews covered calculations, customer workflows, and engineering/deployment. The calculation review checked 1,200 varied deals, 3,071 reverse targets from blank selling price, 1,073 scenario Apply/preview reconciliations, and all 2026–2029 Michigan policy boundaries. No calculation blocker was found. Michigan Treasury RAB 2022-17 was checked against the implemented allowance-based deduction schedule; trade payoff does not reduce the tax deduction.

The customer review verified actual clipboard contents, finance and cash/credit estimates, zero automated WCAG-tagged violations, no runtime errors, and no clipping at 320, 390, 760, 800, 801, 1024, and 1440 pixels. Typical finance and cash PDFs each fit one Letter page. A long-product-name stress case exposed excessive blank space; allowing the transaction ledger to split while keeping each row intact reduced it from three pages to two with all content preserved.

The review also found and fixed a real calendar keyboard race: an immediate ArrowRight then Enter could activate the previous date while deferred focus waited for an animation frame. Existing days now focus immediately; newly rendered month days focus in a layout effect. The regression covers consecutive keypresses, crossing a month boundary, leap-day selection, invalid-date recovery, and Escape/focus restoration.

The initial full local run passed 64 browser checks with six intentionally inapplicable cases skipped; two WebKit cases exhausted their 30-second test budget. Their traces showed correct totals and workflow state rather than financial assertion failures. WebKit alone now has a 45-second test budget and 10-second assertion budget to accommodate slow startup/action execution. Assertions and accessibility rules remain enabled. Final clean-source unit, browser, build, and required GitHub CI results are recorded in pull request #10 before production publication.

The engineering review found no known npm dependency vulnerabilities, tracked secrets, unsafe HTML injection, customer-data persistence, or unexpected third-party requests. HTTPS/redirects and configured security headers were checked. Live branch protection requires the Release checks status, a pull request, resolved conversations, and an up-to-date branch, including for administrators. Cloudflare publication remains a separate explicit upload of the reviewed build.

## One-page customer document refinement

The customer Print action now uses a dedicated branded Letter-page composition rather than the responsive screen ledger. A navy payment panel, numbered purchase and settlement sections, shaded product cards, selected payment option, and green Michigan trade-tax savings panel establish the hierarchy. Longer product lists become compact full-width rows. Dates remain MM/DD/YY. Snapshot-based amounts, full product names and tax treatment, all comparison totals, qualifications, and negative-equity/cash-credit distinctions are retained.

Independent actual-PDF verification covers six fixtures with backgrounds enabled and disabled: ordinary finance, cash purchase, cash customer credit, negative equity paid at signing, 12 maximum-length products, and the 50-product limit with 120-character names and four payment options. All 12 PDFs fit one Letter page, retain the complete expected text and figures, and have no text outside the page. Normal and dense renders were visually reviewed. Background settings produce stable sizing. Normal product text is 7.5pt; the maximum-capacity stress fixture uses about 5.2pt product text and smaller reference/qualification text. That extreme one-page case is dense rather than a large-print document.

The browser regression now checks actual PDF page counts, repeated printing with both background settings, all 50 names, four payment options, fitted content bounds, and return to editing. `pdf-lib` is a development-only test dependency. Chromium, mobile Chromium, and WebKit customer/export and automated accessibility checks pass. The print layout is hidden from the screen accessibility tree and removed when returning to the dealer view. Physical-printer and iPhone AirPrint settings remain manual acceptance items; browser paper, margin, and scaling overrides can affect output.

Artifact evidence: `customer-print-redesign-qa/output-final/qa-report.json` and its PDF/PNG siblings in the task artifact folder. Publication is recorded by the pull request and Cloudflare deployment, not inferred from this document.

## Customer estimate simplification and trade-cap verification

At the owner's request, customer payment options and copy/share output now omit interest-charge amounts and total loan payments while retaining APR, term, monthly payment, and deal totals. The printed trade-tax panel and proposal assumptions identify the applicable deduction limit. Payment and tax calculations are unchanged.

Michigan Treasury RAB 2022-17 and current MCL 205.51 were rechecked September 25, 2026: the qualifying motor-vehicle trade deduction is capped at $12,000 for 2026, so a sufficient taxable purchase with an $18,000 allowance saves $720 at 6%. The cap concerns the taxable-price deduction, not the trade allowance applied to the deal. Payoff does not reduce the deduction. Tests with $0/$12,000/$22,000 payoffs confirmed the same deduction and savings. Proposed SB997/SB998 had not been enacted at review time; their proposed removal of the cap was not applied.

Sources: [Michigan Treasury trade-in bulletin](https://www.michigan.gov/taxes/rep-legal/rab/2022-revenue-administrative-bulletins/revenue-administrative-bulletin-2022-17), [current MCL 205.51](https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-205-51).

## Release boundaries

Business owners must approve CRV/product tax treatment, the conservative document-fee basis, representative lender/DMS reconciliation, and any supported use beyond the documented Michigan purchase scope. Physical-device assistive-technology checks and a staff pilot remain in `ACCEPTANCE.md`.

The Pages environment was read and verified to permit the main branch. The main-branch protection status and CI evidence are recorded with the pull request. Workflow files alone do not prove repository protection.

## Review artifacts

The task's local artifact folder contains the original professional review, 22-item backlog, current visual evidence, and PDF proof:

`C:/Users/JoeGallant/.codex/visualizations/2026/09/24/01a0d4e6-462f-74e0-9109-7f4bd977c87d/`

Key files: `PROFESSIONAL-HANDOFF-REVIEW.md`, `implementation-backlog.csv`, `refined-ui-desktop.png`, `refined-ui-mobile.png`, `refined-target-grid-desktop.png`, and `refined-target-cards-compact.png`. Earlier `redesign-*` and `restored-design-*` screenshots document prior iterations. The paths are local evidence, not public deployment URLs.
