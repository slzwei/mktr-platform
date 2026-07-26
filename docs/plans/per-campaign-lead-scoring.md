# Per-campaign lead scoring — the admin describes the ideal lead, the score moves as things happen

**Status:** v2 SCOPE — **Codex round 1: REWORK** (3 BLOCKER, 7 MAJOR; §11). All findings verified against code and accepted. NOT ready to build — v2 rework required.
**Author:** Claude, 2026-07-26, from Shawn's model:

> "The admin, when creating campaigns, will say the ideal lead profile. The AI
> will use that info to decide the scoring mechanics. Whenever a lead comes in,
> the AI/programmatically decides the score. If the lead gets qualified (AI
> screening call — positive/negative/neutral, agree to meet or not), or if they
> read the WhatsApp/email, the score increases/decreases accordingly."

**Supersedes part of:** `consumer-profile-enrichment.md` §7 (shipped 2026-07-26
as PRs #286/#289 — see §4, this changes where the score lives).
**Depends on:** `campaign-brief.md` (the ideal-lead description is a brief field).

## 1. What changes

Two shifts from what shipped today.

| | Shipped (PR 2/3) | This |
|---|---|---|
| Whose rules | ONE global config for every campaign | **One per campaign**, AI-authored from the admin's description |
| What moves it | Facts + signup history, recomputed nightly | **+ engagement events** — screening outcome, message reads |
| Where it lives | The person | **The lead** (a person can be a great recruit and a poor buyer) |

The reason it must move to the lead is Shawn's own example: a recruitment
campaign wants a 25-year-old fresh grad; an insurance campaign wants 30–65. The
facts are identical; the verdict is opposite. A single per-person number cannot
express both, so the score becomes a property of **(person × campaign)** —
which is exactly what a `prospect` row already is.

## 2. The guardrail — AI authors, code applies

**The AI writes the rules ONCE, at campaign creation. Plain code applies them
to every lead, forever.** Not the AI scoring each lead as it arrives.

Same output, but:
- **Explainable.** The breakdown panel keeps working — every point traceable to
  a rule and an observation. An LLM scoring each lead yields a number with no
  auditable reason.
- **Reproducible.** Two identical leads score identically, today and in six
  months. Sampling temperature does not decide who gets called.
- **Instant and free.** No API call on the capture hot path, no per-lead cost,
  no failure mode where scoring is down.
- **Correctable.** A bad rule is one config row to fix, not a prompt to coax.

This is the single most important decision in this plan. Everything below
assumes it.

## 3. What already exists (verified against prod, 2026-07-26)

| Piece | State |
|---|---|
| Versioned scoring config table (`enrichment_scoring_configs`, JSONB) | ✅ built — needs a campaign key |
| Config-driven engine (`consumerScoring.js`) — weights are data, rules are code | ✅ built |
| Fixed fact taxonomy (`factTaxonomy.js`) | ✅ built — **the AI's output vocabulary is closed and validatable** |
| AI provider plumbing (`AiSettings`, as used by Studio AI) | ✅ built |
| Re-score when inputs change (hash gate + sweep) | ✅ built |
| **Screening outcome** — `prospects.screeningVerdict` (`qualified`/`not_qualified`) + `screeningMetadata.verdictDetail` (sentiment, reason) | ✅ captured |
| **WhatsApp read receipts** — `wa_message_statuses.status = 'read'` | ✅ captured (1 read in prod today) |
| `prospects.score` INTEGER 0–100, commented "Lead scoring from 0-100" | ✅ column exists, **written by nothing** — dead since inception |
| **Email opens** | ❌ **NOT captured.** `EmailBroadcastRecipient` has `status`/`reason`/`sentAt`/`error` only — delivery, not engagement. Needs a tracking pixel before email reads can move anything. |

## 4. Where the score lives — and what this supersedes

**Reuse `prospects.score`** (dead since inception) + a new `scoreBreakdown`
JSONB beside it. Same trick as the campaign brief reusing dead `targetAudience`.

**What happens to PR 2's person-level score:** `consumer_profiles.meetScore` /
`buyScore` were shipped today. Under this model they are no longer the
actionable number — the lead score is. Options, decide at build time:

- **(a)** Keep them as a cross-campaign summary on the People page (highest
  lead score, or most recent), lead score drives the queue. Least disruption.
- **(b)** Retire them; People shows the person's best lead score.

Recommendation: **(a)** — the People page is a person index and wants a
person-grain number; the Prospects queue wants the lead number. PR 3's UI
already renders both grains, so the surfaces survive either way.

**The fact ledger does not move.** Facts stay per person — that is the whole
point of the spine, and it is what lets a recruitment lead and an insurance
lead share one set of observations while scoring oppositely.

## 5. The config — per campaign, AI-authored, admin-visible

### 5.1 Shape

Extends today's config with a campaign key and an event table:

```
{
  campaignId: '…',              // null = the global default (today's behaviour)
  inheritsFrom: 'insurance_sales',   // an objective-level default, §5.4
  sourceDescription: 'fresh grads, 22-28, hungry, recruiting consultants',
  authoredBy: 'ai' | 'admin',
  components: { … maxPoints per component … },
  ageCurve:  { '18-24': 1.0, '25-29': 0.9, '30-34': 0.5, … },  // §5.3
  incomeDirection: 'positive' | 'negative' | 'ignore',
  events: { … §6 … },
  version: 3
}
```

### 5.2 What the AI is allowed to emit

**A closed vocabulary only** — component names, `maxPoints`, curve points,
direction flags. It never emits code, never invents a fact key, never writes
free text into scoring logic. Output is schema-validated against
`factTaxonomy`; anything unrecognised is rejected and the admin sees a plain
error, not a silently degraded config.

This is why the fixed taxonomy from PR 0/1 matters here: it bounds what the AI
can say.

### 5.3 Age as a curve, not a range

An age *range* ("25–65") cannot score — everyone inside scores identically and
the boundary is a cliff. A *curve* can:

- `insurance_sales`: peaks 35–44, low under 25
- `recruitment`: peaks 22–28, falls after 35

**Defined over AGE, not birth year**, or the config silently rots one band
every five years. The taxonomy stores 5-year birth bands; age is derived at
scoring time.

**Age is the highest-coverage signal available** — 129 of 130 prod consumers
have a date of birth, versus 1 with income. Today it contributes **zero** to
the score. Fixing that is worth more than any other single component.

**Prerequisite:** the ledger holds only 1 `birth_year_band` observation because
the mapper runs at capture and predates the population. A backfill over the 129
existing DOBs is required or the component scores NULL for everyone.

### 5.4 Inheritance — so 40 campaigns don't mean 40 hand-built models

Each campaign inherits from an **objective-level default** (`insurance_sales`,
`recruitment`, `audience_build`, `partner_footfall` — the campaign brief's
objective, §`campaign-brief.md` 4.1, plus recruitment which that plan is
missing) and overrides only what the admin's description implies.

A new campaign with no description scores exactly like its objective default.
Twenty recruitment campaigns share one tuned model unless someone deliberately
diverges.

## 6. Events that move the score

The static score is a prior. Engagement is evidence.

| Event | Source | Direction |
|---|---|---|
| Screening: qualified | `screeningVerdict` | strong + |
| Screening: agreed to meet | `verdictDetail` | strong + |
| Screening: positive sentiment | `verdictDetail.sentiment` | + |
| Screening: neutral | `verdictDetail.sentiment` | 0 |
| Screening: not qualified / refused | `screeningVerdict` | strong − |
| WhatsApp read | `wa_message_statuses` = `read` | + |
| WhatsApp delivered, never read | `wa_message_statuses` | small − after a delay |
| Email opened | ❌ **needs tracking pixel first** | + |

**Rules:**
- Event weights live in the same config, so they are per-campaign too — a read
  receipt may matter more for a recruitment pitch than a voucher drop.
- Events **decay**, like life events do today. A read three months ago is not
  evidence of interest now.
- Events are **evidence, not overrides.** A screening refusal should sink a
  score, not zero it — the person may convert on a different campaign, and the
  facts that made them promising are still true.
- Every event appears in the breakdown with its timestamp, so an agent can see
  *"78 → 40 because they refused the screening call on 24 Jul."*

**Trigger:** these already flow through choke points that bump the enrichment
input version, and the sweep's hash gate re-scores when inputs change. So
"score moves on event" is mostly wiring existing events into the hash, plus an
immediate re-score on the high-value ones (screening verdict) rather than
waiting for the nightly.

## 7. Phasing

**Revised after Shawn's isolation decision (§8.1).** The original plan put
"events move the score" first, against today's per-PERSON score. That is
impossible: with one score per person, a screening refusal moves the number
every campaign sees — precisely the cross-campaign bleed the isolation rule
forbids. **Event scoring and the move to per-lead are one piece of work.**

1. **PR A — the lead score, with events** (§10). `prospects.score` +
   breakdown, scored from person facts + that lead's OWN events, under the
   campaign's config (falling back to today's global one). Isolation holds by
   construction: a lead can only see its own campaign's evidence.
