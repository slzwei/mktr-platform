# Lead Package Hard‑Quota (Paywall) Plan

**Status:** Draft for review (not yet implemented)
**Author:** Shawn + Claude
**Scope:** `mktr-platform/backend` — lead assignment + credit enforcement
**Goal:** Make lead packages a *gate*, not just a *meter* — opt‑in per campaign, **quarantine (never reject)** when no funded agent exists.

---

## 1. Problem / current behavior (code‑verified)

Today, lead packages **count** consumption but do **not** gate delivery. A lead is always assigned and delivered even when no agent has a funded package. Evidence:

- **5‑tier assignment**, `backend/src/services/systemAgent.js:77-163` (`resolveAssignedAgentId`):
  1. requester is agent → self‑assign (`:79-81`)
  2. admin + explicit agent (`:84-87`)
  3. QR‑owner agent (`:94-101`)
  4. **lead‑package round‑robin**, only agents with `leadsRemaining > 0` (`:103-158`)
  5. **fallback → System Agent** — *always returns an agent* (`:160-162`)
- The System Agent can be a real agent via `DEFAULT_AGENT_ID` (`systemAgent.js:27-38`), so tier‑5 can silently funnel every unfunded lead to one person.
- **Deduction is best‑effort**, `backend/src/services/leadCredits.js:12-86` (`deductLeadCredit`): FIFO over `LeadPackageAssignment` by `purchaseDate`, then `User.owed_leads_count` (`:50-66`); on a transaction error it logs and returns `false` **without throwing** so it "won't break the prospect creation flow" (`:80-85`). Net effect: no package ⇒ lead still delivered, uncharged.
- Called best‑effort in the create txn at `backend/src/services/prospectService.js:427-431` (internal branch).

**Contrast — the pattern we want already exists for external buyers:** `deductExternalLeadBalance` (`leadCredits.js:105-127`) is an **atomic conditional** `UPDATE … WHERE "leadBalance" >= :amount RETURNING id`; in `createProspect` a failed charge **throws `AppError(409)` and rolls back** (`prospectService.js:422-426`). Model B = apply that rigor to internal agents, but **quarantine instead of 409** (inbound humans must never be rejected).

**Schema already anticipates quarantine:** `prospects.assignedAgentId` is nullable (`backend/src/models/Prospect.js:176-178`), mutually exclusive with `externalAgentId` (`:184-191`), and migration `028-add-prospect-external-agent-id.js` comments that a lead may exist "while quarantined" and that the set column drives webhook destination.

---

## 2. Locked decisions (defaults — reviewer may challenge)

| # | Decision | Default | Rationale |
|---|----------|---------|-----------|
| a | **What is gated?** | Only the **automated campaign default** (tier‑4 pool + tier‑5 fallback). Explicit routes (self/admin/QR‑owner, tiers 1‑3) still deliver + best‑effort deduct. | Tiers 1‑3 are deliberate human/QR targeting; gating them would surprise operators. |
| b | **No funded agent ⇒** | **Quarantine** (hold the prospect, no agent, not sent to Lyfe). | Never lose a real person who filled the form. Reject is correct only for paid external buyers. |
| c | **Granularity** | **Per‑campaign** boolean `enforceLeadQuota` (default `false`), mirroring `Campaign.externalEligible` (`backend/src/models/Campaign.js:163`). | Pilot on one campaign; zero blast radius elsewhere. |
| d | **"Funded" means** | active `LeadPackageAssignment.leadsRemaining > 0` **OR** `User.owed_leads_count > 0`. | Matches what `deductLeadCredit` already draws down. |

---

## 3. Proposed design

### 3.1 Resolver returns the *route*, and can say "unassigned"
Evolve the tagged resolver `resolveLeadAssignment` (`systemAgent.js:187-269`, currently additive/inert) into the single internal resolver. Return shape:

```
{ kind: 'internal', via: 'self'|'admin'|'qr'|'package', internalAgentId }
{ kind: 'unassigned', reason: 'no_funded_agent' }      // NEW
```

Logic when `enforceQuota === true`:
- tiers 1‑3 unchanged → `via: self|admin|qr` (exempt per decision **a**).
- tier‑4 pool empty (no agent with `leadsRemaining > 0`) **and** no explicit route ⇒ **skip tier‑5**, return `{ kind:'unassigned', reason:'no_funded_agent' }`.
- when `enforceQuota === false`: behavior **byte‑for‑byte unchanged** (tier‑5 still returns System Agent).

Keep `resolveAssignedAgentId` as a thin back‑compat wrapper (or migrate all callers).

### 3.2 Authoritative charge
Add `chargeLeadCredit(agentId, 1, t)` in `leadCredits.js` that returns `true` **only** on a full charge, using an atomic conditional decrement (mirror `deductExternalLeadBalance:111-118`) against `lead_package_assignments` (oldest `purchaseDate` first), then `users.owed_leads_count`. On `leadsRemaining` hitting 0, set `status='completed'` (as today, `leadCredits.js:43-45`). The legacy best‑effort `deductLeadCredit` stays for the soft (non‑quota) path.

### 3.3 createProspect / Retell / Meta — one shared branch
Centralize in `assignOrQuarantine({ resolution, campaign, t })` used by all three sources so quota cannot leak:
- **web form** `prospectService.createProspect` (`:174-179`, `:382-431`)
- **Retell** `backend/src/services/retellService.js` (round‑robin step)
- **Meta** `backend/src/services/metaLeadService.js` (`processMetaLead` → `resolveAssignedAgentId`)

