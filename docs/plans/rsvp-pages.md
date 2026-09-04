# RSVP Pages — scope (v2, post-Codex)

> Status: **P1 LIVE (dark) 2026-09-03** — PR #488 merged, migration 130 applied on prod.
> **P2** PR #489 merged. **P3** PR #490 merged — §16. **Deployed + flags ON 2026-09-03**: backend `RSVP_ENABLED=true`, admin `VITE_RSVP_ENABLED=true`, `rsvp-frontend` created (`srv-dacinhrm8hqs73b377mg`). Awaiting: SPA rewrite + custom domain (Render dashboard), Cloudflare CNAME, admin self-test. v1 2026-09-03 · v2 after an adversarial Codex pass
> (gpt-5.6-sol, xhigh) whose claims were re-verified against the code (§13). P1 delivery
> notes: §14.
>
> One line: an admin creates an event page at `rsvp.redeem.sg/{slug}`, arranges it
> by dragging blocks and form fields, publishes, and reads responses back in admin.

---

## 1. Non-goals — read this first

This is **not a campaign**, and none of the campaign pipeline comes with it:

- No agent round-robin, lead packages, Lyfe webhook dispatch, or System-Agent path.
- No DNC scrub, OTP/phone verification, AI screening call, SG-PR gate, advisor exclusion.
- No Meta / TikTok / Google / AdRoll conversion events. No CAPI. (Enforced at the
  build boundary — §7.6, not merely "we won't call it".)
- **RSVP responses do not become prospects or consumers.** They are not leads, they
  do not enter the consumer spine, cohorts, or broadcasts. *Consequence:* the
  consumer-keyed erasure path cannot see them, so RSVP gets its own DSR branch (§8.4).
- No `design_config` v2 reuse — no templates, no migration/downgrade ledger, no
  Studio AI, no readiness engine, no marketplace listing, no `customerHost` switch.
- No ticketing, QR check-in, payments, waitlist queues, reminders/cadences,
  recurring or multi-session events, `.ics` files, per-event custom domains.

If a later need pulls any of these in, it is a separate plan.

---

## 2. What exists that we reuse — and what we deliberately don't

| Reuse | Where | Note |
|---|---|---|
| Theme presets, radii, font ids | `src/lib/designConfigV2.js` (`THEME_PRESETS`, `RADII`, `FONT_IDS`) | Pure data. Import the constants, not the schema. |
| Panel primitives | `src/components/studio/panels/panelKit.jsx` | The editor gets the Studio's look for free. |
| **Drag-and-drop precedent** | `src/components/campaigns/guided-review/GuidedReviewDesigner.jsx:1-16,175-193,447-465` | Full dnd-kit sortable **with `KeyboardSensor`** — copy this, a11y already solved. |
| Device preview | `src/components/studio/StudioCanvas.jsx:24-27,129-137` (the toggle) + `DeviceFrame.jsx` (the iframe) | The toggle lives in StudioCanvas, not DeviceFrame — extract it. |
| Atomic capacity pattern | `backend/src/services/redeemOps/entitlementService.js:227-243` | `UPDATE … WHERE count < cap RETURNING` — the race-proof idiom already in this repo. |
| Functional email index | `backend/src/database/migrations/039-add-prospect-repeat-signup-indexes.js:25-30` | `lower(trim(email))` — normalize at the DB boundary. |
| CSV injection guard | `src/lib/adminV2/csv.js:8-17` | Mirror it server-side; do not re-invent. |
| SGT boundary handling | `backend/src/utils/sgtTime.js:37-80` | For `closesAt`. |
| Route auto-discovery + default-deny | `backend/src/routes/index.js`, `routeGates.js` | Declares `meta.public` or refuses to boot. |
| Transactional mail | `backend/src/services/mailer.js`, `sendEmail({ context: 'redeem' })` | Sends from `noreply@redeem.sg`. |
| Ops-surface build pattern | `VITE_SURFACE=ops` in `vite.config.js` + `OpsSurfaceRoutes()` | The precedent for a third host — but it is **not** a copy-paste (§7). |

**Not reused, on purpose:** `design_config` v2 and its twin/clamp/lockstep corpus,
`CampaignPageRenderer`, `LeadCapture.jsx`, `prospectService`, `contactConsent` grant
scopes, `useStudioDoc` (it has **no** autosave — explicit `save()` only,
`useStudioDoc.js:159-199`; we make our own choice in §6).

**Corrected from v1:** the campaign designer *does* have drag-and-drop — the
guided-review designer, still live for `guided_review` campaigns. Only Studio's
`FormPanel` uses ↑/↓ (`FormPanel.jsx:115-144`). `ProspectKanban` is not a sortable
precedent (it refuses same-column moves, `ProspectKanban.jsx:215-238`).

---

## 3. Data model

Two tables + one migration. Models no longer sync tables into existence (baseline
rule, `CLAUDE.md`), so the migration IS the schema. Both models need explicit
entries in `backend/src/models/index.js` named exports (`index.js:381-409`) and
explicit associations — the loader is automatic, the wiring is not.

Main is at migration **125**; open PRs #478 / #480 / #487 hold numbers above it
(verified via `gh pr list` this session — Codex could not see them). Re-check the
merged directory immediately before claiming a number.

### `rsvp_events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` default |
| `slug` | string(40) unique | `[a-z0-9-]{3,40}`, reserved-root checked (§7.7). **Frozen on first publish** |
| `title` | string(120) | admin-facing |
| `organiserName` | string(120) | shown to the attendee — who receives their data (§8.1) |
| `status` | string(16) | `draft`\|`published`\|`closed`, DB `CHECK` |
| `layout` | JSONB | §4. DB `CHECK` it is a JSON object |
| `capacity` | int null | null = uncapped. `CHECK (capacity IS NULL OR capacity > 0)` |
| `closesAt` | timestamptz null | stored as an instant; SGT wall time converted `+08:00` at the API |
| `consentVersion` | string(40) | era resolved server-side at publish |
| `retentionUntil` | timestamptz null | drives purge (§8.4) |
| `createdBy` | uuid → `users` **ON DELETE RESTRICT** | never orphan an event by deleting a staff user |
| `publishedAt` | timestamptz null | |
| `createdAt` / `updatedAt` | timestamptz not null | baseline declares these NOT NULL with no DB default — **raw INSERTs must name them** |

