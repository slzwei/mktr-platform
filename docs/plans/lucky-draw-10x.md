# Lucky Draw + 10× Session Multiplier — Design & Implementation Plan

> Status: DRAFT v2 (2026-07-12). Codex-reviewed (gpt-5.6-sol xhigh) and corrected
> against the repo; review disposition in §9. Not yet implemented.
> Companion reading: `docs/redeem-ops/MKTR_INTEGRATION.md` §2 (entitlements),
> `docs/plans/redeem-home-featured-drops.md` (homepage drops).

## 1. Goal & mechanic

Run consumer lucky-draw campaigns on redeem.sg with a defensible, auditable draw:

- **1× chance** — verified signup on the campaign's LeadCapture form (SMS OTP).
- **10× chances** — the prospect completes a ~20-min financial-advisory session,
  recorded by their **assigned consultant**:
  - **Physical meeting**: consultant scans the QR pass from the customer's email.
  - **Virtual meeting (Zoom)**: primary path is still a scan — the customer shows
    the QR on screen / webcam and the consultant scans it off the screen (a real
    token-backed scan). Fallback: a "virtual meeting" toggle → button unlock,
    which is review-gated for draw weighting (§6).
- Winner drawn after close (weighted random, witnessed, reproducible), contacted
  directly, 14 days to claim, redrawn if unclaimed, published on redeem.sg/winners.

Consultant channel: **mktr-leads** (mirrored `User` agents via `mktrLeadsId`)
first; Lyfe app (internal agents) later. The paid `ExternalAgent` buyer rail is
**out of scope** — the unlock routes resolve `User` rows and authorize
`prospect.assignedAgentId` only, and draw-campaign leads are never sold leads.

## 2. What already exists (verified 2026-07-12)

