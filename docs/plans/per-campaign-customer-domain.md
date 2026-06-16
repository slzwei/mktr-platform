# Plan — Per-campaign customer domain toggle (redeem.sg ↔ mktr.sg)

**Status:** ✅ SHIPPED 2026-06-17 — Phase 1 + 2 deployed to prod (commit `0554719`); mktr.sg Render lead-capture redirects removed; `EMAIL_FROM_MKTR=noreply@mktr.sg` set; migration `037` applied. Remaining follow-ups (QR integration tests, "host changed → regenerate" hint, AdminShortLinks) in §11 / §12.3.
**Author:** Shawn + Claude
**Repo:** mktr-platform (Express backend + React/Vite SPA, dual-brand build)

---

## 1. Objective

Today **every** campaign's customer-facing surface (lead-capture link, QR tracker,
public preview, shortlink) resolves to **redeem.sg**. We want an **operator-chosen,
per-campaign toggle** so a given campaign can instead be served on **mktr.sg**.

Confirmed product decisions:

- **Per-campaign**, not a global switch. Default stays **redeem.sg** (zero change for
  existing campaigns).
- Choosing **mktr.sg deliberately shows the MKTR brand face to the customer**
  (MKTR wordmark, MKTR regulatory copy, MKTR-side Pixel). This is acceptable and is
  exactly how the build already behaves per host — we are NOT decoupling brand from
  host.

---

## 2. Current state (verified against code)

The reason all campaigns are on redeem.sg is **three independent layers**, each
hardcoded to redeem:

### 2.1 Frontend URL helpers — `src/lib/brand.js`
- `const CUSTOMER_HOST = 'redeem.sg'` (line 28) is a module constant.
- All customer-facing helpers use it unconditionally:
  - `customerPublicUrl(path)` (41)
  - `publicTrackingUrl(slug)` (49) — QR tracker `/t/:slug`
  - `publicShareUrl(slug)` (54) — shortlink `/share/:slug`
  - `customerLeadCaptureUrl(campaignId, extraParams)` (62) — campaign lead-capture link
  - `customerPreviewUrl(slug)` (68) — `/p/:slug`
- `publicUrl(path)` (32) is brand-self-referential (uses `brand.publicHost`) — for
  canonical/SEO only; **out of scope**.

**Callers (all the admin surfaces that copy/share a customer link):**
- `src/pages/AdminCampaigns.jsx:98` — `handleCopyLink` → `customerLeadCaptureUrl(campaignId)`
- `src/pages/AdminCampaignDesigner.jsx:53` — Preview button → `customerPublicUrl(urlPath)`
- `src/components/campaigns/editor/PreviewFrame.jsx:47` — preview chrome URL (cosmetic)
- `src/components/qrcodes/ExistingQRCodes.jsx:79,253` — `publicTrackingUrl(slug)`
- `src/components/qrcodes/CarQRTable.jsx:46` — `publicTrackingUrl(slug)`
- `src/components/qrcodes/PromotionalQRTable.jsx:46` — `publicTrackingUrl(slug)`

### 2.2 QR image generation — `backend/src/services/qrCodeService.js`
- The host is **baked into the QR image at generation time** from the global env var:
  - `const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:...'` (176, 262)
  - `const linkUrl = `${publicBase}/t/${slug}`` (177, 263)
- Set to `https://redeem.sg` in prod. One global value — **not per-campaign**.
- A `QrTag` has an **optional** `campaignId` (created at 196; updatable field at 234).
  So a QR may be campaign-bound or unbound.
- The PNG/SVG are regenerated on `updateQrCode({ regenerateCode: true })` (261-266).

### 2.3 Render edge redirect (the hard blocker — NOT in the repo)
- The `mktr-platform` Static Site (Render) has **301 redirect rules** that bounce
  `/LeadCapture`, `/LeadCapture/*`, `/t/*`, `/share/*`, `/p/*` → `https://redeem.sg{path}`.
- **Consequence:** even a hand-typed `mktr.sg/LeadCapture?campaign_id=X` is redirected to
  redeem.sg **before the SPA loads**. No code change can override this — it lives in the
  Render dashboard.

### 2.4 What already supports BOTH hosts (no change needed)
- **SPA routes** are not brand-gated for lead capture — `src/pages/index.jsx:100-104`
  renders `/LeadCapture`, `/p/:slug`, `/t/:slug`, `/share/:slug` on both builds. So the
  mktr build's SPA fully supports lead capture.