2. **PR B — age curve + DOB backfill** (§5.3). The biggest single accuracy win
   available, and fully independent of A.
3. **PR C — per-campaign configs + objective inheritance** (§5.4).
4. **PR D — AI authoring** (§5.2). Admin writes a description, AI proposes a
   config, admin reviews it in plain language before it goes live.
5. **PR E — email opens.** Tracking pixel first, then wire in as an event.

A and B are independent of each other and of C–E.

## 8. Questions

1. **RESOLVED (Shawn, 2026-07-26): NO cross-campaign event bleed.** A
   screening refusal on a recruitment campaign must not drag the person's
   insurance score down — the refusal is evidence about *that pitch*, not
   about the human's propensity to buy. Consequence: §7 re-phased, since this
   is unachievable while one score serves every campaign.
2. **Should the admin see the AI's config as rules or as prose?** Prose is
   readable; rules are precise. Probably prose with the numbers shown.
3. **Person-level score: keep as summary or retire?** (§4)
4. **Recruitment as a campaign objective** — `campaign-brief.md` §4.1 is missing
   it and needs updating regardless of this plan.

## 10. PR A in detail — the lead score with events

### 10.1 The shape

```
leadScore = clamp(0, 100,  base + Σ eventAdjustments)

base   = person facts scored under the campaign's config  (today's engine, unchanged)
events = this lead's OWN evidence, decayed, bounded to ±EVENT_BAND
```

