## Phase X - 2025-09-08 18:05 SGT

- Branch: main
- Proposal: Fix localhost failures on prospects/campaigns due to dev proxy and tenant filter
- Implementation Details:
  - Disabled leadgen proxy shim in development to prevent 504 proxy loops. (File: `src/middleware/leadgenProxyShim.js`)
  - Guarded campaigns list route to only apply `tenant_id` filter on Postgres, avoiding SQLite dev 500s. (File: `src/routes/campaigns.js`)
  - No schema changes. Phase A/B/C logic untouched.
- Variables/Functions Added:
  - None
- Next Steps:
  - Verify local pages: Admin Prospects, Admin Campaigns, QR Codes, Commissions.
  - If further 500s appear, add similar guards where `tenant_id` may be referenced.

## Phase X: Neutral referral sharing for Lead Capture

- Timestamp: 2025-09-08 00:00 SGT
- Branch: main
- Proposal: Decouple shared LeadCapture links from QR attribution to prevent driver commissions on shared links; introduce neutral referral counting tied to campaign only.
- Implementation Details:
  - Frontend: `src/pages/LeadCapture.jsx` now appends `ref=1` to shared URLs and sets `leadSource` to `referral` when the param is present. It also posts to `/api/analytics/referrals` once per visit to increment campaign referral metrics.
  - Backend: Added `POST /api/analytics/referrals` in `backend/src/routes/analytics.js` to increment `campaign.metrics.referrals` and record a `referral_visit` event in `SessionVisit`.
  - No schema changes required; reused `Campaign.metrics` JSON.
- Variables/Functions Added:
  - Frontend state: `referralMarked` in `LeadCapture.jsx`
  - Backend route handler: `POST /api/analytics/referrals`
- Next Steps:
  - Surface `metrics.referrals` in admin dashboard analytics.
  - Add automated tests for referral param and ensure no `qrTagId` is bound when only `ref` is present.

# project_status_v2.md — mktr build log (singapore-only)

> single source of truth for what’s completed, in progress, and next. keep entries short, dated, and in lower‑case. this file is meant to be appended over time.

---

## 0) purpose

1. act as the living log for engineering progress across services (gateway, auth, monolith/adtech, leadgen, future fleet/device).
2. define the exact format for adding new entries so the log stays clean and machine‑parsable later.
3. make it obvious what we’re building next and how to verify it works.

---

## 1) conventions

1. tone: lower‑case only, no emojis, keep sentences short.
2. one source of truth: this file; don’t duplicate status elsewhere.
3. each update uses a **dated block** with: timestamp (sgt), branch (if any), phase, summary, changes, acceptance, notes.
4. each item is **actionable**: either done, doing, or next; avoid vague future ideas.
5. link to pr/commit when available.

---

## 2) glossary (actors & services)

- **advertiser/agency**: buys ad campaigns (video/stills), geo/time targeting; views reports.
- **fleet owner**: manages cars/tablets, uptime, payouts.
- **driver**: operates car; sees assigned campaigns & payout summary.
- **lead buyer/agent**: buys verified leads captured via qr forms; gets notifications.
- **admin**: overall control; tenant setup, users, billing flags.
- **tablet device**: android tablet in car; plays ads and (future) sends beacons/uptime.
- **services**:

  - **gateway**: single entrypoint; routes `/api/auth`, `/api/leadgen`, `/api/adtech` (monolith), (future `/api/fleet`). jwks‑verified jwt.
  - **auth‑service**: issues rs256 jwt; serves `/.well-known/jwks.json`.
  - **monolith (adtech)**: legacy core (campaigns, creatives, reports) under `/api/*` and proxied as `/api/adtech/*` via gateway.
  - **leadgen‑service**: qr tags, prospects, commissions under `/api/leadgen/*` with its own `leadgen` db schema.
  - **future fleet‑service**: device uptime, playlists, beacons under `/api/fleet/*`.

---

## 3) how the whole system works (super layman version)

### a) advertiser / agency

