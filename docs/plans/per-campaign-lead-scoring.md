# Per-campaign lead scoring — the admin describes the ideal lead, the score moves as things happen

**Status:** v3, 2026-07-27 — §16's four re-opened findings closed: B1 → §3
(re-derived against the tables), M6 → §6 (rewritten), M9 → §7 verified
shipped + §9 specified, M10 verified shipped. **Codex round 3: PASS**
(3a REWORK → 3b REWORK → 3c PASS, log in §17). Phase 3 build UNGATED.
**BUILT 2026-07-27: PR A₁ and PR A₂ (§14) — §18 records what shipped and the
three places the build had to deviate from this text.**
**BUILT 2026-07-28: PR C and PR D (§14) — §19 records what shipped and the
six places that build had to deviate.** PR E remains.
**Author:** Claude, 2026-07-26, from Shawn's model:

> "The admin, when creating campaigns, will say the ideal lead profile. The AI
> will use that info to decide the scoring mechanics. Whenever a lead comes in,
> the AI/programmatically decides the score. If the lead gets qualified (AI
> screening call — positive/negative/neutral, agree to meet or not), or if they
> read the WhatsApp/email, the score increases/decreases accordingly."

**Supersedes part of:** `consumer-profile-enrichment.md` §7 (shipped 2026-07-26,
PRs #286/#289).
**Depends on:** `campaign-brief.md` — BUILT 2026-07-27 (#297); §7 records the
shipped alignment (required `product`, no `lifeStage`).

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

## 3. THE ISOLATION MODEL (re-derived from the tables — Codex B1, rounds 1 AND 2)

### 3.1 Two wrong models, for the record

v1 said isolation was enforced by the event query — false; the base consumed
person-wide telemetry, and until Phase 0 landed a WhatsApp read on campaign A
raised campaign B's score in production. Round 1 forced the split (shipped:
§3.3 below).

v2 replaced that with a classification: every input is either a person-scoped
CAPABILITY or a lead-scoped RESPONSE, exclusively. Round 2 killed the
classification on the data: a `read` is simultaneously proof the channel
works AND attention to this pitch; `wa_message_statuses` stores a frontier
that cannot retroactively express "delivered but never read"; and consent is
purpose-scoped in schema, not person-scoped. A partition of *inputs* cannot
describe tables that store *frontiers* and *scoped acts*.

### 3.2 The model that survives the tables: one event, two projections

Events are shared evidence; scope is a property of the **reader**, not of
the row. Each grain owns an extractor, and the isolation contract is what
each extractor may read:

- The **person grain (capability)** may read person-wide state: channel
  frontiers, signup counts, channel existence. It answers "can this person
  be reached; do they engage with us at all". Consent is deliberately NOT on
  this list — consent state is inherently (consumer, campaign)-scoped, and
  what makes any of it person-wide is a stored NULL-campaign row entering
  every scope's merge (§3.3), not a person-grain extractor.
- The **lead grain (response)** may read the person-grain inputs PLUS events
  attributed to (person, THIS campaign) — and never another campaign's
  attributed events. It answers "how is this person responding to THIS
  pitch".

A `read` on campaign A's message therefore legitimately moves BOTH: it
advances the person's WhatsApp frontier (capability — campaign B may rely on
that), and it is a response event for lead A. What it must never do is
appear as a *response* on lead B. **"One event, two projections" replaces
"every event has exactly one scope"** — the surviving rule from v2 is only
this: a response on one campaign never enters another campaign's response
terms.

### 3.3 What the tables actually store, and the predicates that respect it

**WhatsApp.** `wa_message_statuses` keeps ONE row per wamid holding the
FURTHEST status — `sent < delivered < read`, with `failed` terminal and
outranking read (`STATUS_RANK_SQL`, `redeemOps/waWebhookService.js:37`,
rank-guarded upsert `:79-87`, terminal-by-design comment `:35-36`; `wamid`
is the PK, `WaMessageStatus.js:15`). Deliverability is therefore a **rank
predicate, never an equality**: "reached at least delivered" =
`status IN ('delivered','read')` — a read row IS a delivered row whose
frontier moved on. v2's §3.3 ("delivered-ever", dropping `'read'`) was wrong
for exactly this reason and was never built; what Phase 0 shipped keeps the
rank set deliberately, with the rationale in the query comment
(`consumerScoringService.js:150-163`). Prod 2026-07-27: 4 `delivered`, 1
`read`, 1 `failed` — under v2's wording the `read` row, the strongest proof
in the table, would have been the one dropped. Two stated consequences of
the frontier design:

