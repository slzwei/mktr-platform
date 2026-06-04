# Quiz Content — "What's Your Money Personality?" (→ Protection Personality)

**Quiz ID:** `protection-personality` · **Version:** 2 · **Scoring:** `profile-sum` · **For:** MKTR Quiz Campaign (see `MKTR_QUIZ_CAMPAIGN_PLAN.md`)
**Status:** Draft for sign-off · **Validated:** persona distribution + lead-score bands simulated across all answer combinations (2026-05-31)

A fun, fast, Singapore-flavoured personality quiz for cold IG/TikTok traffic. Hooks on a **broad "money personality"** angle (high scroll-stop / start-rate), then **pivots to a protection readiness result** at the reveal (the offer). Quietly captures real lead signal — life stage, coverage confidence, top worry, financial resilience — into a per-lead **tag set + lead score** so the agent opens with the right story. Mirrors the Great Eastern persona mechanic without copying its assets/wording.

> **v2 changes** (from the growth review): broad "money personality" hook decoupled from the offer; questions reordered fun→reality and softened; localised SG options; tags on Q3/Q4/Q5 + a Hot/Warm/Cool **lead score**; flatter-first reveal with an always-shown gap, a rarity stat, and value-exchange form copy; compliance disclaimer; shareable card + tag-a-friend.

---

## 1. The hook & funnel framing

**Decouple the title from the offer.** Cold paid-social audiences scroll past anything that smells like an insurance ad, so:

- **Ad + quiz title (broad, fun):** *"What's your money personality?"* — maximises scroll-stop and quiz starts.
- **Result (the pivot to the offer):** reveals the persona **and** a "Protection Readiness" score + gap → motivates the free review.

Ad creative must **message-match** the quiz opener (same hook, same persona art) — keeps Meta/TikTok quality scores up and CPL down. Funnel metrics to watch: scroll-stop → **start rate** → per-step completion → **result-reveal → form-reveal → submit** → lead quality (lead-score mix) → CPL.

---

## 2. The four personas (result profiles)

A single most-prepared → least-prepared spectrum. Names are playful + screenshot-shareable; copy is first-person and Singlish-flavoured. `agentAngle` is **internal** (shown to the agent, not the customer) — the default product story, refined further by the Q4 worry tag.

| id | Title | Archetype | Avg readiness | Theme | Tagline | Reveal CTA | agentAngle (internal) |
|---|---|---|---|---|---|---|---|
| `the-rock` | **The Rock** 🛡️ | The Guardian | ~65% | `#0F9D58` | "Rain or shine, my people are covered." | **Get my free protection check** | Optimise / legacy / wealth transfer |
| `the-strategist` | **The Strategist** ♟️ | The Planner | ~54% | `#1A73E8` | "Agak-agak also must steady — I plan my moves." | **See where I can level up** | Savings / retirement top-up |
| `the-dreamer` | **The Big Dreamer** 🚀 | The Go-Getter | ~43% | `#F4B400` | "Chiong first, sort the rest later lah!" | **Show me my blind spots** | Starter health + CI, then savings |
| `the-free-spirit` | **The Free Spirit** 😎 | The Live-for-Now | ~32% | `#DB4437` | "YOLO! Future me can deal with it." | **Find my biggest gap** | Affordable starter protection |

Full descriptions + `shareText` are in the JSON (§7). Personas are deliberately **all likable** — even The Free Spirit is a fun identity, not "the irresponsible one" — so people share whatever they get.

---

## 3. The six questions (v2 order)

One question per screen, auto-advance on tap (mobile-first). Order escalates **fun → lifestyle → behaviour → reality check** (people finish what they start; the most "salesy" question sits late). Each option maps to one persona on the spectrum (A→Rock, B→Strategist, C→Dreamer, D→Free Spirit). `weight` = how much the question counts (Q5 + Q6 carry the real signal). `tag` = lead-intel surfaced to the agent + fed into the lead score (§4).

