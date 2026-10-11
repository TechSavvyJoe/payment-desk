# Workspace upgrade — October 11, 2026

## Brief

Make Payment Desk easier to use repeatedly through a dealership day: preserve named alternatives, return to earlier worksheets, compare actual calculated figures, recover clearly from storage/connection failures, and keep a compact readable desktop/phone/companion interface. Existing Michigan purchase scope, device-local data and customer PDF guards remain requirements.

## Current audit evidence

Fresh in-app-browser captures on October 11:
- `/tmp/payment-desk-upgrade-20261011/before-desktop.png`: blank desktop, 1280×720.
- `/tmp/payment-desk-upgrade-20261011/before-estimate.png`: populated worksheet, 450×800.

Code and visible baseline show one autosaved draft with no named worksheet library; mobile persistence status is in the footer. Existing price entry, grid, target solver, customer estimate, PDF sharing, brand settings and inventory flows remain valuable. The library addresses switching deals and keeping alternatives without creating cloud accounts. Inventory cancellation and misleading storage errors are separate source-confirmed recovery defects.

## Visual target and implementation inventory

Concept: `../design/workspace-concept.png` (built-in ImageGen, October 11). Reference screenshots above ground the concept.

- Keep IBM Plex Sans, navy #00095b, electric blue #066fef, gray #dce3ed, white bordered sections and tabular figures.
- Replace the introductory slogan with **Current worksheet**, truthful draft save status, **Saved worksheets** and **Save worksheet**. On phones the heading stays accessible but visually hidden; Save and Saved fit beside Inventory in the existing Deal details row, adding no height. The collapsed date moves inside Deal details on phones. The footer retains draft storage status.
- A single native modal contains search, a named save-copy form, newest-first records, explicit Open/More actions, and comparison. No new permanent sidebar.
- Exact actions: **Search worksheets**, **Worksheet name**, **Save a copy**, **Open**, **Rename**, **Update with current worksheet**, **Delete**, **Cancel**, **Reload list**, **Close**.
- Always display **Stored in this browser only. Opening recalculates with current fees and rules.** Saved copies only change explicitly. Reset retains the library.
- Compare current inputs with up to two ready saved copies: vehicle/stock, estimate date, status, price, payment or cash credit/due, term and assumed APR, signing cash, financed balance, out-the-door total and total interest. Different vehicles are labeled. Incomplete inputs never present a ready payment.
- Desktop uses aligned rows; phones use fully labeled stacked comparison cards. Controls remain keyboard accessible, at least 44px in the new library, with clear focus, Escape, initial focus and return focus.
- Motion is limited to existing interaction feedback. No animation delays or decorative assets are needed in the worksheet.

## Deliberate concept corrections

Generated concept figures are illustrative, not calculation truth. Production figures must come from calculateDeal/getDealSummary. Preserve the existing product editor instead of the mockup's invented product checkboxes. Keep full existing payment detail controls and disclosure behavior. Show cash credit distinctly from cash due. Keep actual font metrics and responsive breakpoints. The library's dark title bar follows the existing dialog family rather than introducing another header style.

## Brand

Three original vector directions are in `design/brand`. The integration selects **Desk D** for app/install/companion icons, retaining established app colors and a mask-safe inset. Header text and custom dealership identity remain unchanged in width. The separate vector kit records the designer's original Open Ledger preference; no trademark clearance is claimed.

## Safety and validation contract

Named copies use separate versioned local storage and Web Locks; exact-byte conflict checks, bounded fields/count/size, quota reporting and future/corrupt-record preservation. No customer account or personal information fields. No automatic overwrite of another tab. Restore remounts inputs, replaces targets/raw text and clears stale undo/UI state. Current device fees and policy always recalculate saved inputs; no historical quote totals are persisted.

Run targeted behavior tests, existing phone density tests, relevant native companion flows, complete release checks and a separate reviewer. Record rendered acceptance and limitations in `design-qa.md` and release evidence; passing tests alone do not prove physical-phone sharing or nationwide coverage.
