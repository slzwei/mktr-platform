# .review round-2 remediation — final record (Aug 2026)

The `.review/` dashboard tracked the 32-task queue from the **second**,
adversarial review of this repo (2026-08-02), run after the first 45-task audit
closed. **All 32 tasks are resolved.** This document is the exported final
state — written immediately before the scaffolding was deleted, since the
dashboard was only ever the interface to this record.

Every task shipped as its own CI-gated PR, squash-merged: **#365–#397**
(2026-08-02, autonomous run). One extra PR, **#380**, fixed a pre-existing test
flake that was blocking the queue; it is recorded below with the tasks.

Statuses: every task `done` = fix verified against the real defect, regression
test proven to fail before and pass after, CI green, merged to main. **Nothing
was blocked or skipped.**

## How each fix was proven

For behavioural tasks the standard was a test that **fails on the pre-fix code
and passes after** — captured by reverting the source (never `git stash`; this
is a shared checkout) and recording the actual failing output. For the five
structural tasks, where no behaviour changes by definition, the proof is instead
the **existing suites passing with zero test edits**, plus new coverage that was
impossible before the refactor.

## Three task-prompt claims turned out to be wrong

Verified against real code and a real Postgres rather than taken on trust. Each
is stated in its PR:

- **P2-9** — "has a frontend twin". No twin exists; only `luckyDrawCaps.js` is
  shared.
- **P2-12** — "6 sites 500 on a trailing backslash". Does not reproduce: every
  site wraps the term as `%term%`, so the backslash escapes the closing `%`.
  The *real* defect was the three redeem-ops sites that escaped nothing at all,
  where a bare `%` matched every partner.
- **P2-18** — "`defaultValue: DataTypes.NOW` (the WalletLedger pattern that got
  this right)". `DataTypes.NOW` is an ORM-side default that emits **no** DB
  default — probed directly, `column_default` came back null. It would have
  looked like a fix and changed nothing. `Sequelize.fn('NOW')` is what works.
  WalletLedger has the same non-default; the precedent was not a precedent.

**P3-4's premise was also wrong** — the task said there was no error boundary.
There was one, app-wide. The real defect was sharper and is recorded below.

---

## crit

### P0-1 — Upload sniffer trusts the client-supplied extension
- **Status:** done — PR #365 (merged `97d7eaf`)
- **Proof:** Sniffer now picks the stored extension plus an inline allowlist. New E2E suite: 6 of 8 FAIL pre-fix, 8 pass post-fix; 120 tests green across the upload/security/routes suites.

## high

### P1-1 — Redemption inventory double-decrements
- **Status:** done — PR #366 (merged `3ae3dcd`)
- **Proof:** Conditional `WHERE status='completed'`. Pre-fix double-decrement reproduced (expected 9, received 8); 70 redeemOps tests green.

### P1-2 — Inventory lost update under concurrency
- **Status:** done — PR #367 (merged `1d99e82`)
- **Proof:** Column-relative guarded UPDATE. Pre-fix lost update 52→47 with 0 of 1 rejections. CI caught an order-dependent assertion in my own test (the slower runner picked the other winner); rewritten to assert the invariant — exactly one rejection — rather than a specific winner.

### P1-3 — Retell path bakes an un-nulled hold target
- **Status:** done — PR #368 (merged `919ec9c`)
- **Proof:** Shared `bakeHoldTargetAgentId` in dncGate. Reverting only the Retell call site flips null → system-agent-id; 66 unit tests green.

### P1-4 — Call recording readable by any authenticated user
- **Status:** done — PR #369 (merged `e48371d`)
- **Proof:** `requireAgentOrAdmin` + `buildProspectWhere` scope. Pre-fix a customer AND a non-owning agent both got the recording URL (200); 235 tests green.

### P1-5 — Upload delete has no ownership or traversal check
- **Status:** done — PR #370 (merged `d02c5b3`)
- **Proof:** Admin gate + host guard + relative-path traversal check. 8 of 12 fail pre-fix — a customer actually deleted the file; 88 tests green.