### Q1 · "Pick your ideal weekend" — *fun icebreaker* · weight **1**
- **A.** Cosy, planned, in bed by 11 🛌 → `the-rock`
- **B.** A bit of plan, a bit of spontaneous → `the-strategist`
- **C.** Last-minute yes to everything 🙌 → `the-dreamer`
- **D.** Wherever the night takes me 🎉 → `the-free-spirit`

### Q2 · "Payday hits. First move?" — *money attitude* · weight **2**
- **A.** Straight to savings & investments 💰 → `the-rock`
- **B.** Split — some saved, some for me → `the-strategist`
- **C.** Pay the bills, pray for leftover → `the-dreamer`
- **D.** Treat myself first — life's short! 🧋 → `the-free-spirit`

### Q3 · "Who's in your circle right now?" — *life stage (tagged)* · weight **2**
- **A.** Family who count on me (kids / parents) → `the-rock` · tag `family-dependents`
- **B.** Me and my other half → `the-strategist` · tag `couple`
- **C.** Just me — building my future → `the-dreamer` · tag `single`
- **D.** Just me — no strings, living free → `the-free-spirit` · tag `single-free`

### Q4 · "Late at night, the 'what if' that nags you most?" — *top worry (tagged → agent angle)* · weight **1**
- **A.** "If something happened to me, would my family be okay?" → `the-rock` · tag `life-income`
- **B.** "Am I saving enough for the future?" → `the-strategist` · tag `savings-retirement`
- **C.** "I'll sort my finances out… eventually" → `the-dreamer` · tag `nurture-warm`
- **D.** "Honestly, I try not to think about it" → `the-free-spirit` · tag `nurture-cold`

### Q5 · "How protected do you feel right now?" — *coverage confidence (tagged, strong signal)* · weight **3**
- **A.** Rock-solid — life, health, the works → `the-rock` · tag `confident`
- **B.** Pretty covered — got the basics → `the-strategist` · tag `covered`
- **C.** A bit patchy — not sure what I have → `the-dreamer` · tag `uncertain`
- **D.** Honestly? Exposed → `the-free-spirit` · tag `exposed`

> Q5 replaces v1's blunt "Insurance — where you at?" — same signal, framed as a *feeling*, so it reads as self-reflection rather than a sales-qualification audit mid-quiz.

### Q6 · "A surprise $5,000 bill lands tomorrow. You…" — *financial resilience (strong signal)* · weight **3**
- **A.** Tap my emergency fund — no stress → `the-rock`
- **B.** Manage, but it'd sting → `the-strategist`
- **C.** Scramble a bit / put it on credit → `the-dreamer`
- **D.** Cross that bridge when I get there 🤷 → `the-free-spirit`

Total weight = **12** (1+2+2+1+3+3).

---

## 4. Lead score (Hot / Warm / Cool) — agent prioritisation

Derived from the Q3/Q4/Q5 tags at submit, stored on the lead, and shown as a badge to the agent. High need + clear life-stage + protection-shaped worry = a hotter lead.

| Tag (from) | Points |
|---|---|
| Q5 coverage: `exposed` / `uncertain` / `covered` / `confident` | 3 / 2 / 1 / 0 |
| Q3 stage: `family-dependents` / `couple` / `single` / `single-free` | 3 / 2 / 1 / 1 |
| Q4 worry: `life-income` / `savings-retirement` / `nurture-warm` / `nurture-cold` | 2 / 2 / 1 / 0 |

**Band:** Hot 🔥 ≥ 6 · Warm 🌤️ 3–5 · Cool ❄️ ≤ 2 (max 8).

**Validated distribution** (uniform over the 64 tag combinations): **Hot 28.1% · Warm 60.9% · Cool 10.9%** — a healthy spread (most leads sellable, ~1 in 4 to prioritise, few to nurture). Real-world mix will shift with actual answers and ad targeting.

> The lead score is **orthogonal to the persona**: persona = personality/shareability; lead score = sales intent/need. Agents sort their queue by it; admins can route Hot leads first.

---

## 5. Scoring spec (client & server must match exactly)

`profile-sum`. Identical algorithm in `src/lib/quizScoring.js` (instant reveal) and `backend/src/services/quizScoringService.js` (authoritative, anti-tamper). A shared fixture set runs through both in CI.