1. they log in → create a campaign: upload videos or images, choose where/when to show (e.g., cbd weekdays 7–10pm), set budget.
2. the system schedules those ads so tablets in relevant cars play them at the right time/place.
3. later, they open a dashboard to see simple results: how many plays, where, and approximate audience.

### b) fleet owner

1. they add their cars and tablets (e.g., “car sgn1234 has 2 tablets”).
2. they can see if tablets are on or off; if a tablet stays off too long, the system flags it.
3. monthly, they see how much they earned from the campaigns their cars ran.

### c) driver

1. driver just drives; the tablet plays ads automatically.
2. driver can view a simple payout summary for the month and if any issues with the tablet.

### d) lead buyer / agent (insurance, etc.)

1. qr codes on the tablet (or flyers) send people to short forms (name/number).
2. once a form is submitted and passes basic checks, the agent gets the lead instantly.
3. agents can filter, track, and pay for leads they actually want.

### e) admin

1. admin sets up tenants (separate customer organizations) and users.
2. admin can move features between services as we split monolith → microservices.
3. admin sees system‑wide health and billing flags.

### f) devices (tablets)

1. each tablet downloads a **json playlist manifest** with:

   - list of ads (id, file reference, campaign id)
   - playback order and sequencing
   - metadata (duration, targeting rules, validity period)
   - refresh interval: tablet fetches a new manifest on a set schedule (to balance freshness with bandwidth cost)

2. tablet plays the loop.
3. tablet sends back:

   - **heartbeat pings** every x minutes (uptime monitoring)
   - **beacon events** each time an ad is shown (tablet id, ad id, campaign id, timestamp, location if available)

---

## 4) current snapshot (today)

- **date:** 2025‑09‑07 sgt
- **phase:** a nearly complete; b in progress
- **gateway:** routes `/api/auth`, `/api/leadgen`, `/api/adtech`; jwks auth ok
- **auth‑service:** rs256 tokens issued; jwks served (note: keys not yet persisted across restarts)
- **monolith/adtech:** legacy routes ok; proxied via `/api/adtech/*`
- **leadgen‑service:** live with qr/prospect/commission endpoints and `leadgen` schema
- **ci:** smoke workflow logs in via auth → calls gateway `/api/leadgen/health` → creates/lists qr

---

## 5) roadmap (phases)

### phase a — auth + prefixes (stability of entrypoint)

1. gateway with `/api/auth`, `/api/leadgen`, `/api/adtech` prefixes.
2. jwks‑based rs256 auth; keep legacy `jwt_secret` fallback while migrating.
3. acceptance: both old and new tokens work; prefixed health endpoints pass; ci smoke green.

### phase b — leadgen extraction (clean boundary)

1. move qr/prospects/commissions fully into `leadgen‑service` (db schema: `leadgen`).
2. frontend calls go through gateway `/api/leadgen/*` only.
3. deprecate duplicate leadgen routes in monolith (temporary proxy, then remove).
4. acceptance: end‑to‑end lead capture & list through gateway; ci includes prospect lifecycle.

### phase c — fleet/device service (uptime + playlists)

1. device registry, uptime pings, basic alerting for off‑hours.
2. playlist api for tablets using json manifest with refresh interval.
3. beacon api: receive heartbeat pings and ad impression beacons (tablet id, ad id, campaign id, timestamp, location).
4. acceptance: simulated device downloads manifest, sends heartbeat, and reports beacons.

### phase d — adtech control refactor (reports + billing hooks)

1. standardize campaign model (tenant‑scoped) and reporting views.
2. export revenue shares (fleet/driver) and lead billing events.
3. acceptance: reports render for a tenant with sample data; payouts export csv.

---

## 6) append‑only update format (copy/paste this block)

```
### [yyyy‑mm‑dd hh:mm sgt] — phase <a|b|c|d> — <short title>
- branch: <branch‑name or n/a>
- summary:
  1) <what changed in 1–2 lines>
- changes:
  1) <code areas, endpoints, migrations>
  2) <config flags, env>
- acceptance:
  1) <exact curl or ui steps to prove it works>
- notes:
  1) <risks, follow‑ups>
- links:
  - pr: <url>
  - commit: <sha or url>
```

