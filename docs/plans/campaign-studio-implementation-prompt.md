# Campaign Studio implementation — Claude Code session prompt

> **✅ COMPLETE (2026-07-18).** All PRs shipped and deploy-verified — PR 0
> #180, PR 1 #181, PR 2 #182 (+#183), PR 3 #185, PR 4 #187, PR 5 #192, and
> the follow-up teardown #194. The rollout executed: both flags flipped, all
> 12 non-archived campaigns migrated to design_config v2 (live-verified), and
> the teardown made the Studio the permanent design surface (frontend flag
> removed; `DESIGN_CONFIG_V2_WRITES_ENABLED` remains as the server emergency
> brake). This document is the build-history record; the operational doc is
> `docs/reference/campaign-studio-rollout.md`. The PR-sequencing rules below
> no longer bind anything.

Paste the block below into a NEW Claude Code session started in
`~/lyfe-master/mktr-platform`. Written 2026-07-17, after the claude.ai/design
engagement (5 phases + CO-1) was accepted. The design mock is the visual and
behavioral reference; production code is the behavioral ground truth; the
Phase 5 handoff is the schema contract.

---

Implement the **Campaign Studio revamp** — the accepted claude.ai/design
handoff — into this repo. This is a multi-PR build over the live lead-gen
funnel: work one PR at a time, and for every PR follow my standard loop:
**plan first (plan mode), stop for my approval + Codex review, then
implement.** Never start PR N+1 before PR N is merged or I say so.

## Sources of truth (ranked — when they disagree, higher wins)

1. **Production code in this repo** — for all funnel behavior, legal copy,
   endpoints, clamps. Key files: `src/pages/LeadCapture.jsx`,
   `src/components/campaigns/{LeadCaptureLayout,CampaignSignupForm,CampaignQuiz,leadCaptureContent}.jsx|js`,
   `src/components/campaigns/signup/*`, `src/components/campaigns/DesignEditor.jsx`
   + `editor/*`, `backend/src/services/campaignService.js` (clampDesignConfig),
   `backend/src/utils/{publicDesignConfig,featuredDrop,luckyDraw,marketplaceContent,customerHost}.js`,
   `backend/src/routes/adminAi.js` + `backend/src/services/guidedReviewAiService.js`
   (AI endpoint pattern), `backend/src/services/campaignReadinessService.js`,
   `src/lib/quizScoring.js` + `backend/src/services/quizScoringService.js`
   (twin-module + lock-step-test pattern to replicate).
2. **The Phase 5 handoff** in claude.ai/design project
   `2ec36e59-ff41-443f-bffa-0364cd433857` (read via the DesignSync tool):
   `Phase 5 - Handoff.dc.html` = design_config v2 schema (every key, limits,
   defaults, PROPOSED flags), lossless+reversible v1→v2 migration table,
   parity checklist, production quiz-scoring math, AI contract, analytics
   taxonomy.
3. **The mock files** (same project): `Campaign Studio.dc.html` (editor incl.
   CO-1 AI art-director flow), `Campaign Page.dc.html` (all 6 templates),
   `Lead Form.dc.html`, `Quiz Flow.dc.html`, `Funnel.dc.html`,
   `studio-data.js` (theme presets incl. exact production Warm Cream tokens,
   RADII + preset `rx` override, jumper catalog with availability reasons,
   verbatim legal constants, mock API shapes). **Reference only — port the
   semantics, never copy the `.dc.html`/DCLogic code.** Where a mock detail
   contradicts production legal copy or funnel behavior, production wins.
4. `docs/plans/campaign-designer-redesign-claude-design-prompt.md` — its
   appendix lists 9 pre-existing live bugs (fix in PR 0).

## Non-negotiable contracts

- **Funnel contract is immutable**: quiz → SG/PR gate → advisor gate →
  fields → OTP → DNC gate → 3 consents (contact default-ticked opt-out;
  T&C required; third-party opt-in) → submit outcomes (201 success + share,
  409 duplicate w/ 5s countdown, 410 inactive, draw-closed, error). All
  existing endpoints unchanged: `/api/verify/send|check`, `/api/dnc/check`,
  `POST /api/prospects` payload shape, uploads.
- **Analytics taxonomy unchanged**: ViewContent once/session/campaign on
  mount; CompleteRegistration on persona-quiz reveal only; Lead only on 201.
  Shared event IDs, suppression rules, per-campaign pixel overrides as today.
- **Legal copy comes from production components/constants — never retype,
  never take from the mock.**
- **Editorial parity**: a migrated v1 campaign (Editorial + Warm Cream) must
  have a resting page visually indistinguishable from today's at 390 and
  1280 (screenshot-diff gate). Interactive widgets (OTP panel etc.) may
  follow the new design system; behavior stays contract-identical.
- **Full-document round-trip**: the Studio seeds every key on load and PUTs
  the whole doc; unknown/future keys pass through untouched; admin-only
  subtrees preserved server-side on non-admin saves (existing
  `applyFeaturedDropPolicy` / `applyLuckyDrawPolicy` / `applyMarketplacePolicy`
  pattern, applied at their v2 paths).