```text
score(quizDef, answers):
  total[p] = 0  for each persona p
  for each answered question q:
      opt = chosen option
      for (persona, n) in opt.scores:                # n = 1 (unit)
          total[persona] += q.weight * n
  best       = max(total.values())
  winner     = first p in scoring.profileOrder where total[p] == best   # tiebreak
  readiness  = round(100 * Σ_q ( q.weight * rankFactor[chosenPersona(q)] ) / Σ_q q.weight)
  leadScore  = Σ tagPoints[chosenTag]  over tagged questions   →  band via leadScore.bands
  return { profileId: winner, score: best, totals, readiness, leadScore: { points, band } }
```

- **`profileOrder`** = `[the-rock, the-strategist, the-dreamer, the-free-spirit]`; ties resolve to the **more-prepared** persona (`prepared-first`) → flattering → more shares. The reveal **always shows the readiness gap regardless of persona** (§6), so conversion motivation doesn't depend on an unflattering label. (*Knob:* `gap-first` reverses ties for harder conversion framing.)
- **`rankFactor`** = `{the-rock:1.0, the-strategist:0.66, the-dreamer:0.33, the-free-spirit:0.0}` → the **Protection Readiness %** (all-prepared 100%, basics 66%, all-YOLO 0%); `100 − readiness` = GE-style gap %.
- No `eval` — `profile-sum` needs only addition.

### Validation (all 4⁶ = 4,096 combinations)
| Persona | Share | Avg readiness |
|---|---|---|
| The Rock | 28.9% | 65% |
| The Strategist | 25.5% | 54% |
| The Big Dreamer | 23.6% | 43% |
| The Free Spirit | 22.0% | 32% |

Balanced split, monotonic readiness gradient, deterministic ties (12% of cases, resolved by `profileOrder`). Extremes verified: all-A → Rock 100%; all-D → Free Spirit 0%.

---

## 6. The result reveal (form-reveal conversion)

Sequence on the reveal screen — **flatter first, gap second, ask last:**

1. **"You're The Strategist ♟️"** — big, persona art + tagline (the dopamine + shareable moment).
2. **Positive description** of the persona.
3. **"Your Protection Readiness: 66%"** meter.
4. **Always-shown gap** (even for The Rock): *"You're ahead of most Singaporeans — but there's still ~34% to optimise."*
5. **Rarity stat** (social proof): *"Only ~1 in 4 are The Strategist."* (Computed live from real responses once ≥ ~500 completions; seed with "~1 in 4" at launch.)
6. **Value-exchange CTA → reveals the contact form:** *"Where should we send your full Protection Breakdown?"* + subtext *"Plus a free 15-min gap review with a licensed adviser."* — reframes the form as receiving value, not surrendering data. The form is the unchanged `CampaignSignupForm` (name/email/phone + OTP + PDPA).
7. **Compliance footnote** (see §10).

**Post-submit / share screen:** thank-you + a **downloadable shareable result card** (persona art + readiness %) + a **"Tag a friend who's a total Free Spirit 😎"** prompt → drives organic TikTok/IG reach.

---

## 7. Drop-in `design_config.quiz` JSON

Paste into `campaign.design_config.quiz`. Image paths are placeholders under the per-campaign upload base — the designer supplies the SVGs. `(refinement)`-marked keys are optional extensions beyond the base plan §5 schema.

