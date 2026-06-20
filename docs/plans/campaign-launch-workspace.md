# Plan — Campaign Launch Workspace + Campaign-First Credits

> Status: planning. Source: audit (2026-06-20) + Codex 5.5 xhigh plan, reviewed against the codebase by Claude. This doc is the build spec.

## Goal
Replace today's fragmented 5-page campaign launch flow (`AdminCampaigns` → `AdminCampaignForm` → `AdminCampaignDesigner` → `AdminLeadPackages` → `AdminAgents`) with **one tabbed "Launch a Campaign" workspace**, and make lead **credits campaign-first** (the campaign shows its own funded-agent pool + remaining credits + bulk top-up).

## Guiding constraints
- **`main` deploys mktr.sg to production.** Ship **dark**: workspace routes always mounted, but list/nav entry points gated behind `VITE_CAMPAIGN_WORKSPACE_ENABLED` (default OFF). Flipping the flag on the `mktr-platform` static site + redeploy makes it live. Old pages stay fully functional → trivial rollback.
- **Additive only.** No destructive DB drops. Live routing/credits model (`systemAgent.resolveLeadRouting`, `LeadPackageAssignment.leadsRemaining`) is untouched.
- New admin APIs live under **`/api/admin/campaigns`** so `internalRouteHostGuard` (blocks `/api/admin/*` from redeem.sg) protects them automatically. Auto-loaded via `export const meta = { path: '/api/admin/campaigns' }`.

## 1. Current-state map (verified)
| Flow | Code | Disposition |
|---|---|---|
| List + type picker | `AdminCampaigns.jsx:90` (`CampaignTypeSelectionDialog` → `/admin/campaigns/new?type=`) | Keep list; repoint create/edit/design actions to workspace (flag-gated) |
| Basic form | `AdminCampaignForm.jsx:27/141` (name/type/dates/age/commission/PHV media) | Extract field UI into Details tab; keep page mounted for rollback |
| Designer | `AdminCampaignDesigner.jsx:17` (`DesignEditor` + `CampaignReadinessBanner` + preview) | Reuse `DesignEditor`/`CampaignReadinessBanner` in Design + Launch tabs; keep page for rollback |
| Package templates | `AdminLeadPackages.jsx:40` + `LeadPackageTemplateDialog` | Keep as global template CRUD; reuse dialog with `campaignId`/`lockCampaign` |
| Agent funding | `AdminAgents.jsx:160` → `AssignPackageDialog` (single agent, `POST /lead-packages/assign`) | Keep as agent-maintenance; add campaign-first bulk pool in workspace |
| Routing/credits | `systemAgent.js:88/114`, `LeadPackageAssignment.leadsRemaining` | Untouched. Pool aggregates `LeadPackageAssignment` by `LeadPackage.campaignId`, **not** `CampaignAgentAssignment` |

## 2. Target UX — `AdminCampaignWorkspace.jsx`
Routes: `/admin/campaigns/new` (create mode) and `/admin/campaigns/:id/workspace?tab=` (edit mode), `ProtectedRoute requiredRole="admin"`.
Tabs (non-Details tabs disabled until the campaign has an `id`):
1. **Details** — reuse `AdminCampaignForm` field set (name, dates, age, commissions, PHV media) + new: `enforceLeadQuota` toggle, `metaPixelId`, `tiktokPixelId`. **Create saves `is_active:false` (draft)** so a campaign never goes live before it's funded. On first save → navigate to `/admin/campaigns/:id/workspace?tab=design`.
2. **Design** — embed `DesignEditor` (new optional `heightClass` prop so it fits the tab) + keep preview action from `AdminCampaignDesigner`.
3. **Delivery Pool** *(headline)* — new `CampaignDeliveryPoolTab`: table of funded agents (remaining credits, last package assigned, held count), **multi-select agents + pick/create a campaign-locked package → bulk assign**, per-agent top-up (reuse `PATCH /lead-packages/assignments/:id`).
4. **Sources** — embed `CampaignQRManager` (new `embedded` prop hides Back + page chrome) + copy LeadCapture link via `customerLeadCaptureUrl(campaignId, …, resolveCustomerHost(design_config.customerHost))`.
5. **Launch** — reuse `CampaignReadinessBanner` + Activate/Pause buttons (calls launch-state endpoint; blocks activate when not ready unless forced).

