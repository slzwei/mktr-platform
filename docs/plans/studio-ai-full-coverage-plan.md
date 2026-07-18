# Studio "Write it for me" — full-page coverage + Distribution recommendations

**Status: IMPLEMENTED 2026-07-18** — PR 1 (backend) + PR 2 (frontend) built to
this scope, tests green (41 jest / full vitest), pending review + merge. §8
open calls resolved by default recommendation (1: writable, 2: include,
3: Apply allowed with blast-radius note, 4: "Fill everything", 5: parked).
Ask (Shawn): the AI assist should fill up **all** the details across the Studio,
including **recommendations for Distribution**, instead of today's 12-path copy
whitelist.

---

## 1. Current state (verified against code, 2026-07-18)

`POST /api/admin/ai/copy-draft` (`backend/src/services/campaignCopyAiService.js`,
route `backend/src/routes/adminAi.js`) has two modes:

- **`copy`** — returns `draft: [{path, label, section, value}]` over a
  server-enforced whitelist of **12 string paths** (`COPY_FIELDS`), five of them
  conditional on the *stored* doc: `heroCtaLabel` (media present), `quiz.intro.*`
  (quiz on + ≥1 question), `featuredDrop.title` (drop **already on**),
  `marketplace.valueLine` (listing **already on**), `express.trustLine`
  (Express template).
- **`full`** (CO-1) — ≤3 looks: `template.id` + theme enums + copy draft +
  media art-direction note. Distribution untouched by design.

The PR-4 contract (docs/plans/campaign-studio-implementation-prompt.md) says
explicitly: *"Never writable: consents, terms, footers, advertiserName, form
fields/required, gates, verification, **distribution settings**, luckyDraw."*
The panel's full-mode disclaimer repeats it. **This scope is a deliberate
amendment of that contract**, keeping its enforcement machinery (server
whitelist, clamped values, review-before-apply, never-auto-persist).

Everything below is **additive to the AI surface only** — zero changes to the
design_config v2 schema, the save clamp, the renderer, or migrations. The twins
(`designConfigV2.js`) are not touched; lockstep is unaffected.

---

## 2. Coverage map — every Studio field, classified

Four classes:

- **WRITE** — AI drafts a value; admin reviews per-row (accept / keep-mine / ↻)
  exactly like today. Server clamps to `LIMITS` / validator caps.
- **PICK** — enum choice from documented values (new row type).
- **RECOMMEND** — advisory card with a reason; never applied by "Apply all";
  optional explicit per-card Apply that only mutates the *unsaved* doc.
- **LOCKED** — stays never-writable, forever.

### Page

| Field | Class | Notes |
|---|---|---|
| headline · subheadline · story · emphasis · submitLabel | WRITE | already live |
| heroCtaLabel | WRITE | already live; keep media gate |
| `content.wordmark` (40) | WRITE (new) | prompt-gated: only from a brand named in the brief/campaign — never invented |
| `content.footer.brand` (80) | WRITE (new) | plain brand line |
| `content.media.alt` (120) | WRITE (new) | only when `media.kind === 'image'`; accessibility win |
| `template.params.express.trustLine` | WRITE | already live (Express) |
| `content.footer.regulatory` | **LOCKED** | regulatory copy |
| media src / uploads | LOCKED | art-direction note only (unchanged) |
| template id/params, theme | unchanged | full-mode looks already cover them |

### Form

