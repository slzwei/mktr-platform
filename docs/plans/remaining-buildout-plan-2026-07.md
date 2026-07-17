# Remaining Buildout Plan — MKTR ecosystem

**Prepared:** 2026-07-17, from the full readiness review (4-agent sweep of mktr-leads app, its Supabase project, mktr-platform flow, and the redeem-partner surface)
**Status:** Wave 0 executed (see execution log); Waves 1–5 corrected per the Codex adversarial review (§ at end)
**Repos touched:** `mktr-platform`, `mktr-leads`, new `redeem-partner` (Wave 4)

> **Read the "Codex adversarial review — folded corrections" section at the end before starting any wave.** It supersedes specific line items where a claim was verified stale or a step was unsafe. Wave 0 was executed with those corrections applied in-flight.

The live funnel (capture → assign → deliver → work → unlock → redeem → measure) is built end-to-end.
What remains: (a) unblocking already-written code, (b) a reliability hardening sprint, (c) three new
builds — agent scan/unlock, draw ops UI, partner app — plus loose ends. Six waves, ordered by risk
and dependency. Waves 2 and 3 can run in parallel; Wave 5 interleaves.

---

## 0. Decisions needed from Shawn (block Waves 2–4)

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Apple 1.2.0 story**: disclose the Lead Store as an external-purchase B2B flow, or ship `checkoutMode='web'` (store hidden, buy on mktr.sg)? | Disclose. Leads are a B2B service; the system-browser purchase model is defensible. Do NOT use the kill switch to hide the store during review (2.3.1 concealment — the exact pattern the 2.1(b) inquiry probed). Pair with the self-service registration page promised in `store/app-review-2.1b-reply.md`. |
| D2 | **Partner app architecture**: mirror the mktr-leads pattern (own Supabase project + broker EFs → new `/api/partner/*`) vs platform-native auth (partner_users + JWT on Express)? | Mirror mktr-leads (§Wave 4 rationale). Proven pattern, invitation-gated OTP and push come free, clean auth-domain separation. |
| D3 | **Draw ops surface**: admin v2 (mktr.sg) or Redeem Ops (ops.redeem.sg)? | Redeem Ops — boost reviews and reward fulfilment already live there; gate with a new `draws.manage` capability. |
| D4 | **PR E (WhatsApp voucher delivery)** timing — still gated on the Meta WABA checklist. | Keep out of the critical path; slot into Wave 5 when WABA clears. |
| D5 | **Partner app MVP scope**: scan-to-consume only, or scan + trials/leads review dashboard? | Both (P1+P2 below) — the review dashboard is cheap once partner auth exists, and it's the half partners actually asked for. |

---

## Wave 0 — Unblock what's already written (1–2 days; ops + merges, no new code)

> **Execution log (2026-07-17):** Items 1, 2, 3, 4, 6 DONE. Item 5 done (seeder scripted; real-package swap still a Shawn ops step). Item 7 in progress (docs). See per-item ✅ notes. The one plan correction: item 6's `is_test_data` fix was **not** a "mirror lyfeClient" 3-liner — the mktr-leads `agents` table had no such column (verified: `select=is_test_data` → HTTP 400). Shipped as an additive migration (`20260717000000_agents_is_test_data.sql`, applied) + source filter (mktr-platform #189). Filter is a no-op until a row is flagged.

Objective: everything already reviewed/built goes live; the one live break is fixed.

