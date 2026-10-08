# Payment Desk readiness dossier — October 8, 2026

## Release decision boundary

This release improves the existing Michigan purchase-estimate product. It does not establish automatic nationwide coverage, lender eligibility, business/legal approval, or a completed commercial launch. Worksheets remain on each device as requested. No ATC service, account, paid subscription, server, staff cloud accounts, or shared deals were activated.

Source, final checks, review findings and deployment receipts belong to the release pull request. A source commit or successful build alone is not a live deployment. The supported website is `https://desking.mysoldlog.com/`; Cloudflare publication is a separate direct upload after review. GitHub Pages is a separate delivery channel and cannot read the production-origin companion catalog.

## Implemented refinements

| Area | Delivered behavior | Verification contract |
| --- | --- | --- |
| PDF attachment sharing | Customer view prepares a local PDF, shares its `File` through supported native sharing, provides Download PDF and retry, and keeps Copy summary separate. Canceled sharing does not trigger a download. | Parsed PDF bytes and snapshot content, files-only share capability, transient activation, cancellation/failure/retry, stale snapshots, missing browser capability, and cold offline packaged extension. |
| Financial model | Exact rational monthly-payment cent rounding and inverse evaluation; rejects excess entered interest-rate precision. Labels distinguish assumed annual interest rate and estimated loan balance from lender disclosures. | Independent payment/deal oracle comparisons, exact halfway-cent cases, inverse/preview/apply agreement, rate-entry recovery and existing policy regressions. |
| Purchase scope | Visible Michigan resident scope, registration-state and transaction controls, and domain checks. Unsupported cases block customer exports, grid applications and target suggestions. | Unsupported state/transaction persistence, accessible recovery, direct domain/export guard tests and no silent Michigan fallback. |
| Local recovery | Versioned v2 drafts; migrates supported legacy drafts, preserves malformed/newer records until explicit discard, and serializes writes/reset with conflict checks. | Malformed/oversized/version cases, queued reset, legacy cleanup failure/retry, quota failures and concurrent tabs. Reset leaves a figures-free marker; it is not a secure wipe of external copies. |
| Dealership settings | Save failure distinguishes unavailable storage and failed rollback. A settings change in another tab blocks stale comparisons and exports; an open settings edit is retained until the user closes and reloads. | Storage fault cases and two-tab tests for unsaved settings and customer PDF invalidation. |
| Inventory integrity | Repeated pages and restrictive/uncertain filters cannot establish a complete refresh; persists server retry pauses and bounds permitted robots redirects. Website pagination pins a catalog revision and stops when it changes. | Synthetic crawl, filter, repeat, redirect, Retry-After, revision mismatch and legacy companion fixtures. Live source completeness is a separate check. |
| Companion startup | Readiness can recover after iframe failure; stale Retry does not unnecessarily navigate a healthy worksheet. Static troubleshooting text survives missing entry modules. | Isolated recovery/module-failure tests plus packaged toolbar/side-panel and offline acceptance. |
| Operator information | Bundled staff guide, technical device/network data notice and generated runtime dependency license texts. | Build/package includes the same guide and notices. These do not substitute for business-approved legal/privacy materials. |
| Density and accessibility | Visible worksheet focus returns, target-mode error isolation, labels matching their visible actions, named landmarks and compact scope notice. Financial figures and primary controls retain their legibility and tap size. | Phone/panel breakpoints, compact visible-height cases, keyboard focus and automated accessibility checks. |

The research and implementation used 21 agents, including the independent release and patch-risk reviewers, bounded MV3 research and the Deal details regression worker. Bounded implementation/test roles used medium effort; design, finance, jurisdiction, commercial and security reviews used high effort. The MV3 research role used GPT-6 Luna/medium and the independent final release role uses GPT-6 Astra/high under the owner's routing policy; other roles inherit the session's Codex model. No maximum-effort or automatic delegation mode was requested or enabled.

## Research and missing-feature decisions

