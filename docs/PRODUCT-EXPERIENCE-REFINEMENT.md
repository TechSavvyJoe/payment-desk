# Payment Desk 2.2: decision and recovery refinement

The working pencil keeps its navy identity, raised worksheet cards, local data and prominent payment. This refinement improves decisions and recovery within the reviewed Michigan resident cash/finance scope. It does not establish nationwide rules, lender programs, dealer accounts or contracting capability.

## Accepted changes

- A summary shortcut preserves an existing customer payment target, including unfinished invalid typing.
- Missing-field warnings return directly to the relevant product name, tax choice, registration estimate or erroneous input. Proposal/export guards still make the validity decision.
- Grid rate edits are comparison assumptions. Selecting a candidate commits its exact term/rate/cash only if that resulting proposal passes the same guards used for exports. A valid candidate can repair excessive current cash down.
- Grid selection and a Cash switch with nonzero financing down expose the existing one-step Undo. Any subsequent numeric draft edit, including invalid typing, expires it. The Cash calculation still clears financing down; Undo restores the prior financing deal and selected target mode.
- Payment + cash limits enumerates the existing allowed terms at entered rate assumptions. It fixes vehicle price, trade, products and fees, and constrains the calculated monthly payment and all cash due at signing. Upfront negative equity counts toward the cash ceiling. Apply is explicit.
- Term decisions show calculated total interest and its signed change, using cent outputs rather than rounded monthly payment times term. Rate assumptions and lender-confirmation boundaries remain visible.
- Customer payment alternatives lead directly to the guarded grid. Actual PDF sharing remains distinct from copying text, and secondary export buttons have quieter styling.
- Inventory setup explains the Chrome catalog connection and differentiates never completed, partial/retained and filtered-empty catalogs. Permissions, connector algorithms and last-seen safeguards are unchanged.
- Local-save feedback stays near the working pencil, and storage/conflict failures appear before the worksheet.

## Design acceptance

Reference: generated desktop/narrow concept, then actual local captures at 1440, 450 and 390 pixels. The final implementation retains the existing application information architecture; conceptual mockup figures are not financial evidence.

| Comparison | Accepted implementation decision |
| --- | --- |
| Header and narrow toggle | Retain the existing one-row navigation and accessible icon actions; the concept's wrapped toggle was not adopted. |
| Worksheet density | Preserve both desktop input columns and full-width narrow cards. Status does not replace inputs or totals. |
| Primary payment | Preserve the large navy payment figure and separate cash/loan/out-the-door totals. |
| Budget setup | Place both limits together on desktop and 450px; stack at 440px and below. Remove duplicate explanatory paragraphs. |
| Single valid budget option | Expand its card into available space with aligned financial metrics instead of leaving two empty comparison columns. |
| Decision controls | Real minimum-height controls, keyboard focus and explicit Apply/Undo remain; small mockup controls were not copied. |
| Readiness and recovery | Pair colored surfaces with text and an action; success means ready for customer review, never lender approval. |
| Financial text | Use actual calculated cents. Invented concept example amounts are not copied into the application. |

On phones, the Ready badge shares the existing payment-label row so complete estimates retain the original slim-card height budgets. Required corrections and active Undo still receive visible space. Duplicate product names retain separate recovery identities; a blocked grid points to its candidate's offending input rather than an unrelated valid worksheet field.

Apple's [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) and [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) guidance informed grouping and nearby action feedback. The [VinSolutions product sheet](https://www.vinsolutions.com/choose/wp-content/uploads/sites/3/2023/12/2024-VinSolutions-Desking-Product-Slick.pdf) supports the value of explicit scenario comparison. These references do not confer endorsement or vendor integration access.

## Draft and rollback contract

Draft format **3** uses the existing `payment-desk.draft.v2` storage slot and released writer's lock. Supported v1/v2 records migrate without altering committed deal figures; the former matching-rate invariant still applies when reading those older formats. Format 3 can keep the active worksheet rate separate from comparison rates and stores the optional cash ceiling and its unfinished numeric draft.

The actual released v2 writer is exercised from Git history: it rejects and preserves format 3 rather than overwriting it, while an already-open v2 writer conflicts on changed bytes. A rollback to 2.1 preserves newer draft bytes but cannot restore them. Reload a compatible current app; do not discard a newer worksheet merely to run the older version. Reset deliberately clears the current worksheet and comparison constraints, with dealership settings separate. No worksheet or inventory is sent to a new service.

The license-notice generator normalizes dependency-license line endings before composing notices so a fresh install does not mark a content-equivalent release as modified.

## Acceptance boundary

The final gate must verify the exact source tree, full regression checks, packaged native companion, actual desktop/narrow renders, accessibility, current PDF export, and deployed asset/build identity. Isolated browser checks do not prove delivery through a physical phone's Messages app. Inventory fixtures do not establish universal website compatibility. Nationwide automatic tax needs the licensed provider and acceptance gates in [ATC requirements](ATC-INTEGRATION-REQUIREMENTS.md) and [coverage ledger](NATIONWIDE-COVERAGE.md).
