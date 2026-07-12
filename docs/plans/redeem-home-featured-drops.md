# Redeem homepage — featured drops from MKTR campaigns (Phase 2)

**Status:** SCOPED + REVIEWED (Codex gpt-5.6-sol review folded in, 2026-07-12) — not implemented
**Depends on:** PR #127 (`feat/redeem-website`) — stacked on it or lands after its merge.
**Goal:** the drops on redeem.sg's homepage come from MKTR campaign data via an explicit, admin-only per-campaign toggle. MKTR admin is the source of truth (a flyer/QR-only campaign with zero Meta ads can be featured). Static config in `src/pages/redeemHomeContent.js` remains the fallback.

**Honesty contract:** `cap` and `endsAt` are **display metadata**, not enforced inventory — reaching the cap or the end date changes what the homepage shows; it does not stop QR/direct-link signups (enforcement would need transactional reservation, out of scope; revisit against the redeem-ops inventory ledger later). Name them accordingly everywhere: *display cap*, *homepage end date*.

---

## A. Backend

### A1. Data: `design_config.featuredDrop` (JSONB — no migration)

```js
design_config.featuredDrop = {
  enabled:    true,            // publication switch — ADMIN-ONLY to change (see A2)
  title:      'Cabin luggage', // ≤ 40 chars; defaults to campaign.name when blank
  valueLabel: 'FREE',          // ≤ 12 chars — required for a card to render
  emoji:      '🧳',            // ≤ 8 chars — required for a card to render
  cap:        300,             // optional int ≥ 1 — display cap; enables meter + auto-'gone'
  endsAt:     '2026-07-20',    // optional YYYY-MM-DD — inclusive through 23:59:59 Asia/Singapore
}
```

`endsAt` semantics: a drop is "ended" only after end-of-day **Asia/Singapore** (not midnight UTC). Implement with an explicit timezone conversion, tested with an injected clock.

### A2. Sanitize on save + admin-only publication

New `backend/src/utils/featuredDrop.js`:
- `normalizeFeaturedDrop(obj)` — strict boolean `enabled`; strings trimmed/length-capped; `cap` positive int ≤ 100 000 or dropped; `endsAt` strict `YYYY-MM-DD` or dropped; unknown keys stripped; non-plain-object input → key removed. Rejects arrays/class instances (plain-object check, not `typeof === 'object'`).

Applied at **both** boundaries (defense in depth — old rows, seeds, duplicates, or future write paths can bypass save-time checks):
1. On save in `campaignService.js` create (~201) / update (~259), alongside the existing `normalizeCustomerHostChoice` clamp.
2. Again when building the public DTO in the endpoint service (A3) — the response only ever contains re-normalized values.

**Publication is admin-only.** `PUT /api/campaigns/:id` is `requireAgentOrAdmin` (`routes/campaigns.js:71`), so without a server-side gate an *agent* could publish to the public homepage. In the update path: if the request would change `featuredDrop.enabled` (or any `featuredDrop` field) and the caller's role is not `admin`, strip the change and keep the stored value (silent-preserve, matching how other privileged fields are handled; controller passes `req.user.role` into the service). Same guard on create.

**Duplication must not clone publication:** `POST /:id/duplicate` copies `design_config`; the duplicate path explicitly sets `featuredDrop.enabled = false` on the copy.

### A3. Public endpoint: `GET /api/campaigns/featured-drops`

**Placement (revised after review):** declare in `backend/src/routes/campaigns.js` **before** the `GET /:id` route (line 68) — per-route auth means an unauthenticated route is fine there, declaration order prevents `/:id` shadowing, and it avoids the preview router's multiple mounts (`/api/campaigns` + `/api/previews` + flagged `/api/adtech/previews`) creating unintended aliases like `/api/previews/featured-drops`.

