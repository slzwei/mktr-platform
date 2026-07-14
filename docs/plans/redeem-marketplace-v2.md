# Redeem.sg Marketplace v2 — Implementation Plan

**Date:** 2026-07-14 · **Status:** IMPLEMENTED 2026-07-14 (branch `feat/redeem-marketplace-v2`; all flags dark). Implementation notes: (a) partner-enquiry Phase 7 shipped as mailto CTA per the deferral; (b) `preferred_branch` intake uses charset-sanitisation rather than an ops-location identity check (avoids a per-submit redeem-ops query; school level + timing ARE config-validated); (c) marketplace list cache state lives in model-free `services/marketplaceCache.js` so writer services can invalidate without importing the read model; (d) client-supplied `sourceMetadata` remains passthrough for internal callers (documented contract in prospectServiceCapi.test.js — public route strips it via Joi) with the `marketplace` subkey scrubbed server-side.
**Design source of truth:** claude.ai/design project `6ae0fb7b-3773-4695-950f-1dbbc1dd1b9f`
(`Redeem.sg Prototype v2.dc.html`, `Design Config Schema.dc.html`, `Analytics Event
Taxonomy.dc.html`, `mock-api-v2.js`, `OfferCardV2.dc.html`). Design reconciled against the
repo twice (2026-07-14); plan reviewed by Codex (gpt-5.6-sol, xhigh) with all findings
verified against code and folded in.

## What we're building

A consumer marketplace on **redeem.sg**: browse/explore/category pages, per-campaign offer
detail pages (`/offers/:slug`), a step-based redemption flow (`/flow/:slug`), a DSA guide,
and supporting content pages — reading campaigns as a **two-layer object**: `design_config`
(designer-authored, existing JSONB) + `ops` (composed server-side, read-only, from Redeem Ops
entities: PartnerOrganisation / PartnerLocation / RewardOffer / RewardOfferLocation /
Activation / Draw). Lead submission, routing, OTP, DNC, consents, CAPI/pixels, and the
reward pass all reuse the existing production pipeline.

**This supersedes the Concept-B drop-culture homepage** (`RedeemHome.jsx`) at the redeem apex
once the flag flips; RedeemHome stays live until then (dark launch).

## Non-negotiable ground truth (verified in code — do not fork these)

