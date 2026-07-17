# Two-Brand Frontend, Hosting & Infra Reference

> Extracted from `CLAUDE.md` 2026-07-15 to keep per-session context lean. The
> *concept* of the two-brand split lives in `CLAUDE.md`; this file holds the
> exhaustive route lists, env-var tables, DNS records, and helper contracts you
> only need when touching hosting / routing / customer-URL code.

## Per-campaign customer domain — history

`design_config.customerHost ∈ {redeem, mktr}` (default `redeem`) picks the customer-facing host per campaign. The old mktr.sg→redeem.sg lead-capture 301 redirects were REMOVED (Render dashboard, 2026-06-17). The only redirect/rewrite rule left on `mktr-platform` is the SPA fallback `/* → /index.html` (must stay last).

> Historical: during the 2026-05 cutover 5 lead-capture paths (`/LeadCapture`, `/t/*`, `/p/*`, `/share/*`) 301'd to redeem.sg as a safety net, and 7 marketing/apex redirects (`/Homepage`, `/Contact`, `/features`, `/pricing`, `/about`, `/personal-data-policy`, `/`) were removed. `mktr.sg` keeps its marketing pages and admin surfaces.

## Brand-aware config values

`vite.config.js` reads `VITE_BRAND` at config time and aliases `@brand-config` to `src/lib/brandConfigs/mktr.js` or `redeem.js`. Components import `brand` from `@/lib/brand`. Brand-aware values: `name`, `wordmark`, `legalName`, `uen`, `consumerLine`, `logoSrc`/`logoDarkSrc`/`logoIconSrc`/`faviconSrc`, `pageTitle`, `pdpaUrl`, `publicHost`, `defaultRegulatory`, `defaultPoweredBy`, `partnersTerm`, `pdpaAbsoluteUrl`, `consentEntityClause`, plus route gates (`showHomepage`, `showAbout`, `showFeatures`, `showPricing`).

Acceptance test: `grep MKTR dist/` on the redeem build returns only intentional legal-entity references (`MKTR PTE. LTD.`).

## Customer-facing URL helpers (host-aware; default redeem.sg)

`src/lib/brand.js` — `resolveCustomerHost(choice)` maps a stored enum CHOICE (`'redeem'`|`'mktr'`) to a HOST (`redeem.sg`|`mktr.sg`), defaulting to `redeem.sg`. Helpers take an optional `host` (last arg, default `redeem.sg`). **Keep the enum-choice and the hostname strictly separate — never pass a raw hostname from campaign JSON into a helper.**

| Helper | Returns |
|---|---|
| `resolveCustomerHost(choice)` | `'redeem.sg'` \| `'mktr.sg'` (default `redeem.sg`) |
| `customerPublicUrl(path, host?)` | `https://{host}{path}` (host defaults to redeem.sg) |
| `customerLeadCaptureUrl(campaignId, extraParams?, host?)` | `https://{host}/LeadCapture?campaign_id={id}&...` |
| `customerPreviewUrl(slug, host?)` | `https://{host}/p/{slug}` |
| `publicTrackingUrl(slug, host?)` | `https://{host}/t/{slug}` (via `customerPublicUrl`) |
| `publicShareUrl(slug, host?)` | `https://{host}/share/{slug}` |
| `publicUrl(path)` | `https://{brand.publicHost}{path}` — brand-self-referential; canonical/SEO/robots/sitemap only |

Callers pass `resolveCustomerHost(campaign.design_config?.customerHost)`: `AdminCampaigns.handleCopyLink` (dropdown + grid), `AdminCampaignDesigner.handlePreview` (from *saved* campaign), `PreviewFrame` chrome (live editor state). QR admin tables (`CarQRTable`, `ExistingQRCodes`, `PromotionalQRTable`) pass `resolveCustomerHost(qr.targetHost)`. Customer-side surfaces (`LeadCapture.longShareUrl`, `ShareCampaignDialog`) use `window.location.origin` and are correct on whichever host served them.