Official automotive providers and state guidance show that a generic retail rate or ZIP-only lookup cannot establish vehicle tax/title/registration coverage. [ATC's automotive SaaS offering](https://autotitling.com/solutions/dmv-data-api-for-automotive-saas-companies/) is an integration candidate, not a selected or licensed service. Its current public information does not establish our account access, API contract, prices, retention or complete accepted coverage. [ATC requirements](ATC-INTEGRATION-REQUIREMENTS.md) and the [51-jurisdiction acceptance ledger](NATIONWIDE-COVERAGE.md) record the evidence and open decisions.

Competitor research informed the backlog rather than adding features solely because another vendor has them. The next priority is licensed jurisdiction coverage and approved reference deals. Lease programs, manufacturer rebates, special/exempt/nonresident registrations, lender program eligibility, DMS/CRM writes, e-signatures and credit applications need separate authoritative contracts and acceptance. Staff accounts and shared cloud deals are explicitly deferred for this release. No estimate capability should be marketed as underwriting or a binding lender quote.

## Remaining commercial and platform gates

| Gate | Required evidence / owner decision |
| --- | --- |
| Automatic nationwide rules | ATC/vendor access and data rights; approved minimum request/retention contract; state/local automotive rules with provenance, expiry, outage handling and independent accepted examples for every enabled jurisdiction. All 50 states plus DC must be accepted before a nationwide claim. |
| Michigan policy acceptance | Named dealership policy owner confirms actual document-fee basis, CRV and product taxability, registration exceptions and representative lender/DMS examples. The application's policy review window still expires after 2026 until a sourced update is reviewed. |
| Business handoff | Named operator/backup, software/brand/inventory/media rights, actual commercial terms, staffed support and private security intake, account ownership/recovery and approved privacy/distribution materials. No invented contacts, promises or legal terms. |
| Chrome distribution | The companion remains an unpacked package. Chrome Web Store submission, store policy disclosures, approved item/identity and real upgrade acceptance remain outstanding. GitHub merge or website deployment cannot update an already installed unpacked extension. |
| Physical phones/accessibility | Real iPhone/Android share-menu and Messages attachment handoff, assistive technology, OS font fallback and printer settings require physical-device acceptance. Automated Web Share mocks verify bytes and invocation, not delivery to a customer. |
| Live inventory | A complete fixture refresh does not certify all dealer platforms. Used-only/restrictively filtered source completeness and platform layouts require explicit live acceptance; partial catalogs retain their warning and last-seen evidence. |

## PDF and storage limits

The downloaded/shared PDF is a local, potentially multi-page document containing the current snapshot's ledger, totals, comparisons and qualifications. The separate Print composition remains available. Most text is selectable; unsupported Unicode lines use local browser font rendering as images. Glyph availability depends on the OS and the PDF is not a tagged accessible document. Do not claim full Unicode or screen-reader PDF conformance from content-manifest tests.

One current worksheet is saved locally, without authentication or automatic expiry. The same OS/browser profile can read it. Reset affects the app draft, not downloads, clipboard, print spools, backups or recipients. Use individual protected profiles and the dealership's approved handling practice. Website and companion drafts/settings use separate origins.

v2 takes precedence over v1 and adds explicit coverage fields. Older app versions do not understand v2. A web rollback preserves stored bytes, but is not a downgrade or migration of the draft and does not roll back installed companions. Avoid reopening legacy readers for new unsupported-scope deals; recover using a compatible release. Rehearse code, package and storage recovery separately.

## Verification and publication record

Run `npm run check:release` on a clean candidate: lint, unit/domain tests, production build, Chromium/mobile/WebKit browser tests, then the delivered extension package tests. Preserve failure traces and fix actual regressions before publishing. Repeat only the affected checks while fixing; the final full gate runs on a committed revision. Record intentional project skips separately from passes.

The registered security scan on baseline `4832f6f` analyzed 61 of 127 selected paths and was partial. Its evidence is not a complete scan of this release. An immutable commit-range patch-risk review covers changed boundaries and records its confidence and exclusions; it also does not constitute a penetration test or compliance certification.

For publication, record accepted commit, CI checks, app 2.1.0, companion 1.3.0 package hash, Cloudflare deployment/build/bundle hashes and previous deployment. Verify the served bundle, headers and a synthetic estimate/export. Follow [Cloudflare deployment and rollback](CLOUDFLARE-DEPLOYMENT.md) and [the operating handoff](HANDOFF.md). Preserve local v2 bytes during rollback and do not force-push release history.
