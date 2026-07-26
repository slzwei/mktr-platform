# Campaign brief — asking what a campaign is FOR, at creation

**Status:** v2 SCOPE — §7's four owner decisions RESOLVED (Shawn, 2026-07-26).
Not Codex-reviewed, not built. Ready for review.
**Author:** Claude, 2026-07-26 (from Shawn's ask: "during campaign creation we
need to ask the user what the campaign target audience is, what is the end
goal")
**Related:** `consumer-profile-enrichment.md` (scoring), `studio-profile-questions.md`
(PR 0 question library), `campaign-studio-rollout.md` (Studio AI)

## 1. The problem

Five systems currently guess at something only the campaign's creator knows.

| System | What it guesses today |
|---|---|
| Studio AI "Fill everything" | Tone, audience, angle — inferred from campaign name + reward |
| Profile questions (PR 0) | Which of the 5 to enable — hand-ticked per campaign, no rationale recorded |
| Consumer scoring | One global market-fit segment (zh/chinese) for every campaign |
| Ad targeting | Set in Meta/TikTok, never linked to the campaign record |
| Measurement | Nothing — there is no stated goal to measure against |

Each guess is independently reasonable and collectively incoherent: the AI
writes copy for one audience while scoring assumes another and the ads target
a third.

**This becomes load-bearing at tens of campaigns** (Shawn, 2026-07-26). At six
campaigns an operator holds the intent in their head. At forty they cannot,
and neither can any of the five systems above.

## 2. What already exists (verified 2026-07-26)

| Field | Reality | Verdict |
|---|---|---|
| `campaigns.targetAudience` JSONB | Exists, `{}` on **all 7** prod campaigns, read by **nothing** (only the model + migration 016) | **Dead scaffolding — reuse it** |
| `campaigns.type` ENUM | `lead_generation` \| `brand_awareness` \| `product_promotion` \| `event_marketing` \| `quiz` \| `guided_review`. **All 7 prod campaigns are the default `lead_generation`** | **DO NOT REPURPOSE** — see §6 |
| `campaigns.callToAction` | NULL everywhere | Unused |
| Create → Studio handoff | `OpenInStudioCard` → `/admin/campaigns/:id/studio?ai=full` auto-runs the AI fill | **The insertion point** |

**`type` is a trap.** It conflates business objective (`lead_generation`,
`brand_awareness`) with page mechanic (`quiz`, `guided_review`) — but
`type = 'guided_review'` is load-bearing: it is the sole gate keeping the
classic DesignEditor alive (`mktr-platform/CLAUDE.md`). Repurposing or
re-enum-ing it would silently strand those campaigns. The brief adds new
fields and leaves `type` alone.

## 3. Design principles

1. **Structured choices, never free text.** Same lesson PR 0 learned: free
   text cannot deterministically drive a scoring config, a question set, or a
   targeting hint. Free text is a comment, not an input. (One optional free-text
   "notes" field is fine — explicitly advisory, consumed by nothing.)
2. **Derive what you can; ask only what you can't.** The mechanic
   (draw / reward / quiz / screening / plain form) is already knowable from
   `design_config` + activation state. Asking the admin to restate it invites
   contradiction between the answer and the truth.
3. **Never block creation.** A campaign with no brief must still work exactly
   as today. Seven prod campaigns have no brief and never will.
4. **Advisory to AI, authoritative to config.** The brief *suggests* to the
   Studio AI (which the admin can then override freely) but *determines* the
   scoring segment (which must be deterministic and explainable).
5. **Short enough to answer honestly.** A 15-question wizard gets clicked
   through. Target: **4 questions, ~30 seconds**, all pickable.

## 4. What to ask

### 4.1 Objective — "what does success look like?" (single pick, required)

| Value | Means | Success metric it implies |
|---|---|---|
| `agent_leads` | Collect leads for agents to call | Qualified leads delivered |
| `screened_leads` | Qualify before an agent's time is spent | Screening pass rate |
| `audience_build` | Grow a retargetable audience | Verified contacts gained |
| `partner_footfall` | Drive redemption traffic to a partner | Redemptions |

Not Meta's objective taxonomy — MKTR's. These are the four things a campaign
here actually does.

### 4.2 Audience — "who is this for?" (structured, all optional)

- **Language / market** — `en` \| `zh` \| `ms` \| `ta` \| `any`
  → **the single highest-value field**: feeds the scoring market-fit segment
  per campaign, replacing today's one global zh/chinese assumption.
- **Age band** — multi-select over the taxonomy's 5-year bands, collapsed to
  ranges (`18-29`, `30-44`, `45-59`, `60+`).
- **Life stage** — `young_single` \| `young_family` \| `established_family` \|
  `pre_retiree` \| `retiree` \| `any`.
- **Income band** — reuse `finance.annual_income_band`'s five bands, or `any`.

Every axis maps onto an existing `factTaxonomy` key. That is deliberate: the
brief states the audience in the SAME vocabulary the fact ledger uses, so
"who we wanted" and "who we got" are directly comparable (§7).

### 4.3 Target — "how many, by when?" (optional, two fields)

A number and a date. Without it, §7's measurement is impossible; with it,
every campaign becomes gradeable. Optional because a test campaign genuinely
has no target.

### 4.4 Derived, NOT asked

`archetype` ∈ `draw` \| `reward` \| `quiz` \| `screening` \| `plain_form`,
computed from `design_config` + activation + screening config. Stored
denormalized on the campaign for query speed, recomputed on save. This is the
field §6.3's scoring split consumes.

## 5. Where it lives

**Reuse `campaigns.targetAudience`**, widened to hold the whole brief:

```
targetAudience: {
  objective: 'agent_leads',
  audience: { language: 'zh', ageBands: ['30-44','45-59'],
              lifeStage: 'established_family', incomeBand: 'any' },
  target: { metric: 'qualified_leads', value: 200, byDate: '2026-09-30' },
  archetype: 'draw',            // derived, recomputed on save
  notes: '…',                   // free text, advisory, consumed by nothing
  briefVersion: 1
}
```

**Not `design_config`.** The brief is business metadata, not design. Putting
it in `design_config` would drag it through the v2 clamp, the twin-file parity
tests, and the public projection — three mechanisms that exist to protect
*rendering*, none of which the brief needs. It would also risk leaking
targeting data into the anonymous public payload, which must never happen.

A dedicated `brief` column would be cleaner naming, but `targetAudience` is
already there, already JSONB, already empty, and already named for the biggest
part of the payload. One fewer column beats one better name.

## 6. What consumes it — phased, each independently shippable

### 6.1 Phase 1 — capture (no consumer)

Schema + a create-flow step + an edit surface in Studio. Ships useful on day
one purely as recorded intent: "what was this campaign for?" is currently
unanswerable for all seven prod campaigns.

Backfill: none. Existing campaigns keep `{}` and every consumer treats a
missing brief as "no opinion", never as a default.

### 6.2 Phase 2 — Studio AI (the biggest immediate win)

Feed objective + audience into the "Fill everything" prompt. The AI currently
infers audience from the campaign name; a `zh` / `pre_retiree` brief would
change headline, tone, imagery, and the T&C register.

Strictly advisory — the admin overrides anything, as today.

### 6.3 Phase 3 — scoring (gated)

Two things, both blocked on the layer split discussed 2026-07-26:

- **Per-campaign market fit.** `audience.language` replaces the global segment
  for leads from that campaign — a campaign aimed at Tamil speakers should not
  score every lead down for not being Mandarin-speaking. This is a scoring-config
  dimension, not a code change (`enrichment_scoring_configs` §7.2).
- **Archetype intent weighting.** A `screening` lead who passed carries more
  buying intent than a `reward` grab. This belongs to the **per-lead intent
  score**, which does not exist yet.

**Gate:** do not build until the person-score/lead-score split lands, and not
before there are enough won leads to validate any weighting at all (prod
2026-07-26: **zero** won leads — every weight is currently unvalidated).

### 6.4 Phase 4 — profile-question suggestion

The brief implies which of PR 0's five questions earn their conversion cost:
an `audience_build` campaign wants `language` only; an `agent_leads` campaign
targeting `pre_retiree` wants `retirement_age` and `annual_income`.

**Suggest, never auto-enable.** Enabling a question changes a live funnel's
conversion — that stays a human decision, consistent with the existing rule
that AI "Fill everything" never enables questions on its own.

### 6.5 Phase 5 — measurement

"Did this campaign do what it said?" — stated target vs actual, and
**intended audience vs the audience the fact ledger actually observed**. §4.2's
shared vocabulary is what makes the second half computable: aimed at `zh`
speakers, got 12% `zh`.

That comparison is the real prize. It is also the one thing here that cannot
be faked by intuition at forty campaigns.

## 7. Owner decisions (Shawn, 2026-07-26) — all four RESOLVED

1. **Objective list — all four stand** (§4.1 unchanged): `agent_leads`,
   `screened_leads`, `audience_build`, `partner_footfall`.
2. **Objective REQUIRED; audience and target OPTIONAL.** Requiring everything
   buys honest answers on campaign #1 and clicked-through defaults by #20.
   Creation is blocked only on the one pick.
3. **NO backfill.** The 7 existing campaigns keep `{}` forever. Consequence,
   accepted knowingly: §6.5's aimed-at-vs-got comparison will not cover
   today's traffic — including `Redeem $10 Fairprice Voucher`, which is
   currently ~58 signups/month. Measurement starts with the next campaign
   created. Reversible at any time by filling one in by hand.
4. **`partner_footfall` STAYS.** Shawn does sometimes run campaigns where
   delivering customers to a partner is the actual deliverable, not a side
   effect of lead capture. It remains a first-class objective here rather
   than moving to Redeem Ops. Open sub-question deferred: whether such a
   campaign also needs partner-specific brief fields (which partner, what was
   committed) — revisit when the first one is built.

## 8. Explicitly out of scope

- Touching `campaigns.type` (§2 — `guided_review` gates the classic editor).
- Pushing targeting to Meta/TikTok from the brief. The brief could *inform* a
  targeting spec, but writing to ad platforms from campaign metadata is a
  separate blast radius and a separate plan.
- Free-text-driven anything (§3.1).
- Auto-enabling profile questions (§6.4).
