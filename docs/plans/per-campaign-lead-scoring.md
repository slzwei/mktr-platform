# Per-campaign lead scoring — the admin describes the ideal lead, the score moves as things happen

**Status:** v2 — Codex round 2 returned REWORK: 4 of the 10 re-opened (§16).
v3 required before build. **Not built.**
**Author:** Claude, 2026-07-26, from Shawn's model:

> "The admin, when creating campaigns, will say the ideal lead profile. The AI
> will use that info to decide the scoring mechanics. Whenever a lead comes in,
> the AI/programmatically decides the score. If the lead gets qualified (AI
> screening call — positive/negative/neutral, agree to meet or not), or if they
> read the WhatsApp/email, the score increases/decreases accordingly."

**Supersedes part of:** `consumer-profile-enrichment.md` §7 (shipped 2026-07-26,
PRs #286/#289).
**Depends on:** `campaign-brief.md` — which v2 also amends (§7).

**Every claim about existing code below carries a file:line citation.** v1
asserted five things about the codebase that were false; that is what the
citations exist to prevent.

## 1. What changes

| | Shipped (PR 2/3) | This |
|---|---|---|
| Whose rules | ONE global config | **One per campaign**, AI-authored, inheriting a product-level default |
| What moves it | Facts + person telemetry, nightly | **+ lead-scoped engagement events**, decayed |
| Where it lives | The person | **The lead** — one authority, person score becomes a defined projection (§4) |

A recruitment campaign wants a 25-year-old fresh grad; an insurance campaign
wants 30–65. Identical facts, opposite verdict. The score is therefore a
property of **(person × campaign)** — which is what a `prospect` row is.

## 2. The guardrail — AI authors, code applies

The AI writes rules ONCE at campaign creation; plain code applies them to every
lead forever. Not an LLM scoring each lead.

Explainable (every point traces to a rule and an observation), reproducible
(two identical leads score identically in six months), free and instant on the
capture path, and correctable by editing one config row.

Unchallenged by review. Everything below assumes it.

## 3. THE ISOLATION MODEL (rewritten — Codex B1)

### 3.1 What v1 got wrong

v1 claimed isolation was enforced by the event query. It is not, because the
**base** score already consumes person-wide telemetry. `loadTelemetry()`
computes `whatsappReachable` as
`EXISTS(… WHERE w."recipientHash" = c."phoneHash" AND w.status IN ('delivered','read'))`
— no campaign predicate (`consumerScoringService.js:118-122`) — and engagement
reads consumer-level `signupCount`/`verifiedSignupCount`
(`consumerScoringService.js:107`). **A WhatsApp read for campaign A raises
campaign B's score in production today.**

### 3.2 The correction — classify every input, don't blanket-scope

"Scope everything to the campaign" is the wrong fix. Some sharing is correct:
if someone read a WhatsApp from campaign A, they demonstrably *are* reachable
on WhatsApp, and campaign B may rely on that. What must not travel is
**evidence about how they responded to a particular pitch**.

So every input is classified, and the classification is the contract:

| Input | Scope | Why |
|---|---|---|
| All facts (income, family, language, age…) | **PERSON** | Properties of a human. The spine exists for this. |
| Marketing consent | **PERSON** | "May we contact them" is about the human. |
| Has email / phone verified | **PERSON** | Channel existence. |
| WhatsApp **deliverability** ("a message has ever reached this number") | **PERSON** | Channel health, not interest. |
| WhatsApp **read of a specific message** | **LEAD** | Interest in *this* pitch. |
| Screening verdict / sentiment / interest | **LEAD** | Response to *this* pitch. |
| Signup recency | **LEAD** | This signup's recency, not the person's newest anywhere. |
| Signup count across campaigns | **PERSON** | Repeat engagement is a real person-level signal. |

**Rule:** a **capability** (can we reach them) is person-scoped; a **response**
(did they engage, did they agree, did they refuse) is lead-scoped.

### 3.3 Consequences for the shipped engine

`loadTelemetry` must be split. `whatsappReachable` stays person-scoped but is
redefined as *delivered-ever* (dropping `'read'` from the predicate, since read
is now a lead-scoped response). Engagement's recency input changes from the
consumer's `lastSeenAt` to **this prospect's** `createdAt`.

This is a behaviour change to code shipped today, and it changes existing
scores. It must land as a config/algorithm version bump so every stored score
is recomputed and the change is visible in `scoringAlgorithmVersion`.

### 3.4 The test contract (v1's was inadequate)

v1 proposed one test: a screening refusal on A leaves B unchanged. That would
have passed while four other inputs bled. Required instead — **for each row of
§3.2's table**, a test asserting the scope actually holds. Specifically, with
one person holding two live leads on different campaigns:

- WhatsApp **read** on A's message → B byte-identical.
- Screening refusal on A → B byte-identical.
- A's signup being newer → does not change B's recency term.
- WhatsApp **delivered** on A → B's contactability *does* rise (asserting the
  person-scoped half deliberately, so a future "fix" to over-scope is caught).
