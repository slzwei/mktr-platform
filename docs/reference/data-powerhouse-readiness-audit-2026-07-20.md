# Data-Powerhouse Readiness Audit — 2026-07-20

**Question:** How ready is mktr/redeem for the "audience grows with us" vision — one consumer
(OTP-verified phone, e.g. 91234567) signing up across many campaigns over months (NTUC voucher →
prenatal class → postpartum trial → reno discount), with MKTR accumulating identity, consent, and
behavior, and re-engaging that audience?

**Method:** 5 parallel code audits (identity spine, consent/compliance, redeem-ops, consumer
frontend, activation/measurement) against main @ `5b69622`, plus live queries on prod Render
Postgres (`mktr-db`) and the Lyfe Supabase. Supersedes the 2026-07-19 audit (~4/10), which predated
the consumer-spine (#204) and consent-ledger (#205) merges.

---

## Verdict: **~5.5 / 10** (up from ~4/10 on 07-19)

The two hardest, most foundational layers — a durable person entity and a person-level consent
ledger — **shipped and are live in prod with clean data**. What remains is almost the entire
"use it" layer: legal basis for cross-campaign contact, activation channels, consumer-facing
continuity, segmentation, and person-level measurement. The skeleton is real; the muscles and the
permission slips are missing.

| # | Layer | Score | One-line state |
|---|---|---|---|
| 1 | Identity spine (person entity) | **8/10** | Live, 100% linkage of eligible prospects, correct by design |
| 2 | Consent & compliance substrate | **6/10** | Excellent ledger; but campaign-scoped copy = no cross-campaign basis; erasure unbuilt |
| 3 | Profile capture richness | **4/10** | 7 hardcoded fields; attributes never roll up to the person |
| 4 | Consumer-facing continuity (UX) | **1/10** | Stateless cold-start funnel; no wallet, prefill, or recognition |
| 5 | Ops/admin person surface | **3/10** | Person card in lead drawer only; no consumer search; ledger invisible |
| 6 | Activation (audiences + outbound) | **1.5/10** | Exclusion audience only; zero inclusion/lookalike; zero send channels |
| 7 | Person-level measurement | **2/10** | Journey drill-in exists; no rollups, no repeat/LTV, campaign-grain dashboards |
| 8 | Cross-system continuity (Lyfe) | **2/10** | Same person → N unrelated leads, can go to different agents; no suppression propagation |

**Live-data proof the motion is real (at tiny scale):** 135 prospects / 130 phones → 129 consumers;
**5 people already signed 2 campaigns organically** ($10↔$20 Fairprice crossover) with zero
cross-sell machinery; on the Lyfe side **2 phones are already split across different agents** — both
the opportunity and the channel-conflict risk are live facts, not hypotheses. At this volume every
schema decision is still cheap: this is exactly the right moment to build the rest.

---

## 1. Identity spine — 8/10 (the big win since 07-19)

**As-built** (`backend/src/models/Consumer.js`, `backend/src/services/consumerService.js`,
migrations 078/079):

- `consumers` is a **phone-keyed (E.164, partial unique), rebuildable projection** of prospects.
  Email is explicitly an attribute, never an identity key. Fields: phone, phoneHash, name, email,
  firstSeenAt/lastSeenAt, signupCount, verifiedSignupCount, unsubTokenHash, erasedAt.
- Resolver `resolveConsumerForCaptureTx` — atomic `INSERT … ON CONFLICT (phone) DO UPDATE` inside a
  SAVEPOINT on the capture txn; failure can never lose a lead. Full reconciler runs SERIALIZABLE
  with 40001 retry; migration 079 and `scripts/rebuild-consumer-spine.js` share it verbatim.
- All three prospect creators link the spine: `prospectService.createProspect` (public funnels,
  agent manual, quiz, reward), `metaLeadService` (always `verified:false`). `retellService`
  correctly does **not** (its phone is MKTR's own DDI, not the person).
- OTP proof is durable + bound: `sourceMetadata.phoneVerifiedAt` + `phoneVerifiedFor = sha256(phone)`,
  stamped at capture (`prospectService.js:508-512`); staff phone-edits strip it; entitlement
  issuance (`entitlementService.js:213`) and lucky-draw freeze (`luckyDrawService.js:224-225`)
  independently enforce the binding.
- Second-campaign flow verified correct end-to-end: same phone on campaign #2 → new prospect row
  (per-campaign dedupe passes) → same Consumer (counts increment) → independent entitlement
  (anti-farm `uq_re_activation_phone` is per-activation by design).

**Prod state:** 129 consumers; the only 3 unlinked prospects are the Retell call-bot rows
(by design). 5 repeat consumers, max signupCount 2. Entitlements: 6/10 carry `consumerId`
(the 4 without are legacy grants whose phones never signed a form — legit).

**Gaps:**
- **`draw_entries` has no `consumerId`** (`DrawEntry.js`) — person link is only via `prospectId`;
  if a prospect is ever deleted/erased the entry is orphaned from the person (phoneHash backfill
  exists for entitlements but not draws).
- **`commissions` has no `consumerId`** (`Commission.js:103-110`) — lifetime value per person is
  not directly queryable.
- **`waitlist_signups` is fully off-spine** and is the one email-keyed identity in the system —
  waitlisters who later sign up are two disconnected records.
- **No person-level attribute rollup**: `demographics` (dob/education/income — filled on 132/135
  prospects!), `location` (postal), quiz results, marketplace extras all stay per-prospect JSON.
  The Consumer projection aggregates only name + email.
- Phone-edit collisions **merge silently** into the existing consumer — no person-merge surfaced
  to admins.
- Hygiene: `Consumer.js:18-19` header comment ("nothing reads unsubTokenHash/erasedAt") is stale
  post-PR-B.

## 2. Consent & compliance — 6/10 substrate, but **no cross-campaign legal basis yet**

**As-built** (migrations 080/081, `ConsentEvent.js`, `ConsumerSuppression.js`, `consentService.js`):

- `consent_events`: append-only, person-level (consumerId NOT NULL, ON DELETE RESTRICT),
  **purpose-scoped** (campaignId; NULL = explicit global act), kinds
  `contact | campaign_terms | third_party | dnc_override | draw_terms`, `granted` records explicit
  unticks, `verified` marks OTP-backed grants, copy `version` + `copyHash`. Latest-wins reads.
- `consumer_suppressions`: unique (consumerId, channel); `erasure` blocks everything including
  transactional, all other reasons block marketing only.
- Capture hook writes events in the capture savepoint; backfill (081) healed legacy rows
  idempotently. **Prod: 339 events (324 backfill + 15 live signup), 2 recorded unticks,
  third-party opt-in 65/137 ≈ 47%, 18 verified events. 0 suppressions, 0 erasures so far.**
- Unsubscribe (email): opaque HMAC token addressed by hash, GET inert / POST mutates (RFC 8058),
  `List-Unsubscribe` headers + footers on both brands. Server-rendered confirm page.
- DNC: full PDPC transport implemented (RSA-SHA256, proxy, budget, advisory lock) but **dark**
  (`DNC_API_ENABLED` default false, UAT base URL) pending PDPC onboarding. Post-OTP gate flow +
  born-held `dnc_pending` prospects are wired. Prod `dncStatus`: 0 rows.

**The two decisive findings:**

1. **`canMarketTo` — the person-level marketing gate — has ZERO live callers.** The only
   `purpose:'marketing'` call in prod code is a PII-strip in `leadOutcomeService.js:127`. The gate
   is built, correct, fail-closed… and dead code, because no marketing send path exists at all.
2. **Every consent string shown to consumers is campaign-scoped** ("for the purposes identified in
   this form", "about this redemption") — and the service layer encodes it: *"There is NO global
   variant — today's copy licenses nothing cross-campaign"* (`consentService.js:20-23`).
   `canMarketTo({campaignId:null})` is structurally always false. **Marketing the prenatal class to
   the NTUC-voucher signup has no consent basis until a global opt-in ships** (new copy version +
   `campaignId:null` events + a capture surface).

**Enforcement matrix today:**

| Channel | Gate | Status |
|---|---|---|
| WhatsApp voucher delivery | `isSendBlocked(transactional)` — only erasure blocks | correct for transactional |
| WhatsApp capability check | legacy `sourceMetadata.consent_contact` boolean (+ pending **D2** decision) | not on the ledger |
| Meta exclusion-audience sync | suppression drop (fail-closed, PR-B) + **legacy boolean** consent filter | not on the ledger, ignores `verified` |
| Meta CAPI (submit) | legacy boolean gates em/ph hashes | not on the ledger |
| Meta CAPI (delayed down-funnel) | send-time suppression check → PII strip | **the one PR-B-correct site** |
| TikTok Events | legacy boolean | not on the ledger |
| Email (transactional confirm) | no gate; unsubscribe headers/footer only | acceptable (transactional) |

**Missing:** PDPA erasure (PR C — `erasedAt` has zero writers; admin delete is per-lead hard-delete
that leaves the consumer + sibling prospects intact); retention purge for prospects/consumers;
**downstream suppression propagation** (no `lead.unsubscribe`/`lead.deleted-person` webhook — an
agent who already received the lead is never told the person withdrew); WhatsApp/SMS unsubscribe
(no STOP handler); admin consent-history view (the Person card still renders the **legacy
per-prospect booleans**, not the ledger); copy-evidence nit: the stored `CONTACT_CONSENT_COPY`
constant is a paraphrase, not the verbatim on-screen text of either funnel, so `copyHash` pins the
wrong string.

## 3. Profile capture richness — 4/10

- Field set is **hardcoded**: `FIELD_IDS = [name, email, phone, dob, postal, education, salary]`
  (`src/lib/designConfigV2.js:76`); per-campaign config is only visible/required/row. **No custom
  field slots.** New vertical attributes (child age, home type, reno stage) = code changes to
  `FIELD_DEFS`/`FieldRenderer`, not config.
- Marketplace flow alone captures vertical extras (`child_name`, `child_school_level`,
  `preferred_branch`, `preferred_timing`) → per-submission `sourceMetadata.marketplace` only.
- Quiz funnel captures scored answers → `sourceMetadata.quiz` only.
- **Nothing accumulates on the person** (see §1) — the reno-discount campaign cannot know the
  person told the prenatal campaign they have a newborn.
- Taxonomy dormant: `campaigns.tags` `[]` and `targetAudience` `{}` on all 5 prod campaigns; the
  10 consumer categories exist only in marketplace design_config.
- Behavioral capture exists but is anonymous: 78 short-link clicks, 12 QR scans, 12 attributions,
  8 session visits in prod — and `prospects.sessionId` + `prospects.attributionId` are **0/135**
  (dead columns; the click→signup stitch was never wired).

## 4. Consumer-facing continuity — 1/10

Verified: **zero client-side identity.** No localStorage/cookie of the person, no prefill, no
"welcome back", form state hardcoded empty, OTP re-verified from scratch on every campaign, no
cross-campaign recommendation anywhere (confirmation = share dialog / generic "Explore more
offers"), marketplace is identical for every visitor (public 60s-cached endpoints), `/r/:token`
is the only reward surface (lose the link → no re-entry; no "my rewards", no phone-OTP recovery),
`CustomerLogin` is staff login (dead consumer variant unimported), winners/share/track pages are
identity-free. The backend recognizes the returning phone (signupCount increments) — **the
consumer never sees it.**

The redeem-redesign design prompt correctly states "no consumer account system — identity is
per-redemption phone OTP." A wallet-by-OTP ("my rewards") is the compatible evolution and is
already the planned Phase-2 shape.

## 5. Ops/admin person surface — 3/10

- The **Person card** in the admin lead drawer (`AdminV2Prospects.jsx:136-178`) is genuine
  cross-campaign visibility: signups (+verified), first seen, rewards (+redeemed), draw entries,
  and an **"Also in" list of the person's other campaigns as deep links**. The NTUC→prenatal→reno
  chain would render here today.
- But: fed by prospect-detail side-loading; `GET /api/consumers/:id` (admin, UUID-only) has **zero
  frontend callers**; **no consumer list/search — you cannot ask "show me +65 9123 4567"**; the
  card's Consent section reads legacy booleans, not the ledger; suppression state invisible.
- Redeem Ops UI is entirely activation/partner-scoped. Closest person view: entitlements search by
  phone on RedemptionsPage (cross-partner, but N disconnected rows per person). Redemptions carry
  no person key at all (hop via entitlement). No `/consumers` route exists on any surface.

## 6. Activation — 1.5/10 (the emptiest layer)

- **Ads:** one Meta **exclusion** audience (52506028688033), synced daily — and it actually uploads
  *every* non-bot lead (mislabeled "redeemed"), gated on the legacy boolean, per-prospect rows
  (person appears N times). **No inclusion audience, no lookalike seed builder, no TikTok
  audiences at all.** Pixels have no advanced matching (server-side CAPI carries hashes instead —
  defensible design).
- **Send channels:** none for marketing. WhatsApp = transactional voucher templates only (marketing
  explicitly deferred to a `canMarketTo` gate in a code comment); mailer = single transactional
  sends; no broadcast/segment runner of any kind.
- **Cadences are structurally partner-bound** (`OutreachCadenceEnrollment.partnerOrganisationId`
  allowNull:false; unique live-enrollment per partner; human tasks only). A consumer lifecycle
  engine is a **new build**, not a retrofit.
- **Segments:** non-existent. "Everyone who signed an NTUC campaign, consented, verified, not
  suppressed" = hand-written SQL today. Prospect list has no consent/verified filters; CSV export
  is current-page-only with no consent columns; `canMarketTo` is single-person (no batch variant).

## 7. Person-level measurement — 2/10

Campaign-grain dashboards are solid (overview/funnel/attention; redeem-ops activation funnel;
Meta CAPI down-funnel ConfirmedResident/ClosedWon with send-time suppression strip). But: no
repeat-rate, no cross-campaign conversion, no LTV (blocked partly by commissions not joining the
spine), journey endpoint computes no aggregates, outcomes live on prospect rows only. TikTok gets
no down-funnel events. Engagement recency per person is derivable from signups + reward events +
consent timestamps — but not from views/scans/clicks (anonymous, see §3).

## 8. Cross-system continuity (Lyfe) — 2/10

`receive-mktr-lead` dedupes only on `external_id` (= prospect id): same person, two campaigns →
**two unrelated `leads` rows**, routable to **different agents** (no phone-continuity logic;
`leads.phone` stored but never used for routing). **Prod evidence: 3 phones already have multiple
leads; 2 phones are split across different agents.** No suppression/erasure propagation events
exist in the webhook catalog (`lead.{created,assigned,unassigned,held,outcome,deleted}` only).
mktr-leads buyers freeze a per-lead consent snapshot — fine for point-in-time, blind to later
withdrawal.

---

## Gap register (ranked)

**P0 — legal + substrate completion (prerequisites for everything else)**
1. **Global marketing opt-in**: new consent copy version + capture surface(s) + `campaignId:null`
   ledger events. Until this ships, cross-campaign contact is unlawful and every activation build
   is moot. (Design decision: where it's offered — funnel checkbox, confirmation page, wallet.)
2. **PR C — erasure**: `erasedAt` writers, person-level PII null, suppression(erasure), allowlist
   rebuild semantics (already planned in `docs/plans/consumer-spine-and-consent-ledger.md`).
3. **Point the three legacy-boolean send sites at the ledger** (redeemedAudienceService, WhatsApp
   `canWhatsAppProspect`, CAPI/TikTok em-ph gate) — needs Shawn's **D2 decision**.
4. **Spine completion**: `consumerId` on `draw_entries` (+ phoneHash backfill) and `commissions`;
   decide waitlist reconciliation; person-merge visibility on phone-edit.
5. **Suppression/erasure propagation contract** downstream (new webhook event; Lyfe + mktr-leads
   consumers of it).

**P1 — make the asset usable**
6. Consumer search + list API/UI (phone → person), surface the ledger + suppressions in the Person
   card, promote the journey to a first-class admin page.
7. Segment query (consent-aware, batch canMarketTo) + export.
8. Meta **inclusion** custom audience + lookalike seed builder (person-deduped rows, ledger-gated,
   verified-only); TikTok audience push; fix exclusion-sync selector/labeling.
9. Person-level attribute rollup (aggregate demographics/vertical answers onto the consumer with
   provenance + recency).
10. Campaign taxonomy in the schema (tags/category), so segments can say "parents" not "campaign
    IDs x, y".

**P2 — the flywheel**
11. Wallet-by-OTP ("my rewards" + profile + global opt-in capture + prefill) — the compatible
    no-accounts path; makes verified re-verification cheap instead of cold.
12. Confirmation-page cross-sell ("your next offer") — the 5 organic repeat consumers prove demand.
13. Consent-gated outbound: marketing WhatsApp templates + broadcast email with unsubscribe;
    consumer lifecycle journeys (new engine, not partner cadences).
14. Custom/vertical field slots in design_config v2 (config, not code, per new vertical).

**P3 — compounding intelligence**
15. Person-level rollups + repeat/LTV dashboards (needs #4 commissions link).
16. Agent-continuity routing into Lyfe (same phone → same agent option) + person-aware delivery.
17. Session/click → person stitching (populate `prospects.sessionId`/`attributionId` at capture).
18. TikTok down-funnel events; retention-purge policy for prospect/consumer PII.

**Hygiene (cheap, do alongside):** stale `Consumer.js` header comment; `CONTACT_CONSENT_COPY`
constant should match on-screen copy verbatim (copyHash currently pins a paraphrase); rename/scope
`selectRedeemers` honestly; document that `/api/consumers/:id` is the canonical read path or
delete it.

---

## Prod data snapshot (2026-07-20)

| Metric | Value |
|---|---|
| Prospects / distinct phones / consumers | 135 / 130 / 129 |
| Eligible-prospect spine linkage | 100% (3 unlinked = Retell call-bot, by design) |
| Repeat consumers (≥2 campaigns) | 5 (max 2; all Fairprice $10↔$20) |
| Verified consumers (verifiedSignupCount>0) | **1** (stamps only exist since trial-hardening) |
| Consent events | 339 (324 backfill + 15 signup; 2 unticks; 18 verified) |
| Third-party disclosure opt-in | 65/137 ≈ 47% |
| Suppressions / erasures / DNC rows | 0 / 0 / 0 |
| Entitlements (linked) | 10 (6) — statuses: 1 eligible, 1 issued, 8 cancelled (test artifacts) |
| Redemptions | 4, all reversed (test artifacts) |
| Campaigns | 5 (4 active, 1 draft Tokyo draw); tags/targetAudience empty |
| Behavioral (clicks/scans/attributions/visits) | 78 / 12 / 12 / 8 — none person-linked |
| `prospects.sessionId` / `attributionId` fill | 0 / 0 |
| `demographics` fill on prospects | 132/135 |
| Lyfe: mktr leads / phones / multi-lead phones / agent-split phones | 16 / 5 / 3 / **2** |

**Read on the verified-consumer number:** it is not a bug — OTP stamps began with the
trial-reward hardening, so the legacy base is correctly unmarketable until re-verified. It does
mean the *marketable* audience starts near zero and only grows with new stamped signups (or a
re-verification surface, e.g. the wallet). Plan accordingly.