Service `campaignService.getFeaturedDrops()` (or a small dedicated module):
1. `Campaign.findAll({ where: { is_active: true, status: 'active' }, attributes: ['id', 'name', 'design_config'] })` — **both** `is_active` and the lifecycle `status` column (`Campaign.js:21`; archived/draft rows must never publish). Filter `featuredDrop?.enabled === true` in JS. (JS filtering is fine at current scale — tens of campaigns; documented threshold: move to an indexed publication column if active campaigns reach hundreds.)
2. One grouped `Prospect.count({ where: { campaignId: ids }, group: ['campaignId'] })` — parse counts defensively (pg may return strings).
3. DTO per drop, wrapped in the standard envelope `{ success: true, data: { drops: [...] } }`:
   ```js
   {
     id, title, valueLabel, emoji,
     status: 'live' | 'gone',   // 'gone' when (cap && claimed >= cap) || endsAt passed (SGT end-of-day)
     claimUrl,                  // ALWAYS `https://redeem.sg/LeadCapture?campaign_id=<id>`
     claimedPct?, left?,        // ONLY when cap is set: pct clamped 0–100, left ≥ 0
     endsAt?,
   }
   ```
   - **No raw `claimedCount` without a cap** — raw signup numbers disclose campaign performance publicly. Meter data appears only when the operator asserted a display cap.
   - **claimUrl is always redeem.sg** — the homepage's own trust copy says "real ones live on redeem.sg — only" (`RedeemHome.jsx` how-it-works + receipt), so featured drops never emit an mktr.sg link even for `customerHost: 'mktr'` campaigns. (`/LeadCapture` is served on both hosts; a redeem.sg visitor stays on redeem.sg.)
4. Ordering, deterministic: `'live'` before `'gone'`, then `endsAt` ascending with nulls last, then `id`. Cap the list at 6. (Editorial `sortOrder` deferred — unnecessary at ≤ 6 drops.)
5. **'gone' retention:** a gone drop stays listed while the toggle is on, but is auto-omitted 7 days after `endsAt` (when set). Cap-reached drops without `endsAt` stay until untoggled — documented in the designer helper text.
6. **Cache:** module-level 60 s TTL **with in-flight promise coalescing** (concurrent misses share one query) and **stale-on-error** (refresh failure serves the last good list + logs). Response sets `Cache-Control: public, max-age=60` so Cloudflare/Render absorb homepage traffic. No save-time busting (would need to cover update/duplicate/archive/restore across instances; 60 s staleness is fine).
7. Exposure: public rate limiter already covers `/api/*`; `internalRouteHostGuard` doesn't block `/api/campaigns` (LeadCapture on redeem.sg proves the path). DTO whitelist means no pixel IDs, ages, agent or lead data. Featured campaigns are enumerable **by design** — the toggle is an explicit publish action. Note for the future: if the platform ever hosts campaigns for other tenants, publication must also check ownership scope, not just a JSON flag.

### A4. Backend tests

- `backend/test/featuredDrop.util.test.js` — sanitizer: coercion, length caps, unknown keys, arrays/garbage, strict date format.
- `backend/test/featuredDrops.route.test.js` — **route-level**: unauthenticated `GET /api/campaigns/featured-drops` → 200 envelope; `GET /api/campaigns/:id` still 401 unauthenticated; no `/api/previews/featured-drops` alias; inactive / non-'active'-status / unflagged campaigns excluded; cap-reached → `'gone'`; SGT end-of-day boundary (injected clock); counts-as-strings parsing; agent `PUT` cannot flip `enabled` (admin can); duplicate clears `enabled`; DTO exact-shape.
- Cache tests reset module state between cases (avoid order-dependent failures).
- Runbook: run from `backend/` with the throwaway-pg-on-5433 setup used by existing suites.

---

## B. Admin designer (mktr.sg)

`src/components/campaigns/editor/ContentPanel.jsx` (next to the Customer-domain toggle), state via `DesignEditor.jsx` — which spreads `design_config` and preserves unknown keys, so no state-init changes needed; pass `campaign.name` down for the title placeholder.

- Toggle: **Feature on redeem.sg homepage** — visible to admins only (server enforces regardless; agents see a read-only "featured by MKTR" note if enabled).
- Fields when on: Title (placeholder = campaign name), Value label*, Emoji* (*required to publish — the save surfaces a validation nudge if missing), Display cap (optional), End date (optional, SGT).
- Helper text: "Shows in the Drops section on redeem.sg while this campaign is active. Cap and end date only change the homepage display — they don't stop sign-ups."

---

## C. Redeem homepage (redeem.sg)

`src/pages/RedeemHome.jsx`:
1. Fetch `apiClient.get('/campaigns/featured-drops')` on mount, with abort-on-unmount.
2. Render the static-config drops immediately; swap in fetched drops on success; keep static fallback on error/empty (today's "dropping soon" behavior). Derive `meta` line and panel color client-side (e.g. from status + endsAt: "Ends Sunday"); map DTO → existing card shape.
3. Hero card / CTA derivation refactored to take the resolved drops list (fetched or fallback) as input.
4. Frontend tests (vitest/RTL-style if practical in this repo, else covered in verify skill flows): success swap, empty → fallback, error → fallback, hero recomputation, ends-label derivation, unmount abort.

---

## D. Rollout

- No env vars, no migration, no Render changes. Zero flagged campaigns → `[]` → homepage identical to PR #127.
- Single stacked PR (backend + designer + homepage) on `feat/redeem-website`.
- Effort after review additions: backend + tests ≈ 1 day · designer ≈ ½ day · homepage ≈ 2–3 h.

## Review log (Codex gpt-5.6-sol, 2026-07-12 — verified against code before folding)

Accepted (verified true): agent-publication gap (`campaigns.js:71` requireAgentOrAdmin on PUT) → admin-only gate; `status` lifecycle column exists (`Campaign.js:21`) → filter on it; duplicate-clones-publication → clear on duplicate; redeem.sg-only claim links (page trust copy contradiction); no raw counts without cap; SGT end-of-day date semantics; DTO re-normalization (defense in depth); cache coalescing + stale-on-error + `Cache-Control`; route moved out of the multiply-mounted preview router; envelope `{success,data}`; grouped-count string parsing; deterministic ordering; route-level tests.
Rejected (verified false): "featuredDrop must be added to DesignEditor initialization or data is lost" — `DesignEditor.jsx:50` spreads `design_config` and deliberately preserves unknown keys; only the `campaign.name` placeholder prop is needed.
Deferred: enforced (transactional) caps — display-only for v1, documented; editorial `sortOrder`; multi-tenant ownership scoping (noted for future).
