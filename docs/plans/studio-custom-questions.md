# Studio custom questions — owner-authored questions in the profile block

**Status:** v5 — **APPROVED, Codex round 5 (gpt-5.6-sol xhigh,
2026-08-18)** ("the explicit-snapshot design closes the sole Round 4
defect… internally consistent and implementable as written"). Convergence
16 → 10 → 3 → 1 → APPROVE; logs §11–§13; load-bearing claims re-verified
in code every round (zero Codex claims refuted across all five).
**READY TO BUILD** pending Shawn's §10 calls (free-text in v1; caps;
agent-visibility follow-up; CSV; marketplace door).
**Author:** Claude, 2026-08-18
**Parent:** `docs/plans/studio-profile-questions.md` (the PR 0 collection
block — LIVE; this plan extends its subtree and reuses its §5.4 wire
contract where stated)

## 1. Why and what

The profile-questions block is pick-only: a fixed 5-question library,
"admins pick, never author" (`profileQuestionLibrary.js` header). That rule
exists to protect the **deterministic fact ledger** — free-authored
questions can't map to taxonomy keys. It was never a rule about display.

Shawn wants campaign-specific questions at the bottom of the signup form,
right before submit ("which showroom is closer to you?"-class intel). This
plan adds **`profileQuestions.custom[]`** — owner-authored questions that
render in the SAME block (after the library questions, before consent/CTA,
i.e. exactly the requested position) and whose answers are
**display-only**:

- frozen onto the prospect (`sourceMetadata.customAnswers`),
- shown on the admin Lead Profile,
- carried in webhook payloads (already true for all of `sourceMetadata`,
  §7),
- and **NEVER** entering the consumer-observation ledger, taxonomy, map
  jobs, or Meet×Buy scoring. The library keeps that job exclusively. The
  library-header rule is preserved as: *custom answers never mint facts.*

Product rules carried over: per-campaign selection is the owner's
conversion-vs-data call; the AI flows never AUTHOR or ENABLE profile
questions — and §5b now also makes look apply/revert carry the live
subtree forward so an AI interaction can never destroy question edits.