**Scope note:** `externalEligible` (MKTR-Leads external-buyer path) is intentionally **not** surfaced — that pool is inert/not live; exposing it would mislead. Deferred.

## 3. Backend changes
New file `backend/src/routes/adminCampaigns.js`, `export const meta = { path: '/api/admin/campaigns' }`, all routes `authenticateToken` + `requireAdmin`.

1. **`GET /api/admin/campaigns/:id/delivery-pool`** → `campaignController.getDeliveryPool` → `leadPackageService.getCampaignDeliveryPool(campaignId)`.
   - Aggregate active `LeadPackageAssignment` (leadsRemaining>0) whose `LeadPackage.campaignId = :id`, grouped by agent (active `role:'agent'` only — mirror `campaignReadinessService:128`). Include campaign packages, totals (`fundedAgents`, `remainingCredits`, `heldLeads = Prospect.count({campaignId, quarantinedAt≠null})`).
2. **`POST /api/admin/campaigns/:id/delivery-pool/assign`** → `bulkAssignPackage({ campaignId, packageId, agentIds[] })`.
   - Validate package.campaignId === :id; validate each agent active `role:'agent'`; bulk-create assignments (`leadsTotal=leadsRemaining=pkg.leadCount`, `priceSnapshot`); **one** `sweepCampaign(campaignId)` post-commit (not per-agent). All-or-none in a transaction. Skip agents who already have an active assignment for that package (idempotent) — report skipped.
3. **`PATCH /api/admin/campaigns/:id/launch-state`** → `{ state: 'active'|'paused', force?:bool }` → `campaignService.setCampaignLaunchState`.
   - On `active`: `loadCampaignReadiness(id)`; if not `ready` and not `force` → 409 `{ readiness }`. Else set `is_active=true,status='active'`. On `paused`: `is_active=false,status='paused'` (dedicated method — do **not** reuse `Campaign.update`, which maps inactive→draft).
4. **Persist pixels:** extend `schemas.campaignCreate`/`campaignUpdate` (`validation.js`) + `campaignService.createCampaign`/`updateCampaign` to accept/persist `metaPixelId`, `tiktokPixelId` (string≤64, nullable). `enforceLeadQuota` already wired.
5. *(Optional bonus)* `trackerService` QR-session hydration: add `tiktokPixelId` alongside `metaPixelId`.

## 4. Frontend changes
1. `src/pages/AdminCampaignWorkspace.jsx` + lazy import + routes in `index.jsx` (always mounted).
2. `CampaignEntity` (client.js:435): `getDeliveryPool(id)`, `bulkAssignDeliveryPool(id, payload)`, `setLaunchState(id, payload)` → call `/admin/campaigns/:id/...`.
3. Hooks (`useCampaignsQuery.js`): `useCampaignDeliveryPool(id)`, `useBulkAssignCampaignPackage(id)`, `useSetCampaignLaunchState(id)`; invalidate `['campaignDeliveryPool',id]`, `['campaigns']`, `['leadPackages']`, `['agents']`.
4. `CampaignDeliveryPoolTab.jsx` (new). Reuse `LeadPackageTemplateDialog` (+`campaignId`/`lockCampaign`), `ManagePackages`-style credit edit.
5. Embedding props: `DesignEditor` `heightClass?`, `CampaignQRManager` `embedded?`.
6. Nav (flag-gated, `VITE_CAMPAIGN_WORKSPACE_ENABLED`): `AdminCampaigns` create/edit/design actions → workspace tabs when ON; unchanged when OFF.

## 5. Migration / coexistence
No DB migration (quota/pixels/external already shipped + nullable/defaulted). Lead capture (`POST /api/prospects`) and routing unchanged. Brand split intact: SPA `ProtectedRoute` redirects redeem builds; backend `/api/admin/*` host-guarded. Old pages remain mounted.