Indexes: unique `slug`; index `status`.

**No `responseCount` column.** A derived counter needs a defined transition for
every insert / update / cancel / reactivate, and gets them wrong. Capacity is
enforced by locking the event row `FOR UPDATE` and counting `going` rows, backed
by a partial index `(rsvpEventId) WHERE status = 'going'`. If that ever measures
too slow, promote to the `entitlementService` conditional-UPDATE idiom — not to a
counter maintained by hand.

### `rsvp_responses`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `rsvpEventId` | uuid → `rsvp_events` ON DELETE CASCADE | see purge semantics, §8.4 |
| `name` | string(120) | locked field |
| `email` | string(254) | as typed |
| `emailNormalized` | string(254) | `lower(trim(email))`, written by the service, **`CHECK` enforced** |
| `phone` | string(24) null | `+65XXXXXXXX` when SG-parseable |
| `answers` | JSONB | `{ [fieldKey]: value }`, flat, per-type bounded (§5.4) |
| `status` | string(16) | `going`\|`cancelled`, DB `CHECK` |
| `consentVersion` / `consentCopyHash` | string(40) / string(64) | **write-once**: set on INSERT, never in an UPDATE |
| `sourceMetadata` | JSONB | whitelisted UTM keys + referrer origin+path only (§8.5) |
| `createdAt` / `updatedAt` | timestamptz not null | |

Indexes: unique `(rsvpEventId, emailNormalized)`; partial `(rsvpEventId) WHERE status='going'`;
`(rsvpEventId, createdAt, id)` for cursor pagination.

**Resubmit semantics:** same email → update `answers`/`phone`/`name` only. The
consent stamp is never overwritten — it is evidence of what that person agreed to,
and a resubmit after a wording change must not rewrite history.

---

## 4. The layout document (`rsvp_layout` v1)

Twin discipline: `backend/src/utils/rsvpLayout.js` is the **source of truth**
(defaults + clamp + public rebuild), `src/lib/rsvpLayout.js` mirrors it, a lockstep
test fails on divergence. Far smaller than `designConfigV2` — no version ledger.

```jsonc
{
  "version": 1,
  "theme": { "preset": "warm-cream", "accent": "#D17029", "font": "fraunces", "radius": "soft" },
  "blocks": [
    { "id": "b_1", "type": "hero",    "headline": "", "subheadline": "", "mediaUrl": "", "mediaAlt": "" },
    { "id": "b_2", "type": "details", "rows": [{ "label": "When", "value": "" }] },
    { "id": "b_3", "type": "text",    "body": "" },
    { "id": "b_4", "type": "image",   "url": "", "alt": "" },
    { "id": "b_5", "type": "form",    "headline": "Save your spot", "submitLabel": "RSVP" }
  ],
  "fields": [
    { "key": "name",  "type": "text",  "label": "Full name", "required": true, "locked": true },
    { "key": "email", "type": "email", "label": "Email",     "required": true, "locked": true },
    { "key": "phone", "type": "phone", "label": "Mobile",    "required": false },
    { "key": "f_abc1","type": "select","label": "Dietary",   "required": false, "options": ["None","Vegetarian","Halal"] }
  ],
  "confirmation": { "headline": "You're in", "body": "", "emailEnabled": true }
}
```

Five block types (`hero`, `text`, `details`, `image`, `form`), max 12 blocks.
Nine field types (`text`, `textarea`, `email`, `phone`, `number`, `date`, `select`,
`multiselect`, `checkbox`), max 20 fields, max 12 options.

Clamp invariants:

1. **Exactly one `form` block**, undeletable, reorderable.
2. `name` + `email` are `locked` — always visible, always required.
3. Custom keys match `f_[a-z0-9]{4,12}`.
4. **Once any response exists, `key`, `type`, and `options[]` are frozen and fields
   cannot be deleted.** Label, help text, required-flag and order stay editable.
   Freezing only the key is not enough: deleting a field or re-pointing an option's
   meaning silently rewrites what past attendees appear to have answered.
5. Unknown keys dropped, strings capped, enums fall back to defaults, counts capped.
6. Public reads **rebuild** from a whitelist — never dump the raw column.

---

## 5. Backend

```
backend/src/models/RsvpEvent.js, RsvpResponse.js   (+ index.js exports & associations)
backend/src/database/migrations/NNN-rsvp-events.js
backend/src/utils/rsvpLayout.js                    ← defaults, clamp, public rebuild
backend/src/services/rsvpService.js                ← publish guard, submit txn, CSV
backend/src/services/rsvpConsentRegistry.js        ← immutable era registry (§8.1)
backend/src/routes/rsvpAdmin.js                    ← meta = { path: '/api/rsvp', flag: 'RSVP_ENABLED' }
backend/src/routes/rsvpPublic.js                   ← meta = { path: '/api/rsvp-public', flag: 'RSVP_ENABLED',
                                                              public: ['GET /:slug', 'POST /:slug/respond'] }
```

### 5.1 Admin routes — authorization is explicit, not inferred

`router.use(authenticateToken, requireAdmin)` **before every route**. Default-deny
routing only proves a gate is *tagged*, not that it is an *admin* gate
(`routeGates.js:4-15,47-59` accepts plain `authenticateToken`), so a developer who
attaches only authentication would still boot — and agents could export attendee
lists. Tests must assert 401 anonymous / 403 non-admin / 200 admin per route.
All global admins may access all events (no `createdBy` ownership model).

