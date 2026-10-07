# Release acceptance

Use synthetic deals and record the tested commit/build, browser versions, date, and reviewer. This checklist defines acceptance; an unchecked item is not evidence of a pass. Attach local/CI results to the release record rather than hard-coding test counts that will become stale.

## Automated gate

```sh
npm ci
npx playwright install chromium webkit
npm run check:release
```

On Linux CI, browser installation includes `--with-deps`. The checked-in Playwright configuration covers desktop Chromium, mobile Chromium, and desktop WebKit. Keep test failures, screenshots, traces, and the HTML report when diagnosing a regression.

| Coverage | Required behavior |
| --- | --- |
| Calculation tests | Cent rounding, normal payment formula, zero APR, trade credit, fees (including dealership document/CRV fees, both caps, and byte-identical defaults), products, cash credit, negative financing warnings, date boundaries, the December rules-review reminder window |
| Suggestion tests | Repeated targets from blank/zero values, supported rate increments, exact preview/apply result, already-met targets, honest partial solutions |
| State/input tests | Normalized money/rates, strict input grammar, cash/finance transitions, grid synchronization, undo expiry, reset, mutually valid view/grid state |
| Proposal tests | Each ledger reconciles, upfront negative equity stays outside financing, cash credits remain valid, incomplete exports blocked, positive Other products require a name and explicit tax choice, identity/qualifications retained, immutable reference snapshot |
| Browser tests | Input-to-result flow, both release-blocking regressions, viewport layout, keyboard/collapse behavior, result visibility, taxonomy and exports, accessibility scan |
| Dealership tests | Saved name/logo/fee normalization and fallback, logo type and sizing limits, fee validation, header/estimate/printout/copied-text display, one set of fees across worksheet/grid/target/estimate/copy, persistence, Reset deal, Clear, storage failure, dialog accessibility, and the December reminder's dates, views and phone fit |

Consult the actual tests and final CI report for implemented browser assertions. Automated accessibility scans do not establish complete conformance.

## Manual checks before dealership rollout

- [ ] Build a $30,000 financed deal with blank initial down/trade. Set $450 target, apply cash down, set $400 target, and apply again. No crash; down/result values agree to cents.
- [ ] On a phone-width screen, open the payment grid and switch to Customer. Content, selected payment, amount financed, cash due, and warnings remain visible. Return to the worksheet without losing values.
- [ ] On a phone, open the app: Selling price is in the top half with no large heading or start box. Enter a price: the payment card stays slim, Trade allowance is visible without scrolling, and Details shows the totals and itemized breakdown. On a real phone in its browser (for example an iPhone 14 in Safari or a Galaxy S23 in Chrome), the shortcut row is hidden, the header and payment controls stay comfortable to tap, and Trade allowance is visible above the bottom bar after entering a price; on an iPhone SE it is a short scroll away. Rotating the phone or opening the keyboard never switches the layout mid-entry.
- [ ] Apply a price suggestion, then enter a payoff or add a product. The old Undo expires instead of deleting the new edit. Reset clears the entire deal only after the explicit reset action.
- [ ] Enter malformed money, a negative amount, and a three-decimal APR. Invalid text produces useful feedback; accepted APR precision matches the field, caption, grid, applied suggestion, and copied estimate.
- [ ] Test sale $30,000, cash down $2,000, trade $10,000, payoff $14,000. With equity paid upfront, the financed balance and cash-due groups reconcile separately. Repeat with rolled negative equity, positive equity, cash purchase, and cash customer credit.
- [ ] Select New plate with blank amount: the estimate is incomplete and export controls are unavailable. Enter a cost, switch plate modes, and confirm title/transfer fees are counted once.
- [ ] Add Service Contract, Gap, and Other. A positive Other charge cannot be exported until it has a name and an explicit Taxable or Not taxable selection. Verify both tax choices affect all outputs consistently and that changing the category to Other requires a fresh choice.
- [ ] Compare 320/390/760/761/900/1024/1280/1440px and 200%/400% zoom with long product names and populated suggestions. No input/value/button clipping or overlapping sections.
- [ ] Use only the keyboard: visible focus on all surfaces, no focus inside collapsed panels, logical destination focus after jumps, and usable grid return. Check Windows forced colors and reduced motion. Verify selected scenarios without relying on color.
- [ ] Use NVDA or VoiceOver to verify labels, tables, selected scenario, collapsed sections, field errors, and status messages. Check a physical iPhone/Android device; emulation does not prove native Share or keyboard behavior.
- [ ] Copy finance and cash summaries into plain text. Confirm the Payment Desk heading, date/reference/version, vehicle reference when supplied, APR/payment cents, products, trade/payoff, cash requirements, assumptions, and estimate qualifications.
- [ ] In Dealer view, open Settings, add a dealership name and a wide transparent logo, and save. Confirm the header (desktop and a 375px phone), customer estimate, printed estimate, and copied/shared summary show the dealership; reload and Reset deal keep it; Clear dealership settings restores Payment Desk. Repeat with site data blocked in the browser's settings (or with storage full) and confirm the could-not-save message; private windows in current Safari, Chrome and Firefox still allow storage writes, so they will not show it.
- [ ] Try clipboard/native-share denial and cancellation. The app provides recovery without unexpectedly opening Print. Generic calculator links are clearly labeled and not described as saved deals.
- [ ] Print/save PDF from a supported normal browser with background graphics disabled. Check paper pagination, legibility, identity/reference, selected payment and complete qualifications for multi-product and credit cases. Browser print-media emulation alone is insufficient.
- [ ] **On every device the dealership uses**, open Settings → Fees and enter the approved document fee and CRV dealer fee (or leave a field blank for the $280/$34 default), then save. With a $30,000 financed deal, confirm the worksheet fee lines, payment, payment grid, a target suggestion, the customer estimate ledger and assumptions, the printout, and the copied summary all show those fees. Enter a $3,000 selling price and confirm the document fee drops to 5% ($150) when the setting is higher. Try $281 and a three-decimal amount: the dialog explains the problem and will not save. Reload and Reset deal keep the fees; Clear dealership settings restores $280/$34.
- [ ] Check the policy review boundary: a 2027 date uses the scheduled trade cap but requires updated fee/tax review before export. Verify low-price documentary-fee examples against the approved dealership basis. With the device date set to December 1–31, 2026, Dealer view shows the rules-review reminder under the header (two lines at most on a phone) and Customer view does not.
- [ ] Reload or close a changed deal and verify the stated warning behavior, acknowledging browser limitations. Confirm no saved-deal/offline promise and no external font request.

## Business and operational acceptance

- [ ] Named policy owner confirms CRV, product tax treatment, supported deals, document-fee basis, and representative lender/DMS reconciliation, and has set the approved document and CRV fees on every device.
- [ ] Before December 1 of the final review year, an owner is scheduled to review the tax and fee rules and release an updated `policy.js` before January 1.
- [ ] Repository/domain ownership, recovery access, permitted maintainers, and approved code/brand rights are recorded.
- [ ] Main's required check/review rules and Pages environment restrictions are verified in GitHub; their presence cannot be inferred from YAML alone.
- [ ] Release/rollback procedure is exercised with a reviewed change and its build ID. Deployment failure notification and support ownership are agreed.
- [ ] Staff pilot observes a normal deal, target adjustment, term comparison, error recovery, and customer explanation. Record completion time, correction count, and whether cash due/financed balance were understood.

Only claim release acceptance for the checks actually completed. Keep unresolved business approval or physical-device/printing checks visible in the handoff.
