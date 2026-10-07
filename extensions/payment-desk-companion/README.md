# Payment Desk Companion

Chrome extension, version 1.2.0, for Chrome 116 or later. The toolbar icon opens the full Payment Desk worksheet in Chrome's side panel so you can desk beside a vehicle listing. The worksheet, calculations and fonts are bundled with the extension and work offline. Listing capture requires an open listing. Optional dealership inventory connects a website and keeps a public vehicle catalog on this computer.

## Install in Chrome

1. Extract `payment-desk-companion.zip` to a folder you will keep. Developers can run `npm run extension:package` and use `extension-dist/payment-desk-companion`; the source folder alone does not contain the built worksheet.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Select the folder containing `manifest.json`.
4. Use Chrome's puzzle-piece menu to pin **Payment Desk Companion** to the toolbar.

This is an unpacked extension. It has not been published to the Chrome Web Store. When installing an update, replace the files in the same folder and select **Reload** on its extension card. Chrome controls which side the panel uses; to place it on the right, use Chrome Settings → Appearance → Side panel position → Right.

## Use

Click the extension icon and use the worksheet directly: enter selling price, trade, cash down, products and financing; compare payments; switch to Customer view to copy or print an estimate. The open global panel retains the current worksheet when you switch browser tabs. Reloading the extension or worksheet clears the deal; closing the panel or browser can also clear it. Deal figures are not saved.

For capture, open a single vehicle listing, click the extension icon to grant access on that tab, then **Capture listing**. Review or edit Vehicle, Stock # and Selling price. Select **Review in worksheet** and confirm **Start new estimate** below. The app clears the import fragment and applies only the price and reference; taxes, fees, trade and financing use the worksheet's own rules. A missing price can be entered there. Existing deals require confirmation before being cleared. **Enter vehicle** opens the same fields for manual entry. **Hide vehicle** restores the worksheet's full height.

**Web app ↗** opens the blank [website](https://desking.mysoldlog.com/) in a separate tab; it does not transfer your current deal. For an optional shortcut, assign **Open Payment Desk side panel** at `chrome://extensions/shortcuts`.

Dealership name, logo and fee settings are saved locally under the extension's own origin and remain through Reset deal. Set them using the worksheet's gear button. These settings are separate from the website's settings. Updating the same installed extension keeps its settings; removing it or changing its installation folder can change its identity and lose access to them. Bundled policy/calculation updates require installing a new extension package.

Capture supports single-vehicle Car/Vehicle structured data and labeled prices inside a recognizable primary vehicle detail section. A price needs explicit USD currency evidence. Stock labels and prices from unrelated widgets are excluded. Listing layouts vary. Search/results pages, multiple offers, unconfirmed currencies, missing data and monthly/down-payment displays can require manual entry. Always verify the actual price and eligibility for advertised discounts with the listing. The extension cannot read Chrome settings, the Web Store, PDFs or other protected pages.

## Data and permissions

`sidePanel` provides the worksheet beside your page. `activeTab` and `scripting` allow capture from the tab you explicitly invoke. `storage`, `alarms` and `offscreen` support the optional saved inventory catalog, scheduled refreshes and inert HTML parsing. Website access is optional: **Connect and refresh** asks Chrome for the chosen dealership's apex/www hosts. The optional manifest pattern permits choosing different dealers; it does not grant access to every site. Disconnect clears the catalog and withdraws that site's optional grant. There are no remote scripts, analytics or stored customer/deal figures. Dealership presentation/fees use localStorage; public inventory and its source/schedule use chrome.storage.local, not cloud sync.

Price/reference are passed in a fragment to the bundled worksheet and removed before review. Chrome can retain navigation history. Capture on a newly selected tab may need another toolbar click to grant access. Inventory reads public pages without login cookies, checks robots exclusions and crawl delays, and parses detached markup without executing website scripts. It does not open dealership tabs, submit forms or bypass access challenges.

## Dealership inventory

Select **Inventory → Dealership website**, enter your website or an inventory page, and choose **Connect and refresh**. The current connectors read DealerOn inventory (including Brighton Ford, Bob Maxey Ford Howell and Mission Ford) and DealerCarSearch cards (including Jenna Auto Sales). Both new and used pages are discovered when the site offers them. Other platforms can require an additional connector; an error does not mean the dealership has no vehicles. See the [source coverage and implementation notes](../../docs/COMPANION-INVENTORY.md).

Search by vehicle, stock or VIN, filter new/used, and expand **Vehicle details** for available colors, equipment, location and last-seen time. Cards show mileage and a photo when supplied. **Use vehicle** fills the capture review fields, then **Review in worksheet → Start new estimate** applies the price and reference. Your current deal survives until you confirm. A missing or unverified USD selling price stays blank; MSRP and advertised conditional totals are not silently used as the selling price. Verify pricing and availability with the listing.

**Refresh nightly while Chrome is running** schedules about 2 AM in this computer's local time zone. Chrome must be running and the computer awake/online to perform a read. A missed scheduled run is checked at the next Chrome start; an interrupted run can resume from its saved page queue. **Refresh now** is available at any time. Turn the checkbox off to use manual updates. Closing the side panel does not stop a scheduled read. There is no server running when Chrome is closed.

A full refresh compares page counts and deduplicates by VIN or listing URL. A partial/blocked refresh keeps the old catalog and clearly reports its incomplete state. Missing vehicles are marked **not seen**, never inferred to be sold; **Include previously listed vehicles** reveals them. Check last-seen dates when using cached data. Catalogs are limited to 3,000 records and 80 source requests per run; reaching a limit reports a partial refresh. Disconnect affects inventory only; Reset deal affects the worksheet only.

## Develop and verify

From the repository root:

```sh
npm run check:release
npm run extension:package
```

The release checks include a real toolbar/side-panel Chromium test, offline worksheet and narrow-layout checks, capture fixtures, and the app's import flows in Chromium/mobile/WebKit. `npm run test:extension` builds/packages before testing the delivered folder. To regenerate icons from the app's SVG, run `npm run extension:icons`.