| Route | Does |
|---|---|
| `GET /api/rsvp` | list |
| `POST /api/rsvp` | create draft with seeded layout |
| `GET /api/rsvp/slug-availability?slug=` | live check |
| `GET`/`PATCH /api/rsvp/:id` | read / save (clamped on write) |
| `POST /api/rsvp/:id/publish` · `/close` | transitions; publish freezes the slug |
| `POST /api/rsvp/:id/assets` | **own** upload endpoint (§5.5) |
| `GET /api/rsvp/:id/responses` | cursor-paginated `(createdAt, id)` |
| `GET /api/rsvp/:id/responses.csv` | streamed, injection-guarded (§5.6) |
| `PATCH /api/rsvp/:id/responses/:rid` | correct / cancel one attendee (§8.4) |
| `POST /api/rsvp/:id/purge` | irreversible; separate from close, audited |

### 5.2 Public lifecycle contract — one rule, no ambiguity

- Draft or never-published → **404**.
- Published but past `closesAt`, at capacity, or `closed` → **200 with an
  unavailable DTO** (page chrome renders, form does not). A shared link must not
  turn into a mysterious 404.
- Published and open → **200 with the form DTO**, including the exact consent copy.

`closesAt` is accepted at the API as an explicit ISO instant; an SGT wall time is
converted with `+08:00` using `sgtTime.js` — never parsed in the browser's zone.

### 5.3 Capacity and dedupe

Inside one transaction: `SELECT … FROM rsvp_events WHERE id = … FOR UPDATE`, then
check status / `closesAt` / existing `emailNormalized` / `COUNT(*) WHERE status='going'`
against `capacity`, then insert or update. Tests must run **concurrent** submits at
capacity-1 and concurrent same-email submits against a real database.

### 5.4 Response validation

Joi built dynamically from that event's own field defs, `.unknown(false)`, plus
**per-type bounds**: strings capped (short 200 / textarea 2000), `select` values
must be members of the current `options[]`, `multiselect` a unique capped array,
`date` strict ISO, `number` finite and bounded, `checkbox` boolean only, answers
flat (no nested objects). A dedicated small body limit on the RSVP router — the
global `1mb` (`server_internal.js:184`) lets 20 textareas approach a megabyte.

### 5.5 Uploads — a new endpoint, not `campaign-assets`

**v1 was wrong here.** `/api/uploads/campaign-assets` requires a `campaignId` and
stores under `campaigns/{id}` (`uploadController.js:51-62`, `uploadService.js:92-118`);
Studio actually uses `/api/uploads/single`. RSVP gets `POST /api/rsvp/:id/assets`
(admin, event verified, same content verification, RSVP namespace).

Serving matters as much as storing: without object storage the service returns a
**relative** `/uploads/...` URL (`uploadService.js:28-53`). `redeem.sg` proxies
`/uploads/*`; the RSVP site must do the same **or** RSVP assets must require object
storage and persist absolute HTTPS URLs. Pick one and smoke-test a deployed image.

### 5.6 CSV

Server-side, streamed, with the same neutralization as `src/lib/adminV2/csv.js:8-17`
(leading whitespace/control chars before `= + - @` get a `'` prefix) plus RFC-4180
quoting, applied to headers **and** dynamic answers. Parity tests with hostile values.

---

## 6. Admin UI

Home: **mktr admin v2** (`mktr.sg`). `src/lib/adminV2/nav.js` gains `Events → RSVP Pages`.

```
/admin/rsvp                 list
/admin/rsvp/:id             designer
/admin/rsvp/:id/responses   responses + CSV
```

- **Left rail:** Content · Form · Theme.
- **Content:** dnd-kit sortable blocks, modelled on `GuidedReviewDesigner` including
  `KeyboardSensor` — dragging must be keyboard-operable.
- **Form:** dnd-kit sortable fields + add-field menu + per-field editor. Frozen
  fields (event has responses) render their key/type/options read-only with a reason.
- **Theme:** preset grid + accent / font / radius.
- **Saving: explicit Save**, not autosave. Studio has no autosave to copy, and an
  autosave with no conflict model on a document two admins might open is a
  regression. Dirty-state navigation guard; server response adopted as the new
  baseline.
- **Centre:** live preview, device toggle extracted from `StudioCanvas`.

```
src/components/rsvp/RsvpPageRenderer.jsx   ← ONE component: designer preview AND public page
src/components/rsvp/blocks/*.jsx · RsvpForm.jsx
src/pages/admin/AdminRsvpList.jsx · AdminRsvpDesigner.jsx · AdminRsvpResponses.jsx
src/pages/rsvp/RsvpPublicPage.jsx
```

---

## 7. The public surface — `rsvp.redeem.sg`

The ops surface is the *shape* of the precedent, not a copy. Eight concrete pieces:

1. **Build identity.** `VITE_SURFACE=rsvp` **and `VITE_BRAND=redeem`**. Vite defaults
   every non-redeem build to MKTR title/favicon/canonical (`vite.config.js:6-30`);
   without both vars the RSVP site ships an `mktr.sg` canonical and MKTR favicon.
   Make `rsvp` first-class in the HTML defaults and give it its own title/canonical.
2. **Routes.** `RsvpSurfaceRoutes()` registers only `/:slug` and a 404. No auth, no
   admin chunks, no marketplace. (No `/thanks` route — confirmation is a page state.)
3. **Splash.** `shouldSuppressSplash` must return true for this surface
   (`src/lib/splash.js:27-46`) or a 1.5s MKTR operator splash greets attendees.
4. **AdRoll.** `AdRollRouteTracker` is excluded for ops only (`src/pages/index.jsx:218-230`)
   — exclude RSVP too.
5. **Render site.** `rsvp-frontend`, same repo/commit. Rewrites: `/api/* → api.mktr.sg`,
   `/uploads/*` if §5.5 chooses the proxy, SPA fallback `/* → /index.html` **last**.
   Cloudflare `CNAME rsvp → rsvp-frontend.onrender.com`.