| Contract | Reality |
|---|---|
| Form config | `design_config.visibleFields` / `requiredFields` ({key: bool}) + `fieldOrder` which is **either** legacy `string[]` **or** row objects `{id, columns: [fieldId…]}` — the current designer normalizes TO row shape (`DesignEditor.jsx:21`), and `CampaignSignupForm.jsx:813` renders both. Field rendering lives in `signup/FieldRenderer.jsx`. The marketplace renderer must accept both shapes |
| Age gate | `campaigns.min_age` / `max_age` columns; server re-checks and 422s (`prospectService.js:532-541`); already exposed via `/api/previews/public/:id` |
| Lucky draw | `design_config.luckyDraw {enabled, closesAt, multiplier, activationId, termsVersionId, termsHash}` (normalized by `backend/src/utils/luckyDraw.js`) — **contains internal IDs that must never reach a public DTO**. Ops-side `Draw` row: statuses `open\|frozen\|sealed\|drawn\|published\|claimed\|void` (no `cancelled`). Intake gates on `luckyDraw.closesAt` (`prospectService.js:373-384`); a created Draw snapshots its own cutoff (`luckyDrawService.js:132`) |
| Featured | `design_config.featuredDrop` + public `GET /api/campaigns/featured-drops` (60s cache; admin-only publication via `applyFeaturedDropPolicy`; gate = `is_active: true` AND `status: 'active'` — `featuredDropsService.js:30`) |
| Submit | `POST /api/prospects`, public + rate-limited, Joi `prospectCreate` with `stripUnknown: true` (`prospects.js:26`, `validation.js:171`): **flat camelCase** — `firstName` (required), `lastName`, `email` (required), `phone`, `leadSource` (required), `campaignId`, `qrTagId`, `date_of_birth`, `postal_code`, `education_level`, `monthly_income`, `eventId`, `fbp/fbc/ttclid/ttp`, consent flags, `referralRef`. Unknown keys are silently stripped — new fields MUST be added to the Joi schema |
| Duplicate | 409; apiClient throws with `err.status === 409` and `err.data?.alreadyRegistered === true` (nested under `data` — `prospectService.js:490`, `src/api/client.js:156`) |
| Success | 201 `{success, data: {prospect: {id}, shareUrl}}`; `shareUrl` (shortlink) targets `/LeadCapture` only — `shortlinkService.js:51,102` |
| OTP | `POST /api/verify/send` / `POST /api/verify/check` (`skipAuth`); channel from `design_config.otpChannel`, WhatsApp falls back to SMS (`verificationService.js:131`). **No other SMS path exists** — confirmations are email (`prospectController.js:58`; reservation/voucher email via `fulfilmentNotify.js`) |
| DNC | `POST /api/dnc/check` → `{registered}`; consent submitted as `consent_dnc` |
| Gates | `design_config.sgPrOnly`, `design_config.excludeAdvisors` (both exist) |
| Consents | `consent_contact` (pre-ticked opt-out; gates hashed em/ph in CAPI + direct-marketing follow-up), `consent_terms` (required), `consent_third_party` (opt-in; gates **external-buyer** routing — `prospectService.js:390` — NOT a general "consultant will contact you" switch) |
| Campaign auth | `PUT /api/campaigns/:id` is `requireAgentOrAdmin` (`campaigns.js:87`) and accepts `is_active` — agents can activate campaigns. Archive changes `status` only. `isPublic` = intra-staff visibility, not a consumer gate |
| Campaign types | `type ∈ {…, quiz, guided_review, …}` — quiz/guided-review campaigns have their own funnels and are NOT marketplace-compatible in v1 |
| Activation | Partial unique index enforces **one live Activation per campaign** across preparing/active/paused (`Activation.js:55`, migration 049) — multiple live rows = data corruption, not a selection problem. Exhaustion does NOT change status; issuance fails its atomic counter (`entitlementService.js:85`) |
| Reward locations | Offer-specific `RewardOfferLocation` join (the claim API already uses it — `rewardClaim.js:72`), NOT all partner branches |
| Reward issuance | Requires `REDEEM_OPS_ENABLED` + `REDEEM_OPS_ENTITLEMENTS_ENABLED`; post-commit fire-and-forget (`prospectService.js:1011`); a 201 lead does NOT guarantee an entitlement |
| `/t/:slug` | QR-TAG slug namespace. Tracker sets `atk`/`sid` cookies then 302 → `{frontendBaseForHost(publicHost)}/LeadCapture?{params}` — `frontendBaseForHost` returns mktr.sg for mktr hosts |
| `/p/:slug` | Preview-slug namespace (`campaignPreviews.js`) |
| Public campaign fetch | `GET /api/previews/public/:id` returns the **entire** `design_config` (`campaignPreviewService.js:85-91`) — pre-existing over-exposure, in scope to harden (see Phase 1) |
| Reward pass | `/r/:token` + `GET /api/reward-claim/:token` LIVE (flag-gated); the SPA page already renders `blocked` and `locations` (`RewardClaim.jsx:83,102`) — **no parity work needed** |
| Sequelize | `underscored: false` (`connection.js:28`) — model attributes map to camelCase column names; DDL must be camelCase (or use explicit `field`) |
| Route mounting | `backend/src/routes/index.js` auto-mounts modules exporting `meta = {path, flag, flagDefault}` |
| Model indexes | `sync({force: true})` clobbers migration indexes AND test bootstrap syncs before migrations (`bootstrap.js:25`); migration runner is non-transactional — migrations must be idempotent (`describeTable` guards, `IF NOT EXISTS`), indexes mirrored on models |
| Build | One shared `index.html` for both brands; redeem sitemap routes are hard-coded in `vite.config.js:50` |

## Decisions

