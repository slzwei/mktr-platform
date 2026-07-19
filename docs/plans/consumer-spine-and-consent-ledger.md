# Consumer Spine + Consent Ledger — Implementation Plan v2 (post-Codex round 1)

**Date:** 2026-07-20 · **Status:** PLAN v2 — Codex round-1 findings (25) verified against code and folded; pending Shawn's sign-off on the Decisions list, then implement (or Codex round 2)
**Scope:** now **three PRs**. PR A = consumer spine + identity-integrity hooks. PR B = purpose-scoped consent ledger + suppression + unsubscribe. PR C = PDPA erasure.
**Out of scope (later phases):** OTP wallet / prefill / cross-sell (Phase 2 — now also carries the **global marketing opt-in capture**, see §3.1); consumer journeys, segments, inclusion audiences (Phase 3); WhatsApp STOP webhook (WABA go-live); retention TTL policy; Lyfe-side person merge; downstream (Lyfe/mktr-leads) suppression-propagation contract; B12 list serializer.

## 0. Why + what changed in v2

Goal unchanged: one consumer (phone-keyed) across many campaigns, with consent you can lawfully re-market on. The v1 design had five structural errors, all confirmed by Codex round 1 and re-verified against the code:

1. "Non-blocking resolver inside the capture transaction" violated Postgres semantics — any SQL error poisons the outer txn (`current transaction is aborted`); catch-and-continue is impossible without a savepoint. v2 uses an **atomic upsert inside a SAVEPOINT**.
2. There are **three** prospect creators, not two — Meta Lead Ads creates directly (`metaLeadService.js:241-274`) with a **non-normalized phone** and rawFields PII. v2 hooks all three through one primitive.
3. **Retell stores `to_number` as `prospect.phone`** (`retellService.js:260-263` says so explicitly — inbound calls would make the consumer `from_number`). Linking Retell rows could collapse strangers onto MKTR's own DDI. v2 **excludes `call_bot` leads from the spine** until leg selection is fixed (this is also why `repeatSignup.js` excludes call_bot).
4. **Consent is campaign/purpose-scoped, not global** — the two live surfaces grant contact consent "for the purposes identified in this form" (`CampaignSignupForm.jsx:903-908`) / "about this redemption" (`MarketplaceFlow.jsx:812-828`). A latest-event-wins global state would misrepresent what was collected. v2 scopes the ledger and **blocks cross-campaign marketing until an explicit global opt-in exists** (product implication, §3.1).
5. Erasure was a denylist over a subset of the PII that actually exists. v2 is an **allowlist rebuild + a table-by-table matrix** (§5), with lock ordering and webhook-payload-copy scrubbing.

**Design principle (revised): the spine is a rebuildable projection of `prospects`, written best-effort behind savepoints, healed by a deterministic reconciler.** Capture is never blocked by spine failures; drift is repaired by re-running the reconciler (which *assigns* complete projections, never increments). Erasure (PR C) is the deliberate exception — it mutates source rows.

## 1. Verified ground truth (v2-corrected anchors)

- Prospect creators (ALL must be hooked or explicitly excluded):
  1. `prospectService.createProspect` — txn `:817`, `Prospect.create :852`; phone normalized at `:413-414`; OTP marker single-read `:416`; per-campaign dupe 409 `:570-603`; consent intents `:200-211`; server evidence `:279-296`; verified stamp `:498-503` (written iff OTP marker live; **plain unverified direct-API POSTs still capture** — `routes/prospects.js:26-29` is public by design).
  2. `retellService.processRetellCall` — txn `:276`, create `:305`; `phone = to_number`; **EXCLUDED from spine in PR A** (leg ambiguity, `:260-263`).
  3. `metaLeadService` — own txn `:227`, create `:241`; phone NOT normalized; `sourceMetadata.rawFields :265-273`; linked as **unverified**.
