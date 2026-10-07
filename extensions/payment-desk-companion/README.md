# Payment Desk Companion

Chrome extension, version 1.0.0. Opens [Payment Desk](https://desking.mysoldlog.com/) and captures a vehicle's advertised USD selling price and stock reference for a new estimate.

## Install in Chrome

1. Extract `payment-desk-companion.zip` to a folder you will keep, or use this source folder.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Select the folder containing `manifest.json`.
4. Use Chrome's puzzle-piece menu to pin **Payment Desk Companion** to the toolbar.

This is an unpacked extension. It has not been published to the Chrome Web Store. When installing an update, replace the files in the same folder and select **Reload** on its extension card.

## Use

Open a single vehicle listing, click the extension icon, then **Capture vehicle from this page**. Review or edit Vehicle, Stock # and Selling price. Select **Start estimate** and confirm **Start new estimate** in Payment Desk. The app clears the import fragment and applies only the price and reference; taxes, fees, trade and financing use the worksheet's own rules. A missing price can be entered there. Existing deals require confirmation before being cleared. Dealership settings remain on the device.

**Open desk** starts a blank estimate. For an optional shortcut, assign **Open a blank Payment Desk estimate** at `chrome://extensions/shortcuts`.

Capture supports single-vehicle Car/Vehicle structured data and common labeled USD selling-price fields. Listing layouts vary. Search/results pages, multiple offers, foreign currencies, missing data and monthly-payment displays can require manual entry. Always verify the actual price and eligibility for advertised discounts with the listing. The extension cannot read Chrome settings, the Web Store, PDFs or other protected pages.

## Data and permissions

`activeTab` and `scripting` allow capture from the tab you explicitly invoke. There are no broad website permissions, background capture, remote scripts, analytics, customer records or extension storage. The popup retains entered fields only while open. Price/reference are passed in a URL fragment to the fixed Payment Desk address and removed by the app before review. Chrome may retain navigations in browser history; this is not a private mode or a saved-deal system. No customer identity or entire page text is transferred.

## Develop and verify

From the repository root:

```sh
npm run check:release
npm run extension:package
```

The release checks include an actual unpacked-extension Chromium test, capture fixtures, and the app's import flows in Chromium/mobile/WebKit. To regenerate icons from the app's SVG, run `npm run extension:icons`.