1. **Publication gate (list AND detail)** = `design_config.marketplaceListed === true`
   (admin-only via new `applyMarketplacePolicy`, mirroring `applyFeaturedDropPolicy`) AND
   `slug` set AND `is_active === true` AND `status === 'active'` AND
   `resolveCustomerHost(design_config.customerHost) === 'redeem.sg'` AND
   `type` in the supported set (standard lead-capture types; quiz/guided_review excluded)
   AND ops resolvable. **No "unlisted link" semantics in v1** — detail 404s unless listed.
   Rationale: agents can flip `is_active` via PUT, so the ONLY consumer-exposure switch must
   be the admin-gated `marketplaceListed`.
2. **Campaign slug**: new nullable unique column, charset `[a-z0-9-]{3,80}`. Immutable once
   `firstActivatedAt` (new column) is set — stamped by `updateCampaign` the first time
   `is_active` flips true. `duplicateCampaign` explicitly clears `slug`, `marketplaceListed`,
   and `firstActivatedAt`. Slug added to the campaign create/update Joi schemas and saved as
   a top-level field (the designer today saves only `design_config` —
   `AdminCampaignWorkspace.jsx:82` — so the save path gains the top-level field).
3. **`/LeadCapture` is untouched.** The marketplace flow is a NEW component tree reusing the
   same endpoints. No `CampaignSignupForm.jsx` changes in v1.
4. **qr_entry** honored inside the tracker redirect behind its OWN flag
   `MARKETPLACE_QR_REDIRECT_ENABLED` (flipped only AFTER the SPA routes are live), and only
   when the validated public host is redeem.sg AND the campaign passes the decision-1 gate.
   Everything else keeps today's `/LeadCapture` redirect. Cookies set in both branches.
5. **ops composition**: THE single live Activation (unique index — if >1, log error and
   return `ops: null`). Include `RewardOffer.status === 'active'` and validity window; list
   excludes exhausted (`remaining <= 0`) or out-of-validity offers; detail shows a sold-out /
   ended state. `ops.expiry = min(Activation.endDate, RewardOffer.validityEnd)` null-safe.
   `ops.partner.locations` from **RewardOfferLocation** (fallback: none — never all partner
   branches). `ops.draw` from the campaign's Draw row with `status === 'open'` only.
6. **Draw single-source rule**: consumer-facing close date = `design_config.luckyDraw.closesAt`
   (the intake gate); boost multiplier + boost deadline = the open Draw row. Designer shows a
   warning when `luckyDraw.closesAt` ≠ the open Draw's snapshotted `closesAt` (admin edits
   after Draw creation can otherwise accept entries the frozen pool excludes). T&C content =
   existing `design_config.termsContent` (sanitized dialog, same as production forms); terms
   version pinning stays server-side as today.
7. **New Partner columns** (camelCase DDL per `underscored: false`): `publicBlurb` TEXT,
   `verifiedAt` DATE, `partnerSince` SMALLINT. Wired into `partnersController` validation +
   `partnerService` editable-fields list; `verifiedAt` settable only by admin (not ordinary
   partner-edit capability). `notes`/CRM fields never leave the backend.
8. **Dark launch flags**: backend `MARKETPLACE_PUBLIC_API_ENABLED` (route `meta.flag`,
   default false) + `MARKETPLACE_QR_REDIRECT_ENABLED` (default false); frontend
   `VITE_REDEEM_MARKETPLACE_ENABLED` (redeem build only; also switches apex `/`).