- Phone/email are freely editable via `PUT` (`PROSPECT_UPDATE_FIELDS`, `prospectService.js:120-140`) and `updateProspect` applies them with no identity maintenance (`:1241-1260`); hard delete `:1305-1357` (persists `lead.deleted` deliveries in-txn — reuse this pattern) and bulk delete `:2592-2618`.
- **Pre-existing bug to fix in PR A:** entitlement issuance verifies only `phoneVerifiedAt` and never compares `phoneVerifiedFor` to the current phone (`entitlementService.js:91-92, 196-199`) — a staff phone edit keeps stale verification. Fix `verificationStampOf` to require `phoneVerifiedFor === sha256(prospect.phone)`.
- Entitlement creation choke point: ALL issuance paths (hook `:184-219`, sweep `:468-482`, manual `:666-688`) funnel into `issueForProspect`, insert at `:276-292` → set `consumerId` there **unconditionally** (no "optional cut").
- Model/migration index mirroring: `Prospect.js:283-323` does NOT mirror the partial unique (comments only, `:287-289`) — that is the anti-pattern; `RewardEntitlement.js:54-65` is the correct pattern. All new tables mirror every correctness index on the model.
- Test bootstrap runs `sequelize.sync({ force: true })` BEFORE migrations (`bootstrap.js:27-30`) → new migrations must tolerate tables/indexes already created from models.
- `runMigrations` (`runMigrations.js:35-66`) has **no advisory lock, no per-migration transaction**; boot listens before init (`server.js:18-38`, routes installed `server_internal.js:240-268`) → rolling deploys can race. PR A adds `pg_advisory_lock` around the runner and wraps each new migration in a transaction.
- Lyfe webhook subscriber events = `lead.created/assigned/unassigned` ONLY (`bootstrap.js:328-353`) — `lead.deleted` never reaches Lyfe; `WebhookDelivery.payload` retains full payload copies and successful deliveries are never purged (`WebhookDelivery.js:23-30`, `webhookService.js:416-427`).
- Consent evidence pattern to mirror: `externalConsent.js` (`*_CONSENT_VERSION`, `build*Evidence`, `hasValid*`), `dncConsent.js`. `consent_contact`/`consent_terms` today: bare booleans in `sourceMetadata` (`prospectService.js:263-264`), written only when present in the payload (absent ≠ false — Retell/Meta never write them).
- Admin drawer opens from the LIST ROW, never calls `getProspect` (`AdminV2Prospects.jsx:197-210, 421-459`), and `?lead=` deep-links only resolve on the current page (`:216-230`); prospect detail route is authenticated-but-not-admin-only (`routes/prospects.js:34-38`).
- Mailer: `sendEmail` `mailer.js:67`, no headers passthrough (`:86`); templates render `{{fields}}` with unknown-placeholder preservation (`:346-351`). SES DKIM exists for both sender domains — **verify at impl that the DKIM signature covers `List-Unsubscribe*` headers** (RFC 8058 requirement).
- Suppression precedent is partner-only (`OutreachSuppression.js`, consulted only by `cadenceService.js:377-406`).
- Marketing/audience surfaces that must consult the new state: `redeemedAudienceService.js:66-100` (selects by email/phone + old consent boolean), delayed down-funnel CAPI `leadOutcomeService.js:113-159` → `metaCapiService.js:42-64` (hashes em/ph when the stale signup boolean is true), WhatsApp `canWhatsAppProspect` (`whatsappService.js:80-84`; its `:39-47` comment leaves transactional-vs-marketing undecided).

### Preflight data (run 2026-07-19 against prod `dpg-d2s2h7nfte5s739gnl7g-a`; re-run before implementing)

```sql
WITH pc AS (SELECT phone, count(*) s, count(DISTINCT "campaignId") c FROM prospects WHERE phone IS NOT NULL GROUP BY phone)
SELECT (SELECT count(*) FROM prospects) total, (SELECT count(*) FROM pc) phones,
       count(*) FILTER (WHERE c>=2) multi, max(c) maxc FROM pc;
-- 2026-07-19: total=135, phones=130, multi=5, maxc=2; 135/135 phones ~ '^\+65[0-9]{8}$'; consentMetadata on 60/135
```

## 2. PR A — Consumer spine + identity integrity

### 2.1 Migration `078-consumer-spine.js`

Guarded for test-sync'd schemas (skip create-if-exists, follow the pattern of recent migrations); wrapped in a transaction; `runMigrations` gains `pg_advisory_lock(<constant>)` around the whole run (benefits every future migration; release on completion; existing single-row-ledger semantics unchanged).

**`consumers`** (model `Consumer`, all correctness indexes mirrored on the model):