```json
{
  "enabled": true,
  "quizId": "protection-personality",
  "version": 2,
  "intro": {
    "headline": "What's your money personality?",
    "subhead": "A 60-second quiz. Find your type — and your blind spots.",
    "ctaLabel": "Start the quiz"
  },
  "scoring": {
    "method": "profile-sum",
    "tiebreak": "prepared-first",
    "profileOrder": ["the-rock", "the-strategist", "the-dreamer", "the-free-spirit"],
    "readiness": {
      "enabled": true,
      "label": "Your Protection Readiness",
      "rankFactor": { "the-rock": 1.0, "the-strategist": 0.66, "the-dreamer": 0.33, "the-free-spirit": 0.0 }
    },
    "leadScore": {
      "enabled": true,
      "tagPoints": {
        "exposed": 3, "uncertain": 2, "covered": 1, "confident": 0,
        "family-dependents": 3, "couple": 2, "single": 1, "single-free": 1,
        "life-income": 2, "savings-retirement": 2, "nurture-warm": 1, "nurture-cold": 0
      },
      "bands": [
        { "gte": 6, "label": "Hot",  "badge": "🔥" },
        { "gte": 3, "label": "Warm", "badge": "🌤️" },
        { "label": "Cool", "badge": "❄️" }
      ]
    }
  },
  "reveal": {
    "alwaysShowGap": true,
    "gapTemplate": "You're ahead of most — but there's still {gap}% to optimise.",
    "rarityEnabled": true,
    "valueExchange": "Where should we send your full Protection Breakdown?",
    "ctaSubtext": "Plus a free 15-min gap review with a licensed adviser.",
    "tagAFriend": "Tag a friend who's a total Free Spirit 😎",
    "disclaimer": "This quiz is for general information only and is not financial advice. By submitting, you agree to be contacted by a licensed financial representative (Redeem, a service of MKTR PTE. LTD.). See our Privacy Policy."
  },
  "media": { "basePath": "/uploads/quiz/protection-personality/" },
  "steps": [
    { "id": "step1", "questions": [{
      "id": "q1_weekend", "prompt": "Pick your ideal weekend", "type": "single", "weight": 1,
      "options": [
        { "id": "cosy",      "label": "Cosy, planned, in bed by 11 🛌",   "image": "q1-cosy.svg",      "scores": { "the-rock": 1 } },
        { "id": "mix",       "label": "A bit of plan, a bit of spontaneous","image": "q1-mix.svg",      "scores": { "the-strategist": 1 } },
        { "id": "adventure", "label": "Last-minute yes to everything 🙌",  "image": "q1-adventure.svg", "scores": { "the-dreamer": 1 } },
        { "id": "night",     "label": "Wherever the night takes me 🎉",    "image": "q1-night.svg",     "scores": { "the-free-spirit": 1 } }
      ]
    }]},
    { "id": "step2", "questions": [{
      "id": "q2_payday", "prompt": "Payday hits. First move?", "type": "single", "weight": 2,
      "options": [
        { "id": "save",  "label": "Straight to savings & investments 💰", "image": "q2-save.svg",  "scores": { "the-rock": 1 } },
        { "id": "split", "label": "Split — some saved, some for me",      "image": "q2-split.svg", "scores": { "the-strategist": 1 } },
        { "id": "bills", "label": "Pay the bills, pray for leftover",      "image": "q2-bills.svg", "scores": { "the-dreamer": 1 } },
        { "id": "treat", "label": "Treat myself first — life's short! 🧋", "image": "q2-treat.svg", "scores": { "the-free-spirit": 1 } }
      ]
    }]},
    { "id": "step3", "questions": [{
      "id": "q3_circle", "prompt": "Who's in your circle right now?", "type": "single", "weight": 2,
      "options": [
        { "id": "family", "label": "Family who count on me (kids / parents)", "image": "q3-family.svg", "scores": { "the-rock": 1 },        "tag": "family-dependents" },
        { "id": "partner","label": "Me and my other half",                    "image": "q3-partner.svg","scores": { "the-strategist": 1 }, "tag": "couple" },
        { "id": "solo",   "label": "Just me — building my future",            "image": "q3-solo.svg",   "scores": { "the-dreamer": 1 },    "tag": "single" },
        { "id": "free",   "label": "Just me — no strings, living free",       "image": "q3-free.svg",   "scores": { "the-free-spirit": 1 },"tag": "single-free" }
      ]
    }]},
    { "id": "step4", "questions": [{
      "id": "q4_worry", "prompt": "Late at night, the 'what if' that nags you most?", "type": "single", "weight": 1,
      "options": [
        { "id": "family_ok", "label": "\"If something happened to me, would my family be okay?\"", "image": "q4-family.svg",     "scores": { "the-rock": 1 },        "tag": "life-income" },
        { "id": "saving",    "label": "\"Am I saving enough for the future?\"",                     "image": "q4-saving.svg",     "scores": { "the-strategist": 1 }, "tag": "savings-retirement" },
        { "id": "eventually","label": "\"I'll sort my finances out… eventually\"",                  "image": "q4-eventually.svg", "scores": { "the-dreamer": 1 },    "tag": "nurture-warm" },
        { "id": "avoid",     "label": "\"Honestly, I try not to think about it\"",                  "image": "q4-avoid.svg",      "scores": { "the-free-spirit": 1 },"tag": "nurture-cold" }
      ]
    }]},
    { "id": "step5", "questions": [{
      "id": "q5_protected", "prompt": "How protected do you feel right now?", "type": "single", "weight": 3,
      "options": [
        { "id": "solid",   "label": "Rock-solid — life, health, the works", "image": "q5-solid.svg",   "scores": { "the-rock": 1 },        "tag": "confident" },
        { "id": "basics",  "label": "Pretty covered — got the basics",      "image": "q5-basics.svg",  "scores": { "the-strategist": 1 }, "tag": "covered" },
        { "id": "patchy",  "label": "A bit patchy — not sure what I have",  "image": "q5-patchy.svg",  "scores": { "the-dreamer": 1 },    "tag": "uncertain" },
        { "id": "exposed", "label": "Honestly? Exposed",                    "image": "q5-exposed.svg", "scores": { "the-free-spirit": 1 },"tag": "exposed" }
      ]
    }]},
    { "id": "step6", "questions": [{
      "id": "q6_bill", "prompt": "A surprise $5,000 bill lands tomorrow. You…", "type": "single", "weight": 3,
      "options": [
        { "id": "fund",    "label": "Tap my emergency fund — no stress", "image": "q6-fund.svg",    "scores": { "the-rock": 1 } },
        { "id": "sting",   "label": "Manage, but it'd sting",            "image": "q6-sting.svg",   "scores": { "the-strategist": 1 } },
        { "id": "credit",  "label": "Scramble a bit / put it on credit", "image": "q6-credit.svg",  "scores": { "the-dreamer": 1 } },
        { "id": "later",   "label": "Cross that bridge when I get there 🤷", "image": "q6-later.svg", "scores": { "the-free-spirit": 1 } }
      ]
    }]}
  ],
  "resultProfiles": [
    { "id": "the-rock",        "title": "The Rock",        "subtitle": "The Guardian",     "description": "You think ahead and make sure the people you love are covered, no matter what life throws. Steady hands, clear plan.", "tagline": "Rain or shine, my people are covered. 🛡️",        "image": "result-the-rock.svg",        "themeColor": "#0F9D58", "ctaLabel": "Get my free protection check", "shareText": "I'm The Rock 🛡️ — turns out I'm the prepared one. What's your money personality?", "agentAngle": "optimise / legacy / wealth transfer" },
    { "id": "the-strategist",  "title": "The Strategist",  "subtitle": "The Planner",      "description": "You've laid solid foundations and you're playing the long game. A few smart moves and you're completely sorted.",       "tagline": "Agak-agak also must steady — I plan my moves. ♟️", "image": "result-the-strategist.svg",  "themeColor": "#1A73E8", "ctaLabel": "See where I can level up",      "shareText": "I'm The Strategist ♟️ — solid base, optimising the rest. What's yours?",            "agentAngle": "savings / retirement top-up" },
    { "id": "the-dreamer",     "title": "The Big Dreamer", "subtitle": "The Go-Getter",    "description": "You're chasing big goals and building your life. Protection is on your list — it just hasn't made it to the top yet.",   "tagline": "Chiong first, sort the rest later lah! 🚀",        "image": "result-the-dreamer.svg",     "themeColor": "#F4B400", "ctaLabel": "Show me my blind spots",        "shareText": "I'm The Big Dreamer 🚀 — big goals, a few gaps to close. What's your money personality?", "agentAngle": "starter health + CI, then savings" },
    { "id": "the-free-spirit", "title": "The Free Spirit", "subtitle": "The Live-for-Now", "description": "You live for today and figure things out as they come. Spontaneous and fun — but a curveball could catch you off guard.", "tagline": "YOLO! Future me can deal with it. 😎",           "image": "result-the-free-spirit.svg", "themeColor": "#DB4437", "ctaLabel": "Find my biggest gap",           "shareText": "I'm The Free Spirit 😎 — living in the moment (maybe too much 😅). What's yours?",       "agentAngle": "affordable starter protection" }
  ]
}
```

