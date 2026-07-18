# MKTR Quiz Campaign — Implementation Plan ("Quiz Funnel")

**Status:** Draft for review · **Author:** Claude (code-grounded against `mktr-platform` @ main) · **Date:** 2026-05-31

A paid-social (IG/TikTok) → interactive quiz → lead-capture funnel for MKTR, inspired by Great Eastern's "Critical Illness Protection Gap" quiz. This document is grounded in the **actual** MKTR codebase (file:line references throughout) so the build is accurate and the existing lead pipeline is reused, not reinvented.

---

## 0. TL;DR — what we are building and why it's mostly cheap

**The funnel:** IG/TikTok ad → lands on a branded quiz page (`redeem.sg/LeadCapture?campaign_id=…`) → user answers a short multi-step quiz → sees a personalised **result profile** (the hook) → leaves contact details (name/email/phone + OTP + PDPA consent) → becomes a **Prospect** → round-robin assigned to an agent → delivered to the agent's phone via the Lyfe app, exactly like every other MKTR campaign.

**The key insight:** a quiz lead is **a normal web-form lead with a richer pre-form experience.** It funnels through the same `POST /api/prospects` → `prospectService.createProspect` path, so it inherits — with **zero changes** — round-robin assignment, lead-credit deduction, the HMAC webhook to `receive-mktr-lead`, per-campaign phone dedup, and Meta CAPI. (`prospectService.js:69+`, `systemAgent.js:76-162`, `webhookService.js`, `metaCapiService.js`.)

**Where the real work is:**
1. A **quiz definition** stored in `Campaign.design_config.quiz` (JSON, no migration) and a **quiz-builder tab** in the existing campaign Designer.
2. A **multi-step quiz UI** (`CampaignQuiz.jsx`) rendered before the existing signup form on the `/LeadCapture` route.
3. A **scoring engine** (client for instant reveal + server for integrity), and storing the result on the lead.
4. **Admin visibility**: quiz result on the prospect detail, a quiz column, and a funnel-analytics view.
5. **Ad tracking**: Meta/IG works today; **TikTok is 100% net-new** (pixel + Events API + `ttclid`).

**What does NOT change:** the assignment engine, the webhook payload/delivery, Lyfe's `receive-mktr-lead`, the brand/redeem routing, and the OTP/identity invariants. Quiz answers ride to Lyfe inside `sourceMetadata` verbatim and Lyfe safely ignores them.

---

## 1. What we copy from the Great Eastern quiz (and improve)

| GE mechanic | What it did | MKTR adaptation |
|---|---|---|
| 7-step illustrated quiz (sliders + tappable tiles + map) | Engagement; only 3 of 7 questions actually scored | Configurable steps/questions; **every question can carry scoring weights** (no dead questions) but "engagement-only" questions are still allowed |
| 4 result "personas" (Steady Pom Pi Pi … YOLO Warrior) with a "gap %" band | The hook that motivates the form submit | `resultProfiles[]` with title/description/image/theme + a computed score/band shown on a **result reveal screen** |
| Bucketed scoring (coverage/care/spend → 5-yr gap → band) | Simple, deterministic | Pluggable `scoring.method`: `profile-sum` (personality) **or** `numeric-gap` (GE-style formula) |
| Lead form gated behind the result | Name/email/phone/NRIC + marketing consent → Salesforce | Our `CampaignSignupForm` (name/email/phone **+ phone OTP** + PDPA) → Prospect → round-robin → Lyfe |
| Hidden fields carry answers into the CRM lead | `q1…q7`, `ci-gap-profile`, utm, `iac` agent attribution | Answers + computed profile stored in `Prospect.sourceMetadata.quiz`; attribution via `fbclid`/`_fbp` (Meta) and (net-new) `ttclid` (TikTok) |
| Adobe analytics step/drop-off events | Funnel measurement | Meta Pixel `ViewContent`/`CompleteRegistration`/`Lead` + a per-step drop-off log for the admin funnel view |
| VWO A/B testing on the page | Variant testing | Optional later; can A/B quiz copy/profiles via campaign duplication |
| reCAPTCHA + first-5,000 voucher + lucky draw | Anti-abuse + incentive | Rate-limit already exists (`leadCaptureLimit` 10/min/IP); voucher/draw is an **optional** incentive module (Phase 7) |

**Improvement over GE:** GE's quiz buried the result in fixed bands and threw away the precise score. We store the raw answers **and** the computed result on the lead, expose them to the agent (so the agent opens the conversation with context — "I saw you're focused on family protection…"), and report profile distribution + drop-off to the admin.

---

## 2. Architecture — how it fits the existing pipeline