| column | type | notes |
|---|---|---|
| `id` | UUID PK v4 | |
| `phone` | VARCHAR nullable | E.164; CHECK `phone ~ '^\+[1-9][0-9]{9,14}$' OR phone IS NULL`; null only post-erasure |
| `phoneHash` | VARCHAR(64) nullable | sha256 hex, CHECK 64-hex-or-null; **nulled on erasure** (PDPC: unsalted hash of an enumerable space is pseudonymous, not anonymous — no tombstone) |
| `firstName`/`lastName`/`email` | VARCHAR nullable | latest VERIFIED-signup values preferred, else latest; email via `emailNormKey` filter |
| `firstSeenAt`/`lastSeenAt` | timestamptz NOT NULL | |
| `signupCount` | INTEGER NOT NULL ≥0 (CHECK) | assigned by reconciler/resolver, never trusted blindly |
| `verifiedSignupCount` | INTEGER NOT NULL ≥0 | signups carrying a valid OTP stamp |
| `unsubTokenHash` | VARCHAR(64) nullable | PR B: sha256 of the opaque unsubscribe token |
| `erasedAt` | timestamptz nullable | PR C |
| timestamps | | |

Indexes: `uq_consumers_phone` UNIQUE partial `(phone) WHERE phone IS NOT NULL`; `idx_consumers_phone_hash`; `idx_consumers_last_seen`.

Columns added: `prospects.consumerId`, `reward_entitlements.consumerId` (UUID nullable, FK SET NULL, indexed). Associations: `Consumer.hasMany(Prospect,'signups')`, `Prospect.belongsTo(Consumer)`, `Consumer.hasMany(RewardEntitlement)`, `RewardEntitlement.belongsTo(Consumer)`, plus `RewardEntitlement.hasOne(Redemption, as:'redemption')` (missing today, needed by the journey query — `models/index.js:236-249`).

### 2.2 Resolver — atomic, savepoint-isolated (`services/consumerService.js`)

