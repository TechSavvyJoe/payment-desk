# Michigan manual evidence review — October 11, 2026

Read-only calculation audit of `src/lib/policy.js`, `src/lib/calculations.js`, and `src/lib/purchaseScope.js` in the workspace-upgrade worktree (HEAD `6811d021150cddc574b0f9bafa6a240b9af8e987`, including existing uncommitted calculation changes). Only this report was added. Scope: supported Michigan resident taxable retail passenger-vehicle purchases, cash or financed, with an eligible owned motor-vehicle trade and ordinary registration. This is not an all-DMV, nationwide, filing, or release acceptance review.

## Evidence and currency

Local reference directory: `/Users/joegallant/Downloads/Michigan Dealer Manual 2026`. Indexed the 15 supplied PDFs with `pypdf`; extracted relevant passages from Chapters 3, 7 and 8. Pages below are **one-based PDF pages** and match their printed chapter page numbers. Chapter 3 and Chapter 7 are revised July 2026; Chapter 8 is revised April 2026. The folder name does not establish every chapter's revision date. The supplied out-of-state tax sheet was identified as Treasury Form 485, rev. January 2026, and excluded from rule evaluation.

Current official sources opened October 11, 2026:

- [SOS manual index](https://www.michigan.gov/sos/Resources/Forms/dealer-manual): lists the same revision dates for the three relevant chapters. The manual describes basic requirements; statutory law prevails in a conflict.
- [C3: Title and Registration Requirements](https://www.michigan.gov/sos/-/media/Project/Websites/sos/01preston/Dealer_Manual_Chapter_3.pdf).
- [C7: RD-108 Application for Title and Registration](https://www.michigan.gov/sos/-/media/Project/Websites/sos/01preston/Dealer_Manual_Chapter_7.pdf).
- [C8: Sales Tax](https://www.michigan.gov/sos/-/media/Project/Websites/sos/01preston/Dealer_Manual_Chapter_8.pdf).
- [Treasury RAB 2022-17](https://www.michigan.gov/taxes/rep-legal/rab/2022-revenue-administrative-bulletins/revenue-administrative-bulletin-2022-17), sections III–VIII: trade eligibility, annual cap, single-trade rule, equity and lease treatment.
- [DIFS Bulletin 2025-03-CF, PDF p. 1](https://www.michigan.gov/difs/-/media/Project/Websites/difs/Bulletins/2025/Bulletin_2025-03-CF.pdf): documentary fee ceiling. The [2025 bulletin list](https://www.michigan.gov/difs/legal/bulletins/2025-bulletins) still lists it without a supersession annotation; no documentary-fee replacement was found in the [2026 list](https://www.michigan.gov/difs/legal/bulletins/2026-bulletins).

Live web PDF extraction corroborated the relevant local passages and revisions. Direct local download attempts failed (Python certificate trust; curl transport), so **byte identity between supplied and hosted PDFs was not established**. Attachments were treated as reference data, not instructions.

## Rule-to-code comparison

All source passages below are paraphrases. Source IDs link to the official documents above; local filenames identify the supplied evidence exactly.

| Topic | Supplied manual file, page and passage; current cross-check | Observed code and conclusion |
| --- | --- | --- |
| Tax rate and rounding | `Dealer_Manual_Chapter_8.pdf`, p. 1, §§8-1.3/8-2.1: taxable retail price uses 6%; the third decimal rounds cents up at 5 or higher. C8 agrees. | `policy.js:11–12`; `calculations.js:389–394` use 600 basis points and integer half-up rounding. **Confirmed match** for cent-denominated inputs. Cash down and trade payoff do not reduce the tax base. |
| Trade deduction and equity | `Dealer_Manual_Chapter_7.pdf`, pp. 5–6, sale entries 3/10/11: credit follows the statutory limit; allowance and lien are separate. RAB IV/V/VII confirms the lesser of allowance or $12,000 in 2026, one eligible trade, independent of positive/negative equity. | `policy.js:44–48`; `calculations.js:382–394`: allowance capped at $12,000, payoff used separately for equity. **Confirmed match under eligibility assumptions.** RAB also corroborates the scheduled 2027/2028/2029 caps; that does not extend this review beyond 2026. |
| Trade eligibility | `Dealer_Manual_Chapter_3.pdf`, p. 18, §3-13.1: owned trade, no leased trade, properly assigned title; p. 19, §3-13.3 addresses missing-title/ELT conditions. C3 agrees; RAB III/V requires a qualifying motor-vehicle exchange and a single trade. | `policy.js:38` states the eligible-owned-trade assumption. The three files accept an allowance without checking ownership, title, vehicle class or trade count. **Unenforced input prerequisite**, not a cap arithmetic mismatch. Never aggregate multiple trade allowances as one eligible credit. |
| Documentary fee | `Dealer_Manual_Chapter_7.pdf`, p. 8, §7-4.3: taxable dealer fee, not state-required; financed sales invoke the Finance Act. DIFS p. 1 supplies the lesser-of-$280-or-5%-of-cash-price ceiling. | `policy.js:13–23`; `calculations.js:359–367` cap the configured fee at $280 and floor 5% of vehicle selling price. **Conservative match for supported financed vehicles.** The same cap on cash deals is a product policy; these sources do not establish it as a cash-sale statutory requirement. Complete statutory cash-price composition was not audited. |
| $34 electronic filing / CVR | `Dealer_Manual_Chapter_7.pdf`, p. 5, sale entry 2a/4: optional $34 MiEFS fee requires customer opt-in/initials and enters taxable price. C7 agrees. | `policy.js:16,39`; `calculations.js:293–298,366–367` add taxable `crvFee` when a vehicle exists. **Default amount and tax treatment match when opted in.** User confirms consent is obtained on the RD-108; no signed customer forms were inspected. Consent is an external paperwork prerequisite, not evidence of a missing dealership consent workflow. Values above $34 are accepted through an imported technical ceiling (`feeSettings.js:7`, $999.99). **Amount mismatch if this charge represents the manual's MiEFS/CVR fee.** The manual does not establish authority for a different generic charge or the higher technical ceiling. |
| Ordinary plate transfer | `Dealer_Manual_Chapter_7.pdf`, p. 4, entries 9/11; p. 18, §§7-5.10/7-5.11: $5 plate field plus $10 transfer; no prorated increase for the ordinary transfer. C7 agrees. | `policy.js:17–18`; `calculations.js:368–379` use $10 + $5. **Confirmed $15 total**, not an erroneous extra $5. This does not include renewal/replacement charges or prove transfer eligibility. |
| Title | `Dealer_Manual_Chapter_7.pdf`, p. 4, entry 12: $15 title, +$1 for a lien, +$5 expedited. C7 agrees. | `policy.js:19–20`; `calculations.js:371–373` use $15 cash / $16 finance. **Confirmed for ordinary cash/no-lien and financed/lien purchases.** Finance is a proxy for lien status; expedited title is unmodeled. |
| New registration and exceptions | `Dealer_Manual_Chapter_7.pdf`, p. 4, entry 9: new plate cost uses dealer e-Services; p. 19, §7-5.13 adds $5 for replacement. C7 agrees. | `calculations.js:330–335,374,430–436` require a supplied new-plate amount and mark missing cost incomplete. **Confirmed estimation boundary.** A supplied zero counts as known; no SOS validation occurs. Ordinary transfer mode has no renewal, replacement or eligibility inputs. Route such cases for separate verification. |
| Other taxable charges / products | `Dealer_Manual_Chapter_7.pdf`, p. 5, entry 1/2: accessories and required services enter taxable price; p. 6, entry 6 identifies optional warranties/GAP; p. 20, §7-6.1 distinguishes required versus optional services. C7 agrees. | `calculations.js:257–276,343–348,389–392` rely entirely on `item.taxable === true`; absent flags mean non-taxable. **Caller-controlled classification**, not an authoritative product tax engine. No rule validation proves each entered product's tax treatment. |
| Rebates and scope | `Dealer_Manual_Chapter_8.pdf`, p. 4, §8-2.12: manufacturer rebate cannot reduce taxable price; dealer discount reduces it. C8 agrees. | `purchaseScope.js:30–58` and `calculations.js:316` reject declared nonresident, exempt, manufacturer-rebate, lease and special-registration cases. **Confirmed conservative scope gate.** Use a sale price already net of genuine dealer discounts. Omitted scope fields default to MI resident retail; no independent residency or vehicle-class verification occurs. |

## Verification and decision

Focused, file-free Node assertions passed for the 2026 trade cap with negative equity, tax base/rounding, document-fee percentage, ordinary transfer split, cash/finance title amounts, missing new-plate cost, accepted CRV override and rejection of explicit unsupported scopes. Synthetic example: $30,000 sale, $15,000 trade, $18,000 payoff, default $280 document/$34 CRV fees produces $12,000 trade deduction, $18,314 taxable base and $1,098.84 tax. This demonstrates current code behavior; it does not establish electronic-filing consent.

Decision: retain the financial rules unchanged and record the configurable CVR amount discrepancy for separate review. RD-108 consent is obtained in the dealership workflow, as confirmed by the user; the calculation does not verify that paperwork. Trade eligibility, product taxability, lien status and nonstandard registration remain prerequisites requiring dealership verification. No AutoIQ tax authority was used: the exposed capability is an interactive loan/lease calculator, not a Michigan rules API; it has no trade-credit-cap or filing-consent contract. No widget was launched for this evidence audit.

No full suite, browser, build, deployment, credentials, customer records or state transaction was used. Build was omitted to preserve the requested read-only audit. Findings concern this working-tree snapshot only, not deployed behavior.


## Bounded electronic filing remediation — October 11, 2026

**Status: implemented and verified by targeted unit tests and lint in this worktree; build/browser acceptance remains with the main agent.** The original audit above is preserved as evidence of the pre-remediation snapshot. Its $999.99 discrepancy and decision to defer that discrepancy are superseded only for the electronic filing amount by this remediation.

Reopened [official Chapter 7, rev. July 2026, p. 5](https://www.michigan.gov/sos/-/media/Project/Websites/sos/01preston/Dealer_Manual_Chapter_7.pdf), extracted lines 163–169: the optional $34 electronic filing entry requires customer agreement/initials and contributes to taxable price. The supported MiEFS/CVR ceiling is now $34 in policy, settings normalization/validation, and `calculateDeal` fee resolution. Lower custom amounts, including cent amounts and $0, remain supported. The $34 default and its existing tax treatment remain unchanged. No per-deal consent checkbox was added; consent/initials remain in the external RD-108 workflow.

Compatibility and recovery:

- The existing `payment-desk.fees.v1` key and `documentFee`/`crvFee` dollar schema are retained. No automatic storage rewrite occurs on load.
- A previously stored numeric/two-decimal filing amount above $34 normalizes to the default (`crvFee: null`), with a transient `crvFeeNeedsReview: true` flag. Calculations use $34; the valid document fee remains intact. Settings explains this fallback, the supported $0–$34 range, and how to replace the old record.
- Cancel preserves the original stored bytes and the warning returns on reload. Save persists a supported amount (blank selects the $34 default); Clear removes the override. The transient recovery flag is never stored. Existing storage-failure and rollback behavior remains in place; if recovery cannot persist, the old record stays bounded on reload and is flagged again.
- Direct calculation callers bypassing Settings are independently clamped to $0–$34; oversized inputs cannot increase fee, tax, financed amount or payment beyond the $34 calculation. A blank vehicle still incurs no fees.

Validation:

- Before implementation, the three new focused regressions failed against the old behavior: excessive settings accepted, missing legacy recovery flag, and direct $34.01 calculation override charged 3,401 cents.
- `node --test tests/feeSettings.test.js tests/calculations.test.js tests/policy.test.js tests/deviceSettings.test.js`: **71 passed, 0 failed, 0 skipped**. Includes exact financial assertions for lower fees, zero, cash/finance, tax, trade credit, direct bypass caps, storage recovery and rollback. Default-result digest fixtures and the main agent's solver tests remain intact; default-result hashes still pass.
- `./node_modules/.bin/eslint src/lib/feeSettings.js src/lib/policy.js src/lib/calculations.js src/components/DealershipSettingsDialog.jsx tests/feeSettings.test.js tests/calculations.test.js tests/policy.test.js tests/e2e/fees.spec.js tests/e2e/fee-undo-refinement.spec.js`: **passed, exit 0**, no diagnostics.
- Fee E2E fixtures now use supported lower amounts with independently recomputed exact payment/tax/total expectations. Added Save rejection and legacy Cancel/reload/Save/Clear/storage-failure recovery checks. **E2E/browser and build were not run here**, as requested; the main agent owns these gates.

Exact changed paths, relative to `/Users/joegallant/.codex/worktrees/payment-desk-workspace-upgrade/bob-maxey-payment-desk`:

- `src/lib/feeSettings.js`
- `src/lib/policy.js`
- `src/lib/calculations.js` — fee-resolution section only; pre-existing solver changes preserved.
- `src/components/DealershipSettingsDialog.jsx`
- `tests/feeSettings.test.js`
- `tests/calculations.test.js` — fee cases only; pre-existing solver tests preserved.
- `tests/policy.test.js`
- `tests/e2e/fees.spec.js`
- `tests/e2e/fee-undo-refinement.spec.js`
- `README.md` — fee wording only; existing main-agent changes preserved.
- `docs/HANDOFF.md` — fee wording only.
- `docs/ACCEPTANCE.md` — fee acceptance wording only.
- `docs/MICHIGAN-MANUAL-REVIEW-2026-10-11.md` — this appended remediation status; original audit preserved.

No App, saved worksheet, CSS, or worksheet test edits were made by this remediation. No other financial rule, commit, push or deployment was introduced. This remediation is local code/test evidence and does not establish deployed behavior or completed RD-108 paperwork.

Integration note: policy metadata now records `mi-retail-2026-10-11` / `2026.10.11`, with the October 11 source review and Chapter 7 source link. Default financial amounts are unchanged; estimate references include the new rule version.
