# Redeem Ops — Cadence link engagement (tracked links as the "open rate" proxy)

**Status:** SPEC ONLY — KIV, not scheduled. No code exists. Written 2026-07-14 after the
"can we see IG DM open rates?" question. **Depends on:** cadence engine P1 (live-dark,
docs/plans/redeem-ops-cadences.md).

## 1. Problem — why not real open rates

Cadence steps are human-sent (`call | whatsapp | email | instagram_dm | visit | custom`,
`OutreachCadenceStep.js:9`); the rep sends the IG DM from the business account by hand. True
open/read tracking is not available for that:

- **Manual cold DMs** land in Message Requests; Instagram shows no "Seen" until the recipient
  accepts, previews can be read without accepting, and users can disable read receipts entirely.
- **Instagram Messaging API** has a `messaging_seen` webhook, but cannot *initiate* a cold DM
  (business may only reply within 24h of an inbound message) — so it can neither send nor track
  our outreach.
- **Session-scraping automation** ("Seen" harvesters) violates IG ToS and risks the outreach
  account. Ruled out.

**Proxy instead:** a per-task tracked short link pasted into the DM. A click is a stronger
signal than an open, is channel-agnostic (works identically in WhatsApp/email/IG steps), and we
already own tracker precedent (`/t/:slug` QR flow, `trackerController.js`). This spec defines
click capture and how it feeds back into the cadence.

## 2. Goals / non-goals

**Goals:** per-materialized-task tokenized link (`{{link}}` merge token); public click endpoint
that (a) records the click, (b) marks the enrollment engaged, (c) logs a partner activity,
(d) pulls the next cadence task's `dueAt` forward (strike-while-warm); engagement surfaced on
`CadenceTaskCard`, Partner Detail cadence card, and MyQueue; per-step CTR analytics (P2).

**Non-goals:** IG/WhatsApp read receipts (impossible/ToS, above); email open pixel (belongs to
cadence P3 auto-email, where we control the send); auto-send of any kind; conditional cadence
*branching* on click (only a due-date nudge — the engine's advance is synchronous-on-disposition
and stays that way); consumer-funnel attribution (no `sid`/`atk` cookies — this is B2B outreach
measurement, not lead capture).

## 3. Link anatomy & routing

- **URL:** `https://redeem.sg/o/{token}` — customer-brand host, short. **`/r/:token` is TAKEN**
  by voucher `RewardClaim` (`src/pages/index.jsx:210`); `/o/` ("outreach") is free and is not in
  redeem-frontend's 16 admin edge-redirect rules, so the SPA fallback serves it. mktr.sg serving
  the same route is harmless.
- **Token:** random base62, ≥64 bits (11 chars), minted per materialized task. Unguessable, no
  PII, encodes nothing. Destination is stored server-side and NEVER taken from query params.
- **SPA interstitial (`OutreachLinkRedirect.jsx`):** blank/instant page; on mount
  `POST /api/o/{token}/click` → `{ destinationUrl }` → `window.location.replace(dest)`; on
  fetch failure render a plain fallback anchor. Requiring JS execution is the bot filter:
  IG/WhatsApp/Telegram/facebookexternalhit preview crawlers fetch HTML but don't run JS, so
  link-preview prefetches (the classic false-positive "open") never count. Server-side UA
  denylist on the beacon as defense in depth.

## 4. Data model (next free migration — 066 at time of writing; per-column guards, `IF NOT EXISTS` indexes)

### 4.1 `outreach_link_tokens`
```
id UUID PK; token STRING(16) NOT NULL UNIQUE;
cadenceEnrollmentId UUID NOT NULL FK RESTRICT; cadenceStepId UUID NOT NULL FK RESTRICT;
taskId UUID NULL FK outreach_tasks RESTRICT;      -- survives task cancellation
partnerOrganisationId UUID NOT NULL FK CASCADE;   -- hard-delete of partner purges tokens
destinationUrl TEXT NOT NULL;                      -- copied from step at mint time (frozen)
clickCount INTEGER NOT NULL default 0;
firstClickedAt DATE NULL; lastClickedAt DATE NULL;
firstClickUserAgent STRING(255) NULL;              -- UA only; no IP retention
timestamps. INDEX (partnerOrganisationId); INDEX (cadenceEnrollmentId)
```
No expiry — merchants click days later; clicks after enrollment end still log (see §6.4).

