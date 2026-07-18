# Prospect Source Attribution Plan — Meta ad campaign in Source column + referral identity on hover

**Status:** v2, reconciled with Codex gpt-5.5 review (`CODEX_REVIEW_SOURCE_ATTRIBUTION.md`, 2026-06-12). **Implemented 2026-06-12** (both phases, on `feat/sg-pr-gate-and-fixes`); pending: commit/deploy (backend first, §5) + Ads Manager URL params (§3.6).
**Scope:** `mktr-platform` frontend (`src/`) + backend (`backend/src/`) — capture + display only. **No DB migration, no enum change, no webhook contract change.**
**Goal:** On `/AdminProspects`, (1) a lead that came from a Meta ad shows **which Facebook ad campaign** it came from instead of a bare `FORM` tag; (2) hovering the `REFERRAL` tag shows **who referred** the lead.
**Branch context:** written against `feat/sg-pr-gate-and-fixes`. All line refs re-verified on this branch's working tree.

---

## 0. Review reconciliation (what changed from v1)

Codex's verdict: design sound, every "no schema / no shortlink / no webhook change" claim confirmed — with **1 blocker** and a set of should-fixes. All findings were re-verified against source before folding in; all were accurate (one cosmetic slip: it cites `models/prospect.js` — the file is `Prospect.js`, macOS case-insensitivity).

1. **(blocker) `fbc`/`fbclid` proves a Meta *click*, not a Meta *ad*.** Facebook appends `fbclid` to organic shares/Messenger links too. → **Two-tier badge:** `META AD` only on UTM evidence (`utm_source` ∈ meta-set — we only put UTMs on paid ads, decision f), `META CLICK` for fbc/fbclid-only rows (incl. all legacy rows). (§2e, §3.3)
2. **(should-fix) Attach `sourceMetadata.referral` only when `leadSource === 'referral'`** — hand-made `?ref=x` links already flip the client to referral; a direct API caller mixing `leadSource:'website'` + `referralRef` should not get referral metadata. (§4.3; resolves open Q1)
3. **(should-fix) Cross-campaign referrals: store ids + `sameCampaign:false`, NOT `referrerName`.** (§4.3; resolves open Q2)
4. **(should-fix) Minimize the public create response to `data: { prospect: { id } }`.** Verified consumers of `POST /prospects` response: `LeadCapture.jsx:226` (needs only `id` in v2) and dev-only `ApiTest.jsx:91`. This kills the referrer-name echo concern outright (resolves open Q7) and stops echoing fbc/fbp/consent to the public. (§4.4)
5. **(should-fix) Consistency surfaces:** `MyProspects.jsx:255` and `AdminAgentDetail.jsx:259` render raw `leadSource` ("WEBSITE") and `ProspectDetails.jsx:130` prefers `details.leadSource` — without updating them the admin table says `META AD` while agent surfaces say `WEBSITE`. → shared label helper used everywhere. (§3.5)
6. **(should-fix) Mobile AdminProspects cards show no source at all today** (`AdminProspects.jsx:451-453`) and tooltips don't hover on touch. → compact source/referral line on the card. (§3.4; resolves open Q6)
7. **(should-fix) CSV/PDF: keep the `Source` column enum stable; add a separate `Attribution` column** — external consumers of the export are unverifiable from the repo. (§3.4; resolves open Q4)
8. **(should-fix) Deploy: two-phase, backend first.** The "unreachable 400 window" argument is not provable from the repo (no deploy-ordering manifest); old cached bundles are benign (silently anonymous, same as today), new-SPA + old-API is not. Backend validation/service lands and deploys first. (§5)
9. **(confirmed pre-existing, deferred)** The list endpoint is `authenticateToken`-only; agents receive full `sourceMetadata` for **their own assigned leads** (`routes/prospects.js:24`, `prospectScope.js:10-19`) — fbp/fbc/IP/UA already flow to agents today. Not introduced or widened by this plan → logged as a TRACKER follow-up (minimal list serializer), out of scope here.
10. **(nice-to-haves folded)** `deriveAd` generalized internally by platform (TikTok-ready, renders `META AD` only for meta sources — Q3); last-touch UTM persistence confirmed (Q5); `AdminProspects.test.jsx:67-78` mocks `normalizeProspect` → mock must gain the new fields; mount-only UTM capture limitation accepted (mirrors `_mktr_fbc`).
11. **(noted, deferred)** Edge cases that can *miss* a Meta lead: server `deriveEventSourceUrl` fallback carries no query string (`prospectController.js:10-16`; client always sends the real URL — fallback is for direct API posts), and a Meta ad pointed at a `/share/{slug}` URL loses `fbclid` at the verbatim redirect (`shortlinkController.js:30`). Mitigation: ads point at `/LeadCapture` directly (decision f). Optional hardening (whitelist-forward `fbclid`/`utm_*` in the share redirect) deferred.