---

## 7) immediate next actions (checklist)

1. persist auth keys in `auth‑service` (stable `kid`, load from secret or file; support rotation).
2. add `tenant_id` explicitly to sequelize models that are tenant‑scoped; ensure indexes.
3. re‑point frontend leadgen calls to `/api/leadgen/*` only; keep a 1‑week proxy window.
4. extend ci smoke: prospect create → assign → list → commission mark (all via gateway).
5. basic metrics/logs for leadgen‑service requests + errors.
6. design json manifest schema for playlist (ads, order, metadata, refresh interval).
7. design heartbeat + beacon api for fleet‑service.

---

## 8) environment & flags

- **env** (shared): `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `JWT_SECRET` (fallback), `TENANT_DEFAULT`.
- **gateway**: `ENABLE_DOMAIN_PREFIXES=true`, `PORT=4000`.
- **auth‑service**: `PORT=4001`, `KEY_PATH` or `KEY_PEM` (for persistence), `KID`.
- **leadgen‑service**: `DATABASE_URL`, `SCHEMA=leadgen`.
- **fleet‑service (future)**: `PORT=4002`, `PLAYLIST_REFRESH_INTERVAL_MIN`, `HEARTBEAT_INTERVAL_MIN`.

---

## 9) endpoint map (current)

- `POST /api/auth/v1/auth/login` → token
- `GET /api/auth/.well-known/jwks.json` → jwks
- `GET /api/leadgen/health` → ok
- `POST /api/leadgen/v1/qrcodes` | `GET /api/leadgen/v1/qrcodes`
- `GET /api/adtech/health` → proxied to monolith `/health`

---

## 10) testing cheatsheet (curl)

```
# get jwks
curl -s http://localhost:4001/.well-known/jwks.json | jq

# login
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login -H 'content-type: application/json' -d '{"email":"test@mktr.sg","password":"test"}' | jq -r .token)

# health via gateway
curl -s http://localhost:4000/api/leadgen/health -H "authorization: bearer $TOKEN"