6. **No ad tech, enforced.** `index.html:11-25` loads the Meta pixel loader whenever
   `VITE_META_PIXEL_ID` is non-empty — inheriting a Render env group is enough to
   contact Meta before React renders. The RSVP site gets its own env group with the
   pixel vars unset, and the build **fails** if any is populated. Assert on the built
   HTML, not on route behaviour.
7. **Host isolation — strict allowlist, not the redeem blocklist.** `redeem.sg` uses
   a blocklist that permits every unlisted path (`internalRouteHostGuard.js:20-38`);
   `/api/rsvp` is not on it, so "treat it like redeem.sg" would leave the RSVP
   **admin** API reachable from the public host. Add `isRsvpHost()` with an
   OPS-style strict allowlist (`internalRouteHostGuard.js:63-80`) permitting only
   `/api/rsvp-public`; everything else 403s before body parsing. Test that
   representative namespaces all 403.
8. **Anonymity is enforced by routing and client, not by cookie domain.** The auth
   cookie is host-only and never consults `cookieDomainForPublicHost`
   (`authCookie.js:1-16`) — v1's reasoning was wrong. But `sid`/`atk` **are** set on
   `.redeem.sg` (`leadCaptureBind.js:20-33`, `trackerController.js:71-87`) and will
   ride along to `rsvp.redeem.sg`, and the shared client always sends
   `credentials: 'include'` (`src/api/client.js:67-80`). So: a **dedicated public
   RSVP fetch client** with `credentials: 'omit'`, no localStorage token, no
   auth-event handling.

**Slug-at-root.** The slug shares a namespace with every asset path. One exported
reserved-root set (`assets`, `api`, `uploads`, `health`, `admin`, `email`, `legal`,
`leads`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `index.html`, `manifest.json`),
enforced server-side, with a test comparing it against the built static assets and
the RSVP route table so it cannot drift.

**Indexing hygiene, not access control.** Blanket robots `Disallow: /`, `noindex,nofollow`
in HTML **and** an `X-Robots-Tag` header (`trackerController.js:35-37` is the
precedent). None of that hides a URL — the design has no secrecy assumption.

---

## 8. Privacy and consent

### 8.1 Server-owned consent, like every other era in this codebase
An immutable backend registry (`rsvpConsentRegistry.js`) holds `{version, copy, hash,
scope}` — the shape `contactConsent.js:84-119` already uses. The **public GET returns
the exact copy**, the client renders that server copy, and POST **ignores any
client-supplied consent evidence** and stamps the server-resolved era. Otherwise a
cached bundle shows old wording while the server records the new hash, and we cannot
prove what the person saw. Frontend/backend copy parity is lockstep-tested, mirroring
`src/lib/__tests__/consentCopy.lockstep.test.js`.

Wording changes mint a **new** version. Closed eras are never edited.

**Editable wording (2026-09-03):** the registry still owns the *default* template and its
era; an event may override the sentence on its form block. Because the text can change,
the hash alone no longer reconstructs it — so every response **snapshots the exact
sentence** (`rsvp_responses.consentCopy`, migration 131) alongside its hash, and the
public page echoes the hash of the sentence it displayed; a submit whose hash no longer
matches the server's current copy is refused (`consent_changed`) with the new wording, so
a stale page can never be stamped against words it did not show.

### 8.2 Say who receives the data
The copy names **MKTR PTE. LTD. (UEN 202507548M)** as controller and the event's
`organiserName` as the recipient, with the purpose stated. "The organiser" alone
does not identify a data recipient.

### 8.3 Scope of the grant — REVISED 2026-09-03 (Shawn: "we might contact them again")
The v1 era's "used for this event only and not for marketing" line is CLOSED. The
**v2 default** wording covers contact about this event *and future events and offers*
from the organiser and Redeem, with an opt-out sentence — a ticked box with that
wording, hashed and timestamped per response, is the consent basis the PDPA/DNC rules
ask for. The wording is **editable per event** (form block → "Consent line", `{organiser}`
substitution, reset to default). Two things that stay true: notification, protection,
retention and access/correction obligations apply regardless of scope; and RSVP rows sit
outside the consumer spine, so any *actual* marketing to attendees later needs a send
path that honours opt-outs — none exists yet, and this plan does not build one.

### 8.4 Data-subject workflows
- Response-level admin **read / correct / cancel / scrub**, so one attendee can be
  fixed or removed without deleting the event.
- An **RSVP branch in `erasureService`** keyed on normalized email — the existing
  erasure path is consumer-keyed (`erasureService.js:687-709` handles waitlist rows
  the same way), and because RSVP deliberately sits outside the consumer spine it is
  otherwise invisible to a valid erasure request.
- `retentionUntil` + a purge job. **Close ≠ purge:** close is reversible, purge is
  irreversible, confirmed, and audited with actor and row counts.

### 8.5 Minimise what we keep
Whitelisted, capped UTM keys and referrer **origin + path** only (query strings carry
tokens). No raw IP, no user-agent unless a documented abuse need appears — and if it
does, a secret-keyed HMAC (`rateCounter.js:32-42`), never a bare hash of an IPv4
address, which is trivially reversible.

### 8.6 Abuse
Per-IP rate limiting is transport hygiene, not seat protection: the shared store
allows a 2× window burst and **fails open on a database error** by design
(`pgRateLimitStore.js:11-18,38-46`). So: honeypot, a per-email retry bucket, a
per-event surge alert, and admin cancel/reactivate to recover fraudulent seats. If a
capped event is actually attacked, add a bot challenge — capacity itself is not a
defence.

---

## 9. Flags and rollout