1. ✅ **Flipped `ADMIN_LEAD_OPS_EXTERNAL_ENABLED=true`** on Render `mktr-backend-jo6r` (`srv-d2s9p0emcj7s73acd9lg`). Probe: `/api/external/admin-lead-ops/reassign` 404 → **401** (mounted). Fixes the shipped admin Reassign/Return-to-queue bar.
2. ✅ **Merged the security branches** into `feat/buy-leads` (mktr-leads trunk) in remediation-plan order — PRs #23 (`security/auth-hook-boundary`, incl. SEC-01 migration), #24 (`security/webhook-replay-phase-1`, Step A), #25 (`security/webhook-v2-receiver`, Step B). CI green each. `receive-mktr-lead` **deployed** to `rciuejxgziqxrwtifpbo`; unsigned POST → **401**. Sender safety verified: live sender sets `X-Webhook-Delivery-Id` = signed `payload.deliveryId` (one UUID), so Step A does not reject current traffic. **SMS-hook NOT deployed** — gated on Shawn setting `SEND_SMS_HOOK_SECRET` first (hardened hook fail-closes to 500 without it). See runbook.
   - ✅ **Sender half** `security/webhook-v2-sender` cherry-picked onto current main, merged as mktr-platform **#188**. Metadata-gated: no subscriber has `signatureVersion`, so all deliveries stay v1 byte-for-byte. Shared signing vector byte-identical across repos. **v2 go-live is a later step:** flip ONLY the mktr-leads subscriber's `metadata.signatureVersion='v2'` (Lyfe stays v1) — see runbook.