**Effort: ~1 day** incl. tests (v1 said 0.5–1; consistency surfaces + export column added).

---

## 1. Current behavior (code-verified)

### 1.1 Why Meta-ads leads show `FORM`

- `leadSource` is decided **client-side** at submit: `referral` | `qr_code` | `website` (`src/pages/LeadCapture.jsx:202`). A Meta-ad click lands on `/LeadCapture?campaign_id=…&fbclid=…` with no QR session → `website`.
- The table cell renders the simplified enum verbatim (`src/pages/AdminProspects.jsx:391-395`), mapped by `normalizeProspect`: `website→"form"`, `qr_code→"qr"`, `call_bot→"call bot"` (`src/utils/normalizeProspect.js:16-21`). `normalizeProspect` **drops `sourceMetadata`** from its output (`:28-50`).
- The backend **already accepts** `utm_source/utm_medium/utm_campaign/utm_content/utm_term` (`backend/src/middleware/validation.js:185-189`) and stashes them as `sourceMetadata.utm` (`backend/src/services/prospectService.js:91-97, 109-122`; locked by `backend/src/tests/quizProspectWiring.test.js:67-74`). **But `LeadCapture.jsx` never sends them** — the submit payload (`src/pages/LeadCapture.jsx:191-217`) carries `eventId/fbp/fbc/eventSourceUrl/quizResult` and no `utm_*`. The UTM path was wired for the quiz funnel and is dead on the main funnel.
- Every submit **does** already store Meta fingerprints in `sourceMetadata`:
  - `fbc` — only exists when the visitor arrived with an `fbclid` (captured to sessionStorage `_mktr_fbc`, `src/lib/metaPixel.js:21, 54-66`). **Click evidence, not paid-ad evidence** (organic FB/IG clicks carry `fbclid` too).
  - `fbp` — **NOT** ad evidence: `ensureFbp()` mints `_fbp` for *every* tracked visitor (`src/lib/metaPixel.js:94-105`). Detection must never use `fbp`.
  - `eventSourceUrl` — the full landing URL **including query string** when client-sent (`src/pages/LeadCapture.jsx:210`); the server fallback is query-less (`backend/src/controllers/prospectController.js:10-16`).