- Backend `RSVP_ENABLED` (route-level `meta.flag`, default off → routes never mount).
- Frontend `VITE_RSVP_ENABLED` gates the admin section.
- The public surface is its own static site — dark until DNS points at it.
- Merge dark; flip after creating one real event and self-testing the loop end to end.

**Unverified prerequisites** (external to this repo, confirm before coding): the free
migration number, Render service creation + rewrite ordering, Cloudflare DNS/TLS,
and that original-host headers survive the new proxy. Smoke-test each on the
deployed origin.

---

## 10. Phases

| Phase | Contents | Size |
|---|---|---|
| **P1** | Migration + models + associations/exports, `rsvpLayout` twin + clamp + lockstep, consent registry, admin CRUD with explicit admin gates, public GET/POST with the locked-row capacity txn and per-type validation, concurrency tests. Ships dark. | ~2 days |
| **P2** | `RsvpPageRenderer` + blocks, designer (keyboard-capable DnD ×2, explicit save), list, responses with pagination + correct/cancel, server CSV. | ~2 days |
| **P3** | `rsvp` as a first-class Vite surface (brand, splash, AdRoll, pixel-free build assertion), `isRsvpHost` strict allowlist + dedicated public client, Render site + DNS + rewrites, uploads decision, confirmation email, erasure branch + purge job. | ~1.5 days |

~5.5 days, up from v1's 3 — the review's must-fixes are real work, mostly in P1 and P3.

---

## 11. Test obligations

- **Unit:** clamp (unknown-key drop, caps, one-form-block, frozen key/type/options
  once responses exist), frontend↔backend lockstep, consent copy lockstep, reserved-root
  set vs built assets, dynamic Joi per field type incl. aggregate size, CSV
  neutralization parity.
- **Integration (real DB):** concurrent capacity-1 submits; concurrent same-email
  submits; resubmit does not overwrite the consent stamp; publish guard; the three
  lifecycle states; admin routes 401/403/200; **every non-`rsvp-public` namespace 403s
  from the RSVP host**; cascade + purge behaviour; erasure branch removes RSVP rows.
- **Migration test** exercising constraints and cascade, not just `up()`/`down()`.
- **Build artifact:** RSVP `dist` has no pixel loader, no MKTR canonical/favicon, no
  admin chunks, robots disallow present, sitemap absent.
- **Frontend:** one render test per block type, DnD reorder by pointer **and keyboard**,
  locked-field delete refused, frozen-field editor read-only.

---

## 12. Decisions taken here

1. RSVP responses stay out of the lead pipeline — with the erasure branch (§8.4) as
   the deliberate cost of that isolation.
2. Admin home is mktr admin v2.
3. Its own small schema, not `design_config` v2.
4. A dedicated Render static site, not a host-branch inside `redeem-frontend`.
5. Real drag-and-drop, keyboard-operable, copied from `GuidedReviewDesigner`.
6. Explicit save, not autosave.
7. No derived `responseCount` — count under a row lock.

---

## 13. Codex review log (2026-09-03)

Adversarial pass by `codex exec` (gpt-5.6-sol, xhigh, read-only). 19 must-fix,
6 should-fix, 2 nice-to-have. Every substantive claim was re-verified against the
code before folding it in; the citations throughout this document are that
verification, not Codex's word.

**Accepted and folded in** (v1 → v2): the concurrency/counter design (§3, §5.3);
case-insensitive dedupe at the DB boundary (§3); strict host allowlist instead of the
redeem blocklist (§7.7); the cookie-domain reasoning being wrong and the dedicated
public client that actually provides the isolation (§7.8); server-owned consent
registry + naming the data recipient + walking back the "no PDPA/DNC obligation"
claim (§8.1-8.3); consent stamps not being overwritten by a resubmit (§3);
response-level DSR workflows, the erasure branch and purge-vs-close (§8.4); RSVP as a
first-class Vite surface incl. splash/AdRoll/brand (§7.1-7.4); build-boundary
enforcement of the no-ads promise (§7.6); the wrong upload endpoint and the
`/uploads` serving gap (§5.5); per-type validation bounds and a smaller body limit
(§5.4); server-side CSV injection guard (§5.6); rate limiting not protecting seats
(§8.6); freezing field type/options, not just keys (§4); explicit admin gates
because default-deny only proves a gate is tagged (§5.1); model export/association
wiring and DB CHECKs (§3); the self-contradictory lifecycle contract and `closesAt`
timezone parsing (§5.2); trimming `sourceMetadata` (§8.5); post-commit
fire-and-forget confirmation email; slug frozen on publish; a generated+tested
reserved-root set; response pagination.

**Corrections to v1's claims about this repo** (all verified): the campaign designer
*does* have drag-and-drop (`GuidedReviewDesigner`); `useStudioDoc` has no autosave;
the device toggle lives in `StudioCanvas`, not `DeviceFrame`; `ProspectKanban` is not
a sortable precedent; `campaign-assets` is the wrong upload endpoint.

**Rejected:**

- *"Cut DnD, desktop preview, media and advanced fields from the MVP; arrows are
  sufficient."* Drag-and-drop is the explicit ask, and `GuidedReviewDesigner` makes it
  cheap. Declined.