## 6. Phasing (one branch, commit per phase)
1. Backend: pool read + bulk assign + launch-state + pixel persistence + Jest tests.
2. Workspace shell + Details + Design tabs (routes always on; nav still old).
3. Delivery Pool tab + API client + hooks.
4. Sources + Launch tabs.
5. Flag-gated nav switch in `AdminCampaigns` + Vitest tests.

## 7. Testing
- Backend Jest: pool aggregation (active-only, campaign-scoped, inactive agents excluded, held count); bulk assign (package/campaign mismatch → error, inactive/missing agents, all-or-none, exactly one sweep, idempotent skip); launch-state (not-ready→409, force→active, pause→paused).
- Frontend Vitest: tabs render + non-Details disabled w/o id; Details payload carries `enforceLeadQuota`/pixels; pool multi-select calls `bulkAssignDeliveryPool`; QR embedded hides Back.
- Manual: draft → design → fund 3 agents → activate → submit leads → round-robin + credit decrement; hard-quota hold → top-up release.
- CI is chronically red on pre-existing suites; will report only the suites I touch, won't claim full green.

## 8. Risks & rollback
- **Prod exposure:** mitigated by `VITE_CAMPAIGN_WORKSPACE_ENABLED` default OFF (code ships dark) + old pages alive.
- **Bulk assign over-sweeping:** one post-commit sweep, not per-agent.
- **Launch semantics drift:** dedicated launch-state method; never touch `Campaign.update`'s inactive→draft mapping.
- **Rollback:** unset/leave flag OFF, or revert the nav commit. Backend endpoints are additive + unused when nav is off.

## 9. Review fixes (Codex review of this plan — incorporated)
1. **launch-state side effects (BLOCKER):** `setCampaignLaunchState` must reject `status==='archived'` (400), set only `active`/`paused` (never draft), and call `notifyDevices(campaignId)` after the status change (PHV tablets serve only `status:'active'`; manifest refresh would otherwise be skipped). `notifyDevices` is already in `campaignService.js` — call it directly.
2. **DesignEditor unmount drops unsaved edits:** Radix `TabsContent` unmounts inactive tabs by default. Use `forceMount` on the **Design** tab so `DesignEditor` stays mounted (keeps its internal dirty/`beforeunload` state); hide via CSS when inactive. Add `heightClass` prop that **replaces** the hard-coded `h-[calc(100vh-8rem)]` root class at `DesignEditor.jsx:137` (default preserves current value).
3. **Bulk-assign race-safety:** `LeadPackageAssignment` has no unique `(agentId,leadPackageId)` index. Do NOT add a unique index (existing rows may already duplicate → migration risk). Instead wrap bulk-assign in a transaction holding a `pg_advisory_xact_lock(hashtext('lpa:'||:packageId))`, then re-read existing active assignments for that package and skip agents already assigned, then `bulkCreate` the rest. Report `skipped`.
4. **Held count:** count only internally-releasable holds: `Prospect.count({ campaignId, quarantinedAt: { [Op.ne]: null }, quarantineReason: 'no_funded_agent' })` (exclude `no_funded_external_buyer`).
5. **Frontend service layer:** add `getCampaignDeliveryPool`/`bulkAssignCampaignPackage`/`setCampaignLaunchState` to `src/services/campaignService.js` (the hooks import that module, not the entity directly), each delegating to the new `CampaignEntity` methods.
6. **Locked package dialog + draft campaigns:** `LeadPackageTemplateDialog` fetches only ACTIVE campaigns, but workspace campaigns start as drafts. In `lockCampaign` mode: prefill `campaignId` from props, hide/disable the campaign select, and don't depend on the active-campaign list.
7. **TikTok QR hydration:** add `tiktokPixelId` to the tracker QR-session campaign attributes (`trackerService.js:161`) — `LeadCapture` reads `campaign.tiktokPixelId` for browser events; QR-sourced traffic currently misses it. (Promoted from optional to should-fix.)
8. **Preserve campaign type on create:** workspace create mode must read `?type=` from search params and submit it on the first draft save, else backend silently defaults to `lead_generation`.

Verdict accepted: not shippable as originally written; sections above resolve the blocker + should-fixes before implementation.