- **Backend host handling** — `backend/src/utils/publicHost.js` allowlists
  `{mktr.sg, www.mktr.sg, redeem.sg, www.redeem.sg}` (12-17). Cookie domain
  (`cookieDomainForPublicHost`), CAPI `event_source_url` fallback, and tracker-bind
  redirects (`frontendBaseForHost`) all branch on the incoming host already.
- **Internal-route host guard** (`internalRouteHostGuard`) blocks `/api/auth|admin|agents|...`
  for redeem-origin only; lead-capture / prospect / tracker APIs are **not** behind it, so
  they already work from both hosts.

So below the redirect + the two hardcoded hosts, mktr.sg lead capture would "just work."

---

## 3. Data model

Store the choice as **`design_config.customerHost`** with values `'redeem'` (default)
or `'mktr'`.

- Rides the existing JSON the designer already persists via
  `Campaign.update({ design_config })` — **no Campaign migration** (note: §11.5 does add a
  separate `QrTag.targetHost` migration for truthful QR display).
- Backend QR service reads `campaign.design_config?.customerHost` (the Campaign row is
  loaded anyway).
- Default `'redeem'` → existing campaigns and all current call sites are byte-for-byte
  unchanged unless explicitly toggled.

**Alternative considered:** a real `Campaign.customerHost` ENUM column. Cleaner for
backend queries and makes it a campaign-level (not design-level) setting, but needs a
Sequelize migration + a campaign-form field. Deferred unless we want it surfaced outside
the designer.

---

## 4. Phase 1 — toggle + share/preview links (the core ask)

### 4.1 `src/lib/brand.js` — host-aware helpers (backward compatible)
Replace the single constant with a small map + resolver, and add an **optional** host
parameter (defaulting to redeem) to each customer helper:

