# Admin Lead Profile page — person-first lead detail at `/admin/leads/:prospectId`

**Status:** LIVE 2026-07-25 — #269 (backend) + #271 (page; supersedes #270, which GitHub
closed when the stacked base branch was deleted). Deploy-verified: migration-089 indexes
present in prod, `AdminV2LeadProfile` chunk serving from origin + mktr.sg. Codex-reviewed
v2 underneath (gpt-5.6-sol xhigh: 22 findings, dispositions in §8).
**Date:** 2026-07-25
**Replaces:** the `LeadDrawer` slide-out sheet in `src/pages/adminv2/AdminV2Prospects.jsx:85-430`
**Direct ancestor:** data-powerhouse audit P1 #6 — "promote the journey to a first-class admin page"
(`docs/reference/data-powerhouse-readiness-audit-2026-07-20.md`)

---

## 1. Why

The operator question this page answers: **"Who is this person, which campaigns did they
sign up for (under which name), what did each campaign give them — draw chances or a
reward — and what has happened since?"**

Today that story is squeezed into a 432px right-hand sheet. The drawer's "Person" card
(`AdminV2Prospects.jsx:178-220`) is genuine cross-campaign visibility, but it is
lossy in exactly the places that matter:

| What the operator needs | What the drawer shows today | The truth in the system |
|---|---|---|
| Name used per campaign ("Shawn Lee" on A, "Shawn Tan" on B) | Nothing — "Also in" shows campaign + date only | **Already in the payload**: `consumer.signups[].firstName/lastName` (`backend/src/services/consumerService.js:446-447`) — fetched, never rendered |
| Lucky-draw chances | `draw entries · N` — a **count of draws entered**, not chances. A single-draw entrant always reads `1` whether they hold 1 chance or 10 | `DrawEntry.chances` post-seal; **derivable** pre-seal (§4) |
| Reward status per campaign | `rewards · N · M redeemed` — bare counts | `entitlements[]` with status/title/campaign/expiry/redeemedAt — fetched, collapsed to two numbers |
| History | 3 scalars (created / last contact / converted) | A merged `timeline` (ProspectActivity + Supabase lead_activities) is **already returned** by the endpoint (`prospectService.js:1441-1446`) and never rendered |
| Consent | Legacy `sourceMetadata.consent_*` booleans (`AdminV2Prospects.jsx:373-378`) | The `consent_events` ledger + `consumer_suppressions` — flagged by the audit, still unwired |

A drawer can't hold this much story. A page can.

---

## 2. Current-state findings (investigation, 2026-07-25)

### Surfaces
- **Admin v2 drawer** — `src/pages/adminv2/AdminV2Prospects.jsx:85-430`. Sections: header
  chips, Contact, Attribution, Person (signup count, first seen, reward counts, draw-entry
  count, "Also in" drawer-hopping buttons), Routing, AI Screening (rich: transcript,
  recordings, costs), Consent (legacy booleans), Timeline (3 scalars), action footer
  (Assign / Return to held / Delete). Deep link: `?lead=<id>` (`:511-520`).
- **Legacy v1** — `src/components/prospects/ProspectDetails.jsx` (modal/inline, has its own
  repeat-signup card; zero consumer-spine awareness). `src/pages/ProspectDetailPage.jsx` is
  the **agent-facing** `/prospect/:id` page — unrelated, leave untouched.
- **No admin page route exists**: no `/admin/leads/:id`, no `/admin/consumers/:id`. Admin v2
  detail-page precedent: `/admin/campaigns/:id`, `/admin/cohorts/:id`, `/admin/broadcasts/:id`
  (`src/pages/index.jsx:347-401`).
- **Cohort members are not clickable** into a person (`AdminV2CohortDetail.jsx:182`).

### Data
- **Identity spine**: `consumers` table, keyed by E.164 phone (`backend/src/models/Consumer.js`),
  `prospects.consumerId` FK. `getConsumerJourney(consumerId)`
  (`backend/src/services/consumerService.js:401-470`) returns
  `{ consumer, signups[], entitlements[], drawEntries }` — per-signup names, campaign,
  status, held, verified. **`GET /api/consumers/:id` exists (admin) but has zero frontend callers.**
- **Prospect detail** `GET /api/prospects/:id` (`prospectService.js:1369-1450`) attaches, for
  admins, in parallel: `repeatSignup` (phone/email-matched campaign list,
  `repeatSignup.js:33-49`), merged `timeline`, and `consumer` (the journey). **The page can
  ship on this one endpoint.**
- **Rewards**: `reward_entitlements.status ∈ eligible | issued | redeemed | expired |
  cancelled | blocked` (`models/RewardEntitlement.js:32-37`); real `redeemedAt` on the
  `Redemption` row. Canonical UI-state mapper `presentState()`
  (`routes/externalEntitlements.js:87-92`): `eligible→reserved`, `issued→unlocked`, expiry
  overrides. "Why no reward" ledger: `ActivationIssuanceSkip` (reasons at
  `models/ActivationIssuanceSkip.js:19`). Draw-rail entitlements are the **same table with a
  different voice** — `issued` on a draw rail means "×N confirmed", no voucher exists
  (`entitlementService.js:485-573`).
- **Draw chances — the one genuinely missing piece.** Chances are **snapshot-then-seal**
  (`luckyDrawService.js`): `DrawEntry.chances` is written only at seal (`:501-510`, boost is a
  *replacement* — `chances = multiplier`, never `+=`). Pre-seal, "chances right now" does not
  exist in the DB and must be derived (§4). **No draw HTTP endpoints exist at all** — the whole
  lifecycle is CLI-only (`backend/scripts/run-lucky-draw.js`); `getDrawState` is explicitly
  labelled "for the CLI / future admin panel" (`luckyDrawService.js:758`).