Branch:
- `kind:'internal'` + quota on → `chargeLeadCredit`; if `false` (lost the last‑credit race) → **quarantine** (no retry loop); else assign + fire `lead.created`.
- `kind:'internal'` + quota off → unchanged (best‑effort `deductLeadCredit`).
- `kind:'unassigned'` → create prospect with `assignedAgentId = NULL`, `quarantinedAt = now()`, `quarantineReason`; **do not** dispatch the Lyfe webhook; enqueue an admin alert.
- `kind:'external'` → unchanged (`prospectService.js:422-426`).

### 3.4 Quarantine representation
Add `prospects.quarantinedAt TIMESTAMP NULL` + `quarantineReason TEXT NULL` (null = assigned). Sortable for FIFO release; non‑breaking; clearer than overloading `leadStatus` (`Prospect.js:67`, which has no `quarantined` value). Reviewer: prefer this vs a `leadStatus` enum addition?

### 3.5 Release path (quarantine → agent)
Admin action (and optional auto‑release on top‑up): pick oldest quarantined lead for the campaign → `chargeLeadCredit` → set `assignedAgentId`, clear `quarantinedAt` → fire **`lead.created`** (first time Lyfe sees it; Lyfe dedups by `external_id + source_name='mktr'`). Reviewer: confirm `lead.created` (not `lead.assigned`) is correct for first delivery.

---

## 4. Change list

| File | Change |
|------|--------|
| `backend/src/models/Campaign.js` | + `enforceLeadQuota` boolean (default false) |
| `backend/src/models/Prospect.js` | + `quarantinedAt`, `quarantineReason` |
| `backend/src/database/migrations/0XX-*.js` | add the 3 columns (all nullable / default false — safe, additive) |
| `backend/src/services/systemAgent.js` | resolver returns `via` + `kind:'unassigned'` under `enforceQuota`; tier‑5 skipped |
| `backend/src/services/leadCredits.js` | + `chargeLeadCredit` (authoritative, atomic conditional) |
| `backend/src/services/prospectService.js` | route through `assignOrQuarantine`; quarantine branch; suppress webhook |
| `backend/src/services/retellService.js` | same branch |
| `backend/src/services/metaLeadService.js` | same branch |
| `backend/src/services/*` (new) | `assignOrQuarantine()` shared helper |
| admin API + UI | "Held leads" queue, "assign to agent" action, quarantine alert |

---

## 5. Risks / edge cases

1. **Never 409 a web‑form submit** — quarantine only (the single divergence from the external path).
2. **Last‑credit race** — two concurrent leads, one credit. `chargeLeadCredit` must be atomic‑conditional; loser quarantines (chosen over a retry loop — simpler, no starvation). Reviewer may prefer one bounded re‑resolve.
3. **Cross‑source leak** — Retell/Meta must use the same helper or unfunded leads slip through.
4. **Quarantine pile‑up** — admin alert + queue is **mandatory**, or paid leads strand silently.
5. **Webhook correctness** — quarantined leads must NOT emit `lead.created`; release emits exactly one.
6. **Phone‑per‑campaign uniqueness** (`prospectService.js:187-197`) still applies before quarantine.
7. **Backout** — flip `enforceLeadQuota=false` ⇒ soft behavior returns; provide "release all held" admin action for the backlog.
8. **System Agent / `DEFAULT_AGENT_ID`** — must not absorb quota‑gated leads when the flag is on.

---

## 6. Test plan

- **Unit (`systemAgent`)**: quota on + empty pool + no explicit route ⇒ `unassigned`; self/admin/QR still assign; quota off ⇒ identical to today.
- **Unit (`leadCredits`)**: `chargeLeadCredit` returns true only on full charge; concurrent last‑credit ⇒ exactly one true; `status` → completed at 0.
- **Integration**: web‑form lead, campaign flag ON, zero credits ⇒ prospect quarantined, no webhook, alert enqueued; flag OFF ⇒ delivered to fallback (regression unchanged); top‑up + release ⇒ single `lead.created`; repeat for Retell + Meta.
- **Regression**: existing soft campaigns + external‑buyer path byte‑for‑byte unchanged.

---

## 7. Rollout

1. Ship behind `enforceLeadQuota=false` everywhere (no‑op).
2. Seed a package for the pilot campaign (e.g. "Redeem $20 NTUC Fairprice Vouchers", id `7f7c6524-6adb-4fe2-a187-40b4e68c26b4`) with the live agent roster.
3. Flip the flag on **only** that campaign; submit one test lead funded + one unfunded; verify deliver vs quarantine + alert.
4. Watch the held‑leads queue; expand to other campaigns once stable.

**Effort:** core logic ~0.5 day; cross‑source wiring + admin queue + alerts + tests ~1.5–2 days.

---

## 8. Open questions for the reviewer

1. Release event: `lead.created` vs `lead.assigned` for a quarantine→agent transition (Lyfe has never seen the lead)?
2. Lost last‑credit race: quarantine immediately, or one bounded re‑resolve to another funded agent first?
3. Decision **a** — should explicit/QR routes (tiers 1‑3) *also* be quota‑gated for a stricter paywall, or stay exempt?
4. Quarantine state: `quarantinedAt` timestamp (proposed) vs a `leadStatus='quarantined'` enum value?
5. Auto‑release on package top‑up now, or manual‑assign only for v1?
6. Anything the additive `resolveLeadAssignment` cutover breaks that this plan misses?

---

## 9. Not verified from repo (Render MCP unavailable at authoring time)

- Whether `DEFAULT_AGENT_ID` is set in prod (would explain current "no package but an agent gets it").
- Whether the pilot campaign currently has any `LeadPackage` / funded assignments.
- Live agent roster + `owed_leads_count` values.