| Field | Class | Notes |
|---|---|---|
| `content.advertiserName` (60) | WRITE (new) | DNC display name; fact-gated like wordmark. (Open call #1) |
| field visibility / required / order | RECOMMEND (new) | e.g. "objective is max signups → hide Education/Salary"; advice card, deep-links to Form panel; no writes |
| verification channel | RECOMMEND (new) | advice only (env/infra fact) |
| gates sgPr / advisorExclusion / dncCheck | RECOMMEND (new) | compliance calls stay human; card carries the why |
| `form.terms.html`, consent copy | **LOCKED** | legal |

### Quiz (only when a quiz exists AND is enabled — current gate kept)

| Field | Class | Notes |
|---|---|---|
| intro headline / subhead / ctaLabel | WRITE | already live |
| `quiz.reveal.gapTemplate` (120) · `valueExchange` (160) · `ctaSubtext` (120) | WRITE (new) | static paths, plain copy |
| `quiz.scoring.readiness.label` (40) | WRITE (new) | gated on readiness enabled |
| questions / options / profiles / scores | **Phase 3** | "Draft my quiz" is its own mode with referential-integrity validation (see §7) — not this round |

### Theme — no change (full-mode looks own it).

### Distribution — the headline change

**Content (WRITE — and the conditional gates are REMOVED, see §3):**

| Field | Limit | Notes |
|---|---|---|
| `distribution.marketplace.title` (consumer title) | 120 | the empty 0/120 field in the screenshot — top gap today |
| `distribution.marketplace.valueLine` | 80 | already whitelisted; gate loosened |
| `distribution.marketplace.inclusions` | ≤8 × 120 | new **array** value (dedicated response key) |
| `distribution.marketplace.imageAlt` | 120 | |
| `distribution.marketplace.dataUse` / `cancellation` | 400 each | descriptive content blocks, review-gated (Open call #1) |
| `distribution.featuredDrop.title` | 40 | gate loosened |
| `distribution.featuredDrop.valueLabel` / `emoji` | 12 / 8 | valueLabel fact-gated (never invent a price — existing guardrail) |

**Metadata (PICK — enums from `backend/src/utils/marketplaceContent.js`, the
source of truth; the AI service imports them, no third copy):**

| Field | Allowed values |
|---|---|
| `distribution.marketplace.category` | `CONSUMER_CATEGORIES` (10) |
| `distribution.marketplace.offerType` | `OFFER_TYPES` (5) |
| `distribution.marketplace.mode` | `MODES` (3) |
| `distribution.marketplace.qrLanding` | `form` \| `offer` |

**Publication decisions (RECOMMEND — never in Apply-all):**

| Topic | Card content |
|---|---|
| `listMarketplace` | flip advice + why, **grounded in the live 7-key gate** (slug/active/listing/host/type/ops); if `supportedType` is false (quiz / guided_review campaigns) the card must say listing is unavailable, not recommend it |
| `featureDrop` | homepage-feature advice (consumer-brand fit, drop dates) |
| `customerHost` | redeem vs mktr with blast-radius note (chrome, pixels, regulatory copy, email brand — and copy voice was generated for the current host) |
| `slug` | suggested slug (must match `^[a-z0-9-]{3,80}$`); **prefills the slug draft only** — the slug has its own save path and a permanent post-activation lock, AI never saves it |
| `qrLanding` / form-gate / field advice | strategy notes |

Per-card **Apply** is allowed for the two toggles + host (writes the unsaved
doc; Save + server publication gate remain the real enforcement — listing
exposure is still `applyMarketplacePolicy` admin-gated on the server).
Slug Apply = prefill only.

**Stays out:** ages/days/slots (business facts AI can't know — at most echoed
from campaign min/max age), school levels, activation, sponsor, FAQ (ops/JSON
per §03), `luckyDraw` (ops-owned).

---

## 3. Design decisions

1. **Kill the "surface must already be on" gates for drop/marketplace copy.**
   Rationale: the F6 "latent overwrite" guard existed because you'd accept copy
   you can't see. The Studio canvas has dedicated `CanvasDropSubject` /
   `CanvasMarketplaceSubject` previews, and the whole point of the ask is to
   fill details *before* flipping the publication switches. Storing the copy is
   harmless (it renders only when listed/enabled). Changes both the server
   `when` clauses and the frontend mirror `rowDisabledReason` (studioLooks.js)
   — these are hand-kept twins, update together + tests. Quiz gating stays
   (writing quiz copy with no quiz object is meaningless).
2. **Mixed value types via separate response sections, not anyOf rows.**
   Strict json_schema on both providers stays simple:
   `draft[]` (strings, as today) + `marketplaceMeta` (object of 4 nullable
   enums) + `inclusions` (nullable string array) + `recommendations[]`
   (topic-enum + advice + nullable suggestedValue). All properties required,
   nullable where optional — the established pattern in `fullModeSchema`.
3. **One provider call still fills everything** (budget stays 1 of 10/min).
   `maxOutputTokens` 8000 → 12000 for copy mode.
4. **Looks stay page-scoped.** A "look" is visual identity; identical
   marketplace metadata across 3 looks is noise. Distribution filling lives in
   the (renamed) first tab. Full-mode disclaimer text updated to match reality.
5. **Recommendations are grounded, not aspirational.** The server computes the
   same gate booleans as `previewMarketplaceCampaign` and passes them in the
   prompt context; guardrails forbid claiming a listing "will go live".
   `stripUrlish` applies to advice text (same smuggling net as media notes).
6. **Apply-all semantics:** applies WRITE rows + PICK rows + inclusions;
   **never** recommendations. The footer promise "never applies without your
   review" holds.
7. **No doc-schema changes** → no migration, no rollback surface, no lockstep
   edits. The emergency brake (`DESIGN_CONFIG_V2_WRITES_ENABLED`) is untouched.

---

## 4. Backend changes (PR 1 — additive, ships first, old frontend unaffected)

`campaignCopyAiService.js`:

- Widen `COPY_FIELDS` (+9 paths) with revised `when` rules; add
  `PICK_FIELDS` (4, values imported from `marketplaceContent.js`), the
  `inclusions` slot, and `REC_TOPICS`.
- `buildCampaignContext`: add current marketplace/drop values, slug +
  activation-lock state, campaign.type + `supportedType`, the 7 gate booleans
  (reuse the static-gate pieces + `composeOps` for `opsResolvable`), hasImage.
- New sanitizers: per-path enum clamp (first-wins dedupe), inclusions clamp
  (≤8 × 120, drop empties), recommendation clamp (topic enum, advice ≤240 +
  `stripUrlish`, suggestedValue validated per topic — slug regex, host enum,
  on/off). Unknown anything → dropped silently, as today.
- Prompt: extended guardrails (advisory framing, category-must-fit, no invented
  prices/values, host-voice note) + labeled enum options (id + human label) in
  the user payload.
- Response: `{draft, picks, inclusions, recommendations}` (copy mode).
  Old clients ignore the new keys. Scoped per-field requests (`scope`) extend
  to the new paths; `scope: 'distribution.marketplace.inclusions'` returns the
  array slot.
- Tests: whitelist/gating matrix, every sanitizer, context gate snapshot,
  schema strict-validity for OpenAI + Anthropic shapes.

## 5. Frontend changes (PR 2)

- `useStudioAi`: pick rows and the inclusions row join `sugs` with the same
  state machine (accept re-gate → `setPath`; keep-mine; scoped ↻); enum rows
  display human labels; inclusions render as a bullet list (accept replaces the
  whole array). Recommendations held in separate state; per-card Apply mutates
  the unsaved doc via `setPath`/slug-draft prefill; Jump deep-links the rail
  (`sectionFlags` pattern).
- `StudioAiPanel`: review list grouped by section (Page / Form / Quiz /
  Distribution) with per-section apply; recommendations section styled as
  advisory (no strike-through, no green APPLIED state — "Applied to draft"
  chip instead). Tab rename "Write the copy" → "Fill everything" (final naming
  = Shawn). Update the full-mode disclaimer (distribution is now written by the
  *other* tab, publication switches still never auto-flip).
- `studioLooks.rowDisabledReason`: mirror the loosened gates + new conditional
  paths (`content.media.alt` ↔ image, readiness label ↔ readiness enabled).
- `DistributionPanel`: per-field ✦ (`onSuggest`) on consumer title, value line,
  inclusions, drop title — same affordance PagePanel already has.
- Tests: row-type semantics, rec-cards never in apply-all, gate-mirror cases,
  panel snapshots; `verify` skill run on the Studio route.

## 6. Rollout

No flag needed (admin-only surface, additive API). Ship PR 1 → PR 2, verify on
a draft campaign (the screenshot's "Free Pet Hotel 1 Night Trial" is ideal: it
exercises empty consumer title, all four picks, both toggles off, no slug).
Update `campaign-studio-implementation-prompt.md` contract note + CLAUDE.md
Studio row (one line) + the §05 amendment note.

## 7. Phase 3 (separate scope, not this round): "Draft my quiz"

Full quiz generation (result profiles + questions + options + score maps +
weights) needs: per-campaign dynamic paths, referential integrity (every option
score → existing profile id; ≥2 options; profileOrder/rankFactor coherence —
`studioQuizView.js` helpers exist), and a proposal-style adopt UX (like looks,
previewed in the playable canvas quiz) rather than per-row review. Worth its
own design pass once 1+2 land.

Also parked: AI media *generation* (hero images via fal nano-banana-2) — the
current contract deliberately stops at art-direction notes.

## 8. Open calls for Shawn (recommendations inline)

1. **dataUse / cancellation / advertiserName as WRITE?** Rec: yes — they're
   descriptive (not statutory), review-gated, 400-char capped. Flip to
   RECOMMEND-only if you'd rather keep anything compliance-adjacent human-typed.
2. **Form gate/field advice as RECOMMEND cards this round?** Rec: yes (cheap,
   no writes). Cut entirely if the panel feels crowded.
3. **Per-card Apply on host** (vs jump-only)? Rec: allow, with the blast-radius
   note on the card.
4. **Tab naming** — "Fill everything" / "Design the whole page"?
5. **Phase 3 appetite** — schedule after PR 2 or park?

## 9. Estimates

| PR | Size | Notes |
|---|---|---|
| PR 1 backend | ~2/3 day + Codex round | service + sanitizers + tests; no route/schema-version changes |
| PR 2 frontend | ~1 day + Codex round | hook + panel + mirrors + tests + verify run |
| Phase 3 quiz | ~2 days | separate design doc first |