- Marketing consent granted via A → B's contactability rises.

## 4. ONE AUTHORITY (rewritten — Codex M4)

v1 kept `consumer_profiles.meetScore`/`buyScore` as "a summary" while the
existing writer kept overwriting them from the global model
(`consumerScoringService.js:199-228`) — two authorities guaranteed to disagree.

**Decision: the LEAD score is the sole computed authority.**

- `scoreOneConsumer()` stops writing `meetScore`/`buyScore`/`consumerScore`.
  Its fact-resolution and profile-row duties remain.
- The person-grain numbers become a **projection, defined exactly**:
  `meetScore` / `buyScore` = the values from the person's **highest-scoring
  non-erased lead**, ties broken by most recent `prospects.createdAt` then
  `prospects.id`. Recomputed whenever any of that person's leads is rescored.
  Null when the person has no scoreable lead.
- Because it is a projection, it can never disagree — it is a copy with a rule.

**v1's claim "PR 3's UI already renders both grains" was false** and is
withdrawn. Verified: People renders person-grain columns only
(`AdminV2People.jsx:171-186`); the profile card reads `journey.enrichment` from
`ConsumerProfile` only (`leadProfileService.js:511`); the Prospects queue has
no score column at all (`AdminV2Prospects.jsx:352`). So PR A must also ship:
a score column on the Prospects queue, and an events section in the breakdown
card. That work was invisible in v1's estimate.

## 5. MESSAGE OWNERSHIP AT SEND TIME (new — Codex B2)

v1 claimed `deliveryReceipts()` already joins wamid → entitlement → activation
→ campaign. **False.** It joins `redemption_events → wa_message_statuses` on
wamid and filters by entitlement ids drawn from the person's whole journey
(`leadProfileService.js:105-119`); it never touches activations or campaigns.

Reconstructing ownership afterwards is also unsafe: receipts carry no immutable
campaign snapshot (`redeemOps/entitlementService.js:211`), activations can be
relinked (`redeemOps/activationService.js:117,153`), so a historical send can
be attributed to the wrong campaign. And screening-callback WhatsApps write no
receipt at all — their wamid lives only in `prospects.screeningMetadata.waCallback`
(`retellScreeningService.js:516`).

**New table `wa_message_sends`** — ownership stamped at send, never derived:

```
wamid        VARCHAR(128) PRIMARY KEY
prospectId   UUID NOT NULL        -- immutable: the lead this was sent for
campaignId   UUID NOT NULL        -- snapshot, NOT a live FK lookup
consumerId   UUID                 -- for erasure
kind         VARCHAR(24)          -- 'reward' | 'screening_callback' | 'pass' | …
sentAt       TIMESTAMPTZ NOT NULL
```

Written by every WhatsApp send path, including screening callbacks. The webhook
keeps writing `wa_message_statuses` keyed by wamid, untouched
(`redeemOps/waWebhookService.js:73,154`). Read scoping becomes a join on wamid
— exact, immutable, and covering every send path.

Backfill: none possible for historical sends (ownership was never recorded).
Pre-existing reads simply do not score. Stated, not hidden.