```
resolveConsumerTx(outerTx, { phone, firstName, lastName, email, verified, at })
```
- Requires an ALREADY-normalized E.164 phone; returns null when absent. `verified` = the OTP-stamp decision the caller already made (`otpMarkerLive` in web capture; `false` for Meta).
- Runs inside `sequelize.transaction({ transaction: outerTx })` — a **SAVEPOINT**, so any failure rolls back the savepoint only and the outer capture txn stays healthy (this is what makes "non-blocking" true; v1's catch-and-continue was impossible).
- One raw statement, no 23505 ever raised:
  `INSERT INTO consumers (…) VALUES (…) ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET "lastSeenAt"=GREATEST(consumers."lastSeenAt", EXCLUDED."lastSeenAt"), "signupCount"=consumers."signupCount"+1, "verifiedSignupCount"=consumers."verifiedSignupCount" + <verified?1:0>, <attribute refresh with CASE/COALESCE> RETURNING id`
  (conflict target MUST carry the `WHERE phone IS NOT NULL` predicate to infer the partial index). Attribute refresh: names always-if-nonempty when `verified`, else only-if-null; email only when `emailNormKey` non-null.
- On any error: rollback savepoint, `logger.warn`, return null. Real-Postgres test: drop `consumers`, capture still 201s.

### 2.3 Hooks (all writers)

1. `createProspect` — after the 409 dupe check (`:570`) so duplicates never bump counters, before `Prospect.create` (`:852`): resolve with `verified = otpMarkerLive`, put `consumerId` in the create payload. **Unverified direct-API rows DO link** but are second-class: they can never mint marketing authority (PR B) and are badged in the journey UI. (Deviation from Codex's stricter "leave unlinked" — rationale in Decisions #3.)
2. `metaLeadService` — same hook inside its txn (`:227-274`); **normalize the phone for the MATCHING KEY only** (through `normalizePhone`) without changing what's stored on the prospect in this PR; `verified:false`.
3. `retellService` — **no hook** (call_bot excluded). Follow-up ticket: resolve the consumer leg from call direction, then link.
4. `entitlementService.issueForProspect` — set `consumerId` at the insert (`:276-292`) from `prospect.consumerId`, falling back to phone-digit lookup; unconditional.
5. **`updateProspect` phone/email edits** (`:1241-1260`): wrap in a txn; when phone changes — normalize it (today's PUT doesn't), savepoint-resolve the NEW consumer, relink the prospect, **recompute both old and new consumers' projections from rows** (assign, not adjust), and **clear `sourceMetadata.phoneVerifiedAt/phoneVerifiedFor`** (verification doesn't survive a phone change). Email change: refresh consumer email per resolver rules.
6. **Drive-by fix:** `verificationStampOf` (`entitlementService.js:91-92`) additionally requires `phoneVerifiedFor === sha256(prospect.phone)` — closes the stale-verification hole independently of the spine.
7. `deleteProspect` / bulk delete: after the delete txn, recompute the affected consumer's projection (savepoint best-effort; reconciler is the backstop).

**Webhook contract: `consumerId` is deliberately EXCLUDED from every webhook payload** (`prospectHelpers.js:79-105` + the Meta/Retell inline builders) — no stable cross-campaign identifier leaves the system until a versioned downstream contract + privacy review exist. Tests assert its absence.

### 2.4 Migration `079-consumer-reconcile.js` + `scripts/rebuild-consumer-spine.js`

One deterministic **reconciler** (shared module; the migration and the script both call it):
- Aggregate `prospects` (`phone IS NOT NULL AND phone <> ''`, `leadSource <> 'call_bot'`) → per-phone `{firstSeen, lastSeen, count, verifiedCount, latest attrs (tie-break createdAt,id)}`.
- UPSERT consumers with **assignment** (`ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET … = EXCLUDED.…`) — heals stale counts/attributes, not just missing rows.
- Relink: `UPDATE prospects SET "consumerId" = c.id FROM consumers c WHERE prospects.phone = c.phone AND (prospects."consumerId" IS DISTINCT FROM c.id) AND "leadSource" <> 'call_bot'` — fixes wrong links, not only nulls; then null out `consumerId` on any call_bot rows.
- Entitlements: via `prospectId` join first, then `phoneKey` = digits of `consumers.phone`, `WHERE "consumerId" IS DISTINCT FROM` target.
- Safe to run concurrently with live captures (assignment semantics + advisory-locked runner).

### 2.5 Read surfaces

- `GET /api/consumers/:id` — new `routes/consumers.js`, **explicitly `authenticateToken, requireAdmin`** (do NOT copy the prospects detail route, which is authenticated-only). Returns journey: signups (campaign, status, createdAt, `verified` badge, quarantine), entitlements (+`redemption` via the new association), draw-entry count.
- `getProspect` detail: attach `consumerId` + compact summary (admin-only, beside the existing `repeatSignup` block at `:1220-1226`; `repeatSignup.js` itself stays untouched).
- `LeadDrawer` (`AdminV2Prospects.jsx`): the drawer must FETCH on open (it currently renders the list row only) — fetch the consumer journey when `consumerId` present; render the "Person" card with unverified badges; make `?lead=` deep-links fetch by id independent of the current page (fixes the `:216-230` limitation the sibling links would otherwise hit).

## 3. PR B — Purpose-scoped consent ledger, suppression, unsubscribe

### 3.1 The consent model (and its product consequence)

`consent_events` (append-only): as v1 **plus** `surface` VARCHAR(32) (`lead_capture`|`marketplace_flow`|`meta_lead_ad`|`backfill`|`unsubscribe`|`admin`|`erasure`), `verified` BOOLEAN (the signup's OTP status), CHECKs on kind/source enums, and the campaign scope is semantic, not decorative:

- **Current state is computed per `(kind, campaignId)`** for `contact`/`campaign_terms`/`third_party`/`dnc_override` — matching what the copy actually says on both surfaces.
- **Suppression is global** (withdrawal in the stronger direction is always safe).
- **`canMarketTo(consumer, {channel, campaignId})`** = latest `contact` event for THAT campaign is `granted:true` AND `verified:true` AND no global suppression AND (channel-specific suppression absent). Unverified grants never authorize marketing.
- **Consequence: cross-campaign marketing is NOT licensed by any consent we currently collect.** The "audience grows with us" flywheel needs an explicit global opt-in (e.g. "Keep me posted about new Redeem offers") — that capture surface is a headline Phase-2 (wallet/confirmation) deliverable, and until it ships, `canMarketTo` has no global variant. Stated here so nobody "fixes" the scoping later by broadening reads.
- `contact` events are recorded whenever the field is present in the payload — including explicit `granted:false` (the box is default-ticked; an untick is evidence) — but **absent ≠ false**: Retell/Meta never send it, so nothing is written (matches `prospectService.js:199-201` semantics).
- New `services/contactConsent.js` with `CONTACT_CONSENT_VERSION` (+ copy hash), mirroring `externalConsent.js:74`.

Writes: in the `createProspect` hook (savepoint-shared with the resolver) and nowhere else in PR B. Backfill = migration `081`: **only when the JSON key exists** on the prospect; `occurredAt = createdAt`, `version 'legacy-backfill'`; idempotent via partial unique `(prospectId, kind) WHERE source='backfill'` (mirrored on the model).

`consumer_suppressions`: as v1 + CHECKs; reasons `unsubscribe|complaint|admin|erasure`. **Semantics: `erasure` blocks everything including transactional; other reasons block marketing only.**

### 3.2 Fail-closed enforcement (works for unlinked rows too)

Enforcement keys on **normalized phone digits, not on `consumerId`** — a row the resolver failed to link is still suppressed:
- `redeemedAudienceService` (`:66-100`): join prospects→consumers by phone; exclude suppressed and non-`canMarketTo` people from the upload sets. (Known limitation stays documented: add-mode can't remove already-uploaded hashes; removal = next `replace` run.)
- Delayed down-funnel CAPI (`leadOutcomeService.js:113-159`): re-evaluate consent/suppression **at send time** before `metaCapiService` hashes em/ph (`:42-64`); on withdrawal, send the event without contact identifiers (fbp/fbc/ip/ua only) or skip per `shouldFireCapi` posture.
- WhatsApp: `canWhatsAppProspect(prospect, { purpose })` — `purpose:'transactional'` (reservation pass, voucher, resend) ignores marketing suppressions but respects `erasure`; `purpose:'marketing'` requires full `canMarketTo`. This resolves the `whatsappService.js:39-47` ambiguity explicitly instead of inheriting it.
- Downstream copies (Lyfe `leads`, mktr-leads): out of scope; documented as the suppression-propagation contract gap (Phase 3+).

### 3.3 Unsubscribe (mutate on POST only)

- Token: **opaque random 32-byte value, stored as sha256 in `consumers.unsubTokenHash`**, minted lazily at first consumer-email send. No JWT_SECRET coupling (rotation-safe), no consumer UUID in URLs, revocable. (Replaces v1's HMAC design.)
- `GET /api/unsubscribe?t=…` → **no mutation**; renders a minimal confirmation form (mail scanners prefetch GETs). `POST` (same handler; accepts both the human form and RFC 8058 `List-Unsubscribe=One-Click` body) → upsert suppression (`unsubscribe`, global marketing) + `contact granted:false, source:'unsubscribe'` ledger event → plain confirmation page. Idempotent.
- `sendEmail`: add `headers` passthrough (`mailer.js:86`); consumer templates get footer link + `{{unsubscribeUrl}}` (update `fields`/`escapeFields` `:330-343` together with the templates); headers `List-Unsubscribe` + `List-Unsubscribe-Post`. **Impl-time check:** SES DKIM must cover these headers; if not, header-only until resolved.

## 4. PR C — PDPA erasure (admin)

`POST /api/admin/consumers/:id/erase` (admin + explicit confirm). **Lock ordering: the Consumer row is locked FIRST (`FOR UPDATE`) in BOTH capture-resolver and erasure**, and the consumer is marked `erasing` before enumeration, so a concurrent capture cannot re-attach PII mid-erasure; related prospects are enumerated AFTER the lock. Queued fulfilment senders (`entitlementService.js:300-309` passes a raw prospect object post-commit; `fulfilmentNotify.js:100-159`, `whatsappService.js:162-171`) must **reload prospect+consumer state immediately before sending** and abort if erased — that reload lands in PR C regardless of erasure frequency.

**Erasure = allowlist rebuild, not a scrub list.** Post-erasure, a prospect row retains ONLY: `id`, `campaignId`, `consumerId`, `leadSource`, `leadStatus`, `priority`, `score`, `createdAt/updatedAt`, quarantine fields, and a minimal `sourceMetadata` allowlist (`utm.{source,medium,campaign}` and non-identifying booleans). Everything else — names (→ `'Erased'`/null), email, phone, company/jobTitle/industry, interests, budget, location, demographics, preferences, notes, tags, click/event ids (fbp/fbc/eventId/ttclid/ttp), IP/UA, full URLs, quiz payloads, marketplace child fields, referral names, retell block, `dncMetadata`, `consentMetadata` (→ `{erased:true}`) — is dropped.

Table matrix (each row = explicit step + test):

| Table | Action |
|---|---|
| `prospects` | allowlist rebuild above; `sessionId`/`attributionId` → null (unlinks session/scan streams) |
| `prospect_activities` | scrub `metadata` (update snapshots embed full before/after PII), keep type/timestamps |
| `commissions` | scrub lead name from `description` (`prospectService.js:1272-1288`), keep financials |
| `reward_entitlements` | `phoneKey`/`tokenHint` null; cancel `eligible/issued`; keep `redeemed` rows PII-free |
| `redemptions` / `redemption_events` | scrub free-text `notes`, reversal reasons, masked destinations in event payloads |
| `draw_entries` | `prospectId` → null (erased people must not be pickable — `luckyDrawService.js:427-474` only excludes null), scrub `phoneLast4`/hash/masked-name snapshots; **decide + test the erased-pending-winner path** (before freeze / after freeze / after pick) |
| `short_links` | deactivate the person's `ref=` share links (`shortLinkService.js:121-134`); clicks keep only non-identifying aggregates |
| `session_visits` / `attributions` / `qr_scans` | unlinked via prospect nulling; rows keep no direct identity (hashed ip/UA — acceptable residual, documented) |
| `webhook_deliveries` | **in-txn scrub of `payload` for every delivery of this prospect** (copies live forever otherwise — `webhookService.js:416-427`) |
| `consumers` | `phone`, `phoneHash`, names, email, `unsubTokenHash` → null; `erasedAt`; suppression (`all`,`erasure`); ledger event (`source:'erasure'`) |

Deletion notification: **inside the erasure txn**, persist `lead.deleted` deliveries for every destination that ever received this prospect (reuse the `deleteProspect` in-txn pattern at `:1308-1359`, extended to external-agent destinations); flush post-commit. **Known gap, stated:** Lyfe's subscriber doesn't include `lead.deleted` (`bootstrap.js:328-353`) and `receive-mktr-lead` has no handler — cross-repo follow-up (subscribe + EF handler in lyfe-app) ships alongside PR C, with a manual SOP in the interim. Re-signup after erasure = new consumer, fresh consent (no tombstone — `phoneHash` is nulled per PDPC anonymisation guidance).

## 5. Decisions (v2 — challenge these, then we implement)

1. Phone = identity key; email = attribute (unchanged).
2. **Retell/call_bot excluded from the spine** until consumer-leg selection is trustworthy (REVERSED from v1 — `to_number` evidence).
3. **Unverified rows link but carry no authority**: linkage gives ops visibility; consent authority requires the OTP stamp (`verified` on events; `canMarketTo` demands it). Softer than Codex's "leave unlinked": journey pollution by a hostile direct-API poster is cosmetic and badged, while unlinked-but-suppressible rows would make suppression fail open. Phone-keyed fail-closed enforcement (§3.2) is the backstop either way.
4. **Consent is campaign-scoped; cross-campaign marketing waits for an explicit global opt-in (Phase 2).** The flywheel's legal basis gets built, not assumed.
5. Opaque stored unsubscribe token; GET never mutates (both REVERSED from v1).
6. Suppression reasons: `erasure` blocks all sends; others block marketing only; WhatsApp sends declare `purpose`.
7. No `phoneHash` tombstone after erasure (REVERSED from v1).
8. `consumerId` excluded from all webhook payloads in these PRs (test-asserted).
9. Entitlement `consumerId` set unconditionally at issuance (v1's "optional cut" dropped).
10. Boot-run migrations stay, hardened: advisory lock + per-migration txn + sync-tolerant guards; deploy order = PR A schema+dual-write in one deploy (savepoint isolation covers the seconds-long window), reconciler heals.
11. No `tenant_id` on new tables (unchanged).

## 6. Test plan (v2 — folds Codex's list)

Real-Postgres (5433 throwaway) unless noted:
- Concurrent captures of one phone: same campaign (one 409, one create) and different campaigns (both create, one consumer, count=2) — no 23505 surfaces (upsert), savepoint isolation proven by injected SQL failure inside the outer txn (capture still commits, consumerId null).
- Dropped `consumers` table → capture 201s (savepoint rollback, warn logged).
- Meta linkage: non-normalized provider phone matches the same consumer as a web signup of the same number; `verified:false`; Retell rows never link and reconciler nulls any that did.
- Phone edit: old→new relink, both projections recomputed, verification stamp cleared, entitlement issuance now fails `phone_not_verified` until re-OTP (drive-by fix covered); edit-to-existing-consumer merge collision; hard/bulk delete recompute.
- Reconciler: run twice → byte-identical projections; heals a wrong link and a stale count; concurrent live capture during reconcile.
- Migrations: `sync({force:true})` then 078-081 (guards hold); two concurrent runners (advisory lock — second waits, applies nothing); crash mid-079 → rerun completes.
- Ledger: per-kind writes with correct scope/version/verified; explicit-false vs absent distinction (Retell/Meta write nothing); backfill only where keys exist; backfill unique holds on rerun; `canMarketTo` matrix incl. unverified-grant denial and campaign-scope isolation (grant in campaign A ≠ authority in campaign B).
- Enforcement: suppression by phone-join catches an UNLINKED prospect; redeemedAudience excludes suppressed; delayed CAPI after withdrawal sends no em/ph; WhatsApp transactional-vs-marketing purpose matrix.
- Unsubscribe: GET mutates nothing (scanner simulation), POST one-click + form both suppress idempotently; token invalid after erasure.
- Erasure: full matrix assertions (every table above), webhook payload copies scrubbed, `lead.deleted` persisted in-txn for all historical destinations, capture-vs-erase race (lock order), queued voucher send aborts on erased state, draw-entry exclusion + pending-winner path, crash-after-commit retry idempotent.
- Payload contract: `consumerId` absent from every webhook builder's output.
- Admin: consumers route rejects non-admin; drawer fetches detail; `?lead=` resolves off-page.

## 7. Rollout & verification

1. **Preflight** (same day as deploy): re-run the §1 SQL; capture output into the PR description.
2. PR A deploy → advisory-locked migrations 078/079 at boot. Probes: consumers == distinct eligible phones; zero non-call_bot prospects with null `consumerId` and non-empty phone; zero call_bot rows linked; the 5 known Fairprice repeats each = one consumer, `signupCount=2`; entitlements 5/5 linked. Live check: one fresh signup links at create; LeadDrawer Person card on a repeat lead; a phone edit relinks and clears verification.
3. PR B deploy → 080/081. Probes: event counts vs prospects-with-consent-keys; a test-address email carries both unsubscribe headers; GET is inert, POST suppresses; suppressed test consumer drops out of the next audience-sync selection set.
4. PR C deploy: erasure dry-run on a synthetic consumer seeded across all matrix tables; verify every row class post-erase; confirm the Lyfe `lead.deleted` follow-up is scheduled (cross-repo).
5. Standard loop per PR: Codex review → fold → merge → Render deploy-verify (backend origin probe; frontend chunk check only for the PR A drawer change).

## 8. Codex round-1 disposition (for the record)

25 findings: all anchors re-verified in code. Folded: #1-2 (txn semantics → savepoint+upsert), #4 (Retell exclusion), #5 (Meta hook), #6 (edit/delete hooks + stale-verification drive-by), #7 (purpose scoping), #8/#9/#10/#11 (migration hardening, reconciler-assign, backfill uniqueness, model mirroring + CHECKs), #12 (fail-closed by phone + send-time CAPI gate), #13 (WhatsApp purpose), #14 (POST-only mutation), #15 (opaque stored token), #16-#21 (erasure allowlist, matrix, races, webhook copies, draw entries, no tombstone), #22 (unconditional entitlement link + association), #23 (payload exclusion), #24 (drawer fetch + explicit admin gate), #25 (test list). Partially adopted: #3 — linked-but-unauthorized instead of unlinked (Decisions #3). Pre-existing bugs surfaced for their own attention: entitlement verification ignores `phoneVerifiedFor` (fixed in PR A); Lyfe lacks `lead.deleted` (cross-repo follow-up); Meta stores non-normalized phones (matching-key workaround now; storage normalization later).
