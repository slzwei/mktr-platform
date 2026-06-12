# Lead Package Hard‑Quota (Paywall) Plan — v2

**Status:** v2, reconciled with Codex gpt‑5.5 review (`CODEX_REVIEW_LEAD_QUOTA.md`, 2026‑06‑04).
**Scope:** `mktr-platform/backend` — lead assignment + credit enforcement.
**Goal:** Make lead packages a *gate*, not just a *meter* — opt‑in per campaign, **quarantine (never reject)** when no agent is funded.

---

## 0. Review reconciliation (what changed from v1)

Codex's verdict: **direction right, do not implement v1 as written.** All 7 blockers verified against source and accepted. The headline correction: **a quota is only real if a single shared helper owns *every* path that writes `assignedAgentId`** — v1 only covered the 3 create sources. Changes folded in:

1. **(blocker) Resolver result gets overwritten** after it returns — by QR routing (`prospectService.js:305,335,347`) and the external block (`:365`). Skipping tier‑5 alone is not enough. → the shared helper must own QR + external + quota + the final write.
2. **(blocker) Charge must be campaign‑scoped.** `deductLeadCredit` has **no** `campaignId` filter (`leadCredits.js:23-32`) — it charges any of the agent's packages. Eligibility is per‑campaign (`systemAgent.js:113`, `LeadPackage.campaignId`). → `chargeLeadCredit({ agentId, campaignId, amount, transaction })`.
3. **(blocker) Retell/Meta don't deduct at all today** (no lead‑credit import — verified). v1 implied they assign+deduct. Quota *adds* charging to them → a real behavior change to call out.
4. **(blocker) More leak paths than creation:** `PUT /api/prospects/:id` reassigns via `PROSPECT_UPDATE_FIELDS` (`:30,:43`) with no charge/webhook (`updateProspect ~:582`); `assignProspect`/`bulkAssignProspects` only best‑effort deduct (`:710,:758`).
5. **(blocker) both‑null is NOT a quarantine signal.** `assignedAgentId NULL AND externalAgentId NULL` already occurs (manual unassign `:665`; Retell/Meta with no campaign `retellService.js:225`, `metaLeadService.js:200`); migration 028 only forbids *both non‑null* (`:27`). → `quarantinedAt` is the authoritative marker; existing both‑null rows are not quarantined.
6. **(should‑fix) Release idempotency.** Webhook dispatch creates a delivery per call (`webhookService.js:96`) → a double‑click could fire two `lead.created`. Need an atomic release marker.
7. **(decision) Gate QR *automated* routing too** (agent‑group round‑robin, phone lookup). Only authenticated self/admin stay exempt.

**Effort revised: ~4–5 days** (was 1.5–2) — the consolidation refactor + all assignment paths + per‑campaign charging are the bulk; **auto‑release on top‑up (§3.4a) added to v1 on 2026‑06‑04** (+~0.5–1 day).

---

## 1. Problem / current behavior (code‑verified)

Lead packages **count** consumption but do **not** gate delivery; a lead is always assigned and delivered even with no funded agent.

- **5‑tier assignment** `systemAgent.js:77-163` — self(`:79`) / admin‑explicit(`:84`) / QR‑owner(`:94`) / package round‑robin, `leadsRemaining>0`(`:106`) / **fallback → System Agent, always returns an id**(`:160`). `DEFAULT_AGENT_ID` can make tier‑5 a real agent (`:27-38`).
- **Deduction best‑effort** `leadCredits.js:12-86`: returns `true` even on partial charge when `amount>1`(`:70`), `false` on none(`:73`), never throws(`:80`); **no `campaignId` filter**(`:23`). Callers ignore the boolean (`prospectService.js:427,710,758`).
- **The pattern we want already exists for external buyers:** `deductExternalLeadBalance` atomic conditional `UPDATE … WHERE "leadBalance" >= :amount RETURNING id`(`leadCredits.js:111`); failed charge throws `409` + rollback(`prospectService.js:422-426`). Model B = same rigor for internal agents, but **quarantine instead of 409**.
- **Quarantine has no existing marker:** both‑null already occurs for other reasons (above), so a new explicit field is required.

---

## 2. Locked decisions (defaults — Codex‑refined)

| # | Decision | Default | Note |
|---|----------|---------|------|
| a | **What's gated?** | The campaign **pool + tier‑5 fallback + all QR *automated* routing** (direct‑assign, agent‑group round‑robin, phone lookup). **Exempt = authenticated self + admin‑explicit only.** | Refined per Codex §3/§7.3 — QR auto‑routing is automated distribution, not a human override. |
| b | **No funded agent ⇒** | **Quarantine** (hold; no agent; not sent to Lyfe). | Never lose a real inbound person. |
| c | **Granularity** | Per‑campaign `enforceLeadQuota` boolean (default `false`), mirroring `Campaign.externalEligible`(`Campaign.js:163`). | Pilot on one campaign; zero blast radius. |
| d | **"Funded" =** | active `LeadPackageAssignment.leadsRemaining>0` **for this campaign** OR `User.owed_leads_count>0`. | Campaign‑scoped (blocker 2). |