- *"Migration numbers and open PRs are unverifiable."* Verified independently via
  `gh pr list` (#478 / #480 / #487 exist). The Render/DNS items are genuinely
  external and are listed as unverified prerequisites in §9.
- *"Robots directives are presented as privacy control."* v1 never claimed that; the
  wording in §7 now says so explicitly anyway.

---

## 14. P1 delivery notes (2026-09-03)

Built exactly to §3–§5 with the following implementation facts worth knowing:

- **Migration is 130** (`130-rsvp-events.js`); origin/main was at 127, open PRs hold
  128/129. Timestamps carry a DB default on both tables.
- **Consent copy is a template**: `{organiser}` is substituted from the event's
  `organiserName` (frozen at publish); the era hash pins the template bytes, so
  `(version, organiserName)` reconstructs the exact sentence a person saw.
- **Cursor = anchor row id**, not `createdAt|id`: a JS Date is millisecond-precise and
  `timestamptz` is microsecond-precise, so an ISO timestamp in the cursor re-admitted
  the anchor row on the next page (caught by the routes test). The `(createdAt, id)`
  tuple comparison runs inside Postgres against the anchor's own row.
- **`GET /api/rsvp/:id/responses`** (cursor-paginated) shipped in P1 — it is the backend
  half of P2's responses screen and makes the submit path testable end to end.
- **Custom field keys are `f_[a-z0-9]{4,12}`** — four characters minimum after the
  prefix. Block ids likewise (`b_…`). Fixtures with `f_ok` / `b_a1` were silently (and
  correctly) dropped by the clamp; the designer mints six-character ids.
- **Limiters carry `skip: () => NODE_ENV === 'test'`**, the repo's existing convention
  (`prospects.js`).
- Verified locally against a real Postgres (`rsvp_ci`): unit 47/47, routes + migration
  21/21 (incl. six-way concurrent capacity-1 and same-email submits), lockstep 29/29,
  regression (migrations / campaigns / prospects / cohorts) 170/170, `npm run typecheck`
  + both eslint passes clean.
- **Not in P1 (as planned):** host allowlist `isRsvpHost` + dedicated public client,
  uploads endpoint, purge/erasure branch, confirmation email, CSV, response
  correct/cancel — P2/P3.

---

## 15. P2 delivery notes (2026-09-03)

Designer + renderer + responses, per §6, with these implementation facts:

- **One renderer** (`src/components/rsvp/RsvpPageRenderer.jsx` + `RsvpForm.jsx`) mounts in
  the designer's `DeviceFrame` preview (`mode="preview"`: inert form, placeholders for empty
  slots) and on the public page (`src/pages/rsvp/RsvpPublicPage.jsx`, wired to a route in P3).
- **Designer** (`/admin/rsvp/:id`, chromeless like the Studio): rail Content · Form · Theme ·
  **Settings** (a fourth section — slug/organiser/capacity/closes-at/confirmation copy — rather
  than a top-bar popover). Two dnd-kit sortable lists with keyboard sensors
  (`designer/SortableList.jsx`, modelled on `GuidedReviewDesigner`). **Explicit Save**; the
  PATCH carries the layout plus only the meta keys that changed (`metaPatch`), so frozen
  slug/organiser are never re-sent.
- **Edits are raw, the preview is clamped.** Clamping every keystroke trimmed the space you
  were about to type after (caught by the designer test); the preview renders
  `clampLayout(layout, { frozen })` and the server clamps on save.
- **`sanitizeMultiline`** joined the twin: the single-line sanitizer strips U+000A, which
  collapsed multi-paragraph text blocks and long-text answers into one line. Text blocks,
  the confirmation body and `textarea` answers keep their newlines now (lockstep-pinned).
- **Server CSV** (`GET /api/rsvp/:id/responses.csv`) mirrors `src/lib/adminV2/csv.js`'s
  formula guard on every header and value — so `+65…` phones export as `'+65…`, exactly as
  the prospect export does. Custom answers are columns headed by their labels; ceiling 5,000
  rows (`X-Rsvp-Export-Truncated: 1`).
- **`PATCH /api/rsvp/:id/responses/:rid`** — correct name/phone/answers (re-validated
  against the event's own defs as a merged whole), cancel / reactivate (a reactivation needs
  a seat, checked under the event lock). Email is immutable (dedupe identity) and the
  consent stamp is untouched by construction.
- Admin routes + nav are gated on **`VITE_RSVP_ENABLED`** (mktr build); public client is
  `src/api/rsvpPublic.js` — `credentials: 'omit'`, no token, base `VITE_RSVP_API_BASE`.
- Verified locally: backend unit (incl. csv) + routes/audit 27/27 + typecheck + eslint;
  frontend P2 suites (renderer/form, sortable list, designer, list, responses, public page)
  + lockstep, eslint over all of `src/`.

---

## 15b. Post-go-live changes (2026-09-03)