- **Slug stays a campaign column** (own save path + availability check +
  permanent lock) — never in the doc.
- Repo discipline: shared checkout (explicit-path `git add` only, feature
  branches via worktrees, verify branch in the commit command); DB safety
  rules in CLAUDE.md; push ≠ live (verify Render deploys per CLAUDE.md);
  CI has 5 chronically-red pre-existing suites — don't chase them.

## Cutover strategy (decided — build to this)

- `design_config.version === 2` is the renderer switch: v1 docs render
  through the EXISTING components untouched; v2 docs render through the new
  template renderer. A campaign upgrades in memory when opened in the new
  Studio and becomes v2 only when first SAVED there. Rollback per campaign =
  the pure `downgrade()` function (Editorial+WarmCream reproduces the v1
  contract; PROPOSED keys drop).
- The Studio ships behind `VITE_CAMPAIGN_STUDIO_ENABLED` (flag pattern:
  module-scope `import.meta.env.X === 'true'`), replacing the workspace
  Design tab when on. The old DesignEditor stays routable while dark, and
  gets a guard: a `version:2` doc renders a read-only "open in Studio"
  notice instead of the old panels (it would destroy v2 docs).

## PR sequence

**PR 0 — live-bug fixes (ship first, independent of the revamp).**
From the prompt-doc appendix: heroFont + featuredDrop wiped by DesignEditor
saves (seed them in initial state); email "(optional)" affordance removed
(email is backend-required); dead OTP 429 branch (`err.response?.status` →
`err.status` in CampaignSignupForm); honest video-size copy (read
env/`MAX_UPLOAD_SIZE_MB`, stop hardcoding "60MB"); DncConsentGate advertiser
default = campaign name (thread `campaign.name`, stop rendering literal
"{Advertiser}"). Note in the PR that education/salary semantics, readiness
visibility, and save-first preview get structural fixes in the revamp.

**PR 1 — design_config v2 core (no visual change).**
Twin modules `src/lib/designConfigV2.js` + `backend/src/utils/designConfigV2.js`
(mirroring the quizScoring twin pattern, with a lock-step vitest that imports
both): schema constants (templates, presets w/ exact Warm Cream production
tokens + `rx` radii override, fonts, limits — take values from
`studio-data.js` after re-verifying Warm Cream against `LeadCaptureLayout`
TOKENS), `upgradeDesignConfig(v1|v2)→v2` implementing the handoff migration
table exactly (incl. education/salary absent→visible:false data-honest rule,
YouTube-from-videoUrl derivation, legacy fieldOrder rows→`fields[].row`),
`downgradeDesignConfig(v2)→v1`, `resolveTheme`, field normalization. Backend:
version-aware `clampDesignConfig` (v2 docs get v2 clamps at v2 paths; v1
behavior byte-identical to today), `buildPublicDesignConfig` v2 whitelist
(strip `ai.brief` + luckyDraw internals), keep legacy in-doc `customerHost`
in sync with `distribution.host` on save. Fixtures: real-shaped v1 docs
covering every migration row; round-trip property test
(`upgrade(downgrade(x)) ≡ x` over the editorial baseline).

**PR 2 — v2 campaign page renderer.**
New `src/components/campaignPage/` renderer:
`render(doc, campaignFacts, previewMode)` dispatching the 6 templates
(Editorial, Poster, Split, Spotlight, Express, Journey) per the mock, funnel
components (gates → quiz → form → outcomes incl. share/referral/duplicate
countdown) calling the SAME production endpoints and emitting the same
payloads/pixels as the current form (reuse `signup/dateUtils`,
phone/DOB/postal rules, consent constants imported from the existing
components). `previewMode` = stubbed network (any 6-digit OTP verifies,
submit short-circuits, pixels suppressed) + `jump` state forcing per the
jumper catalog in `studio-data.js`. Wire version dispatch into
`LeadCapture.jsx` and `/p/:slug`. Gate: screenshot parity for
Editorial+WarmCream vs production (use the repo `verify` skill), plus
vitest coverage for gate order, outcome states, and analytics moments.