- The list endpoint returns **full Prospect rows** — `findAndCountAll` has `include`s but no `attributes` whitelist on Prospect itself (`backend/src/services/prospectService.js:880-899`); the controller passes the service result through (`prospectController.js:18-24`) — so `sourceMetadata` is already in the `/api/prospects` list response. Purely a capture + display change.
- Today the ads have **no URL parameters configured**, so even `eventSourceUrl` carries only `fbclid`, never a campaign name. The campaign *name* can only come from `utm_campaign` (Meta's `{{campaign.name}}` placeholder) — `fbclid` is opaque.

### 1.2 Why `REFERRAL` is anonymous

- The share URL is `{origin}/LeadCapture?campaign_id={id}&ref=1` (`src/pages/LeadCapture.jsx:298-301`) — `ref=1` is a boolean flag, not an identity.
- `ShareCampaignDialog` mints a public shortlink per dialog-open (`src/components/campaigns/ShareCampaignDialog.jsx:17-41` → `POST /shortlinks/public/share`, rate-limited `backend/src/routes/shortlinks.js:15,24`). The shortlink stores `createdBy: null` (`backend/src/services/shortlinkService.js:72-79`) and the redirect 302s to `targetUrl` **verbatim** — the slug is lost (`backend/src/controllers/shortlinkController.js:14-31`).
- `LeadCapture` reads `ref` **or `refshare`** (`src/pages/LeadCapture.jsx:172,186`) — but nothing in the repo ever *produces* a `refshare` param. Dead leg of an unfinished design.
- The `POST /prospects` response includes the created prospect (`backend/src/controllers/prospectController.js:57-61`) — its `id` is available client-side after submit and currently discarded.
- No other production producer of `ref=` links exists (Codex-verified: campaign Copy Link uses `customerLeadCaptureUrl(campaignId)` only, QR redirects emit `campaign_id`+`slug`).
- Conclusion: for **existing** referral rows the referrer is unrecoverable; for new ones we close the loop with no schema change.

---

## 2. Locked decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| a | `leadSource` enum **unchanged**; ad/referral display is **derived at display time** from `sourceMetadata` | display-layer | Retroactive for existing rows; zero risk to stats groupings (`prospectService.js:784`), CAPI gating (`metaCapiService.js:25-27`), Lyfe webhook contract (`prospectHelpers.js:57` forwards `sourceMetadata` verbatim — additive keys only). |
| b | UTM capture = sessionStorage at mount, **last-touch overwrite** | new helpers in `metaPixel.js` | Mirrors the proven `_mktr_fbc` pattern (`metaPixel.js:54-66`); survives the in-page quiz gate; last-touch matches Attribution semantics (`prospectService.js:128-135`). Mount-only limitation accepted. |
| c | Referrer identity = the **sharer's prospect UUID in the `ref` param** (`&ref={prospectId}` replaces `&ref=1`) | URL-carried | Flows through the shortlink `targetUrl` untouched → **no ShortLink schema change, no redirect change** (Codex-traced end-to-end). UUID is opaque, voluntarily embedded by the sharer. |
| d | Referrer resolved **server-side at create**, stashed as `sourceMetadata.referral` — **only when `leadSource === 'referral'`**; cross-campaign stores ids + `sameCampaign:false` **without** `referrerName` | resolve-once | List rendering cheap; referral chain flows to Lyfe automatically; public-API misuse can't mint referral metadata onto non-referral leads or harvest cross-campaign names. |
| e | **Two-tier Meta detection** | `META AD` ⇐ `utm.utm_source` ∈ {facebook, fb, instagram, ig, meta} (UTMs exist only on our paid ads). `META CLICK` ⇐ else `sourceMetadata.fbc` present OR `/[?&]fbclid=/` in `eventSourceUrl`. Never `fbp`. | Codex blocker: `fbclid` rides organic clicks too. Legacy rows → `META CLICK`; post-(f) rows → `META AD` + campaign name. `deriveAd` keeps an internal `platform` field (TikTok-ready); only meta sources render the badge. |
| f | Ads Manager config (outside repo, required for campaign *names*) | ad-level URL parameters: `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}` | Meta substitutes at delivery. Editing URL params re-submits the ad for review (brief); set once. Ads must point at `/LeadCapture?campaign_id=…` directly, never at `/share/{slug}` (§0.11). |
| g | Public create response minimized to `data: { prospect: { id } }` | controller change | Consumers verified: `LeadCapture.jsx:226` (needs `id`), dev `ApiTest.jsx:91`. Stops echoing `sourceMetadata` (fbc/fbp/consent/referrerName) on an unauthenticated route (`routes/prospects.js:27`). |

---

## 3. Design — Part A: Meta ad attribution

### 3.1 `src/lib/metaPixel.js` — UTM capture helpers (~25 lines)

```js
const UTM_STORAGE_KEY = '_mktr_utm';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export function captureUtmsFromUrl(search) {
  // SSR-safe like captureFbcFromUrl; extract UTM_KEYS from search;
  // if ANY present → overwrite sessionStorage JSON (last-touch); return the object or null.
}
export function readUtms() {
  // parse sessionStorage JSON; return object or null; never throw (corrupt JSON → null).
}
```

### 3.2 `src/pages/LeadCapture.jsx` — capture + forward

- Mount effect (`:47-52`): add `captureUtmsFromUrl(location.search)` beside `captureFbcFromUrl`.
- `handleSubmit` basePayload (`:191-217`): spread `...(readUtms() || {})`. The null/empty filter (`:219-224`) only drops `null/undefined/''` — keys preserved (Codex-confirmed). Server caps lengths via Joi, already live on `main`.
- **No backend change needed for Part A capture.**

### 3.3 `src/utils/normalizeProspect.js` — derive, don't store

Add to the returned object (structurally backward-compatible, Codex-confirmed):

```js
sourceMetadata: p.sourceMetadata || null,
ad: deriveAd(p.sourceMetadata),       // { platform:'meta', tier:'ad'|'click', campaign, adset, adName, utmSource } | null
referral: deriveReferral(p.sourceMetadata), // { ref, referrerProspectId, referrerName, sameCampaign } | null
```

`deriveAd` applies decision (e): `tier:'ad'` needs meta `utm_source` (campaign=`utm_campaign`, adset=`utm_term`, adName=`utm_content`); `tier:'click'` from fbc/fbclid-in-eventSourceUrl. Non-meta `utm_source` (e.g. tiktok) → `platform:'tiktok'`, no badge rendered yet.

### 3.4 `src/pages/AdminProspects.jsx` — Source cell, mobile card, exports

- Source cell (`:391-395`):

```
META AD                          META CLICK                      REFERRAL
Lead Gen — CPF June   ← utm_campaign, truncate max-w-[160px]     (hover → "Referred by …")
```

  Badge keeps the existing `<code>` styling (accent tint for `META AD`); wrapped in shadcn `Tooltip` (`src/components/ui/tooltip.jsx`) showing Campaign / Ad set / Ad / utm_source, or "Meta click — no ad UTM data" for click-tier, or "Referred by {referrerName}" / "Referrer unknown (shared before referral tracking)" for referrals.
- **Mobile card** (`:451-453`): add a compact line — source label + campaign/referrer name inline (no hover on touch; Codex Q6).
- CSV/PDF export (`:161-176`): **`Source` column unchanged** (FORM/QR/REFERRAL…); new **`Attribution`** column = `Meta: {campaign}` / `Meta click` / `Referred by {name}` / empty (Codex Q4).

### 3.5 Shared label consistency (Codex §4)

Extract one helper (e.g. `sourceBadge(prospect)` in `src/utils/normalizeProspect.js` or a small `src/lib/sourceAttribution.js`) and use it in:
- `src/pages/MyProspects.jsx:255` (currently raw `prospect.leadSource`)
- `src/pages/AdminAgentDetail.jsx:259` (same)
- `src/components/prospects/ProspectDetails.jsx:130` (`sourceLabel`) + detail rows near `:271-283`: "Ad attribution: {campaign} · {adset} · {ad}" and "Referred by {referrerName}" when present.

### 3.6 Outside the repo (after code ships)

Set decision (f)'s URL parameters on the running ads — Ads Manager (ad → Tracking → URL parameters) or Meta Ads MCP (`url_tags`). One-time per ad.

---

## 4. Design — Part B: referral identity

### 4.1 `src/pages/LeadCapture.jsx`

- New state `submittedProspectId`; on success: `setSubmittedProspectId(result?.data?.prospect?.id || null)`.
- `longShareUrl` (`:298-301`) → `…&ref=${submittedProspectId || '1'}`. `ShareCampaignDialog` re-mints the shortlink on every open with the current URL (effect deps `ShareCampaignDialog.jsx:41`); `createShareLink` guards are query-param-agnostic (`shortlinkService.js:53-67`) → UUID flows through unchanged.
- `handleSubmit` — forward the **inbound** referrer when this visitor was referred:

```js
const refValue = params.get('ref') || params.get('refshare');
// in basePayload:
referralRef: isReferral && refValue && refValue !== '1' ? refValue.slice(0, 64) : undefined,
```

- Duplicate-signup sharers (`:253-259`) have no prospect id → their links keep `ref=1` → anonymous, same as today. Accepted.

### 4.2 `backend/src/middleware/validation.js` — `prospectCreate`

```js
referralRef: Joi.string().max(64).optional(),   // sharer's prospect UUID from the share URL's ?ref=
```

### 4.3 `backend/src/services/prospectService.js` — resolve + stash (~20 lines)

In `createProspect`, alongside the existing utm/quiz handling:

1. Read `safeBody.referralRef`; **add `referralRef` to the strip-destructure (`:100-106`)** so it never reaches `Prospect.create` (`:381-383`) — locked by a test (Codex §6).
2. Resolve — **gated on `incoming.leadSource === 'referral'`**, lookup **wrapped in try/catch** (must never block lead creation):

```js
let referralMeta;
if (referralRef && referralRef !== '1' && incoming.leadSource === 'referral') {
  referralMeta = { ref: referralRef };                       // bounded raw value, always recorded
  if (UUID_RE.test(referralRef)) {
    try {
      const referrer = await m.Prospect.findByPk(referralRef,
        { attributes: ['id', 'firstName', 'lastName', 'campaignId'] });
      if (referrer) {
        const sameCampaign = incoming.campaignId != null
          && String(referrer.campaignId) === String(incoming.campaignId);
        referralMeta.referrerProspectId = referrer.id;
        referralMeta.sameCampaign = sameCampaign;
        if (sameCampaign) {                                   // no cross-campaign name harvest (Codex Q2)
          referralMeta.referrerName = [referrer.firstName, referrer.lastName].filter(Boolean).join(' ');
        }
      }
    } catch { /* never block lead creation */ }
  }
}
```

3. Merge into the `capiSourceMetadata` stash (`:109-122`): `...(referralMeta ? { referral: referralMeta } : {})`. Codex-confirmed safe: the qrTag/explicit-campaign guard deletes only `qrTagId/attributionId/sessionId` (`:159-170`), and the later quiz stash merges rather than replaces (`:297`).

### 4.4 `backend/src/controllers/prospectController.js` — minimal public create response

`res.status(201).json({ success: true, message: …, data: { prospect: { id: prospect.id } } })` (`:57-61`). Consumers verified (§2g). Kills the sourceMetadata/referrerName echo (Codex §8).

---

## 5. Deploy ordering — two-phase, backend first (Codex §7)

`validate()` runs Joi without `stripUnknown`/`allowUnknown` → **unknown body keys 400** (`backend/src/middleware/validation.js:4-7`; locked by `quizLeadValidation.test.js:25-28`). Repo cannot prove Render deploy ordering across the 3 services, so:

1. **Phase 1 (backend):** `referralRef` validation + service resolve/stash + minimal create response. Old SPA never sends `referralRef` → no-op. Deploy, verify `api.mktr.sg` live.
2. **Phase 2 (frontend):** UTM capture/forward, `ref={prospectId}` share links, badges/tooltips/exports. Old cached bundles remain benign (no `referralRef` sent → anonymous referral, same as today).

`utm_*` forwarding is deploy-order-safe in any case (already accepted on `main`).

---

## 6. Test plan

| Suite | Coverage |
|---|---|
| `backend/src/tests/referralAttribution.test.js` (new — DB-free `makeProspectService` override harness like `quizProspectWiring.test.js`) | same-campaign UUID → full `referral` incl. name; cross-campaign → ids + `sameCampaign:false`, **no name**; unknown UUID → `{ ref }`; non-UUID ref stored raw (bounded); `leadSource !== 'referral'` → **no** `referral` key; `ref==='1'`/absent → no key; `referralRef` never reaches Sequelize attrs; lookup throw doesn't block creation |
| `backend/src/tests/quizLeadValidation.test.js` (extend) | `referralRef` accepted; >64 chars rejected |
| controller/response | create response is `{ prospect: { id } }` only |
| `src/lib/__tests__/metaPixel.test.js` (extend, mirrors fbc tests `:123-154`) | `captureUtmsFromUrl` capture/overwrite/no-utm-noop; `readUtms` parse + corrupt-JSON → null |
| `src/utils/__tests__/normalizeProspect.test.js` (extend) | `ad` tiers: utm→`ad`, fbc-only→`click`, eventSourceUrl-fbclid→`click`, fbp-only→**null**, tiktok utm→platform tiktok/no badge; `referral` passthrough |
| `src/pages/__tests__/AdminProspects.test.jsx` (extend) | **update the `normalizeProspect` mock (`:67-78`) to emit `ad`/`referral`/`sourceMetadata`**; META AD badge + campaign renders; referral tooltip trigger renders; export `Attribution` column |

CI note: the 5 pre-existing suites needing local Postgres stay red locally — expected (inherited).

---

## 7. Risks / non-goals / follow-ups

- **Prospect UUID in shared URLs:** opaque, no PII, no API access without auth. Accepted.
- **Meta-lead misses (accepted edges):** server `eventSourceUrl` fallback is query-less (client normally sends the real URL); ads must not target `/share/{slug}` (redirect drops `fbclid`). Optional hardening deferred: whitelist-forward `fbclid`/`utm_*` in the share redirect.
- **Pre-existing, deferred to TRACKER:** list endpoint returns full `sourceMetadata` to authenticated agents for their own leads (`routes/prospects.js:24`, `prospectScope.js:10-19`) — consider a minimal list serializer / derived `sourceAttribution` shape later. Not widened by this plan.
- **Source filter dropdown not extended** (`ProspectFilters.jsx:56-61`): a "Meta Ads" filter needs a JSON query on `sourceMetadata` — follow-up.
- **Non-goals:** `LeadCaptureDemo` (stubs `apiClient.post`); Meta native Lead Ads rows (`leadSource='social_media'`) keep their label; no backfill job (display-layer derivation handles legacy rows organically).
- **Lyfe side:** new `sourceMetadata.utm`/`referral` keys ride the existing `lead.created` payload verbatim — additive JSON, no `receive-mktr-lead` change.

---

## 8. Open questions — resolved (Codex recommendations adopted)

| # | Question (v1) | Resolution (v2) |
|---|---|---|
| 1 | Attach referral whenever `referralRef` present? | **Only when `leadSource === 'referral'`** (§4.3). |
| 2 | Cross-campaign referrals | Store ids + `sameCampaign:false`, **no `referrerName`** (§4.3). |
| 3 | Generalize beyond Meta? | `deriveAd` keeps internal `platform`; only meta renders a badge (§3.3). |
| 4 | CSV Source format | `Source` column unchanged; new `Attribution` column (§3.4). |
| 5 | UTM last-touch vs first-touch | Last-touch (matches Attribution `lastTouchAt DESC`) (§2b). |
| 6 | Hover-only on mobile | Compact source/referral line on mobile cards + detail rows (§3.4, §3.5). |
| 7 | Strip `sourceMetadata` from public create response? | Yes — response minimized to `{ prospect: { id } }` (§2g, §4.4). |