### P1-6 — Rate limiting applied inconsistently
- **Status:** done — PR #371 (merged `6a86cf3`)
- **Proof:** `makeLimiter` factory over all 17 sites plus 8 bare auth doors. 11 fail pre-fix (19 direct `rateLimit` sites, 0 prefixes); unit tier 2,151 green.

### P1-7 — OAuth account linking binds a squatter row
- **Status:** done — PR #372 (merged `cb80c28`)
- **Proof:** Sub-first lookup + `assertSoftLinkable` + email-change re-verification. 5 fail pre-fix — the squatter row bound and a token was minted; 252 auth tests green.

### P1-8 — Wallet ledger has no DB-level integrity constraints
- **Status:** done — PR #373 (merged `0c14952`)
- **Proof:** Migration 102 adds CHECKs + ledger FKs via NOT VALID → VALIDATE. `down()` proves the before/after in-suite; 18 cases, migration tier 23 green.

## med

### P2-1 — External calls have no timeout and no retry
- **Status:** done — PR #374 (merged `9e8389e`)
- **Proof:** Shared `externalFetch` timeout + retry helper. 3 fail pre-fix (no Apify retry, no abort signal on either client); unit tier 2,182 green.

### P2-2 — One pending webhook delivery can be sent twice
- **Status:** done — PR #375 (merged `06bad9a`)
- **Proof:** Conditional pending→sending claim + stale-sending reclaim. Pre-fix the receiver got the hook TWICE and `attempts` was charged twice; 123 tests green.

### P2-3 — Webhook signature v1 is replayable
- **Status:** done — PR #376 (merged `e928319`)
- **Proof:** v2 default with an explicit v1 legacy pin for live subscribers. A replay is rejected under v2, accepted under v1. **Carry-over:** the dual-accept receiver patch is in `lyfe-app` (outside this repo) and must deploy before `LIVE_SUBSCRIBER_SIGNATURE_VERSION` flips to `'v2'` — runbook shipped in `docs/plans/webhook-signature-v2-cutover.md`.

### P2-4 — WhatsApp status redelivery rescores repeatedly
- **Status:** done — PR #377 (merged `4a48cce`)
- **Proof:** `RETURNING wamid` + real rowcount. Pre-fix 5 redeliveries fired 5 rescores, now 1. First CI red here was the suppression flake below, green on re-run.

### FLAKE FIX — PR #380 (merged `376f690`)
- **Proof:** `suppressionPropagation` — "a failed lead.unsuppressed delivery re-queues". Root cause: `consentService` fires a real fire-and-forget post-commit reconcile that repoints `pair.deliveryId` while the test drives its own spied pass, so the forced 'failed' hit a stale delivery. The test now settles before snapshotting. It had hit main at `06bad9a`, PR #376 and PR #377.

### P2-5 — Zero-penalty headroom unlocks a Buy score
- **Status:** done — PR #378 (merged `cd85871`)
- **Proof:** Pre-fix, uninsured-alone scored Buy = 0; now null. Product choice taken as the task recommended (null, not high); 60 scoring tests green.

### P2-6 — Expired enrichment leases are never reaped
- **Status:** done — PR #379 (merged `9adde21`)
- **Proof:** `reapExpiredLeases` + drain/sweep wiring. Without the drain-time reap the orphan stays `leased` forever; 37 tests green.

### P2-7 — Manual issuance fabricates a verification stamp
- **Status:** done — PR #381 (merged `e3479ef`)
- **Proof:** No fabricated stamp; an override must be explicit, reasoned and audited. Pre-fix an unverified phone was issued silently; 72 entitlement tests green.

### P2-8 — Draw seed is not committed before the draw
- **Status:** done — PR #382 (merged `d52af72`)
- **Proof:** Commit-reveal — hash committed at seal, seed revealed at draw. Pre-fix a swapped seed still verified OK (`report.ok` true); 119 draw tests green.

### P2-9 — Multi-prize winner count can under-promise
- **Status:** done — PR #383 (merged `c46bc5a`)
- **Proof:** `promisedWinnerCount = max(Σqty, winners)`. Pre-fix a legacy `winners: 5` activated with nothing thrown. **No frontend twin exists** — the task's twin note was wrong.

