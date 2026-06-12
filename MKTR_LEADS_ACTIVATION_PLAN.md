# MKTR Leads (External-Buyer Marketplace) — Activation Plan (v2, Codex-reviewed)

> **⚠ SUBORDINATE doc — Phase-0 gap / risk register, NOT the source of truth.** Canonical plan:
> `~/lyfe-master/MKTR_LEADS_PLAN.md`. This file was drafted before confirming the `mktr-leads` app
> + its Supabase project (`rciuejxgziqxrwtifpbo`) already exist — so ignore any "greenfield" framing.
> The locked decisions below (2026-06) and the assumptions audit
> (`~/lyfe-master/CODEX_REVIEW_MKTR_LEADS_ASSUMPTIONS.md`) supersede the original open questions.

Repo: `mktr-platform`. Scaffolding shipped inert via PR #25 (`9af9f74` on `main`).
v2 folds in an extensive Codex review (`gpt-5.5`, xhigh) — see `CODEX_REVIEW_MKTR_LEADS_PLAN.md`.
**Verdict to act on:** safe to *start* the routing refactor (W1) and delivery-routing *design* (W2)
now; **do NOT** land public consent acceptance, an external subscriber, or live buyer funding until
the blocker workstreams below are built and resequenced.

---

## 0. Current state (verified on `main` @ 9af9f74)

Built & inert: `ExternalAgent` (global prepaid `leadBalance`), `ExternalCampaignAgent` (per-campaign
eligibility), `prospects.externalAgentId` + CHECK `chk_prospect_single_assignee` (mig 028),
`prospects.consentMetadata` (mig 032), wallet (mig 030, header mis-says "029"), `campaigns.external_eligible`
(**mig 031** — was missing from v2 draft), `hasValidExternalConsent()`, unified router
`resolveLeadAssignment()`, `deductExternalLeadBalance()`, and the inert `createProspect` external branch.

**Why inert (real for the public web path, NOT sufficient against direct service/script/DB callers):**
1. `validation.js prospectCreate` rejects unknown `consentMetadata` (Joi disallows unknown keys).
2. Frontend only sends `consent_contact`/`consent_terms`; nothing writes `consentMetadata.external`.
3. `createProspect` suppresses external `lead.created`, and no external destination exists.

**Already-latent config gaps (fix as part of W9):** `campaign.externalEligible` cannot be set via any
campaign API (`validation.js`/`campaignService` omit it), yet `duplicateCampaign()` copies it via
`...toJSON()` — so a DB-set eligible campaign propagates on admin duplicate.

---

## Workstreams (severity = highest Codex finding inside)

### W1 — Single-pass routing + external hold semantics  [BLOCKER; start now]
- Replace the double routing pass: today `createProspect` calls `resolveLeadRouting()` then, when
  `allowExternal`, `resolveLeadAssignment()` — advancing the campaign cursor **twice**. Make the
  unified router the **only** code path that advances the cursor and have it return
  `{ kind, agentId, via, holdReason }` so the quota gate never sees a stale `via`.
- **External hold must be a distinct state, not plain quarantine.** An external-eligible lead with no
  funded buyer must be held with an *external* marker so the **release sweep (W6)** never dispatches it
  into Lyfe. (`resolveLeadAssignment` tier-5 currently falls back to System Agent — must become an
  external hold for external-only campaigns.)
- Add a campaign **routing policy** to distinguish *internal* / *mixed* / *external-only* (schema only
  has the boolean `externalEligible` today). Drives fallback-vs-hold and ratio expectations.
- Note `pickFromRing` is fair per-entry but lists all internal before all external → internal/external
  ratio must be an explicit product decision; `enqueueCampaign` is process-local (multi-instance relies
  on the atomic DB cursor — keep, but test `findOrCreate` races).
- Tests: mixed ring, all-internal, all-external-funded, all-external-unfunded, consent/no-consent
  sharing one cursor.