**QR generation (backend):** `qrCodeService` bakes the campaign's host into the QR image at create/regenerate time and records it on `QrTag.targetHost` (enum `redeem`|`mktr`, nullable → legacy treated as redeem; migration `037-add-qrtag-target-host.js`). `backend/src/utils/customerHost.js` provides `normalizeCustomerHostChoice()` (enum clamp — the security boundary, never trusts a raw host) and `customerHostOrigin(choice)` (→ `PUBLIC_BASE_URL` for redeem/default, `MKTR_FRONTEND_URL`/`https://mktr.sg` for mktr). `campaignService.updateCampaign` clamps `design_config.customerHost` on save; the bulk-QR update path excludes `campaignId`/`targetHost`/`slug`/`qrCode`/`qrImageUrl` so host can't be mass-mutated without regeneration.

## Routing guards (D13 — internal routes are mktr.sg-only, three layers)

1. **Render edge redirect rules on `redeem-frontend`** (16 rules) — catch admin paths before SPA loads. Routes: `/auth/*`, `/Admin*`, `/admin/*`, `/Agent*`, `/Driver*`, `/FleetOwner*`, `/preview*`, `/provision/*`, `/CustomerLogin`, `/ForgotPassword`, `/Onboarding`, `/PendingApproval`, `/MyProspects`, `/prospect/*`, `/profile`, `/settings` — all 301 to `mktr.sg{path}`.
2. **SPA-level `MktrOnlyRedirect`** — `src/pages/index.jsx` wraps internal route elements with `IS_REDEEM_BUILD ? <MktrOnlyRedirect /> : <Real>`. `src/components/auth/ProtectedRoute.jsx` is replaced wholesale with `MktrOnlyRedirect` on the redeem build.
3. **Backend `internalRouteHostGuard`** — `backend/src/middleware/internalRouteHostGuard.js` returns 403 for `/api/auth/*`, `/api/admin/*`, `/api/agents/*`, `/api/fleet/*`, `/api/devices/*`, `/api/users/*`, `/api/lyfe/*`, `/api/webhooks/*`, `/api/integrations/*` when the validated public host is `redeem.sg`. Server-to-server traffic (no host header) passes through unchanged.

## Backend host-aware behavior

- **`backend/src/utils/publicHost.js`** — `publicHostFromRequest(req)` derives the *validated* public host from `Origin` / `X-Forwarded-Host` / `Host`, checked against an allowlist of `{mktr.sg, www.mktr.sg, redeem.sg, www.redeem.sg}`. Returns `undefined` for unknown hosts (never trusts raw headers). `cookieDomainForPublicHost(host)` maps to `.mktr.sg` or `.redeem.sg`.
- **`backend/src/utils/frontendBase.js`** — `frontendBaseForHost(host)` returns `MKTR_FRONTEND_URL` or `REDEEM_FRONTEND_URL` for per-request redirect destinations.
- **`trackerController.js` + `leadCaptureBind.js`** — cookies set via `cookieDomainForPublicHost(publicHostFromRequest(req))`. Redirects use `frontendBaseForHost(...)` to land on the same public host the user came from. The lead-capture binder route redirects to `/LeadCapture` (camelCase) not `/lead-capture`.
- **`prospectController.js`** — derives a CAPI `event_source_url` fallback from `publicHostFromRequest(req)` when the SPA omits it; `metaCapiService.js` is unchanged (no req access).
- **`mailer.js`** — `resolveEmailFrom(context)` and `sendEmail({..., context, from})` allow per-flow sender selection. `EMAIL_FROM_MKTR` / `EMAIL_FROM_REDEEM` override the default `EMAIL_FROM`. `sendLeadConfirmationEmail` fires fire-and-forget on every lead-capture submit (synthetic `@calls.mktr.sg` Retell emails skipped) and **brands by the campaign's `design_config.customerHost`**: redeem → Redeem copy with `context:'redeem'` (→ `noreply@redeem.sg`); mktr → MKTR branding with `context:'mktr'` (→ `EMAIL_FROM_MKTR` = `noreply@mktr.sg`). `prospectService` loads the campaign's `design_config` for every prospect.

## Backend env vars set in production