---

## 3. Proposed design

### 3.1 One shared resolver+assigner (`assignOrQuarantine`)
A single helper owns the **entire** assignment decision and write, replacing the scattered logic in `createProspect` (`:174` resolver, `:300-355` QR override, `:357-379` external). It returns/writes one of:

```
{ kind:'internal', via:'self'|'admin'|'qr'|'package', agentId }
{ kind:'external', externalAgentId }
{ kind:'unassigned', reason:'no_funded_agent' }      // NEW → quarantine
```

Order: self → admin‑explicit → (if `enforceQuota` off: QR routing, package pool, system fallback unchanged) / (if on: QR‑auto + pool are quota‑gated; tier‑5 returns `unassigned` instead of System Agent). When `enforceQuota` is **off**, behavior is byte‑for‑byte today.

### 3.2 Campaign‑scoped authoritative charge
`chargeLeadCredit({ agentId, campaignId, amount=1, transaction })` returns `true` **only** on a full charge:
- atomic conditional decrement (mirror `deductExternalLeadBalance:111`) over `lead_package_assignments` **joined to packages where `campaignId` matches**, oldest `purchaseDate` first; then `users.owed_leads_count`.
- `leadsRemaining → 0` sets `status='completed'` (as today `:43`).
- legacy best‑effort `deductLeadCredit` stays only for the soft (non‑quota) path.

### 3.3 Quarantine representation
Add `prospects.quarantinedAt TIMESTAMP NULL` + `quarantineReason TEXT NULL` — **the only** quarantine signal (both‑null is not, blocker 5). FIFO‑sortable for release.

### 3.4 Webhook suppression + idempotent release
- On quarantine: create prospect, `assignedAgentId=NULL`, set `quarantinedAt`; **do not dispatch** `lead.created` (today it fires even with null agent — `prospectService.js:475`, `retellService.js:316`, `metaLeadService.js:292`).
- On release: atomic “release” update (clear `quarantinedAt`, set agent) **guarded so it runs once**, then dispatch exactly one **`lead.created`** (Lyfe first delivery; dedup by `external_id+source_name`). Not `lead.assigned` (`buildLeadCreatedPayload` `prospectHelpers.js:35`).

### 3.4a Auto‑release on top‑up (v1 — requirement 2026‑06‑04)
The held queue drains itself; the admin does not hand‑release. Trigger: any credit increase (top‑up / new package assignment) for a campaign fires a **release sweep** for that campaign (synchronous, within seconds), backed by a **periodic safety sweep** (e.g. every 1–2 min) so no top‑up path is missed.