9. **Marketplace metadata**: submit body gains a `marketplace` object — added to the Joi
   `prospectCreate` schema (else `stripUnknown` silently drops it) and **validated
   server-side against campaign config**: `preferred_branch` must match an offer location
   name, `child_school_level` ∈ `design_config.school_levels`, `preferred_timing` composed
   from `design_config.availability` values, `child_name` trimmed ≤120 chars. Stored at
   `sourceMetadata.marketplace`. The service explicitly ignores any client-supplied raw
   `sourceMetadata` key. **Webhook note:** `sourceMetadata` is forwarded verbatim to the
   Lyfe `lead.created` webhook (`prospectHelpers.js:79`) — `child_name` (minor's first name)
   therefore reaches Lyfe; the campaign `data_use` copy must disclose it, and the Lyfe
   receiver needs no change (stores metadata opaquely) but gets a contract-note in
   lyfe-master docs.
10. **Draw confirmation copy**: boost arrangement is communicated via the confirmation
    EMAIL (no SMS exists) and, when `consent_contact` is on, the assigned consultant's
    outreach at the verified number. No copy references `consent_third_party` (that consent
    gates external-buyer routing only) and none references SMS.
11. **shareUrl limitation (v1, documented)**: the confirmation's referral link targets
    `/LeadCapture?campaign_id=…` (shortlink service allows only that). Friends land on the
    legacy form — lead still captured + attributed via `ref`. Marketplace-aware share links
    are a fast-follow (shortlink target allowlist + `/offers/:slug` support).
12. **Fonts/visuals**: single shared `index.html` — fonts load via CSS `@import` inside the
    marketplace stylesheet (`rm-` prefixed, mirrors `redeemHome.css` conventions), so the
    mktr bundle is untouched. New static routes added to the redeem sitemap list in
    `vite.config.js`.

## Phase 0 — Migrations + models (idempotent)

- **066-add-campaign-slug.js**: `campaigns.slug` STRING(80) NULL, `campaigns.firstActivatedAt`
  DATE NULL, partial unique index `uq_campaigns_slug WHERE slug IS NOT NULL`
  (`CREATE UNIQUE INDEX IF NOT EXISTS`), `describeTable` guards. Mirror index + attributes
  (with `is: /^[a-z0-9-]{3,80}$/`) on `Campaign.js`.
- **067-partner-public-profile.js**: `partner_organisations."publicBlurb"` TEXT NULL,
  `"verifiedAt"` DATE NULL, `"partnerSince"` SMALLINT NULL (camelCase, guards as above).
  Mirror on `PartnerOrganisation.js`.
- No prospects migration (JSONB) and no min_age migration (columns exist).

## Phase 1 — Public marketplace API

New `backend/src/services/marketplaceService.js` + `backend/src/routes/marketplace.js`
(`meta = {path: '/api/marketplace', flag: 'MARKETPLACE_PUBLIC_API_ENABLED', flagDefault: 'false'}`),
rate-limited like `rewardClaim.js`.

- `GET /api/marketplace/campaigns` (list) and `GET /api/marketplace/campaigns/:slug`
  (detail) — both apply the FULL decision-1 gate; 404 otherwise.
- **DTO is reconstructed field-by-field — no nested-object passthrough:**
  - campaign: `id, slug, name, min_age, max_age, metaPixelId, tiktokPixelId`
  - design_config (rebuilt): `name, category, offer_type, qr_entry, age_range,
    school_levels, dsa_related, mode, availability {days, slots}, inclusions, image_label,
    showCapacity, activation {required, type, duration_mins, summary, detail},
    sponsor {kind, disclosure} | null, value_line, featuredDrop, sgPrOnly, dncCheckAtSubmit,
    excludeAdvisors, otpChannel, termsContent, content_blocks {data_use, cancellation, faq},
    themeColor, fieldOrder (normalized), visibleFields, requiredFields,
    luckyDraw: {enabled, closesAt, winners} ONLY` — **never** `activationId`,
    `termsVersionId`, `termsHash`, quiz config, customerHost, or unknown keys.
  - ops (rebuilt): `partner {name ← brandName||tradingName, verified ← !!verifiedAt,
    since ← partnerSince, blurb ← publicBlurb, locations[{name, area}] ← RewardOfferLocation}`,
    `capacity {total, remaining}`, `expiry`, `retail_value` (Number-cast from DECIMAL),
    `claim_expiry_days`, `redemption_expiry_days`,
    `draw {closesAt, boostClosesAt, multiplier} | null` (open Draw only).
- **Cache**: 60s in-process with coalescing, stale-on-error **bounded to 5 minutes** (then
  fail empty), and a write-side version bump (campaign/activation/reward-offer mutations call
  `marketplaceService.invalidate()`); the cache is display-only, never consulted for
  issuance decisions.
- **Harden the pre-existing leak**: `campaignPreviewService.getPublicCampaign` (used by
  `/api/previews/public/:id`) gets the same design_config key whitelist (superset needed by
  LeadCapture: adds `quiz`, `termsContent`, `heroFont`, layout/copy keys — enumerated from
  actual `LeadCapture`/`CampaignSignupForm`/`PreviewFrame` reads) so full raw
  `design_config` (incl. luckyDraw internals) stops being publicly dumpable. Regression-test
  LeadCapture + quiz + preview against the whitelist.

- **Designer-support endpoints (authenticated, flag-independent):**
  `GET /api/campaigns/:id/marketplace-preview` (composed DTO for drafts — powers the
  designer ops-preview panel) and `GET /api/campaigns/slug-availability?slug=…`.

## Phase 2 — Designer + service clamps (operator side)

- `campaignService.updateCampaign`: accept top-level `slug` (Joi added; immutability per
  decision 2), stamp `firstActivatedAt`, clamp new design_config enums server-side
  (`qr_entry ∈ {direct, detail}`, `offer_type`, `mode`, `category ∈ CONSUMER_CATEGORIES`),
  shape-check `age_range/availability/inclusions/content_blocks/activation/sponsor` (drop
  unknown keys), apply `applyMarketplacePolicy` (agents can't set/unset `marketplaceListed`;
  also strips it on the bulk paths, mirroring featuredDrop).
- `duplicateCampaign`: clear `slug`, `firstActivatedAt`, `design_config.marketplaceListed`.
- Designer UI (`editor/ContentPanel.jsx` + new `MarketplacePanel.jsx`): slug field w/
  availability check, listing toggle (admin-only render), category/offer_type/mode,
  age_range + school_levels ("Audience (display/filter)" — labeled distinctly from the
  min_age/max_age "Submitter age gate"), availability chips, inclusions editor, activation
  copy block, sponsor block, value_line override, showCapacity, qr_entry, content_blocks,
  draw-cutoff consistency warning (decision 6), read-only ops preview via the authenticated
  preview endpoint.

## Phase 3 — Consumer SPA (redeem build, dark)

New `src/pages/marketplace/` + `src/components/marketplace/`:

- **Routes** (gated `IS_REDEEM_BUILD && VITE_REDEEM_MARKETPLACE_ENABLED === 'true'`):
  `/` (Home — replaces RedeemHome element when on), `/explore`, `/c/:id`, `/dsa`,
  `/offers/:slug`, `/flow/:slug`, `/how-it-works`, `/businesses`, `/about` (**replace** the
  existing `/about` element on the redeem build — no duplicate route), legal links reuse the
  EXISTING `/personal-data-policy` and `/leads/privacy` routes (+ small new `/legal/terms`,
  `/legal/dnc` static pages). `/winners`, `/r/:token`, `/LeadCapture` unchanged. Nothing
  mounts on the mktr build. Sitemap list in `vite.config.js` updated.
- **Components**: `OfferCard` (per OfferCardV2 spec), nav/footer, `JourneyProgress`, flow
  steps (`Screen` SC/PR, `Advisor`, `Details`, `Child`, `Prefs`, `Otp`, `Dnc`, `Consent`,
  `Confirmation`, `Duplicate`).
- **Details renderer**: reuse/extract the production primitives — the row/legacy `fieldOrder`
  normalization (from `DesignEditor.normalizeFieldOrder` / `CampaignSignupForm`) and
  `signup/FieldRenderer.jsx` field defs — so both config shapes render identically to
  production. No parallel field-def table.
- **Flow machine** (`useMarketplaceFlow`): steps `[screen?] → [advisor?] → details →
  [child?] → [prefs?] → otp → [dnc?] → consent → done`. Endpoints: `/verify/send`,
  `/verify/check`, `/dnc/check`, `POST /prospects`. Submit payload = the REAL contract:
  split name → `firstName`/`lastName`, `email`, `phone`, `leadSource: 'website'` (or
  `qr_code` when session-attributed), `campaignId`, `date_of_birth`, `postal_code`,
  `education_level`, `monthly_income`, `eventId`, `fbp/fbc/ttclid/ttp`, `eventSourceUrl`,
  consent flags incl. `consent_dnc`, `referralRef`, plus `marketplace: {child_name,
  child_school_level, preferred_branch, preferred_timing}`. Duplicate = catch
  `err.status === 409 && err.data?.alreadyRegistered`. QR attribution: `GET /qrcodes/session`
  → attach `qrTagId` (same as LeadCapture).
- Age validation client-side from `min_age`/`max_age` (reuse `getAgeValidationError`);
  server 422 authoritative.
- **Draw UI**: mechanics + boost tier per decision 6; T&C required with terms dialog from
  `termsContent`; confirmation copy per decision 10; confirmation share block uses the
  returned `shareUrl` (decision-11 limitation noted in code comment).
- **Confirmation makes no reward-state claims**: "what happens next" copy only (issuance is
  async + flag-dependent; reward-pass link arrives by email via `fulfilmentNotify` when
  entitlements are enabled).
- Home/Explore/Category/DSA use the list endpoint + client-side filters.

## Phase 4 — Prospect intake (backend)

- Joi `prospectCreate` += `marketplace: Joi.object({child_name, child_school_level,
  preferred_branch, preferred_timing}).optional()` (each string, max 120).
- `prospectService.createProspect`: validate `marketplace` values against the campaign
  (decision 9), write `sourceMetadata.marketplace`, explicitly drop any client-supplied
  `sourceMetadata`. Everything else (eventId/CAPI, consents, OTP stamp, draw gate, DNC,
  routing, entitlement hook) is untouched.
- Add a contract note to `lyfe-master` docs: `lead.created` webhook `sourceMetadata` may now
  include `marketplace.*` (incl. child first name) — receiver stores opaquely, no change.

## Phase 5 — Tracker `qr_entry` branching (backend)

`trackerController.trackSlug`: behind `MARKETPLACE_QR_REDIRECT_ENABLED`, when the validated
public host resolves to redeem.sg AND the bound campaign passes the decision-1 gate AND
`design_config.qr_entry === 'detail'` → `302 {frontendBase}/offers/{slug}?{search}`; else
current behaviour. Cookies in both branches. Lean campaign fetch
(`attributes: ['slug', 'is_active', 'status', 'design_config']`). Tests: mktr host, flag
off, unlisted, missing slug, happy path.

## Phase 6 — Analytics

- **Suppression predicate**: allow `/offers/` + `/flow/` (same preview/test-data
  suppressions).
- **Landing capture**: run `captureFbcFromUrl` / `captureTtclidFromUrl` / `captureUtmsFromUrl`
  on offer-detail AND flow mounts (they persist to session/local storage already), so
  detail-landing → flow navigation keeps attribution.
- **VC session guard**: `getOrCreateVcState(campaignId)` → sessionStorage `vc:{campaign_id}`
  holding `{eventId, firedMeta, firedTiktok}` (per-platform flags — Meta and TikTok fire
  independently). Marketplace surfaces use it; refactor `LeadCapture.jsx`'s refs onto it
  (existing single-mount behaviour preserved). In-memory fallback when sessionStorage
  unavailable.
- **Custom events**: `trackCustomEvent` helper (Meta `fbq('trackCustom')`, TikTok custom
  `ttq.track`) firing `otp_sent`, `otp_verified`, `dnc_gate_shown`, `dnc_consent_given`,
  `duplicate_blocked`, `draw_entry_confirmed` from the marketplace flow only.
- **Lead**: mechanics unchanged. **No value/currency in v1** — browser-only value would
  desync from CAPI (which sends none — `metaCapiService.js:82`); ship browser+server value
  parity together as a fast-follow.
- `content_ids = [campaign_id]`, `content_name = campaign.name`,
  `content_category = design_config.category`.

## Phase 7 — Partner enquiry — DEFERRED

The `/businesses` page ships with a `mailto:partnerships@redeem.sg` CTA in v1. The
unauthenticated CRM-write endpoint is cut: `normalizedName` matching lets strangers append
content to real CRM orgs (column not unique), `createdBy` is NOT NULL, `PartnerContact` uses
`mobile`, and `PartnerStageEvent` requires real stage transitions. Fast-follow design: a
standalone `marketplace_enquiries` staging table + admin review/promote action in Redeem Ops
— never direct public writes into `partner_organisations`.

## Testing

- **Backend (jest, mock-model pattern — no DB):** marketplace DTO (asserts luckyDraw
  internals/termsHash/customerHost/quiz NEVER appear; ops reconstruction incl.
  RewardOfferLocation + sold-out/validity exclusions), publication gate matrix (agent
  `is_active` flip does NOT expose; archived/status≠active excluded; mktr-host excluded;
  quiz type excluded), slug clamp + immutability + duplicate-clears, preview/slug-check
  endpoints, tracker branch matrix, marketplace-metadata validation (rejects unknown branch/
  level; drops raw sourceMetadata), previews/public whitelist regression (LeadCapture + quiz
  keys still present).
- **Frontend:** flow-machine step permutations; details renderer against BOTH fieldOrder
  shapes; OfferCard draw/standard/sold-out; duplicate path from a thrown 409.
- **E2E:** `/verify` skill (Playwright, both brands) — marketplace live on redeem preview
  with flag on; mktr bundle has zero marketplace chunks; `/LeadCapture` regression both
  hosts; full flow submit on a seeded campaign (throwaway pg recipe).
- **Pixel sanity:** test-event codes — single VC across detail→flow→back, per-platform
  independence, Lead on 201 only, nothing on `/r/:token`.

## Rollout

1. Merge, all three flags OFF. Verify deploys per push≠live checklist.
2. Flip `MARKETPLACE_PUBLIC_API_ENABLED`; smoke the API directly (expect empty list until a
   campaign is gated in).
3. Seed pilot: redeem-ops partner (+ `publicBlurb`/`verifiedAt`/`partnerSince`) →
   RewardOffer (+ RewardOfferLocation) → Activation → designer (slug, content,
   marketplaceListed). Note: the reward-pass leg additionally requires `REDEEM_OPS_ENABLED`
   + `REDEEM_OPS_ENTITLEMENTS_ENABLED` (currently off) — leads flow regardless.
4. Flip `VITE_REDEEM_MARKETPLACE_ENABLED` on `redeem-frontend` → redeploy → Playwright
   verify → Cloudflare purge (user-side).
5. Flip `MARKETPLACE_QR_REDIRECT_ENABLED` last (SPA routes must exist first).
6. Watch: Render logs, Meta/TikTok test events, lead arrival + round-robin, Sentry.

## Non-goals (explicit)

- No `CampaignSignupForm.jsx`/quiz/guided-review changes; those types can't be listed.
- No CAPI/browser Lead value (fast-follow, shipped together).
- No marketplace-aware share links (decision 11) or repeat-redeemer submit block.
- No partner-enquiry endpoint (Phase 7 deferred), no SEO prerender, no mktr.sg marketplace.
- `reconcileMissedLeads` discards the raw token making reconciled entitlements
  consumer-unreachable (`entitlementService.js:319`) — pre-existing bug, tracked separately,
  not in this scope.

## Codex review log (2026-07-14, gpt-5.6-sol xhigh)

7 BLOCKER / 12 MAJOR / 4 MINOR / 3 NIT findings; all spot-verified against code and folded:
DTO nested-object reconstruction + previews/public hardening (B1), fieldOrder dual shape
(B2), real prospect Joi contract + stripUnknown (B3), publication gate vs agent `is_active`
access + customerHost/type checks, no unlisted semantics (B4), reward-issuance flags +
no-reward-claims confirmation copy + no-SMS copy (B5, M10), draw cutoff single-source +
termsContent (B6), partner-enquiry deferral (B7, N3), slug lifecycle `firstActivatedAt` +
Joi + duplicate-clear (M1), RewardOffer status/validity + RewardOfferLocation + sold-out
handling (M2), Draw `open`-only selection (M3), camelCase partner DDL + authoring path
(M4), marketplace metadata validation + webhook PII note (M5), QR redirect brand/flag gate
(M6), authenticated preview + slug-check endpoints (M7), type restriction (M8), shareUrl
limitation documented (M9), bounded stale cache + invalidation (M11), landing attribution
capture + per-platform VC flags + Lead value deferred (M12), 409 `err.data` shape (m1),
single-Activation invariant (m2), `/about` replace + sitemap + fonts-via-CSS (m3),
idempotent migrations (m4), reward-pass parity removed (n1), legal route reuse (n2).
