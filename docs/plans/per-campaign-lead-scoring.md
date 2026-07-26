# Per-campaign lead scoring — the admin describes the ideal lead, the score moves as things happen

**Status:** v1 SCOPE — not reviewed, not approved, not built.
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

1. **Events move the score** — screening outcome + WhatsApp read, against
   today's single global config. Smallest change, needs no AI and no brief, and
   it is the part an agent feels immediately: engaged leads rise in the queue.
2. **Age curve + DOB backfill** — the biggest single accuracy win available,
   independent of everything else.
3. **Score moves to the lead** — `prospects.score`, per-campaign configs,
   objective-level inheritance. The structural change.
4. **AI authoring** — admin writes a description, AI proposes a config, admin
   reviews it in plain language before it goes live.
5. **Email opens** — tracking pixel, then wire in as an event.

Steps 1 and 2 are useful on their own and do not depend on 3–5.

## 8. Open questions

1. **Does a screening refusal on campaign A affect the person's score on
   campaign B?** Argument for: it is real evidence about the human. Against: a
   recruitment refusal says nothing about their insurance propensity.
   Recommendation: **no cross-campaign event bleed in v1** — keep it simple,
   revisit with data.
2. **Should the admin see the AI's config as rules or as prose?** Prose is
   readable; rules are precise. Probably prose with the numbers shown.
3. **Person-level score: keep as summary or retire?** (§4)
4. **Recruitment as a campaign objective** — `campaign-brief.md` §4.1 is missing
   it and needs updating regardless of this plan.

## 9. Out of scope

- LLM scoring individual leads (§2).
- Cross-campaign event bleed (§8.1) in v1.
- Auto-applying an AI config without admin review.
- Retraining/fitting weights from outcomes — a later concern, and one that
  needs closed deals to fit against.