```
  IG / TikTok Ad  (ad set points at redeem.sg/LeadCapture?campaign_id=<quizCampaignId>)
        │  carries fbclid (Meta) / ttclid (TikTok)
        ▼
  redeem.sg/LeadCapture  ──► fetch GET /api/previews/public/:id  (campaign.design_config.quiz)
        │
        ▼   NEW: CampaignQuiz.jsx state machine
  ┌─────────────────────────────────────────────────────┐
  │  quiz steps → RESULT REVEAL (profile + score/band)   │   ← client scoring (instant)
  │              → existing CampaignSignupForm (OTP+PDPA) │
  └─────────────────────────────────────────────────────┘
        │  POST /api/prospects  { …contact, campaignId, quizResult }   (NO qrTagId)
        ▼
  prospectService.createProspect  (UNCHANGED path)
   ├─ (NEW) re-score answers server-side → merge into sourceMetadata.quiz
   ├─ resolveAssignedAgentId → campaign round-robin via LeadPackageAssignment pool + RoundRobinCursor
   ├─ deductLeadCredit (FIFO, in txn)
   ├─ ProspectActivity(created, assigned)
   ├─ dispatchEvent('lead.created')  ──HMAC──►  Supabase receive-mktr-lead  ──► leads/notifications ──► Expo push
   └─ sendLeadEvent (Meta CAPI 'Lead')  +  (NEW) TikTok Events API 'CompleteRegistration'
        ▼
  Agent's Lyfe app: new lead notification, opens with quiz result context
```

Everything below the "POST /api/prospects" line **already exists and is reused unchanged** except the two small NEW hooks (server re-score; TikTok event).

---

## 3. The funnel UX (screen by screen)

All on the existing single `/LeadCapture` route, inside the existing `LeadCaptureLayout` shell (warm-cream/Fraunces tokens, per-campaign `themeColor`). Gated by `design_config.quiz.enabled`.

1. **Intro / hero** — headline + subhead + "Start quiz" CTA (reuses `deriveLeadCaptureContent`). Fires Meta `ViewContent` + TikTok `ViewContent` + quiz-start analytics.
2. **Quiz steps** (1…N) — one question per screen (or grouped), illustrated tile selects, single/multi-select, numeric sliders, or scale. Auto-advance on select (mirrors GE). Progress badge "3 / N". Drop-off logged per step.
3. **Result reveal** — "You are **{profile.title}**" + illustration + description + an optional score/band pill (GE-style "gap %"). This is the conversion hook. A **"See my full result / Get a free consult"** button reveals the contact form. Fires Meta + TikTok `CompleteRegistration`.
4. **Contact form** — the existing `CampaignSignupForm` unchanged: name + email + phone **+ phone OTP** + PDPA consent. On submit → `POST /api/prospects` with the quiz result threaded in.
5. **Thank-you / share** — existing post-submit state + share dialog. Fires Meta + TikTok `Lead`. Optionally show voucher/lucky-draw status (Phase 7).

**Re-take / duplicate guard:** per-campaign phone dedup returns **409** (`prospectService.js:168-178`); `LeadCapture.jsx:239-246` already renders an "Already Registered" state. The quiz must route a returning same-phone user to that state, not a crash.

---

## 4. Data model & storage

### 4.1 Quiz definition → `Campaign.design_config.quiz` (JSON, **no migration**)

`design_config` is already the open per-campaign config blob for the entire lead-capture page (copy/fields/theme), validated only as `Joi.object()` on update (`validation.js:92`). Adding a `quiz` sub-object passes through `Campaign.update` with zero schema work — this mirrors how `visibleFields`/`fieldOrder`/`termsContent` are already stored (`DesignEditor.jsx:55-76`).

It is returned to the public page automatically because `getPublicCampaign` returns `design_config` whole among its allowlisted attributes (`campaignPreviewService.js:88-89`). **Checklist:** confirm `design_config` is included verbatim in the preview **snapshot** builder (`campaignPreviewService.js:27-35`) so `/p/:slug` previews show the quiz; add `quiz` to the overlay if the snapshot lists sub-fields explicitly.

### 4.2 Campaign `type` enum → add `'quiz'`

`Campaign.type` is `ENUM('lead_generation','brand_awareness','product_promotion','event_marketing')` (`Campaign.js:25-28`). Add `'quiz'` via a Sequelize migration so the admin list, type selector, and filters can treat quiz campaigns as first-class. (A quiz campaign is functionally `lead_generation` + `design_config.quiz.enabled`; the enum value is for UX/reporting clarity.)

### 4.3 Quiz result on the lead → `Prospect.sourceMetadata.quiz`

`sourceMetadata` (JSON, default `{}`, `Prospect.js:204-209`) is the established catch-all, is merged server-side (`prospectService.js:91-103`), is forwarded **verbatim** in the `lead.created` webhook (`prospectHelpers.js:57`), and is safely ignored by Lyfe (`receive-mktr-lead` never destructures it). Store:

```jsonc
sourceMetadata.quiz = {
  quizId: "protection-personality",
  version: 2,                     // design_config.quiz.version at submit time
  answers: [
    { qid: "q3_circle",    value: "family", tag: "family-dependents" },
    { qid: "q4_worry",     value: "saving", tag: "savings-retirement" },
    { qid: "q5_protected", value: "patchy", tag: "uncertain" }
    /* …all 6 */
  ],
  result:    { profileId: "the-strategist", title: "The Strategist", readiness: 54 },  // readiness %; (100−readiness)=gap %
  leadScore: { points: 7, band: "Hot", badge: "🔥" },                                 // agent prioritisation (Hot/Warm/Cool)
  scoredBy:  "server"             // integrity marker (see §6)
}
```