## 6. DECAY WITHOUT DAILY REWRITES (rewritten — Codex M6)

v1 proposed a decay epoch in the hash. Codex is right that this forces a
full-population rewrite every day under budget, and staggered decay above it.
Also correct: "the hash gate makes a no-op free" is false — telemetry,
observations, resolution, hashing and the whole score all run before the
comparison (`consumerScoringService.js:169-176`); the gate saves only the write.

**Correction: never store a time-dependent number as if it were stable.**

- **Stored:** `baseScore` (facts + person telemetry — time-independent) and the
  **event list with timestamps and undecayed weights**. Changes only when a real
  input changes, so the hash gate works exactly as designed, unchanged.
- **Displayed:** decay applied at READ time. Always fresh, never stale, no write.
- **Sorted:** a materialized `score` column, refreshed by the nightly sweep,
  used only for ORDER BY. Being up to 24h stale for *ordering* is acceptable;
  showing a stale *number* is not.

**And the daily refresh set is small by construction:** only leads with at
least one decaying event need re-materializing. A lead with no events has a
static score forever. Today that would be a handful of rows, not 130.

## 7. OBJECTIVE VS PRODUCT — the vocabularies were confused (Codex M9)

Codex found the plans disagreeing: `insurance_sales`/`recruitment` here vs
`agent_leads`/`screened_leads` in `campaign-brief.md:69`. The real problem is
that these are **two orthogonal axes**, and v1 conflated them.

- **Objective** = what you want *out of* the campaign (leads, screened leads,
  audience, partner footfall). Already in the brief.
- **Product** = what you are *selling* (insurance, recruitment, a partner
  offer). **Missing entirely**, and it is what determines who counts as good.

You can run `agent_leads` for insurance *or* for recruitment, and they want
opposite people. So:

**`campaign-brief.md` gains a required `product` field**
(`insurance` | `recruitment` | `partner_offer`), and **scoring profiles key off
`product`, not `objective`.** This also resolves v1's separate observation that
the brief was missing recruitment.

## 8. AI CONFIG SAFETY (rewritten — Codex M8)

v1 claimed a closed vocabulary made AI output safe. Codex is right that it does
not: `factTaxonomy` validates *facts*, not scoring configs
(`factTaxonomy.js:108`); `normalizeConfig` permissively merges unknown
components and retains them as zero-point entries rather than rejecting
(`consumerScoring.js:388,419`); a non-positive half-life silently disables decay
(`consumerScoring.js:105`). A schema-valid config can still be absurd.

Four controls, none of which existed in v1:

1. **Semantic invariants**, rejected at save: every weight within declared
   bounds; no single component above 40% of the positive total; half-life
   strictly positive; unknown component names **rejected, not zeroed** (a fix to
   `normalizeConfig`); age curve values in [0,1] and bounded in slope.
2. **Simulation before activation.** Run the proposed config over the existing
   scored population and show the distribution diff — mean, spread, and the
   count whose score moves more than 20 points. A config that scores everyone
   90+ is obvious here and invisible to schema validation.
3. **A real draft/approved state.** Today `EnrichmentScoringConfig` has no
   status and the reader takes the highest version immediately
   (`EnrichmentScoringConfig.js:18`, `consumerScoringService.js:60,65`) — so an
   AI proposal inserted into that table would be **live before anyone read it**.
   Add `status ∈ draft|approved|superseded`; the reader takes the highest
   *approved* version only.
4. **Untrusted-input handling for `sourceDescription`.** It is admin free text
   reaching a prompt. Studio AI already treats campaign text as untrusted and
   sanitizes server-side (`campaignCopyAiService.js:684,1077`); this reuses that
   posture. The free text drives *only* the AI proposal and is never itself a
   scoring input — which keeps `campaign-brief.md` §3.1's no-free-text rule
   intact.

## 9. SCHEMA THE CONFIG STORE NEEDS (Codex M9)