### 4.2 `outreach_cadence_steps` addition
```
linkUrl TEXT NULL   -- https only, validated at definition time; used by the {{link}} merge token
```
Definitions are immutable versions — adding `linkUrl` to a live cadence = new version, per the
existing versioning rule. `validateBuilderDefinition` gains: `{{link}}` in `scriptTemplate` ⇔
`linkUrl` present (reject one without the other); `cadenceAiService` draft prompt must be taught
the `{{link}}` token + `linkUrl` field so AI drafts can emit it.

### 4.3 `outreach_cadence_enrollments` addition
```
engagedAt DATE NULL; engagedStepId UUID NULL FK steps RESTRICT   -- first qualifying click
```

### 4.4 Constants
`ACTIVITY_TYPES += 'link_click'` but **NOT** `MEANINGFUL_ACTIVITY_TYPES` (`constants.js:65-87`).
Deliberate, load-bearing: `onInboundActivity` fires on direction=inbound **+ meaningful**
(`cadenceHooks.js:18`), so a non-meaningful `link_click` (i) does not exit(replied) the
enrollment — a click is interest, not a reply — and (ii) does not bump `lastActivityAt`/clear
stale flags, which track *rep* effort and *real* replies.

## 5. Mint at materialization

Inside `tryMaterializeTx` (`cadenceService.js:353-395`), when `step.linkUrl` is set:
generate token string → add `link: 'https://redeem.sg/o/{token}'` to the `renderTemplate` ctx
(`cadenceService.js:364-369`; allowlisted merge stays intact — a `{{link}}` on a step without
`linkUrl` renders unresolved ⇒ step blocks, consistent with existing semantics) → after
`createTaskTx` + provenance update, INSERT the token row with `taskId` in the same transaction.
Rendered description (frozen snapshot, house rule) then contains the final URL the rep pastes.
Copy-to-clipboard on the task card already ships the description — no card change needed to send.

## 6. Click endpoint & side effects

`POST /api/o/:token/click` — public, no auth, rate-limited (existing public limiter),
`Cache-Control: no-store`, `X-Robots-Tag: noindex`. Mounted with the redeem-ops master flag
(NOT the cadences flag — tokens already in the wild must keep resolving if cadences are toggled
off; side effects below are what the cadence flag gates).

1. Lookup token; unknown → 404 (interstitial shows fallback). Always increment `clickCount`,
   set `lastClickedAt` (bot-UA hits: respond with destination but skip counting + side effects).
2. **First qualifying click** decided atomically:
   `UPDATE outreach_link_tokens SET "firstClickedAt"=now(), "firstClickUserAgent"=:ua
    WHERE token=:t AND "firstClickedAt" IS NULL RETURNING id` — 0 rows ⇒ repeat click, respond
   with destination, done. This is the concurrency guard; double-tap fires side effects once.
3. Side effects, one transaction, **house lock order partner → enrollment → task**:
   - `logActivityTx(partner, { type:'link_click', direction:'inbound', summary:'Opened outreach
     link (step N — IG DM)' }, systemActor, t, { suppressCadenceHooks:true })` — suppression is
     belt-and-braces on top of §4.4's non-meaningful classification.
   - If enrollment live and `engagedAt` null: set `engagedAt`/`engagedStepId`; audit
     `cadence.engaged`.
   - **Due-date nudge:** if enrollment `active` with an open cadence task whose `dueAt` is later
     than `sgtWindowClamp(now, 0, step.timeWindow)`: pull `dueAt` to that clamp. Only forward,
     never later, never in the past (clamp already rolls to next allowed day), only on this
     first-click path. Audit `cadence.task_pulled_forward` (before/after), then
     `recomputeNextTaskAtTx(partnerId, t)`. Interaction check: pulled `dueAt` ≥ SGT day start, so
     the queue's `noScheduledCadenceTouch` exclusion (`queueService.js:38-46`) still holds — no
     double-count regression.
4. Respond `{ destinationUrl }`.
5. Click after enrollment ended: activity + counters only — no engagement mark, no nudge.

## 7. Surfacing (Fresha idiom)