| Rail | Where | Notes |
|---|---|---|
| Reservation + QR pass email at signup | `backend/src/services/redeemOps/fulfilmentNotify.js` `sendReservationEmail` | Inline QR (CID), `/r/{token}` link, "show this pass to your consultant". Fires from the capture hook when the campaign has a live Activation. |
| Presentation-pass token | `backend/src/services/redeemOps/tokens.js` | 32-byte base64url, SHA-256 at rest, shown once. |
| Issuance preconditions (anti-farming) | `entitlementService.js` `issueForProspect` | Requires `sourceMetadata.phoneVerifiedAt`, not quarantined, live activation with allocation. **Caveat:** `issueManual` (`entitlementService.js:233`) fabricates `phoneVerifiedAt` when absent — manual issues are NOT OTP evidence and must be excluded/reviewed for ×10 (`issuedVia='manual'` is recorded). |
| Unlock API — mktr-leads | `backend/src/routes/externalEntitlements.js` `POST /api/external/entitlements/unlock` | HMAC over raw body with `EXTERNAL_APP_SECRET` **+ signed `timestamp` field required in the body** (`externalBillingController.js:62`). Body: `{timestamp, agentMktrUserId, presentationToken?\|prospectId?, via?}`. |
| Unlock API — Lyfe | `backend/src/routes/lyfeEntitlementUnlock.js` `POST /api/integrations/lyfe/entitlement-unlock` | HMAC via `x-webhook-timestamp`/`x-webhook-signature` **headers** (`LYFE_LEAD_OUTCOME_SECRET`) — different envelope from the external route. |
| Scan vs button recording | `RewardEntitlement.unlockedVia` + `RedemptionEvent` metadata | **Today the label is caller-chosen** — both routes map `via !== 'button'` → `agent_scan` regardless of whether a token or a prospectId was supplied. §4.4 fixes this server-side (Phase 1) before scan evidence is trusted. |
| Assigned-consultant guard | `entitlementService.js` `unlockEntitlement` (~172-178) | 403 unless `prospect.assignedAgentId === agentUser.id`; admin override recorded `unlockedVia='manual'`. |
| Replay-safe unlock | `entitlementService.js` (conditional `status:'eligible'` UPDATE) | `eligible → issued`; stamps `unlockedAt/unlockedByUserId/unlockedVia`; expiry-checked. Writes an append-only `redemption_events` row `type='unlocked'` with `metadata.via` — **this event row is the durable ×10 evidence** (an `issued` entitlement can later be `cancelled`: `cancelEntitlement` accepts `eligible|issued`). |
| Status lifecycle | `RewardEntitlement.status` | `eligible → issued → redeemed`; `expired\|cancelled\|blocked`. Unique `(activationId, prospectId)` index has **no status filter** (migration 050) — an expired/cancelled row permanently blocks reissue for that activation+prospect. |
| One live activation per campaign | migration 049 `uq_act_live_campaign` | Partial unique on `campaignId` across `preparing\|active\|paused` — at most one live activation, schema-guaranteed. |
| Capture hook composition root | `backend/src/database/bootstrap.js` (~203-215) | Registered only when `REDEEM_OPS_ENABLED` + `REDEEM_OPS_ENTITLEMENTS_ENABLED` true. Hook is **skipped for quarantined prospects** (`prospectService.js:962`); late release reconciliation only covers ~48h (`entitlementService.js:319`). |
| One phone = one entry per campaign | `prospectService.js` (~429-461) + partial unique index `prospects_campaign_id_phone` (migration 010) | App precheck returns 409; a concurrent duplicate that reaches the index surfaces as a generic 400 (`errorHandler.js:47`). **Verify the index exists in prod** (migration swallows errors; the model comment's `ensurePostgresIndexes` does not exist). |
| Campaign off gate | `prospectService.js` (~347-361) | Non-`active` status → 410. Real Pause exists in the flag-gated workspace (`CampaignLaunchTab.jsx`, `campaignService.js` `setCampaignActive` → `paused`); classic UI Edit→Active-off maps to `draft` (also blocks). |
| Homepage drop card | `featuredDropsService.js` | `design_config.featuredDrop` (cap + SGT endsAt, display-only). `sgtEndOfDayMs` is module-private — extract to a shared util before reuse. |
| Winners' wall | `src/pages/RedeemWinners.jsx` + `redeemWinnersContent.js` | Static, hand-edited, PDPA-masked format. Stays the publishing surface for v1. |

## 3. Blockers this plan must close (from the 2026-07-12 platform review)

1. **No server-enforced verified-entry invariant** — `phone` optional in the
   public schema; OTP marker never required; `consent_terms` optional
   server-side (`validation.js:215`). → Phase 1.
2. **No immutable pool / draw ledger** — prospects hard-deletable and editable
   (phone can change while `phoneVerifiedAt` survives, unbound to a value);
   AdminProspects export is selection-or-current-page only. → Phases 1–2.
3. **No authoritative close** — `end_date` unenforced. → Phase 1 (`closesAt`
   gate) + Phase 2 (freeze enforces the stored cutoff independently).
4. **No 10× evidence** — closed by unlock events + server-derived `via`. → Phases 1–3.
5. **Confirmation email copy wrong for draws** (generic "gift + 24h call"
   template; mailer uses static HTML+text template files, so this is a new
   template pair, not a copy branch). → Phase 1.
6. **T&Cs mutable after the fact** — adopt the repo's existing append-only
   versioned-terms pattern (`RewardTermsVersion`), not a bare hash. → Phase 1.

## 4. Design

### 4.1 Campaign shape

A lucky draw is a **Regular (`lead_generation`) campaign** with:

- `design_config.luckyDraw = { enabled: true, closesAt: 'YYYY-MM-DD', boostClosesAt: 'YYYY-MM-DD', drawOn?: 'YYYY-MM-DD', prize: '…', multiplier: 10, activationId: '<uuid>', termsVersionId: '<uuid>' }`
  — admin-gated on write like `featuredDrop` (`applyFeaturedDropPolicy` pattern),
  clamped server-side in `campaignService`. `duplicateCampaign` must strip
  `luckyDraw` (it currently copies design config wholesale and disables only
  `featuredDrop` — `campaignService.js:412`).
- A live Redeem Ops **Activation** (`luckyDraw.activationId`, validated to belong
  to this campaign). Recommended: pair the draw with the guaranteed session
  voucher — one Activation powers the voucher AND the ×10 evidence.
- All dates stored/compared as **UTC instants derived from SGT day boundaries**
  (next-day-exclusive, i.e. `< (date+1)T00:00+08:00` — avoids the 999ms gap in
  the featured-drops helper).
- Optional `design_config.featuredDrop` for the homepage card.

### 4.2 Entry tiers (the draw predicate)

Executable form (columns are camelCase and must be quoted):

```sql
-- 1× pool: verified entrants in the entry window
SELECT p.id, p.phone, p."firstName", p."lastName"
FROM prospects p
WHERE p."campaignId" = :campaignId
  AND p.phone IS NOT NULL
  AND p."sourceMetadata"->>'phoneVerifiedAt' IS NOT NULL
  AND p."sourceMetadata"->>'phoneVerifiedFor' = encode(digest(p.phone, 'sha256'), 'hex')  -- Phase 1 binding, §4.4
  AND p."createdAt" <= :closesAtInstant;

-- ×10 evidence: append-only unlock EVENTS (not current status — an issued
-- entitlement can later be cancelled), scoped to the designated activation,
-- inside the boost window, with server-derived via:
SELECT re."prospectId", ev."createdAt" AS "unlockedAt", ev.metadata->>'via' AS via
FROM redemption_events ev
JOIN reward_entitlements re ON re.id = ev."entitlementId"
WHERE ev.type = 'unlocked'
  AND re."activationId" = :designatedActivationId
  AND re."issuedVia" <> 'manual'                      -- manual issues excluded (§8.1)
  AND ev."createdAt" <= :boostClosesAtInstant;
-- chances = 10 where via='agent_scan', or via='agent_button' with an APPROVED
-- boost review row (§4.3); else 1.
```

- **No activation-status filter at draw time** — completing/cancelling an
  activation does not cancel existing entitlements and unlock doesn't check it;
  the designated `activationId` + event cutoff is the boundary.
- Quarantined prospects (DNC-held / external-hold) **stay in the 1× pool** —
  quarantine restricts marketing delivery, not entry validity. Note they cannot
  earn ×10 while quarantined (the capture hook skips them, so no reservation
  exists; late release reconciles only ~48h back). Draw campaigns should
  therefore either leave `dncCheckAtSubmit` off (consent-first form instead) or
  accept 1×-only for held entrants — decide per campaign, state it in T&Cs.
- Entries accrue until `closesAt`; unlock events count until `boostClosesAt` —
  a **fixed scheduled instant**, independent of when the operator runs the
  runner (an ops delay must not silently admit more boosts).

### 4.3 Draw model (new — Phase 2)

Migrations from **057** (numbering verified; duplicate numbers fail
`migrations.test.js`). Models need named exports + explicit associations in
`models/index.js` (repo pattern).

```
draws:        id, campaignId, activationId, termsVersionId,
              closesAt, boostClosesAt, frozenAt, poolHash,
              status ENUM(open|frozen|sealed|drawn|published|claimed|void),
              witnessedByUserId, notes, timestamps
draw_attempts: id, drawId, attemptNo, seed, pickedEntryId,
              reason ENUM(initial|unclaimed|unreachable|ineligible|declined),
              drawnAt, contactedAt, claimDeadline, claimedAt, outcome, timestamps
              -- every redraw is a child attempt; exclusions = all prior attempts' picks
draw_entries: id, drawId, prospectId (FK SET NULL), phoneHash, phoneLast4,
              displayName, chances INT, verifiedAtFreeze, boostVia, boostEventId,
              UNIQUE(drawId, prospectId)
draw_boost_reviews: id, drawId, entitlementId, unlockEventId,
              decision ENUM(approved|rejected), reviewedByUserId, reason, timestamps
```

- **Two-cutoff freeze**: `freeze` (at/after `closesAt`) snapshots the 1× pool
  into `draw_entries`; `seal` (at/after `boostClosesAt`, once button reviews are
  decided) writes `chances` and `poolHash`. Post-freeze staff edits/deletes
  can't alter the pool; the gap between close and freeze is minimized by running
  freeze promptly — freeze re-applies the `createdAt <= closesAt` cutoff itself,
  so late rows never enter regardless of when it runs.
- **PII posture**: entries store `phoneHash` + `phoneLast4` + `displayName`
  (enough to publish "9••• •312 · Sarah T." and to audit), never the full
  phone/email — winner contact uses the live prospect row. Erasure/deletion of a
  prospect between freeze and award ⇒ entry is disqualified at pick time
  (recorded as `ineligible`, next attempt drawn). Runner audit JSON prints
  hashes and masked values only.
- **poolHash** = SHA-256 over the canonical ordered list of
  `(entryId, prospectId, phoneHash, chances, boostVia)` tuples — commits to the
  weights, not just membership.
- **Seed = commit/reveal**: `poolHash` committed at seal; the seed is generated
  at pick time in front of the witness (`crypto.randomBytes`), recorded on the
  attempt with the derived winner. Reproducibility = seed + sealed snapshot
  re-runs to the same pick; the seed not existing before the witnessed moment is
  what makes the pick unpredictable. PRNG + ordering specified in code:
  entries ordered by `id`, expanded by `chances`, index = seeded
  ChaCha20/xoshiro (any seedable PRNG, pinned + unit-tested) mod total.
- **Claim lifecycle** on the attempt: `drawnAt → contactedAt → claimedAt` or
  `claimDeadline` (14d) lapse → next attempt with `reason='unclaimed'`,
  excluding **all** prior picked entries.
- Runner: `backend/scripts/run-lucky-draw.js` (`freeze` / `seal` / `draw` /
  `redraw` / `verify` subcommands; idempotent transitions; refuses to re-seed a
  drawn attempt). Admin UI panel is a later slice.
- `draws.status='published'` means the winners-file SPA change is **deployed and
  verified live** (deploy-verification steps in CLAUDE.md), not merely edited.

### 4.4 Server-enforced verified entries (Phase 1)

Scoped to draw campaigns (`sourceCampaign.design_config.luckyDraw?.enabled`),
so the general funnel's "never lose a lead" posture is untouched:

- **Gate placement**: after campaign load AND after phone normalization
  (`prospectService.js:412-415`), before routing/round-robin — the OTP marker is
  keyed by full `+65…` E.164, and the raw-digits form a direct caller may send
  must be normalized before the lookup or legit verified callers 403.
- Require: `phone` present; `isPhoneRecentlyVerified(normalizedPhone)` live
  (else 403 "verify your number first" — browser flow always passes; retry after
  re-verify succeeds); `consent_terms === true` (else 422); `now <= closesAt`
  (else 410).
- **Bind the stamp to the number**: write
  `sourceMetadata.phoneVerifiedFor = sha256(normalizedPhone)` alongside
  `phoneVerifiedAt`. The draw predicate requires the hash to match the current
  phone — a staff phone edit after verification breaks the match instead of
  silently inheriting verified status. (Alternative considered — blocking phone
  edits on draw entrants — rejected: support needs edits; the binding makes
  edits safe instead of forbidden.)
- **Server-derived `via`** (both unlock routes): `presentationToken` ⇒
  `agent_scan`, `prospectId` ⇒ `agent_button`; the client's `via` field becomes
  advisory-only/ignored. Without this, `{prospectId, via:'scan'}` forges scan
  evidence today.

### 4.5 Emails (Phase 1)

- New draw confirmation template pair (`confirmation-email-draw.html/.txt` — the
  mailer loads static template files): "You're in the draw for {prize}. Complete
  your complimentary session to multiply your chances ×10." Keep the referral
  block. Selected in `sendLeadConfirmationEmail` by `luckyDraw.enabled`.
- Reservation-pass email (already built) optionally gains a line: "scanning this
  at your session = ×10 draw chances" (`fulfilmentNotify.js`).

### 4.6 Draw terms (Phase 1)

- Follow the repo's `RewardTermsVersion` append-only pattern: a
  `draw_terms_versions` row (content, sha256, version, createdBy) — or reuse the
  table with a scope column. `luckyDraw.termsVersionId` pins the active version;
  the draw row copies it at freeze; each draw-campaign prospect stores the
  accepted version id + hash in `consentMetadata` at create. A bare hash of
  mutable `design_config.termsContent` is insufficient (empty content renders a
  JSX default; the dialog sanitizes via DOMPurify, so raw-HTML hashes don't even
  match what was shown — the versioned row stores the canonical content).
- Terms must state: entry window + close, draw method (sealed weighted pool,
  witnessed seeded pick), ×10 condition ("your consultant records your completed
  session — QR scan at the meeting, or verified confirmation for virtual
  sessions"), 14-day claim + redraw policy, masked publication on /winners, and
  the winner-contact channel. **DNC/PDPA position on winner contact needs
  sign-off** — "transactional" treatment of the prize call is our reading, not a
  code-verifiable fact.

### 4.7 mktr-leads app (separate repo — Phase 4)

Backend contract (after the Phase 1 `via` fix):

- **Scan screen**: camera → parse `/r/{token}` →
  `POST /api/external/entitlements/unlock` with
  `{timestamp: ISO-now, agentMktrUserId, presentationToken}` (HMAC over raw
  body; `timestamp` in the body is required by `requireExternalHmac`).
- **Lead detail**: "Session complete" button behind a *"this was a virtual
  meeting"* toggle → same endpoint with `{timestamp, agentMktrUserId,
  prospectId}` → recorded `agent_button`; copy states virtual confirmations are
  reviewed before draw weighting.
- Identity rail: mirrored `User` agents (`users.mktrLeadsId`) — verified as how
  the route resolves agents and how draw-campaign leads are assigned. Deploy via
  Shawn (no write creds in that repo's env); OTA-friendly.
- Lyfe mirror later: same UI, but the **header-based** HMAC envelope.

## 5. Phases

| Phase | Scope | Size |
|---|---|---|
| **0 — Ops setup + launch blockers (no code)** | Verify `prospects_campaign_id_phone` exists in prod (`SELECT indexname FROM pg_indexes WHERE tablename='prospects'`); flip `REDEEM_OPS_ENABLED` + `REDEEM_OPS_ENTITLEMENTS_ENABLED` (+ `VITE_REDEEM_OPS_ENABLED` if ops UI needed); create partner → offer → Activation; **size `offer.claimExpiryDays` to cover earliest-signup → `boostClosesAt`** (reservation expiry = `claimExpiryDays \|\| 30`; an expired reservation cannot be unlocked AND cannot be reissued — the unique index has no status filter); **size activation allocation ≥ expected signups** (exhaustion leaves later entrants with no pass; the reconcile sweep only backfills ~48h). | — |
| **1 — Draw-campaign hardening** | `luckyDraw` config block + admin clamp + duplicate-strip; create-gate (phone + normalized OTP marker + `consent_terms` + `closesAt`) placed post-normalization; `phoneVerifiedFor` hash binding; **server-derived `via` on both unlock routes**; draw confirmation template pair; `draw_terms_versions` + acceptance stamping; extract shared SGT-boundary util. Tests pin: direct-API POST without OTP → 403, after `closesAt` → 410, `via` forgery impossible, non-draw campaigns byte-identical. | **M–L** |
| **2 — Draw model + runner** | Migrations 057+ (`draws`, `draw_attempts`, `draw_entries`, `draw_boost_reviews` — winner FK added after entries table to avoid the circular reference, or validated in-service); freeze/seal/draw/redraw service with idempotent transitions; canonical poolHash; commit/reveal seed; pinned seeded PRNG + unit tests; PII-masked snapshot + audit JSON; `run-lucky-draw.js` CLI with safeguards; concurrency tests. | **L** |
| **3 — Boost review UI** | Ops list of `agent_button` unlock events pending review → approve/reject writes `draw_boost_reviews` (schema exists from Phase 2, so no circularity); needs a reviewer capability added to **both** permission copies (`permissions.js` + SPA copy — drift test enforces equality). | **M** |
| **4 — mktr-leads screens** | Scan screen + virtual-toggle button unlock per §4.7 (separate repo). | S |
| **5 — Later** | Lyfe app mirror; admin draw panel; durable per-submission verification records; winners API instead of static file. | — |

Phases 0–3 support a full draw with the ops admin-unlock panel as the interim
consultant tool **only if** each manual unlock is individually approved in the
boost review (manual issues/unlocks are excluded from ×10 by default, §8.1).

## 6. Fraud & fairness analysis

| Vector | Control |
|---|---|
| Direct-API fake entries (no OTP) | Phase 1 gate: 403 without live normalized OTP marker; phone + terms required. |
| Entry farming with many SIMs | One entry per phone per campaign (409 + unique index); OTP per phone; SIM cost; T&Cs say "one entry per verified mobile number" (no person-level identity claimed). |
| Forged scan evidence (`{prospectId, via:'scan'}`) | **Closed in Phase 1**: `via` derived server-side from the identifier. |
| Consultant self-unlocks ×10 without meeting (button) | `agent_button` requires boost-review approval for draw weight; assigned-consultant guard bounds blast radius to own leads; leads cost package credits; unlock counts visible in ops analytics. |
| Manual issuance/unlock laundering (`issueManual` fabricates the OTP stamp; admin unlock bypasses the consultant guard) | `issuedVia='manual'` excluded from ×10 by default; inclusion only via an individually approved boost review. |
| Consultant asks customer to forward QR (no meeting) | Residual — scan proves pass presentation, not session duration. T&Cs wording ("records your completed session") + winner spot-check before award. |
| Staff phone edit inherits verified status | `phoneVerifiedFor` hash binding (Phase 1) breaks the match on edit. |
| Staff edits/deletes after close | Freeze re-applies the `createdAt <= closesAt` cutoff; post-freeze snapshot immutable; deletion between close and freeze is bounded by running freeze promptly, and any post-freeze erasure ⇒ recorded disqualification, not silent pool change. |
| Ops delay extends the boost window | `boostClosesAt` is a fixed stored instant; seal filters events by it, not by run time. |
| Winner predictable before the witnessed pick | Commit/reveal: poolHash sealed first; seed generated at the witnessed pick, recorded after. |
| Winner disputes the pick | Sealed snapshot + seed + pinned PRNG reproduce the pick; witness + attempts ledger recorded. |
| Junk inflates homepage "claimed" meter | Pre-existing (display-only); Phase 1's 403 stops junk at source for draw campaigns. |
| OTP throughput on shared IPs (CGNAT / venue Wi-Fi) | Pre-existing: `/verify/send`+`/check` share 10 req/15 min/IP (~5 signups). Monitor during ad bursts; split/raise the limiter pre-launch if roadshow or burst traffic is expected. |

## 7. Env & flags

| Var | Value for launch |
|---|---|
| `REDEEM_OPS_ENABLED` | `true` (already live for ops) |
| `REDEEM_OPS_ENTITLEMENTS_ENABLED` | `true` (**currently false — arms reservations, pass emails, unlock routes, capture hook**) |
| `EXTERNAL_APP_SECRET` | already set (mktr-leads HMAC) |
| `LYFE_LEAD_OUTCOME_SECRET` | already set (Lyfe HMAC channel) |
| `DNC_VERIFIED_MARKER_TTL_MS` | optional: raise from 10 min if Phase 1 telemetry shows 403-retries on slow form fills |

Unverifiable from the repo (must check in prod): the prospects unique index,
current Render flag values, single-instance deployment assumption behind the
in-memory OTP marker.

## 8. Decisions (was: open questions — resolved with review input)

1. **Manual unlocks/issues**: excluded from ×10 by default; included only via an
   individually approved `draw_boost_reviews` row. (`issueManual` fabricates the
   OTP stamp; admin unlock bypasses the consultant guard — both are support
   tools, not evidence.)
2. **Activation scoping**: designated `luckyDraw.activationId`, validated
   against the campaign at enable AND at freeze. No activation-status filter at
   draw time. (Schema already guarantees ≤1 live activation per campaign.)
3. **Unlock deadline**: fixed `boostClosesAt` instant (may be after entry
   close — sessions run 1–3 weeks post-signup and driving completions is the
   point of ×10). Reservation expiry (`claimExpiryDays`) must cover it (Phase 0
   blocker).
4. **Redraw**: same sealed snapshot, excluding **all** prior picked entries;
   each pick is a `draw_attempts` child row with its own seed, witness, reason
   (`unclaimed|unreachable|ineligible|declined`), and claim timestamps.
5. **Prize fulfilment**: a lucky-draw claim/handover record on the attempt row
   (contacted/claimed/outcome) — NOT the partner `Redemption` model, which has
   different lifecycle semantics.
6. **Winners file**: static publishing stays for v1; `published` status requires
   the deploy verified live (hash-flip check per CLAUDE.md), not just the edit.

## 9. Review log

- **2026-07-12 — Codex (gpt-5.6-sol, xhigh) plan review.** Verified-and-adopted:
  camelCase quoting in predicate SQL; unlock **events** (not revocable status) as
  ×10 evidence; explicit `createdAt` cutoff in the pool; `issueManual` fabricated
  stamp ⇒ manual exclusion; caller-chosen `via` ⇒ server-side derivation moved to
  Phase 1; external-route `timestamp`-in-body contract; `consent_terms` optional
  server-side ⇒ required by the Phase 1 gate; `phoneVerifiedAt` unbound to a
  phone value ⇒ `phoneVerifiedFor` hash binding; versioned terms over bare hash
  (`RewardTermsVersion` pattern); `duplicateCampaign` cloning `luckyDraw`;
  circular winner-FK; poolHash must commit to weights; seed commit/reveal;
  two-cutoff freeze/seal; redraw = child attempts excluding all prior picks;
  reservation-expiry-blocks-reissue (unique index has no status filter) and
  allocation-exhaustion (~48h reconcile) promoted to Phase 0 launch blockers;
  quarantine ⇒ no ×10 path documented; phase sizes revised (1: M–L, 2: L, 3: M);
  permissions drift test scope for the reviewer capability; PII-masked
  `draw_entries` + erasure handling; mktr-leads identity rail pinned to mirrored
  `User`/`mktrLeadsId` (paid `ExternalAgent` rail out of scope).
- Declined/kept-as-is: none material; DNC "transactional winner contact" kept as
  an explicit legal-sign-off item rather than a code decision (§4.6).