- **Undo/redo** in the designer (#492): ⌘Z / ⌘⇧Z + buttons; typing bursts coalesce, structural
  edits are their own step; history survives saves.
- **Editable consent line + v2 era** (see §8.1/§8.3): per-event wording on the form block,
  per-response snapshot (migration 131), hash echo → `consent_changed`, CSV `consent_copy`
  column, confirmation email no longer claims "not a marketing message".
- Responses table header alignment fixed (a real `<tr>` cannot take the flex `.av2-thead`).

### 15c. The email link opens the confirmed state (#495, live 11:24 UTC)

Shawn's first test on the real domain: the confirmation email's "Open the event page"
landed on the blank form again, which reads as if nothing was recorded. Now:

- The email links to `https://rsvp.redeem.sg/{slug}?confirmed=1` and the button says
  "View your RSVP"; the "need to change something" line points at "Change my RSVP".
- `RsvpPublicPage` reads `?confirmed=1` and starts on the confirmation card
  (`done = {status: 'confirmed'}`, default body "Your RSVP is confirmed. See you there.");
  the card offers **Change my RSVP**, which reveals the form (also offered after a
  submit). No PII travels in the link — the card is a state, not a lookup.
- Verified live: a fresh RSVP on `livetest-2026` produced an email whose link carries
  `?confirmed=1`; the deployed `RsvpPageRenderer-*.js` chunk carries the button. Note
  for deploy checks: the public-page code lives in the lazy chunks
  `RsvpPublicPage-*.js` / `RsvpPageRenderer-*.js`, not `index-*.js`.

### 15d. Details rows can link out (2026-09-04)

Shawn: "make the location clickable as a google link? if needed include a field that I
can include a gmap link?" Each Details row now carries an optional `href`:

- Twin clamp: `cleanLink` — https only, ≤ `LIMITS.detailsLink` (500), dropped when the row
  has no value to hang it off. Old rows clamp to `href: ''`; nothing else changes shape.
- Designer: a "Link (optional)" field under each row plus a **Google Maps link** button
  that fills it with a Maps search for the row's own text
  (`https://www.google.com/maps/search/?api=1&query=…`). Paste a `maps.app.goo.gl` pin
  instead when the search would be ambiguous.
- Public page: the value renders as an underlined link with a ↗ glyph, `target=_blank`,
  `rel=noopener noreferrer`; the designer preview keeps it inert (click prevented).
- Confirmation email: the value is an anchor in HTML and `(link)` after the value in text.
  The mailer re-checks the https regex on read, so a stored non-https string is never linked.

### 15e. Image upload, optimised in the browser (2026-09-04)

Shawn: "i should be able to upload image. and the image should be optimised for fast
loads. this is only accepting image urls?" The hero and image blocks now have a real
picker; the URL box stays for anyone pasting a link.

- `src/lib/imageOptimize.js` — before the upload, the file is decoded with
  `createImageBitmap({imageOrientation:'from-image'})`, downscaled so its longest edge
  is ≤1600, and re-encoded to WebP at q0.82 (JPEG when the browser hands back a PNG,
  which means it cannot encode WebP). Every failure path returns the ORIGINAL File:
  animated GIF (a canvas round-trip freezes it), missing browser APIs, decode failure,
  or a re-encode that came out no smaller. A file already ≤1600px and <150KB is left
  untouched. A 6MB phone photo lands as roughly 180KB.
- `src/lib/rsvpImageUpload.js` composes that with the existing
  `POST /api/uploads/single?type=images` (multer + content sniffing already hardened),
  enforces `MAX_UPLOAD_SIZE_MB` on the OPTIMISED bytes, and reports the saving.
- **Absolute URLs.** `uploadService` now returns `publicUrl` next to `url`, built from
  `API_PUBLIC_ORIGIN` (default `https://api.mktr.sg`). The RSVP designer stores that
  one: rsvp.redeem.sg has only the SPA rewrite, so a relative `/uploads/...` would 404
  there while looking right in the designer preview on mktr.sg.
- Renderer: hero images load eagerly (first paint), a standalone image block lazily,
  both `decoding="async"`.

### 15f. Mobile verification, default ON (2026-09-04)

Shawn: "is the mobile got OTP verification? the same one on mktr? can add a toggle to
disable and enable phone otp verification? default to enabled." It had none — the mobile
field was a plain input. It now reuses the funnel's own OTP, rather than a second one.

- **Flag.** The form block gains `verifyPhone`, clamped as `raw.verifyPhone !== false`,
  so ABSENT reads as true: opt-out, never off by omission, and every event written
  before this existed becomes verified-by-default on its next read.
- **Scope.** `requiresPhoneVerification(layout)` is true only when the flag is on AND
  the form has a phone field. `phoneFieldOf` takes the FIRST field of type `phone`, so
  an owner who deleted the built-in one and added their own is covered too.
- **Endpoints.** `/api/verify/send` + `/check` (SG mobiles, 6 digits, 10 minutes, 5
  attempts, per-number daily cap protecting the SSIR "MKTR" sender id) are added to
  `RSVP_ALLOWED_PREFIXES` so rsvp.redeem.sg can reach them. Nothing new was built.
- **Server is the boundary.** `submitResponse` calls `assertPhoneVerified` before any
  write: unverifiable number → 422 `phone_unverifiable`, unverified → 422
  `phone_unverified`. It reads the DURABLE marker, so a redeploy between the code and
  the submit cannot silently un-verify someone. A blank optional mobile still passes.
- **Page.** "Send code" next to the mobile, then a 6-digit box; submit stays disabled
  until it verifies. Verification is bound to the NUMBER, so editing it reverts to
  unverified.
- **Designer.** Form panel → "Mobile verification", disabled with an explanation when
  there is no phone field, and a warning note when switched off.
- **Preview shows it.** The row renders in the designer preview too, inert (buttons
  disabled, no API calls). The first cut hid it behind `mode === 'live'`, and the owner
  read the unchanged preview as "the feature did not ship".
- **Same choreography as the funnel** (`components/rsvp/RsvpPhoneVerify.jsx`, the RSVP
  theme's answer to `campaigns/signup/OTPVerification.jsx` + FieldRenderer's phone row):
  a `+65` prefix inside the field with the number grouped `9123 4567`, a pill **Verify**
  beside it, then an inline panel that slides down — "Enter the 6-digit code we sent by
  SMS to +65 9123 4567" with **Edit**, one paste-friendly `one-time-code` input (not six
  boxes), auto-verify on the sixth digit, a resend cooldown, and on success a hold on the
  tick before it collapses into a green **✓ Verified** badge. The number is locked while
  a code is outstanding and after verifying, so what was verified is what is submitted.
  The first cut was a bare "Send code" button and a small code box; Shawn: "it should
  look like the mktr otp verification.... not the next page of the form".
- **Cost.** Every verified RSVP sends one SMS under the MKTR sender id.

### 15g. The organiser gets told (2026-09-04)

Shawn: "i need a notification. on the rsvp designer, include a place i can send emails
to, maybe multiple email addresses. make sure it works." Nothing reached the organiser
before this — an RSVP only appeared if someone opened the Responses page.

- **A COLUMN, not the layout** (migration 132, `rsvp_events.notifyEmails` JSONB `[]`).
  `GET /api/rsvp-public/:slug` hands the whole clamped layout to every visitor, so
  addresses parked there would be published. The public DTO is an explicit allowlist
  and a route test asserts the addresses never appear in that payload.
- `parseNotifyEmails` (twin) reads what a person types — one per line, commas,
  semicolons, `<addr>` — dedupes case-insensitively, caps at `LIMITS.notifyEmails`
  (10), and RETURNS what it could not read so the designer can name it. The service
  400s `notify_emails_invalid` rather than silently dropping a typo.