```js
const CUSTOMER_HOSTS = { redeem: 'redeem.sg', mktr: 'mktr.sg' };
export const DEFAULT_CUSTOMER_HOST = 'redeem.sg';

// Map a stored choice ('redeem' | 'mktr' | undefined) to an actual host.
export function resolveCustomerHost(choice) {
  return CUSTOMER_HOSTS[choice] || DEFAULT_CUSTOMER_HOST;
}

export function customerPublicUrl(path = '/', host = DEFAULT_CUSTOMER_HOST) {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `https://${host}${safePath}`;
}
export function customerLeadCaptureUrl(campaignId, extraParams = {}, host = DEFAULT_CUSTOMER_HOST) {
  const qs = new URLSearchParams({ campaign_id: campaignId, ...extraParams }).toString();
  return customerPublicUrl(`/LeadCapture?${qs}`, host);
}
export function customerPreviewUrl(slug, host = DEFAULT_CUSTOMER_HOST) {
  return customerPublicUrl(`/p/${encodeURIComponent(slug)}`, host);
}
export function publicTrackingUrl(slug, host = DEFAULT_CUSTOMER_HOST) {
  return customerPublicUrl(`/t/${encodeURIComponent(slug)}`, host);
}
export function publicShareUrl(slug, host = DEFAULT_CUSTOMER_HOST) {
  return customerPublicUrl(`/share/${encodeURIComponent(slug)}`, host);
}
```

Default-valued last param keeps every existing call site working unchanged.

### 4.2 `src/components/campaigns/DesignEditor.jsx` — carry the field
Add to the `currentDesign` initializer (the block at 58-82):
```js
customerHost: design.customerHost === 'mktr' ? 'mktr' : 'redeem',
```
It then flows through the existing `handleDesignChange('customerHost', v)` →
`onSave(currentDesign)` → `Campaign.update({ design_config })` path with no other plumbing.

### 4.3 Toggle UI (new control)
Add a **"Customer domain"** segmented control / radio pair (Redeem · redeem.sg /
MKTR · mktr.sg) wired to `onDesignChange('customerHost', value)`.

Recommended placement: **top of `ContentPanel.jsx`** (it is the single most
consequential choice — it swaps the entire brand face). Add a short helper line noting
that MKTR shows the MKTR brand to the customer. (The existing "Eligibility" section at
ContentPanel.jsx:406-432 is a good structural precedent for a small switch block.)

### 4.4 Wire the share/preview surfaces to the campaign's host
- `AdminCampaigns.jsx` `handleCopyLink` (defined `:95`, takes only `campaignId`): change
  signature to take the campaign and use
  `customerLeadCaptureUrl(c.id, {}, resolveCustomerHost(c.design_config?.customerHost))`.
  **There are TWO call sites** — the dropdown item (`:183`) and the grid button (`:350`) —
  both must pass the campaign object, or one view keeps copying redeem links.
- `AdminCampaignDesigner.jsx` `handlePreview`: pass
  `resolveCustomerHost(campaign.design_config?.customerHost)` as the host to
  `customerPublicUrl(urlPath, host)`.
- `PreviewFrame.jsx` chrome URL (47): use the in-progress
  `resolveCustomerHost(currentDesign.customerHost)` so the cosmetic browser bar matches.

---

## 5. Phase 2 — QR codes (per-campaign host baked into the image)

### 5.1 `backend/src/services/qrCodeService.js`
When a tag is campaign-bound, resolve the campaign's host and bake it into the link:
- In `createQrCode`: after `campaignId` is known, if set, load the campaign
  (`Campaign.findByPk(campaignId, { attributes: ['id','design_config'] })`), derive
  `host = campaign?.design_config?.customerHost === 'mktr' ? 'https://mktr.sg' : PUBLIC_BASE_URL`
  and build `linkUrl = `${host}/t/${slug}``.
- In `updateQrCode` regenerate path (261-266): same resolution using the tag's
  `campaignId`.
- Unbound QRs (`campaignId == null`) keep `PUBLIC_BASE_URL` (redeem default).
- Centralize the host resolution in one helper to avoid drift between the two sites.

### 5.2 QR list payload → host-aware display
The admin QR tables display the tracker URL via `publicTrackingUrl(slug)` and consume the
**list** payload, not the detail. So the host must come back from `listQrCodes`, not just
`getQrCode`.
- `listQrCodes` includes campaign attrs `['id','name','status']` (`:91`) — no `design_config`,
  not even `type`. Add a resolved `customerHost` (or `design_config.customerHost`) to that
  list include AND to `getQrCode` (`:220`).
- Update all three tables to call `publicTrackingUrl(slug, resolveCustomerHost(qr.campaign?.customerHost))`.
- Update the three tables to call `publicTrackingUrl(slug, host)`.

### 5.3 Caveat — QR images freeze the host
Because the host is baked into the PNG/SVG at generation time, **changing a campaign's
domain after its QRs exist does NOT rewrite the existing images.** New QRs use the new
host; old ones keep the old host.
- Mitigation: the existing `regenerateCode` action; optionally auto-regenerate a
  campaign's QRs when its `customerHost` changes (and only if the campaign actually has
  QRs).
- This is the main place per-campaign QR semantics get subtle — call it out in the UI.

---

## 6. Out-of-code (ops) steps — load-bearing

These are NOT code; without them mktr-hosted campaigns will not function:

1. **Render redirect relaxation** (mktr-platform Static Site): remove (or scope down) the
   301 rules for `/LeadCapture`, `/LeadCapture/*`, `/t/*`, `/p/*`, `/share/*` so mktr.sg
   serves the SPA instead of bouncing to redeem.sg. Safe for redeem-default campaigns
   (they never emit mktr.sg links). Old hardcoded mktr.sg links would now render the MKTR
   brand instead of bouncing — acceptable (reverts to pre-cutover behavior).
2. **Meta domain verification for mktr.sg**: add the `facebook-domain-verification` TXT
   record (mktr.sg DNS) and register the domain in Events Manager for the Pixel, so
   Pixel + CAPI events fired on mktr.sg attribute and dedup. redeem.sg is already verified.
   CAPI `event_source_url` will correctly read mktr.sg via `publicHostFromRequest`.

---

## 7. Risks / edge cases for the reviewer to scrutinize

- **Reliability of the lead pipeline:** does anything in Phase 1/2 risk a lead NOT being
  captured/assigned/delivered? (The pipeline is host-agnostic below the SPA — confirm.)
- **Backward compatibility:** default `'redeem'` must make all existing call sites and
  stored campaigns behave identically. Confirm no caller relies on the old fixed-arity
  helper signatures in a way the optional param breaks.
- **Security:** host must come from the allowlisted enum (`'redeem' | 'mktr'`), never from
  free-form input that could inject an arbitrary host into a shared/printed URL.
- **QR freeze semantics** (§5.3) — is auto-regeneration worth it, or is manual regenerate
  acceptable? Any risk of mass-regenerating images unexpectedly?
- **Inline preview fidelity:** the designer's *inline* preview always renders with the
  operator build's brand (MKTR) because brand configs are build-time isolated; it cannot
  faithfully render the redeem chrome. The faithful check is the top Preview button (opens
  the real host). Is that acceptable, or do we need a clearer "preview opens on
  <host>" affordance?
- **Cookie domain / tracker bind:** confirm a `/t/:slug` scan that lands on mktr.sg
  correctly binds and redirects to mktr.sg/LeadCapture (host-aware already), and that
  cookies land on `.mktr.sg`.
- **Ordering:** the Render redirect must be relaxed before/with shipping the toggle, else
  toggling mktr.sg produces links that still bounce — a confusing half-state.

---

## 8. Acceptance criteria

- [ ] A campaign toggled to MKTR: Copy Link, designer Preview, and (Phase 2) its QR codes
      all resolve to `mktr.sg` and render the MKTR brand; lead submits, assigns, and
      delivers to Lyfe exactly as a redeem campaign does.
- [ ] A campaign left default (redeem): byte-identical behavior to today.
- [ ] No regression in existing helper callers (QR tables, shortlinks).
- [ ] `grep` of the redeem build's `dist/` still passes the brand-isolation acceptance
      test (no accidental cross-brand leakage from the new code).
- [ ] Render redirect relaxed; mktr.sg/LeadCapture serves the SPA.
- [ ] mktr.sg domain-verified in Meta; a test Lead event attributes on mktr.sg.

---

## 9. Open questions

1. Store on `design_config` (no migration, design-scoped) vs a real `Campaign.customerHost`
   column (campaign-scoped, queryable)? Plan assumes `design_config`.
2. Auto-regenerate campaign QRs on host change, or rely on manual regenerate?
3. Should `www.` variants or apex-only matter for the emitted links? (Plan emits apex.)
4. Do we want the toggle in the **designer** (matches `design_config` storage) or in the
   **campaign form/settings** (would favor a column)?

---

## 10. Review outcome — Codex gpt-5.5 (xhigh), claims verified against code

**Verdict:** READY-WITH-CHANGES. Direction is sound; the lead pipeline below the SPA is
host-agnostic (verified: `LeadCapture.jsx` → `/prospects` → `prospectService` webhook →
`webhookService` HMAC → `receive-mktr-lead` has no host dependency). The items below are
folded into the plan as required scope before it is shippable.

### 10.1 Verified corrections to this plan
- **Two Copy Link call sites**, not one — `AdminCampaigns.jsx:183` (dropdown) and `:350`
  (grid). Folded into §4.4.
- **QR host must come from the list payload** — `listQrCodes` returns campaign
  `['id','name','status']` (`:91`); the tables use list data, not `getQrCode`. Folded into §5.2.
- **`design_config` is unvalidated** — `validation.js` `design_config: Joi.object().optional()`
  accepts any object. Must clamp `customerHost` to the enum server-side (see 10.2).

### 10.2 Added must-fix scope
1. **Server-side enum clamp.** Validate/normalize `design_config.customerHost ∈ {redeem,mktr}`
   in `validation.js` (campaign create + update) and/or normalize in `campaignService`
   before any URL is generated from it. Never treat the stored value as a raw hostname —
   keep enum-choice and hostname strictly separate on both sides (frontend resolver,
   backend resolver). This closes the host-injection / open-redirect surface.
2. **Car-QR reassignment regeneration.** Two paths reassign a car QR's `campaignId`
   WITHOUT regenerating the image: the idempotent car-QR update in `qrCodeService.js:154`
   and the bulk assign in `CarQRDirectory.jsx`. Assigning a car QR to an MKTR campaign
   would leave the printed/downloaded QR pointing at redeem. Decide: regenerate on
   host-affecting reassignment, or require an explicit operator "regenerate" action (and
   surface a "host changed — regenerate" hint).
3. **Regenerate path must use the effective campaignId.** `updateQrCode` regenerate must
   resolve host from the pending/effective `campaignId`, not a stale `qrTag.campaignId`.
4. **Persist the baked host on `QrTag`** (e.g. `targetHost`/`targetUrl` at generation
   time) so admin display is truthful after a later host change, instead of inferring from
   current campaign state. Avoids the "table shows mktr.sg but the PNG still encodes
   redeem.sg" lie.
5. **Tests** (none exist for this matrix): frontend helper defaults + both copy-link paths
   + preview URL + QR-table display; backend QR create/update/regenerate across
   {redeem, mktr, invalid, unbound}; tracker/cookie on both public hosts; CAPI
   `event_source_url` + Pixel-ID behavior.

### 10.3 My refinements to Codex's softer points
- **Pixel/CAPI alignment (Codex must-fix #6) is ops, not code, in our setup.** Both the
  frontend `VITE_META_PIXEL_ID` and backend `META_PIXEL_ID` are the SAME pixel
  (`1402034528611431`), so frontend Pixel and backend CAPI already align regardless of host.
  Action = (a) confirm BOTH static sites set the same `VITE_META_PIXEL_ID`, and
  (b) domain-verify mktr.sg in Meta. It only becomes a code issue if per-brand pixel IDs
  are ever introduced.
- **Brand-isolation grep is narrow and easily avoided.** The host map values (`'mktr.sg'`,
  lowercase) do NOT match the case-sensitive `grep MKTR dist/` acceptance test. The only
  leak risk is uppercase brand text in a shared admin control (e.g. a label `"MKTR · mktr.sg"`)
  landing in the redeem build's admin chunk. Mitigation: label the toggle from `brand.name`
  / the host strings, not a hardcoded `"MKTR"` literal — then the grep stays clean.
- **Top Preview button is inherently save-bound.** `AdminCampaignDesigner.handlePreview`
  POSTs to mint a `/p/:slug` from the *persisted* campaign, so it reflects the saved host by
  construction; the live editor host shows only in the inline `PreviewFrame` chrome. Worth a
  one-line "save to preview the new domain" note in the UI; no code dependency.

### 10.4 Ordering (load-bearing)
Relax the Render redirect (and confirm `mktr.sg/{LeadCapture,p,t,share}` serve the SPA via
`curl -I`) **before or in the same release** as exposing the MKTR option — otherwise an
MKTR campaign silently degrades to a redeem experience. If that can't be guaranteed, ship
the toggle disabled/hidden in prod until the live checks pass.

---

## 11. Second-pass review — Codex gpt-5.5 (xhigh), verified against code

**Verdict:** still READY-WITH-CHANGES (improved). New customer-facing + write-path scope below.

### 11.1 Author rebuttals — outcome after challenge
- **Brand-grep (was "narrow") — CONCEDED.** The designer chunk DOES ship in the redeem
  `dist`: `ProtectedRoute.jsx:55` swaps to `MktrOnlyRedirect` only at *runtime*
  (`IS_REDEEM_BUILD`), and the lazy `AdminCampaignDesigner`→`ContentPanel` import
  (`index.jsx:51`) is not elided. So: **mandatory** — never hardcode an uppercase `"MKTR"`
  string in shared designer components; derive labels from `brand.name` / host strings.
  (Lowercase `'mktr.sg'` in `brand.js` won't trip the case-sensitive `grep MKTR dist/`
  acceptance check, which is doc-only — `CLAUDE.md:38`, not in CI.)
- **Pixel/CAPI (was "ops, not code") — PARTIALLY CONCEDED.** The "same pixel on both sites"
  premise is unproven, and the frontend tracking gate (`metaPixel.js` `shouldTrack`,
  `index.html`) keys off build-env `VITE_META_PIXEL_ID` only — not the effective/campaign
  override. Mandatory ops: confirm the mktr static site sets the shared `VITE_META_PIXEL_ID`.
  Recommended hardening: compute an effective pixel id, gate `shouldTrack` on it, and test
  `{env same / missing / different, campaign override}`.

### 11.2 New must-fixes
1. **Customer confirmation email is hardcoded Redeem (customer-facing brand gap).**
   `sendLeadConfirmationEmail` (`mailer.js:238-301`) sends "The Redeem team" copy, a
   `redeem.sg` header image, a Redeem footer, and `context: 'redeem'` — and it is fired on
   every lead-capture submit (`prospectController.js:67`). For an MKTR campaign this emails
   Redeem branding to the customer, violating the brand-face goal. Branch header/copy/
   footer/`context` (+ `EMAIL_FROM_MKTR`) by `campaign.design_config.customerHost`.
   **Doc drift (FIXED 2026-06-17):** `CLAUDE.md` previously stated the lead-capture flow
   sends no customer confirmation email and that nothing is wired to `context:'redeem'` —
   both were false; corrected in the `mailer.js` bullet + `EMAIL_FROM_REDEEM` row.
2. **`bulkOperateQrCodes` host bypass.** The `update` op (`qrCodeService.js:360`) excludes
   agent fields via `BULK_EXCLUDE` but NOT `campaignId` / `qrCode` / `qrImageUrl` /
   (future) `targetHost`. Add them to the exclude list, or route each row through
   `updateQrCode` with the regenerate/targetHost decision.
3. **Enum clamp must be service-level, not Joi.** `campaignService` update assigns raw
   `design_config` straight to `campaign.update` (`:234`); `design_config: Joi.object()`
   neither shapes nor writes back. Normalize `design_config.customerHost` ∈ {redeem,mktr}
   in the service before update, preserving all other design keys; every URL resolver
   defaults invalid/missing → redeem.

### 11.3 Complete QR write-path inventory (all must honor host / regen decision)
- `createQrCode` (`:125`) — new promo/car/unbound.
- Idempotent car update inside create (`:154`) — reassigns `campaignId`, no regen.
- `updateQrCode` (`:237`) — regen only on `regenerateCode`; must use the *effective*
  (pending) `campaignId`, not stale `qrTag.campaignId`.
- `bulkOperateQrCodes` 'update' (`:360`) — see 11.2(2).
- Frontend: `PromotionalQRForm.jsx:92` (promo create), `CarQRDirectory.jsx:67,146`
  (auto-create + bulk assign, no regen), `CarQRSelection.jsx:158` (create/reassign; not
  currently imported by active pages).
- `detachCarQrTags` on archive (`campaignService.js:474`) sets `campaignId=null` → QR
  becomes unbound/default-host. No regen needed; baked host (if mktr) is harmless once the
  redirect is relaxed. Do NOT mutate targetHost here.

### 11.4 Customer-URL emitters — already host-inheriting, just need tests
`LeadCapture.longShareUrl` (`window.location.origin`), `ShareCampaignDialog` (same-origin
`/share/:slug`), `shortlinkService` (allows both owned hosts), tracker same-host redirect,
CAPI `eventSourceUrl` (`location.href` / request-host fallback), sitemap/robots
(build-level, not campaign-level). These follow the served host correctly — add tests, no
code change.

### 11.5 `QrTag.targetHost` design
Add `targetHost` enum (`redeem|mktr`) + derive the display URL from it; only add `targetUrl`
(immutable full URL) if you want exact historical links, and never accept it from user
input. Backfill existing rows → `redeem` (current `PUBLIC_BASE_URL`); leave nullable for any
legacy/unknown. Do NOT infer the baked host from current campaign state.

---

## 12. Final review (pass 3, Codex gpt-5.5 xhigh) — authoritative consolidation

**Verdict:** READY-WITH-CHANGES, High confidence. Codex confirms further review rounds are
diminishing returns — implementation + staging smoke is the next useful signal. **Where
this section conflicts with §3–§11, this section wins.**

### 12.1 Open questions (§9) — LOCKED
1. **Storage** = `design_config.customerHost` (no Campaign migration). QR display = persisted
   `QrTag.targetHost` (new migration, §11.5).
2. **Toggle** lives in the **designer** (`ContentPanel`).
3. **Emitted links** are **apex** (`mktr.sg` / `redeem.sg`), never `www.`.
4. **QR regeneration** on host change is **explicit/manual** — no mass auto-regenerate; only
   the per-tag write paths re-bake on host-affecting reassignment.

### 12.2 Superseded / reconciled
- §10.3 (pixel "ops not code"; brand-grep "narrow") → **superseded by §11.1**.
- §5.1 "regenerate uses existing `qrTag.campaignId`" → use the **effective/pending** `campaignId`.
- §5.2 single instruction: tables read **persisted `qr.targetHost`** (not current campaign host).
- §11.2 CLAUDE.md drift → **fixed 2026-06-17**.

### 12.3 New gaps (pass 3, verified against code)
1. **Email needs campaign `design_config` plumbed in.** `prospectService.js:750` builds
   `prospectWithCampaign` ONLY when an agent is assigned, and includes campaign
   `['id','name']` only — no `design_config`. `prospectController.js:67` passes
   `prospectWithCampaign || prospect`. So `customerHost` is unavailable to
   `sendLeadConfirmationEmail` in both branches. Fix: build the campaign-bearing prospect
   **unconditionally** for the confirmation send and include `design_config` (or load it in
   the mailer) so the email can branch brand by host.
2. **`AdminShortLinks.jsx:87`** emits a relative `/share/:slug` (opens on the admin host).
   Make host-aware or explicitly mark admin-only / out of scope.
3. **`backend/src/database/seed/backfillQRTags.js:36`** bakes a **relative** `/t/${slug}`
   into the PNG (no host). Update to the host resolver + write `targetHost`, or retire it,
   before the QR rollout.
4. **Bulk QR exclude** must also block **`slug`** (alongside `campaignId` / `qrCode` /
   `qrImageUrl` / `targetHost` / `targetUrl`).

### 12.4 Consolidated implementation checklist (the build order)

**[shared resolvers]**
1. Frontend resolver in `src/lib/brand.js`: enum `redeem|mktr`, default `redeem`, host map,
   optional host params on the 5 customer helpers (backward-compatible).
2. Backend resolver: normalize enum → base URL; invalid/missing → redeem. Never accept a
   raw hostname from `design_config`.

**[backend]**
3. Normalize `design_config.customerHost` in `campaignService.updateCampaign` (`:234`),
   preserving other design keys. Apply the same helper anywhere design_config is written.
4. QR target helper: effective `campaignId` → campaign `design_config` → `targetHost` + link
   URL; unbound QR stays default `PUBLIC_BASE_URL`.
5. `createQrCode` (incl. idempotent car update `:154`): set `targetHost`, regenerate when
   the assignment changes the target host.
6. `updateQrCode` (`:237`): resolve host from the **pending/effective** `campaignId`;
   regenerate on request or on a host-affecting reassignment.
7. Lock down `bulkOperateQrCodes` 'update' (`:360`): exclude `campaignId`, `slug`, `qrCode`,
   `qrImageUrl`, `targetHost`, `targetUrl` — or route each row through `updateQrCode`.
8. `QrTag.targetHost` migration + backfill (existing rows → `redeem`); add to list/detail
   serialization.
9. Update/retire `backfillQRTags.js` to use the resolver + write `targetHost`.
10. Confirmation email (`mailer.js`): branch copy/header/footer/`context`/from by
    `customerHost`; plumb `design_config` per 12.3(1).

**[frontend]**
11. `customerHost` in `DesignEditor` state + save path.
12. Customer-domain control at top of `ContentPanel` — label from `brand.name`/host strings,
    NO hardcoded uppercase `"MKTR"` literal (ships in the redeem chunk).
13. `AdminCampaigns`: pass the campaign at **both** copy-link sites (`:183`, `:350`).
14. `AdminCampaignDesigner`: preview from persisted campaign host (save-bound; add a note).
15. `PreviewFrame`: chrome URL from in-progress `currentDesign.customerHost`.
16. QR tables: display/copy from `qr.targetHost`; show a "host changed — regenerate" hint
    when the campaign host differs from the baked `targetHost`.
17. `AdminShortLinks`: host-aware or explicitly out of scope (12.3.2).

**[tests]**
18. Frontend: resolver defaults/invalids, both copy-link paths, preview URL, inline chrome,
    QR tables, redeem-build `grep MKTR dist/` stays clean.
19. Backend: campaign normalization, QR create/update/reassign/bulk/backfill `targetHost`,
    serialization, confirmation-email contexts.
20. Integration/E2E: redeem default submit, mktr submit, tracker cookies/redirects on both
    hosts, shortlink open-redirect guard, CAPI `event_source_url`, Pixel env/override.

**[ops / rollout]**
21. Ship the `QrTag.targetHost` migration/backfill **before** backend code that writes it.
22. Relax Render redirects on `mktr-platform` for `/LeadCapture`, `/t/*`, `/share/*`,
    `/p/*`; `curl -I` confirm no 301 **before** exposing the toggle.
23. Keep `PUBLIC_BASE_URL` = redeem default; verify `MKTR_FRONTEND_URL`,
    `REDEEM_FRONTEND_URL`, `EMAIL_FROM_MKTR`, `EMAIL_FROM_REDEEM`.
24. Confirm **both** static sites set `VITE_META_PIXEL_ID`; backend `META_PIXEL_ID` matches.
25. Verify `mktr.sg` in Meta Events Manager; run a Pixel + CAPI test Lead on mktr.sg.
26. Roll out with the MKTR toggle **hidden/disabled** until 22 + 25 pass.