`base` reuses `consumerScoring.js` untouched — facts in, component points out.
Only the wrapper is new.

### 10.2 Storage

| Column | Note |
|---|---|
| `prospects.score` | INTEGER 0–100, **already exists, dead since inception** — reuse |
| `prospects.scoreBreakdown` | NEW JSONB — components + event entries, same shape PR 3's panel already renders |
| `prospects.scoredConfigVersion` / `scoringAlgorithmVersion` / `scoreInputHash` / `scoreComputedAt` | NEW — same stamping contract as `consumer_profiles`, so unscoreable leads exit the re-score loop |

`consumer_profiles.meetScore`/`buyScore` stay as the person-grain summary
(§4 option a). PR 3's People columns keep working unchanged.

### 10.3 Event sourcing — and how isolation is enforced

**The isolation rule is enforced by the QUERY, not by a filter applied
afterwards.** Each event is fetched already scoped to the lead:

| Event | Source | Scoping |
|---|---|---|
| Screening qualified / not_qualified | `prospects.screeningVerdict` | **Same row as the lead.** Inherently isolated |
| Agreed to meet, sentiment | `prospects.screeningMetadata.verdictDetail` | Same row |
| WhatsApp read | `wa_message_statuses.status='read'` | Joined via `redemption_events.metadata.messageId = wamid` → entitlement → activation → **campaignId**, matched to the lead's campaign |

That WhatsApp join already exists — `leadProfileService.deliveryReceipts()`
uses exactly this path today. Nothing new to invent.

**A read receipt on the person's phone from a different campaign is invisible
to this lead.** Not scored down, not scored up — never fetched.

### 10.4 Event weights (config, per campaign later)