- **Draw identification**: `campaign.design_config.luckyDraw.enabled` (normalizer
  `utils/luckyDraw.js:97-151`); engine truth is the `draws` row (one live per campaign,
  `models/Draw.js:60-65`); drift between the two is linted by `utils/drawConsistency.js`.
- **Consent**: `consent_events` ledger (`models/ConsentEvent.js`) + `consumer_suppressions`;
  the drawer still reads legacy booleans (audit gap).
- **Known nulls**: `call_bot` (Retell) prospects never link to a consumer (the phone is our
  own DDI — `consumerService.js:19-21`); pre-spine rows may have `consumerId = null`.
  `DrawEntry` has no `consumerId` (audit P0 #4) — per-signup queries by `prospectId` are
  correct here and dodge that gap.

---

## 3. Design

### 3.1 Route & anchor

**`/admin/leads/:prospectId`** — ADMIN_V2-gated, inside `AdminV2Shell`, following the
existing `/admin/<thing>/:id` convention.

Anchored on the **prospect** (a signup), rendered **person-first**. Why not
`/admin/people/:consumerId`: table rows are prospects (no resolution hop), the existing
detail endpoint takes a prospect id and already returns everything, and consumer-less leads
(Retell, pre-spine, unverified) still get a page that degrades gracefully. Clicking another
signup in the journey rail **re-anchors** — navigates to that prospect's URL. Back/forward
and shareable URLs come free; both URLs render the same person rail, so context visibly
persists.

### 3.2 Layout (admin-v2 idiom: `PageHeader` + 12-col Card grid)

```
← Prospects
┌────────────────────────────────────────────────────────────────────────────┐
│ Shawn Lee                                  [Assign ▾] [Return to held] [Delete] │
│ +65 9123 4567 · 3 SIGNUPS (2 VERIFIED) · FIRST SEEN 12 MAY 2026            │
│ [new] [◆ held · dnc] [✓ AI qualified] [erased?]                            │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Campaigns (7) ──────────────────────────┐ ┌─ This signup (5) ─────────────┐
│ ▌Tokyo Lucky Draw          2d ago        │ │ phone / email as entered       │
│ ▌as Shawn Lee · QR · ✓ verified  ◀ viewing│ │ source · UTM chips · QR tag    │
│ ▌🎟 ×10 chances — boosted (consultant     │ │ agent · held since / reason    │
│ ▌scan) · draw closes 30 Oct              │ │ ↗ open campaign                │
│ ──────────────────────────────────────── │ ├─ Consent & reachability ──────┤
│  NTUC Trial Reward         3w ago        │ │ marketing ✓ (v2026-07-21)      │
│  as Shawn Tan ⚠ name variant · web       │ │ terms ✓ · third-party —        │
│  🎁 Redeemed ✓ 2 Aug — 1-for-1 latte     │ │ suppressions: none             │
│ ──────────────────────────────────────── │ ├─ AI screening (conditional) ──┤
│  Prenatal Care             2mo ago       │ │ verdict · attempts · callback  │
│  as Shawn Lee · web · unverified         │ │ transcript ▸ · recordings ▸    │
│  🎁 Expired — reservation lapsed         │ └───────────────────────────────┘
└──────────────────────────────────────────┘
┌─ History (12) ─────────────────────────────────────────────────────────────┐
│ [All | This signup | Person]                                               │
│ 24 Jul  🎟 Boost recorded — consultant scan          Tokyo Lucky Draw      │
│ 22 Jul  ☎ AI screening — qualified                   Tokyo Lucky Draw      │
│ 22 Jul  ＋ Signed up as Shawn Lee                     Tokyo Lucky Draw      │
│ 02 Aug… 🎁 Voucher redeemed                          NTUC Trial Reward     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Header (identity strip)

- **H1**: the person's canonical name — exact payload path
  `prospect.consumer.consumer.firstName/lastName` (the journey nests the identity row;
  the drawer already dereferences this shape at `AdminV2Prospects.jsx:137`); fallback to
  the prospect's own name when no consumer.
- Meta line (mono): phone · `N SIGNUPS (M VERIFIED)` · `FIRST SEEN <date>`.
- Chips: lead status, held (with reason), screening verdict, `erased` when
  `consumer.erasedAt` — never color-alone (house rule).
- Actions right: **Assign to agent ▾ / Return to held / Delete** — a straight port of the
  drawer footer mutations (`bulkAssign/bulkReturnToHeld/bulkDelete` on `[id]`), same
  server-count-driven toasts. Delete navigates back to the list on success.
- Back link returns to `/AdminProspects` **preserving the list's filter querystring**
  via the `state.from` contract (§3.8) — falling back to bare `/AdminProspects` on
  direct links/reloads, where router state doesn't exist.

### 3.4 Campaigns rail (span 7) — the centerpiece

One card per `consumer.signups[]` entry (newest first), the URL's signup highlighted
(accent left border + "viewing" marker). No consumer → a single card built from the
prospect itself. Each card, three lines:

1. **Campaign name** (links nowhere itself — the card is the link) + campaign-status chip
   when not active + signup date (relative, absolute on hover).
2. **`as <First Last>`** — the name used on THIS signup. When it differs from the header's
   canonical name: `⚠ name variant` chip. This is the Shawn Lee / Shawn Tan requirement,
   and the data is already in the payload. Plus: source chip, `✓ verified` / `unverified`,
   `◆ held` when quarantined.
3. **The outcome slot** — exactly one of:
   - **Draw campaign** (`🎟`): from the new per-signup draw block (§4). The copy always
     matches the draw lifecycle — provisional voice before seal, asserted voice after:
     - open: `On track for ×10 — consultant scan recorded · closes 30 Oct` /
       `1 chance so far · boost window open until 15 Oct` /
       `Boost pending ops review` (an `agent_button` unlock whose `DrawBoostReview`
       hasn't been approved — counts only if approved)
     - open, not eligible: `Not counted yet — phone unverified` / `— draw terms not
       accepted` (states the fix, not just the fact)
     - frozen: `In the pool — 1 chance · ×10 boost applies at seal` /
       `Excluded at freeze` (frozen membership is the entry snapshot, never re-derived)
     - sealed: `10 chances · sealed — draw on 1 Nov`
     - drawn+: `Selected — claim by 5 Nov` (pending) / `🏆 Winner — claimed 2 Nov` /
       `Selected — declined, redrawn` / `Not selected (10 chances)` only once the draw
       is decided; `Draw void` when voided; `Draw record unavailable (erased)` for
       erased people
   - **Reward campaign** (`🎁`): entitlement via `presentState()` voice:
     `Reserved · expires in 2d` / `Unlocked · voucher live until 12 Aug` /
     `Redeemed ✓ 2 Aug` / `Expired` / `Cancelled` / `Blocked`, plus reward title.
     No entitlement → latest issuance-skip reason when one exists
     (`No reward — quota full`), else quiet `No reward attached`.
   - **Delivery receipts microline** (both voices): the latest `notified` /
     `notify_failed` `RedemptionEvent` per channel — `pass emailed ✓ 21 Jul · WhatsApp ✓`
     or `email send failed ✗` (`metadata.channel` + `metadata.kind`, fetched via the
     bounded `DISTINCT ON` query of B5). Answers "did the customer actually receive
     their pass/voucher?" in place.
   - Draw-rail entitlements (`drawLinked: true`) render **inside the draw slot** as the
     boost evidence ("boost confirmed ×10"), never as a voucher — same table, different
     voice, per `entitlementService.js:485-573`.

Card click → `navigate('/admin/leads/<thatProspectId>')`. Keyboard: cards are buttons,
Enter/Space navigate.

### 3.5 Right column (span 5)

1. **This signup** — contact as entered on THIS signup (phone/email, `verified ✓ <date>`
   from `sourceMetadata.phoneVerifiedAt`), attribution (source,
   `utm_source/medium/campaign/term/content` chips, QR tag, **landing page + arrival
   funnel** from the `SessionVisit` rows matched by `prospect.sessionId` —
   `landingPath` + allowlisted steps; B6), routing (agent — or the **named** external
   buyer: the `ExternalAgent` association exists but is NOT in the `getProspect`
   includes today (`prospectService.js:1373-1391`), so PR 1 adds it admin-side with
   `id`/`fullName`/`agency` only, never phone/email/balance / held since + reason,
   **Lyfe delivery** row (B7): `✓ delivered` / `✗ failed ×3 — HTTP 422 (agent not
   found)` / `… pending` / `not sent — no app destination (System Agent)` — makes the
   System-Agent delivery gap and EF rejections visible per lead), priority + score +
   next follow-up when set, `↗ open campaign` → `/admin/campaigns/:id`.
2. **Quiz** (conditional — `sourceMetadata.quiz` present): campaign-quiz score /
   readiness / profile answers. Port of the legacy `QuizResultCard`
   (`src/components/prospects/details/QuizResultCard.jsx`) — the v1 admin had this;
   the v2 drawer lost it.
3. **Profile** (conditional, sparse-rendered — only non-empty keys): DOB/age (the draw
   age-gate answer), postal/location, demographics, interests, budget, preferences,
   tags, notes. Mostly thin today (audit: profile capture 4/10) — the card renders
   nothing when empty rather than a wall of `—`.
4. **Consent & reachability** — target state: last `consent_events` row per kind
   (granted/withdrawn + version + when + source) and any `consumer_suppressions`
   (suppressed = red chip with reason). Plus, regardless of B3:
   - **DNC**: `dncStatus` + per-channel flags (`no voice / no SMS`) + checked/valid-until
     (`Prospect.dncStatus/dncNoVoiceCall/dncNoTextMessage/dncCheckedAt/dncValidUntil`) —
     the "can we even call this person" answer, absent from the drawer today;
   - **pinned versions**: draw terms accepted (`consentMetadata.drawTerms.termsVersionId`
     → version number), third-party disclosure evidence (`consentMetadata.external`),
     DNC-override consent (`consentMetadata.dnc`);
   - **marketing touches** summary line: `2 broadcasts — 1 sent, 1 skipped (suppressed)`
     from `email_broadcast_recipients` by `consumerId` (B5), so "have we already
     emailed this person?" is answered before the next cohort push.
   Ships legacy-boolean fallback with a `legacy` tag if B3 slips. Closes the audit's
   "Person card renders legacy booleans" flag.
5. **AI screening** (conditional, port of drawer `:227-372` intact): verdict, reason,
   sentiment, attempts, promised callback, WA invite, cost + duration, script version,
   summary, collapsible transcript, per-attempt audio + download. This section is the
   drawer's best asset — do not regress it.
6. **Voice call** (conditional — `leadSource === 'call_bot'`): the Retell capture call:
   sentiment, duration, from-number (`sourceMetadata.sentiment/durationMs/fromNumber`),
   call summary (in `notes`), recording via the existing
   `GET /api/retell/recording/:prospectId`. Retell leads are consumer-less, so without
   this their page is nearly empty — this card is their story.

### 3.6 History (span 12)

Merged, day-grouped, icon-led timeline. Segment filter: `All | This signup | Person`.

Compose client-side from data the endpoint already returns — no new ledger needed:
- the merged `timeline` (ProspectActivity + Supabase lead activities) — **currently
  fetched and thrown away**. Caveat: it exists only when
  `SUPABASE_LEAD_ACTIVITIES_URL` is configured (`prospectService.js:1426`); the page
  must fall back to `activities[]` alone, and both environment states get tests;
- person events synthesized from the journey: each signup's `createdAt`
  ("Signed up as Shawn Tan — NTUC"), entitlement `createdAt/unlockedAt/redeemedAt`
  transitions, screening attempts (`screeningMetadata.attempts`), draw boost
  (`boostedAt` from §4 when present). `expiresAt` is a DEADLINE that gets re-stamped at
  unlock (`entitlementService.js:519`), not a transition timestamp — render it as
  "expires <date>" on the card, and add an expiry History row only from an actual
  `expired` ledger event;
- with B5–B7: pass/voucher delivery receipts ("Voucher WhatsApp sent ✓"), broadcast
  sends/skips ("Marketing email — skipped: suppressed"), commission events on won
  leads (`commissions` association — already included by `getProspect`), Lyfe webhook
  delivery outcomes, and pre-signup funnel steps from the session (allowlisted).

Each row: icon + plain-language label + campaign tag + time. Empty state: "Nothing yet —
this lead was just captured."

### 3.7 States

- **Loading**: header + 3 card skeletons (house `Skeleton`).
- **Error / deleted**: full-width `ErrorState` with retry + "may have been deleted" copy
  and a back link.
- **No consumer**: person-level widgets collapse; quiet note in the rail —
  `call_bot` → "Retell voice lead — no caller phone, so no cross-campaign identity";
  otherwise "No linked person yet (phone unverified)".
- **Erased person**: banner strip (`erasedAt`), journey renders what the allowlist rebuild
  kept.
- Responsive: grid collapses to a single column under ~900px (rail first).

### 3.8 Navigation changes

- Prospects **row click → navigate to the page**, EXCEPT in selection mode: selection is
  local component state (`AdminV2Prospects.jsx:436`) and navigation unmounts it, so when
  ≥1 row is selected a row click **toggles selection** instead of navigating
  (Gmail-style); the checkbox always toggles (`stopPropagation` stays). The `LeadDrawer`
  is deleted; its Person-card "Also in" hops were local `onOpenLead` callbacks
  (`AdminV2Prospects.jsx:203`), replaced by real links in the journey rail.
- **`state.from` contract**: list rows navigate with
  `state: { from: pathname + search }`; the `?lead=` redirect stores the cleaned list
  URL as `from`; every re-anchor navigation forwards the same `state.from`; the back
  link and post-delete redirect use it (validated same-origin path, fallback
  `/AdminProspects`). Tests: reload, direct link, `?lead=` redirect, multi-re-anchor
  then back.
- `?lead=<id>` (palette deep-link param) → consume and `navigate` to `/admin/leads/<id>`
  (replace) so existing links keep working.
- `GlobalSearch` palette lead results → link straight to the page, and **update the
  existing test asserting the old `?lead=` URL** (`GlobalSearch.test.jsx:71`).
- **Adopt the page everywhere a lead renders**: dashboard "recent leads" rows currently
  link to a filtered list (`AdminV2Dashboard.jsx:238`) — point them at
  `/admin/leads/:id`; campaign-detail "latest leads" rows are non-interactive
  (`AdminV2CampaignDetail.jsx:124`) — make them links too. Both are PR 2 scope.
- Fast-follow (not v1): make cohort member rows clickable (member payload lacks a
  prospect id today — needs a `latestProspectId` in `listCohortMembers`).

---

## 4. Backend: the per-signup draw block (the only new data)

Extend the journey (`getConsumerJourney`) — and the no-consumer fallback path in prospect
detail — with `signups[].draw`:

```jsonc
"draw": {
  "drawId": "…",
  "drawStatus": "open|frozen|sealed|drawn|published|claimed|void",
  "state": "provisional_in|provisional_out|frozen_in|excluded_at_freeze|sealed|no_draw_record|erased_draw_unavailable|void",
  "provisional": true,         // true until sealed — UI says "on track for ×10", never asserts
  "chances": 10,               // open: derived preview · frozen: 1 (entry row) · sealed+: DrawEntry.chances
  "multiplier": 10,
  "boosted": true, "boostVia": "agent_scan|agent_button|null", "boostedAt": "…",
  "boostReviewPending": false, // agent_button/manual unlock with no approved DrawBoostReview yet
  "notEligibleReason": "no_phone|phone_unverified|terms_not_pinned|signed_up_after_close|null",
  "closesAt": "…", "boostClosesAt": "…",
  "outcome": {                 // present when any DrawAttempt exists
    "status": "selected_pending|selected_claimed|selected_unclaimed|selected_unreachable|selected_ineligible|selected_declined|not_selected_yet|not_selected_final",
    "attemptNo": 2, "claimDeadline": "…", "claimedAt": "…"
  },
  "drawHistory": []            // older terminal draws for this campaign, summarized (usually empty)
}
```

Derivation rules (new `luckyDrawService.getProspectDrawStatus(prospects[])`, batch) —
**three lifecycle branches, because freeze WRITES the pool** (`DrawEntry` rows with
`chances: 1` are persisted inside the freeze transaction, `luckyDrawService.js:311-320`):

- **Draw selection first.** A campaign holds at most ONE live draw (partial unique over
  `open|frozen|sealed|drawn`, `Draw.js:60-65`) plus **unlimited terminal history**
  (`published|claimed|void`). Pick deterministically: the live draw if one exists, else
  the latest terminal by `(createdAt, id)` DESC; older terminal draws return as
  `drawHistory[]` summaries. Test "prior claimed + new open draw".
- **`open`** — no entry rows exist; everything is a PREVIEW from live data: the freeze
  predicate (`luckyDrawService.js:280-290` — phone present, OTP stamp bound via
  `phoneVerifiedFor === sha256(phone)`, pinned `consentMetadata.drawTerms.termsVersionId`
  among the campaign's `DrawTermsVersion` rows, `createdAt < closesAt`) → provisional
  1 chance; boost evidence (below) → provisional ×multiplier. `provisional: true`.
- **`frozen`** — membership comes ONLY from the persisted entry: row exists → `frozen_in`
  (1 chance; boost weighting still provisional until seal applies `chances = multiplier`,
  `:501-510` — a replacement, never additive); no row → `excluded_at_freeze`. Do NOT
  re-derive from today's prospect state — a phone/consent edit after freeze must not
  make the page disagree with the actual pool.
- **`sealed|drawn|published|claimed`** — read stored truth: `DrawEntry.chances` +
  `boostVia`; attempts from `DrawAttempt` ordered by `attemptNo`. The outcome mapping
  must respect the **redraw ledger** (`luckyDrawService.js:546-577`): a picked attempt
  can end `unclaimed|unreachable|ineligible|declined` and a later attempt picks someone
  else. So: picked → `selected_<outcome>` (`selected_pending` while the claim window is
  open); unpicked → `not_selected_yet` until some attempt is `claimed` (or the draw
  voids), only then `not_selected_final`. "Winner" is ONLY the claimed attempt.
- **`void`** — state `void`, said plainly; never rendered as not-selected.
- **Boost evidence predicate** — extract and REUSE `collectBoostEvidence`
  (`luckyDrawService.js:362-433`), never re-implement. The full predicate: entitlements
  on `draw.activationId` with **`issuedVia != 'manual'`** (`:371` — a manually-ISSUED
  entitlement never boosts even with an approved review; distinct from a manual UNLOCK
  of a normally-issued one, `:421`); events `unlocked` minus `unlock_reversed`-superseded
  (causal `supersedesEventId`, `:398-403`); `createdAt < (boostClosesAt || closesAt)`
  (`:383`); `agent_scan` always wins; `agent_button|manual` need an approved
  `DrawBoostReview` (undecided → `boostReviewPending: true`; rejected → no boost).
- **Erasure** — erased people have `DrawEntry.prospectId` nulled and `phoneHash`
  sentineled (`erasureService.js:510-528`); the entry is unjoinable BY DESIGN (no
  `consumerId` on `draw_entries` until tracker "drawlink"). Return
  `erased_draw_unavailable` — never `not_eligible`/no-entry, which would rewrite history.
- **Query discipline** — `collectBoostEvidence` is 3 queries per draw; the batch API must
  stay bounded per DISTINCT draw (not per signup), and reads must be lifecycle-consistent:
  re-read `draw.status` after collecting rows and retry once on a flip (or wrap in a
  transaction), so a freeze/seal landing mid-read can't mix provisional and frozen data.
  Add a query-count test and a transition-race test.
- Config says `luckyDraw.enabled` but no `draws` row → `no_draw_record` (surfaces the
  same drift `drawConsistency.js` lints).

**Extract, don't duplicate**: the eligibility predicate and boost-evidence collection must
be shared helpers inside `luckyDrawService` (used by both `freezeDraw`/`sealDraw` and this
read path). Two copies of the chance rules is how the UI ends up lying about the pool —
the exact failure class `drawConsistency.js` exists to catch.

Companion tweaks while in there:
- **B2**: journey `entitlements[]` gains `state` (via a shared `presentState`),
  `unlockedVia`, `tokenHint`, `drawLinked`, `delivery` (B5). **"Why no reward" must NOT
  read the `ActivationIssuanceSkip` ledger** — skip rows are deliberately unanchored (no
  `prospectId`/`consumerId`; "a skip must survive its subjects",
  `ActivationIssuanceSkip.js:10-21`) and purged after 30 days, so a campaign's latest
  skip can belong to someone else. Instead derive a read-time `rewardDiagnostic` per
  signup by re-running the same checks `issueForProspect` performs (`no_phone` /
  `phone_not_verified` / `quarantined` / `no_active_activation` /
  `allocation_exhausted` / `duplicate_phone` via `phoneKey`) — accurate about NOW, which
  is the operator's actual question. The activation-level 24h skip breakdown stays
  aggregate, on the activation page where it belongs.
- **B3** (enables the target Consent card): consent is scoped, not person-wide —
  `getConsentState(consumerId, { campaignId })` merges campaign + global events
  latest-wins (`consentService.js:367`, `:425`). The journey gains **per-signup consent
  verdicts** (batched resolution keyed by each signup's `campaignId`, exposing
  kind/granted/version/scope/source/occurredAt) plus person-level `suppressions[]`.
  Never render a single person-wide last-per-kind map on a campaign card — it can
  contradict the authoritative send gate.
- **B4**: no-consumer prospects — prospect-detail fallback runs the same draw/entitlement
  enrichment keyed by `prospectId` so Retell/unverified leads still show their own campaign
  outcome.
- **B5 — comms receipts**: per-entitlement `delivery{email,whatsapp}` via ONE
  `DISTINCT ON (entitlementId, metadata->>'channel')` query — do NOT lift the redeemOps
  reduce verbatim (`entitlementService.js:1044-1060` loads every historical receipt; it
  was written for a paginated list). Journey gains `broadcasts` = latest ~20
  `email_broadcast_recipients` rows by `consumerId` (subject, `status`, `reason`,
  `sentAt`) **plus aggregate counts** — bounded, with full history left to a later page.
  **Requires a new index `(consumerId, createdAt DESC)`** — existing indexes lead on
  `broadcastId` (`EmailBroadcastRecipient.js:41-45`) and cannot serve a person lookup.
- **B6 — session context**: aggregate over ALL `session_visits` rows matching
  `prospect.sessionId` — the index is non-unique and the write path is
  findOne-then-append (race-prone), so never `findOne`. Return `landingPath` + full UTM
  from the earliest row, and funnel steps as an **allowlisted projection** (event `type` +
  timestamp + approved keys only, capped ~50) — `eventsJson` is arbitrary public beacon
  input (`analyticsController` accepts unvalidated `type`/`meta`) and must not be
  reflected raw into the admin UI.
- **B7 — Lyfe delivery**: latest `webhook_deliveries` row per event type for this lead
  via `payload::jsonb #>> '{data,lead,externalId}'` (the path `webhookService.js:601`
  already queries) **joined to the subscriber and filtered to
  `metadata.destination = 'lyfe'`** — deliveries are per-subscriber
  (`webhookService.js:155-173`) and an MKTR-Leads row is not Lyfe delivery. A
  System-Agent lead produces NO row at all (null destination is default-denied,
  `:163-166`) → distinct state `not_queued_no_destination` ("Not sent to Lyfe — no app
  destination (System Agent)"). `errorMessage` is only `HTTP <status>`; surface
  `responseCode` plus a server-sanitized, allowlisted reason derived from `responseBody`
  (e.g. the EF's agent-not-found), never raw receiver text. **Prerequisite migration**
  (not "measure first" — the purge path deletes only FAILED rows, `webhookService.js:479`,
  so successful rows grow unbounded): partial expression index on
  `((payload::jsonb #>> '{data,lead,externalId}'), createdAt DESC)`
  `WHERE "eventType" IN ('lead.created','lead.assigned')`, validated with `EXPLAIN`.

**Endpoint boundary (explicit):** `GET /api/prospects/:id` is `authenticateToken`-only
(`routes/prospects.js:35`) and also serves agents (own-scope via `buildProspectWhere`)
and the legacy agent page/modal. Therefore every new enrichment lives strictly inside
the existing `user?.role === 'admin'` branch (`prospectService.js:1425`) **and** behind
an explicit `?include=profile` opt-in that only the new page sends — non-admins and all
existing callers get a byte-identical payload, and admin surfaces that don't need the
fan-out (list, palette) never pay it. Enrichments run in parallel (existing
`Promise.all` pattern), each resilient. If profiling shows pain, B5–B7 split behind
`?include=comms`, fetched lazily when History enters the viewport. Two migrations ride
PR 1 as prerequisites: the webhook expression index and the broadcast-recipient
`(consumerId, createdAt)` index.

No new routes otherwise. (`GET /api/consumers/:id` stays the future person-URL surface;
still zero callers after this.)

---

## 5. Implementation plan

**PR 1 — backend enrichment** (~1.5–2 days)
1. Migrations (prerequisites): webhook partial expression index (B7) +
   `email_broadcast_recipients (consumerId, createdAt DESC)` (B5).
2. `luckyDrawService`: extract the freeze-eligibility predicate and
   `collectBoostEvidence` into shared helpers; add batch `getProspectDrawStatus` with
   the three lifecycle branches + deterministic draw selection (§4). Unit tests
   (extend `backend/test/luckyDrawService.test.js`): open provisional 1 / provisional
   boost → multiplier / superseded unlock → 1 / manually-ISSUED entitlement with
   approved review stays 1× / approved-vs-pending-vs-rejected `agent_button` review /
   frozen_in vs excluded_at_freeze (incl. prospect edited AFTER freeze — page must
   match the pool) / sealed frozen chances / redraw ledger: selected_pending →
   declined → second attempt claimed (first shows selected_declined, unpicked flip
   not_selected_yet → not_selected_final) / void / `no_draw_record` /
   `erased_draw_unavailable` / prior-claimed + new-open selection / query-count bound /
   status-flip race retry.
3. `consumerService.getConsumerJourney` + `prospectService.getProspect`: `signups[].draw`
   (B1), entitlement extras + read-time `rewardDiagnostic` (B2), per-signup consent +
   suppressions (B3), B4 fallback, receipts + bounded broadcasts (B5), allowlisted
   session (B6), Lyfe delivery with destination filter (B7), `externalAgent` include
   (admin-side, `id`/`fullName`/`agency` only). All behind `?include=profile` inside the
   admin branch.
4. Contract tests on `GET /api/prospects/:id`: without `include` → byte-identical to
   today for admin AND non-admin; with `include` as non-admin → ignored; with `include`
   as admin → full profile.

**PR 2 — the page** (~1.5–2 days)
1. `src/pages/adminv2/AdminV2LeadProfile.jsx` + route `/admin/leads/:prospectId`
   (`src/pages/index.jsx`, ADMIN_V2-gated) + nav wiring.
2. Port drawer mutations + AI-screening section; port `QuizResultCard`; build rail /
   right column / history from §3 (history falls back to `activities[]` when the
   Supabase timeline is absent). New hook variant passing `?include=profile`.
3. `AdminV2Prospects.jsx`: row click navigates (selection-mode toggling per §3.8);
   delete `LeadDrawer`; `?lead=` redirects to the page with `state.from`. Update
   `GlobalSearch` links + its existing `?lead=` test; link dashboard recent-leads and
   campaign-detail latest-leads to the page.
4. RTL tests (`src/pages/adminv2/__tests__/`): draw voice per lifecycle state vs reward
   voice, name-variant chip, no-consumer fallback, `?lead=` redirect, re-anchor keeps
   `state.from`, selection-mode row click, timeline fallback (both env states).
5. Gates before merge: `cd backend && npx jest test/luckyDrawService.test.js` + the new
   suites; `npx vitest run src/pages/adminv2 src/components/adminv2`; `npm run build`;
   then the repo `verify` skill (mktr brand, admin login) for a real-browser pass.

If PR 1 balloons, B5–B7 split cleanly into a **PR 3** (each is additive and the page
renders without them) — their two index migrations stay in PR 1 regardless, so the
split is code-only. Everything in Appendix A marked "in payload today" costs zero
backend work and must not slip out of PR 2.

Rollout: no flag needed (admin-only surface, additive endpoint fields); the drawer
deletion is the only behavioural change and is the explicit point of the exercise.

---

## Appendix A — details inventory (sweep of 2026-07-25)

Everything the system knows about a lead, with where it should appear and what it costs.
"In payload today" = already returned by `GET /api/prospects/:id` for admins — render-only.

| Detail | Source of truth | Page section | Availability |
|---|---|---|---|
| Name used per signup | `consumer.signups[].firstName/lastName` (`consumerService.js:446`) | Rail, line 2 | **In payload today** |
| Draw chances / boost / outcome | derived + `DrawEntry`/`DrawAttempt` (§4) | Rail outcome slot | **B1 (new)** |
| Reward state + title + expiry + redeemedAt | journey `entitlements[]` | Rail outcome slot | In payload; richer with B2 |
| Why no reward | read-time `rewardDiagnostic` (the skip ledger is unanchored by design — `ActivationIssuanceSkip.js:10-21` — and 30-day-purged; never attribute it per-lead) | Rail outcome slot | B2 |
| Pass/voucher delivery receipts (email/WA, per kind) | `redemption_events` `notified`/`notify_failed` via `DISTINCT ON` | Rail microline + History | B5 |
| Broadcast history (sent/skipped + reason) | `email_broadcast_recipients` by `consumerId`, bounded | Consent card line + History | B5 + new index |
| Quiz score / readiness / answers | `sourceMetadata.quiz` (`prospectService.js:732-734`) | Quiz card (port `QuizResultCard.jsx`) | **In payload today** |
| DNC reachability (status, no-voice/no-SMS, checked, valid-until) | `Prospect.dnc*` columns | Consent card | **In payload today** |
| Consent ledger + suppressions | `consent_events`, `consumer_suppressions` | Consent card | B3 |
| Draw-terms version accepted | `consentMetadata.drawTerms.termsVersionId` | Consent card | **In payload today** |
| Third-party / DNC-override evidence | `consentMetadata.external` / `.dnc` (server-authoritative, `prospectService.js:323,335`) | Consent card | **In payload today** |
| Phone verified at | `sourceMetadata.phoneVerifiedAt` | Contact line tooltip | **In payload today** |
| Landing page + UTM term/content + funnel steps | `session_visits` by `prospect.sessionId` (all rows, allowlisted projection) | This signup + History | B6 |
| Lyfe dispatch status (delivered / failed ×N / pending / not queued) | `webhook_deliveries` via `payload #>> '{data,lead,externalId}'` + subscriber `destination='lyfe'` | Routing row + History | B7 + new index |
| External buyer (named) | `ExternalAgent` association — NOT in `getProspect` includes yet (`prospectService.js:1373-1391`) | Routing row | PR 1 include (`id`/`fullName`/`agency` only) |
| Commission (type/amount/status) on won leads | `commissions` association (already in `getProspect` include) | This signup + History | **In payload today** |
| Priority / score / next follow-up / converted | Prospect columns | Header chips + This signup | **In payload today** |
| Profile: DOB/age, postal, demographics, interests, budget, preferences, tags, notes | Prospect JSON columns (sparse — audit 4/10) | Profile card (sparse-render) | **In payload today** |
| Retell capture call: sentiment, duration, from-number, summary, recording | `sourceMetadata.*` + `GET /api/retell/recording/:prospectId` | Voice-call card (`call_bot` only) | **In payload today** (+1 existing endpoint) |
| AI screening (verdict → recordings) | `screening*` columns + `screeningMetadata` | Screening card (drawer port) | **In payload today** |
| Repeat-signup (phone OR email match, incl. consumer-less) | `repeatSignup` enrichment | Rail fallback / cross-check | **In payload today** |

Deliberately **skipped**: `Verification` (ephemeral OTP staging — the durable stamp is
`phoneVerifiedAt`), `Attribution` row detail (QR tag already shown), `BeaconEvent`
(device/fleet-scoped — retired direction), `ShortLinkClick` (not lead-linkable), CAPI/TikTok
per-event send log (only scattered markers exist — `sourceMetadata.capi.voucherRedeemed`;
a real signal ledger is its own project), person-level attribute rollup (audit gap, not
this page).

## 6. Out of scope (named so they aren't rediscovered)

- Consumer search / list API + UI ("show me +65 9123 4567") — audit P1 #6 first half.
- Cohort-member → person click-through (needs `latestProspectId` in the member payload).
- Draw admin panel (freeze/seal/draw/publish from the UI) — the CLI remains the lifecycle
  tool; this page is read-only on draws.
- `consumerId` on `draw_entries` (audit P0 #4) — per-signup `prospectId` queries dodge it.
- Person-level attribute rollup (audit "profile depth" gap).
- Editing lead fields on the page (drawer never had it either).

## 7. Open questions for review

1. Ship B3 (ledger-backed Consent card) in v1, or ship the page with legacy booleans +
   `legacy` tag and fast-follow? (Doc assumes: in v1 — it's now a per-signup resolution
   and part of PR 1's scope.)
2. Keep any quick-glance affordance on the list (e.g. hover preview), or is full
   navigation always acceptable? (Doc assumes: navigation only — simplest, matches ask.)
3. History: include Supabase-side agent engagement events for admins only (current
   endpoint behaviour) — confirm that stays admin-gated on the page. (Doc assumes yes.)

## 8. Codex review dispositions (gpt-5.6-sol xhigh, 2026-07-25)

22 findings; every load-bearing claim was re-verified against this checkout before
adoption. 21 adopted (some amended), 1 refuted in part. Verdict was RETHINK; the §4
contract and §3.8 navigation model were rewritten accordingly.

| # | Sev | Verdict | Disposition |
|---|---|---|---|
| 1 | BLOCKER | adopted | "Pre-seal" split into `open` (derive) vs `frozen` (entries only — freeze WRITES the pool, `luckyDrawService.js:311-320`); `excluded_at_freeze` state added |
| 2 | HIGH | adopted | Boost predicate gains `issuedVia != 'manual'` (`:371`) + stays-1× test for manually-issued entitlements |
| 3 | HIGH | adopted | Deterministic draw selection (live first, else latest terminal) + `drawHistory[]`; unique index covers live statuses only (`Draw.js:60-65`) |
| 4 | HIGH | adopted | Rich outcome states (`selected_*`, `not_selected_yet/final`, void) modelling the redraw ledger (`:546-577`) |
| 5 | MEDIUM | adopted | Bounded per-draw query count + status re-read/retry; query-count + race tests |
| 6 | BLOCKER | adopted (amended) | Skip-ledger attribution dropped (rows unanchored by design + 30-day purge, `ActivationIssuanceSkip.js:10-21`); replaced with a read-time `rewardDiagnostic` re-running `issueForProspect`'s checks — more accurate than Codex's migrate-or-remove options |
| 7 | HIGH | adopted | Consent resolved per signup via batched `getConsentState(consumerId, {campaignId})`; scope exposed; person-wide last-per-kind map rejected |
| 8 | HIGH | adopted | Webhook partial expression index promoted to prerequisite migration (purge deletes failed rows only, `webhookService.js:479`) |
| 9 | HIGH | adopted | B7 filters subscriber `metadata.destination='lyfe'` (`:155-173`); `not_queued_no_destination` state for System-Agent leads; sanitized reason from `responseBody` |
| 10 | HIGH | adopted | `email_broadcast_recipients (consumerId, createdAt DESC)` index + bounded page + aggregate counts |
| 11 | MEDIUM | adopted | Receipts via `DISTINCT ON`, not the redeemOps in-memory reduce |
| 12 | HIGH | adopted | Session steps allowlisted + capped; aggregate over ALL rows (non-unique `sessionId`, race-prone writer) |
| 13 | HIGH | adopted | All enrichments admin-branch + `?include=profile` opt-in; byte-identical payload otherwise; lazy split option for B5–B7 |
| 14 | HIGH | adopted | `erased_draw_unavailable` state (erasure nulls `DrawEntry.prospectId`, `erasureService.js:510-528`); never renders as not-eligible |
| 15 | MEDIUM | adopted | `externalAgent` include is PR 1 work (`id`/`fullName`/`agency` only); Appendix corrected — it was wrongly "in payload today" |
| 16 | LOW | adopted | Canonical-name path documented as `prospect.consumer.consumer.*` |
| 17 | MEDIUM | adopted | `timeline` is env-gated (`SUPABASE_LEAD_ACTIVITIES_URL`); page falls back to `activities[]`; both states tested |
| 18 | MEDIUM | adopted | `expiresAt` rendered as a deadline (re-stamped at unlock), never synthesized as a History transition |
| 19 | HIGH | adopted | `state.from` threading contract for back-link + re-anchor + post-delete; tests for reload/direct-link/redirect/multi-re-anchor |
| 20 | MEDIUM | adopted | Selection-mode row clicks toggle instead of navigating (selection is local state and navigation unmounts it) |
| 21 | MEDIUM | adopted | Person-card hops are callbacks (not `?lead=`) — corrected; dashboard recent-leads + campaign-detail latest-leads linked to the page; `GlobalSearch.test.jsx:71` updated |
| 22 | LOW | refuted in part | `.claude/skills/verify` DOES exist in this repo (verified by `ls` — Codex missed it); adopted the useful half: §5 names explicit jest/vitest/build gates alongside the skill |
