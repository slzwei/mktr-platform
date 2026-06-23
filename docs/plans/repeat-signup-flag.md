# Plan — Flag repeat (cross-campaign) signups for admins

**Status:** DRAFT v2 (Codex gpt-5.5 xhigh reviewed; claims verified vs code) — not implemented
**Date:** 2026-06-22

## 0. Changelog — v2 (Codex review, all claims verified)

- **Needs a small INDEX-ONLY migration** (v1 wrongly said "no migration"): there is
  **no standalone `phone` index** — only composite `(campaignId, phone)` (migration
  `010:20`), which can't serve `WHERE phone = :phone`. `email` is indexed
  (`Prospect.js:247`) but a plain index won't serve `lower(trim(email))`. Add a
  partial `phone` index + a functional `lower(trim(email))` index.
- **List query = UNION of two indexed arms, batched per page** (not OR, not N+1) —
  Codex's recommended shape (§3).
- **`normalizeProspect` rebuilds an explicit object** (`normalizeProspect.js:143+`)
  → it DROPS unknown fields. Must explicitly add `repeatSignupCount` / `repeatSignup`.
- **Detail endpoint is agent-shared too** — the `ProspectDetails` modal (used by
  `MyProspects`) fetches `GET /:id`, not just the list. So **service-side admin
  gating is the security boundary**; the normalizer is NOT a security layer.
- **Admin predicate confirmed:** `user.role === 'admin'` (`prospectScope.js:11`,
  `auth.js:163`).
- **No `archivedAt` / `is_test_data` column on prospects** (only `quarantinedAt`,
  `Prospect.js:229`). Removed those from the plan. (Campaigns have `status:'archived'`
  — a different thing.)
- **Never persist the field / never put it in `sourceMetadata`** — `sourceMetadata`
  is dispatched in the webhook payload (`prospectHelpers.js:84,139`). The flag is a
  transient response-only property.
- **`call_bot` excluded** (consistency with the redeemed sync,
  `redeemedAudienceService.js:67`); **`campaignId IS NULL` not counted**; null skip
  only when BOTH phone AND usable email are absent.
- Synthetic `@calls.mktr.sg` email is **legacy** (current Retell writes `email:null`,
  `retellService.js:271`) — keep the filter defensively.

## 1. Goal

When the **same person signs up across multiple campaigns**, show the **admin** how
many — and which — campaigns that lead has signed up for. **Flag, do NOT block.**
MKTR backend + admin UI only; must never reach the MKTR agent view (`MyProspects`)
or the separate **mktr-leads** agent app. Phase 2 of the redeemed-leak work (the
Meta exclusion stops *ads*; this gives admins *visibility* into repeat redemptions —
4 known dupes, e.g. phone `+6596176848`, hit both the $20 and $10 campaigns).

## 2. Grounding facts (verified vs code)

- Per-campaign uniqueness is real + **phone-only** (`prospectService.js:305`, throws
  at `:314`). Cross-campaign (and any email-based repeat) is the open gap.
- `listProspects`/`getProspect` pass `req.user` (`prospectController.js:18,82`);
  routes use plain `authenticateToken`, **no role gate** (`routes/prospects.js:24,33`).
- **Both** endpoints are agent-shared: `MyProspects.jsx:54` (list) +
  `ProspectDetails.jsx` modal (detail). → gate in the service.
- Admin = `user.role === 'admin'` (`prospectScope.js:11`).
- Indexes: `email` yes (`Prospect.js:247`); standalone `phone` **no** (only composite
  `(campaignId, phone)`, migration `010:20`). → §4.
- Webhook payload (`prospectHelpers.js`) carries `sourceMetadata` (`:84,139`) — never
  store the flag there.
- Frontend: `AdminProspects.jsx`, `ProspectDetailPage.jsx` (admin); `MyProspects.jsx`
  + `components/prospects/ProspectDetails.jsx` (agent); `utils/normalizeProspect.js`.

## 3. Design — read-time, admin-only, batched

Compute on read (accurate, no denormalized column). Match = **phone OR email**
(§5). The field is **transient** (attached to the API response object only — never
persisted, never in `sourceMetadata`).

**Backend (`services/prospectService.js`), enrich ONLY when `user?.role === 'admin'`:**
- `getProspect(id, user)` → attach `repeatSignup = { campaignCount, campaigns:
  [{id,name,signedUpAt}] }`. One raw query: UNION of a phone arm + an email arm,
  then `GROUP BY "campaignId", c.name, MIN("createdAt")`.
