# Lucky Draw — Phase 3: multi-winner draw engine — implementation plan

> # ⚠️ v2 PARTIALLY IMPLEMENTED — see the disposition table before extending
>
> The v1 plan was rejected on 2026-08-15 (9 BLOCKERs + 9 MAJORs). Its core
> fairness proof in §3.6 was **false and empirically disproven**: 120,000 seeds
> over four equal entries drawing three winners gave a 2× bias on the third pick.
>
> **2026-08-16 — the engine shipped with the fairness blocker fixed.**
> `utils/drawSelection.js` derives a per-selection digest
> (`HMAC(baseSeed, "v2|drawId|unitIndex|attemptNo|counter")`) and samples by
> rejection rather than modulo. The bias is gone, and both halves are pinned in
> CI by `test/unit/drawSelection.test.js`, which asserts v1 IS biased (so the
> test cannot rot into a tautology) and v2 is uniform on the exact failing case:
>
> | pick | A | B | C | D |
> |---|---|---|---|---|
> | v1 3rd pick | 16.65% | 33.30% | 33.22% | 16.83% | ❌ |
> | v2 3rd pick | 25.01% | 25.08% | 24.98% | 24.93% | ✅ |
>
> **Shipped:** blockers 1, 4, 5, 7, 15, 16 in full; 3, 6, 9–12 in part.
> **NOT shipped — the gates around these still matter:** 2 (seal-time grinding
> entropy), 8 (published/redraw semantics), 13/14 (early-lapse bypass, witness
> enforcement), 17 (pre-deploy legacy audit), and the §3.7b/§4-case-9 copy and
> readiness polish. §0 rows carry the detail.

