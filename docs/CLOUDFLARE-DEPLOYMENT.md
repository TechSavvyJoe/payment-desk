# MySoldLog deployment

Published to Cloudflare Pages on September 24, 2026. The selected address **https://desking.mysoldlog.com/** went live on September 25, 2026. Its GoDaddy CNAME is verified on both authoritative nameservers, HTTPS returns 200, and the application was visually verified in the user's work browser. The existing root-domain DNS and Firebase hosting are unchanged.

## Production service

The production service is `https://desking.mysoldlog.com/`, hosted by the existing Cloudflare Pages project `mysoldlog-desking`. This is a Direct Upload project: merging GitHub `main` updates GitHub Pages through its workflow, but does not update Cloudflare. For every release, build the reviewed commit and upload only `dist` to the existing project with production branch label `main` and the full source commit in deployment metadata. Verify the custom-domain build identifier against that source after publishing.

Each release's source commit, CI runs and Cloudflare deployment are recorded in its pull request and in the Cloudflare deployment's source-commit metadata. Example: [pull request #15](https://github.com/TechSavvyJoe/payment-desk/pull/15) was squash-merged as `main` commit `1961d1d`, published on October 6, 2026 as deployment `797afc4a` (`https://797afc4a.mysoldlog-desking.pages.dev`), and served at the custom domain with build `1961d1de`. The launch identifiers below are historical.

## Release procedure

After the release pull request passes CI and is merged, build `main` from a clean checkout so the build ID is the exact commit (a dirty tree produces `<sha>-modified`), then upload only `dist`:

```bash
git fetch origin
git worktree add --detach /tmp/payment-desk-release origin/main
cd /tmp/payment-desk-release
npm ci
npm run build
wrangler pages deploy dist --project-name mysoldlog-desking --branch main --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --format=%s)" --commit-dirty=false
```

`wrangler login` must have granted the Pages scope; without it the API answers `Authentication error [code: 10000]`. To verify, fetch `https://desking.mysoldlog.com/`, open the `assets/index-*.js` file it references, and confirm it contains the first eight characters of the released commit and matches the local `dist` bundle byte for byte. Then remove the worktree (`git worktree remove /tmp/payment-desk-release`).

## Initial domain launch — historical evidence

- Project: `mysoldlog-desking`, in the verified Cloudflare account.
- Live address: `https://desking.mysoldlog.com/`.
- Cloudflare address: `https://mysoldlog-desking.pages.dev/`.
- Deployment ID: `c879c611-74cf-45c2-891b-c0b9af9d2b47`.
- Deployment URL: `https://c879c611.mysoldlog-desking.pages.dev`.
- Source commit: `3f191ff` (build display `3f191ff9`).
- Production branch label in Pages: `main`. This is a direct upload of the reviewed working branch, not a Git merge or a GitHub Pages deployment.
- HTTPS returned 200 with all configured headers. The live application rendered correctly, calculated a $30,000 sale at $540.67/month with default settings, and captured no console warnings/errors. The original MySoldLog root retained its previous response/ETag.
- A prior local smoke run with the same CSP verified target adjustment/Undo, breakdown expansion, customer view, real clipboard copy, PDF output, and 390px layout without CSP or resource failures.

The Cloudflare custom domain was added on September 24, 2026 at 23:25 UTC, with domain ID `69b7b0d7-4a88-4a32-bf9f-0a5afc19965b`. Cloudflare returned `initializing` with verification pending. Both authoritative nameservers returned NXDOMAIN for `desking.mysoldlog.com` before the planned DNS change.

The following record was saved through the authenticated GoDaddy work-browser session and confirmed in the DNS table:

| Field | Value |
| --- | --- |
| Type | CNAME |
| Name | desking |
| Value | mysoldlog-desking.pages.dev |
| TTL | 1 hour (3600 seconds, verified from authoritative DNS) |

Both `ns59.domaincontrol.com` and `ns60.domaincontrol.com` return this CNAME. The GoDaddy DNS table contains 10 records after the addition, with the existing nine records preserved. Cloudflare domain validation was retried after propagation. HTTPS returned 200 at 13:45 UTC on September 25, 2026, with the expected deployment ETag and security headers. Plain HTTP redirects to HTTPS. The custom address displayed the fully styled application and build `3f191ff9` in the user's work browser; `mysoldlog.com` continued to return its original Sales Ledger response and ETag.

## Existing domain

Live DNS inspection found `mysoldlog.com` on GoDaddy nameservers `ns59.domaincontrol.com` and `ns60.domaincontrol.com`, with the apex pointing to `199.36.158.100`. The root and `/desking` currently return the same Firebase-hosted Sales Ledger application. Do not replace the root application or its DNS record to publish the desk.

## Cloudflare hosting with a GoDaddy subdomain

Selected address: `https://desking.mysoldlog.com`.

1. Build the reviewed source with `npm run build`. Upload only `dist`, which contains the calculator and static assets, not the repository or user-entered figures.
2. Create or select a Cloudflare Pages project in the verified account. Record its actual `pages.dev` hostname and deployment ID; do not assume the requested project name is available.
3. Test that deployment before adding the custom domain: selling price, payment calculation, target application/undo, itemized breakdown, customer view, and print/copy.
4. Add `desking.mysoldlog.com` under the Pages project's Custom domains first.
5. In GoDaddy DNS for `mysoldlog.com`, check for existing `desking` records. If none exists, add a CNAME named `desking` pointing to the actual Pages hostname. If a record exists, inspect its purpose before replacing it. Keep all other records and nameservers unchanged.
6. Wait for the Cloudflare domain and certificate to be active. Verify HTTPS, response headers, JS/CSS/font/icon/manifest loading, and the original `https://mysoldlog.com` site.

The built `_headers` file supplies CSP, no-sniff, no-referrer, noindex, and camera/microphone/location restrictions on Cloudflare Pages. Existing GitHub Pages deployment does not apply this file as HTTP headers.

For repeat deployments, use the same Pages project and record the source commit with the release. Direct Upload and Git integration are distinct project creation choices. The existing repository workflow only updates GitHub Pages from `main`; it does not update Cloudflare automatically. Keep the existing PR/release checks in the release process.

## Exact `/desking` path alternative

`https://mysoldlog.com/desking` is a path, so it cannot be added using a DNS CNAME. It needs a deployment within the existing Firebase site or Cloudflare routing in front of the existing hostname. The latter requires a Cloudflare-proxied DNS setup for the apex, a complete inventory of existing DNS records, and a planned migration that preserves the current site and email.

The app uses relative asset paths and supports `/desking/`. Redirect `/desking` to `/desking/` while retaining its query string. A Cloudflare Worker must strip only `/desking` from requests in that path before fetching the desk's static assets. Requests outside that path must continue to the existing application. Do not add a blanket SPA fallback for unknown nested paths; this app has no client-side URL routes.

## Rollback

Record any pre-existing `desking` DNS record before changes. To undo a subdomain launch, restore that record or remove only the newly created `desking` CNAME and detach the custom domain from Pages. The main site should not require restoration because it is unchanged. For an application regression, roll back the Pages project to its previous successful deployment.

## References

- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [GoDaddy CNAME records](https://www.godaddy.com/help/add-a-cname-record-19236)