```
events: {
  band: 25,                    // total events may move the score at most ±25
  halfLifeDays: 45,
  weights: {
    screening_qualified:    +12,
    screening_agreed_meet:  +10,
    screening_positive:      +5,
    screening_neutral:        0,
    screening_not_qualified: -12,
    whatsapp_read:           +4,
    whatsapp_unread_7d:      -2,   // delivered, never opened, a week gone
  }
}
```

**Bounded on purpose.** An unbounded event layer makes the facts decorative —
one read receipt should not outrank knowing someone's income and family.
Evidence adjusts a prior; it does not replace it.

**Decay** for the same reason life events decay: a read three months ago is
not evidence of interest today.

### 10.5 Recompute triggers

- **Immediate** on screening verdict write — the highest-value event, and an
  agent watching a lead should see it move within seconds, not overnight.
- **On WhatsApp status webhook** — cheap; the hash gate makes a no-op free.
- **Nightly sweep** — catch-all for decay (an event's contribution shrinks with
  time even when nothing happens) and for anything the live paths missed.

Decay means a lead's score changes with no input event, so the hash must
include a **decay epoch** (e.g. the SGT date) or the gate will suppress the
recompute. Cheap, and easy to get wrong.

### 10.6 Surfacing

The breakdown gains an events section, rendered by the same PR 3 panel:

```
BASE (facts)                     46
EVENTS                          +14
  screening: agreed to meet     +10   24 Jul
  screening: positive            +5   24 Jul
  WhatsApp read                  +4   25 Jul
  decay                          −5
                                 ──
                                 60
```

The point is an agent reading *"78 → 40 because they refused the screening
call on 24 Jul"* — the number moving is only useful if the reason moves with it.

### 10.7 Tests that must exist

- A screening refusal on campaign A leaves the same person's campaign-B lead
  **byte-identical** (§8.1 — the isolation rule, as an executable assertion).
- Events cannot push a score outside 0–100, nor beyond ±band.
- A qualified screening raises the score; a refusal lowers it; neutral moves
  nothing.
- Decay: the same event scores lower a month later, with no other change.
- The hash gate re-scores across a decay-epoch boundary and no-ops within one.
- A lead with no events scores exactly its base — the event layer is inert
  until there is evidence.
- Erased consumers: no lead score, no breakdown, consistent with §9 erasure.

## 11. Codex adversarial review round 1 — REWORK (3 BLOCKER, 7 MAJOR)

gpt-5.6-sol xhigh, 2026-07-26. Every finding below was independently verified
against the code before being accepted. **All accepted; none disputed.**

### The three blockers

**B1 — Campaign isolation is already broken in the BASE layer, before events.**
§10.3 claimed isolation is enforced by the event query. False. The base score
consumes person-wide telemetry: `loadTelemetry()` computes `whatsappReachable`
as `EXISTS(… WHERE w."recipientHash" = c."phoneHash" AND w.status IN
('delivered','read'))` — **no campaign predicate at all**
(`consumerScoringService.js:118-122`), and engagement uses consumer-level
`signupCount`/`verifiedSignupCount`. A WhatsApp read sent for campaign A
therefore raises campaign B's score today. The proposed isolation test
(screening refusal only) would have PASSED while consent, delivery, read and
signup activity all bled across campaigns.
→ Isolation must be specified over **every telemetry input**, not just events.

**B2 — The "already exists" WhatsApp→campaign join does not exist.**
`deliveryReceipts()` joins `redemption_events → wa_message_statuses` on wamid
and filters by a set of entitlement ids drawn from the whole person journey
(`leadProfileService.js:105-119`). It never touches activations or campaigns.
Worse: receipts store no immutable `campaignId`/`prospectId` snapshot, and
activations can be relinked, so reconstructing ownership from the *current*
activation can attribute a historical send to the wrong campaign. And
screening-callback WhatsApps write no receipt at all — their wamid lives only
in `prospects.screeningMetadata.waCallback`, invisible to the proposed join.
→ Needs **immutable send-time ownership** (`prospectId`, `campaignId`, kind,
`wamid`) recorded at send, not reconstructed later.