- Designer: Settings → "Tell me about new RSVPs", with a live count, the offending
  address called out, and a warning while the list is empty.
- Email: one message PER RECIPIENT (nobody sees the others' addresses), `Reply-To`
  the attendee so replying reaches the person. Carries name, email, mobile, every
  answered custom question, the seat count, and a link to the Responses page. Sent on
  every accepted submission INCLUDING edits — a changed dietary answer matters to
  whoever is catering. Fire-and-forget: a recipient's mail server can never fail an RSVP.

## 16. P3 delivery notes + go-live checklist (2026-09-03)

The surface, its isolation, the email, and the data-subject paths, per §7–§8:

- **Host isolation.** `rsvp.redeem.sg` joins `ALLOWED_PUBLIC_HOSTS`; `isRsvpHost()`;
  `internalRouteHostGuard` gives it a **strict allowlist of one prefix** (`/api/rsvp-public`)
  — and `/api/rsvp` (the ADMIN namespace) now sits on the consumer blocklist too, so
  `redeem.sg` cannot reach it either. `cookieDomainForPublicHost` returns `undefined` for
  the host; `https://rsvp.redeem.sg` is a default CORS origin because the static site has
  **no `/api` rewrite by design** — the cookie-less public client calls `api.mktr.sg`
  directly (`VITE_RSVP_API_BASE`).
- **Build boundary.** `scripts/rsvpSurfaceGuard.mjs`: `vite build` with `VITE_SURFACE=rsvp`
  **fails** if any ad-tech id is set or `VITE_BRAND` is not `redeem`; the HTML identity
  (title `RSVP`, canonical `https://rsvp.redeem.sg/`, redeem favicon) is forced; robots is a
  blanket disallow, no sitemap. Proven on real builds (positive + two negatives).
- **Route table.** `RsvpSurfaceRoutes()` = `/:slug` + a "not live" screen; AdRoll/touch
  trackers never mount; the operator splash is suppressed by surface as well as by brand.
  Honest footnote: Vite still *emits* the admin lazy chunks into `dist/assets` (the lazy
  declarations are module-scope — the ops build has the same property); nothing on this
  surface references them, so they are never fetched. The guarantee that is tested is the
  route table + trackers, not the chunk list.
- **Confirmation email** (`services/rsvpMailer.js`): operational only, escaped, links to
  `RSVP_PUBLIC_ORIGIN/{slug}`, sent from the redeem context, post-commit and
  fire-and-forget, only on a new or reactivated seat, honours `confirmation.emailEnabled`.
- **Data-subject paths.** `erasureService` step 15b deletes RSVP rows matched on normalised
  email / phone digits (covered by the erasure integration matrix, `report.rsvpResponses`);
  `POST /api/rsvp/:id/purge` (reason required, refused while published, audited with actor +
  row count); `retentionUntil` on PATCH; a 6-hourly sweep purges closed/draft events past it
  (published ones wait to be closed); inert while `RSVP_ENABLED` is off.
- Docs: `docs/reference/brand-and-hosting.md` (rsvp section + service table),
  `CLAUDE.md` where-things-live row, `env.example` (`RSVP_PUBLIC_ORIGIN`).

### Go-live checklist

Done from this session (code): everything above. **Render / Cloudflare steps:**

1. ✅ Render static site `rsvp-frontend` created via MCP 2026-09-03 08:11 UTC —
   `srv-dacinhrm8hqs73b377mg`, origin `https://rsvp-frontend-9d5j.onrender.com`, build
   `npm ci && npm run build`, publish `dist`, env `VITE_BRAND=redeem`, `VITE_SURFACE=rsvp`,
   `VITE_RSVP_API_BASE=https://api.mktr.sg/api`, `VITE_API_URL=https://api.mktr.sg/api`, no
   env group. First deploy live; origin serves `<title>RSVP</title>`, the rsvp canonical,
   blanket-disallow robots, and the "not live" screen at `/`.
2. ⬜ Render dashboard (MCP cannot): Redirects/Rewrites → `/*` → `/index.html` (Rewrite);
   Custom Domains → `rsvp.redeem.sg`. Until the rewrite exists, deep paths 404 at the CDN.
3. ⬜ Cloudflare (redeem.sg zone): `CNAME rsvp → rsvp-frontend-9d5j.onrender.com` (exact
   target — Render suffixed the slug).
4. ✅ Flags flipped 2026-09-03 08:11 UTC: backend `RSVP_ENABLED=true` (deploy
   `dep-dacini8jo6nc738c7m20` live — `/api/rsvp-public/*` answers, strict host allowlist and
   CORS preflight verified from the rsvp origin), `VITE_RSVP_ENABLED=true` on `mktr-platform`
   (deploy `dep-daciniifngtc73dl4mv0` live — `/admin/rsvp` routes + nav entry in the bundle).
5. ✅ Self-test done 2026-09-03 ~09:00 UTC through the admin session (API-driven, curl for
   the public side, the page itself waits for the domain): create → publish → public GET
   (era v2 wording + hash, no internal keys) → wrong-hash submit refused `409
   consent_changed` → RSVP `201` → resubmit `200 updated` → missing consent `400` →
   honeypot `200 ok` (nothing stored) → Responses page + CSV (`'+65…` guard, `consent_copy`)
   → **confirmation email delivered in <1 s** (`noreply@redeem.sg` → the Redeem Ops
   mailbox) → close → purge (`responseCount: 3`) → admin and public `404`. Also verified
   live: strict host allowlist, CORS preflight, `/api/rsvp` blocked from redeem.sg, admin
   routes `401` unauthenticated, undo/redo and the consent-line editor in the deployed bundle.
   Note: an event published under era v1 keeps v1 wording until re-published (Close →
   Reopen) or given a custom line; new publishes stamp v2.