**PR 3 — the Studio editor.** *(BUILT 2026-07-17 on `feat/campaign-studio` —
7 checkpoints; ships dark behind `VITE_CAMPAIGN_STUDIO_ENABLED` with the
backend write gate still off. Deltas from this spec, per the Codex-reviewed
plan: readiness pill MERGES the existing server readiness endpoint with the
client doc checks; no `marketplace.endsAt` input (the v2 clamp drops the key —
schema/whitelist inconsistency deferred to PR 5); draw-terms 422s are
classified client-side by message (server codes deferred to PR 5); browser
Back is guarded via a popstate sentinel; the jumper catalog is 21 states (the
mock's "22" was a miscount).)*
`/admin/campaigns/:id/studio` (or workspace-tab takeover) behind
`VITE_CAMPAIGN_STUDIO_ENABLED`: top bar (campaign switcher, status/draw/
readiness chips, Copy link + Share preview with "Save first?" guards, save
cluster w/ ⌘S, "Saved · live on {host}" honesty), rail sections
Page/Form/Quiz/Theme/Distribution per the mock (every parity-checklist knob
— zero rows dropped), canvas with true-viewport iframe device preview
(390/1280; own React mount so `@media` fires and Radix portals stay
contained), three subjects (campaign page / featured-drop tile / marketplace
card + gate checklist + draw-date mismatch warning), funnel-state jumper
with disabled-reasons, JSON view (read-only, admin-badged), readiness chip
deep-linking (quiz-disabled, draw-terms invariant mirrored client-side, hero
CTA w/o media, WhatsApp creds, contrast failure, checklist incomplete, drop
date past), beforeunload + in-app dirty guards. Slug editing via the
existing endpoints (`GET /campaigns/slug-availability`, `PUT /campaigns/:id`).

**PR 4 — AI endpoint + panel (CO-1 contract, embedded here because the
handoff §05 amendment is still pending on the design side):**
`POST /api/admin/ai/copy-draft` following the guidedReviewAiService pattern
(admin-only, `aiGenerationLimiter` 10/min, provider from aiSettingsService,
provider-side json_schema structured output, 45s timeout, 429 →
`{retryAfterSec}`):
request `{campaignId, templateId, mode:'copy'|'full', scope?:path,
regen:int, brief:{topic, audience, objective, mustInclude, tone}}`;
response `mode:'copy'` → `{draft:[{path,label,section,value}]}`;
`mode:'full'` → `{proposals:[≤3 × {name, rationale, draft:[...]}]}` in ONE
budget call. **AI-writable path whitelist** (server-enforced; anything else
dropped): copy = headline, subheadline, story, emphasis, submitLabel,
heroCtaLabel (when media), quiz.intro.* (when quiz), featuredDrop.title
(when enabled), marketplace.valueLine (when listed),
params.express.trustLine (Express); design (`full` only) = template.id,
template.params.*, theme.preset/font/radius/background, theme.accent
(server re-runs the contrast check, falls back to preset accent), plus a
media art-direction NOTE (`{kind, note}` — never an asset/URL). Never
writable: consents, terms, footers, advertiserName, form fields/required,
gates, verification, distribution settings, luckyDraw. Constraints:
Spotlight only when quiz enabled; host-biased preset defaults; Singapore
English; values pre-clamped to limits. Studio panel per the mock: two
intents ("Write the copy" / "Design the whole page"), budget meter,
skeletons, 429 countdown, error retry; copy review = per-field old→new
accept / keep-mine / scoped-regenerate + apply-all; full mode = looks
gallery live-rendered via the real renderer, "Use this look" → uncommitted
proposal + keep-my-template/theme/copy toggles + Adopt + top-bar
"↩ Revert look" until save; media suggestion chip on the Hero control.

> **Amendment 2026-07-18 — AI full coverage** (scope + rationale:
> `docs/plans/studio-ai-full-coverage-plan.md`): copy mode now fills EVERY
> fillable Studio slot in one call — widened string whitelist (26 paths;
> drop/marketplace copy draftable BEFORE its publication switch is on),
> marketplace enum PICKS (category/offerType/mode/qrLanding, values imported
> from marketplaceContent.js), the inclusions LIST, and advisory
> RECOMMENDATIONS for the publication decisions (listing/drop switches, host,
> slug — grounded in the 7-key gate; never auto-applied, never in apply-all;
> slug is prefill-only). Looks stay page-scoped. Still never writable:
> consents, terms, regulatory footer, form fields/gates/verification,
> luckyDraw, media sources, the publication switches themselves.

**PR 5 — readiness additions + rollout.**
Extend `campaignReadinessService` with the Studio checks that are
server-verifiable; docs updates (CLAUDE.md pointer + docs/reference note);
flag-flip checklist: enable Studio for admins → migrate one low-stakes
campaign → screenshot-diff → soak → migrate the rest → retire old
DesignEditor + `/AdminCampaignDesigner` route in a follow-up teardown PR.

## Out of scope — do not touch

Guided-review designer (`campaign.type === 'guided_review'` keeps its own
editor), lucky-draw editing (read-only surfaces only), marketplace consumer
pages, confirmation-email templates, edge functions/webhooks, Retell,
fleet/devices (retired).

## Working style

Read `project_campaign_studio_revamp` memory + the prompt doc appendix
before planning. Fetch the design files via DesignSync as needed (project
`2ec36e59-ff41-443f-bffa-0364cd433857`). Run backend tests from `backend/`
(jest, sandbox off, `JWT_SECRET` inline; local-Postgres suites fail on
ECONNREFUSED — expected), frontend via `npm test` (vitest). Verify UI
changes with the repo `verify` skill (Playwright, both brands). Start with
PR 0's plan.

---

## Notes for Shawn (not part of the prompt)

- Pending on the design side, non-blocking: the §05/§08 handoff amendment
  for CO-1 (the contract above is authoritative in the meantime) and the
  designer's per-campaign QA walk at 390.
- The prompt fixes two judgment calls made during this session: (1)
  version-driven renderer cutover instead of a global flag; (2) "parity"
  scoped to the resting page, with interactive widgets allowed to follow the
  new design system while preserving behavior.