---

## 8. Schema refinements (fold back into plan §5)

All optional + backward-compatible:
1. **`question.weight`** (number, default 1) — importance multiplier.
2. **`option.tag`** (string) — lead-intel label → agent angle + lead score (now on Q3/Q4/Q5).
3. **`scoring.profileOrder` + `scoring.tiebreak`** — deterministic ties (`prepared-first` | `gap-first` | `first`).
4. **`scoring.readiness`** (`{enabled,label,rankFactor}`) — the 0–100% meter; inverse = gap %.
5. **`scoring.leadScore`** (`{enabled,tagPoints,bands}`) — **NEW** Hot/Warm/Cool agent-prioritisation score from tags.
6. **`reveal`** (`{alwaysShowGap,gapTemplate,rarityEnabled,valueExchange,ctaSubtext,tagAFriend,disclaimer}`) — **NEW** reveal-screen + compliance copy.
7. **`resultProfiles[].{subtitle,tagline,shareText,agentAngle}`** — reveal/share copy + internal agent guidance.

§3 of this doc is the **canonical scoring algorithm**; client + server implement it identically (CI fixtures).

---

## 9. What lands on the lead (for the agent)

On submit, stored at `Prospect.sourceMetadata.quiz` (plan §4.3):
```jsonc
{
  "quizId": "protection-personality", "version": 2,
  "answers": [
    { "qid": "q3_circle",    "value": "family",  "tag": "family-dependents" },
    { "qid": "q4_worry",     "value": "saving",  "tag": "savings-retirement" },
    { "qid": "q5_protected", "value": "patchy",  "tag": "uncertain" }
    /* …all 6 */
  ],
  "result":   { "profileId": "the-strategist", "title": "The Strategist", "readiness": 54, "agentAngle": "savings / retirement top-up" },
  "leadScore":{ "points": 7, "band": "Hot", "badge": "🔥" },
  "scoredBy": "server"
}
```
The agent's prospect card shows **"The Strategist · 54% ready · 🔥 Hot"** and the worry-derived angle (`savings-retirement`) — so first contact opens with the right product story, prioritised by heat.