**W1 status:** the single-pass refactor + `via` plumbing SHIPPED on branch
`feat/mktr-leads-routing-foundation` (commit `3606a78`) — behavior-preserving for the live
internal path, Codex-reviewed (`CODEX_REVIEW_W1_ROUTING.md`, no merge-blocking regression).
**W1b (remaining, before external activation), confirmed by that review:**
  1. **QR parity** — `resolveLeadAssignment` only handles direct QR `assignedAgentId`/`ownerUserId`,
     NOT QR round-robin agent-groups or the legacy `assignedAgentPhone` fallback. Because
     `createProspect` skips its QR-override block for external-eligible leads, those QR modes would be
     lost. Fold them into the unified resolver (or re-enable per-tier) before external goes live.
  2. **No-buyer hold** — implement the external-hold marker + routing-policy field so a consented,
     external-eligible lead with no funded buyer HOLDS instead of falling back to the System Agent
     (and the W6 release sweep excludes external holds).

### W2 — Destination-aware delivery for ALL lead events  [BLOCKER; design now, land before any external subscriber]
- `webhookService.dispatchEvent()` broadcasts to **every** enabled subscriber matching the event type —
  no destination filter. Add per-lead destination targeting: internal → Lyfe subscriber only; external →
  MKTR Leads subscriber only. Cover **`lead.created`, `lead.assigned`, AND `lead.unassigned`** (Lyfe is
  registered for all three; payloads carry PII).
- Per-destination HMAC secrets (no Lyfe-secret reuse), rotation.
- **Pre-existing risk to close now:** admin webhook CRUD already lets someone add a `lead.created`
  subscriber that (with `WEBHOOK_ENABLED=true`) would receive **all internal leads**. W2 destination
  filtering closes this; until then, treat external-subscriber creation as forbidden.

### W3 — External charge ledger: idempotency, refund/clawback, reconciliation  [BLOCKER; NEW — was missing]
- Today the buyer is charged (`deductExternalLeadBalance`) inside lead creation, but delivery is async
  and best-effort; a permanently-failed webhook (or a dropped delivery when the in-process queue
  overflows) = **paid-but-undelivered**. `WebhookDelivery.deliveryId` dedupes delivery rows, not paid
  entitlement.
- Introduce a charge ledger (`pending → delivered → refunded`) with an idempotency key, and either move
  **charge finalization to after durable delivery acceptance**, or auto-refund on terminal delivery
  failure. Add reconciliation (balance vs. ledger) + a TOCTOU fix: balance is filtered at routing but
  charged later, so two concurrent leads can pick the same balance-1 buyer → on charge failure,
  re-route or hold (never a bare 409 to the prospect).

### W4 — Server-derived consent  [BLOCKER; reframed from v2]
- **Do not whitelist client-supplied `consentMetadata.external`** (forgeable). The client sends a narrow
  boolean ("I agree to third-party disclosure, vN"); the **server constructs** the evidence record from
  that boolean + known campaign id + source + server timestamp + the versioned disclosure text it served.
- Harden `hasValidExternalConsent()` beyond shape: enforce a version allowlist, server-set
  `consentedAt` (reject client/future timestamps), and campaign/source match.
- Source-specific: web = checkbox + versioned copy; **Meta & Retell stay internal** until each has real
  consent evidence (form question / verbal step). 
- PDPA: disclosure text + versioning, withdrawal handling, disclosure audit log.

### W5 — External-buyer source of truth, identity, funding ledger, receiver  [BLOCKER; gates W2/B-subscriber]
- Decide: the separate **"MKTR Leads" Supabase project** (per `ExternalAgent` comment) vs. an admin
  surface in mktr-platform. Define sync direction, buyer identity mapping (`agents.mktr_user_id`),
  conflict handling, and the **receiver endpoint + auth** (this is the W2 external destination).
- Build external-agent + eligibility + balance CRUD (none exists today) with a **top-up ledger** (no
  funding without a ledger → no refunds/audit/reconciliation).

### W6 — Manual-path, sweep & user-lifecycle guards  [BLOCKER; before live]
Pinpointed writers that mishandle external leads today:
- `assignProspect` (`prospectService.js:773`) — no external guard; assigning an external lead to an
  internal agent hits the CHECK unless `externalAgentId` is intentionally cleared.
