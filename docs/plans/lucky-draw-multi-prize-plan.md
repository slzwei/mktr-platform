# Lucky Draw — structured multi-prize (qty × name) — implementation plan v2

**Date:** 2026-07-22 · **v1** written against `origin/main @ 482e305` (#230); **v2** folds the Codex CLI adversarial review (gpt-5.6-sol, xhigh) after verifying every finding against the code. Baseline for implementation: `origin/main @ 04898a1` (#231; no overlap with these files).
⚠️ File:line references are origin/main. Implement in a **disposable worktree** — the shared checkout has unrelated uncommitted work.

## 0. Codex review disposition (v1 → v2)

Codex verdict on v1: **REDESIGN** — "either ship the multi-winner engine now or keep multi-quantity campaigns impossible to activate until that engine exists." v2 adopts the second arm (fail-closed gates) and keeps the storage design, which Codex confirmed sound.

| # | Codex finding | Verified? | v2 action |
|---|---|---|---|
| B1 | **BLOCKER** — multi-winner campaigns can launch but the draw engine is single-winner: `createDraw` copies only dates/multiplier (`luckyDrawService.js:162`), a second pick is refused once any attempt is `claimed` (`:451`), claim makes the draw terminal (`:559`); readiness draw issues are warnings by design (`campaignReadinessService.js:188+`) and activation `force` skips readiness entirely (`campaignController.js:119`) | CONFIRMED in code | **Fail-closed gates** (§3.5): non-forceable 422 `DRAW_MULTI_PRIZE_UNSUPPORTED` at every activation path (create-with-`is_active` — note the API defaults it to *true* (`campaignService.js:377`), update, `setCampaignLaunchState`) and at `createDraw`; plus a `critical` readiness issue for UI visibility. Multi-prize campaigns save as **drafts** (workspace already creates `is_active:false`, `AdminCampaignWorkspace.jsx:71`); launching one needs the Phase-3 engine. Single-total-prize campaigns are fully live today. |
| M1 | Customer-facing singular copy missed: drawTemplates `:87` (`closedBody` in the shared `drawStrings`), `:208` Gazette "One winner", `:510` Nightfall "Winner contacted directly", `:733` Checklist "One winner drawn after…"; both confirmation-email variants "we contact the winner" (`confirmation-email-draw.html:148`, `.txt:9`); marketplace prints "1 winners" for winners=1 (`MarketplaceOffer.jsx:205`, `MarketplaceFlow.jsx:934` — latent today, universal once winners is derived) | CONFIRMED | §3.6: count-aware `drawStrings` (all four spots), count-neutral email rewording ("If you win, we'll contact you directly…"), shared `winnersSentence(n)` helper for both marketplace sites, chooser copy update |
| M2 | T&C award-order wording wrong for qty>1 rows ("first name drawn receives the first listed prize" maps names to rows, not units); "Three (3) $100 FairPrice Voucher" grammatically singular; "winner's masked details" not pluralized | CONFIRMED (wording defect in v1 §3.2) | §3.2 rewritten: exhaust-each-quantity award rule, `Three (3) × $100 FairPrice Voucher` item format, "each winner's masked details" |
| M3 | 240-char summary cap silently truncates (true max ≈693: 8×(4+80)+7×3); v1 both claimed no truncation and permitted it; also raising the shared `MAX_PRIZE` would lengthen public output for any legacy manual prize >80 (public DTO re-normalizes every read, `publicDesignConfig.js:41`) | CONFIRMED | §3.1: **`MAX_PRIZE` stays 80 for legacy manual `prize`** (zero legacy drift); derived summary is bounded by construction (≤693) and stored un-sliced with a 700 belt cap; consumers that need short text truncate visually (CSS), never data |
| M4 | `prizes: []` (or all-invalid) on an admin PUT silently downgrades a structured campaign to manual mode | CONFIRMED (v1 §4 row 3 was wrong) | §3.4: write-path 422 `DRAW_PRIZES_INVALID` when an admin's incoming `luckyDraw` *includes* a `prizes` key that normalizes empty; read paths still treat it as absent (never throw on stored data) |
| m5 | `type=number min/max` native validation can block submit before the promised coercion runs; extra rows must not be `required` | CONFIRMED (behavioral) | §3.3: clamp qty on change/blur; only row 1's name is `required`; empty extra rows dropped at submit; tests drive a real button click |
| m6 | Missed consumers: chooser advertises "One prize" (`CampaignTypeSelectionDialog.jsx:46`); admin surfaces read `winners`; v1 misattributed `drawTemplates:230` to Stub (it's the Postcard chip; Stub `:574+` renders no prize) | PARTIAL — chooser + line corrections confirmed; `dashboardService.js:255` block reads `enabled/closesAt` only (not winners); `AdminV2CampaignDetail.jsx:89` does read winners but is already plural-safe | §2.4 inventory corrected; chooser copy updated; no admin-surface code change needed (derived winners is more correct there) |
| — | Codex confirms: save-path coherence (create `:404`/update `:549`/duplicate `:826` all clamp; Studio v2 passthrough + backend clamp policy; non-admin cannot inject/strip; public DTO re-normalizes), no hidden 80-cap consumer, per-name escaping, legacy-signature adaptation, terms never regenerated on later saves (`campaignService.js:151`) | — | v1 §2 claims stand |

## 1. Problem

The lucky-draw create flow (#230) takes the prize as one free-text string. Shawn wants structured entry — quantity × prize name, multiple rows: **(1) × iPhone 17 Pro, (3) × $100 FairPrice Voucher**. That implies real semantics: total winners = Σqty, prizes have an award order, the generated starter T&Cs must stop hardcoding "One winner", and — per B1 — the platform must not promise winners the draw engine cannot deliver.

## 2. Current state (v1 §2, corrected)

Unchanged from v1 except these corrections; see v1 history in git for the full walk-through:

- `design_config.luckyDraw` normalized by `normalizeLuckyDraw` (`backend/src/utils/luckyDraw.js`) on every write (v1 path `campaignService.js:404/549/826` via `clampDesignConfig`; v2 path `designConfigV2Clamp.js:355`) and on public reads (`publicDesignConfig.js:40`). Unknown keys stripped — `prizes` must be taught to the normalizer.
- Route-level Joi is not an obstacle: `design_config: Joi.object().optional()` (`validation.js:102/125`), no stripUnknown on campaign routes.
- **§2.4 consumer inventory (corrected)**: mailer `:373` (`{{prize}}`, escaped); AI copy `:213`; drawTemplates — `drawStrings()` subject at `:76`, **Postcard** chip `:230`, Gazette factRow `:351` (Stub renders no prize); singular-winner copy at `:87/:208/:510/:733`; both draw email templates (singular "the winner"); marketplace winners copy `MarketplaceOffer.jsx:205` + `MarketplaceFlow.jsx:934` (unpluralized "1 winners" hazard); `AdminV2CampaignDetail.jsx:89` (winners, already plural-safe); chooser "One prize" copy `CampaignTypeSelectionDialog.jsx:46`.
- **Draw engine reality (B1)**: one live draw per campaign; picks are `draw_attempts`; a `claimed` attempt is terminal for the draw; `createDraw` snapshots dates/multiplier only. Winner never stored on `draws`.
- Not affected (verified): entry gate (`prospectService.js:442-533`), studio readiness blocks, DrawEntry/terms models, redeem.sg/winners static content, guided-review sample copy.

## 3. Design (v2)

### 3.1 Schema & derivation

```
luckyDraw.prizes = [ { qty: int 1..99, name: string 1..80 }, … ]   // ≤ 8 rows, order = award order
```

- `prizes` canonical when present & non-empty. Then server-derived, overwriting client input:
  - `prize` := compact summary — qty 1 → `name`, else `` `${qty}× ${name}` ``, joined `' + '`. **Not sliced to MAX_PRIZE**; bounded by construction ≤693, belt-capped at `MAX_PRIZE_SUMMARY = 700`. (M3)
  - `winners` := `Math.min(Σqty, 1000)`.
- Legacy (no `prizes` key): `prize` manual, cap **stays `MAX_PRIZE = 80`** — no behavior change for any stored row (M3); `winners` manual as today.
- New constants: `MAX_PRIZE_NAME = 80`, `MAX_PRIZE_ROWS = 8`, `MAX_PRIZE_QTY = 99`, `MAX_PRIZE_SUMMARY = 700`.
- New exports from `utils/luckyDraw.js`: `derivePrizeSummary(prizes)`, `totalPrizeQuantity(normalizedLuckyDraw) → int` (0 when no prizes) — the gate predicate (§3.5).

### 3.2 Starter T&C wording (`drawTermsTemplate.js`) (M2)

- Signature: `buildDrawTermsHtml({ campaignName, prizes, prize, closesAt, boostClosesAt, multiplier })`; legacy `prize` string adapts to `[{qty:1, name}]`. **Byte-identical output for the legacy single-prize call** (regression-tested with exact equality).
- `numberWords(n)` 1..99 ("One", "Three", "Twenty-five"), used as `Three (3)`.
- Prize clause — one prize-unit total: today's sentence unchanged. Multi: `<p><strong>Prizes:</strong></p><ol><li>One (1) × iPhone 17 Pro</li><li>Three (3) × $100 FairPrice Voucher</li></ol><p>Prizes are not exchangeable for cash and are subject to availability and any conditions advised to winners.</p>` — each name individually escaped.
- Draw clause — total = Σqty. 1: verbatim today. >1: `"Four (4) winners are drawn at random from all verified entries after the entry period closes, in a process witnessed by MKTR staff. Prizes are awarded in the order listed above, with each prize awarded the stated number of times before the draw moves to the next — the first winners drawn receive the first listed prize until its quantity is exhausted, and so on. Each verified mobile number can win at most one prize."` (exhaust-quantity rule — matches future attempt→unit mapping; the one-prize-per-person line is flagged to counsel, review already queued).
- Notification clause >1: "Winners are contacted directly by phone or SMS using the details provided, and each has fourteen (14) days to respond and claim. If a prize is unclaimed within 14 days, a replacement winner is drawn for that prize. Results are posted, with **each winner's masked details**, at redeem.sg/winners."
- Boost sentence unchanged.

### 3.3 Form UI (`CampaignDetailsTab.jsx`, draw card, create-only as today) (m5)

- state `drawPrizes: [{ qty: '1', name: '' }]`; row = qty `<Input type="number" min=1 max=99>` (clamped to 1..99 digits **on change/blur**, so native range validation can never block submit) × name `<Input maxLength={80} placeholder="e.g. iPhone 17 Pro 256GB">` + remove (rows>1); `+ Add prize` capped at 8; helper: "Row order is award order — top prize first."
- Only **row 1's name** is `required`; extra rows optional, empty ones dropped at submit; guard: ≥1 named row + closesAt.
- Payload: `luckyDraw: { enabled, prizes, prize: <client summary>, closesAt, boostClosesAt, multiplier }` (server re-derives authoritatively) + `termsContent: buildDrawTermsHtml({ campaignName, prizes, … })`.
- Summary line gains `· N winners` when Σqty > 1, plus a muted note when Σqty > 1: "Saves as a draft — multi-prize draws can't go live until multi-winner draw ops ship." (honest UI for the §3.5 gate).
- Placeholder changes to name-only (no more "One (1) …" in the name).

### 3.4 Normalizer & policy (`backend/src/utils/luckyDraw.js`) (M4)

- `normalizeLuckyDraw`: clean `prizes` (drop non-object rows, trim/slice names, coerce/clamp qty, cap 8); non-empty → set `prizes` + derived `prize`/`winners`; empty/absent → legacy branch. **Never throws** (runs on read paths).
- `applyLuckyDrawPolicy`: when `role === 'admin'` and the **incoming** `luckyDraw` object has a `prizes` key that normalizes to zero rows → throw `AppError(422)` code `DRAW_PRIZES_INVALID` ("prizes was provided but contains no valid rows — omit it for a manual prize, or fix the rows"). Stored-side garbage never throws (treated as absent). Non-admin unchanged (incoming ignored).

### 3.5 Fail-closed activation gates (B1) — new

Predicate: normalized stored/final `luckyDraw` has `enabled === true && totalPrizeQuantity(ld) > 1`. Typed error: `AppError(422)`, `data.code = 'DRAW_MULTI_PRIZE_UNSUPPORTED'`, message "This draw promises N prizes, but multi-winner draw execution isn't live yet — the campaign can be saved as a draft but not activated." Four enforcement points (server-side, none forceable):

1. `campaignService.createCampaign` — after `clampDesignConfig`, if `campaignData.is_active` would be true (**API defaults it true when omitted**, `:377`) and predicate holds → 422. Workspace draw-create is unaffected (sends `is_active:false`).
2. `campaignService.updateCampaign` — when `is_active` transitions to true; evaluate the **final** design (clamped incoming if provided, else stored).
3. `campaignService.setCampaignLaunchState('active')` — same check; this path is what `force` reaches (`campaignController.js:119` only skips *readiness*), so the gate is force-immune.
4. `luckyDrawService.createDraw` — refuse to mint a draw record for a multi-prize config (the engine can't deliver it).

Plus visibility: `campaignReadinessService` emits `level: 'critical'`, `code: 'draw_multi_prize_unsupported'` when the predicate holds (critical ⇒ `ready: false`, so the un-forced activate path 409s with a visible reason; the service gates make force irrelevant).

Removal path: Phase 3 (multi-winner engine: attempt→prize-unit mapping in row order, per-unit claim windows, N-winner publish) deletes the four gates + flips the readiness issue. `prizes[]` is already the engine's input contract.

### 3.6 Count-aware customer copy (M1) — new

- `drawTemplates.jsx` — `drawStrings()` gains `winners` (from `draw.winners`, default 1) and count-aware strings; fix the four spots: `closedBody` (`:87`), Gazette "One winner, drawn in a witnessed process" (`:208`), Nightfall "Winner contacted directly" (`:510`), Checklist "One winner drawn after {date}" (`:733`). Singular output byte-preserved when winners ≤ 1.
- Email templates (`confirmation-email-draw.html:148`, `.txt:9`): count-neutral rewording — "If you win, we'll contact you directly after the draw — and we never ask for payment to release a prize." (no new template fields).
- Marketplace: `winnersSentence(n)` helper exported from `src/pages/marketplace/content.js`; used at `MarketplaceOffer.jsx:205` and `MarketplaceFlow.jsx:934` — fixes the latent "1 winners" bug for any manually-set winners=1 today, and for derived single-prize configs tomorrow.
- Chooser (`CampaignTypeSelectionDialog.jsx:46`): "One prize, verified entries." → "Your prizes, verified entries." (rest unchanged).

### 3.7 Public exposure

`publicLuckyDraw` additionally exposes `...(ld.prizes ? { prizes: ld.prizes } : {})` (plain qty/name only).

## 4. Edge cases (v2)

| # | case | handling |
|---|---|---|
| 1 | Legacy campaigns (Tokyo): manual `prize`, no `prizes` | byte-identical: legacy cap stays 80, winners manual, no backfill |
| 2 | `prizes` + contradictory `prize`/`winners` from any client | normalizer overwrites both — cannot disagree |
| 3 | Admin PUT with `prizes: []` / all-invalid rows | **422 `DRAW_PRIZES_INVALID`** (M4); stored-side garbage reads as absent, never throws |
| 4 | Admin PUT sending `luckyDraw` *without* the `prizes` key while stored has prizes | incoming-wins-wholesale drops them — **existing semantics for every luckyDraw field** (same as closesAt today); Studio round-trips the doc verbatim so the real editors are safe; documented, not changed |
| 5 | XSS via prize name | per-name `escapeHtml` in T&Cs; email `{{prize}}` already escaped |
| 6 | Derived summary length | ≤693 by construction; belt 700; consumers ellipsize visually, data never silently loses a prize (M3) |
| 7 | Post-create prize edits (API) don't regenerate pinned T&Cs | same as today for every field; terms stay version-pinned (`campaignService.js:151`); Phase-3 review UI concern |
| 8 | Manual marketing `winners` vs derived | derived wins when prizes present (truth); admin detail tile already plural-safe |
| 9 | Non-admin PUT injecting/stripping prizes | policy ignores non-admin incoming — inherited |
| 10 | Multi-prize campaign tries to go live / mint a draw | 422 `DRAW_MULTI_PRIZE_UNSUPPORTED` at all four points (§3.5); UI note at create; readiness critical explains in Launch tab |
| 11 | `is_active` omitted on API create (defaults true) with multi-prize config | gate #1 catches it |

## 5. Tests

Vitest baseline at #231: **1686/1686** — full run stays green. Backend jest: touched suites only, baseline-diff vs origin/main (ECONNREFUSED-without-pg suites are inherited).

Backend:
- `luckyDraw.util.test.js`: prizes cleaning (invalid rows dropped, qty coercion/clamp, name slice, 8-row cap), derivation (`prize` summary incl. un-sliced long case, `winners` sum), overwrite-wins, legacy passthrough incl. >80 manual prize still sliced at 80, idempotence, non-admin ignore, `DRAW_PRIZES_INVALID` throw matrix (admin+key present+empty ⇒ throw; stored-empty ⇒ no throw), `totalPrizeQuantity`.
- `publicDesignConfig.test.js`: prizes exposed; ids still never leak.
- `designConfigV2StudioClamp.test.js`: prizes survive the v2 clamp.
- `luckyDrawService` suite: `createDraw` 422 on multi-prize (DI-mocked like neighbors).
- campaign service/controller suites (follow existing patterns): create-active 422 / update-to-active 422 / `setCampaignLaunchState` 422 (force-immune by construction), draft create OK; readiness emits the critical.
- Email templates: no `{{` orphan (existing template lint if present; else snapshot of reworded line).

Frontend:
- `drawTermsTemplate.test.js`: multi-prize `<ol>` + numberWords, exhaust-quantity award sentence, plural notification/masked-details, **exact-equality legacy regression**, escaping.
- `CampaignDetailsTab.test.jsx`: rows add/remove/cap, real-click submit with empty extra row + out-of-range qty (payload drops/coerces), refusal with no named row, single-row payload shape, multi-prize draft note renders.
- `drawTemplates.test.jsx`: winners:4 across all five templates ⇒ no "One winner"/singular strings; winners:1 ⇒ no "1 winners"/plural bleed.
- `marketplaceFlow.test.js` (+content): `winnersSentence(1|4)`.
- Chooser test: update copy assertion if it pins "One prize".

## 6. Rollout

Unchanged from v1: no flag, no migration, one PR (`feat(campaigns): structured multi-prize lucky draw (qty × name)`), disposable worktree, deploy-verify backend + mktr-platform static site (fresh deploys, chunk-grep), then live-verify: create a **draft** 2-row draw campaign on mktr.sg, confirm DB `prizes` + derived `prize`/`winners`, pinned terms v1 enumerates both prizes and the 4-winner draw clause, and activation of that draft returns `DRAW_MULTI_PRIZE_UNSUPPORTED`. Single-prize structured campaigns remain fully launchable.

## 7. Out of scope

- Multi-winner draw execution (Phase 3): attempt→prize-unit mapping, per-unit claim/redraw, N-winner publish + winners wall. The §3.5 gates are its placeholder and removal checklist.
- Editing prizes post-create in workspace/Studio (no luckyDraw editor exists post-create today).
- Rendering the structured list on public templates/marketplace (they use the derived summary; `publicLuckyDraw.prizes` makes it a follow-up).