- One read message counts once per grain: as ≥delivered on the person
  frontier, and as read-of-this-pitch on the ONE lead that owns the message
  (§5's send table supplies the owner). That is not double-counting — the
  two grains answer different questions.
- A delivered-then-`failed` overwrite forfeits that message's deliverability
  proof, because the frontier keeps only `failed` (`waWebhookService.js:35-36`).
  Accepted: a failure verdict is stronger operational truth, and any other
  message can re-prove the channel.

**Consent.** Purpose-scoped in schema AND in the data.
`ConsentEvent.campaignId` = "Purpose scope; NULL = explicit global act"
(`ConsentEvent.js:25`); current state is latest-wins per kind across {this
campaign's acts ∪ global acts} (`getConsentState`,
`consentService.js:368-394`); the marketing gate requires a VERIFIED
in-scope grant with no suppression (`canMarketTo`,
`consentService.js:434-441`). A NULL `campaignId` on a stored act arises
two ways, and `getConsentState` reads BOTH as global: **explicitly global
acts** — the brand-era capture twin (`consentService.js:101-114`), its
backfilled twin (`:321-365`), the verified resubscribe lift (`:159-186`),
unsubscribe (`:570-577`), erasure's denial (`erasureService.js:686-699`) —
and **campaignless captures**, whose contact row carries the capture's own
NULL campaign under EVERY wording era (`campaignId` is optional at the API
edge, `validation.js:219`; passed through as `campaignId || null`,
`prospectService.js:1066-1069`; stamped unguarded,
`consentService.js:71-99`, whose own comment calls such a row "already
global", `:105-108`; backfill mirrors it, `:243-263`). The scorer's rule is
therefore NOT an inventory of provenance — it is: **never re-scope a stored
act.** The lead grain reads consent through the ledger's own derivation —
scoped rows count only inside their campaign's merge, NULL rows count
everywhere, whatever minted them — so the score and the gate can never
disagree about the same row. (Legacy-era WORDING is campaign-scoped where a
campaign existed, `contactConsent.js:8-14`, `consentService.js:26-29`,
`ConsentEvent.js:13-16` — a fact about consent semantics, not something the
scorer re-adjudicates.) Prod 2026-07-27: 158
campaign-scoped contact acts (156 grants, 2 explicit denials) vs 21 global
grants — scoped is the NORM, not the edge case v2's table waved away.

So the lead grain scores consent exactly the way the send gate reads it:

    contactable(lead of person P on campaign C) :=
      latest-wins contact state over {C-scoped acts ∪ global acts}
      is granted ∧ verified, and P is not suppressed
      — i.e. canMarketTo semantics (consentService.js:434-441)

so the score can never advertise a reachability the gate would refuse. A
grant scoped to C feeds only C's lead; a global act feeds every lead; an
unsubscribe (global revoke) zeroes them all. The shipped person-grain
predicate — latest `'contact'` act regardless of scope, unverified,
suppression-blind (`consumerScoringService.js:141-149`) — is an interim
approximation at a grain that §4 retires: once the person score is a
projection of lead scores, no separate person-grain consent predicate
exists to be wrong.

### 3.4 The input table, re-derived

| Input | Who may read it | Rule |
|---|---|---|
| Resolved facts (income, family, age…) | every lead's base | person properties; the spine exists for this |
| WhatsApp frontier ≥ delivered, any message of the person's | every lead's base (capability term) | rank predicate `IN ('delivered','read')` |
| WhatsApp `read` of a message owned by (P, C) | lead (P, C) only | response event, decaying; owner comes from §5's send-time stamp, never inference |
| Consent | lead (P, C), at (consumer, campaign) scope | `canMarketTo` semantics above |
| Screening verdict / sentiment / interest | the screened lead only | §13.1's normalized contract |
| Signup recency | each lead: its OWN `prospects.createdAt` | the person-grain "newest signup" anchor (`consumerScoringService.js:119-130`) retires with §4's projection |
| Signup count / verified count / email on file | every lead's base | person capability, as today (`consumerScoringService.js:118-131`) |

### 3.5 The test contract (extends the shipped suite)

Phase 0 shipped the person-grain half as a pinned contract suite —
`backend/test/scoringIsolation.test.js` ("responses do not cross campaigns"
`:85`; "capabilities DO cross campaigns — pinned so an over-scoping 'fix'
fails here" `:148`). Phase 3 extends it at lead grain: one person, live
leads on campaigns A and B —

- `read` on A's owned message when the person already has ≥delivered proof
  elsewhere → B byte-identical; A gains a response event.
- `read` on A's owned message as the person's FIRST frontier proof → B's
  capability term rises (capability travels BY DESIGN — pinned), and B gains
  no response event.
- Screening refusal on A → B byte-identical.
- A's signup being newer → B's recency term unchanged.
- Contact grant scoped to A, no global act → contactable(A) true,
  contactable(B) false. A brand-era grant (which mints the global twin) →
  both true. An unsubscribe → both false. NOTE: this REPLACES the shipped
  suite's person-grain pin "a contact consent granted via one campaign
  raises the person score" (`scoringIsolation.test.js:163`) — correct for
  the person-grain era, superseded by lead-grain scoping when Phase 3's
  authority flip lands; the WhatsApp capability pins remain.
- `delivered`→`failed` overwrite on the person's only proven message →
  frontier proof lost (pinned, documenting §3.3's accepted forfeit).

## 4. ONE AUTHORITY (rewritten — Codex M4)

v1 kept `consumer_profiles.meetScore`/`buyScore` as "a summary" while the
existing writer kept overwriting them from the global model
(`consumerScoringService.js:240-272`) — two authorities guaranteed to disagree.

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
(`retellScreeningService.js:521-529`; merged by `patchWaCallback`, `:538-540`).

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

## 6. DECAY AT WRITE TIME — ONE STORED TRUTH (rewritten — Codex M6, rounds 1 AND 2)

v1 proposed a decay epoch in the hash; round 1 was right that it forces a
full-population rewrite every day. v2 proposed "store a time-independent
`baseScore`, decay at read"; round 2 killed that twice over. First, the base
is NOT time-independent: engagement recency decays inside it
(`consumerScoring.js:226-227`, half-life 180d) and life-event facts decay
inside it (`consumerScoring.js:297-298`, half-life 365d), both against the
`now` the scorer takes (`consumerScoring.js:532`; knobs `:121-124`). Second,
a freshly-decayed display sorted by a nightly-materialized column shows
visibly misordered pages. Both mechanisms are withdrawn.

**v3 decision: one stored number, decayed at WRITE time. Every consumer of
the score — sort, display, API — reads that stored number. Nothing decays at
read, anywhere.**

- `prospects.score` (INTEGER 0-100, `Prospect.js:75-83` — written by nothing;
  serialized through the prospect list API like every non-screening column,
  `prospectService.js:2458-2462`, but rendered and consumed by nothing)
  becomes the lead score as of `scoreComputedAt`, with
  the same stamps `consumer_profiles` uses — config version, algorithm
  version, input hash, computed-at (`consumerScoringService.js:240-258`).
  The breakdown column stores events with timestamps and undecayed weights;
  each rescore recomputes their decayed contributions, and the card renders
  them "as of `scoreComputedAt`".
- **Ordering and display cannot disagree, because they are the same
  column.** That is how ordering and freshness are "solved together": there
  is only one number, and it is the stored one.
- **The sacrifice, stated plainly: pure-time freshness between rescores.**
  The stored number does not age until rewritten. (At person grain today the
  drift is UNBOUNDED: the input hash omits `now` entirely —
  `computeScoreInputHash`, `consumerScoringService.js:185-198` — so the
  gate at `:229-234` skips every pure-decay rewrite forever.) At lead grain
  the write-gate weakens by exactly one clause: **skip the write iff the
  input hash matches AND the recomputed integers (score and the breakdown's
  group scores) equal the stored ones.** The compute already runs before the
  gate either way (`consumerScoringService.js:206-217` precede `:229-234`)
  — round 1 established the gate only ever saved the *write* — so the extra
  writes are exactly the rows whose integer actually moved.
- **Freshness is a reserved slice plus a monotonic cursor — not a promised
  calendar number.** The nightly sweep is date-fenced (one live run per SGT
  date, `enrichmentSweepService.js:90-131`) and DOUBLY budgeted — 500 rows
  and 5 minutes by default (`:45-46`), the deadline checked before every
  row (`:169-172`) — and it spends both budgets config-stale-first, the
  rotation running only when no stop occurred (`:246-259`, `:274`). A
  row-count reservation alone therefore guarantees nothing — a wall-clock
  stop inside the stale phase still yields zero rotation — so PR A₂'s sweep
  extension (§10) reserves the rotation slice in BOTH dimensions: the stale
  phase stops ADMITTING rows at 80% of the row cap and 80% of the deadline,
  leaving the rotation the final 20% admission window of each (an in-flight
  row can still overrun the moment of the check, `:169-172` — admission is
  what is reserved, not literal wall-clock). What CAN be promised: coverage
  is monotonic within each rotation (the durable cursor resumes an
  incomplete pass, `:272-292`, and deliberately resets only at the end of
  the population so the next decay cycle starts over, `:282-286`), the
  rotation period is population ÷ measured nightly rotation throughput, and
  that
  throughput is observable per run in `staleScored` / `rotationScored` /
  `stoppedBy` (`:294-305`) — an alarmable number, not an assumed one. At
  today's scale the question is academic: the shipped consumer sweep
  completes its entire 130-consumer population inside these same budgets
  (prod run rows, 2026-07-27), and the lead population is 138. Both phases score with a fresh `now` (`:175`), so stale-phase
  rows are decay-fresh too. With half-lives of 180/365 days, one day of
  drift is sub-integer for almost every row (≤ ~0.15 points on the
  worst-placed engagement term), so the nightly write set stays small
  **organically — integer quantization does what v1's epoch machinery was
  invented for.**
- **Event-driven moves don't wait for the rotation.** The choke-point
  writers (§13.1) set the lead's dirty marker in the same transaction and
  fire a post-commit rescore attempt (the house pattern —
  `consentService.js:196-206` does exactly this for propagation); the dirty
  marker makes a dirty lead PROVABLY STALE, so it rides the stale-FIRST
  phase — first claim on the next run's budget, ahead of all rotation work
  (§10 wires the marker into the lead-grain stale query). A read or a
  screening verdict therefore moves the stored score within seconds in the
  normal case; if the in-process attempt dies with the process, the next
  sweep's priority phase picks it up — subject to the same measured-backlog
  caveat as above (a stale backlog larger than one night's budget delays
  its tail, visibly in `staleScored`).

**The daily refresh set stays small by construction:** a lead with no
decaying terms rewrites only when a real input changes — the hash gate's
original design, unchanged for those rows.

## 7. OBJECTIVE VS PRODUCT — two orthogonal axes; the brief half SHIPPED (Codex M9)

Codex found the plans disagreeing: `insurance_sales`/`recruitment` here vs
`agent_leads`/`screened_leads` in the brief. The real problem was that these
are **two orthogonal axes**, and v1 conflated them:

- **Objective** = what you want *out of* the campaign (leads, screened leads,
  audience, partner footfall).
- **Product** = what you are *selling* (insurance, recruitment, a partner
  offer) — and product is what determines who counts as a good lead. You can
  run `agent_leads` for insurance *or* for recruitment, and they want
  opposite people.

**The brief edit is MADE, not described — shipped 2026-07-27 (#297), verified
in this pass:** `campaign-brief.md` §4.1b defines `product` as a REQUIRED
single pick (`insurance | recruitment | partner_offer`), stored in
`campaigns.targetAudience`. The twin validator enforces it — product required
at `utils/campaignBrief.js:130-132` (vocabulary `:47-52`), unknown keys
rejected loudly (`:122-125`; audience keys `:139-142`) — wired service-level:
create 422s at `campaignService.js:530-531`, update at `campaignService.js:797-806`.

What this section still prescribes, for §9 to implement: **scoring profiles
key off `product`, never `objective`.**

## 8. AI CONFIG SAFETY (rewritten — Codex M8)

v1 claimed a closed vocabulary made AI output safe. Codex is right that it does
not: `factTaxonomy` validates *facts*, not scoring configs
(`factTaxonomy.js:108`); `normalizeConfig` permissively merges unknown
components (`consumerScoring.js:500-519`) which then survive as zero-point
"no rule for this component" entries rather than being rejected
(`consumerScoring.js:539-546`); a non-positive half-life silently disables
decay (`consumerScoring.js:143-145`). A schema-valid config can still be absurd.

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
   (`EnrichmentScoringConfig.js:19`, `consumerScoringService.js:71-87`) — so an
   AI proposal inserted into that table would be **live before anyone read it**
   (within one 60s cache TTL). Add `status ∈ draft|approved|superseded`; the
   reader takes the highest *approved* version only (§9's schema carries the
   column).
4. **Untrusted-input handling for `sourceDescription`.** It is admin free text
   reaching a prompt. Studio AI already treats campaign text as untrusted and
   handles it on both sides: the prompt pins all campaign context as
   untrusted DATA, never instructions (`campaignCopyAiService.js:702`, and
   per-request at `:775`), and model OUTPUT passes dedicated sanitizers
   (`:351-444`). This reuses that posture — and item 1's semantic
   invariants are the scoring-side twin of that output validation. The free text drives *only* the AI proposal and is never itself a
   scoring input — which keeps `campaign-brief.md` §3.1's no-free-text rule
   intact.

## 9. CONFIG STORE: SCHEMA, RESOLUTION, CACHING (Codex M9 — specified)

Today: `enrichment_scoring_configs` has **`version` INTEGER as its primary
key** and no scope column of any kind (`091-consumer-enrichment.js:213-220`,
`EnrichmentScoringConfig.js:18-25`); the reader is one process-wide cache
slot with a 60s TTL taking the global maximum version
(`getActiveScoringConfig`, `consumerScoringService.js:58-87`); `activatedAt`
exists and is ignored — an inserted row goes live on the next TTL expiry.
Putting `campaignId` inside `configJson` supplies none of what is needed.

**Schema (one new migration).** Keep the table; keep `version` as the PK and
the single global sequence. A row's `version` IS its identity at every
scope — which is what keeps the existing stamp
(`scoredConfigVersion`, written at `consumerScoringService.js:240-258`, and
the lead-grain twin §6 adds) a single unambiguous integer, with no composite
keys and no change to how breakdowns are interpreted. Add:

    "campaignId"  UUID NULL           -- scope tag with SNAPSHOT semantics —
                                      -- deliberately NO foreign key, see below
    "productKey"  VARCHAR(24) NULL    -- code-checked against BRIEF_PRODUCT_IDS
                                      -- (utils/campaignBrief.js:47-52)
    status        VARCHAR(12) NOT NULL DEFAULT 'approved'
                  -- §8's lifecycle: draft | approved | superseded.
                  -- Existing rows grandfather as approved: they are live today.
    CHECK ("campaignId" IS NULL OR "productKey" IS NULL)
                  -- a row binds ONE scope: campaign, product, or global (both NULL)

**No FK on `campaignId` — snapshot semantics, §5's rule.** Campaigns can be
permanently deleted (`campaignService.js:1032-1035`) while their prospects
survive with `campaignId` nulled (`014-add-cascade-rules.js:87`). An `ON
DELETE CASCADE` would therefore destroy version rows still stamped on
surviving leads — breaking the invariant that every stored breakdown stays
interpretable (`EnrichmentScoringConfig.js:14-16`) — and `SET NULL` is
worse: it would silently promote a dead campaign's bespoke config to GLOBAL
scope (campaignId NULL *means* global). A bare UUID does neither: a deleted
campaign's rows become unreachable history, every historical stamp keeps
resolving, and nulled-campaign leads fall through to the global step below.

**`version` allocation becomes real DDL in the same migration.** Today the
column is a bare `INTEGER PRIMARY KEY` with no sequence or default
(`091-consumer-enrichment.js:214`) and each migration hand-allocates
`MAX(version)+1` (`094-scoring-recency-anchor.js:35-41`) — a pattern two
concurrent runtime writers (an AI draft and an admin approval, §8) would
race. The migration attaches `GENERATED BY DEFAULT AS IDENTITY` and
`setval`s the backing sequence past `MAX(version)`; from then on EVERY
writer — runtime and future migrations alike — omits `version` and lets the
identity assign it.

Partial indexes, one per resolution step: `("campaignId", version DESC) WHERE
"campaignId" IS NOT NULL` · `("productKey", version DESC) WHERE "productKey"
IS NOT NULL` · `(version DESC) WHERE "campaignId" IS NULL AND "productKey" IS
NULL`.

**Resolution**, for scoring a lead on campaign C — product read from
`campaigns.targetAudience.product` when a brief exists (`hasBrief`,
`utils/campaignBrief.js:101-105`); campaigns without one (never backfilled,
though an admin may fill one in at any time via the Details form —
`campaignService.js:797-806`, `campaign-brief.md` §7.3) skip step 2 while
`hasBrief` is false:

1. highest APPROVED version where `campaignId = C`;
2. else highest APPROVED version where `productKey = product(C)`;
3. else highest APPROVED global version — today's three rows, unchanged.

The resolved row's `version` is stamped on the scored row, so "which config
scored this lead" has exactly one answer even when C inherited from product
or global. Changing the resolution order itself is an algorithm change
(bump `SCORING_ALGORITHM_VERSION`), never a data migration.

Config-staleness under resolution: the sweep's stale phase (§10's prospect
cursor) compares each lead's stamped version against the version its
campaign CURRENTLY resolves to — one indexed resolution per distinct
`campaignId` in the batch, cached like any other read. An approval at any
scope therefore makes exactly the inheriting leads stale, and the rotation
remains the catch-all for everything SQL cannot see, unchanged.

**Caching.** Replace the single slot with a map keyed by resolution entry
point — `campaign:<uuid>` | `product:<key>` | `global` — same 60s TTL per
entry. Invalidation is two mechanisms, and **inherited entries are exactly
why the first one is whole-map**:

- **Write-through bust of the ENTIRE map, by BOTH resolution-input
  writers.** A cached `campaign:C` entry may hold an inherited
  product/global row; it goes stale two ways, and only one of them touches
  the config table. (a) A config write — §8's approval endpoint inserting or
  re-statusing any row, at any scope C might inherit from. (b) A brief edit
  that changes `targetAudience.product` via `updateCampaign`
  (`campaignService.js:797-806`) — that re-routes `campaign:C` to a
  DIFFERENT product chain without any config row changing. Per-key
  invalidation would need reverse-dependency bookkeeping; instead both
  writers clear the whole map in-process. The map holds at most
  (campaigns + products + 1) entries; a full bust costs one refetch per key.
- **The 60s TTL is the cross-process floor.** Processes that didn't perform
  the write — other instances, and the standalone scripts
  (`score-consumers.js` runs in its own process with a fresh cache) —
  converge within one TTL, the same bound the shipped single-slot cache
  already accepts (`consumerScoringService.js:56-58`) — and the TTL also
  floors any resolution-input mutation path not enumerated above. A
  just-approved config can score up to 60s of leads under the old
  resolution in such a process. Stated, accepted.

The empty-table fallback (code defaults at version 0,
`consumerScoringService.js:81-83`) survives unchanged as the tail of step 3.

## 10. LEAD-GRAIN INVALIDATION (Codex M5)

Prospect-grain scores need their own invalidation; nothing existing covers them.
The spine relinker bumps only `consumer_profiles.inputVersion`
(`consumerService.js:318-337`), `bumpEnrichmentInputTx` upserts only
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
provider `checks` object (`retellScreeningService.js:672-685`). v1 specced an
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

*Both halves SHIPPED 2026-07-27: `lifeStage` is out of the brief (#297 —
§16 item 4 records the verification), and the age curve landed exactly as
specified (score/v3 #296 — `scoreAge`, `consumerScoring.js:426-456`, with
the band-straddle equal-weight rule at `:442-450`; migration
`095-scoring-age-curve.js`; the DOB backfill ran in prod the same night).*

## 14. Build order (revised)

1. **PR A₀ — isolation correction** (§3.3). **SHIPPED 2026-07-27 as Phase 0**
   (#292 consent-kind fix + #294 score/v2, migration
   `094-scoring-recency-anchor.js`) — in the CORRECTED form, not v2's: the
   rank set kept `'read'`, recency anchored to the newest prospect
   (`consumerScoringService.js:119-163`), pinned by
   `backend/test/scoringIsolation.test.js`.
2. **PR A₁ — send-time ownership** (§5). `wa_message_sends` + every send path.
   Independent, additive, no scoring changes. **SHIPPED 2026-07-27** —
   migration `096-wa-message-sends.js`, `services/redeemOps/waMessageOwnership.js`,
   stamped at the single `sendTemplate` choke point; §18.1 for the deviation.
3. **PR A₂ — the lead score** (§4, §6, §10, §11). The structural one: authority,
   projection, write-time decay + the integer write-gate, invalidation,
   erasure, Prospects column, events UI. **SHIPPED 2026-07-27** — migration
   `099-lead-score.js`, `services/leadScoringService.js`,
   `services/leadScoreDirty.js`, `utils/screeningSignal.js`, `lead/v1`.
4. **PR B — age curve + DOB backfill** (§13.2). **SHIPPED 2026-07-27**
   (score/v3 #296, migration `095-scoring-age-curve.js`; prod remap minted
   135 band observations and the same night's backfill scored 130 with Buy
   non-null for 129 — the one NULL has no DOB).
5. **PR C — per-campaign configs** (§7, §9). **SHIPPED 2026-07-28** —
   migration `100-scoring-config-scope.js`, `services/scoringConfigCache.js`,
   `utils/scoringConfigValidation.js`, campaign → product → global resolution
   in `getActiveScoringConfig` with the SQL twin in `findStaleLeadIds`; §19 for
   the deviations.
6. **PR D — AI authoring** (§2, §8). **SHIPPED 2026-07-28** —
   `services/scoringConfigService.js`, `routes/scoringConfigs.js` behind
   `SCORING_CONFIG_ADMIN_ENABLED` (dark by default).
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
   *Closed in v3 → §3: one event, two projections — scope belongs to the
   reading extractor, not the row; deliverability is a rank predicate (the
   shipped Phase-0 telemetry already keeps `IN ('delivered','read')`,
   `consumerScoringService.js:150-163`); consent is scored at
   (consumer, campaign) scope with `canMarketTo` semantics
   (`consentService.js:368-394,434-441`).*

2. **M6 (re-opened) — DECAY.** §6 stores "`baseScore` (facts + person
   telemetry — time-independent)". False: engagement recency decays inside the
   base (`consumerScoring.js:186-187`) and life-event facts decay inside the
   base (`:257-259`) — `scoreConsumer` takes `now` and the base is
   time-dependent. Separately, a freshly-decayed display over a
   nightly-materialised sort column yields visibly misordered pages. Solve
   ordering and freshness together, or state plainly which one is sacrificed.
   *Closed in v3 → §6: one stored number, decayed at write time, read by
   sort AND display (they cannot disagree); the sacrifice — pure-time
   freshness between rescores — stated with its bound (one sweep rotation;
   integer write-gate). v1's epoch and v2's decay-at-read both withdrawn.*

3. **M9 (re-opened) — CONFIG IDENTITY.** §7 says "`campaign-brief.md` gains a
   required `product` field". The brief was never edited — it has no `product`
   field in its §4 or §5. Either make the edit in the same change or stop
   claiming it. And §9 is still a sketch: specify real schema for campaign →
   product → global resolution, including how per-key caching invalidates
   inherited entries (today: one process-wide slot with a 60s TTL,
   `consumerScoringService.js:47-76`).
   *First half CLOSED 2026-07-27 with the brief build: `product` is now
   §4.1b of `campaign-brief.md` — a REQUIRED enum
   (`insurance | recruitment | partner_offer`) captured at creation and
   stored in `campaigns.targetAudience` (`utils/campaignBrief.js`). Second
   half closed in v3 → §9: scope columns on the version-PK table, campaign →
   product → global resolution with the resolved `version` stamped, and the
   cache-invalidation contract for inherited entries (whole-map
   write-through bust + the 60s TTL cross-process floor).*

4. **M10 — lifeStage. CLOSED 2026-07-27** (the edit, not a description of
   it): `campaign-brief.md` §4.2 and its §5 example JSON no longer carry
   `lifeStage`, and the mapping claim now names the two axes that DO map
   (`identity.preferred_language`, `finance.annual_income_band` — parity
   test-enforced via `validateFact`) with age bands as ranges over
   birth-year bands. The shipped validator (`utils/campaignBrief.js`
   `normalizeBrief`) rejects a `lifeStage` key outright.
   *Original finding:* §13.2 says drop `lifeStage` from the
   brief; the brief still lists it in its §4.2 AND in its §5 example JSON, and
   still claims "every axis maps onto an existing `factTaxonomy` key" — there
   is no lifeStage key (`factTaxonomy.js` `FACT_KEYS`). Same rule: make the
   edit, don't describe it.

**Rule for v3** (the failure mode behind M9 and M10): if the plan describes an
edit to another document, MAKE the edit in the same change. A described-but-
unmade edit reads as done and hides the gap from every later reader.

## 17. Codex round 3 — 3a REWORK → 3b REWORK → 3c PASS

gpt-5.6-sol xhigh, 2026-07-27; every finding of every pass verified against
code before acceptance — all were real.

**Round 3a — against the first v3 text.** Its own summary: B1 substantively
closed, the `product`/`lifeStage` ship verified genuine; M6's bound and
M9's config half re-opened on the details below.

1. **M6/§6 (major)** — the ⌈population/budget⌉ freshness bound ignored the
   5-minute time budget and the config-stale-first phase
   (`enrichmentSweepService.js:45-46,246-259,272-274`): recurring config
   churn can starve the rotation indefinitely. → Bound restated as
   conditional (steady-state), stale-phase rows counted as decay-refreshed
   too, a reserved rotation floor (default 20% of `rowBudget`) added to PR
   A₂, starvation made measurable via the run row's per-phase stats.
2. **M9/§9 (major)** — `ON DELETE CASCADE` on `campaignId` would delete
   version rows still stamped on leads that SURVIVE a permanent campaign
   delete (`campaignService.js:1032-1035`; prospects keep living with
   `campaignId` nulled, `014-add-cascade-rules.js:87`), breaking breakdown
   interpretability; `SET NULL` would silently promote a dead campaign's
   config to GLOBAL scope. → No FK: bare-UUID snapshot scope tag, §5's rule.
3. **M9/§9 (major)** — "keep the single global sequence" had no DDL behind
   it: the PK is a bare INTEGER (`091-consumer-enrichment.js:214`) and
   migrations hand-allocate `MAX(version)+1`
   (`094-scoring-recency-anchor.js:35-41`), which concurrent runtime writers
   would race. → `GENERATED BY DEFAULT AS IDENTITY` + `setval` past MAX in
   the same migration; every later writer omits `version`.
4. **M9/§9 (major)** — the invalidation contract covered config writes but
   not the OTHER resolution input: `updateCampaign` can change
   `targetAudience.product` (`campaignService.js:797-806`), re-routing a
   campaign to a different product chain with no config write. → Both
   writers bust the whole map; the TTL floors unenumerated paths.
5. **§3.3 (minor)** — the global-consent-act inventory missed erasure's
   explicit global denial (`erasureService.js:686-699`). → Added.
6. **§6 (minor)** — "`prospects.score` read by no code path" overstated: the
   list API serializes every non-screening column
   (`prospectService.js:2458-2462`), so it rides the API unrendered. →
   Reworded to written-by-nothing / consumed-by-nothing.
7. **§8 (minor)** — the refreshed citation pointed at OUTPUT sanitizers
   (`campaignCopyAiService.js:351-444`) for an input-posture claim; the
   input posture is the untrusted-DATA prompt pin (`:702`, `:775`). →
   Re-cited both sides; item 1's invariants named as the output-side twin.
8. **Header (minor)** — the status line referenced §17 before it existed. →
   This section.

**Round 3b — re-run after those fixes: REWORK (2 major, 4 minor), all
verified real and accepted.** Its own summary: the no-FK, identity-allocation
and product-change cache-bust fixes substantively sound; the one-stored-number
decision sound but its bound not; the shipped `product`/`lifeStage` work
genuine.

1. **M6/§6 (major)** — 3a's fix reserved rows but not wall-clock: the
   deadline is checked before every row
   (`enrichmentSweepService.js:169-172`) and rotation runs only when no
   stop occurred (`:274`), so a time stop inside the stale phase still
   yields zero rotation, and ⌈population/rowBudget⌉ is no bound when five
   minutes admits fewer rows; "next sweep worst-case" was likewise
   unsupported. → Reservation made two-dimensional (row cap AND clipped
   deadline for the stale phase); the calendar claim replaced by
   monotonic-coverage + measured-throughput (alarmable via the per-phase
   stats); event-driven recovery re-anchored on the stale-first phase
   (dirty ⇒ provably stale ⇒ first claim on the next run's budget).
2. **B1/§3 (major)** — §3.2 let the person grain "read consent acts" while
   §3.3 scoped grants per campaign — an internal contradiction — and the
   global-act inventory was STILL not exhaustive: campaignless captures
   write their contact row with `campaignId` NULL under EVERY wording era
   (`validation.js:219`, `prospectService.js:1066-1069`,
   `consentService.js:71-99` — whose own comment calls the row "already
   global", `:105-108`; backfill `:243-263`), and `getConsentState` reads
   every NULL row as global. → Consent removed from the person-grain
   extractor; the inventory replaced by the rule that survives any
   provenance: the scorer NEVER re-scopes a stored act — it reads the
   ledger's own derivation.
3. **M9/§9 (minor)** — "pre-brief campaigns keep `{}` forever" overstated:
   `updateCampaign` accepts a brief at any time
   (`campaignService.js:797-806`; `campaign-brief.md` §7.3 calls it
   reversible). → "skip step 2 while `hasBrief` is false".
4. **§5 (minor)** — the waCallback citation stopped before the operative
   lines (`retellScreeningService.js:526` stores the wamid; `:538-540` is
   the merge). → Re-cited `:521-529` + `:538-540`.
5. **§7 (minor)** — the 422 throw is `:531`, beside the `:530` call. →
   `:530-531`.
6. **§9/§17 (minor)** — the `MAX(version)+1` expression sits at `094:35`;
   `:39-41` shows only the predicate. → `:35-41`.

**Round 3c — re-run after those fixes: PASS, with three MINOR nits — "B1,
M6, M9, and M10 are otherwise genuinely closed. The shipped
`product`/`lifeStage` edits and all three Round 3b citation corrections
exist at the claimed lines."** The nits, verified real and folded in the
same change: (1) §3.5 now states it REPLACES the shipped suite's
person-grain consent pin (`scoringIsolation.test.js:163`) rather than only
extending it; (2) §6's reservation described as an ADMISSION window, since
an in-flight row can overrun the pre-row deadline check
(`enrichmentSweepService.js:169-172`); (3) §6's cursor described as
monotonic WITHIN a rotation — it deliberately resets at the end of the
population (`:282-286`).

## 18. What shipped, and where the build deviated (2026-07-27)

PR A₁ + PR A₂ built off `origin/main` at 26bda82. Backend unit + integration +
migration suites green against local Postgres (130 suites / 2580 tests, 30
migration tests), `npx eslint src/ --quiet` clean at both roots, frontend
vitest 159 files / 2025 tests green. `test/unit/retellScreening.test.js`
passed at 05:09 SGT — outside the 10:00–20:00 call window — so the recorded
time-of-day flake did not reproduce on this run.

Three places the substrate did not match this text. Each is a deviation the
plan should own rather than a silent divergence in code.

### 18.1 `wa_message_sends.campaignId` is NULLABLE (§5 said NOT NULL)

A lead can legitimately carry no campaign at send time: `campaignId` is
optional at the capture edge (`validation.js:219`, passed through as
`campaignId || null`, `prospectService.js:1066-1069`), and a permanent
campaign delete nulls it on surviving prospects
(`014-add-cascade-rules.js:87`). NOT NULL would force the writer to DROP the
whole ownership row exactly when a campaignless lead is messaged — losing
`prospectId`, which IS the ownership, to protect a snapshot that is only
supporting evidence. Nullable keeps the row.

### 18.2 The person-grain projection carries the BREAKDOWN too (§4 named three columns)

§4 retires `meetScore`/`buyScore`/`consumerScore` as computed values and makes
them a projection of the winning lead. The breakdown had to follow them: the
profile card renders `groups.meet`/`groups.buy` component rows straight out of
`scoreBreakdown` (`AdminV2LeadProfile.jsx:589-624`), so the winning lead's
numbers beside a breakdown from the retired person-grain pass would render
components that visibly do not sum to the score above them. `scoreOneConsumer`
therefore stops writing all four; it keeps its fact-resolution, profile-row and
stamping duties exactly as §4 says.

### 18.3 There is NO meet signal to normalize (§13.1 assumed one rode in `checks`)

§13.1 said the meet signal "rides un-normalized (e.g. `meet_consultant`)".
Verified false. The configured agent's `post_call_analysis_data` is exactly
three fields — `qualified` (boolean, required), `qualification_reason`
(string), `interest_level` (enum hot|warm|cold, optional)
(`retell-screening-calls.md:524-527`) — plus Retell's own `user_sentiment`
(Positive|Neutral|Negative, `retellService.js:235-238`). `meet_consultant`,
`sg_pr` and `age_in_range` appear in this codebase in exactly ONE place: an
illustrative comment at `retellScreeningService.js:682`. They are in no agent
configuration.

So `utils/screeningSignal.js` declares `agreedToMeet` as a slot that
normalizes to `null`, backed by an intentionally EMPTY `MEET_CHECK_KEYS`, and
the scorer blends over what is actually present rather than inventing the
field the plan named. Configuring a real check is a one-line addition to that
array plus a schema-version bump. What is scoreable today is exactly what
§13.1's fallback sentence predicted: the `screeningVerdict` column, plus
`interest_level` and `user_sentiment` mapped through closed vocabularies —
never raw provider `checks` keys, whose names are whatever an operator last
typed into the Retell console.

### 18.4 Two things §6/§9 called for that were deliberately NOT built

- **No config migration for the lead components.** `response` and `screening`
  default in code (`DEFAULT_LEAD_COMPONENTS`). 095's migration existed to force
  a recompute of already-scored rows; every lead starts unscored, so the first
  sweep scores the whole population regardless, and a frozen historical row
  buys nothing. Recalibrating later is an ordinary append-only row carrying
  `leadComponents`.
- **§9's per-campaign config store is untouched** — that is PR C, and nothing
  in A₂ depends on it. Lead scoring resolves the same single global config the
  person grain does.

## 19. PR C + PR D: what shipped, and where the build deviated (2026-07-28)

Built off `origin/main` at `f21c02f`. Backend unit (107 suites / 1980 tests,
run with **no database reachable** — the condition CI's empty `ci` database
imposes and a local Postgres hides) + integration (137 suites / 2679 tests) +
migration suites green; `npx eslint src/ --quiet` clean at both roots.

Migration number checked against `origin/main` at naming time and again before
merge: highest was `099-lead-score.js`, so `100`. The `083`/`096` historical
duplicates stay frozen; nothing was added to that list.

Six places the build departed from §8/§9's text. Each is a deviation the plan
should own rather than a silent divergence in code.

### 19.1 The cache is a LEAF MODULE, not a map inside `consumerScoringService`

§9 says "replace the single slot with a map" and leaves it where the slot was.
It could not stay there. §9's own second invalidation writer is
`campaignService.updateCampaign` (a brief edit re-routes a campaign to a
different product chain), and importing `consumerScoringService` from
`campaignService` drags in the models index, the erasure fence and the fact
resolver — which breaks every suite that mocks `models/index.js` with a partial
export set, on a transitive `Consumer` import. `services/scoringConfigCache.js`
holds the Map and imports nothing.

### 19.2 Resolution keys on `product` ALONE, not on `hasBrief`

§9 says the product is "read from `campaigns.targetAudience.product` when a
brief exists (`hasBrief`)". `hasBrief` also requires a valid `objective`, and
the SQL twin in `findStaleLeadIds` cannot call it. Keying both resolvers on the
one field each side can read (`briefProductKey`) is what makes them provably
identical; a parity test pins them. The objective has no bearing on which
product model applies, and every brief written through `normalizeBrief` carries
both fields anyway — the two readings differ only for hand-written JSON.

### 19.3 `findStaleLeadIds` LOST its `configVersion` parameter

§9 describes the sweep comparing each lead's stamp against "the version its
campaign CURRENTLY resolves to — one indexed resolution per distinct
`campaignId` in the batch, cached like any other read". Resolving in JS breaks
`LIMIT`: the sweep asks for 200 stale leads and would instead get however many
of an arbitrary 200 happened to be stale. The resolution is a `COALESCE` of
three indexed scalar subqueries inside the existing predicate, so the function
no longer takes an expected version at all. The sweep passes `findArgs: {}` for
the lead phase; the consumer phase still passes the global version, unchanged.

### 19.4 Unknown components are rejected at SAVE and DISCOUNTED at read

§8.1 says "unknown component names REJECTED not zeroed (a fix to
`normalizeConfig`)". Making `normalizeConfig` throw would break reading rows
already stored, and it is the read path for every historical breakdown. So the
rejection lives in `validateScoringConfig`, which every write goes through, and
the read path keeps the component VISIBLE in the breakdown while excluding its
`maxPoints` from the group denominator. That fixes the actual damage — a
no-rule component used to deflate every score in its group — without making an
old row unreadable.

### 19.5 The person grain deliberately still resolves GLOBAL

§9 does not say which grain resolves what, and both grains share
`getActiveScoringConfig`, so this had to be decided rather than inherited. A
consumer spans campaigns: there is no campaign to key off, and picking one of
their leads' campaigns would be arbitrary. Called with no scope the resolver
returns the global row — today's behaviour, plus the new `status = 'approved'`
filter. `findStaleConsumerIds` is untouched. The person's numbers are a
projection of the winning lead (§4) whose own stamp records what produced them.

### 19.6 Simulation is BOUNDED, and says so

§8.2 says "run the proposed config over the existing scored population". At
`SIMULATION_SAMPLE_MAX = 500` it stops, because the simulator re-derives facts
and telemetry per lead (two queries each) and an admin-triggered request must
not turn into an unbounded scan. The response carries `population.examined`,
`population.truncated` and `population.sampleMax` rather than presenting a
slice as the whole picture.

### 19.7 One thing §9 called for that the substrate already provided

`GENERATED BY DEFAULT AS IDENTITY` is attached in prod, but the test database
never sees it: `bootstrap.js` runs `sequelize.sync({force:true})` from the
models BEFORE migrations, and `_migrations` survives that sync, so a reused
test DB skips migration 100 entirely. The model therefore declares
`autoIncrement: true`, which makes `sync()` build the column as `SERIAL`, and
the migration's identity attach is guarded on `pg_get_serial_sequence(...) IS
NULL` so it is a no-op there instead of failing with "column already has a
default". Both environments end with a column that allocates itself when a
writer omits it — the property the runtime depends on.

### 19.8 Flag, and what is NOT built

`SCORING_CONFIG_ADMIN_ENABLED` (default `false`) gates the whole admin router;
until it is flipped every path 404s. There is no React surface — the four
controls are API-reachable and the existing admin UI can call them later. PR E
(email opens) is untouched.