`enrichment_scoring_configs` today: integer PK, no campaign, objective, status,
or parent column (`091-consumer-enrichment.js:212`), read through one
process-wide cache selecting the global maximum
(`consumerScoringService.js:47,65`). Putting `campaignId` inside `configJson`
supplies none of what is needed. Required:

`campaignId` (nullable, FK) · `productKey` (nullable) · `status` · unique on
(campaignId, version) · resolution order **campaign → product → global**, each
step indexed · per-key caching instead of one global slot.

## 10. LEAD-GRAIN INVALIDATION (Codex M5)

Prospect-grain scores need their own invalidation; nothing existing covers them.
The spine relinker bumps only `consumer_profiles.inputVersion`
(`consumerService.js:317,336`), `bumpEnrichmentInputTx` upserts only
`consumer_profiles` (`enrichmentFence.js:38-52`), and the sweep enumerates
consumers calling `scoreOneConsumer` (`enrichmentSweepService.js:204,221`).

PR A must add: a lead-grain dirty marker, relink invalidation for every affected
prospect, owner-movement fencing (reuse `withConsumerFence`), and a **prospect
cursor** in the sweep beside the consumer one.

## 11. Erasure (Codex B3)

Erasure today **deliberately preserves** the prospect skeleton including `score`
(`erasureService.js:21-22`), and the allowlist rebuild never nulls it
(`erasureService.js:306-310`). A `scoreBreakdown` beside it would survive too,
carrying event timestamps, inferred sentiment and observation ids — materially
worse than a bare integer.

PR A must therefore: null `score`, `scoreBreakdown` and the stamps in the
allowlist rebuild; delete the erased consumer's `wa_message_sends` rows; and
test all of it. This is an amendment to a shipped, deliberate contract — it
needs to be called out in review, not slipped in.

## 12. Codex round 1 — REWORK (3 BLOCKER, 7 MAJOR), all accepted

gpt-5.6-sol xhigh. Every finding verified against code before acceptance; none
disputed. Blockers B1/B2/B3 → §3/§5/§11. Majors M4→§4, M5→§10, M6→§6, M7→§13.1,
M8→§8, M9→§7+§9, M10→§13.2.

**Five v1 claims about existing code were false** — the WhatsApp→campaign join,
"PR 3 renders both grains", "choke points already bump", a normalized
`agreedToMeet` field, and the brief's taxonomy mapping. Each was written from
reading rather than verification. Hence this version's citation rule.

The architecture (per-lead score, AI-authors/code-applies, bounded decaying
events) was not challenged. The assumption that the substrate supported it was,
and it lost — PR A is roughly double v1's implied size.

## 13. Remaining corrections

### 13.1 Screening events need a real contract (Codex M7)

There is **no normalized `agreedToMeet`**. The verdict detail is `reason`,
`interestLevel`, `summary`, `sentiment`, recording/transcript, plus an arbitrary
provider `checks` object (`retellScreeningService.js:664-672`). v1 specced an
event on a field that does not exist.

PR A must define an explicit Retell analysis schema with a versioned, normalized
boolean, and score only normalized fields — never raw `checks` keys. Until that
exists, the scoreable screening events are `screeningVerdict` (which is a real
column) and `sentiment`/`interestLevel` (present but provider-shaped).

Also confirmed: neither the WA webhook (`waWebhookService.js:73,154`) nor the
screening verdict writers (`screeningGate.js:336,361`) bump or re-score today.
v1's "mostly wiring existing events" was wrong — this is new transactional
wiring at both choke points.

### 13.2 Age and life stage (Codex M10)

`campaign-brief.md`'s claim that every audience axis maps to the taxonomy is
false: there is **no `lifeStage` key** (`factTaxonomy.js:108-183`), and the
ledger stores 5-year **birth-year** bands, the mapper having discarded exact DOB
(`factMapperService.js:115`).

Therefore: drop `lifeStage` from the brief (it is derivable from
children + marital + age, and inventing a fact key for it is worse), and specify
the age curve as **a function over birth-year bands evaluated against the
current SGT year**, with an explicit overlap rule for a band straddling a curve
boundary (weight by the fraction of the band in each segment). Exact-age
scoring is not available and should not be promised.

