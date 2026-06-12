Read-only review completed. I did not modify files. I could not verify the live Lyfe edge-function dedupe implementation from this repo alone; the repo only documents it in tests as `externalId` plus `source_name='mktr'` at `backend/test/integration/pipelineE2E.test.js:288-291`. I also could not verify the intended production mechanism for turning `campaigns.enforce_lead_quota` on; from backend API code alone it is not writable.

**1. Charge Gate**

No blocker found in `chargeLeadCredit` for over-spend: the package path is campaign-scoped via `p."campaignId" = :campaignId`, locks only the picked assignment, decrements in one guarded statement, and only falls back to owed credits when no package row was updated at `backend/src/services/leadCredits.js:120-155`. The owed fallback is also atomic and cannot drive negative because it requires `owed_leads_count >= 1` in the `UPDATE` at `backend/src/services/leadCredits.js:147-151`.

- **nice-to-have** — `SKIP LOCKED` can under-deliver transiently. If another transaction has the only eligible package row locked, this code skips it and may return `false` or use owed credits instead of waiting at `backend/src/services/leadCredits.js:120-155`. The create path will then quarantine at `backend/src/services/prospectService.js:392-407`, and the sweep path rolls back and stops at `backend/src/services/releaseSweep.js:73-76`. The periodic backstop at `backend/src/database/bootstrap.js:97-107` makes this recoverable, but it is worth documenting as “safe under-delivery,” not “all available credit is always consumed immediately.”

**2. Route / Agent Correctness**

- **should-fix** — QR direct assignment can bypass the active-agent validation that `resolveLeadRouting` just performed. `resolveLeadRouting` validates QR candidates as active agents at `backend/src/services/systemAgent.js:104-109`, but `createProspect` later blindly overwrites `assignedAgentId` from `sourceQrTag.assignedAgentId` and labels it `qr` at `backend/src/services/prospectService.js:360-363`. `chargeLeadCredit` then only checks package assignment rows, not `users.role/isActive`, at `backend/src/services/leadCredits.js:123-129`. Since `toggleUserStatus` leaves lead-package assignments intact at `backend/src/services/userService.js:290-297`, a stale QR can charge and deliver to a deactivated agent.

**3. Release Webhooks**

- **should-fix** — Released held leads do not replay the original create payload semantics. Normal web leads include original `routingMode`, QR tag, and group in `lead.created` at `backend/src/services/prospectService.js:511-520`; Retell and Meta use source-specific payloads at `backend/src/services/retellService.js:341-369` and `backend/src/services/metaLeadService.js:317-343`. Manual release and sweep both emit a generic payload with `routingMode: 'direct'` and `sourceQrTag/agentGroup` as `null` at `backend/src/services/prospectService.js:801-803` and `backend/src/services/releaseSweep.js:112-114`. Lyfe gets exactly one `lead.created`, but loses QR/source routing context for held leads.

- **should-fix** — A held lead can take the unassign branch before the held-release branch and emit `lead.unassigned` even though Lyfe never saw `lead.created`. The unassign branch runs first at `backend/src/services/prospectService.js:724-745`; the quarantine-aware branch is only checked later at `backend/src/services/prospectService.js:762`. That violates the “Lyfe never saw this lead” invariant for quarantined rows.

**4. Release Races**

- **should-fix** — Manual release correctly avoids double Lyfe delivery when it loses the atomic claim, but it returns the requested `agent` anyway at `backend/src/services/prospectService.js:774-776`. The controller then sends an assignment email to that returned agent unconditionally at `backend/src/controllers/prospectController.js:131-134`. In a concurrent sweep/manual-release race, the losing requester can notify the wrong agent about a lead already released elsewhere.

**5. Enablement / DDL**

- **should-fix** — The backend API cannot set `enforceLeadQuota`. The model/migration define the field at `backend/src/models/Campaign.js:163-171` and `backend/src/database/migrations/035-add-lead-package-quota.js:19-25`, but campaign validation omits it at `backend/src/middleware/validation.js:68-97`, create drops it at `backend/src/services/campaignService.js:166-184`, and update drops it at `backend/src/services/campaignService.js:215-238`. If DB-only rollout is intentional, document it; otherwise hard quota cannot be enabled through the campaign API.

- **should-fix** — Migration 035 swallows every DDL error, not just “already exists.” Each `addColumn`/`addIndex` is followed by `.catch(() => {})` at `backend/src/database/migrations/035-add-lead-package-quota.js:19-46`, and the runner records the migration as applied after `up()` returns at `backend/src/database/runMigrations.js:56-63`. A real production DDL failure could leave the schema missing while `_migrations` says it succeeded.