**B3 — Erasure deliberately PRESERVES `prospects.score`.**
The shipped contract states the skeleton keeps "ids, campaign,
status/priority/**score**" (`erasureService.js:21-22`), and the allowlist
rebuild never nulls it. A `scoreBreakdown` added beside it would survive
erasure too — carrying event timestamps, inferred sentiment and observation
ids. That is materially worse than preserving a bare integer, and deleting
`consumer_profiles` does not help because the new data lives on `prospects`.
→ §10.7's erasure test would have failed on day one.

### The seven majors (all accepted)

| # | Finding |
|---|---|
| M4 | Two drifting authorities. The existing scorer keeps overwriting `meetScore`/`buyScore` from the global model; calling them "a summary of lead scores" without retiring that writer or defining a real projection guarantees disagreement. **And "PR 3's UI already renders both grains" is false** — it renders person grain only, on the profile view; the Prospects queue has no score column at all. |
| M5 | Spine relink invalidates `consumer_profiles.inputVersion` only. Prospect-grain scores need their own dirty marker, relink invalidation, owner-movement fence, and a prospect cursor in the sweep. |
| M6 | A date-based decay epoch mechanically fixes the gate but forces a **full-population rewrite daily** under budget, and staggered decay above it. Also: "the hash gate makes a no-op free" is false — telemetry, observations, resolution, hashing and the full score all run *before* the comparison; the gate saves only the write. |
| M7 | "Existing choke points already bump the input version" is false — neither the WA webhook nor the screening-verdict writers bump or re-score. This is new transactional wiring. **And there is no normalized `agreedToMeet` field**: verdictDetail is `reason`/`interestLevel`/`summary`/`sentiment`/recording (`retellScreeningService.js:666`). §6 specced an event on a field that does not exist. |
| M8 | A closed *fact* vocabulary does not validate a *scoring config*. `normalizeConfig` permissively merges unknown components, and a non-positive half-life silently disables decay. A schema-valid AI config can still be absurd. Needs semantic invariants, bounded deltas, population simulation, distribution diffs, rollback. Also: `sourceDescription` free text contradicts `campaign-brief.md` §3.1, and Studio AI already treats campaign text as untrusted — this plan specified no equivalent isolation. **And "admin reviews it" is not a control**: the config table has no draft/approved state and the reader activates the highest version immediately. |
| M9 | `enrichment_scoring_configs` has an integer PK and no campaign/objective/status/parent column; the reader caches one global config. Per-campaign inheritance needs real schema. **The two plans also disagree on objective names** — `insurance_sales`/`recruitment` here vs `agent_leads`/`screened_leads` in the brief. |
| M10 | `campaign-brief.md`'s claim that every audience axis maps to the taxonomy is false — there is no `lifeStage` key, and the ledger stores 5-year **birth-year** bands, so an age curve needs a date-sensitive overlap rule and cannot use exact age. |

### Disposition

**REWORK accepted.** The plan asserted five things about existing code that are
untrue (B2, M4's UI claim, M7's choke points, M7's `agreedToMeet`, M10's
taxonomy mapping) — each written from reading rather than verification. The
lesson for v2: **claims about existing behaviour get a file:line citation or
they do not go in the plan.**

The architecture (per-lead score, AI authors / code applies, bounded decaying
events) was not challenged. What failed is the assumption that the substrate
already supports it.

v2 must, before any build:
1. Define isolation over **every** input, and add send-time message ownership.
2. Resolve the two-authority problem explicitly — one writer, one projection.
3. Fix erasure for prospect-grain score + breakdown.
4. Replace the decay-epoch hack with something that doesn't rewrite daily.
5. Reconcile the objective vocabularies between the two plans.
6. Specify semantic (not just structural) validation for AI configs, plus a
   draft/approved state the reader honours.

## 9. Out of scope

- LLM scoring individual leads (§2).
- Cross-campaign event bleed (§8.1) in v1.
- Auto-applying an AI config without admin review.
- Retraining/fitting weights from outcomes — a later concern, and one that
  needs closed deals to fit against.