- unassign (`:781`) — leaves `externalAgentId`, can emit `lead.unassigned` to all subscribers.
- bulk assign (`:901`) — doesn't filter `externalAgentId IS NULL`.
- **release sweep (`releaseSweep.js:35`)** — picks any quarantined prospect and dispatches internal
  `lead.created`; external holds must be excluded/represented separately (ties to W1).
- user deactivate/delete/bulk-delete assignment clearing (`userService.js:329`).
- Make external↔internal conversion **admin-only** (current route auth lets agents assign too).

### W7 — Observability & alerting  [BLOCKER; NEW]
Alerts/metrics for: external assignment, charge failure, delivery failure, refund, low buyer balance,
destination mismatch, consent rejection.

### W8 — Privacy operations (PDPA)  [should-fix; before scale]
Data-subject-right propagation to the buyer, consent withdrawal, retention/deletion sync, disclosure
records. Rate-limiting/replay protection on the external receiver; abuse controls on monetized public
capture.

### W9 — Campaign config surface  [should-fix; needed to actually enable a campaign]
Add `externalEligible` + routing-policy to campaign create/update validation + service; guard
`duplicateCampaign()` from silently propagating eligibility.

---

## Strict build order (gated)

1. **Now (safe):** W1 routing refactor; W2 + W3 + W5 **design**.
2. **Then:** W3 ledger + W6 guards + W1 external-hold semantics (these make the system *safe to hold/charge*).
3. **Then:** W2 destination dispatch (all events) → only after which W5's external subscriber may be registered.
4. **Then:** W4 server-derived consent + W9 config surface.
5. **Then:** W7 observability, W8 privacy.
6. **Last:** staged rollout (G).

**Hard gates — do NOT do before its prerequisite:**
- No external subscriber registered before W2 destination filtering (else internal-lead leak).
- No public consent acceptance before W4 server-derived consent + W6 guards + external-hold semantics.
- No live buyer funding before W3 ledger + W5 source-of-truth.

---

## Test matrix
Automated (before enable): consent fail-safe (server-derived) · single-pass cursor · quota-gate via ·
charge-exactly-once + idempotency · no-balance ⇒ external-hold (never free, never Lyfe) · no
stream-crossing on created/assigned/unassigned · destination dispatch · release-sweep excludes external ·
manual assign/unassign/bulk/user-delete guards · TOCTOU concurrent same-buyer · null-email external payload.
Manual (staging, fake buyer + `is_test_data` leads): the six scenario groups, by eye, pre-production.

## Rollout
Staging (fake funded buyer) → 1 buyer / 1 campaign live + close monitoring → widen.

## Decisions (LOCKED 2026-06) — formerly "open questions"
1. **Where external buyers live** — DECIDED: the separate **`mktr-leads` Expo app + its own Supabase
   project `rciuejxgziqxrwtifpbo`** (already built). Buyers mirror into MKTR `external_agents`
   (`id` ↔ `agents.mktr_user_id`); MKTR delivers via HMAC webhook to the app's `receive-mktr-lead`.
2. **Sources** — DECIDED: ALL sources eligible (web, Meta, Retell), each needing its own consent path;
   sequence web → Meta → Retell. Meta/Retell stay internal until their consent evidence exists.
3. **Charge timing** — DECIDED: **reserve-then-commit** (hold a credit at routing; commit on the
   receiver's delivery ack; release/refund on permanent failure). Shapes the W3 charge ledger.
4. **Billing** — DECIDED: manual admin top-up for MVP; self-serve checkout deferred.
5. **Campaign mixing** — DECIDED: **mixed campaigns allowed** (internal + external in one pool);
   needs an explicit interleave/fairness policy (W1b routing policy).
6. **Still open (legal):** third-party-disclosure consent copy + version + PDPA sign-off — drafted by
   me, approved by you/legal before consent (W4) goes live.

## Late-found gaps (assumptions audit, 2026-06)
- **Outcome loop missing on the platform side:** no `/api/external/lead-outcomes` route, and raw-body
  capture excludes `/api/external/` — needed to receive `report-lead-outcome` from `mktr-leads`. (New workstream.)
- **`mktr_user_id` fallback:** `mktr-leads` `handle_new_user` falls back to the auth uid when an invite
  lacks `mktr_user_id` — discipline invite provisioning so the stable mapping holds.