**Date:** 2026-08-15, implemented 2026-08-16 · migration **125** (the plan's "111" predates later merges).
⚠️ File:line references are the current checkout. Implement in a **disposable worktree** — the shared checkout has unrelated uncommitted work (DNC + Google Ads).

Phase 3 is the removal checklist named in `lucky-draw-multi-prize-plan.md` §3.5 / §7. That plan shipped the *storage* for `prizes: [{qty,name}]` and four fail-closed gates so the platform could never promise winners the engine cannot deliver. This plan ships the engine and deletes the gates.

**Driver:** Shawn wants the September campaign to award **5 × AirPods Pro 3** as five separate winners. Today that config saves as a draft and is non-forceably refused at every activation path.

## 0. Codex review disposition (v1 → v2 TODO)

Nine blockers. None are cosmetic; each independently prevents gate removal.

| # | Sev | Finding | Verified? | v2 action |
|---|---|---|---|---|
| 1 | **BLOCKER** | Seed reuse biases the sequence (§3.6 proof false) | **CONFIRMED empirically** — 120k-seed run, 2× bias on 3rd pick | Domain-separated derivation per selection: `HMAC(baseSeed, drawId‖unitIndex‖unitAttemptNo‖algoVersion)`, rejection sampling not modulo. `attempt.seed` stays the committed base seed, so `verifyDraw`'s commitment check is untouched — **my stated objection was wrong**. `algorithmVersion` keeps historical replay. Add the 4-entry case as an exact regression test. |
| 2 | **BLOCKER** | N picks widen seal-time grinding ~N× (`1/M` → `N/M` per trial); plaintext `sealedSeed` also lets any DB reader compute all winners pre-ceremony | Plausible — seed is minted before the seal txn | Commit a server nonce at seal, mix in entropy unavailable then (witness nonce chosen after commitment, or a public randomness beacon): `finalSeed = H(serverNonce‖witnessNonce‖poolHash‖rulesHash)` |
| 3 | **BLOCKER** | Redraw ORDER is an operator-chosen allocation lever once the seed is known | Sound — units share a global exclusion set, so they are not independent | Canonical redraw queue (failure-effective time, then unit index), fixed before picks are computed; serialize all selection per draw |
| 4 | **BLOCKER** | Multi-prize campaigns **still** fail activation after gate removal — `checkDrawConsistency` compares `prizes[0].name` vs derived `prize` (`"AirPods Pro 3"` ≠ `"5× AirPods Pro 3"`) → `DRAW_PRIZE_INTERNAL_MISMATCH`; the `Prize:` clause check also misses | **CONFIRMED in code** (`drawConsistency.js:100-126`) — masked until now because the gate blocked these campaigns first | Rewrite the lint BEFORE gate removal: compare `prize` to `derivePrizeSummary(prizes)`; validate each structured name+qty against the `<li>` rows |
| 5 | **BLOCKER** | Deleting `promisedWinnerCount` re-exposes legacy `{prize, winners:5}` (no `prizes[]`) — publicly promises 5, draws 1 | **CONFIRMED** (`luckyDraw.js:121-123` still allows manual winners) | Keep a fail-closed gate for unstructured `winners > 1`, or canonicalize to N units with a reviewed interpretation. Do not delete until nothing depends on it |
| 6 | **BLOCKER** | Snapshot alone is insufficient — only `closesAt` is write-locked, so prizes can change under a live draw and split entrants across contradictory pinned terms | **CONFIRMED** (`campaignDrawGuards.js:165-186`) | Hard-lock prizes/winnerCount/award order/multiplier/boost cutoff whenever a non-void draw exists; changes require void+recreate. Add `prizes`/`winnersCount` to the readiness query attributes (`campaignReadinessService.js:485`) |
| 7 | **BLOCKER** | Silent partial award contradicts the pinned T&C ("Five (5) winners are drawn", not "up to five") | **CONFIRMED** — and my §4 case 2 note was wrong: `freezeDraw` runs only after the cutoff, so entries cannot still arrive | Hard-stop the ceremony unless ≥ `winnersCount` eligible entries remain. Partial award needs counsel-approved prospective wording; existing pinned text cannot be changed retrospectively |
| 8 | **BLOCKER** | `published` draws can't fulfil the replacement promise — redraw allows only `sealed`/`drawn`, but claims are allowed while `published`; `published` is also outside `uq_draws_live_campaign`, so a second live draw can be created | **CONFIRMED** (`luckyDrawService.js:475`, `:606`, `Draw.js:81`) | Pick one rule: keep published draws operational (allow redraw, add to every live set + the index), or forbid publishing until all units resolve. Make publication a separate `publishedAt` dimension — today a final claim overwrites `published` |
| 12 | **BLOCKER** | `awardable = units ever attempted` is not a stable contract — allows early-terminal (3 of 5 claimed ⇒ `claimed`), permanent non-terminal, and zero-attempt limbo | Sound | Materialize `draw_prize_units(drawId, unitIndex, name, status)` with explicit states (`awaiting_claim`/`needs_redraw`/`claimed`/escalated). `claimed` must mean all `winnersCount` claimed |
| 16 | **BLOCKER** | Winners wall is not yet an implementation plan | Fair — §3.8 named the files but not the schema | Bring the wall fully in scope before gate removal; group by stable draw id; persist `publishedAt` + a publication manifest/hash |
| 9,10,11 | MAJOR | Write-skew on concurrent final claims (neither txn flips terminal); ceremony can pick a concurrently-erased entrant under READ COMMITTED; the two partial indexes allow one pending AND one claimed per unit, and enforce no entry-uniqueness or index bounds | Sound | `SELECT … FOR UPDATE` the draw row first, one global lock order; lock eligible entries inside the txn; add `UNIQUE(drawId, prizeUnitIndex) WHERE outcome IN ('pending','claimed')`, `UNIQUE(drawId, pickedEntryId)`, CHECK bounds, composite FK |
| 13,14 | MAJOR | 14-day rule still bypassable via early `unreachable`; "witnessed by MKTR staff" is not enforced at all | Sound | Forbid `unreachable → redraw` before deadline; validate a real active staff witness, executor ≠ witness, recorded at service level not CLI |
| 15 | MAJOR | Verifier cannot detect prize reassignment | Sound | Verify unit↔attempt binding, not just the pick |
| 17 | MAJOR | Migration backfill is only conditionally safe | Fair | Pre-deploy audit for legacy `winners>1`, duplicate pending/claimed, duplicate picked entries |
| 18 | MAJOR | Missed single-winner paths | **CONFIRMED** | `luckyDrawStatusService.js:343` (`anyClaimed` tells every unpicked entrant `not_selected_final` while 4 prizes remain), `run-lucky-draw.js:102`, `erasureService.js:631`, `campaignReadinessService.js:485`, `campaignTypes.js:49` |

**Accepted as sound:** prize-unit expansion matching the T&C award order; global exclusion as the one-prize-per-person mechanism; all-or-nothing ceremony *if* validation, reads, locks, picks, inserts and the transition all sit inside the transaction; the partial-index SQL is valid, just insufficient.

## 1. Problem

The engine resolves exactly ONE winner per draw:

- `createDraw` fail-closes on any multi-prize config (`luckyDrawService.js:175`) and snapshots only dates + multiplier.
- A pending attempt blocks any further pick (`:483-485`); a *claimed* attempt is terminal for the whole draw (`:487-489`).
- `recordAttemptOutcome` flips the DRAW to `claimed` the moment any single attempt is claimed (`:603-611`).
- Redraw `reason` must chain to the immediately prior attempt's outcome (`:490-503`) — a single global chain, not per-prize.

`prizes[]` is already the engine's input contract; nothing else about the storage layer needs to move.

## 2. Current state that Phase 3 must NOT disturb

Verified in code this session:

- **Freeze and seal are winner-agnostic.** Both operate on the entry pool only; neither mentions winners or prizes. No changes needed.
- **`verifyDraw` already replays a chain of picks with a growing exclusion set** (`:689-717`): it walks attempts in `attemptNo` order, rebuilds the eligible set minus all previously picked entries, and re-derives each pick. This generalises to N winners **unchanged** — the fairness proof comes along for free.
- **Commit-reveal** (`Draw.seedCommitment` / `sealedSeed`): the seed is committed at seal, before any pick is computed, and revealed at draw. Every attempt must hash to the commitment (`:518-522`, `:691`).
- **`computePoolHash` deliberately excludes `prospectId`** so a PDPA erasure does not read as pool tampering.
- **One live draw per campaign** — partial unique index `uq_draws_live_campaign` on `status IN (open,frozen,sealed,drawn)` (`Draw.js:77-82`). Multi-winner does not change this: one draw, N prize units.

## 3. Design

### 3.1 Prize units

A draw's `prizes` rows expand to an ordered list of **prize units**, one per awardable item:

```
prizes = [{qty:1,name:"iPhone 17 Pro"}, {qty:3,name:"$100 Voucher"}]
      →  units = [0:"iPhone 17 Pro", 1:"$100 Voucher", 2:"$100 Voucher", 3:"$100 Voucher"]

prizes = [{qty:5,name:"AirPods Pro 3"}]
      →  units = [0..4:"AirPods Pro 3"]
```

Row order is award order (already the stored contract, and already what the pinned T&C promises: "each prize awarded its stated number of times before the draw moves to the next").

New pure export in `backend/src/utils/luckyDraw.js`:

```js
expandPrizeUnits(prizes) → [{ index, name, rowIndex }]      // length = Σqty, ≤ 1000
```

One source of truth for expansion, unit-testable without a DB.

### 3.2 Schema — migration `111-multi-winner-draw-units.js`

`draws` (snapshot, mirroring how closesAt/multiplier are already frozen at createDraw — the campaign config must not be able to change what an in-flight draw is awarding):

| column | type | note |
|---|---|---|
| `prizes` | JSONB NULL | verbatim `luckyDraw.prizes` snapshot; NULL = legacy single-prize draw |
| `winnersCount` | INTEGER NOT NULL DEFAULT 1 | Σqty at createDraw; the engine's runtime authority (never re-parse JSONB in a hot path) |

`draw_attempts`:

| column | type | note |
|---|---|---|
| `prizeUnitIndex` | INTEGER NOT NULL DEFAULT 0 | which unit this attempt is awarding |

The `DEFAULT 0` / `DEFAULT 1` backfill is exactly right for every historical row: legacy draws have one unit, and all their attempts are that unit. **No data migration needed.**

Two partial unique indexes make the invariants unstorable rather than merely checked (the `uq_pc_one_live_primary` pattern from migration 109):

```sql
CREATE UNIQUE INDEX uq_da_one_pending_per_unit
  ON draw_attempts ("drawId", "prizeUnitIndex") WHERE outcome = 'pending';

CREATE UNIQUE INDEX uq_da_one_claimed_per_unit
  ON draw_attempts ("drawId", "prizeUnitIndex") WHERE outcome = 'claimed';
```

Mirrored on the model (`DrawAttempt.js`) per the sync-before-migrations test-boot lesson. `attemptNo` stays globally unique per draw (`uq_da_draw_attempt`) — the ledger stays append-shaped and `verifyDraw`'s replay order is preserved.

### 3.3 The ceremony — `runInitialDraw(drawId, { witnessUserId })`

**All N winners are picked in ONE witnessed transaction.** This is not a convenience: the pinned T&C says "*Five (5) winners are drawn at random from all verified entries after the entry period closes, in a process witnessed by MKTR staff*". Picking units on separate days over separate ceremonies would contradict the document every entrant accepted.

```
for unitIndex in 0..winnersCount-1:
    eligible = orderedEntries(entries)
                 .filter(prospectId != null && id ∉ pickedSoFar)
    if eligible is empty: break            // §4 case 2 — partial award
    picked = pickWinner(sealedSeed, eligible)
    create DrawAttempt { attemptNo: n++, prizeUnitIndex: unitIndex,
                         reason: 'initial', seed: sealedSeed,
                         totalChances, eligibleHash, pickedEntryId: picked.id,
                         claimDeadline: drawnAt + 14d, outcome: 'pending' }
    pickedSoFar.add(picked.id)
transition sealed → drawn
```

`pickedSoFar` is **global across units** — "*Each verified mobile number can win at most one prize*" is in the T&C. One transaction; a failure rolls the whole ceremony back.

`runDrawAttempt` keeps its name and signature for **redraws only** and gains `prizeUnitIndex`.

### 3.4 Per-unit redraws

Every guard in `runDrawAttempt` becomes scoped to the unit:

| guard | today | Phase 3 |
|---|---|---|
| pending blocks | any pending attempt on the draw (`:483`) | a pending attempt **on this unit** |
| claimed is terminal | any claimed attempt on the draw (`:487`) | a claimed attempt **on this unit** |
| reason chaining | must match the last attempt on the draw (`:494`) | must match the last attempt **on this unit** |
| first attempt | `reason === 'initial'` (`:501`) | unchanged, per unit |
| exclusion set | all previously picked entries (`:505`) | **unchanged — stays global** |

The exclusion set staying global is the one thing that must not become per-unit; it is what enforces one-prize-per-person.

### 3.5 Terminal state

`recordAttemptOutcome` no longer flips the draw to `claimed` on the first claim (`:603-611`). Inside the same transaction, after the attempt update:

```
claimedUnits = count(distinct prizeUnitIndex where outcome='claimed')
awardable    = number of units that ever received an attempt   // ≤ winnersCount, §4 case 2
if claimedUnits === awardable → Draw.status = 'claimed'
```

`claimed` therefore means *every awarded unit has been claimed*, preserving today's meaning (terminal-est state) for single-winner draws byte-for-byte. The `where: { status: ['drawn','published'] }` guard on the draw update stays — a voided draw still refuses a claim.

### 3.6 ~~Fairness: why ONE sealed seed is sound for N picks~~ — ❌ REFUTED, DISPROVEN EMPIRICALLY

> **This entire section is wrong.** Kept verbatim only so the error is legible and not repeated. See the §0 banner: 120,000-seed simulation of the real `pickWinner` shows a 2× bias on the third pick. Point (2) below is the specific falsehood — `H mod T` and `H mod T'` are *not* independent when the moduli share factors (`H mod 4 = 0 ⇒ H mod 2 = 0`). Replacement design: domain-separated per-selection derivation (§0 row 1).

Each attempt reuses the revealed `sealedSeed`; only the eligible set changes. This deserves an explicit argument because it looks like seed reuse.

`pickWinner` (`:91-102`) computes `value = sha256(seed) mod totalChances` and walks the chances-ordered list. Write `H = sha256(seed)`, a fixed 256-bit integer.

1. **Each pick is individually uniform.** `H mod T` is uniform over `[0,T)` up to modulo bias `≤ T/2^256`, which is immeasurable for any real pool. Every remaining entrant holds exactly its chances-weighted share of every subsequent prize unit.
2. **Successive picks are effectively independent.** Every pick removes an entry with `chances ≥ 1`, so the modulus **strictly decreases** at each unit: `T > T' > T'' …`. For `H ≈ 2^256` and `T ≈ 10^3`, `H mod T` and `H mod T'` for distinct moduli are computationally uncorrelated — the quotient is astronomically large, so a one-unit change in the modulus completely rescrambles the remainder.
3. **The threat model is unchanged.** The seed is minted and committed at seal, when the pool is already frozen, and cannot be re-rolled afterwards (`:518-522` fails closed on a commitment mismatch). Reusing it adds no new grinding surface.

Consequence: **`pickWinner` and `verifyDraw` need no cryptographic change**, and historical draws keep verifying exactly as before. Rejected alternative: per-unit derived seeds (`sha256(sealedSeed‖unitIndex)`) would be equally sound but breaks `verifyDraw`'s `sha256(attempt.seed) === seedCommitment` check (`:691`) for every existing row and buys nothing over (1)+(2).

`verifyDraw` gains two cheap structural checks only: every `prizeUnitIndex` is within `[0, winnersCount)`, and no unit has two claimed attempts.

### 3.7 Gate removal

Grep-confirmed exhaustive — exactly four call sites, three via one wrapper:

1. `campaignService.js:221` — `createCampaign`, guarded by `if (campaignData.is_active)`
2. `campaignService.js:386-388` — `updateCampaign`, guarded by `willBeActive` (`:384-385`)
3. `campaignService.js:553` — `setCampaignLaunchState`, force-immune (`force` skips readiness only)
4. `luckyDrawService.js:175` — `createDraw`, `assertSingleWinnerDraw(normalizeLuckyDraw(ld))`

Plus readiness: `campaignReadinessService.js:328-334` emits the `critical` / `draw_multi_prize_unsupported` issue; `:345` is how `critical` ⇒ `ready:false`; `:553` wires `drawTotalPrizes: promisedWinnerCount(ld)` into the facts. Delete the issue block; leave `:345` alone (generic machinery).

Dead after removal — delete with their tests: `assertDrawActivatable` (`campaignDrawGuards.js:143-147`), `assertSingleWinnerDraw` + `promisedWinnerCount` (`utils/luckyDraw.js:80-103`). Keep `totalPrizeQuantity` — §3.1 still needs it.

Also delete the honest-UI note added for the gate: *"Saves as a draft — multi-prize draws can't go live until multi-winner draw ops ship."* (`CampaignDetailsTab.jsx`; its assertion is `CampaignDetailsTab.test.jsx:299`).

### 3.7b Remaining hardcoded copy

Most customer copy is already count-aware from #232 (`drawStrings()` `drawTemplates.jsx:81-127`, `winnersDrawnSentence` `marketplace/content.js:304-311`, the whole T&C generator, both confirmation-email variants — which use count-agnostic "you" voice and need no change). Still hardcoded:

- **`CampaignPageRenderer.jsx:97`** — the generic `BlockedPage` fallback says "*Winners will be notified by SMS and email*", unconditionally **plural**, reading no count at all. This is a live mirror-image bug *today* (every single-winner campaign on a non-art-directed template already says "Winners"). Fix it to read `luckyDraw.winners` in this PR.
- `marketplace/content.js:35` (FAQ) and `:298` (`draw_closed`) — generic plural voice, not campaign-scoped. Low priority; reword count-neutral.
- `fulfilmentNotify.js:226` — ops-facing, internal. Low priority.
- `campaignTypes.js:49` — "one winner pool", dev-facing type description. Trivial.

### 3.8 Publish + winners wall — bigger than it looks

`markPublished` (`:620-635`) is winner-count agnostic already. The wall is not.

**`src/pages/redeemWinnersContent.js`** is hand-curated static content whose schema is *one array row = one winner* — flat scalars (`name`, `entry`, `prize`, `draw` label), no grouping concept for "this draw awarded N winners". **`src/pages/RedeemWinners.jsx:41`** does `const [latest, ...past] = WINNERS`, so exactly one winner becomes the hero card and the other four would scatter into the "past" grid, visually indistinguishable from unrelated draws. `WINNERS` is currently `[]` — the wall has never been populated.

Required:
- A grouping unit in the content schema — a draw row holding `winners: [...]` — so five AirPods winners render as ONE draw event with five masked names, not five orphan cards.
- Hero card renders a multi-winner draw as a group ("5 winners · AirPods Pro 3"), not `latest.name` alone (`:105` `${latest.name} takes it home`).
- Fixed singular copy at `RedeemWinners.jsx:36, 68-69, 102, 105, 116-117, 127, 163, 164, 165` ("the winner", "the person who took it home", the `Winner` stamp).
- **No test file covers `RedeemWinners.jsx` or `redeemWinnersContent.js` today** — new coverage lands with this change.

### 3.9 Read surfaces — and the ops reality

**There is no web admin/ops UI for the draw lifecycle at all.** Confirmed by exhaustive grep: zero hits for `createDraw`/`freezeDraw`/`sealDraw`/`runDrawAttempt`/`markPublished` across `backend/src/routes/**` and `backend/src/controllers/**`; `src/pages/redeemops/**` references no draw model. The only admin surface is `AdminV2CampaignDetail.jsx:138`, a read-only config echo (already plural-safe).

The entire lifecycle runs through **`backend/scripts/run-lucky-draw.js`** (`create/status/freeze/reviews/review/seal/draw/outcome/publish/verify/void`), documented in its own header as the ops tool "until the admin panel ships (Phase 5)". Its `case 'draw':` (`:102-123`) prints a single `result.picked` object — single-winner output shape.

Consequences for this PR:
- `run-lucky-draw.js` gains `--unit <n>` on `draw`/`outcome`, a new `ceremony` subcommand for the N-pick ceremony, and per-unit rows in `status`.
- `getDrawState` (`:722-745`): add `prizeUnitIndex` + resolved prize `name` per attempt, plus a per-unit rollup (`unit, name, status, winner`) so `status` can render N rows.
- ⚠️ **CONFIRMED operational gap — pre-existing, not caused by Phase 3, and it affects the draws already live.** `backend/.dockerignore` excludes `scripts/*` and whitelists exactly three (`sync-redeemed-audience.js`, `remap-observations.mjs`, `score-consumers.js`). **`run-lucky-draw.js` is not in the production image**, and there is no route, controller or UI for the lifecycle. So today there is *no server-side way to run any draw at all* — Tokyo (closes 31 Oct 2026) and the September draw included. Every ceremony must be executed locally against the prod `DATABASE_URL`.

  This is arguably acceptable for a *witnessed* ceremony (a human runs it anyway), but it is an undocumented dependency on one laptop holding prod credentials, and nobody has ever exercised it end-to-end in prod. **Decide explicitly before promising a draw date**: either (a) whitelist `run-lucky-draw.js` into the image so it can be run from Render Shell, or (b) document the local-run procedure and rehearse it once on a seeded pool. This is independent of Phase 3 and should not be bundled into it — but it must not be discovered on draw day.

`backend/src/routes/rewardClaim.js` (public claim page) is keyed one `RewardEntitlement` per prospect — already naturally per-winner, **no structural change needed**.

## 4. Edge cases

| # | case | handling |
|---|---|---|
| 1 | Legacy single-prize draws (Tokyo, iPhone) | `prizes` NULL, `winnersCount` 1, attempts unit 0 — every path byte-identical |
| 2 | Fewer eligible entries than prize units (5 prizes, 3 entrants) | ceremony awards what it can and stops; `awardable` < `winnersCount`; draw can still reach `claimed`. Surfaced in `getDrawState` and the wall; **must not** silently read as "5 winners" |
| 3 | Same entrant would win twice | impossible — global `pickedSoFar` |
| 4 | Redraw on unit 2 while unit 4 is still pending | allowed — units are independent after the ceremony |
| 5 | Two operators redraw the same unit concurrently | `uq_da_one_pending_per_unit` rejects the second |
| 6 | Campaign `prizes` edited after the draw record exists | engine reads the draw's **snapshot**, never the campaign; drift surfaces via the existing `checkDrawRecordDrift` (extend it with `prizes`/`winnersCount`) |
| 7 | Erasure between ceremony and redraw | unchanged — `eligibleHash` per attempt makes it visible to `verifyDraw` |
| 8 | Void mid-flight | unchanged — voids the whole draw, all units |
| 9 | `winnersCount` > pool at freeze time | readiness warning (not a block — entries can still arrive before close) |

## 5. Tests

Backend (jest — needs a real Postgres, see CLAUDE.md):
- `luckyDraw.util.test.js`: `expandPrizeUnits` (row order, qty expansion, cap, empty/legacy).
- `luckyDrawService` suite: ceremony picks N distinct entries in one txn; global exclusion holds; partial award when pool < N; per-unit redraw guards (pending / claimed / reason chain); claim on unit 1 does NOT terminate; claim on the LAST unit does; concurrent-redraw index rejection; **legacy single-winner regression: an existing 1-prize draw produces a byte-identical attempt row and lifecycle**.
- `verifyDraw`: N-attempt replay ok; tampered `prizeUnitIndex` flagged; historical draw still verifies.
- Migration test: 111 applies, defaults backfill, both partial indexes exist.
- campaign service/controller: multi-prize campaign now activates (the inverse of the gate tests — those get deleted, not edited).
- `campaignReadinessService`: no `draw_multi_prize_unsupported` critical.

Existing suites, by disposition (inventoried):
- `backend/test/drawMultiPrizeGate.test.js` — **delete entirely** (it exists only to pin the gates).
- `backend/test/luckyDrawService.test.js:198-216` — invert (createDraw now succeeds on multi-prize).
- `:517-570` (`runDrawAttempt` pending/claimed blocks) and `:572-605` (`recordAttemptOutcome` terminal) — rework to per-unit.
- `:146-177` (`pickWinner`/hashes) and `:607-765` (`verifyDraw`/commit-reveal) — survive unchanged; add N-attempt replay cases.
- `backend/test/luckyDraw.util.test.js` — drop the `assertSingleWinnerDraw`/`promisedWinnerCount` cases with the functions.
- `drawTermsTemplate` parity suites + `drawTemplates.test.jsx:140-181` + `marketplaceFlow.test.js:6-16` — already multi-winner aware, must stay green untouched (good regression signal).
- `CampaignDetailsTab.test.jsx:299` — the `multi-prize-note` assertion goes with the note.

**Coverage gaps this PR must close** (found by inventory, not previously known):
- No test drives `createCampaign` / `updateCampaign` / `setCampaignLaunchState` through their gate call sites with a real multi-unit `prizes[]` — they were only covered indirectly via the pure-function suite. Add real integration coverage of the now-ungated activation.
- **No test file exists for `setCampaignLaunchState` at all.**
- **No test file covers `RedeemWinners.jsx` or `redeemWinnersContent.js` at all** — the winners wall ships with its first tests.

Frontend (vitest, baseline currently 1883 green):
- Winners wall: multi-winner draw renders as one grouped event; single-winner unchanged; singular copy gone.
- `CampaignPageRenderer` BlockedPage: count-aware (and the pre-existing always-plural bug fixed).

## 6. Rollout

One PR, disposable worktree, migration 111. Deploy backend first (migration runs on boot), then the static sites. Live-verify on the **draft** iPhone/AirPods campaign:

1. Set `prizes: [{qty:5,name:'AirPods Pro 3'}]` → save (already allowed today).
2. Activate → must now succeed (previously `DRAW_MULTI_PRIZE_UNSUPPORTED`).
3. Confirm the draw record auto-mints with `winnersCount = 5` and the `prizes` snapshot.
4. Do NOT run a ceremony in prod until entries exist; verify on a seeded staging pool.

No feature flag: the gates being deleted ARE the flag, and a half-removed gate set is worse than either state.

## 7. Out of scope

- Editing prizes post-create in workspace/Studio (still no `luckyDraw` editor after create).
- Rendering the structured prize list on public templates (they use the derived summary; `publicLuckyDraw.prizes` is already exposed for a follow-up).
- Per-prize *different* claim windows (all units keep the 14-day promise).
- The counsel review of "each verified mobile number can win at most one prize" — flagged in the multi-prize plan, still queued.
