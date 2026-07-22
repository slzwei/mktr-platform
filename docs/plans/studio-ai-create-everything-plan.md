# Studio AI "create everything" — unified full-coverage orchestration — plan v2

**Date:** 2026-07-22 · **Baseline:** `origin/main @ a198bc3` (#233 Details-form AI; #232 multi-prize; #226 draw templates).
**Ask (Shawn):** the create-campaign AI must "come up with ALL the designs, choose the right design, colour, layout, privacy marketing template, t&cs template, input fields to be captured, and all the copy."
**v1 → v2:** Codex CLI review (gpt-5.6-sol xhigh) returned REDESIGN — 5 BLOCKERs, 6 MAJORs, 3 minors. Every finding was re-verified against the code; all were CONFIRMED (one of them — B1 — invalidated v1's core flow). v2 is the redesigned contract. Disposition table in §0.
**Division with #233:** #233 drafts the create FORM (name/dates/ages/prize rows; seeded T&Cs). This plan owns the Studio design surface + the handoff. No shared files; shared 10/min AI limiter only.

## 0. Codex disposition (all verified in code)

| # | Finding | v2 resolution |
|---|---|---|
| B1 | "Fill everything" (internal mode `copy` → review rows) and "Design the whole page" (mode `full` → look proposals) are separate pipelines (`StudioAiPanel.jsx:130-143`, `useStudioAi.js:162-179` vs `:444-465`); v1's `?ai=full` could not deliver looks AND fields/terms in one flow | **Unified response (§2.1)**: BOTH modes gain the same `fields` + `terms` sections; full mode returns them BESIDE `proposals` as "common rows" that survive look adoption. `?ai=full` = full mode = looks + fields + terms + copy in ONE provider call |
| B2 | `row: index` is non-canonical (save clamp coerces numeric rows to null, `designConfigV2Clamp.js:242-259`; `fieldsToV1` inconsistent on numerics); `rowCurrentValue` returns `''` for non-list kinds; `ValueLines` prints `[object Object]`; regen 422s on non-copy scopes | Fields rows emit `row: null`; new first-class `fields` kind with dedicated summary/current/equality logic; regen disabled for `fields`/`terms` kinds (same posture as picks) |
| B3 | Deterministic draw terms: template hardcodes 18+/SMS while #233 allows minAge 21 and v2 form supports WhatsApp; Studio doc facts can be stale vs stored campaign; `ensureDrawTermsVersion` reuses identical content (doesn't always mint) | Server computes **`drawTerms` FACTS** (never the model) from the freshly-fetched campaign in `buildCampaignContext`; client composes HTML via `buildDrawTermsHtml` extended with `{minAge, verification}` (defaults keep byte-compat); plan wording fixed: a changed doc mints a new version, identical content re-resolves |
| B4 | `form.terms.template` alone is lossy (save clamp keeps `terms` only when `html` is a string, `designConfigV2Clamp.js:272-281`); no schema/sanitizer existed; keep-mine leaves empty parents | **One `terms` row** with value `{template, html}` applied atomically to `form.terms` (mirrors FormPanel's atomic write); keep-mine restores the prior object or `undefined` (form always exists in v2 docs — no orphan subtree) |
| B5 | No atomic begin API (`setBrief(); generate()` races the closure); doc seeds on a later render; campaign-reset effect closes the panel; "auto-run" was ambiguous | New `beginFull(briefArg)` in `useStudioAi` — opens, sets mode, generates from the ARGUMENT; `AdminCampaignStudio` effect fires once after `campaign && doc`, then strips only the `ai` param. Auto-run DOES generate (consumes 1 of the shared 10/min) |
| M6 | Schema strictness: new keys must be required+nullable in both providers; `anthropicSafeSchema` is generic recursion (no key allowlist to touch) but strips length caps → parse-time clamps mandatory; "usable response" check counts only draft/picks/inclusions (`campaignCopyAiService.js:785-796`) | §2.2 specifies exact schema + DTO for both modes; parse clamps for every new key; usable-check counts `fields`/`terms` |
| M7 | Regen/apply-all semantics per kind undefined; adopting a look clears `sugs` | Capability matrix §2.4; full-mode common rows live in separate state and are re-merged into `sugs` on adoption |
| M8 | `sanitizeProposal` DROPS a proposal on a bad template (`:417-422`) — v1's "null-template fallback" was wrong; `lookBlockedReason` has no draw rule; light presets recommended for draw templates | Policy: **drop stays** (server) + prompt only lists draw templates for draw campaigns + explicit non-draw prohibition; client `lookBlockedReason` blocks draw-template looks on non-draw docs (stale-server belt); prompt adds light-preset steering |
| M9 | "Terms never AI-writable" contract lives in 7 places; no server HTML policy for AI terms | §2.6 amends the living surfaces (service header, panel disclaimer + its test, CLAUDE.md pointer, full-coverage plan pointer); server-side tag/attr/href allowlist sanitizer for AI `termsHtml` |
| M10 | No endpoint/schema collision with #233 (verified); but the #233 brief is component state — "one brief" chain doesn't exist | Reframed: two fact-derived AI steps. The Studio brief prefills from campaign facts. Brief carry-through = explicit non-goal in v2 (noted for a follow-up) |
| M11 | `DRAW_TEMPLATE_IDS` would have 3 driftable sources (drawTemplates registry export, PagePanel hardcode, new twins); lockstep test needs `CONSTANT_EXPORTS` updated | Canonical subset in BOTH designConfigV2 twins; PagePanel consumes it; new test pins registry keys === canonical; lockstep export list updated |
| m | Rate limit is 10/min shared (not 1/min); budgets are per internal mode (everything 12000, looks 8000); citation `:420` semantics | Corrected here; budgets: everything 12000→14000, looks 8000→14000 |
| ✓ | Codex confirms: field defaults claim correct (locked trio + dob/postal visible-optional, education/salary hidden); full 7-row `row:null` array round-trips v2→v1→v2 unchanged; renderer safely degrades draw templates on non-draw campaigns; apply is client-side + save-clamp-enforced; #233 snapshot merge composes | v1 claims stand |

## 1. What ships (operator story)

Create campaign (with #233's Details AI or by hand) → Design tab → **"✦ Fill everything with AI"** → Studio opens with the AI panel generating: up to 3 complete looks (template incl. the five draw templates when it IS a draw, theme, layout params steer, full copy) **plus** a form-fields row, a T&Cs row (template label + document), distribution copy/picks, and the advisory cards. Pick a look, review rows, Apply all, Save.

## 2. Design

### 2.1 Unified response — both modes gain common sections

- Internal mode `copy` ("Fill everything" tab) response: `draft[] + picks + inclusions + recommendations[]` **+ `fields` + `terms`**.
- Internal mode `full` ("Design the whole page" tab, and the `?ai=full` entry) response: `proposals[]` **+ `fields` + `terms`** (common rows; NOT per-proposal — fields/T&Cs don't vary by look).
- Frontend: `useStudioAi` stores full-mode `fields`/`terms` as `commonRows`; `pickLook`/adoption composes `sugs = proposalCopyRows ++ commonRows`; discarding a proposal keeps `commonRows` for the next pick. Copy mode appends the same rows to `sugs` directly (kinds below).

### 2.2 Response schema + parse clamps (server = trust boundary)

New top-level keys, both providers, required + nullable (strict-schema pattern; Anthropic transport passes arbitrary property names through, but strips length caps → every cap re-enforced at parse):

```
fields:  null | [{ id: enum FIELD_IDS, visible: bool, required: bool }]   // ≤7 items
terms:   null | { template: enum default|privacy|marketing, html: string ≤10000 | null }
```

Parse clamps in `campaignCopyAiService`:
- `clampAiFields(raw)` → full 7-row array of `{id, visible, required}` or `null`. Rules: non-array/0-valid-rows → null; unknown ids dropped; dup first-wins; locked trio forced `{visible:true, required:true}`; **`required ⇒ visible` enforced here** (the save clamp doesn't); missing ids appended with canonical defaults in canonical order. (`row: null` is added at apply time client-side.)
- `clampAiTerms(raw, ctx)` → `{template, html}` or null. Draw campaigns (`ctx.draw`): model `html` is DISCARDED — html comes from `drawTerms` facts (below); template forced `'default'`. Non-draw: html sanitized by the **AI-terms HTML policy** (allowlist tags `p, br, strong, em, u, ol, ul, li, h3, h4, a`; attributes stripped except `a href` matching `^https?://`; `javascript:`/`data:` hrefs dropped; result < 200 chars → null), capped at `LIMITS.terms`.
- Usable-response check counts `fields`/`terms` as usable content.

### 2.3 Deterministic draw terms (facts from the server, HTML from the shared template)

- `buildCampaignContext` (already fetches the campaign fresh per request) adds `drawTerms` facts for enabled draws: `{ campaignName, prizes, closesAt, boostClosesAt, multiplier, minAge (campaign.min_age, floor 18), verification ('sms'|'whatsapp' from the stored doc) }`. The response echoes them under `drawTerms` (computed, never model-influenced).
- `buildDrawTermsHtml` gains optional `{ minAge = 18, verification = 'sms' }` → eligibility clause "aged ${minAge} and above", OTP wording "one-time ${SMS|WhatsApp} code". **Defaults reproduce today's output byte-identically** (pinned by the existing exact-equality test) — the create flow (#230/#233) is untouched.
- The client composes the terms row for draw campaigns from `drawTerms` via the extended template: fresh facts (kills the stale-doc hazard), zero LLM legal text, one template shared with the create flow.
- Known residual (documented, unchanged): a stale Studio tab's whole-doc save can still overwrite newer stored `luckyDraw` — pre-existing admin-wins semantics; the draw close date is already lock-guarded server-side.

### 2.4 Row kinds (frontend)

| kind | value | apply | keep-mine | regen | render |
|---|---|---|---|---|---|
| `fields` (new) | 7×`{id,visible,required}` | `setPath('form.fields', value.map(f => ({...f, row: null})))` | restore prior array (or `undefined`) | **disabled** (like picks) | summary line: "Name · Phone · Email · DOB — optional · Postal — optional (Education, Salary hidden)"; old value struck-through in same format |
| `terms` (new) | `{template, html}` | `setPath('form.terms', value)` — atomic | restore prior object or `undefined` | **disabled**; draw campaigns get a local "↻ recompute from draw settings" that re-derives from `drawTerms` facts | template chip + truncated html preview + char count + legal-draft warning line |
| copy / pick / list | unchanged | unchanged | unchanged | unchanged | unchanged |

`rowCurrentValue` / `rowValuesEqual` gain kind branches (JSON-stable compare for `fields`/`terms`); `ValueLines` never receives object arrays (the new kinds render their own components).

### 2.5 Looks, draw templates, twins

- Prompt: draw-template one-liners (Postcard/Gazette/Nightfall/Stub/Checklist) are included ONLY when the campaign has an enabled draw, with the rule "pick a draw template for the page" + light-preset steering (per `drawTemplates.jsx:7-12` guidance); non-draw prompts never mention them + explicit prohibition.
- Server: `sanitizeProposal` keeps drop-on-invalid semantics; for non-draw campaigns the allowed template set excludes draw ids (proposal dropped, as for junk today).
- Client belt: `lookBlockedReason(doc, look)` blocks draw-template looks when `doc.luckyDraw?.enabled !== true` ("Draw templates need a lucky draw on this campaign").
- `DRAW_TEMPLATE_IDS` canonical in BOTH `designConfigV2` twins; `PagePanel` consumes it; `drawTemplates.jsx` keeps its registry-derived export + a test pinning registry keys === canonical subset; lockstep test `CONSTANT_EXPORTS` gains the new constant.

### 2.6 Contract amendments + REC cleanup

- `campaignCopyAiService.js` header contract comment; `StudioAiPanel` disclaimer copy (+ its test) now say fields + T&Cs are draftable, consents/regulatory/media stay locked, and AI T&Cs are a reviewed draft, not legal advice (⚖️ flagged once; the queued counsel review covers the templates).
- `REC_TOPICS`: drop `formFields` (superseded by the WRITE row); keep `verification`/`formGates` advisories.
- `CLAUDE.md` Studio pointer line updated; `studio-ai-full-coverage-plan.md` gets an "amended by this plan" pointer.

### 2.7 Auto-run

- `useStudioAi.beginFull(briefArg)`: atomically `setOpen(true); setMode('full')` and generate looks from the ARGUMENT (no closure race), guarded against the campaign-reset effect.
- `AdminCampaignStudio`: when `searchParams.ai === 'full'` and `campaign && doc` first become ready → `beginFull(prefill)` once (ref-guarded), then strip only the `ai` param. Prefill brief from campaign facts (name; draw → prize summary + closes).
- `OpenInStudioCard`: primary "✦ Fill everything with AI" → `/admin/campaigns/:id/studio?ai=full`; plain link stays.
- Budgets: everything 12000→14000, looks 8000→14000 output tokens. Limiter unchanged (10/min shared; auto-run consumes one).

## 3. Out of scope (explicit)

Quiz question generation (Phase 3, parked); carrying the #233 brief text into the Studio brief (follow-up; v2 prefills from campaign facts); luckyDraw settings writes; consent/regulatory copy; media uploads; per-proposal fields/terms variation; multi-winner draw engine.

## 4. Edge cases (v2)

| # | case | handling |
|---|---|---|
| 1 | Model picks a draw template for a non-draw campaign | proposal DROPPED server-side (existing semantics); client `lookBlockedReason` belt for stale servers |
| 2 | `fields` garbled / 0 valid rows | null → no row (never a partial form); ≥1 valid row → normalized full-7 |
| 3 | Locked field hidden/optional, or required-but-hidden | `clampAiFields` forces trio + `required⇒visible` |
| 4 | Model returns terms html for a draw campaign | discarded; deterministic `drawTerms` facts win |
| 5 | Terms row applied on a doc with no `form.terms` | atomic `{template, html}` write — survives the save clamp |
| 6 | Keep-mine on originally-absent terms | `form.terms` restored to `undefined` (JSON-serializes away; `form` itself always exists) |
| 7 | Look adopted after fields/terms accepted | commonRows re-merged into `sugs` with their state preserved |
| 8 | AI terms html hostile (script/onerror/js: links) | server allowlist sanitizer; DOMPurify still guards render |
| 9 | `?ai=full` before doc ready / refresh / other params | effect waits for `campaign && doc`; once-ref; strips only `ai`; refresh doesn't re-trigger |
| 10 | Auto-run rate-limited (429) | existing countdown UI (panel already handles 429 retryAfterSec) |
| 11 | Old panel against new API / new panel against old API | additive nullable keys ignored by old client; new client tolerates absent keys (rows just don't appear) |

## 5. Tests

Backend (`aiCopyDraft.test.js` + service units):
- fields clamp matrix (trio, required⇒visible, dup, unknown, 0-valid→null, ≥1-valid→full-7, canonical append order)
- terms clamp: draw discards model html + forces default template; non-draw sanitizer (tag/attr/href allowlist, js:/data: dropped, <200 chars → null, 10k cap)
- `drawTerms` facts: fresh campaign fetch, minAge floor, verification passthrough, multi-prize prizes[]
- schema: both modes carry `fields`/`terms` required-nullable; Anthropic-safe transform passes them; usable-check counts them
- prompt: draw template lines only for draw campaigns; REC_TOPICS no longer contains formFields
- proposal sanitize: draw id + non-draw → dropped; draw id + draw → kept

Frontend (vitest):
- `buildDrawTermsHtml` `{minAge:21, verification:'whatsapp'}` clauses + default-args byte-compat (existing exact-equality test must not change)
- `useStudioAi`: copy-mode rows include fields/terms; full-mode commonRows survive pickLook/discard; apply-all applies them; keep-mine restores object/array/undefined; regen hidden for new kinds; `beginFull(brief)` uses the argument and generates once
- `StudioAiPanel`: fields summary + terms preview render (no `[object Object]`); disclaimer copy updated (test updated); TEMPLATE_NAMES covers 11 ids
- `studioLooks`: `lookBlockedReason` draw rule; twins lockstep incl. `DRAW_TEMPLATE_IDS`; drawTemplates registry === canonical subset; PagePanel uses canonical
- `AdminCampaignStudio`: `?ai=full` fires exactly one generate after delayed campaign/doc, under a StrictMode wrapper, strips only `ai`, no refresh re-trigger
- `OpenInStudioCard`: AI button href

Baselines: vitest 1715/1715 @ #233; backend touched suites baseline-diff (ECONNREFUSED inherited).

## 6. Rollout

No flag; one PR (`feat(studio-ai): unified Fill-everything — draw-aware looks, form-field + T&C drafting, create-flow auto-run`). Disposable worktree off origin/main (re-fetch first — a parallel session ships frequently). Deploy-verify backend + mktr-platform static (chunk-grep), then live: iPhone 17 Pro draft → Design tab → AI button → full run → verify draw look proposals + fields row + deterministic draw T&Cs row; apply-all; save; confirm pinned terms version + doc fields.
