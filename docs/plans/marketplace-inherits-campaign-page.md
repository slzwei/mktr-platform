# Marketplace inherits the campaign page — single-door content, structural parity

**Date:** 2026-07-22 · **Status:** v2 — Codex xhigh review folded (14 findings; disposition in §9) · **Owner intent (Shawn):** "marketplace should inherit the campaign page FULLY, with only one door to make edits. any edit made on the lead capture page MUST be reflected on the same campaign's marketplace sign up page."

## 0. The principle

Today the marketplace renders a second, hand-filled content set (`distribution.marketplace.*`). This plan makes every value that has a home on the campaign page **derived** from it at read time, then — after a verified soak — removes the duplicated inputs so drift becomes schema-impossible. Copy is edited in one place (the campaign page); placement facts that have no page equivalent stay in Distribution. The two **visitor** doors stay; the legal/mechanical single sources (terms version, OTP, draw gate) are already shared and untouched.

## 1. Field-by-field map (post-review)

### 1.1 Derived (page → marketplace)

| Marketplace output | Derived from | Rules |
|---|---|---|
| Listing title (`design_config.name`) | `content.headline`, via one `listingTitleOf` helper | falls back to `campaign.name` when the headline is empty or the "Get Started" default; the SAME helper feeds card, browse, search, image-alt fallback AND the Meta/TikTok tracking title (today analytics use the internal name — unify); Studio readiness warns on generic headlines |
| Offer description (NEW door block, `description`) | `content.story` | plain-text render, existing story cap |
| `value_line` | **facts, not copy**: draws → derived `luckyDraw.prize` summary (qty×name); non-draws → ops retail value ("Worth S$X · free …") | `content.emphasis` is NOT used (it's a story line, not a value fact — review §9.6) |
| Card/door image + `image_label` | `content.media` | **only when `media.kind === 'image'`**; video/youtube → no card image (placeholder tag); poster support = future note (§9.8) |
| Draw prize list (NEW `prize_breakdown[]`) | `luckyDraw.prizes` rows | rendered as **"Prizes"** on card/door — never through `inclusions`, whose "Includes ✓" framing implies every entrant receives them (§9.7) |
| Draw boost line (card box, door "How this draw works", flow confirmation) | facts from `ops.draw` → fallback `luckyDraw` (multiplier, boostClosesAt) + ONE shared frontend constant in `marketplace/content.js`, imported by `drawTemplates.jsx` too | neutral wording — "when your consultant **records** your completed session" (scan OR approved virtual confirmation both count — §9.11); replaces the hardcoded "activation step" phrasing |
| Door footer regulatory line (`regulatory_line`) | `content.footer.regulatory` | text render |
| `featuredDrop.title` | `content.headline` (clamped 40) | via the shared derivation used by BOTH marketplaceService and featuredDropsService (§9.9); `valueLabel` (12-char micro-copy) has no faithful source and STAYS a pick |

### 1.2 Placement picks & mechanical facts (stay in Distribution — no page equivalent)

`listed`, `category`, `offerType`, `mode`, `qrLanding`, `showCapacity`, `schoolLevels`, `dsaRelated`, `availability`, `sponsor`, `dataUse`, `cancellation`, `faq`, **`inclusions` (non-draw offers — describes offer contents, no page source; hidden for draws)**, **audience `age_range` (the OFFER's audience — a P3 enrichment trial's audience is the child; `campaign.min_age/max_age` is the adult SUBMITTER gate and must never masquerade as it — §9.2)**, **`activation.required/type/durationMins/summary/detail` for non-draw offers (mechanical requirement facts driving the flow's blocking acknowledgement — `composeOps` has no derivable source: `publicTitle` is the reward's name, not the required activity — §9.5)**, `featuredDrop.enabled/emoji/cap/endsAt/valueLabel`.

### 1.3 Already single-source (unchanged)

Terms (`form.terms.html` both funnels, pinned versions), OTP/consent/one-entry mechanics, draw facts, gates (`sgPr`/DNC/advisor), host choice, hero image on the page itself.

## 2. The choke point + explicit DTO contract

`deriveListingView(campaign, dc, ops)` in `marketplaceService.js` (pure, exported) emits the EXISTING flat consumer keys plus the new ones — exact contract:

`name` (derived title) · `description` · `regulatory_line` · `prize_breakdown[]` ({qty, name}) · `value_line` · `image_url`/`image_label` (image-kind only) · unchanged pass-throughs for every §1.2 pick · unchanged `termsContent`/gates/flow keys.

Sanitization: derived strings clamped to the existing listing caps; all values plain text. Consumers: OfferCard, MarketplaceBrowse, MarketplaceOffer (incl. tracking via `listingTitleOf`), MarketplaceFlow, featuredDropsService (shared derivation). QR tracker verified clean — reads `qr_entry` + static gate only (§9-clean).

**Freshness:** door/detail composes live per request → Studio saves reflect immediately; public list ≤60s (server cache, invalidated on campaign save) + ≤60s client cache; featuredDrops cache gains the same save-invalidation (today it has none — §9.9). Flag flips invalidate both caches (cache identity includes the flag).

## 3. Rollout — three phases, reversibility preserved (§9.3)

| Phase | Scope | Reversible? |
|---|---|---|
| **A — derivation, read-precedence only** (backend, `MARKETPLACE_INHERIT_ENABLED` default off → verified on) | `deriveListingView` + new DTO keys + shared featuredDrop derivation + cache invalidations. Stored listing copy KEEPS persisting exactly as today (clamp untouched); the flag only changes read precedence (derived wins). Flag-off = byte-identical old reads — a true brake. Dual goldens: the existing flag-off oracle stays frozen; a NEW flag-on derivation golden is added (§9.12). | Fully |
| **B — single-door UI** | BOTH editors converted (Studio DistributionPanel AND the classic MarketplacePanel — the classic editor still edits every derived field and would silently lose writes otherwise, §9.10): picks + a read-only "Inherited from the campaign page" preview. Preview of UNSAVED docs uses a client twin of `deriveListingView` (lockstep-tested against the server fn, same pattern as the designConfigV2 twins). AI "Fill everything" contract shrinks in the same PR: prompts, context echo, strict schema, INCLUSIONS scope (draws), sanitizers, useStudioAi apply paths, and the Studio/Distribution/canvas tests together (§9.13). Door gains the description block + derived wordings. ALSO (from §9b.6): the client `listingTitleOf` helper unifying visible/search/alt/tracking titles, and the generic-headline readiness warning. | UI-only |
| **C — destructive cleanup** (after A+B soak ≥ a week) | Clamp/normalizers stop accepting the derived-copy keys (both twins + goldens re-pinned); stale stored keys strip on next save. Only NOW does single-door become schema-enforced — and only now is rollback no longer trivial, by explicit sign-off. | By design, no |

## 4. Test matrix (from review §9.14 — pinned, not hoped)

- Parity contract: content-filled doc, no listing copy → DTO mirrors page; **edit content → DTO changes** (the MUST in one assertion).
- Flag on/off × v1/v2 docs × list/detail/preview; warm-cache transitions incl. stale-on-error; flip invalidation (marketplace + featuredDrops).
- Precedence in Phase A: stored copy present → stored wins only when flag OFF.
- Classic editor + unsaved Studio preview (client-twin lockstep).
- Audience age vs submitter gate: school-level label precedence + browse age filtering unchanged.
- Activation-required acknowledgement (non-draw) renders operator facts; draws render derived wording; singular/plural prize rendering; "Prizes" never says "Includes".
- Media kinds: image/video/youtube/none → card image only for image.
- Visible title vs tracking title unified via `listingTitleOf`; generic-headline readiness warning.
- Derived description/regulatory caps + no-leak (public whitelist negative tests updated).
- QR routing unchanged under the flag.
- Rollout diff script: before/after DTOs for EVERY listed campaign (not a hardcoded pair), reviewed pre-flip; remediation = page-content edits.

## 5. Explicit exclusions from the parity promise

Generic marketplace brand surfaces (homepage hero annotation, How-It-Works steps, static explainer pages, FAQ copy in `content.js`) are brand copy, not campaign copy — they keep their own wording (§9.11). The visitor-facing funnels stay two doors. Quiz/guided-review remain unlistable types.

## 6. Sizing

Phase A: M · Phase B: M–L (two editors + AI contract + twin) · Phase C: S. Each phase is one PR with its own Codex diff review.

## 9. Review log — Codex (gpt-5.6-sol, xhigh), 2026-07-22, 14 findings

| # | Sev | Disposition |
|---|---|---|
| 1 | BLOCKER | **False positive — stale checkout.** Reviewed from the shared tree ~20 commits behind; `luckyDraw.prizes` (#232) and `drawTemplates.jsx` (#226) exist on origin/main. Verified. Process note adopted: **Codex reviews must run from a synced worktree.** |
| 2 | BLOCKER | Adopted — audience age stays a pick; never derived from the submitter gate (§1.2). |
| 3 | BLOCKER | Adopted — three-phase rollout; Phase A is precedence-only with persistence untouched; caches flag-aware; destructive removal isolated in Phase C (§3). |
| 4 | MAJOR | Adopted — explicit DTO contract + `listingTitleOf` unifying visible titles and tracking (§2). |
| 5 | MAJOR | Adopted — non-draw activation facts remain operator inputs; only draw wording derives (§1.2). |
| 6 | MAJOR | Adopted — emphasis dropped as a value source; value derives from prize/retail facts; generic-headline readiness warning (§1.1). |
| 7 | MAJOR | Adopted — `prize_breakdown` rendered as "Prizes", never `inclusions` (§1.1). |
| 8 | MAJOR | Adopted — image-kind-only derivation; poster policy deferred explicitly (§1.1). |
| 9 | MAJOR | Adopted — shared derivation for featuredDrops + save/flip invalidation; `valueLabel` stays a pick (§1.1, §2). |
| 10 | MAJOR | Adopted — classic MarketplacePanel converted in Phase B; unsaved previews via lockstep client twin (§3B). |
| 11 | MAJOR | Adopted — neutral "records your completed session" wording, `ops.draw` precedence, generic surfaces excluded (§1.1, §5). |
| 12 | MAJOR | Adopted — dual goldens (frozen flag-off oracle + new flag-on golden); twins/archived round-trips untouched until Phase C (§3A). |
| 13 | MAJOR | Adopted — full AI contract removal enumerated into Phase B (§3B). |
| 14 | MAJOR | Adopted — §4 test matrix. |

## 9b. Phase-A diff review — Codex (gpt-5.6-sol, xhigh), 2026-07-22, 9 findings

| # | Sev | Disposition |
|---|---|---|
| 1 | BLOCKER | Adopted — both caches are mode-tagged (inheritance flag in cache identity, stale-on-error included). |
| 2 | MAJOR | Adopted — invalidation bumps a generation; refreshes commit only when their generation still holds; in-flight promises from older generations are not reused. |
| 3 | MAJOR | Adopted by DOCUMENTATION — the featured-drops save-invalidation stays unconditional: it is a deliberate freshness bug-fix (stale tiles pre-dated this plan). Amended guarantee: flag-off read RESULTS are byte-identical; cache freshness improves regardless. |
| 4 | MAJOR | Adopted — the marketplace DTO never carried `imageUrl` at all (pre-existing gap, runtime-verified); the overlay now inherits the page hero as the card image (image-kind only, both versions) and applies image-kind precedence to `image_label` incl. v1 docs. |
| 5 | MAJOR | Adopted — `featuredTitleOf`: flag-on = derived headline else campaign name (stored drop title never wins); flag-off = stored-first, unchanged. |
| 6 | MAJOR | Part-adopted — generic predicate narrowed to exactly the template default ("Get Started"). Client `listingTitleOf` (tracking/search unification) + the generic-headline readiness warning are PHASE B items, now named in §3B. |
| 7 | MAJOR | Adopted — derived value_line clamps to the 80-char cap; full names live in `prize_breakdown`. |
| 8 | MAJOR | Adopted — script rewritten: listed-gate filter, full key-union DTO diff incl. effective title + card image, separate featured-drop title diff for every enabled drop. |
| 9 | MAJOR | Adopted (backend half) — toDto-level flag on/off tests, cache mode/generation tests, featured-title rule tests, media-kind positives incl. v1, value-cap and "Sign Up"-is-valid cases. Endpoint-level matrix + script fixture noted for Phase B/C hardening. |

## 9c. Phase-B diff review — Codex (gpt-5.6-sol, xhigh), 2026-07-22, 7 findings + two-flag matrix

| # | Sev | Disposition |
|---|---|---|
| 1 | MAJOR | Adopted — the client twin mirrors the backend prize normalizer exactly (trim+cap names WITHOUT whitespace-collapse, qty 1–99 coerce, ≤8 rows, summary from normalized rows); the lockstep now builds its server input through the REAL `publicLuckyDraw` and pins dirty-row + all-media-kind fixtures. The lockstep caught one genuine drift (whitespace collapse) before merge — working as designed. |
| 2 | MAJOR | Adopted — the classic editor detects draws from the CAMPAIGN row (its doc strips luckyDraw), hides the inclusions box correctly, and gains the read-only inherited preview (recombined preview doc). |
| 3 | MAJOR | Adopted — Fill-everything omits draw inclusions end to end under inheritance (prompt meta, strict schema, result assembly), stored derived-copy echoes go blank in the model context, and the Studio apply path refuses the four derived paths + draw inclusions at receipt AND apply (`rowDisabledReason`). |
| 4 | MAJOR | **Adopted by DOCUMENTATION** — the neutral "records your completed session" wording is a deliberate COPY BUG FIX (virtual-session entrants were told a scan is mandatory), unconditional like Phase A's featured-drops freshness fix. The tracking-name unification (content_name = listing title when one serves) is likewise deliberate and flag-independent; real-world flag-off delta is nil today (no live campaign has a stored listing title that differs from its headline). |
| 5 | MAJOR | Adopted — the featured-drop canvas previews the derived tile title via the client twin; the generic-headline readiness warning now also covers featured-only campaigns. |
| 6 | MINOR | Adopted — `regulatory_line` renders after the FAQ, at the true bottom of the door column. |
| 7 | MINOR | Adopted in part — lockstep dirty/media fixtures, canvas flag-on tests, AI everything-mode omission test added; full tracking-payload + classic-panel render matrix noted for Phase C hardening. |

**Two-flag matrix (runbook):** both flags flip together. Off/Off = legacy reads + legacy editors (wording/tracking fixes stay, deliberately). On/On = single-door. Off/On = editors preview inheritance while the server still serves stored copy (harmless, temporary). On/Off = served copy is inherited while editors still show dead inputs (avoid; flip frontend first is the safe order: VITE first, backend second — or same deploy).