Sweep algorithm (per campaign, FIFO):
- order held leads by `quarantinedAt ASC`; for each, **claim it atomically** (single conditional `UPDATE … WHERE quarantinedAt IS NOT NULL RETURNING` so concurrent sweeps can't double‑process), re‑resolve a funded agent, `chargeLeadCredit` (campaign‑scoped, atomic), set agent + clear `quarantinedAt`, dispatch one `lead.created`.
- stop when the queue empties **or** no funded agent remains (credits exhausted) → leftovers stay queued.
- **Partial top‑up:** +N credits releases the oldest N, the rest wait. **Multi‑agent:** released leads round‑robin across all currently‑funded agents, not only the topped‑up one.
- **Burst:** releasing K leads enqueues K `lead.created` deliveries near‑simultaneously (K pushes). Acceptable; note for very large K the webhook concurrency cap (`webhookService.js`) paces delivery.

### 3.5 Govern **every** assignment‑writing path
All must route through the helper (charge + quarantine + webhook), or quota leaks:
| Path | File | Today |
|---|---|---|
| Web create | `prospectService.createProspect:174,422-431` | best‑effort deduct |
| Retell create | `retellService.js:228,242` | **assigns, no deduct** |
| Meta create | `metaLeadService.js:204,218` | **assigns, no deduct** |
| Generic update | `updateProspect` via `PROSPECT_UPDATE_FIELDS:30,43` | **reassign, no charge/webhook** |
| Manual assign | `assignProspect:710` | best‑effort deduct |
| Bulk assign | `bulkAssignProspects:758` | best‑effort deduct |

---

## 4. Change list

| File | Change |
|------|--------|
| `models/Campaign.js` + migration | + `enforceLeadQuota` boolean (default false) |
| `models/Prospect.js` + migration | + `quarantinedAt`, `quarantineReason` |
| `services/systemAgent.js` | resolver returns `via` + `kind:'unassigned'`; quota‑gates pool + QR‑auto; tier‑5 skipped under quota |
| `services/leadCredits.js` | + `chargeLeadCredit` (campaign‑scoped, atomic, authoritative) |
| `services/<new> assignOrQuarantine.js` | shared helper owning QR+external+quota+write+charge+quarantine+webhook |
| `services/prospectService.js` | `createProspect`, `updateProspect`, `assignProspect`, `bulkAssignProspects` all route through helper; strip `assignedAgentId` from raw `PROSPECT_UPDATE_FIELDS` write |
| `services/retellService.js`, `metaLeadService.js` | route through helper (now charge + can quarantine) |
| `services/<new> releaseSweep.js` | FIFO drain on credit top‑up + periodic safety sweep (§3.4a); atomic per‑lead claim; reuses helper |
| credit top‑up path (package assign / add credits) | trigger `releaseSweep(campaignId)` post‑commit |
| admin API + UI | "Held leads" queue (`quarantinedAt IS NOT NULL`), auto‑drain on top‑up + manual "release one" override, quarantine alert |

---

## 5. Risks / edge cases
1. **Never 409 a web‑form submit** — quarantine only.
2. **Last‑credit race** — `chargeLeadCredit` atomic; on `false`, **one bounded re‑resolve** to another funded agent, else quarantine (decision §8.2).
3. **All assignment paths** covered or quota leaks (the v1 miss — blocker 4).
4. **`quarantinedAt` is the only quarantine signal**; do not reinterpret legacy both‑null rows.
5. **Retell/Meta now charge** — a behavior change; verify their campaigns are funded before enabling quota there.
6. **Release idempotency** — single `lead.created`, atomic marker (blocker 6).
7. **Backout** — flip `enforceLeadQuota=false` ⇒ soft behavior; provide "release all held".
8. **Phone‑per‑campaign uniqueness** (`prospectService.js:187-197`) still precedes quarantine.

---

## 6. Test plan
- **Unit `systemAgent`**: quota on + empty pool + no self/admin ⇒ `unassigned`; QR‑auto gated; self/admin exempt; quota off ⇒ identical to today.
- **Unit `leadCredits`**: `chargeLeadCredit` charges only the matching‑campaign package; returns true only on full charge; concurrent last‑credit ⇒ exactly one true; `status→completed` at 0.
- **Integration**: web/Retell/Meta unfunded + flag on ⇒ quarantined, no webhook, alert; flag off ⇒ delivered to fallback (regression); `updateProspect`/`assignProspect`/`bulkAssign` reassignment charges + fires correct webhook; release ⇒ single `lead.created`; double‑click release ⇒ still one. **Auto‑release:** top‑up +N with M held ⇒ oldest min(N,M) released+charged, remainder stays queued; two concurrent sweeps ⇒ no lead double‑released or double‑charged.
- **Regression**: soft campaigns + external path byte‑for‑byte unchanged.

---

## 7. Rollout
1. Ship with `enforceLeadQuota=false` everywhere (no‑op).
2. Seed a package for the pilot campaign ("Redeem $20 NTUC Fairprice Vouchers", `7f7c6524-6adb-4fe2-a187-40b4e68c26b4`) with the live roster.
3. Flip on for that campaign only; test funded→deliver, unfunded→quarantine+alert.
4. Watch the held queue; expand once stable.

---

## 8. Resolved decisions (was open questions; Codex‑agreed)
1. **Release event:** `lead.created` + idempotent release update before dispatch.
2. **Last‑credit race:** one bounded re‑resolve, then quarantine.
3. **Explicit/QR:** gate QR automated routing; exempt only authenticated self/admin.
4. **Quarantine state:** `quarantinedAt` + `quarantineReason` (not `leadStatus` — enum has no value, `Prospect.js:67`).
5. **Auto‑release:** **IN v1** (changed 2026‑06‑04). Top‑up fires a FIFO release sweep (§3.4a); admin does not hand‑release. Manual "release one" stays available as an override.
6. **Cutover scope:** the shared helper must own campaign‑scoped charging, QR post‑resolver assignment, Retell/Meta charging, `updateProspect` reassignment, and webhook idempotency.

---

## 9. Not verified from repo (Render MCP down; Codex concurs)
- `DEFAULT_AGENT_ID` in prod (would explain current "no package but an agent gets it").
- Whether the pilot campaign has any funded `LeadPackage`.
- Live roster / `owed_leads_count`.
- Lyfe `receive-mktr-lead` source (only docs in this repo); `external_id+source_name` dedup is asserted, not seen here.