**Why not a dedicated column/table?** Only worth it if you need to **query/aggregate by profile in SQL**. For store + webhook relay + UI display, `sourceMetadata` needs no migration. If profile-level analytics SQL is wanted later, add a JSONB GIN index on `sourceMetadata->'quiz'->>'profileId'` in `bootstrap.js` (where the other partial indexes live, per `Prospect.js:221-223`). **Recommendation:** start with `sourceMetadata`; add the index only when the analytics view needs it.

---

## 5. Quiz definition schema (concrete)

Stored at `campaign.design_config.quiz`. Supports personality-style (`profile-sum`) and GE-gap-style (`numeric-gap`) scoring. The first concrete instance — **"Protection Personality"** — is fully authored in [`docs/quiz-protection-personality.md`](docs/quiz-protection-personality.md) (personas, all 6 questions, validated scoring); this section is the annotated field reference. Lines marked `(refinement)` were introduced by that quiz and are all optional + backward-compatible.

```jsonc
{
  "enabled": true,
  "quizId": "protection-personality",
  "version": 1,
  "intro": { "headline": "What's your Protection Personality?", "subhead": "A 60-second quiz.", "ctaLabel": "Start the quiz" },
  "steps": [
    {
      "id": "step1",
      "questions": [
        {
          "id": "q4_coverage",
          "prompt": "Your current insurance coverage?",
          "type": "slider",                       // single | multi | slider | scale
          "weight": 3,                            // (refinement) question importance multiplier, default 1
          "min": 0, "max": 1000000, "step": 10000,
          "buckets": [                              // numeric-gap inputs (GE-style)
            { "lte": 199999, "value": 50000 },
            { "lte": 399999, "value": 300000 },
            { "lte": 599999, "value": 500000 },
            { "value": 850000 }
          ]
        },
        {
          "id": "q1_circle",
          "prompt": "Who's in your circle?",
          "type": "single",
          "weight": 2,
          "options": [
            { "id": "yolo",   "label": "Just me, living it up",  "image": "q1-yolo.svg",   "scores": { "the-free-spirit": 1 } },
            { "id": "family", "label": "Family who count on me", "image": "q1-family.svg", "scores": { "the-rock": 1 }, "tag": "life-income" }  // tag (refinement) = agent's opening angle, optional
          ]
        }
      ]
    }
  ],
  "scoring": {
    "method": "profile-sum",                       // profile-sum | numeric-gap
    "tiebreak": "prepared-first",                  // (refinement) 'prepared-first' | 'gap-first' | 'first'
    "profileOrder": ["the-rock","the-strategist","the-dreamer","the-free-spirit"],  // (refinement) tie-resolution order
    "readiness": {                                  // (refinement) optional 0–100% meter on the reveal; (100−readiness)=gap%
      "enabled": true,
      "label": "Your Protection Readiness",
      "rankFactor": { "the-rock": 1.0, "the-strategist": 0.66, "the-dreamer": 0.33, "the-free-spirit": 0.0 }
    },
    // numeric-gap only:
    "formula": { "needMonthsHorizon": 60, "inputs": ["coverage","monthlyNeed"], "expr": "(monthlyNeed*60 - coverage)/(monthlyNeed*60)" },
    "bands": [ { "lt": 0.25, "profileId": "the-rock" }, { "lte": 0.5, "profileId": "the-strategist" }, { "lte": 0.75, "profileId": "the-dreamer" }, { "profileId": "the-free-spirit" } ]
  },
  "resultProfiles": [
    // subtitle / tagline / shareText are (refinements) for the reveal + share-dialog copy
    { "id": "the-rock", "title": "The Rock", "subtitle": "The Guardian", "description": "…", "tagline": "Rain or shine, my people are covered. 🛡️", "image": "result-the-rock.svg", "themeColor": "#0F9D58", "ctaLabel": "Get my free protection check", "shareText": "I'm The Rock 🛡️ — what's your Protection Personality?" }
    // … one entry per profile (4 total for this quiz)
  ],
  "media": { "basePath": "/uploads/quiz/<campaignId>/" }
}
```

**Field notes**
- **Required:** `enabled`, `quizId`, `version`, each `question.{id,prompt,type}`, `scoring.method`, each `resultProfiles[].{id,title}`.
- **Refinements (all optional, default-safe):** `question.weight` (default 1); `option.tag` (lead-intel → agent angle + lead score); `scoring.profileOrder` + `scoring.tiebreak` (deterministic ties — `prepared-first` flatters/drives shares, `gap-first` motivates conversion); `scoring.readiness` (the 0–100% meter; inverse = gap %); `scoring.leadScore` (Hot/Warm/Cool agent prioritisation from tags); a `reveal` block (always-show-gap, rarity stat, value-exchange form copy, compliance disclaimer); `resultProfiles[].{subtitle,tagline,shareText,agentAngle}`. The authoritative, current refinement list lives in [`docs/quiz-protection-personality.md`](docs/quiz-protection-personality.md) §8.
- **`profile-sum`**: `total[p] += question.weight × option.scores[p]` summed over chosen options; pick max; resolve ties via `profileOrder`/`tiebreak`. (Validated distribution + tie-rate for the Protection Personality quiz are in the content doc.)
- **`numeric-gap`**: bucket numeric answers, evaluate `formula.expr` over a whitelisted, sandboxed expression (no `eval` — a tiny safe evaluator over named inputs), then map to a `band → profileId`. Reproduces the GE model exactly.

