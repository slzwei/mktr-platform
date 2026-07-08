# Redeem Ops — Domain Ownership Map

> Phase 0 deliverable. Purpose: prevent accidental domain duplication. "MKTR" below means the
> existing monolith's acquisition domains (same repo, same DB); "Redeem Ops" means the new module
> namespace defined in `RECOMMENDED_ARCHITECTURE.md`. Integration methods reference
> `MKTR_INTEGRATION.md`.

## Ownership table

| Domain | Current Owner (system of record) | Future Owner | Integration Method | Notes / canonical artifact |
|---|---|---|---|---|
| Campaign | MKTR — `campaigns` table | **MKTR (unchanged)** | FK reference (`activations.campaignId`) + read-only projection endpoint | `backend/src/models/Campaign.js`, `campaignService.js`. Redeem Ops never writes campaigns. |
| Campaign Builder | MKTR — designer/workspace UI | **MKTR (unchanged)** | Deep link only (`/admin/campaigns/:id/workspace` on mktr.sg) | `src/pages/AdminCampaignDesigner.jsx`, `AdminCampaignWorkspace.jsx`. No second builder. |
| Landing Page | MKTR — `Campaign.design_config` rendered by `LeadCapture.jsx` | **MKTR (unchanged)** | None (Redeem Ops displays the public URL only) | Host-aware URLs via `src/lib/brand.js` helpers. |
| Lead | MKTR — `prospects` table | **MKTR (unchanged)** | FK reference (`reward_entitlements.prospectId`) + server-side joined reads | `backend/src/models/Prospect.js`. Redeem Ops stores no lead PII copies. |
| OTP Verification | MKTR — `verifications` + `verificationService.js` | **MKTR (unchanged)** | None in V1; Phase 6 redemption may *reuse the service* for consumer phone checks (no new OTP system) | AWS SNS / WhatsApp; SG-only. |
| Consent | MKTR — `prospects.consentMetadata` + `sourceMetadata.consent_*` | **MKTR (unchanged)** | Read-only interpretation when issuing entitlements / partner disclosure | `externalConsent.js` is the interpretation precedent. |
| Attribution | MKTR — `attributions`, `qr_scans`, `session_visits`, `sourceMetadata` | **MKTR (unchanged)** | Not consumed by Redeem Ops V1; activation analytics read campaign aggregates only | `trackerService.js`, `leadCaptureBind.js`. |
| Lead Routing | MKTR — `systemAgent.js` round-robin, quota, held queue | **MKTR (unchanged)** | None. Reward entitlement issuance is post-capture and must never influence routing | `resolveLeadRouting` / `resolveLeadAssignment`. |
| Agent/Advisor Assignment | MKTR — `prospects.assignedAgentId` / `externalAgentId` | **MKTR (unchanged)** | Read-only display where relevant (e.g. entitlement context) | Agent sources synced from Lyfe/mktr-leads. |
| Financial-planning outcomes | MKTR/Lyfe — `leadStatus`, down-funnel CAPI | **MKTR (unchanged)** | Not exposed to partners; internal analytics may read aggregates | `leadOutcomeService.js`. Privacy rule §35.2. |
| Partner Organisation | none | **Redeem Ops** | native | New `partner_organisations` (greenfield — verified no existing model). |
| Partner Location | none | **Redeem Ops** | native | New `partner_locations`. |
| Partner Contact | none | **Redeem Ops** | native | New `partner_contacts`. Distinct from MKTR consumer `prospects` and from `contact.js` (public contact-us form). |
| Outreach Activity | none | **Redeem Ops** | native | New `outreach_activities`. Pattern precedent: `prospect_activities`. |
| Task / Follow-up | none | **Redeem Ops** | native | New `outreach_tasks`. `Prospect.nextFollowUpDate` is a lead field, not a task system — do not overload it. |
| Partner Pipeline (stages) | none | **Redeem Ops** | native | New `partner_organisations.pipelineStage` + `partner_stage_events` history. |
| Business Claiming / Ownership | none | **Redeem Ops** | native | New `ownerUserId` + `partner_assignment_events`; concurrency via conditional UPDATE (house pattern). |
| Prospecting Pool | none | **Redeem Ops** | native | New `prospecting_pools` + members; claim-next via `FOR UPDATE SKIP LOCKED` (pattern: `chargeLeadCredit`). |
| Partner Onboarding | none | **Redeem Ops** | native | New `partner_onboarding_items` (templated checklist). |
| Reward Offer | none | **Redeem Ops** | native | New `reward_offers`. NOT the campaign `gift*` columns (migration 044 — MKTR→agent gift purchase; different domain, stays with MKTR billing). |
| Reward Terms | none | **Redeem Ops** | native | New `reward_terms_versions` (versioned structured + free-text). |
| Reward Inventory | none | **Redeem Ops** | native | New `reward_inventory_events` ledger + guarded counters. Precedent to follow for safety (not for shape): `lead_package_assignments.leadsRemaining` counters. |
| Reward Allocation | none | **Redeem Ops** | native | Ledger `allocated`/`deallocated` events bound to an Activation. |
| Activation | none | **Redeem Ops** | native + FK to `campaigns.id` | New `activations`. Explicitly NOT a campaign: no design_config, no forms, no pixels, no routing. |
| Campaign Link (Activation↔Campaign) | none | **Redeem Ops** | FK + read-only campaign projection | Unique active activation per campaign (see `ERD.md`). |
| Reward Entitlement | none | **Redeem Ops** | native + FK to `prospects.id` | New `reward_entitlements`; idempotent on `(activationId, prospectId)`. |
| Redemption | none | **Redeem Ops** | native | New `redemptions` + `redemption_events`; random token, server-validated, double-redemption-proof. |
| Partner Analytics | none | **Redeem Ops** | native (Redeem data) + read-only MKTR aggregates | Acquisition numbers always sourced from MKTR (`computeCampaignMetrics`), never re-counted. |
| Partner Renewal | none | **Redeem Ops** | native | Renewal outcome recorded on Activation + follow-up task; no new scheduling infra. |
| Identity / Login (internal staff) | MKTR — `users` + JWT cookie | **MKTR (shared)** | Same `authenticateToken`; new sub-role column + capability middleware | See `PERMISSION_MATRIX.md`. No second auth system. |
| Identity (future partner portal users) | none | **Redeem Ops (future)** | Separate `partner_users` principal table, same JWT infra, distinct token scope | Designed-not-built; see `RECOMMENDED_ARCHITECTURE.md` §7. |
| Audit Log (Redeem Ops actions) | none (no generic infra exists) | **Redeem Ops** | native | New `redeem_ops_audit_events`, append-only. |
| Notifications / Email | MKTR — `mailer.js` (brand-aware senders) | **MKTR (shared)** | Direct service reuse for task/assignment emails (later) | `resolveEmailFrom(context)` already supports per-surface senders. |
| File uploads | MKTR — `uploadService.js` → `backend/uploads/` | **MKTR (shared)** | Direct reuse if partner logos/docs needed (later) | |

## Duplication tripwires (things that look adjacent but must stay separate)

1. **Partner Organisation vs `users`/`external_agents`** — partners are businesses we sell rewards
   *from*; users are staff/agents. Never model partner businesses as users. (Future partner-portal
   *people* get their own principal table.)
2. **Outreach pipeline vs lead pipeline** — `Prospect.leadStatus` (`new…won`) is consumer-lead
   lifecycle; the partner pipeline (`UNCLAIMED…PARTNERED`) is a different state machine on a
   different entity. No shared enum.
3. **Reward Offer vs Campaign gift (migration 044)** — the gift catalog is a *billing* feature
   (agents buy a gift from MKTR). Reward Offers are partner-funded supply with inventory and
   redemption. If the business later unifies them, that is a product decision — not assumed here.
4. **Activation vs Campaign** — an Activation *references* a campaign; activating/pausing a
   campaign remains `setCampaignLaunchState` in MKTR. Activation status is operational
   (reward-side) only.
5. **Redemption vs lead outcome** — redeeming a reward is not `leadStatus=won`; neither writes the
   other automatically in V1.
6. **Outreach tasks vs Lyfe candidate/interview machinery** — Lyfe's recruitment domain lives in a
   different product entirely; nothing here touches Supabase.
