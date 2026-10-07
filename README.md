# Payment Desk

A browser-based **Michigan vehicle purchase estimator** for dealership conversations. Build a deal, compare payments, and prepare an itemized customer estimate. It is not a lender approval, contracting system, or replacement for the dealership's approved deal figures.

## Start and verify

Use Node.js 22 (see `.nvmrc`) and the committed lockfile.

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

```sh
npm run check
npm run check:release
```

- `check`: lint, unit/regression tests, and production build.
- `check:release`: the same checks plus Playwright against the built site.
- `test:e2e`: browser tests only; run `build` first if the output is stale.
- `test:extension`: builds the unpacked Chrome companion, loads it in a separate Chromium profile, and verifies its native side panel, offline worksheet, capture and reviewed import.
- Browser projects: desktop Chromium, mobile Chromium, and desktop WebKit. Linux CI installs their OS dependencies with `playwright install --with-deps`.

Browser checks start their own preview server. If port 4173 is occupied, use an unused port, for example `PAYMENT_DESK_TEST_PORT=4189 npm run check:release`; the checks never reuse an unrelated project's server.

## Workflow

**Chrome companion.** [Install Payment Desk Companion](extensions/payment-desk-companion/README.md) to use the full worksheet in Chrome's side panel beside a listing, with offline calculations, optional listing capture, and a saved dealership inventory picker. Supported website connectors can refresh new/used inventory nightly while Chrome is running. Inventory is saved only in the extension on this computer; a vehicle is reviewed before replacing a deal. Open **Web app** from the companion once to connect the web app in that Chrome browser, then select **Inventory** beside **Deal details** to use the same catalog. Dealership settings are local to the extension and separate from the website. See [inventory source coverage](docs/COMPANION-INVENTORY.md). Run `npm run extension:package` to build the worksheet and create the installable ZIP in `extension-dist`.

Enter a selling price, date, optional vehicle/stock reference, trade allowance/payoff, and down payment. Select finance or cash and transfer or new plates. Enter new-registration cost when required.

Products use **Service Contract**, **Gap**, or **Other**. Before a positive Other charge can be exported, enter a name and explicitly select **Taxable** or **Not taxable**. Verify each product's taxability; category selection does not establish eligibility or tax advice.

Payment results are outputs. **Set payment target** opens the target tool; suggestions show the result they will apply. An Undo expires after a later deal edit. Customer view provides the selected payment, reconciled charges/trade/cash, assumptions, and separate Copy summary, Share, and Print actions. Incomplete or invalid deals cannot be exported through these controls.

**Dealership name, logo and fees.** In Dealer view, select **Settings** (the gear) to add an optional dealership name and logo and to set the dealership's document fee and CRV dealer fee. The name and logo appear in the header, on the customer estimate, on the printout, and on the first line of copied or shared summaries, with a small Payment Desk credit in the header and printout. The fees apply to every figure: worksheet, payment, payment grid, target suggestions, customer estimate and copied text. Everything here is saved only on that device; with nothing saved, the app shows Payment Desk and uses the default fees. **Clear dealership settings** removes the name, logo and fees together; **Reset deal** never touches them.

## Rules and limits

- Michigan 6% tax and eligible trade credit by deal date: $12,000 in 2026, $13,000 in 2027, $14,000 in 2028, and no scheduled cap from 2029.
- The current fee/tax review window ends **December 31, 2026**. Later dates show the scheduled credit but require policy review before proposal export. From 30 days before the window ends (December 1), Dealer view shows a slim reminder under the header to have the rules reviewed and the app updated before January 1.
- **Document and CRV fees are dealership settings** (Settings → Fees), saved per device. Blank uses the default. Both fees are taxable.
  - Document fee: default $280. Whatever is entered, the fee charged is never more than $280 or 5% of the selling price, rounded down to cents. The dealership must confirm the approved contract basis.
  - CRV dealer fee: default $34, from $0 to $999.99. It is a dealership charge, not a represented state mandate.
  - Estimate assumptions state the amounts actually charged on the deal.
- APR is normalized consistently to two decimal places. Payments use regular monthly amortization; interest and total payments are estimates, not a verified lender installment schedule.

Leases, nonresident/exempt transactions, special registrations, and manufacturer rebates are outside the current model. Do not disguise a manufacturer rebate as a selling-price discount. Sources and assumptions are versioned in [policy.js](src/lib/policy.js).

## Data and operation

Entered figures remain in browser memory unless the user copies, shares, or prints them. The app saves the optional dealership name and logo, the dealership's fees, and the public identifier of a connected companion in this browser's local storage on this device; customer figures are never saved. On a shared device, use **Settings → Clear dealership settings** to remove dealership presentation and fees. The optional inventory catalog remains in the companion until disconnected there. There is no saved-deal backend, analytics SDK, or external font request. Hosting still serves ordinary web requests. Refresh/close can lose the deal; a navigation warning is a convenience, not storage or recovery. Installation metadata does not provide offline availability.

[Handoff and release guide](docs/HANDOFF.md) · [Acceptance checklist](docs/ACCEPTANCE.md) · [Review resolution map](docs/REVIEW-RESOLUTION.md)