Quiz images upload through the existing `uploadService`/`/api/uploads` to `/uploads/quiz/<campaignId>/` (mirror how campaign hero media is handled).

---

## 6. Scoring engine (client + server)

- **Client** (`src/lib/quizScoring.js`): computes the result instantly for the reveal screen. Pure function `scoreQuiz(quizDef, answers) → { profileId, score, totals, readiness }`.
- **Server** (`backend/src/services/quizScoringService.js`): **re-computes** from the raw answers + the campaign's `design_config.quiz` at lead-create time and writes the authoritative `sourceMetadata.quiz.result` (marks `scoredBy:'server'`). This prevents client tampering and guarantees the agent/CRM sees a trustworthy profile — a reliability win over trusting the posted result.

The **canonical algorithm** — the single source of truth both implementations follow, including the weighted `profile-sum` and the `readiness` derivation — is specified in [`docs/quiz-protection-personality.md`](docs/quiz-protection-personality.md) §3. Keep client and server in lock-step via a **shared CI fixture set** (identical answers → identical result through both). The `numeric-gap` expression evaluator must be a **safe, whitelisted** evaluator (named inputs + `+ - * / ( )` only) — never `eval`/`Function`.

---

## 7. Lead creation & the assignment pipeline — "agents get leads identically"

This is the crux of your question. **No assignment code changes.** A quiz lead reaches agents through the exact mechanism current campaign web-leads use.

### 7.1 Submit payload (direct ad link → no QR)

`LeadCapture.jsx` resolves the campaign from `?campaign_id=` (`:99`); with no prior QR scan, `qrTagId` is absent and gets stripped from the body (`:205-210`). So the POST is `{ firstName, lastName, email, phone, campaignId, leadSource:'website', consent_*, eventId, fbp, fbc, eventSourceUrl, quizResult }`.

**Backend edit required (small but mandatory):** `schemas.prospectCreate` (`validation.js:128-169`) has **no `stripUnknown`**, so any unknown key → **400**. Whitelist the quiz payload:

```js
// validation.js, in prospectCreate:
quizResult: Joi.object({
  quizId: Joi.string().max(64),
  version: Joi.number().integer(),
  answers: Joi.array().items(Joi.object({ qid: Joi.string().max(64), value: Joi.any() })).max(50),
}).optional(),
```

Then in `prospectService.createProspect` (mirror the consent/CAPI merge at `:91-103`): re-score server-side and fold into `incoming.sourceMetadata.quiz`. **Do not** add a new DB column.

### 7.2 Assignment chain (unchanged — `systemAgent.resolveAssignedAgentId`, `systemAgent.js:76-162`)

For a direct ad link (campaignId, no qrTagId): self-assign and admin-override are skipped (anon user), QR steps are skipped (no qrTag), so it hits:

> **Step 4 — campaign round-robin via Lead Package pool** (`systemAgent.js:105-157`): finds all `LeadPackageAssignment` with `status:'active'` AND `leadsRemaining > 0` joined to a `LeadPackage` where `campaignId = <quiz campaign>`; dedupes to active `role:'agent'` users ordered by `createdAt`; rotates via the **per-campaign `RoundRobinCursor`** with an atomic `UPDATE … cursor = cursor + 1 RETURNING` and modulo-at-read (`:143-152`) — race-safe across instances.