3. ✅ **SEC-01 revoke migration** `20260710010000_close_phone_eligibility_oracle.sql` applied via `db push`. `check_phone_eligible` execution revoked from public/anon/authenticated; service_role retained for one window.
4. ✅ **Verified manual deploys**: `supabase migration list --linked` shows `20260711010000` + `20260711020000` applied (AUTH + push-token invariants live). `HELD_LEAD_PING_ENABLED` → **Shawn to confirm** (see runbook).
5. ⏳ **Store content**: `backend/scripts/seed-campaign-store-content.mjs` committed (this doc's PR). Running it + archiving the S$1 Test Pack (`37cdc291`) + confirming real packages = **Shawn ops step** (needs `DB_PASSWORD` fresh from Render).
6. ✅ **`is_test_data` filter** — shipped as mktr-leads migration `20260717000000_agents_is_test_data.sql` (applied; additive, default false) + source filter in `mktrLeadsClient.fetchAgents`/`fetchAgentById` (mktr-platform #189). No-op today; guards the moment a QA agent is flagged.
7. ✅ **Docs truth-up (OPS-01)** — `README.md`, `docs/OTA_RUNBOOK.md`, fingerprint-gate note (this doc's companion mktr-leads PR).

**Done when:** all probes 401 (none 404) for intended-live routes ✅; unsigned SMS-hook and replayed webhook rejected in prod (receiver ✅; SMS-hook pending Shawn's secret); store shows real packages (pending Shawn); a `is_test_data=true` agent does not sync ✅.

---

## Wave 1 — Reliability hardening sprint (~5 days; mktr-leads EFs + platform tests)

Objective: the money-bearing delivery path becomes transactional and observable **before** onboarding
paying external agents at volume. Specs already exist in `CODEBASE_REVIEW_REMEDIATION_PLAN.md` §§8–9, 15 —
implement as written there (v2.0 corrections included). PR breakdown:

1. **`reliability/lead-lifecycle`** (mktr-leads):
   - DATA-03: one service-side transaction in `receive-mktr-lead` — claim delivery + insert lead + activity + notification all-or-nothing (today unchecked inserts at `index.ts:456-525`).
   - DATA-02: unassignment/previous-agent lookups stop discarding errors (`index.ts:233-259`) → 5xx retryable instead of false 200.
   - DATA-01: monotonic `status_version` + ratcheting ack RPC in `report-lead-outcome` (unconditional stamp at `index.ts:98-99`), **with the §9.2 backfill deploy-gate** (sweepable-row count must equal current backlog — prevents re-firing historical CAPI).
   - DATA-04: `transition_lead_status(...)` RPC commits status + audit activity together; client migrates via OTA (today `.catch(() => {})` at `[leadId].tsx:314-320`).
2. **`scale/remove-silent-caps`** (both repos): paginate admin fleet / own-leads / team reads past the 1,000-row PostgREST cap; fix the manager signal prune; `mktr-agent-packages` drops the 20-member `.limit` and reports partial failures explicitly.
3. **`ops/observability`** (mktr-platform, OBS-01): alert on `WebhookSubscriber.enabled` flips, `droppedDeliveries`, and `outcome_report_attempts = 48` dead letters. This is the guard for the charge-at-capture model — a silent auto-disable currently equals paid-but-undelivered leads with no alarm.
4. **`ci/edge-functions`** (mktr-leads, CI-01): pinned `deno check` in CI for all EFs; fix the two current failures (`receive-mktr-lead` TS2339, `mktr-lead-timeline` generic mismatch); add EF tests for the new transactional paths.
5. **PUSH-02** (OTA client fix): foreground push recovery — session ref instead of stale closure, success-based retry with bounded backoff (`contexts/AuthContext.tsx:126-139`, `:81-85`).

**Done when:** the remediation plan's §4 invariants all hold (delivery never marked processed without side effects; acks only ratchet; status+activity atomic; 1,001 leads / 21 members never silently truncate; every EF passes deno check in CI).

---

## Wave 2 — mktr-leads 1.2.0 binary train (~5 days dev + App/Play review) — parallel with Wave 3

Objective: the agent can perform the unlock moment; the Apple story becomes honest; store metadata catches up.
Native dep (camera) ⇒ new fingerprint ⇒ binary train, so batch everything binary-bound into one submission.

1. **Entitlement-unlock broker EF** (`supabase/functions/mktr-entitlements/`): mirrors `mktr-agent-store` —
   inbound agent JWT re-checked against the live `agents` row; outbound HMAC (`EXTERNAL_APP_SECRET`) to
   `POST /api/external/entitlements/unlock` (already live in prod). Forwards only the caller's own
   `mktr_user_id` as `agentMktrUserId`; body carries `presentationToken` (scan) **or** `prospectId` (button) —
   `via` stays server-derived (`externalEntitlements.js:40-48`). Surface `emailQueued` in the response.
2. **Scan screen** (`app/(tabs)/leads/scan.tsx` or launched from lead detail): `expo-camera` QR scan of the
   customer's `/r/{presentationToken}` QR → confirm sheet (reward name, customer first name) → unlock →
   success state showing voucher minted + whether the voucher email queued. Handle the four failure shapes
   distinctly: not-eligible/already-unlocked (idempotent-friendly message), activation-paused (liveness gate),
   not-your-lead (assigned-consultant binding 403), expired reservation.
3. **Virtual unlock button** on the owned-lead detail (uses `prospectId` → `agent_button`), with copy that a
   button unlock needs ops boost-review approval for the ×10 (per `lucky-draw-10x.md` §4.4) while a scan is automatic.
4. **Apple 1.2.0 package** (per D1): disclose the store honestly in review notes; ship the **self-service
   registration page on mktr.sg** promised in `store/app-review-2.1b-reply.md` (small platform-web form →
   pending application → admin approve → existing `create-ext-agent-invite` service-secret path); refresh
   `store/README.md` (still says 1.0.0; screenshots / privacy URL / reviewer demo creds marked `[YOU]`);
   either implement biometric unlock or drop the unused Face ID string; wire the dead "Notify me" button
   (`lead-store.tsx:213`) or remove it.
5. **Purchase-state persistence** across cold start / OTA reload (flagged follow-up at `useBuyLeads.tsx:17-18`).
6. **Train mechanics**: version 1.2.0, new fingerprint registered in `scripts/live-runtimes.json`, publish via
   `scripts/ota-publish.mjs` gate; min-version store-blocker stays fail-open.

**Done when:** a real reservation-pass QR scanned on a dev build unlocks in prod (staging activation), voucher
email receipt visible; 1.2.0 approved in both stores; registration page live on mktr.sg.

**Interim guardrail (until this ships):** run trial-reward campaigns for external-agent-funded campaigns with
`unlockPolicy='on_capture'`, or route them to Lyfe agents; ops admin unlock panel remains the manual fallback.

---

## Wave 3 — Draw & review ops UI (~3–4 days; platform web, per D3 on ops.redeem.sg)

Hard deadline anchor: Tokyo draw closes **30 Oct 2026**, but boost reviews queue up from the first trial
session — ship well before campaign marketing peaks.

1. **`DrawBoostReview` approval queue** (lucky-draw Phase 3): list pending `agent_button` claims with lead/agent/
   session context → approve/reject → approved reviews grant the ×10 via the existing `luckyDrawService` wiring.
2. **Draw lifecycle admin**: HTTP routes + UI over `luckyDrawService` (today CLI-only, `run-lucky-draw.js`;
   the service itself says "CLI / future admin panel" at `luckyDrawService.js:655`): entries list with boost
   provenance, freeze → seal (publish `computePoolHash`) → draw → publish winner, full audit trail. Capability
   `draws.manage`, admin + ops_admin only. Keep the CLI as the break-glass path.
3. **Winner ops**: winner record + contact log; no public winner page in scope (announcement handled manually/IG).

**Done when:** a staged draw runs freeze→publish entirely from the UI with the same pool hash the CLI produces;
a test `agent_button` unlock appears in the queue and its approval flips the entry to ×10.

---

## Wave 4 — Redeem Partner app (~3–4 weeks; new repo `redeem-partner` + platform `/api/partner/*`)

**Architecture (per D2):** mirror mktr-leads — new Expo app + **new Supabase project** providing auth
(invitation-gated phone-OTP), push, and thin broker EFs that HMAC-sign into new partner-scoped platform routes.
Rationale: the pattern is proven in production, auth/push infra comes free, and it keeps a hard auth-domain wall
between audiences. **New secret `PARTNER_APP_SECRET`** — never reuse `EXTERNAL_APP_SECRET` across audiences.
All partner data of record stays in mktr-platform Postgres; the Supabase project holds only identity + notifications.

**Server reuse (already built, from the partner-surface audit):** idempotent `redemptionService.verify/complete`
(double-redemption impossible via `UNIQUE redemptions.entitlementId`; `actorType` parameterized with the
`partner_user` placeholder at `RedemptionEvent.js:15`); redemptions already record `partnerOrganisationId`/`locationId`;
`RewardOfferLocation` ties offers to outlets; `entitlementService.listEntitlements` returns statuses + delivery
receipts (phones masked) ready for a partner-scoped projection.

**P0 — Identity & provisioning (~4 days)**
- Platform migration: `partner_users` (id, partnerOrganisationId FK, partnerLocationId nullable FK, phone unique,
  name, role `owner|staff`, isActive, supabaseUid unique) + `Redemption.actorPartnerUserId` (nullable).
- New Supabase project: `partner_users`-mirror `accounts` table (auth uid 1:1), `invitations`, `notifications`,
  `push_receipts`, `app_settings`; invitation-gated `handle_new_user`; WhatsApp-OTP hook **signed from day one**
  (reuse the Wave-0 hardened `custom-sms-hook` as the template — do not re-introduce SEC-02).
- ops.redeem.sg: "Invite partner user" action on the partner page (staff capability `partners.manage_users`) →
  service-secret call to the new project's `create-partner-invite` EF.
- App shell: Expo SDK 54 clone of the mktr-leads scaffold (auth gate, consent, theme, Sentry, OTA fingerprint tooling).

**P1 — "My trials & leads" read models (~4 days)**
- Platform routes `/api/partner/summary`, `/api/partner/entitlements`, `/api/partner/redemptions` (HMAC
  `PARTNER_APP_SECRET`; every query hard-scoped server-side to the caller's `partnerOrganisationId`, optional
  location filter). Expose: per-activation issued/redeemed/allocated counts, recent entitlements with status +
  delivery receipt, redemption history. Phones stay masked — partners never see full lead PII.
- App screens: Home (activation cards with live counts), Trials list (status chips: reserved / voucher issued /
  redeemed / expired), Redemptions history.

**P2 — Scan-to-consume (~3 days)**
- Platform route `/api/partner/redemptions/consume`: wraps `verify` + `complete` with `actorType='partner_user'`,
  `actorPartnerUserId`, `locationId` from the user's binding (or a picker for multi-outlet orgs). Reservation-pass
  tokens rejected exactly as at the staff counter (pre-unlock = "not yet unlocked — customer must complete their
  review first"). Replays return `{already:true}` — surface as "already redeemed at <time>".
- App: camera scan of the **voucher** QR (this is the consume scan — distinct from the consultant's unlock scan of
  the presentation token) → verify result sheet (reward, holder first name, expiry) → Confirm → success + updated counts.
  Manual code entry fallback (tokenHint last-4 + code paste).

**P3 — Notifications & polish (~3 days)**
- Push on redemption completed (confirmation to owner role) and optional daily digest of issued vouchers.
- Empty states, offline message (MVP is online-only), account switcher for multi-location staff.

**P4 — Store submission (~2 days + review)**
- B2B utility app for verified partners, no payments, camera permission justified by scanning — clean review
  profile. TestFlight with 1–2 pilot partners before public release.

**Non-goals (v1):** partner self-editing of offers/inventory, partner-initiated messaging, analytics beyond counts,
multi-brand theming, reversals (stay staff-only via `redemptions.override`).

**Done when:** a pilot partner logs in via invite, sees only their activations' trials with correct counts, scans a
real voucher to a recorded redemption with `actorType='partner_user'`, and cannot read anything outside their org
(negative tests in CI for scoping).

---

## Wave 5 — Loose ends (interleave; none block the waves above)

| Item | Repo | Size | Notes |
|---|---|---|---|
| PR E — WhatsApp voucher delivery | mktr-platform | 2–3d | Gated on D4 (WABA checklist) |
| Campaign Studio PR 4 (AI panel) → PR 5 (rollout: flip `VITE_CAMPAIGN_STUDIO_ENABLED` + `DESIGN_CONFIG_V2_WRITES_ENABLED`, migration) | mktr-platform | per existing plan | Rail seam ready |
| Cadences P2 — pool/Discover claim-and-enroll + coverage stat | mktr-platform | 2d | |
| Discovery IG-hashtag pilot — commit backend (uncommitted on main tree, behind `DISCOVERY_IG_ENABLED`) + frontend | mktr-platform | 2d | |
| Fleet teardown — land PR #166, final legacy sweep | mktr-platform | 1d | |
| `fix/lead-source-meta-an-split` — rebase or re-do the AN/Messenger source split on trunk (also 3 platform-side labeler files) | both | 0.5d | Cosmetic but user-visible |
| Delete inert `external_agents` marketplace + dead `externalAgentId` branch in `externalLeadOutcomeService.js:143` | mktr-platform | 1d | Post-pivot cleanup |
| Known-debt quickies: `SYSTEM_AGENT_REDIRECT_EMAIL` env (mailer.js:105), System-Agent delivery-gap decision, persistent job queue (pg-boss) evaluation | mktr-platform | 0.5d + decisions | |
| Stale-branch triage in mktr-leads (held-queue/hustle/sc-pr/agent-auth branches are superseded — delete) | mktr-leads | 0.5h | |

---

## Sequencing & calendar (1 developer + Claude/Codex loop, starting w/c 21 Jul)

```
Week 1   Wave 0 (Mon–Tue) ─▶ Wave 1 (Wed–Fri…)
Week 2   Wave 1 finish ─▶ Wave 2 dev  ║  Wave 3 (parallel, platform-web)
Week 3   Wave 2 submit + review buffer ║ Wave 5 items; first trial-reward campaign can launch
         (on_capture policy until 1.2.0 approved, then agent_unlock)
Weeks 4–6 Wave 4 partner app P0→P4; Wave 5 interleaved
Week 7   Partner pilot (TestFlight, 1–2 partners) → public release
Fixed anchor: draw ops (Wave 3) live long before 30 Oct Tokyo close.
```

Critical path: Wave 0 → Wave 1 → Wave 2 (binary review) → first full-loop trial-reward campaign.
The partner app is deliberately last: its engine is already live, and pilots are more convincing once
real redemption volume exists from the staff-operated counter.

## Process per Shawn's workflow

Each wave = plan section → Codex adversarial review → implement in small forward-only PRs (never mix
security hotfixes with dependency bumps, per the remediation plan) → deploy-verify (probes for flags,
`ota-publish.mjs` gate for app trains, `list_deploys` for Render).

---

## Codex adversarial review — folded corrections (2026-07-17)

A `gpt-5.6-sol` xhigh read-only audit against `mktr-platform@d5daeca` + `mktr-leads/feat/buy-leads@cf9f344`. Verdict: "cannot proceed as written." Every claim below was re-verified against real code before folding. Wave 0 was executed with the safe-path corrections already applied (migration-first `is_test_data`, rebased sender, no duplicate SEC-01, SMS hook deliberately **not** deployed, no premature v2 subscriber flip), so none of the executed actions hit these traps. The corrections that change *future* waves and *verification*:

**Wave 0 / SEC-03 — honesty about what "closed" means (Finding #1).** Deploying the hardened receiver + merging the metadata-gated sender does **not** close the replay boundary. The receiver still accepts v1 (body-only HMAC, unsigned timestamp) so the current v1 sender keeps working — meaning a captured body+signature still replays with a fresh timestamp until (a) the mktr-leads subscriber flips to `metadata.signatureVersion='v2'` **and** (b) a later v2-only receiver rejects v1. What *is* live: Step A delivery-ID binding (kills attacker-chosen delivery IDs) — a real improvement, not the full fix. Acceptance test correction: "replayed webhook rejected" is wrong (legit same-delivery retries must dedupe **successfully**); the test must target **timestamp/header substitution on a captured body**, and watch the 50-consecutive-failure auto-disable during any flip.

**Wave 0 / SEC-02 — the SMS-hook go/no-go test was wrong and dangerous (Finding #2).** "Unsigned POST → 401" is insufficient: a **mismatched** secret also 401s, and a **missing/malformed** secret 500s *every* OTP request → total login outage. The secret must keep the exact `v1,whsec_` wrapper the parser strips. Correct test = configure `SEND_SMS_HOOK_SECRET`, deploy, then trigger a **real Supabase-signed OTP and confirm WhatsApp delivery** before calling it done. Never `supabase config push` (it disables phone-auth/hook config, which is managed out-of-band). → moved into the Shawn runbook as the gating step.

**Wave 0 — flag flip needs an end-to-end signed probe, not just a mounted route (Finding #3).** `ADMIN_LEAD_OPS_EXTERNAL_ENABLED` only *mounts* `/api/external/admin-lead-ops`; the `mktr-held-leads` broker still 500s if `MKTR_ADMIN_LEAD_OPS_URL` is unset. `MKTR_ADMIN_LEAD_OPS_URL` **is** present in the mktr-leads EF secrets (verified), so the path should be whole — but confirm with a signed reassign probe from the app before declaring the shipped admin bar fixed.

**Wave 1 — drop PUSH-02; recast push-token as deployed-OTA verification (Finding #6).** PUSH-02 is **already implemented** (session refs + bounded recovery in `AuthContext.tsx`; sign-out releases the token). Migration `20260711020000` requires OTA-first (RPC + min-version retirement) *before* it — and it's already applied in prod, so the remaining work is *verifying* the live bundles shipped the RPC first, not re-doing the sequence. Also: `deno check` now fails only `mktr-lead-timeline` (generic mismatch), not two functions.

**Wave 2 — scan/unlock contract corrections (Findings #7, #8).**
- The unlock endpoint returns only `{ already, emailQueued, entitlementId, status }` — **no reward title or holder first name**. The confirmation sheet must fetch preview fields separately via the public claim GET (`/api/reward-claim/:token`) *before* calling unlock (unlock mutates immediately).
- The reward QR encodes the **raw token** (`QRCode.toDataURL(raw)`), not `/r/{token}`. The email link is the `/r/{token}` URL. The scanner must accept **both forms** (raw token and the `/r/…` URL) and extract the token.
- Interim `on_capture` fallback only works when **both** `REDEEM_OPS_ENABLED` and `REDEEM_OPS_ENTITLEMENTS_ENABLED` are on — verify in prod before relying on it.
- **1.1↔1.2 cohort overlap:** `live-runtimes.json` + `ota-publish.mjs` allow exactly **one** active fingerprint per platform. Replacing 1.1 with 1.2 at store approval removes the emergency OTA lane for un-upgraded 1.1 users (approval ≠ adoption; the min-version blocker is fail-open). Add multi-active-cohort support (or explicit release lanes) before the 1.2 train, and retire 1.1 only on adoption/min-version criteria.
- Batch the native-dep hygiene the remediation plan lists (DEP-01): declare `react-native-worklets` directly, align NetInfo, and reconcile the version drift (`package.json` 1.0.0 vs `app.config.js` 1.1.0). `expo-camera` is a new native dep → binary train, as planned.

**Wave 4 — align to the EXISTING `docs/redeem-ops/RECOMMENDED_ARCHITECTURE.md`, not a new design (Findings #9–#12).** That doc already specifies the partner surface; the plan must conform to it rather than invent parallel structures:
- **Namespace is `/api/partner-portal/*`** (the arch doc reserves it; internal staff tokens are never valid there), **not** `/api/partner/*`. Changing it would mean re-touching host guards + route maps + threat model — so use the reserved one.
- **HMAC ≠ a partner principal.** A shared broker secret only proves a fresh body was sent by *something* holding it. Every broker request must sign a **server-derived Supabase subject**; the platform resolves that subject to a live `partner_user`, derives org/role/allowed-locations **server-side**, and enforces org scope **before** logging a verification attempt or returning any PII.
- **Actor attribution will FK-fail as scoped.** `Redemption.actorUserId` and `RewardInventoryEvent.actorUserId` FK to internal `users`; writing a partner-user UUID violates the FK, and null loses attribution. Adding `actorPartnerUserId` to `Redemption` alone is insufficient — `complete()` writes the actor into the redemption row, the inventory ledger, **and** the redemption event. Introduce a **generalized actor subject** (type + id, mutual-exclusion constraint) across all audit-bearing rows, with transaction tests.
- **Do not reuse staff read models for partners.** `listEntitlements`/`listRedemptions` are staff views with **no mandatory org filter** and leak `phoneKey`, token hashes, and internal IDs (they mask only `prospect.phone`). Build the fail-closed, allow-listed `entitlementService.partnerView()` the arch doc already promises (it doesn't exist yet) — never the staff serializer.
- **Location model:** one nullable `partnerLocationId` can't represent multi-location staff → use a **membership junction** (or explicit org-wide flag). `complete()` currently accepts no location or any location in the org without checking activity or `RewardOfferLocation` participation — partner consume must **require/derive an actor-authorized, active, participating** location.

**Wave 5 — remove already-done items (Finding #13).** `SYSTEM_AGENT_REDIRECT_EMAIL` is already implemented (`mailer.js:164`). The IG discovery **backend** flag is already committed on main (`discoveryService.js` `DISCOVERY_IG_ENABLED`) — only the **frontend** remains. The S$1 Test Pack archive is a manual SQL step, **not** a `seed-campaign-store-content.mjs` capability (that script only does check/list/apply campaign content).

**Net:** Wave 0's executed actions were safe and are done; the review's teeth land on (1) not over-claiming SEC-02/03 closure, (2) the SMS-hook real-OTP gate, and (3) materially hardening the Wave 4 partner-app design against the existing architecture doc. All folded above.