# create + list qr via gateway
curl -s -X POST http://localhost:4000/api/leadgen/v1/qrcodes -H "authorization: bearer $TOKEN" -H 'content-type: application/json' -d '{"label":"hdb-flyer-sep","cap":100}' | jq
curl -s http://localhost:4000/api/leadgen/v1/qrcodes -H "authorization: bearer $TOKEN" | jq
```

---

## 11) open questions (to resolve before phase c)

---

## 12) backlog (trimmed, only near‑term)

1. admin ui for tenant/user management with role presets.
2. lead verification heuristics (duplicate/invalid number filters, sg locale rules).
3. payout export (fleet/driver) and lead billing export (agents) as csv.
4. device uptime dashboard (simple grid, color by last‑seen minutes).
5. playlist json schema + validation library.
6. beacon ingestion api with dedupe & batching.

---

## 13) append entries below this line

<!-- new entries go here. do not edit sections above except to fix typos or update endpoint/env tables when the system evolves. -->

### [2025-09-08 23:59 sgt] — phase b — dedupe: one signup per campaign per phone

- branch: main
- summary:
  1. enforce that a phone can sign up once per campaign; same phone can join different campaigns
- changes:
  1. backend: `backend/src/models/Prospect.js` add unique index on `(campaignId, phone)`
  2. backend: `backend/src/routes/prospects.js` guard in `POST /api/prospects` to reject duplicates (409) and normalize phone digits
- acceptance:
  1. submit lead with phone X for campaign A → 201
  2. submit again with phone X for campaign A → 409 "already signed up"
  3. submit with phone X for campaign B → 201
- notes:
  1. index covers both sqlite and postgres via sequelize; phone is digit-normalized before save
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-08 03:10 sgt] — phase b/c — legacy ui compat guard (self-proxy bypass)

- branch: phase-c/scaffold-manifest-beacons
- summary:
  1. add self-proxy guard to monolith leadgen shim so legacy endpoints work even when gateway/leadgen envs point back to the same host; restores pre-revamp frontend without losing phase a–c work
- changes:
  1. backend/src/middleware/leadgenProxyShim.js: detect when `req.host` equals target host (from `GATEWAY_INTERNAL_URL`); if equal, bypass proxy and let monolith handle legacy routes directly; set header `x-legacy-shim-bypass: self-proxy-guard`
  2. no behavior change when `GATEWAY_INTERNAL_URL` points to a private gateway (docker/k8s); normal `/api → /api/leadgen/*` forwarding remains
- acceptance:
  1. with misconfigured env (target → public api host), `/api/qrcodes` responds 200 (monolith handler) instead of 504; response includes `x-legacy-shim-bypass`
  2. with correct env (target → internal gateway), `/api/qrcodes` forwards to `/api/leadgen/v1/qrcodes` as before
- notes:
  1. this is a guardrail to avoid prod outages during cutover; recommended to still point `LEADGEN_URL` to an internal upstream and eventually disable the shim
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-08 03:25 sgt] — phase b — marketing consent modal on lead capture + previews

- branch: main
- summary:
  1. add reusable marketing consent dialog and link it from lead capture form, public live preview, and interactive designer preview
- changes:
  1. frontend: `src/components/legal/MarketingConsentDialog.jsx` (new), wire in `src/components/campaigns/CampaignSignupForm.jsx` and `src/components/campaigns/DesignEditor.jsx`
  2. copy includes policy links and consent/withdrawal details; opens as overlay dialog
- acceptance:
  1. open `/LeadCapture` → click “Marketing Consent” below submit → dialog appears; close works
  2. open public preview `/p/<slug>` → same link shows dialog
  3. in Admin → Campaign Designer interactive preview, the footer link opens the same dialog
- notes:
  1. dialog is content-only; no backend changes; copy can be updated centrally
- links:
  - pr: n/a
  - commit: 7c34115

### [2025-09-08 03:32 sgt] — phase b — t&c text opens marketing consent dialog

- branch: main
- summary:
  1. make “terms & conditions” footer text clickable to open the same marketing consent dialog across lead capture, public preview, and interactive preview
- changes:
  1. frontend: update `src/components/campaigns/CampaignSignupForm.jsx` and `src/components/campaigns/DesignEditor.jsx` to wire the T&C text to the dialog
- acceptance:
  1. on `/LeadCapture`, clicking “terms & conditions” opens the dialog
  2. on `/p/<slug>`, clicking “terms & conditions” opens the dialog
  3. in campaign designer interactive preview, clicking “terms & conditions” opens the dialog
- notes:
  1. consistent UX; dialog content remains centrally managed
- links:
  - pr: n/a
  - commit: 7549051

### [2025-09-08 03:38 sgt] — phase b — note: ui changes moved to `frontend/UI_STATUS.md`

- branch: main
- summary:
  1. starting now, ui-only changes are logged in `frontend/UI_STATUS.md`; this backend log remains for backend/services infra
- changes:
  1. created `frontend/UI_STATUS.md`; migrated recent ui entries there
- acceptance:
  1. ui updates appear in `frontend/UI_STATUS.md`; backend/service updates continue here
- notes:
  1. keeps backend log focused and ui iterations cleanly tracked
- links:
  - pr: n/a
  - commit: 2e79ac9

### [2025-09-08 22:17 sgt] — phase b — nicer share dialog + short links (frontend)

- branch: main
- summary:
  1. redesigned share dialog; dynamic title “share <name> with your friends and family”; share-only url shortening with graceful fallback.
- changes:
  1. frontend: `src/pages/LeadCapture.jsx`, `src/pages/public/Preview.jsx` — improved layout, added TinyURL/is.gd shortener (client-side) used only in share UI.
  2. no backend changes.
- acceptance:
  1. submit form → dialog shows dynamic title; buttons for whatsapp/telegram use short link when available; copy button works; if shortening fails, long url is used.
- notes:
  1. consider moving shortening server-side later for analytics & reliability.
- links:
  - commit: 240d845

### [2025-09-08 22:34 sgt] — phase b — mktr shortlinks service (/share/:slug)

- branch: main
- summary:
  1. add first-party short links with 90-day expiry; minimal ua/device analytics; admin-only minting.
- changes:
  1. backend: models `ShortLink`, `ShortLinkClick`; routes `POST /api/shortlinks` (admin), `GET /share/:slug` (public redirect); wired into server and model sync.
  2. frontend: share dialogs now call backend to mint short links; falls back to long url if error.
- acceptance:
  1. admin user triggers share → dialog uses `https://<host>/share/<slug>`; clicking redirects to original long url; after 90 days link expires with friendly redirect to `/lead-capture?error=expired`.
  2. db shows incremented `clickCount`; clicks table stores ua/device/referer/ipHash.
- notes:
  1. expand analytics later with path/source tagging; add admin UI listing.
- links:
  - commit: a734468

### [2025-09-08 22:55 sgt] — phase b — frontend route: /share/:slug → TrackRedirect

- branch: main
- summary:
  1. add react-router route `/share/:slug` to reuse existing `TrackRedirect` component.
- changes:
  1. frontend: `src/pages/index.jsx` add `<Route path="/share/:slug" element={<TrackRedirect />} />`.
  2. no backend changes; aligns with admin shortlinks that generate `/share/<slug>`.
- acceptance:
  1. open `/share/ofmki6it` → SPA forwards to backend `/share/ofmki6it` (server redirects to target).
  2. console no longer shows “No routes matched location \"/share/...\"”.
- notes:
  1. `AdminShortLinks` already renders links to `/share/<slug>`; this makes them functional on the SPA router.
- links:
  - commit: n/a

### [2025-09-09 00:15 sgt] — phase b — commissions ui: remove campaign commissions, add fleet owners

- branch: main
- summary:
  1. updated Admin Commissions to show only Agent and Fleet Owner commissions.
- changes:
  1. frontend: `src/pages/AdminCommissions.jsx` — removed Campaign tab; added Fleet Owner tab with aggregation by `fleet_owner_id` using `amount_fleet`; updated search placeholder and headers.
- acceptance:
  1. navigate to `/AdminCommissions` and verify two tabs: "Agent Commissions" and "Fleet Owner Commissions". no campaign commissions visible.
- notes:
  1. if backend commissions payload lacks `fleet_owner_id`/`amount_fleet`, align API to include these for Fleet Owner views.
- links:
  - commit: n/a

### [2025-09-08 23:05 sgt] — phase b — correction: `/share/:slug` uses ShareRedirect

- branch: main
- summary:
  1. fix routing to use a dedicated `ShareRedirect` that forwards to backend `/share/:slug` instead of QR tracker.
- changes:
  1. frontend: add `src/pages/ShareRedirect.jsx` and update `src/pages/index.jsx` to map `/share/:slug` → `ShareRedirect`.
- acceptance:
  1. visiting `/share/<slug>` results in a 302 to the shortlink target (via backend), and shortlink analytics increment.
- notes:
  1. QR tracker remains at `/t/:slug` (SPA) and `/api/qrcodes/track/:slug` (backend).
- links:
  - commit: n/a

### [2025-09-08 23:45 sgt] — phase b — pointer: admin campaigns ui redesign (frontend)

- branch: main
- summary:
  1. admin campaign management page refreshed for usability (tabs, filters, grid/list, actions menu).
- changes:
  1. see `frontend/UI_STATUS.md` entry "admin campaigns ui redesign" for details.
- acceptance:
  1. navigate to `/AdminCampaigns` and verify new controls and tabs; behavior matches ui log.
- notes:
  1. backend unchanged.
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-08 23:58 sgt] — phase b — pointer: admin users ui enhancements (frontend)

- branch: main
- summary:
  1. admin users page upgraded with stats, lifecycle tabs, list/grid toggle, actions menu, and csv export.
- changes:
  1. see `frontend/UI_STATUS.md` entry "admin users ui enhancements" for details.
- acceptance:
  1. navigate to `/AdminUsers` and verify new tabs, view toggle, and export.
- notes:
  1. backend unchanged.
- links:
  - pr: n/a
  - commit: n/a

### [2025-09-08 23:59 sgt] — phase b — admin shortlinks: delete endpoint

- branch: main
- summary:
  1. add admin-only delete for short links and cascade remove click records.
- changes:
  1. backend: `backend/src/routes/shortlinks.js` — new `DELETE /api/shortlinks/:id` with admin auth; deletes `ShortLinkClick` then `ShortLink`.
- acceptance:
  1. as admin, `curl -X DELETE http://localhost:3001/api/shortlinks/<id> -H 'authorization: bearer <ADMIN_TOKEN>'` returns `{ success: true }` and row is gone from list.
- notes:
  1. safe to call repeatedly; 404 when id not found.
- links:
  - commit: n/a

### [2025-09-09 01:22 sgt] — phase b — admin dashboard totals via overview (frontend)

- branch: main
- summary:
  1. fix admin totals (prospects, campaigns, commissions) by using `/dashboard/overview` instead of paginated lists.
- changes:
  1. frontend: `src/pages/AdminDashboard.jsx` now reads `stats.prospects.total`, `stats.campaigns.{total,active}`, and `stats.commissions.total` from overview; falls back to client counts if missing.
- acceptance:
  1. open `/AdminDashboard` as admin → totals match backend `/api/dashboard/overview` payload; campaigns active equals overview value; commissions shows the summed total.
- notes:
  1. list endpoints are paginated, so array lengths can undercount; overview is authoritative for admin.
- links:
  - commit: c5852f7

### [2025-09-09 01:42 sgt] — phase b — dashboard overview: campaign counts corrected (backend)

- branch: main
- summary:
  1. fix admin campaign totals in `/api/dashboard/overview`: total excludes archived; active includes `status='active'` or `is_active=true` (legacy flag).
- changes:
  1. backend: `backend/src/routes/dashboard.js` — update `getAdminStats` campaign counts with `Op.ne` and `Op.or` conditions.
- acceptance:
  1. call `/api/dashboard/overview` as admin → `stats.campaigns.total` excludes archived; `stats.campaigns.active` includes legacy `is_active`.
- notes:
  1. aligns with frontend Admin Dashboard cards using overview values.
- links:
  - commit: n/a

### [2025-09-09 01:05 sgt] — phase b — admin dashboard: correct metrics (frontend)

- branch: main
- summary:
  1. admin dashboard now shows partner commissions breakdown (drivers vs fleet owners) and total scans; removes lifetime earnings/earned blocks intended for drivers/fleet owners.
- changes:
  1. frontend: `src/components/dashboard/CommissionSummary.jsx` — for `userRole==='admin'`, render total driver commissions, total fleet owner commissions, and total scans; hide lifetime blocks.
  2. frontend: `src/pages/AdminDashboard.jsx` — fetch `/dashboard/overview` and pass `qrCodes.totalScans` to `CommissionSummary`.
- acceptance:
  1. login as admin → `/AdminDashboard` shows three cards in Commission Summary: Driver Commissions, Fleet Owner Commissions, Total Scans.
  2. driver/fleet dashboards remain unchanged and still show their lifetime metrics.
- notes:
  1. uses existing backend `/api/dashboard/overview` qrCodes.totalScans; no backend changes.
- links:
  - commit: 33356a3

### [2025-09-09 01:34 sgt] — phase b — admin sidebar: auto-close on mobile after click (frontend)

- branch: main
- summary:
  1. Mobile sidebar now closes automatically when a navigation item is clicked.
- changes:
  1. frontend: `src/components/ui/sidebar.jsx` — update `SidebarMenuButton` to call `setOpenMobile(false)` on click when `isMobile`.
- acceptance:
  1. On a narrow/mobile viewport, open the admin sidebar, tap any menu item → sidebar sheet closes and navigation proceeds.
- notes:
  1. Works with `asChild` usage wrapping `Link` in `DashboardLayout`.
- links:
  - commit: n/a