Then `deductLeadCredit(agentId, 1, t)` inside the create transaction (FIFO across the agent's packages; does **not** block assignment, `leadCredits.js`). Two `ProspectActivity` rows are written, then the webhook + CAPI fire post-commit. **This is byte-for-byte the path a current campaign web-lead takes.**

### 7.3 What the admin configures per quiz campaign (the only "assignment" setup)

1. Create the **Quiz Campaign** (type `quiz`, `is_active`, `design_config.quiz`).
2. Create one or more **Lead Packages** with `campaignId = quiz campaign` and a `leadCount` quota (`AdminLeadPackages` → `POST /api/lead-packages`).
3. **Assign that package to each agent** who should receive quiz leads (`POST /api/lead-packages/assign`) → active `LeadPackageAssignment` with `leadsRemaining`.
4. Ensure each agent is `role:'agent'`, `isActive:true`, and has a **phone** (required for Lyfe delivery).

Those agents auto-form the round-robin pool. The per-campaign knobs are therefore **which agents hold an active package** (the pool) and **each agent's `leadsRemaining`** (their quota before they drop out of rotation). This is the canonical campaign-level routing mechanism — `CampaignAgentAssignment`/`assigned_agents` is **display-only and never consulted** during assignment (confirmed: not referenced by `systemAgent.js`/`prospectService.js`).

> The QR-tag round-robin (AgentGroup) path requires a `qrTagId`, which a direct ad link never carries — so it does not apply. Lead packages are the right and only campaign-keyed pool.

### 7.4 Reliability must-do — the System-Agent delivery gap

If **no** agent has an active package for the campaign, Step 5 routes to the **System Agent**, which has no phone → the `lead.created` webhook hits `receive-mktr-lead` and returns **422; the lead is silently lost** (MKTR TRACKER B1; `prospectService.js:366-378`, `receive-mktr-lead/index.ts:234-242`). **Pre-launch gate:** before flipping `is_active`, verify ≥1 active agent has `leadsRemaining > 0` on a package for the campaign. Add an admin warning banner on the quiz campaign if the pool is empty, and confirm `WEBHOOK_ENABLED='true'` in prod (`webhookService.js:73`).

---

## 8. Ad attribution & conversion tracking (IG + TikTok)

### 8.1 Meta / Instagram — **ready today**, small additive work

IG ads share Meta's pixel/CAPI. Existing infra (`src/lib/metaPixel.js`, `metaCapiService.js`, per-campaign `Campaign.metaPixelId`):
- `ViewContent` on page load (`LeadCapture.jsx:51-67`) and `Lead` on submit (`:218-231`), deduped Pixel↔CAPI via a shared `event_id` (`metaCapiService.js:65`).
- `fbclid → _fbc`, `_fbp` captured and posted into `sourceMetadata` (`metaPixel.js:54-81`); CAPI hashes `em`/`ph` only with `consent_contact===true`.

**Additive for the quiz funnel:**
- Fire `ViewContent` at **quiz start** (already ~equivalent on load) and add **`CompleteRegistration`** at the **result reveal** (the strongest mid-funnel optimization signal for paid social). Generalise `metaCapiService._buildPayload` (`:63`, currently hardcoded `event_name:'Lead'`) to accept an `event_name` and add a CAPI variant for `CompleteRegistration`.
- Keep the final `Lead` on form submit (existing).

### 8.2 TikTok — **100% net-new** (the single biggest scope item)

**You can run TikTok ads on day one regardless** — TikTok just sends clicks to the same quiz URL; nothing blocks the media buy. What's missing is *conversion tracking back to TikTok* (so its algorithm optimises for leads instead of blind clicks, and ROAS is measurable). The build splits into two tiers: a **client pixel** (cheap, browser-side — ships in the MVP, Phase 5) and the **server-side Events API** (match-quality + `ttclid` resilience — fast-follow, Phase 6). A repo-wide search found **zero** TikTok code (`tiktok`/`ttclid`/`ttq`/Events API). Full from-scratch list:
1. **TikTok Pixel** (`ttq`) loader in `index.html` (parallel to the `fbevents.js` block), gated on a new `VITE_TIKTOK_PIXEL_ID`.
2. **`ttclid` capture** (`captureTtclidFromUrl`) + `_ttp` cookie read (mirror `captureFbcFromUrl`, `metaPixel.js:54-66`), persisted into `sourceMetadata`.
3. **Client events** `src/lib/tiktokPixel.js`: `ViewContent` (load), `CompleteRegistration` (reveal), `SubmitForm`/`Lead` (submit) via `ttq.track(...)` with a stable `event_id`.
4. **TikTok Events API** `backend/src/services/tiktokEventsService.js` mirroring `metaCapiService.js`: POST to `business-api.tiktok.com/open_api/.../event/track/` with SHA-256-hashed email/phone/external_id (reuse `utils/piiHashing.js`), `ttclid`/`ttp`, ip, ua, the dedup `event_id`, access token.
5. **Per-campaign config**: add `Campaign.tiktokPixelId` (migration, mirror `meta_pixel_id` at `Campaign.js:158`).
6. **Wiring + guard**: call the TikTok sender from `prospectService.js:395` alongside `sendLeadEvent`; thread `ttclid`/`ttp` through `prospectController` meta context; add `shouldFireTikTok` (mirror `shouldFireCapi`) honoring consent + excluding Retell/Meta-origin leads.
7. **Env**: `VITE_TIKTOK_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_EVENTS_API_ENABLED`, optional `TIKTOK_TEST_EVENT_CODE`. **Meta domain + TikTok domain verification** on `redeem.sg` (Meta TXT already present per CLAUDE.md; add TikTok's).

### 8.3 UTM capture (currently dropped — fix for campaign reporting)

`utm_*` are not captured in the live path (`SessionVisit` model exists but is unwritten; `prospectCreate` rejects unknown keys → 400). For ad reporting, **whitelist `utm_source/medium/campaign/content/term` in `prospectCreate`** and store them in `sourceMetadata.utm` (server-merged). Small, high-value for attributing spend per ad set.

---

## 9. Webhook delivery to lyfe-app — no changes

`buildLeadCreatedPayload` includes `sourceMetadata` verbatim (`prospectHelpers.js:57`), so `sourceMetadata.quiz` rides to Lyfe automatically. `receive-mktr-lead` never inspects `sourceMetadata` beyond a sentiment note, so extra quiz fields can't break it (`index.ts`). Delivery, HMAC, retry (1s/4s/16s), DLQ, and the `leads`/`lead_activities`/`notifications` inserts (→ Expo push) are unchanged. **Optional enhancement (Lyfe side, separate repo):** surface the quiz profile in the mobile lead card by reading `lead.sourceMetadata.quiz.result.title` — a one-line read, no schema change.

---

## 10. Admin dashboard — where & how to display it

All admin UI is mktr.sg-only automatically (ProtectedRoute → MktrOnlyRedirect on the redeem build). Mirror existing patterns exactly.

### 10.1 Campaign creation & type
- `CampaignTypeSelectionDialog.jsx` (currently 2 cards: PHV/`brand_awareness`, Regular/`lead_generation`): **add a "Quiz" card** → `navigate('/admin/campaigns/new?type=quiz')`.
- `AdminCampaigns.jsx`: add a `quiz` branch to the hardcoded type column/icon (`:209-212,256-260`); the row "Design" action already deep-links to `/AdminCampaignDesigner?campaign_id=…`.

### 10.2 Quiz builder — a new "Quiz" tab in the Designer
- `DesignEditor.jsx` TABS (`:37-41`) currently `content/design/layout`. Add **`quiz`** → new `src/components/campaigns/editor/QuizPanel.jsx` that edits `currentDesign.quiz` via the existing `onDesignChange('quiz', …)` mechanism (`:94-97`) and saves through the unchanged `handleSave → Campaign.update({ design_config })` path (`AdminCampaignDesigner.jsx:20-38`). **No backend change to save.**
- QuizPanel features: add/reorder steps & questions, choose question type, define options (+ image upload + per-profile scores), define result profiles, pick `scoring.method`, and a **live preview** (the in-editor `PreviewFrame.jsx` already composes `{...campaign, design_config: currentDesign}` so the quiz renders as you edit, honoring `previewMode`).

### 10.3 Nav
- `DashboardLayout.jsx` `getNavigationItems()` (`:39-106`) — add `{ title: 'Quiz Campaigns', url: '/AdminQuizCampaigns', icon: … }` (lucide import) to the **Lead Generation** section (`:47-55`), after "Campaigns". Optionally add a `Quiz Analytics` item. Optionally register in `CommandPalette.jsx` for ⌘K.
- Decide: a dedicated `/AdminQuizCampaigns` page (filtered campaign list `type=quiz`) **or** just rely on a filter on the existing `AdminCampaigns`. Recommendation: a thin dedicated page initially (clearer mental model for the operator), reusing `useCampaignsList` with a `type:'quiz'` filter.

### 10.4 Prospect detail — the quiz result card (admin **and** agent share this)
- `ProspectDetails.jsx` is rendered by both `AdminProspects` (full-page) and `MyProspects` (dialog). It already has a **source-specific card precedent**: the Retell recording/sentiment card (`:256-278`). **Add a "Quiz Result" card** that reads `details.sourceMetadata.quiz` and renders the profile (title/badge/score) + an expandable answers list, placed near the Campaign card (`:330-353`). One change → visible to **both** admin and agent.
- `AdminProspects.jsx`: add an optional **Quiz/Profile column** (`:224-283`) and to the CSV export (`:123`); map a `quiz`/`website` source in `src/utils/normalizeProspect.js`. Add `campaignId`-filter is already supported.

### 10.5 Quiz-funnel analytics view
- New endpoint `GET /api/campaigns/:id/quiz-analytics` (beside the existing `/:id/analytics`, `routes/campaigns.js:77`, gated `authenticateToken`): returns **starts, per-step completion/drop-off, completion rate, profile distribution, leads, conversion %, and (with UTM) per-ad-set CPL**. Expose as `CampaignEntity.getQuizAnalytics(id)` (mirror `getAnalytics`, `api/client.js:440-443`); render in the dedicated page or a Designer tab. Drop-off requires a lightweight **funnel-event log** (see §12).

---

## 11. Agent experience

Agents need nothing new structurally — quiz leads appear in `AgentDashboard`/`MyProspects` like any lead, scoped server-side (`prospectService.listProspects(req.user, …)`). The **Quiz Result card** added to the shared `ProspectDetails.jsx` (§10.4) automatically appears for agents, so an agent opens a lead already knowing the prospect's profile and answers — a materially better first-contact than a cold MKTR lead. Optionally add a quiz-profile badge to the Kanban card and a "quiz conversion" stat to `AgentDashboard`.

---

## 12. Analytics & funnel reporting

GE fired step + drop-off analytics; we should too. Two layers:
1. **Ad-platform** (Meta/TikTok): `ViewContent` (start) → `CompleteRegistration` (reveal) → `Lead` (submit) — drives ad optimization.
2. **First-party funnel log** (for the admin view): a lightweight `POST /api/quiz/events` (or extend the existing beacon/tracker) recording `{ campaignId, sessionId(sid cookie), step, event: 'start|step_view|step_answer|complete|submit', ts }`. Aggregate into starts/step-drop-off/completion/profile-distribution for `quiz-analytics`. Keep it fire-and-forget and rate-limited; reuse the `sid` cookie already set by the tracker so it stitches to the eventual prospect.

> Note: `BeaconEvent`/`Impression` models are **DOOH/tablet-screen** analytics, not web-funnel — do not overload them. Use a new small table or `sourceMetadata`/a dedicated `quiz_funnel_events` table if drop-off granularity matters.

---

## 13. Invariants to preserve (reliability)

1. **Funnel through `createProspect`** — never a bespoke insert; that's how a quiz lead inherits assignment, credits, activities, webhook, CAPI.
2. **Phone + OTP stays** as identity/dedup key (locked, `FieldRenderer.jsx:119-123`) unless you consciously change it (see Decision A).
3. **Per-campaign phone dedup (409)** and **age gate (422)** still apply — quiz UX must handle both states.
4. **Customer URLs via `redeem.sg` helpers** (`customerLeadCaptureUrl`, `customerPreviewUrl`) — never `window.location.origin` for shareable/admin-copied links.
5. **`previewMode` honored** by every new quiz component (no OTP, no prospect, no pixel — `metaPixel.js` already blocks `/p/*` & `is_test_data`).
6. **`is_active` (not `status`) gates the public page**; gate the quiz on `is_active && design_config.quiz.enabled`.
7. **Whitelist every new POST field** in `prospectCreate` (no `stripUnknown` → unknown = 400).
8. **`WEBHOOK_ENABLED='true'`** and a **non-empty agent pool** before launch (System-Agent 422 gap).
9. **Meta `event_id` dedup contract** preserved; any new event gets its own stable id.
10. **Brand bundle isolation** — admin/quiz-builder code lives behind ProtectedRoute (mktr-only), customer quiz UI is brand-neutral.

---

## 14. Implementation phases

| Phase | Scope | Touches | Rough effort |
|---|---|---|---|
| **0. Design sign-off** | Lock quiz topic/profiles, scoring method, OTP stance, TikTok now/later (see §15). Author the first quiz JSON + artwork. | docs/design | 1–2 d |
| **1. Quiz model + builder** | `type='quiz'` migration; `design_config.quiz` schema; `QuizPanel` tab in Designer; whitelist `quizResult`/`utm`/`sourceMetadata` in `prospectCreate`; server `quizScoringService`. | backend models/validation/services; `DesignEditor`, `QuizPanel` | 4–6 d |
| **2. Public quiz funnel** | `CampaignQuiz.jsx` state machine + result reveal; wire into `LeadCapture`; client `quizScoring`; `deriveLeadCaptureContent` quiz bits; previewMode; redeem routing; thread `quizResult` into submit. | `LeadCapture`, `CampaignQuiz`, `leadCaptureContent`, `public/Preview`, `PreviewFrame` | 5–8 d |
| **3. Assignment config + go-live** | Mostly **config**: lead package per campaign, assign agents, pre-launch pool check + admin warning banner; verify `WEBHOOK_ENABLED`. | tiny backend guard + admin banner | 1–2 d |
| **4. Admin visibility** | Quiz Result card in `ProspectDetails`; quiz column + CSV; `quiz-analytics` endpoint + view; funnel-event log; nav + type card. | `ProspectDetails`, `AdminProspects`, campaigns route/service, nav | 4–6 d |
| **5. Conversion events — Meta + TikTok client pixel** | Meta `CompleteRegistration` (pixel + CAPI) + quiz-start + UTM persistence; **TikTok client pixel** (`ttq` loader + `ViewContent`/`CompleteRegistration`/`Lead`) so TikTok optimises for leads from launch. | `metaPixel`, `metaCapiService`, `index.html`, `tiktokPixel`, validation | 3–5 d |
| **6. TikTok Events API (fast-follow)** | Server-side `ttclid` capture + Events API + per-campaign `tiktokPixelId` + wiring + `shouldFireTikTok` guard + TikTok domain verify (match-quality + cookie/iOS resilience). | `tiktokEventsService`, `Campaign`, `prospectService`, env | 4–6 d |
| **7. Incentives (optional)** | First-N voucher counter + lucky-draw eligibility + status on thank-you; reCAPTCHA if needed. | new module | 3–5 d |

Phases 1–4 = MVP funnel live on **IG** (reusing the existing Meta `Lead`/`ViewContent`). Phase 5 adds `CompleteRegistration` + the TikTok client pixel so **both IG and TikTok** optimise for conversions — this is the "run both platforms at launch" milestone. Phase 6 upgrades TikTok attribution accuracy via the server-side Events API. Phase 7 adds GE-style incentives.

---

## 15. Key decisions (LOCKED 2026-05-31)

**A. OTP — KEEP phone + OTP.** ✅ Reliable verified identity, per-campaign dedup, and guaranteed deliverability to the agent. We instrument drop-off at the OTP step in the funnel view (§12) and can A/B-test relaxing it later if conversion demands it.

**B. Platforms — run IG *and* TikTok from launch; sequence only TikTok's *conversion tracking*.** ✅ Media buying is not constrained — both platforms send clicks to the same quiz URL. What's sequenced is the code that reports conversions back for optimisation/ROAS: Meta/IG (pixel + CAPI) is ready now; the **lightweight TikTok client pixel** ships in the MVP (~1–2 d) so TikTok optimises for leads immediately; the **server-side TikTok Events API** (match-quality + cookie/iOS resilience via `ttclid`) lands as a fast-follow. See §8.2.

**C. Quiz result storage — `sourceMetadata.quiz`** (no migration). ✅ Add a JSONB GIN index only when SQL profile analytics is needed.

**D. First quiz — "Protection Personality"** (`profile-sum`). ✅ Shareable personas (e.g. "The Protector" … "YOLO Warrior") — the most social-friendly hook for IG/TikTok, mirroring GE's persona mechanic. `numeric-gap` stays available for a future "Coverage Gap %" variant on warmer traffic.

---

## 16. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Empty agent pool → System Agent → leads lost (422) | Pre-launch pool check + admin warning banner; alert if a quiz campaign is active with 0 assignable agents |
| `WEBHOOK_ENABLED` unset → silent pipeline failure | Assert at boot / health check; document in runbook |
| Unknown POST field → 400 | Whitelist every new field in `prospectCreate`; add a contract test |
| Client-tampered quiz result | Server re-scores from raw answers (`quizScoringService`); store `scoredBy:'server'` |
| OTP friction tanks conversion | Decision A; measure drop-off at the OTP step in the funnel view |
| Per-campaign phone dedup confuses re-takers | Route 409 to the existing "Already Registered" state; consider per-quiz "view your result again" without re-submitting |
| TikTok scope creep | Gate behind Phase 6; ship IG first |
| Preview leaks real OTP/prospect/pixel | Honor `previewMode` everywhere; pixel already blocks `/p/*` + `is_test_data` |
| redeem/mktr URL bleed | Use `customer*Url()` helpers exclusively for shareable links |

---

## 17. File-by-file change checklist (grounded)

**Backend**
- `backend/src/models/Campaign.js:25-28` — add `'quiz'` to `type` enum (+ migration). Optional `:158` add `tiktok_pixel_id` (Phase 6).
- `backend/src/middleware/validation.js:128-169` — whitelist `quizResult`, `utm_*` (and/or `sourceMetadata`) in `prospectCreate`. **Mandatory.**
- `backend/src/services/prospectService.js:91-103` — merge `quizResult`/`utm` into `sourceMetadata`; call server re-score. (`createProspect` assignment path unchanged.)
- `backend/src/services/quizScoringService.js` — **new**, server-side scorer.
- `backend/src/services/campaignPreviewService.js:27-35,88-89` — ensure `design_config` (with `.quiz`) in public + snapshot.
- `backend/src/routes/campaigns.js:~77` + controller/service — **new** `GET /:id/quiz-analytics`.
- `backend/src/routes/*` — **new** `POST /api/quiz/events` (funnel log) + tiny `bootstrap` agent-pool/`WEBHOOK_ENABLED` assertion.
- Phase 6: `backend/src/services/tiktokEventsService.js` (**new**), wire in `prospectService.js:395`, `prospectController.js:27-42` meta ctx.
- Phase 5: generalise `metaCapiService.js:63` `event_name`.

**Frontend**
- `src/components/campaigns/CampaignTypeSelectionDialog.jsx` — Quiz card.
- `src/pages/AdminCampaigns.jsx:209-212,256-260` — quiz type branch; create flow.
- `src/components/campaigns/DesignEditor.jsx:37-41` — `quiz` tab; **new** `editor/QuizPanel.jsx`.
- `src/components/campaigns/CampaignQuiz.jsx` — **new** quiz state machine (honors `previewMode`).
- `src/pages/LeadCapture.jsx:51-67,183-210,317-330` — quiz phase + thread `quizResult` + quiz pixel events.
- `src/components/campaigns/leadCaptureContent.js` — quiz content derivation.
- `src/pages/public/Preview.jsx`, `src/components/campaigns/editor/PreviewFrame.jsx` — quiz in preview.
- `src/lib/quizScoring.js` — **new** client scorer (lock-step with server).
- `src/components/prospects/ProspectDetails.jsx:256-278` pattern — Quiz Result card (admin+agent).
- `src/pages/AdminProspects.jsx:123,224-283`, `src/utils/normalizeProspect.js`, `src/constants/statusConfig.js` — quiz column/source/CSV.
- `src/pages/index.jsx` + `src/components/layout/DashboardLayout.jsx:47-55` — `/AdminQuizCampaigns` route + nav.
- `src/api/client.js`/`entities.js` + `src/hooks/queries/useQuizQuery.js` — quiz entity/analytics hooks.
- `src/lib/metaPixel.js` — `CompleteRegistration` + quiz-start.
- Phase 6: `index.html` (ttq), `src/lib/tiktokPixel.js`, `captureTtclidFromUrl`.

**DB migrations**: `campaigns.type` += `quiz`; (Phase 6) `campaigns.tiktok_pixel_id`; (opt) `prospects` GIN index on `sourceMetadata->quiz->profileId`; (opt) `quiz_funnel_events` table.

**Env**: confirm `WEBHOOK_ENABLED=true`, `META_*`; (Phase 6) `VITE_TIKTOK_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_EVENTS_API_ENABLED`.

---

## 18. Testing & rollout

- **Unit**: client vs server scorer parity (shared fixtures); `numeric-gap` band boundaries; safe expression evaluator.
- **Contract**: `prospectCreate` accepts `quizResult`/`utm` and still 400s true unknowns; quiz lead → correct round-robin agent; credit deducted; `lead.created` payload carries `sourceMetadata.quiz`.
- **E2E (Playwright)**: ad-link → quiz → reveal → OTP → submit → 201; 409 re-take path; previewMode no-OTP/no-prospect; redeem.sg routing.
- **Pipeline**: webhook delivered to `receive-mktr-lead`; Lyfe `leads`/`notification`/push; Meta CAPI `Lead` (test event code) + `CompleteRegistration`.
- **Pre-launch gate**: agent pool non-empty; `WEBHOOK_ENABLED=true`; pixel ids set per campaign; domain verifications live.
- **Rollout**: build on a branch → preview deploy → seed a test quiz campaign with `is_test_data` agents (excluded from pixel + prod listings) → verify end-to-end → assign real agents → flip `is_active` → start with a small IG ad budget → watch the funnel view + DLQ → scale.

---

*End of plan.*