## 14. Build order (revised)

1. **PR A₀ — isolation correction** (§3.3). Split telemetry, fix
   `whatsappReachable`, switch recency to the lead. Small, ships against
   today's person score, and stops a live cross-campaign bleed. **Do this first
   regardless of everything else.**
2. **PR A₁ — send-time ownership** (§5). `wa_message_sends` + every send path.
   Independent, additive, no scoring changes.
3. **PR A₂ — the lead score** (§4, §6, §10, §11). The structural one: authority,
   projection, decay-at-read, invalidation, erasure, Prospects column, events UI.
4. **PR B — age curve + DOB backfill** (§13.2). Independent of all the above and
   still the largest accuracy gain available (129/130 have a DOB; it scores 0).
5. **PR C — per-campaign configs** (§7, §9).
6. **PR D — AI authoring** (§2, §8).
7. **PR E — email opens.** Tracking pixel first; not captured today
   (`EmailBroadcastRecipient` carries delivery only).

## 15. Out of scope

LLM scoring individual leads · cross-campaign response bleed · auto-activating
an AI config without approval · fitting weights from outcomes (needs closed
deals; prod has zero).

## 16. Codex round 2 — REWORK (4 of the 10 re-opened)

gpt-5.6-sol xhigh, run 2026-07-26 against the v2 text; log recorded here
2026-07-27, each finding re-verified against code at `a7ac0a9` before
acceptance. Six of round 1's ten findings stayed closed and are not to be
reworked; four re-opened against v2 itself:

1. **B1 (re-opened) — ISOLATION.** §3.2's capability-vs-response
   classification does not survive the data. A `read` is simultaneously proof
   of deliverability AND a lead response, and `wa_message_statuses` keeps only
   the FURTHEST status per wamid (`STATUS_RANK_SQL` upsert,
   `redeemOps/waWebhookService.js:37,79-87`; `wamid` is the PK,
   `WaMessageStatus.js:15`) — so §3.3's "delivered-ever" predicate (dropping
   `'read'`) makes a READ message stop counting as delivered. Prod today: 3
   `delivered`, 1 `read`, 1 `failed` — the strongest deliverability proof in
   the table would be the one dropped. Consent is also purpose-scoped in
   schema (`ConsentEvent.campaignId`, `ConsentEvent.js:25` — "Purpose scope;
   NULL = explicit global act"), not uniformly person-scoped as §3.2's table
   asserts. Re-derive the model against what the tables actually store.

2. **M6 (re-opened) — DECAY.** §6 stores "`baseScore` (facts + person
   telemetry — time-independent)". False: engagement recency decays inside the
   base (`consumerScoring.js:186-187`) and life-event facts decay inside the
   base (`:257-259`) — `scoreConsumer` takes `now` and the base is
   time-dependent. Separately, a freshly-decayed display over a
   nightly-materialised sort column yields visibly misordered pages. Solve
   ordering and freshness together, or state plainly which one is sacrificed.

3. **M9 (re-opened) — CONFIG IDENTITY.** §7 says "`campaign-brief.md` gains a
   required `product` field". The brief was never edited — it has no `product`
   field in its §4 or §5. Either make the edit in the same change or stop
   claiming it. And §9 is still a sketch: specify real schema for campaign →
   product → global resolution, including how per-key caching invalidates
   inherited entries (today: one process-wide slot with a 60s TTL,
   `consumerScoringService.js:47-76`).

4. **M10 (re-opened) — lifeStage.** §13.2 says drop `lifeStage` from the
   brief; the brief still lists it in its §4.2 AND in its §5 example JSON, and
   still claims "every axis maps onto an existing `factTaxonomy` key" — there
   is no lifeStage key (`factTaxonomy.js` `FACT_KEYS`). Same rule: make the
   edit, don't describe it.

**Rule for v3** (the failure mode behind M9 and M10): if the plan describes an
edit to another document, MAKE the edit in the same change. A described-but-
unmade edit reads as done and hides the gap from every later reader.