### P2-10 — Login lockout locks out the victim
- **Status:** done — PR #384 (merged `aeed887`)
- **Proof:** Durable (email × client) lockout on the Postgres counter. Pre-fix the VICTIM was locked out from their own client while the attacker was not; 260 auth tests green.

### P2-11 — PII reaches Sentry and the log stream
- **Status:** done — PR #385 (merged `310a93f`)
- **Proof:** `scrubText` over exception / message / breadcrumb plus `err.message` and `err.stack`. Pre-fix a raw email and phone reached BOTH Sentry and pino. Note: the pino stream sits outside the PDPA erasure matrix, which is why the scrub has to happen at write time.

### P2-12 — Search LIKE escaping is inconsistent
- **Status:** done — PR #386 (merged `40d8010`)
- **Proof:** One `escapeLike` across 9 sites. Pre-fix a bare `%` matched ALL partners on the three redeem-ops sites, which escaped nothing. The predicted trailing-backslash 500 does **not** reproduce (verified against real Postgres) — see the corrections above.

### P2-13 — Idempotency keys collide across scopes
- **Status:** done — PR #387 (merged `d6a9280`)
- **Proof:** Composite `(scope, key)` PK + 5-minute stale-claim takeover. CI caught the composite PK breaking `walletService`'s replay shield — `findByPk` returns **null** rather than erroring under a composite key, so a replay stopped replaying and returned 500 instead of the stored response (fixed `ec4824b`). The same discovery invalidated an assertion in `erasure.test.js` that was passing while proving nothing. Full integration tier 2,558 green.

### P2-14 — The two funnels validate SG mobiles differently
- **Status:** done — PR #388 (merged `9c7d8a0`)
- **Proof:** Shared `isValidSgMobile`, mobile-only `[89]`. 7 fail pre-fix — neither funnel imported the shared validator that already existed.

### P2-15 — Validation errors are never announced
- **Status:** done — PR #389 (merged `6bd9ae3`)
- **Proof:** `role="alert"` + `aria-invalid` / `aria-describedby` on both public funnels (WCAG 3.3.1 / 4.1.3). 3 fail pre-fix — no alert role, no field wiring.

### P2-16 — Admin lists flash empty between pages
- **Status:** done — PR #390 (merged `224ae93`)
- **Proof:** React-Query v5 `placeholderData: keepPreviousData` across 3 sites, including one the task did not list. 2 fail pre-fix, and the v4 `keepPreviousData: true` flag proven to be silently ignored — data dropped to `undefined`.

### P2-17 — Deleting an entitlement destroys its audit trail
- **Status:** done — PR #391 (merged `556beba`)
- **Proof:** Migration 105 flips both `redemption_events` FKs CASCADE → RESTRICT (NOT VALID → VALIDATE), with matching model associations; force-purge now deletes events explicitly. Pre-fix, deleting an entitlement silently removed 3 audit rows and the event read back null; post-fix it raises an FK violation.

### P2-18 — Payment timestamps diverge from the prod schema
- **Status:** done — PR #392 (merged `1c06212`)
- **Proof:** `Sequelize.fn('NOW')` defaults on 5 model-backed tables (`payments`, `agent_group_members`, `external_agents`, `external_campaign_agents`, `waitlist_signups`). 7 of 7 fail pre-fix — `column_default` null and the raw INSERT dies — 7 pass after. The prescribed `DataTypes.NOW` emits no DB default; probed and refuted (see corrections above).

## struct

### P3-1 — Decompose `createProspect` (~1,200-line function)
- **Status:** done — PR #393 (merged `b18cde1`)
- **Proof:** Two stages lifted verbatim — PERSIST → `prospectCreateTx.js`, DISPATCH → `prospectDispatch.js`. `prospectService.js` 1,736 → 1,307 lines; `createProspect` ~1,200 → ~780. Zero test edits: unit 129/129 suites (2,202 tests) and the full integration tier 147/147 (2,593). Plus 13 new DI unit cases covering gate precedence and dispatch suppression — impossible before, since as closures these were reachable only by driving a full HTTP capture against Postgres.

