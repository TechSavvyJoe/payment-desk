# Payment Desk interface

The interface keeps the established navy-blue identity: a navy header and payment summary, raised white cards, bold labels, and clearly editable figures. Refinements should improve this direction rather than replace it with a flat worksheet.

## Hierarchy and layout

- The selling price starts a deal. Purchase type belongs beside it in Vehicle.
- Trade and Financing share the left desktop column. Taxes and Products share the right column. Financing stays visible while products are added.
- The payment is the primary result; amount financed, out-the-door total, and due at signing remain visible together.
- Compare payments and Set payment target are adjustment paths. Review customer estimate is the primary next action. Edit deal returns to the existing figures.
- The compact mobile summary stays slim, showing the payment and its actions; the totals open with Details. This leaves the first input within the opening screen at 390 × 844. Existing sticky shortcuts remain available.
- Target adjustments use separate bordered cards on a tinted grid. The title, adjustment amount, and Apply action share a compact header; the resulting payment and three financial totals sit below. Keep qualification notes visible and omit repeated result sentences. Desktop compares cards side by side; mobile stacks them.

## Shared visual rules

| Element | Treatment |
| --- | --- |
| Brand | Navy `#00095b`; interactive blue `#066fef` |
| Canvas | Cool gray `#dce3ed`, white cards, soft elevation |
| Section identity | Navy Vehicle, blue Trade, teal-blue Taxes, muted blue Products; named headings and icons accompany every color |
| Typography | Locally bundled IBM Plex Sans, dark readable labels, tabular financial figures |
| Controls | At least 44px high for primary interactive targets; visible borders and keyboard focus |
| Success | Green only when a target is met and no product setup remains |
| Needs action | Blue for product setup, neutral for a remaining target gap, red for actual input errors |
| Dates | MM/DD/YY for user-facing dates; ISO dates retained internally for rule selection and identifiers |

## Component states and behavior

- **Empty estimate:** explanatory text and Enter selling price replace a misleading zero payment and initial error alert. The payment grid provides the same starting action. On phones (≤800px) the dealer worksheet opens at the inputs: the page heading is visually hidden (kept for screen readers and focus), the start card is omitted, and the bottom bar offers Enter selling price.
- **Phone payment card:** once a price exists, the card shows the payment line, any warnings, and Details plus Review customer estimate. Totals and the itemized breakdown open with Details, so the Trade section stays on the first screen.
- **Short phones:** when the device screen's long side is 800px or less (iPhone SE 375x667, and Androids up to 360x800, including the Galaxy S22–S24 at 360x780), `html.compact-height` tightens the header, payment card, Details row and section rows, and hides the section shortcut row, so Trade allowance is fully visible above the bottom bar on the first screen after a price. The mode is keyed to the device screen, not the viewport, so it is orientation-independent and does not re-flow when the on-screen keyboard shrinks the viewport while someone types. 360x640 is the known tightest case (Trade allowance still sits about 14px under the bar). From 801px (375x812 and taller phones) the regular layout already fits Trade allowance above the bar, so it keeps the shortcut row; tablets and desktop are unchanged.
- **Invalid input:** retain the user's draft and last valid calculation; show the error and focus its field before moving to a customer estimate.
- **Section disclosure:** the header is a button with expanded state. Hidden inputs leave the keyboard order. A section shortcut focuses the header so Enter or Space can reopen it.
- **Field instructions:** helper text and validation messages both remain associated with the input.
- **Estimate review:** navigates to the complete customer ledger and focuses its heading. Export restrictions continue to reflect whether the estimate is complete.
- **Product choices:** Service Contract, Gap, and Other retain the same amounts and explicit tax-treatment rules.
- **Motion:** focus navigation respects reduced-motion preferences. Color is never the only status indication.
- **Print:** use the dedicated Letter-page customer composition: branded masthead, navy payment panel, numbered purchase/settlement sections, green trade-tax savings, itemized products, and outlined payment options. The print portal is separate from the responsive screen layout. Preserve all financial figures, full product names, tax treatment, and qualifications; never hide or truncate them to fit.
- **Dealership identity:** an optional saved name and logo replace the PAYMENT DESK wordmark, with a small PAYMENT DESK credit. Logos sit on a white chip in the navy header so dark artwork stays visible. The view toggle and header buttons never shrink for the brand, at any width: from 801px they keep their text labels on one line, from 441px to 800px they are 42px icon buttons, and on phones 38px. The brand takes the remaining width: a long name truncates with an ellipsis first, and only then does a logo chip narrow (its logo scaling down), so the chip and credit always fit. Below 600px the header uses the compact lockup: a smaller wordmark, and the chip above the credit without the name text. Below 375px the view toggle shows short labels (Dealer / Customer; screen readers keep the full names), the header buttons narrow, and the wordmark, logo and credit shrink or wrap to fit rather than clip. The settings dialog previews the logo on the desktop chip, and at the compact header size on phones (440px and below). The printout uses the logo in place of the PD icon. With nothing saved, the default wordmark and PD icon remain.

## Validation and references

The home-screen identity is an original, hand-drawn PD monogram in white on the navy-to-blue brand palette. The icon contains no small text. `public/payment-desk-icon.svg` is its vector master; `npm run icons:generate` exports the Apple 180px and manifest 192/512px PNGs plus the rounded browser favicon. PNGs are opaque, full-bleed squares; the operating system supplies the corner mask. The mark fits the centered 40%-radius maskable safe area. New image URLs separate the identity from older cached icons; existing iPhone shortcuts may need to be removed and added again if their old artwork persists.

All form inputs, selects, and textareas use at least 16px text on mobile widths and touch-only devices, including landscape. This avoids iPhone focus-triggered form zoom. The viewport retains normal user scaling and pinch-to-zoom; print sizing is independent.

Customer printing uses 10mm Letter-page margins and a 190mm composition. Up to six products use individual cards; longer lists use compact ledger rows. Font-ready measurement fits the actual content before printing while retaining full page width. Print styling includes an SVG payment-panel background so the white payment remains readable with browser background graphics disabled. The maximum supported 50 products retain every character, with smaller type when necessary. Verify actual PDF pagination and text completeness, not only screen screenshots or PDF byte size; native printer settings can override the requested paper/margins.

Customer-facing payment options show monthly payment, term, and APR. Interest-charge amounts and lifetime total payments are omitted from the customer screen, printout, and copy/share text at the owner's request. Internal amortization calculations remain available to the engine. Show the applicable trade-deduction limit with the tax savings, so a $720 tax saving cannot be mistaken for the trade allowance or the taxable-price deduction.

Use the existing browser suite for populated, invalid, mobile, keyboard, and customer/export states. Test the start → review → edit flow, section shortcut focus, and helper/error descriptions. Visually inspect desktop and mobile layouts after CSS changes; automated contrast scans do not establish full accessibility conformance.

References: [W3C form instructions](https://www.w3.org/WAI/tutorials/forms/instructions/), [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [GOV.UK review-answer pattern](https://design-system.service.gov.uk/patterns/check-answers/).