**Scope boundary (R1 #1):** the marketplace door
(`MarketplaceFlow.jsx`) has NEVER asked profile questions — it runs its
own step machine with fixed fields and posts no `profileAnswers`, and its
public config is rebuilt from the v1-downgraded view
(`marketplaceService.js` `buildPublicDesignConfig`), which excludes
`profileQuestions` (a `V2_TOP_KEY` skipped by `toLegacy`'s passthrough).
Custom questions keep that exact parity: marketplace-door leads simply
carry no `customAnswers`, the same way they carry no library answers
today. Extending the marketplace flow is a possible later arc (§10), not
this PR — and a parity test pins it.

## 2. Config shape — the `profileQuestions` subtree grows one key

```
profileQuestions: {
  enabled: boolean,            // unchanged
  questionIds: string[],       // THE single order+membership authority — library ∪ custom ids
  requiredIds: string[],       // unchanged mechanism — ⊆ questionIds, custom ids allowed
  showZh: boolean,             // unchanged — governs custom promptZh/labelZh too
  custom: [                    // NEW: definitions ONLY (unordered set, unique ids)
    {
      id: 'c_<rand>',          // /^c_[a-z0-9]{4,12}$/ — prefix-disjoint from every
                               // library id AND matches the §6 Joi key pattern
      type: 'single' | 'multi' | 'text',
      prompt: string,          // ≤ 140, non-empty after sanitize
      promptZh?: string,       // ≤ 140, optional
      options: [               // select types: 2–MAX_CUSTOM_OPTIONS valid rows;
                               // type 'text': forced []
        { id: string,          // /^[a-z0-9_]{1,24}$/, UNIQUE within the question
          label: string,       // ≤ 48, non-empty after sanitize (else row dropped)
          labelZh?: string },  // ≤ 48, optional
      ],
    },
  ],
}
```

**One ordering authority (R1 #3).** `questionIds` stays what every
consumer already treats it as — ordered membership (clamp preserves input
order; public projection copies it; the renderer and `scoreSubmission`
iterate it). `custom[]` holds definitions only; it carries NO ordering
semantics. There are no server-side drafts: the clamp keeps only defs
referenced by the final `questionIds` (§3 — ordered so an unreferenced
def can never cost a referenced one, R2 closure #3), and the panel never
writes one (§4). Freeze order (§6), render order (§5), and panel order
(§4) are all reads of `questionIds`.

Caps and patterns are named constants in the **designConfigV2 twins**
(`src/lib/designConfigV2.js` ↔ `backend/src/utils/designConfigV2.js`):
`MAX_CUSTOM_QUESTIONS = 5`, `MAX_TOTAL_PROFILE_QUESTIONS = 10`,
`MAX_CUSTOM_OPTIONS = 8` (R2 new #3 — aligned with the existing Joi
array bound `.max(8)`), `CUSTOM_QUESTION_ID_RE`, `CUSTOM_OPTION_ID_RE`,
the length caps, `CUSTOM_ANSWER_TEXT_MAX = 200`, and a shared
**`sanitizeQuestionText(v, max)`** (trim + strip C0/C1 control chars and
bidi-override codepoints + length cap — the clamp's existing
`cleanString` only slices, R1 #15).
`MAX_PROFILE_QUESTIONS` (5) keeps its current meaning: the library cap.

**Twin discipline, stated precisely (R1 #11, R2 closure #11):** the
designConfigV2 twins are NOT byte-parity files — they are kept in
lockstep by `designConfigV2.lockstep.test.js`: new **constants/regex
sources** join `CONSTANT_EXPORTS` (structural equality);
`sanitizeQuestionText` is a FUNCTION and joins **`FUNCTION_EXPORTS`**
(the suite's existing function-parity mechanism) with behavioral parity
fixtures (same hostile inputs → same outputs on both imports). Byte
identity applies to `profileQuestionLibrary` only. `V2_TOP_KEYS` is
unchanged (`custom` is nested), so upgrade-preservation carries the
subtree; the lockstep/upgrade fixtures gain a `custom` doc to prove it.

## 3. Three config surfaces, in lockstep (mirrors parent §3)

1. **Twins:** constants + `sanitizeQuestionText` above; no new top-level
   key.
2. **Clamp** (`designConfigV2Clamp.js` `clampProfileQuestions`), extended
   in this order, sanitize-never-reject — **ordered so referenced defs
   can never lose the cap to unreferenced ones (R2 closure #3):**
   1. **Validity-sanitize `custom[]` WITHOUT a count cap:** non-object
      rows dropped; id must match `CUSTOM_QUESTION_ID_RE`, be unique
      among custom ids, and not equal any library id (the `c_` prefix
      guarantees this; the clamp checks anyway); `type` outside the enum
      ⇒ row dropped; `prompt` empty after `sanitizeQuestionText` ⇒ row
      dropped; option rows sanitized (id pattern + uniqueness within the
      question, label non-empty after sanitize — invalid rows dropped),
      then capped at `MAX_CUSTOM_OPTIONS` (surviving rows beyond 8
      dropped, R2 new #3); select types with < 2 surviving options ⇒ row
      dropped; `text` rows get `options` forced to `[]`. Result: a
      validity map, NOT yet the stored array.
   2. **Build `questionIds`:** iterate the raw ids; keep library ids and
      custom ids present in the validity map; custom acceptances capped
      at `MAX_CUSTOM_QUESTIONS` during selection; order preserved,
      deduped, total capped at `MAX_TOTAL_PROFILE_QUESTIONS`.
   3. **Store `custom` = validity-map defs referenced by the final
      `questionIds`**, in their original array order. Unreferenced defs
      are dropped (no server-side drafts) and — by construction — never
      consumed the cap.
   4. `requiredIds ⊆ questionIds` (unchanged rule, now admits custom
      ids).
   5. `enabled` requires ≥ 1 valid id in `questionIds` (unchanged — a
      campaign with only custom questions is fully valid).
3. **Public projection** (`publicDesignConfig.js`): the existing
   `profileQuestions` leaf-pick gains `custom`, leaf-picked to exactly
   `{id, type, prompt, promptZh?, options: [{id, label, labelZh?}]}` —
   nothing else. Membership is already guaranteed by the clamp (defs ⊆
   questionIds), and the projection re-filters defensively. Disabled ⇒
   absent ⇒ funnel renders nothing (unchanged).

## 4. Studio FormPanel — the authoring card

**One mutation door (R1 #2), with a real contract (R2 new #4).** Today's
FormPanel mutation sites each rebuild the subtree lossily — the master
toggle writes only `{enabled, questionIds}` (dropping
`requiredIds`/`showZh`, a pre-existing loss this plan fixes), and the
brief-suggestion add, library ticks, and required toggles rebuild ids
from `PROFILE_QUESTION_IDS` alone (`FormPanel.jsx:216/:44/:275/:293`) —
any of which would silently delete `custom`. Fix: a single
`mutatePQ(mut, fn)` helper owning the subtree write, defined as an
**atomic transformation inside one `mut((d) => …)` draft** (never spread
across renders or stale closures):

- **Decompose** the draft's current subtree into `{enabled,
  libraryPicks, defsById, customOrder, requiredIds, showZh}` —
  reconciling on read: `customOrder` deduped and intersected with
  `defsById` keys; defs never in `customOrder` appended at the end (a
  hand-edited doc must not lose data on first touch).
- Apply `fn` to that normalized value.
- **Reconstruct and write**: `questionIds = [library picks in canonical
  library order, …customOrder]`; `custom` emitted ONLY for ids in
  `customOrder`, in that order; `requiredIds` filtered to membership;
  `showZh`/`enabled` carried. Idempotent: `mutatePQ(mut, x => x)` is a
  no-op on already-normalized state.
- EVERY mutation site (master toggle, brief-suggestion add, library
  tick, required toggles, all custom authoring) is rewritten through it;
  tests cover per-site preservation, mismatched
  `custom`-vs-`questionIds` input, and back-to-back mutations.

**Editor-local drafts with a durable owner (R1 #4, R2 new #1).** The
clamp drops incomplete rows and Studio adopts the clamped save response
(`useStudioDoc.js:173`), so a half-typed question written to the doc
would vanish on Save — drafts therefore never touch the doc. And because
the rail unmounts non-active panels (`AdminCampaignStudio.jsx` renders
one panel at a time) and the dirty guard watches only doc + slug,
component-local state would silently die on a rail switch. Contract:

- Draft state (at most ONE open draft) lives in the **Studio page**
  beside the doc, keyed by campaign id, passed into FormPanel — it
  survives rail switches and save-response adoption (it is not part of
  the doc).
- `draftDirty` joins the existing dirty computation, so navigation/
  campaign-switch guards fire for an uncommitted draft too — **including
  the guard's "Save & continue" primary action (R3 residual):** that
  branch saves the doc and then executes the parked navigation, and a
  draft lives OUTSIDE the doc, so without special handling "Save" would
  still destroy it. Contract: when `draftDirty`, Save-and-continue first
  COMMITS a complete draft and then saves; if the draft is incomplete,
  that path is blocked (button disabled with an inline reason) until the
  user completes it or explicitly chooses Discard.
  **Commit-then-save must be snapshot-explicit (R4):** `mut()` schedules
  `setDoc` while `save()` PUTs the doc captured by the CURRENT render
  (`useStudioDoc.js` — `const snapshot = doc`), so "mutatePQ then
  save()" would PUT the pre-commit doc and navigate, losing the question
  anyway. Fix: `save(extra, { snapshot })` gains an optional explicit
  doc snapshot (precedent: `extra` already merges the guard's pending
  slug draft into the same PUT). The guard handler computes the
  post-commit doc SYNCHRONOUSLY (pure `mutatePQ` transform of the
  current doc), passes the SAME object reference to `setDoc` (no clone)
  and to `save` as the snapshot — so the PUT body is the committed doc
  by construction and the existing in-flight-edit adoption comparison
  (`prev === snapshot`) still holds. Both guard buttons are tested with
  complete and incomplete drafts, and the Save-and-continue test asserts
  the `Campaign.update` payload contains the new def + question id
  BEFORE the parked navigation runs.
- *Add question* is disabled while a draft is open (one at a time) AND
  at the cap — `customOrder.length >= MAX_CUSTOM_QUESTIONS` (R3 new #1:
  a hint alone lets a sixth question be authored and then silently
  clamped away on save); commit re-checks the cap as the belt. Test: a
  sixth question can never enter the doc.
- **Completeness uses the server's own sanitizer (R2 closure #4):** the
  draft commits only when `sanitizeQuestionText(prompt)` is non-empty
  and (select types) ≥ 2 options have non-empty sanitized labels — and
  the commit writes the SANITIZED values, so panel-authored content is
  clamp-stable by construction (a control-char-only prompt can never
  commit, then vanish).
- Commit writes the def AND appends its id to `questionIds` atomically
  (one `mutatePQ` call). Editing an existing question writes through
  ONLY while it remains complete; an incomplete edit state stays local
  with an inline "incomplete — not saved" badge and the last complete
  value stays in the doc.
- Tests: rail switch away/back keeps the draft; save-response adoption
  keeps it; campaign switch guards it; second Add disabled; incomplete
  edit never reaches the doc.

Panel specifics, inside the existing PROFILE QUESTIONS `PanelSection`,
visible when `enabled === true`, below the library tick-list:

- Per-question editor: prompt, optional 中文 prompt, type select, options
  editor (add/remove/edit; ids auto-allocated as the first unused `oN`;
  *Add option* disabled at `MAX_CUSTOM_OPTIONS`), a **Required** toggle
  writing the shared `requiredIds`, delete, and **↑/↓ reorder** (moves
  the id within the custom segment of `questionIds`, reusing the
  FIELDS-list arrow affordance).
- **Membership model:** an authored custom question is always asked —
  commit adds its id to `questionIds`; delete removes the def and its id
  from `questionIds` + `requiredIds`. No tick state for custom; the
  library keeps its tick model.
- **Placement:** the panel writes library picks first (canonical order,
  as today), custom ids after — so custom questions render at the BOTTOM
  of the block, immediately before consent + submit, and ↑/↓ arranges
  them among themselves. (Direct-JSON interleaving is tolerated by the
  clamp — order is honored verbatim; the panel just never produces it.)
- `genId()`: `'c_' + <random base36, 6 chars>`, regenerated on collision
  with any existing id — matches `CUSTOM_QUESTION_ID_RE` and the §6 Joi
  key pattern by construction.
- Click-to-edit: the existing `'profileQuestions'` target
  (`studioEditTargets.js:46`, section `form`) already lands on this card —
  no new target.

## 5. Funnel rendering (owners per parent §6)

- **`funnelAdapter.js`**: the `profileQuestions` prop it builds gains
  `custom: doc.profileQuestions.custom` (already leaf-picked upstream).
  This door serves the standard lead-capture funnel; the marketplace door
  is out of scope by §1.
- **`CampaignSignupForm.jsx`** — one normalized resolver (R1 #5): library
  defs expose `multi: boolean` while custom defs expose `type`; the
  existing render loop and required-submit gate both branch on `q.multi`
  (`CampaignSignupForm.jsx:986/:318`), and the gate resolves from the
  library only — a required custom id would be silently skipped today.
  Fix: `resolveQuestion(qid, custom) → { id, kind: 'single'|'multi'|'text',
  prompt, promptZh, options, isCustom }` normalizing BOTH shapes, used by
  the render loop AND the gate, plus a shared type-aware
  `isAnswered(q, value)` (text: non-empty after trim — whitespace-only
  never satisfies a required question; single: non-empty string; multi:
  non-empty array).
- Rendering: `single`/`multi` reuse the existing chip UI verbatim (an
  options list already capped at 8 by the clamp bounds selectable values
  at 8 — consistent with Joi's array `.max(8)`); `text` renders a
  bounded single-line input (`maxLength = CUSTOM_ANSWER_TEXT_MAX`),
  theme-token styled like the core fields. `showZh` governs custom
  `promptZh`/`labelZh` exactly like library copy. Long-content safety
  (R1 #16): the chip row and prompt get an explicit `overflow-wrap:
  anywhere` + `max-width: 100%` constraint so a 48-char unbroken label
  or 140-char prompt cannot overflow 390×844. `data-se` markers per
  custom question for tests.
- Answer state joins the existing `profileAnswers` map:
  `{ [qid]: optionId | optionId[] | string }` — the server distinguishes
  text by the campaign's def, never by shape-sniffing.
- **`LeadCapture.jsx`** payload construction is UNCHANGED — custom
  answers ride the existing `profileAnswers` field.

## 5b. Studio AI interaction — looks must not eat question edits (R2 new #2)

`useStudioAi` swaps the WHOLE doc on both look application (`pickLook`
builds from the pick-time `prev.doc` on re-picks) and revert
(`revertLook` does `replaceDoc(p.prev.doc)`), so a custom-question edit
made while a proposal is active would be destroyed — contradicting the
"AI never touches profileQuestions" contract. Fix: **every doc
replacement inside `useStudioAi` grafts the LIVE doc's
`profileQuestions` subtree over the replacement** (pick, re-pick, and
revert alike — the subtree is never the AI's to change in either
direction). Tests: edit-after-pick → revert keeps the edit;
edit-after-pick → re-pick keeps the edit; Fill-everything/apply/revert
leaves the subtree byte-identical.

## 6. Wire + acceptance — same field, same gate (extends parent §5.4)

- **Joi** (`validation.js:270` — in checkJs scope via the middleware
  include): `profileAnswers` keeps its key pattern (`c_` ids already
  match), `.max(5)` → `.max(10)` (`MAX_TOTAL_PROFILE_QUESTIONS`), string
  alternative `.max(32)` → `.max(200)` (`CUSTOM_ANSWER_TEXT_MAX`; library
  answers unaffected — semantic validation still drops non-option
  values). Array alternative unchanged (`.max(8)` = `MAX_CUSTOM_OPTIONS`).
  Nested `.unknown(false)` + 400-vs-429 ordering unchanged, re-tested
  THROUGH the middleware with the route's global `stripUnknown` (backend
  validation tests, R1 #16).
- **Eligibility gate — repaired, not just reused (R1 #7):** the parent
  plan specified "campaign type is not `guided_review`", but the shipped
  gate checks `design_config.template.id` only
  (`prospectScoring.js:89`) while the UI branches on `campaign.type`
  (`LeadCapture.jsx:581`) — a guided-review-TYPE campaign carrying a v2
  doc with a different template id accepts hidden answers via direct
  POST. The gate gains the leg the parent plan intended:
  `sourceCampaign?.type !== 'guided_review'` (template check kept,
  belt + braces; `sourceCampaign` is the full `findByPk` row, so `type`
  is present). This also closes the same latent gap for LIBRARY answers;
  a direct-API regression test pins it.
- **`prospectScoring.js` `scoreSubmission`:** after the existing library
  loop, a **custom loop** iterating `questionIds` in order, taking ids
  that resolve to a campaign custom def (never attacker-provided keys):
  - `single`: value must be a string equal to one option id → freeze that
    option's `label`.
  - `multi`: value must be a unique string array ⊆ option ids (≤
    `MAX_CUSTOM_OPTIONS`) → freeze labels in the def's option order.
  - `text`: value must be a string → `sanitizeQuestionText` at
    `CUSTOM_ANSWER_TEXT_MAX`; empty after trim ⇒ skipped.
  - Accepted answers build `sourceMetadataPatch.customAnswers =
    [{ qid, prompt, values: string[] }]` in `questionIds` order — prompt
    and labels FROZEN server-side from the campaign config at capture (a
    later Studio edit can't re-caption history; the §5.2 frozen-input
    principle). Client-sent labels are never trusted. **The historical
    record is English-canonical by definition (R1 #14):** the snapshot
    freezes the EN `prompt` and EN `label`s (plus the customer's
    sanitized literal text), NOT the bilingual as-seen rendering —
    `label` is the required field and the admin surface is EN; a stated
    redefinition, not an omission.
  - Violations drop THAT answer, joining the existing single aggregated
    log line — which logs **ids only**, never answer content or prompts
    (log-injection surface, R1 #15). A bad answer never costs a lead.
    Ineligible campaigns ignore the whole object (existing branch).
  - **`acceptedProfileFacts` is untouched** — custom answers mint zero
    observations and zero map-job facts by construction (test pins the
    zero). Note: `prospectScoring.js` sits OUTSIDE the checkJs include
    set (`tsconfig.check.json` covers `src/utils` + `src/middleware`) —
    no typecheck claim is made for it; behavior is test-pinned (R1 #16).
- **Mass assignment — the claim was wrong; now it's work (R1 #6):**
  `profileAnswers` is NOT currently destructured out of the body — it
  rides `incoming` into `Prospect.create` (`prospectService.js:223` strip
  list, `prospectCreateTx.js:165` spread), inert only because Sequelize
  ignores non-attribute keys. It joins the strip destructure explicitly.
  Separately, internal callers' `sourceMetadata` is preserved with only
  the `marketplace` subkey scrubbed (`prospectService.js:237`) — so
  `customAnswers` (and `profileAnswers`) join the server-only scrub
  list: caller-supplied values are deleted before the server-built patch
  merges. Verified unaffected legitimate callers: Retell creates
  prospects directly via `Prospect.create` with server-built metadata
  (`retellService.js`), and marketplace submits its validated top-level
  `marketplace` field — neither path supplies these keys. Tests assert
  neither key reaches create attributes from the body NOR survives via
  caller-supplied `sourceMetadata`.
- **Erasure:** `erasureService.js` `erasedSourceMetadata` rebuilds from an
  allowlist (utm + `erased:true`) — `customAnswers` is wiped from the
  prospect automatically; tests pin it (§8, incl. the webhook-payload
  legs in §7).

## 7. Display + delivery (PII boundary stated in full — R1 #9, R2 #9)

`sourceMetadata.customAnswers` is **PII** (free text may contain
anything the customer types). Its full propagation surface:

- **MKTR admin:** `AdminV2LeadProfile.jsx` gains a "Custom answers" card
  rendering the frozen `{qid, prompt, values}` list (Q above, A below,
  plain text — React escaping, no `dangerouslySetInnerHTML`; hostile
  strings render as literal text, test-pinned). No backend change: the
  card reads `p.sourceMetadata` from the lead-profile ROOT projection —
  the unrestricted `Prospect.findOne` (`prospectReadService.js:31`) —
  which serves consumer-linked and consumer-less leads alike (the
  `getSignupProfile` fallback does NOT return `sourceMetadata` and is
  not relied on — R2 new #5). Tested on both profile paths.
- **Webhooks — all three lead events forward `sourceMetadata` verbatim:**
  `lead.created` (`prospectHelpers.js:118`), `lead.assigned` (`:177`),
  and `lead.unassigned` (`:231` — fires on admin pull-back, R2 #9), to
  both destinations (Lyfe app and MKTR Leads external buyers,
  `prospectHelpers.js:47`). External buyers seeing campaign Q&A on a
  lead they bought is correct product behavior — stated, not accidental.
- **Erasure covers all three stores:** the prospect rebuild (§6), pending
  webhook deliveries (cancelled before firing), and historical delivery
  payloads (scrubbed — `erasureService.js:195` block). Tests cover the
  webhook legs with `customAnswers` present.
- **Lyfe receiver (sibling repo — external dependency):** the
  `receive-mktr-lead` EF composes lead notes from
  Company/Title/Industry/Campaign/QR only, so agents do NOT see custom
  answers in the app from this PR. That claim is about `lyfe-app` code
  and is verified there, not here; the §10 follow-up owns it.
- **CSV exports — explicitly OUT (R1 #10):** the shared admin exporter
  (`src/lib/adminV2/csv.js` fixed `COLUMNS`, used by Prospects +
  Dashboard) does NOT gain a custom-answers column in v1 — the Lead
  Profile card is the read surface. If Shawn wants export, it's a
  fast-follow through the existing formula-injection-safe `csvCell()`
  path (and needs the list API to carry the data) — §10.

## 8. Tests

- **Twins/lockstep:** new constants/regexes into `CONSTANT_EXPORTS`;
  `sanitizeQuestionText` into `FUNCTION_EXPORTS` with behavioral parity
  fixtures (same hostile inputs → same outputs both sides);
  upgrade-preservation fixture with `custom`.
- **Clamp** (`designConfigV2StudioClamp.test.js` style): the §3 matrix —
  bad shapes/types dropped, id patterns, question-id uniqueness +
  library-collision, option-id uniqueness within a question, empty
  labels/prompts dropped, **option cap: a 9th valid option is dropped**,
  text-row options stripped, **cap-ordering: 5 unreferenced defs + 1
  referenced def ⇒ the referenced question SURVIVES**, caps (5 custom /
  10 total), unreferenced defs dropped, order preserved verbatim,
  `requiredIds ⊆`, enabled-with-only-custom valid, control-char/bidi
  stripping, golden suites unchanged.
- **Public projection** (`publicDesignConfig.test.js`): custom leaf-pick
  is exactly the §3 shape; disabled ⇒ absent; no extra keys leak.
- **Capture** (backend integration + validation suites): Joi 400 matrix
  at the new bounds THROUGH the middleware (stripUnknown interaction);
  custom accepted → frozen `{qid, prompt, values}` snapshot with
  server-resolved labels in `questionIds` order; text
  trim/cap/control-strip; whitespace-only text skipped; unknown option
  ids / shape mismatches dropped (lead still created);
  ineligible ignores; **guided-review-TYPE direct-POST rejected (the
  repaired gate)**; **zero consumer observations from custom answers**;
  mass-assign: body `profileAnswers` never a create attribute AND
  caller-`sourceMetadata.customAnswers` scrubbed; logs carry ids only
  (CR/LF in answers never lands in log content); erasure: prospect
  rebuild + pending-delivery cancel + historical-payload scrub all shed
  `customAnswers`; `lead.unassigned` payload carries-then-sheds them
  too; marketplace-door parity per §1.
- **Panel** (`FormQuizPanels.test.jsx`): the per-site
  destructive-mutation matrix (master toggle, brief-suggestion add,
  library tick, required toggle, custom authoring — each preserves the
  rest of the subtree, including the pre-existing `requiredIds`/`showZh`
  loss now fixed); `mutatePQ` reconciliation (mismatched
  `custom`-vs-`questionIds` input, back-to-back mutations, idempotence);
  draft lifecycle (rail switch away/back, save-response adoption,
  campaign-switch guard through BOTH buttons — Save-and-continue commits
  a complete draft and the `Campaign.update` PUT payload is asserted to
  contain the new def + id before navigation (the R4 snapshot rule) /
  blocks an incomplete one, Discard discards; second
  Add disabled; incomplete edit never reaches the doc; control-char-only
  prompt cannot commit); commit atomicity; delete cleans `questionIds` +
  `requiredIds`; reorder moves within the custom segment; first-unused
  `oN`; Add-option disabled at 8; **Add-question disabled at 5 and a
  sixth question never enters the doc**.
- **Renderer** (`CampaignSignupForm` tests): renders single/multi/text
  from the normalized resolver; multi-custom actually multi-selects;
  required gate blocks unanswered required CUSTOM questions and
  whitespace-only text; payload carries custom answers; showZh off ⇒
  EN-only; hostile prompt/label renders as literal text; long unbroken
  strings stay inside 390px (overflow-wrap pinned); disabled ⇒ nothing.
- **Admin:** Lead Profile card on consumer-linked AND consumer-less
  leads (both via the root projection); hostile answer text renders
  inert.
- **Duplication + AI:** campaign duplication carries `custom` intact
  (`campaignService` clone path); §5b matrix — edit-after-pick →
  revert/re-pick keeps edits; Fill-everything/apply/revert leaves the
  subtree untouched.
- **Full path** (parent §6 pattern): public endpoint → adapter → form
  renders custom → POST carries `profileAnswers` with custom ids.
- **Feature verification commands (R3 new #2 — local repro per
  CLAUDE.md, not a mirror of `ci.yml`, which additionally runs coverage
  and Playwright E2E jobs):** backend Jest — unit, integration, and
  migration suites; `cd backend && npm run typecheck` (validation.js and
  the `src/utils` twin/clamp/projection changes are in scope); root
  **Vitest** (`npm test`) + frontend build; `npx eslint src/ --quiet` at
  both the repo root and `backend/`. The PR merges only on full CI
  green, whatever the workflow runs.

## 9. Rollout

One PR, **no migration** — `campaigns.design_config` and
`prospects.sourceMetadata` are schema-less `DataTypes.JSON` columns
(R1 #12), and no new table/column/index is introduced. Naturally dark: no
campaign carries `custom[]` until Shawn authors one, and the
clamp/projection changes are no-ops on existing docs (golden suites
prove). `DESIGN_CONFIG_V2_WRITES_ENABLED` preflight as always. Single
service; nothing to choreograph.

## 10. Open questions (Shawn)

1. **Free-text type in v1?** The plan includes `text` (200-char cap).
   Cutting it shrinks the PR; options-only still covers most campaign
   intel. Recommendation: keep it.
2. **Caps OK?** 5 custom / 10 total / 8 options / 200-char text — named
   constants, trivially tunable later.
3. **Agent visibility follow-up:** a lyfe-app EF change appending a
   compact "Q: … | A: …" line to lead notes so agents see answers in the
   app (separate repo/PR; the webhook payload already carries the data).
4. **CSV export fast-follow:** want custom answers in the Prospects
   export? (Needs a serialized column via `csvCell()` + list-API
   exposure — deliberately out of v1.)
5. **Marketplace door:** should marketplace flows EVER ask profile
   questions (library or custom)? Today they never have; v1 keeps that.

## 11. Codex rounds 3–5 — disposition log

**Round 5** (APPROVE, zero new findings): the explicit-snapshot guard
contract verified against `useStudioDoc.js` (`mut` scheduling, the
`prev === snapshot` reference-identity adoption) and
`AdminCampaignStudio.jsx` `handleGuardPrimary` — "closes the sole Round 4
defect without weakening save gates, slug merging, or in-flight-edit
protection."

**Round 3** (REWORK: 9/10 closed): all four reopened round-1 items
CLOSED; round-2 new findings #2–#6 CLOSED (the §5b graft was confirmed
to cover every replacement site including `toggleKeep`); #1 residual + 2
new. **Round 4** (REWORK: 2/3 closed, ZERO new findings): cap-disable and
CI relabel CLOSED; the guard fix reopened once more on a React
state-lifecycle defect — `mut()` schedules `setDoc` while `save()` PUTs
the render-captured doc (`useStudioDoc.js` `const snapshot = doc`), so
commit-then-save would PUT the pre-commit doc; round-3 log renumbering
verified accurate.

| # | Finding | Disposition |
|---|---|---|
| R4 (residual of R2 new 1) | B: "mutatePQ then save()" PUTs the stale pre-commit doc and navigates — the exact loss the guard exists to prevent | **Adopted** — `save(extra, { snapshot })` explicit-snapshot parameter (precedent: `extra` already carries the guard's slug draft); guard computes the post-commit doc synchronously and hands the SAME reference to `setDoc` and `save`; test asserts the PUT payload before navigation (§4, §8). |

| # | Finding | Disposition |
|---|---|---|
| R2 new 1 (residual) | The guard's "Save & continue" saves the doc then navigates — a draft (outside the doc) is destroyed even though the user chose Save | **Adopted** — Save-and-continue commits a complete draft before `save()`; blocked (with reason) for incomplete drafts until completed or explicitly Discarded; both guard buttons tested with complete + incomplete drafts (§4, §8). |
| New 1 | M: Add-question was only draft-gated — a sixth question could be authored, then silently clamped away on save | **Adopted** — Add disabled at `MAX_CUSTOM_QUESTIONS`, commit re-checks, sixth-question-never-enters-doc test (§4, §8). |
| New 2 | m: "exact CI gates" list wasn't exact (`--runInBand` isn't in ci.yml; coverage + Playwright jobs omitted) | **Adopted** — relabeled as local feature-verification commands per CLAUDE.md; CI green stays the merge gate (§8). |

## 12. Codex round 2 — disposition log (REWORK: 12/16 closed, 4 reopened + 6 new, all adopted)

Round-2 verdicts on the 16 round-1 items: #1–#2, #5–#8, #10, #12–#16
CLOSED as written (the alternate single-authority ordering fix for #3 was
judged viable). Reopened + new findings, all verified in code before
adoption (`buildLeadUnassignedPayload` forwards `sourceMetadata`;
`FUNCTION_EXPORTS` exists at `designConfigV2.lockstep.test.js:22`;
`revertLook` does a whole-doc `replaceDoc(p.prev.doc)`):

| # | Finding | Disposition |
|---|---|---|
| R1 #3 (reopened) | Clamp order still let 5 unreferenced defs consume the cap before a referenced 6th | **Adopted** — §3 reordered: validity map without count cap → questionIds built with custom-acceptance cap → defs retained only for final membership (§3). Cap-ordering test added (§8). |
| R1 #4 (reopened) | Panel "complete" used `trim()` while the server strips C0/C1+bidi — control-only prompts commit then vanish | **Adopted** — completeness = non-empty after the SHARED `sanitizeQuestionText`, and commits write the sanitized values (clamp-stable by construction) (§4). |
| R1 #9 (reopened) | `lead.unassigned` also forwards `sourceMetadata` verbatim; inventory claimed fullness without it | **Adopted** — all three events documented + tested (§7, §8). |
| R1 #11 (reopened) | `sanitizeQuestionText` can't live in `CONSTANT_EXPORTS` (structural equality fails on functions) | **Adopted** — it joins `FUNCTION_EXPORTS` with behavioral parity fixtures (§2, §8). |
| New 1 | B: editor-local drafts had no durable owner — rail switch unmounts FormPanel, dirty guard watches doc+slug only | **Adopted** — drafts lifted to the Studio page keyed by campaign id; `draftDirty` joins the dirty guard; one draft at a time; lifecycle test matrix (§4). |
| New 2 | M: AI look apply/revert are whole-doc swaps from the pick-time snapshot — post-pick question edits destroyed | **Adopted** — every `useStudioAi` doc replacement grafts the LIVE `profileQuestions` subtree; §5b + tests. |
| New 3 | M: 8-option bound stated but not enforced anywhere (clamp/editor/scoring/tests) | **Adopted** — `MAX_CUSTOM_OPTIONS = 8` constant, clamp drop-beyond-8, Add-option disabled at 8, scoring bound, 9th-option tests (§2–§4, §6, §8). |
| New 4 | M: `mutatePQ` invariants undefined (atomicity, customOrder↔defs reconciliation) | **Adopted** — atomic single-draft contract with read-side reconciliation, ordered-ids-only emission, idempotence + mismatch tests (§4, §8). |
| New 5 | m: consumer-less fallback does NOT return `sourceMetadata`; the root projection is what the card reads | **Adopted** — claim corrected; both test paths read the root projection (§7). |
| New 6 | m: frontend runner is Vitest, not "frontend jest" | **Adopted** — exact CI gate list named (§8). |

## 13. Codex round 1 — disposition log (REWORK 3B/8M/5m, all 16 adopted)

Load-bearing claims re-verified in code before adoption (marketplace
flow/`buildPublicDesignConfig`, FormPanel mutation sites, the strip
destructure + `marketplace`-only scrub, the `template.id` gate,
`CONSTANT_EXPORTS`, `tsconfig.check.json` include set, CSV `COLUMNS`,
erasure's webhook blocks) — all confirmed true; zero refuted.

| # | Finding | Disposition |
|---|---|---|
| 1 | B: "marketplace inherits the funnel door" is false — own step machine, fixed fields, no `profileAnswers`, v1-downgraded public config excludes the subtree | **Adopted** — reframed as explicit parity: marketplace has never asked profile questions and v1 keeps that; parity test + §10 owner question (§1). |
| 2 | B: existing FormPanel mutation sites rebuild the subtree lossily and would delete `custom` | **Adopted** — single `mutatePQ` helper owns every subtree write; per-site preservation test matrix; also fixes the pre-existing `requiredIds`/`showZh` loss (§4). |
| 3 | B: two ordering authorities (`custom[]` order vs `questionIds`), unpicked defs consume the cap | **Adopted, alternate fix** — `questionIds` stays the SINGLE authority; `custom[]` demoted to an unordered def set; clamp drops unreferenced defs (§2, §3). R2 confirmed the ordering half; the cap half was re-fixed in v3 (§12). |
| 4 | M: blank starter row written to the doc vanishes on Save (clamp drops + Studio adopts clamped response) | **Adopted** — editor-local drafts; a def reaches the doc only when complete, atomically with its id (§4). R2 tightened completeness to the shared sanitizer (§12). |
| 5 | M: `resolveQuestion` doesn't normalize `multi` vs `type`; custom multi degrades to single; whitespace-only required text passes | **Adopted** — normalized resolver shape + shared type-aware `isAnswered` with trim (§5). |
| 6 | M: mass-assignment claim factually wrong; forged `sourceMetadata.customAnswers` possible from internal callers | **Adopted** — claim corrected; `profileAnswers` joins the strip destructure; `customAnswers`/`profileAnswers` join the `marketplace`-style server-only scrub; Retell/marketplace verified unaffected; tested (§6). |
| 7 | M: backend gate checks `template.id`, not campaign `type` — direct-POST leak on guided-review-type campaigns | **Adopted** — add the `sourceCampaign.type` leg (keep template check), repairing the same latent gap for library answers; regression test (§6). |
| 8 | M: option-id uniqueness/non-empty labels unspecified; `oN`/`c_` generation collision-unchecked | **Adopted** — per-question option-id uniqueness + non-empty-after-sanitize labels in the clamp; first-unused `oN`; collision-checked random `c_` ids (§2–§4). |
| 9 | M: PII boundary broader than documented (`lead.assigned`, MKTR Leads destination, historical webhook payloads, sibling-repo claim) | **Adopted** — §7 rewritten: PII classification, events/destinations stated, erasure tested across all three stores, Lyfe receiver = external dependency (§7). R2 added `lead.unassigned` (§12). |
| 10 | M: both CSV exports omit the answers | **Adopted as explicit decision** — out of v1, stated in §7; fast-follow path named; owner question §10.4. |
| 11 | M: twins aren't byte-parity; lockstep covers only enumerated constants | **Adopted** — terminology corrected; constants into `CONSTANT_EXPORTS` (§2). R2 moved the function into `FUNCTION_EXPORTS` (§12). |
| 12 | m: columns are `DataTypes.JSON`, not JSONB | **Adopted** — §9 wording. |
| 13 | m: cited admin projection is the consumer-less fallback only | **Adopted** — root projection (`prospectReadService.js:31`) cited (§7). R2 removed the residual fallback overclaim (§12). |
| 14 | m: frozen snapshot isn't the bilingual as-seen record | **Adopted as explicit decision** — historical record is English-canonical (EN prompt + EN labels + literal text); stated redefinition (§6). |
| 15 | m: `cleanString` only slices; XSS/log-injection tests unpinned | **Adopted** — shared `sanitizeQuestionText` (trim + C0/C1 + bidi) in the twins; hostile-render + ids-only logging tests (§2, §6, §8). |
| 16 | M: test/CI gaps (FormPanel mutation matrix, duplication, AI preservation, `lead.assigned`, historical erasure, middleware-level Joi, 390px overflow, checkJs scope overclaim) | **Adopted** — §8 matrix expanded; `prospectScoring` typecheck claim removed; chip `overflow-wrap` constraint added (§5). |