- `listProspects(user, query)` → fetch the scoped page first (unchanged
  `findAndCountAll`), then ONE raw batched query for the page's keys and attach a
  light `repeatSignupCount` per row. **Recommended query (Codex):**
  ```sql
  WITH page AS (
    SELECT * FROM unnest(:ids::uuid[], :phones::text[], :emails::text[])
      AS p(id, phone, email_norm)
  ),
  matches AS (
    SELECT p.id, q."campaignId" FROM page p
    JOIN prospects q ON q.phone = p.phone
    WHERE p.phone IS NOT NULL AND p.phone <> ''
      AND q."leadSource" <> 'call_bot' AND q."campaignId" IS NOT NULL
    UNION
    SELECT p.id, q."campaignId" FROM page p
    JOIN prospects q ON lower(trim(q.email)) = p.email_norm
    WHERE p.email_norm IS NOT NULL AND p.email_norm NOT LIKE '%@calls.mktr.sg'
      AND q."leadSource" <> 'call_bot' AND q."campaignId" IS NOT NULL
  )
  SELECT id, COUNT(DISTINCT "campaignId")::int AS repeat_signup_count
  FROM matches GROUP BY id;
  ```
  Bounded to the page; two indexed arms; no `OR`, no N+1. Detail uses the same UNION
  + `GROUP BY "campaignId"` for the campaign list.
- **Non-admin → fields omitted entirely.**

**Frontend (admin pages only):**
- `normalizeProspect.js` → **add `repeatSignupCount` + `repeatSignup`** to the
  returned object (else dropped). Not a security layer — backend gate is.
- `AdminProspects.jsx` → amber badge **"⚠ N campaigns"** when `repeatSignupCount > 1`.
- `ProspectDetailPage.jsx` → "Signed up for N campaigns" section (names + dates,
  current marked).
- `MyProspects.jsx` / `ProspectDetails.jsx` → untouched.

## 4. Migration (indexes only — no columns)

A single Postgres migration (mirrors the existing raw-SQL style in `migrations/`):
- `CREATE INDEX CONCURRENTLY ... ON prospects (phone) WHERE phone IS NOT NULL AND phone <> '';`
- `CREATE INDEX CONCURRENTLY ... ON prospects (lower(trim(email))) WHERE email IS NOT NULL AND email NOT LIKE '%@calls.mktr.sg';`
(Confirm `CONCURRENTLY` vs the repo's in-transaction migration runner — may need plain `CREATE INDEX`.)

## 5. Match key — phone OR email

Repeat = another prospect sharing **the same phone OR the same (real) email**.
- Email normalized (`lower(trim(...))`); synthetic `@calls.mktr.sg` excluded as a key.
- **Single-hop** only (match on THIS prospect's phone/email; not a transitive
  identity graph).
- Phone match is exact-string on the stored E.164 value (model enforces E.164;
  acceptable — document the assumption).

## 6. Admin-only guarantees (no leak)

1. Enrichment ONLY in the `user.role === 'admin'` branch; omitted otherwise (the
   list + detail endpoints are agent-shared, so this is the boundary).
2. Field is **never persisted**, never written to `sourceMetadata`, never added to
   the webhook payload (`prospectHelpers.js`) → never reaches mktr-leads/Lyfe.
3. Not in the public `createProspect` response (already only `{ id }`).

## 7. Edge cases (decided)

- Count basis: distinct `campaignId` (incl. current); `campaignId IS NULL` not counted.
- Exclude `leadSource = 'call_bot'` (form/redeem signups only; matches the sync).
- Null skip: only when BOTH phone AND usable non-synthetic email are absent.
- Same campaign appearing twice (e.g. via email-only) → count distinct campaigns, not rows.
- No prospect `archivedAt`/`is_test_data` columns → no such filter. (Archived
  *campaigns* via `Campaign.status='archived'` → include historically by default.)

## 8. Tests

Service unit tests: admin gets `repeatSignup`/`repeatSignupCount`, non-admin does
NOT; matches on phone OR email (repeat via shared email/different phone, and
vice-versa); synthetic `@calls.mktr.sg` not used as a key; `call_bot` excluded;
`campaignId NULL` not counted; distinct-campaign count (not rows); single campaign →
count 1 / no badge; null phone+email → no field. Frontend: `normalizeProspect`
preserves the new fields.

## 9. Out of scope

- **Blocking** repeat signups (flag-only by request).
- Transitive identity resolution; any mktr-leads / MKTR agent-view display;
  denormalized/backfilled storage.

**Scope: 1 index migration + service (2 functions) + `normalizeProspect` + 2 admin
components + tests. No webhook change, no mktr-leads change.**
