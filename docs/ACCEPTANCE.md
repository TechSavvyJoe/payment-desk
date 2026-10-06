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
| Calculation tests | Cent rounding, normal payment formula, zero APR, trade credit, fees, products, cash credit, negative financing warnings, date boundaries |
| Suggestion tests | Repeated targets from blank/zero values, supported rate increments, exact preview/apply result, already-met targets, honest partial solutions |
| State/input tests | Normalized money/rates, strict input grammar, cash/finance transitions, grid synchronization, undo expiry, reset, mutually valid view/grid state |
| Proposal tests | Each ledger reconciles, upfront negative equity stays outside financing, cash credits remain valid, incomplete exports blocked, positive Other products require a name and explicit tax choice, identity/qualifications retained, immutable reference snapshot |
| Browser tests | Input-to-result flow, both release-blocking regressions, viewport layout, keyboard/collapse behavior, result visibility, taxonomy and exports, accessibility scan |
| Dealership tests | Saved name/logo normalization and fallback, logo type and sizing limits, header/estimate/printout/copied-text display, persistence, Clear, storage failure, and dialog accessibility |

Consult the actual tests and final CI report for implemented browser assertions. Automated accessibility scans do not establish complete conformance.

## Manual checks before dealership rollout

- [ ] Build a $30,000 financed deal with blank initial down/trade. Set $450 target, apply cash down, set $400 target, and apply again. No crash; down/result values agree to cents.
- [ ] On a phone-width screen, open the payment grid and switch to Customer. Content, selected payment, amount financed, cash due, and warnings remain visible. Return to the worksheet without losing values.
- [ ] On a phone, open the app: Selling price is in the top half with no large heading or start box. Enter a price: the payment card stays slim, Trade allowance is visible without scrolling, and Details shows the totals and itemized breakdown.
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
- [ ] Check the policy review boundary: a 2027 date uses the scheduled trade cap but requires updated fee/tax review before export. Verify low-price documentary-fee examples against the approved dealership basis.
- [ ] Reload or close a changed deal and verify the stated warning behavior, acknowledging browser limitations. Confirm no saved-deal/offline promise and no external font request.

## Business and operational acceptance

- [ ] Named policy owner confirms CRV, product tax treatment, supported deals, document-fee basis, and representative lender/DMS reconciliation.
- [ ] Repository/domain ownership, recovery access, permitted maintainers, and approved code/brand rights are recorded.
- [ ] Main's required check/review rules and Pages environment restrictions are verified in GitHub; their presence cannot be inferred from YAML alone.
- [ ] Release/rollback procedure is exercised with a reviewed change and its build ID. Deployment failure notification and support ownership are agreed.
- [ ] Staff pilot observes a normal deal, target adjustment, term comparison, error recovery, and customer explanation. Record completion time, correction count, and whether cash due/financed balance were understood.

Only claim release acceptance for the checks actually completed. Keep unresolved business approval or physical-device/printing checks visible in the handoff.