### P3-2 — Decompose `entitlementService` (1,377-line god-object)
- **Status:** done — PR #394 (merged `1091c9a`)
- **Proof:** Delivery, query and reconciliation split into their own modules; `entitlementService.js` 1,417 → 960 lines, public factory API byte-identical (`flushDeliveries` re-exported from its old home). Sweeps take `issueForProspect` / `queueDelivery` / `writeEvent` as injected functions so they drive the live paths instead of copying them. The duplicated `writeEvent` is now one shared `redemptionEvents.js` parameterised on the default actorType — 'system' vs 'staff', which is the entire meaning of an audit row. Zero test edits: 53 redeem-ops suites (766 tests), integration 148/148 (2,600). 7 new cases.

### P3-3 — Decompose `AdminV2LeadProfile` (1,966-line component)
- **Status:** done — PR #395 (merged `f71cf50`)
- **Proof:** Pure data layer → `src/lib/adminV2/leadHistory.js`; the Lead Score card and shared primitives → `src/pages/adminv2/leadProfile/`. Page 1,966 → 976 lines. 39 new cases on `buildHistory` / `heroFor` / `deliveryState`, which were module-private and effectively untested. **Verified non-vacuous:** three mutations to the moved logic (disabling the Meta 131049 branch, dropping the NaN-timestamp guard, reversing the sort) fail 5 of them. Frontend 145/145 files (1,847 tests), both brand builds green.

### P3-4 — Frontend type-safety + route error boundaries
- **Status:** done — PR #396 (merged `048d2ae`)
- **Proof:** The task's premise was wrong — a boundary already existed, wrapping the whole router. Written for lazy-chunk load failures, it fails three ways on a render throw: it blanks the **entire** app including the chrome; its copy blames the connection and its Retry is `window.location.reload()`, which re-fetches the same data and throws again; and it **swallows the error from Sentry** (React stops propagation at the nearest boundary, and the old one only `console.error`'d — so every render crash in this app has been invisible in Sentry). `RouteErrorBoundary` now sits inside the surface chrome for admin-v2 and redeem-ops, resets in place, clears on navigation, and reports to Sentry tagged by surface. PropTypes added to the shared exports (`adminv2/primitives`, 21 importers; `MobileSheet`; `MobileBars`), chosen over the JSDoc option because `jsconfig.json` has no `checkJs`. 7 new cases; frontend 145/145 (1,815 tests), zero PropTypes warnings, both brand builds green. **Open decision for the maintainer:** React 19 drops PropTypes support — this is correct today but one major from being dead weight, which is the real argument for the TypeScript bootstrap the task floats.

### P3-5 — Hot-path metrics / tracing
- **Status:** done — PR #397 (merged `bfcaf25`)
- **Proof:** Six signals wired where each path funnels: `lead.captured` / `.delivered` / `.held` in `prospectService`, `webhook.delivery.attempted` / `.failed` / `.duration` in `webhookService`, and `external.call.duration` / `.retried` / `.failed` at `utils/externalFetch` — the single transport P2-1 already gave WhatsApp and Apify, so one insertion point covers both. `delivered` and `held` partition every capture, which is what makes the starving rotation readable: held climbing while delivered stays flat. Read at `GET /health/metrics`; documented in `docs/reference/hot-path-metrics.md`. 14 new cases driving the real paths (a real HTTP capture, real webhook attempts with timeout and http_error kept apart, an exhausted external call counted as failed while a 4xx is not). Unit 130/130 (2,215), integration 149/149 (2,614).

---

## Carry-overs for a human

1. **P2-3's receiver deploy.** The dual-accept patch for
   `lyfe-app/supabase/functions/receive-mktr-lead/index.ts` is outside this repo
   and must ship before `LIVE_SUBSCRIBER_SIGNATURE_VERSION` flips to `'v2'`.
   Runbook: `docs/plans/webhook-signature-v2-cutover.md`.
2. **P3-4's PropTypes-vs-TypeScript decision.** See above.
3. **P3-1 and P3-2 leave the core intact.** `createProspect` is ~780 lines and
   `entitlementService` ~960 — both much smaller and cleanly staged, but the
   normalize / gate / route stages of the first and the state machine of the
   second are still worth splitting when someone next has reason to touch them.