---

## 10. Compliance & shareability notes

- **Disclaimer** (on reveal + form, per `reveal.disclaimer`): *"This quiz is for general information only and is not financial advice…"* — required for SG insurance-adjacent advertising; also keeps Meta/TikTok ad accounts safe.
- **No fear-mongering / no over-promising** — gaps framed constructively ("optimise the rest"), never "you'll be ruined." Meta & TikTok both restrict insurance scare tactics.
- **No sensitive data in the quiz** — no health conditions; income/DOB only in the form (optional, ranged). PDPA-clean.
- **Entity + consent** — runs on `redeem.sg` (Redeem, a service of MKTR PTE. LTD.); PDPA consent (already in `CampaignSignupForm`) must cover contact by a licensed financial representative for advisory/marketing.
- **Shareability** — downloadable persona result card + "tag a friend" prompt = free TikTok/IG reach; `shareText` per persona seeds the caption.

## 11. First A/B tests (post-launch, in order)
1. **Hook:** broad "money personality" vs on-topic "protection personality" (start-rate vs lead quality).
2. **Incentive:** none vs small voucher/draw (completion lift vs lead-quality dilution + compliance).
3. **Form copy:** value-exchange ("send your breakdown") vs plain ("enter details").
4. **Tiebreak:** `prepared-first` vs `gap-first` (shares vs conversion).

---

*End of quiz content draft (v2).*