| Env var | Value | Purpose |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://redeem.sg` | **Default** host baked into QR images (redeem + unbound QRs encode `redeem.sg/t/{slug}`). Per-campaign mktr QRs use `MKTR_FRONTEND_URL` via `customerHostOrigin()`. Also APK download URL display (cosmetic). |
| `MKTR_FRONTEND_URL` | `https://mktr.sg` | Per-host redirect destination for mktr.sg traffic. Falls back to `FRONTEND_BASE_URL`. |
| `REDEEM_FRONTEND_URL` | `https://redeem.sg` | Per-host redirect destination for redeem.sg traffic. |
| `CORS_ORIGIN` | `…mktr-platform.onrender.com,…redeem-frontend.onrender.com` | Adds preview hostnames for staging. Code defaults already include the four apex+www hosts. |
| `EMAIL_FROM_MKTR` | `noreply@mktr.sg` (set 2026-06-17) | From-address for ALL MKTR-context emails — customer confirmation on mktr campaigns AND agent/admin notifications. First in the resolution chain (ahead of `EMAIL_FROM`/`EMAIL_USER`); set explicitly so the sender isn't the SMTP login `admin@mktr.sg`. |
| `EMAIL_FROM_REDEEM` | (falls back to `EMAIL_FROM` if unset) | Customer-facing lead-capture confirmation (`context:'redeem'`), sender `noreply@redeem.sg`. SES domain verified + DKIM/SPF/DMARC pass. |

## Operational env on the static sites

- **mktr-platform** Static Site (Render): `VITE_BRAND=mktr` (or unset — defaults to mktr), `VITE_API_URL=https://api.mktr.sg/api` (absolute — cross-origin works because cookies live on parent `.mktr.sg`).
- **redeem-frontend** Static Site (Render): `VITE_BRAND=redeem`, `VITE_API_URL=/api` (relative — Render rewrites `/api/*` → `https://api.mktr.sg/api/*` so cookies live on `.redeem.sg`). Vite plugin emits brand-aware `robots.txt` + `sitemap.xml` per build.
- Both bake public pixel IDs at build time: `VITE_META_PIXEL_ID=1402034528611431`, `VITE_TIKTOK_PIXEL_ID=D8GJ6T3C77UDLID6746G`. `VITE_*` vars are baked into `dist` at build → changing a pixel id requires a redeploy.

## Diagnostic endpoint

`GET https://api.mktr.sg/health/public-host` returns the raw `Origin` / `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` / `req.hostname` plus the *derived* `detectedPublicHost` and `cookieDomain`. Useful for verifying the Render proxy preserves original host headers.

## DNS for `redeem.sg`

Nameservers at Cloudflare (`chance.ns.cloudflare.com`, `liv.ns.cloudflare.com`) after Vodien failed to push delegation during initial setup. Records (managed via Cloudflare):

- A `@` → `216.24.57.1` (Render edge)
- CNAME `www` → `redeem-frontend.onrender.com`
- TXT `@` → `facebook-domain-verification=…` (Meta domain verification)
- TXT `@` → `v=spf1 include:amazonses.com -all` (SPF for AWS SES)
- TXT `_dmarc` → `v=DMARC1; p=none; rua=mailto:admin@mktr.sg; pct=100` (monitoring mode)
- TXT `@` → `google-site-verification=…` (Google Search Console)
- 3× CNAME `<token>._domainkey` → `<token>.dkim.amazonses.com` (AWS SES DKIM)

## Render service IDs

| Service | ID | Domain |
|---|---|---|
| `mktr-platform` static site | `srv-d2s3che3jp1c738qlgjg` | mktr.sg |
| `redeem-frontend` static site | `srv-d88qhph9rddc738nk0d0` | redeem.sg |
| `redeem-ops-frontend` static site | `srv-d97i34q8qa3s73epa51g` (`VITE_SURFACE=ops`) | ops.redeem.sg |
| `mktr-backend-jo6r` | `srv-d2s9p0emcj7s73acd9lg` | api.mktr.sg |
| `mktr-db` (Postgres) | `dpg-d2s2h7nfte5s739gnl7g-a` | — |