- **`CadenceTaskCard`:** engagement chip — `Link opened · 2h ago` (green dot) from the
  enrollment's `engagedAt` joined via the queue's existing `cadenceStep` include; reps treat it
  as "call this one first".
- **Partner Detail cadence card:** per-step ✓ clicked marker + timestamp in the step list.
- **MyQueue:** the `recentReplies` bucket query already selects ALL inbound activities
  (`queueService.js:77-89`), so `link_click` rows surface with zero query change — rename the
  section copy to **"Replies & engagement"** and give `link_click` its own icon so it isn't
  mistaken for a reply.
- **P2 analytics:** per-step CTR = tokens clicked / tokens minted, grouped by
  `(cadence key+version, stepOrder, channel)`; read-only in Settings → Cadences next to the
  version list. This is the honest "open rate" replacement the original question asked for.

## 8. Destination pages

`linkUrl` is free-form https. Practical defaults: the redeem.sg partners pitch page (doesn't
exist yet — smallest version is a static section on the live redeem.sg site), or a campaign
`/p/{slug}` preview showing the merchant what their drop would look like (already public,
zero work, arguably more persuasive). Per-partner personalized pages are out of scope.

## 9. Flags, permissions, security

- `REDEEM_OPS_LINK_TRACKING_ENABLED` (backend): gates minting + §6.3 side effects. Resolution
  (§6.1/6.4) rides the redeem-ops master flag. No new frontend flag — the interstitial is inert
  without minted links; card chips render only when data exists.
- No new permissions: tokens are minted by the engine; analytics reads ride existing redeem-ops
  route auth.
- Security/PDPA: token unguessable; destination server-side only (no open-redirect surface); no
  cookies set; UA stored, IP not retained; B2B measurement of a link we sent, logged on the
  partner timeline like any other outreach activity.

## 10. Risks & honest limits

- **Click ⇠ open undercount:** an opened-but-not-clicked DM is invisible. CTR is a lower bound
  on opens; per-step *relative* comparison (message A vs B) is still valid.
- **IG message-request friction:** IG suppresses link previews in requests and spam-filters
  link-bearing first DMs from unknown accounts. Mitigations: keep the first IG touch link-free
  (rapport first), put the link in follow-up touches / WhatsApp / email steps — a cadence-design
  convention, not code.
- **Unique-per-recipient URLs look spammy at volume** to platform filters; volume is
  rep-throttled (manual sends + enrollment cap 60/owner), so low risk now.
- **JS-executing crawlers** (rare; some corporate email scanners) can false-positive — UA
  denylist catches the known ones; accept the tail.
- **Forwarding:** clicks aren't identity-verified; anyone with the URL counts. Fine for an
  engagement proxy; never treat as consent or auth.

## 11. Phasing & testing

- **P1:** migration 066 + models/constants; mint in `tryMaterializeTx`; click endpoint +
  interstitial route (both brands); activity + `engagedAt` + due-date nudge; card chip + queue
  copy rename. ~1 PR-sized.
- **P2:** per-step CTR endpoint + Settings view; AI-draft prompt teaches `{{link}}`; partners
  pitch page decision (§8).
- **Explicitly parked:** WhatsApp Business API read receipts (real read tracking if outreach
  ever moves to API sends); email open pixel (with cadence P3 auto-email outbox).
- **Tests (house pattern — jest from `backend/`, throwaway pg on 5433):** mint renders + rows in
  one tx; `{{link}}` without `linkUrl` blocks; concurrent first-click → exactly one side-effect
  pass (two-tx race); click does NOT exit enrollment (hook not tripped — regression-guard the
  §4.4 invariant); nudge clamps forward-only and skips paused/ended; click after exit logs
  activity only; bot-UA beacon skips counting; migration guarded re-run.

## 12. Open questions (for when this is picked up)

1. Nudge policy: always-on (spec'd) vs per-cadence opt-out edge attribute?
2. Should a click on a *break-up step's* link re-open anything? (Spec: no — enrollment already
   completed; activity row is the only trace. Rep sees it in Replies & engagement and acts
   manually.)
3. Do we want `link_click` to clear `staleFlag`? (Spec: no — stale tracks rep neglect, but a
   hot click on a stale partner is exactly what the flag should surface. Revisit with real data.)
