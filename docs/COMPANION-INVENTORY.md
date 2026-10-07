# Chrome companion inventory

Version 1.2 adds one optional dealership website per installed companion, a local inventory catalog, manual refresh and nightly refresh while Chrome is running. Both new and used vehicles are in scope. Version 1.2.1 also makes that catalog available to the web app in the same Chrome browser. Open **Web app** from the companion once, then use **Inventory** beside **Deal details** on the website. The standalone website has no inventory service or scheduled backend; the companion performs the reads and stores the catalog.

The web connection is read-only and restricted to the exact production origin, `https://desking.mysoldlog.com`. Its messages return at most 100 normalized public vehicle records at a time, with source and refresh status. They cannot trigger a scrape, change permissions, clear inventory, or read dealership settings or deal figures. A public extension identifier is kept in the web app's local storage to reconnect later; the inventory itself is not copied into website storage. **Reload catalog** reads the saved catalog again. Browser/device changes require their own companion connection.

## Source evidence, October 7, 2026

| Example | Observed source | Current connector |
| --- | --- | --- |
| [Brighton Ford](https://www.brightonford.com/searchused.aspx) | DealerOn `dlron-srp-model` and public inventory JSON used by its website | DealerOn: discover new/used pages, read all reported pages |
| [Bob Maxey Ford Howell](https://www.bobmaxeyfordhowell.com/used-vehicle-inventory-howell-mi.html) | Same DealerOn model; used inventory can redirect to a custom path | Same connector |
| [Mission Ford](https://www.missionfordofdearborn.com/searchused.aspx) | Same DealerOn model; homepage links can redirect from older inventory paths | Same connector |
| [Jenna Auto Sales](https://jennaautosales.com/inventory?clearall=1) | DealerCarSearch server-rendered cards, VINs, labeled retail prices, mileage and explicit page counts | DealerCarSearch: cards and `page` pagination |
| [Golling Roseville](https://www.gollingroseville.com/used-inventory/index.htm) | Dealer.com-style dynamic inventory; direct request returned 403 | Not supported yet; use single-listing capture/manual entry |
| [Tamaroff](https://tamaroff.com/inventory/used) | Dynamic inventory; direct request returned 406 | Not supported yet |
| [R&R Car Company](https://www.rrcarcompany.com/cars-for-sale) | Carsforsale.com; direct request presented an access challenge; public listings often say “Email For Price” | Not supported yet; never invent absent prices |

These observations do not promise universal compatibility across every dealer or future website revision. The connector never executes remote scripts, circumvents a challenge or assumes that a failed read represents empty inventory. A dealer-group homepage that points to a different domain needs the actual inventory website connected separately.

DealerOn pagination parameters were verified against the site's own JavaScript and public JSON (`pn` page size, `pt` page number). Config identifiers and the base filter come from the requested inventory page. The reader uses the dealer's reported totals, excluding advertisement cards. Stock, VIN, photos, specifications, features, location/status and base-price rows are read only when supplied. MSRP remains separate. For example, Brighton's featured internet total can include a $280 document fee while a separately labeled retail row supplies the base price; the base row avoids charging that fee twice in the worksheet. No hidden cost or DMS wholesale information is inferred.

DealerCarSearch USD pricing requires a recognizable US state/ZIP address in the source, rather than assuming every `$` price is USD. A source can omit stock number or other fields. Missing values remain missing.

## Operation and boundaries

- Only the connected website's optional apex/www permission is requested. The installed manifest has no required host permissions.
- The local public catalog contains VIN/stock, identity, available vehicle details, up to 12 photo URLs, source URL, price labels/notes and last-seen time. Customer identity and entered deal figures never enter it.
- Fetches omit login cookies, have a 15-second timeout and a 4 MB response limit. Stored inventory plus staging data is capped at 7 MB to leave room below Chrome's storage quota; reaching it ends a partial refresh while retaining the persisted catalog. Redirected destinations are validated before their response bodies are read. Only HTTPS pages within the connected dealership are accepted for navigation and pagination.
- Each requested apex/www origin gets its own robots policy; a robots redirect explicitly delegates to the returned policy. Robots rules, including the websites' observed 10-second crawl delay, constrain automated reads. Access errors and changed schemas report a failed/partial refresh.
- The worker persists its queue/staging records after each page and maintains a recovery alarm. Batches are bounded to two minutes; remaining pages resume through the work alarm. A stopped browser does not perform background reads.
- A one-shot alarm schedules the next local 2 AM, preserving calendar behavior across daylight saving changes. Startup checks recreate alarms and catch up missed scheduled runs. If a refresh is already in progress at the nightly time, it fulfills that run and the next alarm moves to tomorrow. Turning nightly off clears that alarm; an already-running refresh can finish.
- A complete run requires verified source counts and completed pagination. Partial runs merge newly observed data without dropping previous vehicles. Complete runs mark absent records as not currently listed, not sold. Manual selection always passes through the existing reviewed import flow.
- Disconnect clears the inventory state and schedule, and withdraws the selected site's optional permissions. It leaves the worksheet and dealership presentation/fees alone.

The offscreen document uses a detached HTML template to parse markup. It is never mounted as website content, and source scripts, tracking images and forms are not executed. The worksheet remains the same bundled app and calculations.

## Verification

`npm run check` covers URL/currency/data normalization, partial-versus-complete merges, local nightly scheduling and robots rules alongside the existing estimator tests. `npm run test:extension` checks the delivered package in real Chromium: both inventory types and multiple pages, inert markup, searching/selecting/reviewing a vehicle without clearing an existing deal, blocked refresh preservation, Chrome's alarm with the panel closed, disabling/disconnecting, and the existing native side panel/offline worksheet flows.

Inventory browser fixtures use an isolated test package with only the synthetic dealer pre-granted; the production package relies on Chrome's native website permission prompt. That native approval remains the person's installation/connection action. Live page probes supplement fixtures; they do not enable any dealership feed in the user's installed Chrome profile.

Live packaged-reader checks on October 7, 2026 completed Brighton's 668 vehicles (527 new, 141 used) and Jenna's 33 used vehicles with verified pagination counts. All Jenna records had prices and mileage. Brighton had 74 separately labeled base selling prices; advertised totals remain distinct, and absent base prices require manual confirmation. These are dated observations, not fixed inventory counts or guarantees for other sites using those platforms.
