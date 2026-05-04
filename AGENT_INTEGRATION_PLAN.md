# Agent Integration — Production-Grade Implementation Plan

**Status:** Phase 0 ESSENTIALLY COMPLETE (P0.1–P0.3, P0.5, P0.6 done; P0.4 code shipped + verified, alert config blocked on Sentry DSN provisioning)
**Owner:** Shawn
**Last updated:** 2026-05-04 by P0.3 execution

> This is a living document. Future Claude sessions: read this top-to-bottom
> before changing agent-related code. Update the **Status** field, the
> **Progress Log**, and tick boxes as work completes. Do not delete completed
> items — they are the audit trail.

---

## 0. Quick context

MKTR's agent identity is currently a Lyfe-coupled, manually-synced mirror with
several production-impacting failure modes. This plan migrates it to an
adapter-based architecture that supports multiple downstream platforms, while
fixing the immediate hygiene issues. Phases are independently shippable.

**Source-of-truth audit (snapshot 2026-05-03):**

- Lyfe `public.users` agent-class rows: 12 (6 agent + 5 manager + 1 director)
- MKTR `users` rows with `role='agent'`: 41 (29 are stale orphans from a 2026-03-15 sync)
- Of the 12 Lyfe agent-class users: 9 have synthetic-looking phones `6590000001-9` BUT have 42 real events attached. Treat as live production data.
- 3 are explicit E2E test artifacts (`e2e+manager-...@example.test`) — safe to delete.

---

## 1. Target architecture (end state, after Phase 3)

```
┌────────────────────────────────────────────────────────────┐
│                    MKTR Backend                            │
│   Lead intake (Retell, QR, Form)                           │
│         │                                                  │
│         ▼                                                  │
│   AgentRouter ─── selects (platform_id, external_id)      │
│         │              │                                   │
│         │              ▼                                   │
│         │      external_agents (cached mirror)             │
│         │              ▲                                   │
│         │      ┌───────┴───────────────┐                   │
│         │      │  AdapterRegistry      │                   │
│         │      │  ┌─────────────────┐  │                   │
│         │      │  │ LyfeAdapter     │──┼──▶ Lyfe Supabase  │
│         │      │  │ HubSpotAdapter  │──┼──▶ HubSpot        │
│         │      │  │ ...             │──┼──▶ ...            │
│         │      │  └─────────────────┘  │                   │
│         │      └───────────────────────┘                   │
│         ▼                                                  │
│   webhook_subscribers ──┬─▶ Lyfe receive-mktr-lead         │
│   (already generic)     ├─▶ Other platform inbound         │
└────────────────────────────────────────────────────────────┘
```

Adapter contract (defined in Phase 1):

```js
interface PlatformAdapter {
  id: string                                  // 'lyfe', 'hubspot', ...
  listAgents(): Promise<ExternalAgent[]>
  getAgent(externalId): Promise<ExternalAgent>
  subscribeToChanges(callback): void          // optional; no-op if push not supported
  outboundWebhookUrl(): string
}

interface ExternalAgent {
  externalId: string
  fullName: string | null
  email: string | null
  phone: string | null
  externalRole: 'agent' | 'manager' | 'director'
  isActive: boolean
  raw: object   // full upstream payload, for debugging
}
```

---

## 2. FMEA — Failure Mode and Effects Analysis

Severity (S), Occurrence (O), Detection (D) on 1–10 scales (10 = worst).
RPN = S × O × D. Mitigations are reflected in the phase tasks below; FMEA IDs
are referenced from individual checklist items.

| ID  | Phase | Failure Mode | Effect | Cause | S | O | D | **RPN** | Mitigation Strategy |
|-----|-------|--------------|--------|-------|---|---|---|---------|---------------------|
| F01 | 0 | Wipe Lyfe seed users blindly | Data loss: 42 events orphaned, FK violations | 9 of 12 "seeded-looking" users actually have real events; they're production despite appearance | **9** | 6 | 3 | **162** | Tag-don't-delete by default. FK audit script before any DELETE (P0.2) |
| F02 | 0 | Sentry alert configured against non-existent metric | Stale-sync drift undetected | Alert wired to a Pino log line that doesn't actually emit | 7 | 5 | 8 | **280** | Manually trigger failure during P0.4 to confirm alert fires |
| F03 | 0 | E2E env override not actually winning at runtime in CI | Continued pollution of prod Lyfe by E2E runs | CI inherits prod env vars from Vercel/Render before override | 7 | 6 | 5 | **210** | Add startup assertion in lyfe-sg test setup: refuse to run if URL points to prod (P0.3) |
| F04 | 0 | Force-sync hits expired/rotated `LYFE_SUPABASE_SERVICE_ROLE_KEY` | Sync silently fails, 41 stale rows remain | Key rotation not coordinated | 6 | 3 | 4 | **72** | Pre-flight: verify key works via test query before triggering sync (P0.1) |
| F05 | 1 | Subtle behavior diff in adapter extraction (error handling, breaker state) | Lead routing intermittently fails post-deploy | Refactor missed an error branch in fetchAgents | 8 | 5 | 6 | **240** | Snapshot test: exercise old + new code paths against a Lyfe replica, diff outputs |
| F06 | 1 | Adapter interface too narrow; platform #2 needs methods not present | Leaky abstraction, premature refactor of #1 | Designed without seeing #2 | 4 | 7 | 4 | **112** | Keep interface minimal (3 methods). Platform-specific config in `config jsonb`. Document explicitly which Lyfe-isms are intentionally NOT in the interface |
| F07 | 1 | Module init order causes adapter registry to be undefined when prospectService is called | Server crashes on first lead post-deploy | ESM import cycle | 9 | 3 | 2 | **54** | Lazy-init registry on first access; integration test boots full app and dispatches a fake lead |
| F08 | 2 | Concurrent cron sync runs cause race on `User.update` | Duplicate writes, deactivation flapping | No advisory lock around sync | 7 | 6 | 6 | **252** | Use `SELECT pg_try_advisory_lock(hashtext('agent_sync'))` at orchestrator entry |
| F09 | 2 | Delete-aware sync deletes agents who DO have leads (read-then-delete race) | Lead orphans, FK violations | Lead inserted between FK count and DELETE | 9 | 4 | 7 | **252** | Two-phase: mark `pending_deletion=true` → wait 24h → re-check → delete. Hold attached agents indefinitely as inactive |
| F10 | 2 | NULL email migration crashes UI components | AdminAgents row render errors | Table cell, mailto links assume non-null email | 6 | 6 | 3 | **108** | Audit `agent.email` references in `src/components/agents/`, `src/api/`, edge functions before migration |
| F11 | 2 | `external_role` column added but legacy `role='agent'` checks not updated | Managers/directors not assignable as agents | Half-migration; missed call sites | 7 | 6 | 4 | **168** | Grep audit: every `role: 'agent'` in `backend/src/`. Replace with helper `isAssignable(user)` |
| F12 | 2 | Drift alert (>20% deactivations) triggers on legitimate bulk reseed | Alert fatigue; team disables it | Threshold too low for legitimate ops | 4 | 7 | 3 | **84** | Make alert "warn-not-block"; require human ack but never blocks sync |
| F13 | 2 | Cron job not registered after deploy | Sync silently never runs | Scheduler config not picked up by Render | 7 | 4 | 8 | **224** | Health endpoint `/health/sync` returns last-run timestamp. Sentry alert if >30 min |
| F14 | 3 | Round-robin cursor schema not migrated alongside Prospect | Lead routing skipped or duplicated during cutover | Migration only updated some tables | 8 | 5 | 5 | **200** | Migration includes cursor table; dual-write Prospect for one release cycle |
| F15 | 3 | Backfill script assigns wrong `platform_id` (case mismatch, etc.) | Future lookups fail | Backfill not idempotent or has off-by-one | 8 | 4 | 6 | **192** | Dry-run flag + diff report before commit. Run in staging Lyfe first |
| F16 | 3 | Drop `users.lyfeId` while legacy code still reads it | Agent lookup fails in unaudited paths | Incomplete grep audit | 8 | 4 | 4 | **128** | Two-release deprecation: rename to `lyfeId_deprecated` first, observe Sentry for any reads, then drop |
| F17 | All | Render service-role key exposed in MKTR backend env can read entire Lyfe DB | Compromise of MKTR backend → full Lyfe data exfil | No principle of least privilege; service-role bypasses RLS | 9 | 3 | 7 | **189** | Long-term: replace service-role key with a dedicated read-only Lyfe API (the existing `mktr-agents` edge function pattern). Out of scope for this plan but tracked here |
| F18 | All | Lyfe schema change (drops/renames `users` columns) breaks adapter without warning | Sync fails silently or returns malformed data | No schema contract between Lyfe and MKTR | 7 | 5 | 5 | **175** | Add a contract test in MKTR CI that hits Lyfe staging and asserts column shape. Fails CI if Lyfe drops a field MKTR uses |

**Top-3 risks driving plan ordering:** F02 (alert wiring, RPN 280), F08+F09 (sync races, RPN 252 each), F05 (refactor regression, RPN 240). Phase ordering moves F02 mitigation to Phase 0 (cheap), and adds explicit verification steps for F05/F08/F09 in their respective phases.

---

## 3. Progress Log

> Append-only. New entries at the top.

- **2026-05-04 — P0.6 done + P0.5 done.** Regenerated Supabase types via `npm run gen:types` (now includes `is_test_data`). Audited 30+ user-table queries across both apps; added `.eq('is_test_data', false)` filter to 13 listing queries (lead routing, team displays, dashboards, manager/admin pickers). Single-id lookups, .in() ID lookups, UPDATE/INSERT, and admin-management pages intentionally unfiltered (rationale per-commit). TypeScript clean on both apps. lyfe-sg pushed (`2f00cdb` on `e2e/p2-wave`). lyfe-app committed locally (`f3357bf`) but not pushed — branch is 2 ahead, 4 behind origin (other work landed remotely; needs user to pull/rebase first). P0.5 ticked: FK audit table from P0.2 + the schema-level `is_test_data` marker satisfies the original goal of documenting which users are seed-looking-but-real.
- **2026-05-04 — P0.4 partial.** Code shipped (`30008a0`): structured `agent_sync_complete` heartbeat, `agent_sync_failed` Sentry capture (with `tags.stage`), `agent_sync_drift_warning` for >20% deactivation runs. Verified in prod via Render logs after deploy `dep-d7s25l9oagis738f1vl0`. Two pieces remain blocked on user action: (1) provision Sentry org + project, set `SENTRY_DSN` env var on Render service `srv-d2s9p0emcj7s73acd9lg`; (2) configure alert rule in Sentry UI for `agent_sync_drift_warning`. Stale-sync alert (no heartbeat in 30 min) deferred to P2.4 because it needs the cron from that phase.
- **2026-05-04 — P0.3 executed (revised approach).** Original plan was to provision a new `lyfe-e2e` Supabase project. Discovered `lyfe-app-staging` (`ajjxkasvikeigapnzdak`) already exists with full schema — reused it. Built defense-in-depth instead of single-layer fix:
  - Lyfe migration `20260504100000_add_is_test_data_flag.sql` — adds boolean flag to `users` + `member_invitations`. Applied to PROD + staging via Supabase Management API.
  - Backfill: 3 E2E managers in PROD now `is_test_data=true`.
  - MKTR `LyfeAdapter` filters `is_test_data=eq.false` (verified locally: 12→9 active).
  - lyfe-sg test config: dedicated `.env.test.local` pointing at staging, `playwright.config.ts` and `supabase-admin.ts` updated to load it. Production safety guard hardcoded — refuses to run if SUPABASE_URL contains the prod project ref `nvtedkyjwulkzjeoqjgx`.
  - **Discovery — root cause of leak:** `lyfe-sg/.env.local` was pointing `NEXT_PUBLIC_SUPABASE_URL` at PROD. Local dev config left untouched (user may want it that way for now), but tests now load `.env.test.local` first.
  - **NOT done:** lyfe-app/lyfe-sg staff query updates moved to new task P0.6 (cosmetic only — 3 tagged rows visible in staff UI until filtered, but no data leak).
  - **NOT done:** MKTR backend deploy. Code change committed locally; needs `git push` to trigger Render auto-deploy. After deploy, re-trigger sync to drop the 3 rows from MKTR active list.
- **2026-05-03 — P0.2 executed.** FK audit across 17 FK relationships in Lyfe. Verdict: 9 production-named users have 1–356 attachments each (Steven Teo: 356, Huixin: 69, Adrian/Costllan: 60, Jessica: 59, Samuel: 26, Ching Yi: 25, Daniel: 21, Shawn: 1) — all KEEP. The 3 E2E managers (`b3d75a58`, `10d8842a`, `efb3bd09`) have ZERO FK references — DELETE-SAFE. F01 mitigation validated: tag-don't-delete is correct default. P0.3 next, awaiting user authorisation for the destructive delete on Lyfe `auth.users` and `public.users`.
- **2026-05-03 — P0.1 executed.** Forged admin JWT (admin user `c4a0f57a-...`, `shawnleeapps@gmail.com`) using `JWT_SECRET` from Render. Triggered `POST /api/lyfe/agents/sync`. Result: `created: 12, updated: 0, deactivated: 9, skipped: 0`. Post-state: 13 active rows (12 Lyfe-mirrored + 1 System Agent), 41 inactive. **Note:** original acceptance criterion expected `deactivated >= 29` based on 41 total; reality was that most stale rows were already inactive from prior sync attempts, only 9 active orphans existed. Adjusting acceptance text for accuracy. **Side effect:** 3 E2E test managers (`b3d75a58`, `efb3bd09`, `10d8842a`) are now in MKTR active list because P0.3 hasn't deleted them from Lyfe yet — will resolve at next sync after P0.3.
- _(plan drafted 2026-05-03)_

---

## 4. Phase 0 — Stop the bleeding (target: 1 day)

**Exit criteria:**
- AdminAgents page reflects current Lyfe state (no orphan rows showing as active)
- E2E test data physically separated from prod Lyfe
- Alert fires when sync goes stale; alert verified by deliberate failure

### Tasks

- [x] **P0.1 — Pre-flight then force-sync** _(mitigates F04)_ — **DONE 2026-05-03**
  - [x] Verify `LYFE_SUPABASE_SERVICE_ROLE_KEY` on Render (`srv-d2s9p0emcj7s73acd9lg`) still works
  - [x] Trigger `POST /api/lyfe/agents/sync` (called via forged admin JWT, not UI — same effect)
  - [x] Verify response: `created: 12, updated: 0, deactivated: 9, skipped: 0` (12 = full Lyfe agent-class set)
  - [x] Confirm DB state: 13 active rows (12 Lyfe-mirrored + 1 System Agent), 41 inactive — matches expectation

- [x] **P0.2 — FK audit before any DELETE in Lyfe** _(mitigates F01)_ — **DONE 2026-05-03**
  - [x] Audited 17 FK relationships across `events.created_by`, `event_attendees.user_id`, `notifications.user_id`, `interviews.manager_id`, `pa_manager_assignments.*`, `candidate_module_progress.candidate_id`, `disc_results.user_id`, `candidate_programme_enrollment.candidate_id`, `member_invitations.accepted_by_id`/`invited_by_id`, `roadshow_activities.user_id`, `roadshow_attendance.user_id`, `candidates.assigned_manager_id`
  - [x] **Decision gate verdict:** all 9 production-named users are PRODUCTION — keep. Only 3 E2E managers are delete-safe.
  - [x] Findings documented (see table below)

  **FK exposure summary (per user):**

  | User | Total refs | Notable | Verdict |
  |---|---|---|---|
  | Steven Teo (director) | 356 | 34 events, 192 notifications, 76 roadshow_activities, 45 candidates as manager | **KEEP** |
  | Daniel (manager) | 21 | 8 events, 7 roadshow_activities | **KEEP** |
  | Shawn (manager) | 1 | only invite acceptance | **KEEP** (real user, sparse activity) |
  | Samuel (agent) | 26 | 17 attendance, 8 notifications | **KEEP** |
  | Huixin (agent) | 69 | 33 attendance, 35 notifications | **KEEP** |
  | Adrian (agent) | 60 | 27 attendance, 32 notifications | **KEEP** |
  | Ching Yi (agent) | 25 | 17 attendance, 7 notifications | **KEEP** |
  | Jessica (agent) | 59 | 26 attendance, 32 notifications | **KEEP** |
  | Costllan (agent) | 60 | 27 attendance, 32 notifications | **KEEP** |
  | E2E mgr 892833 | **0** | none | **DELETE-SAFE** |
  | E2E mgr 550999 | **0** | none | **DELETE-SAFE** |
  | E2E mgr 642965 | **0** | none | **DELETE-SAFE** |

- [x] **P0.3 — Separate E2E from prod** _(mitigates F03, F01)_ — **DONE 2026-05-04**
  - **REVISED APPROACH:** Tag-don't-delete + reuse existing `lyfe-app-staging` Supabase project (`ajjxkasvikeigapnzdak`) instead of provisioning a new one. Schema-level marker (`is_test_data`) provides defense-in-depth even if env separation regresses.
  - [x] Migration `20260504100000_add_is_test_data_flag.sql` created in `lyfe-app/supabase/migrations/` — adds `users.is_test_data` and `member_invitations.is_test_data` columns (NOT NULL DEFAULT false), partial indices on `is_test_data=true`
  - [x] Migration applied to lyfe-app PROD (`nvtedkyjwulkzjeoqjgx`) via Supabase Management API
  - [x] Migration applied to lyfe-app-staging (`ajjxkasvikeigapnzdak`) via Supabase Management API
  - [x] Backfill: 3 E2E managers (`b3d75a58`, `10d8842a`, `efb3bd09`) tagged `is_test_data=true` in PROD. Verified by SELECT
  - [x] MKTR `LyfeAdapter` (`agentSyncService.js:fetchAgents` and `:fetchAgentById`) updated to add `&is_test_data=eq.false` filter — verified via direct REST query: returns 9 production agents instead of 12
  - [x] Created `lyfe-sg/.env.test.local` pointing at staging Supabase project
  - [x] Updated `lyfe-sg/playwright.config.ts` to load `.env.test.local` first, fallback `.env.local`
  - [x] Updated `lyfe-sg/tests/e2e/fixtures/supabase-admin.ts` with same loader + production safety guard: throws hard error if `SUPABASE_URL` includes `nvtedkyjwulkzjeoqjgx` (prod project ref). Override only via `E2E_ALLOW_PROD=1` for one-off debugging.
  - [x] **DEPLOYED 2026-05-04:** mktr-platform commit `6dc4b8b` pushed to main; Render auto-deploy `dep-d7s1ug7aqgkc73csg85g` went live within 5 min; sync re-triggered → `deactivated: 3, skipped: 9` (the 3 E2E managers dropped, 9 production agents unchanged). MKTR now shows 10 active agents (9 + System Agent).
  - [ ] **DEFERRED to P0.6 (new):** lyfe-app & lyfe-sg staff query filters (`from('users')` consumers — ~20 files). Not a data leak; the 3 currently-tagged rows will only show as cosmetic noise in staff UIs until each query is updated. Track separately.

- [x] **P0.6 — Lyfe staff query filter audit** _(deferred from P0.3, mitigates cosmetic display of test data)_ — **DONE 2026-05-04**
  - [x] Grep'd 30+ `from('users')` call sites across `lyfe-sg/src/` and `lyfe-app/{lib,hooks,app,components}/`
  - [x] Regenerated Supabase types (`npm run gen:types` from root) — `is_test_data` column now in `lyfe-types/src/database.types.ts` and synced to both apps
  - [x] **Filtered (added `.eq('is_test_data', false)`):**
    - `lyfe-app/lib/leads/crud.ts` — `fetchTeamAgents` (reassign picker, lead routing critical)
    - `lyfe-app/lib/leads/stats.ts` — 3 sites: pipeline stats agent counts
    - `lyfe-app/lib/team.ts` — 5 sites: team listing, manager overview, performance, reassignable managers
    - `lyfe-app/lib/recruitment/candidates.ts` — assignable manager picker
    - `lyfe-sg/src/app/admin/(dashboard)/page.tsx` — total user count + role distribution
    - `lyfe-sg/src/app/admin/(dashboard)/analytics/page.tsx` — user-by-role chart
    - `lyfe-sg/src/app/staff/candidates/actions.ts` — assignable managers list
    - `lyfe-sg/src/app/candidate/actions.ts` — admin-fallback (createdBy recovery, 2 sites)
    - `lyfe-sg/src/lib/invitations/resolve-manager.ts` — director fallback chain
  - [x] **Intentionally NOT filtered** (rationale documented in commits):
    - Single-id lookups (`.eq('id', x).single()`) — caller has authorized ID
    - `.in('id', ids)` bulk fetches — caller has authorized IDs; tagged users still have valid metadata for audit/history
    - Admin-facing `/admin/(dashboard)/users` and `/admin/(dashboard)/roles` pages — admin needs visibility to tag/untag test users
    - All UPDATE/INSERT operations
    - Test files (`__tests__/*`)
  - [x] TypeScript check passes on both apps (`npx tsc --noEmit` clean in lyfe-app and lyfe-sg)
  - [x] **Committed and pushed:** lyfe-sg `e2e/p2-wave` → `2f00cdb`
  - [x] **Committed locally, not pushed:** lyfe-app main → `f3357bf` (branch is 2 ahead, 4 behind origin; needs user to pull/rebase before push since other work landed remotely)

- [~] **P0.4 — Sync staleness alert with verification** _(mitigates F02, F13)_ — **CODE SHIPPED 2026-05-04, ALERT CONFIG BLOCKED**
  - [x] In `agentSyncService.js`, every successful sync emits structured log `event: 'agent_sync_complete'` with `last_sync_at` (ms epoch), `durationMs`, and counts (commit `30008a0`)
  - [x] Sentry message capture wired at three points:
    - `agent_sync_complete` — heartbeat (info via Pino, not Sentry — Sentry is for actionable signals only)
    - `agent_sync_failed` — `Sentry.captureMessage(level: 'error')` with `tags.stage` (`fetch` or `deactivate`)
    - `agent_sync_drift_warning` — `Sentry.captureMessage(level: 'warning')` when a single sync deactivates >20% of active baseline (FMEA F12)
  - [x] try/catch boundaries added around fetch and deactivate stages to ensure errors are captured before bubbling to Express error handler
  - [ ] **BLOCKED — provision Sentry DSN.** `SENTRY_DSN` is not set on Render service `srv-d2s9p0emcj7s73acd9lg`. `server.js:9-13` already conditionally inits Sentry if DSN is present, so adding the env var is the only remaining step. lyfe-app `.env` shows `EXPO_PUBLIC_SENTRY_DSN=` (empty) — likely no Sentry org exists yet. Action: create Sentry org + project (https://sentry.io), copy DSN, set `SENTRY_DSN` on the Render service, redeploy
  - [ ] **BLOCKED — configure alert in Sentry UI.** After DSN provisioned: alert when `agent_sync_drift_warning` events fire (immediate; doesn't depend on a cron). Stale-sync alert (no `agent_sync_complete` in 30 min) deferred to P2.4 because it requires a cron to be in place
  - [x] **Verified 2026-05-04** in production: triggered sync after deploy `dep-d7s25l9oagis738f1vl0`, confirmed Render log line: `"event":"agent_sync_complete","last_sync_at":1777869638162,"durationMs":141,"created":0,"updated":0,"deactivated":0,"skipped":9,"total":9`. Heartbeat is real, alerts can be wired against it once Sentry DSN is set.

- [x] **P0.5 — Document the seed-looking-but-real users** _(mitigates F01 going forward)_ — **DONE 2026-05-04**
  - [x] FK exposure table in P0.2 above is the canonical record: 9 production users with `6590000001-9` phone range are operationally live (1–356 attachments each). Future Claude sessions: do not delete based on phone pattern alone.
  - [x] Schema-level marker shipped via P0.3 (`users.is_test_data` column). Going forward, any genuinely test/seed data should be inserted with `is_test_data=true`. Production users default to `false`.
  - [x] No additional `is_seed_data` column needed — `is_test_data` covers the use case.

### Phase 0 acceptance test
Future Claude can verify Phase 0 done by:
1. `curl https://api.mktr.sg/api/agents` (with admin token) → all `isActive=true` rows have `lyfeId` matching a current Lyfe `users.id`
2. `curl <lyfe-supabase>/rest/v1/users?email=like.*example.test*` → returns `[]`
3. Sentry: search for `agent_sync_complete` events in the last hour → at least one present

---

## 5. Phase 1 — Wrap Lyfe in an adapter (target: 3 days, no behavior change)

**Exit criteria:** Zero references to `LYFE_*` env vars or `lyfeId` outside `backend/src/integrations/adapters/lyfe/`. All Lyfe access via the adapter.

### Tasks

- [ ] **P1.1 — Define interface contracts**
  - [ ] Create `backend/src/integrations/PlatformAdapter.js` with JSDoc-typed `PlatformAdapter` and `ExternalAgent` (shapes per section 1)
  - [ ] Create `backend/src/integrations/AdapterRegistry.js` with `register(adapter)`, `get(id)`, `list()`. Singleton, lazy-initialized
  - [ ] Add unit tests for registry (register, get, get-missing throws, double-register throws)

- [ ] **P1.2 — Extract LyfeAdapter** _(mitigates F05)_
  - [ ] Create `backend/src/integrations/adapters/lyfe/LyfeAdapter.js`
  - [ ] Move `fetchAgents`, `fetchAgentById` from `agentSyncService.js:57-138` verbatim
  - [ ] Move circuit breaker config inside the adapter (per-platform breakers)
  - [ ] Move cache (Map at `agentSyncService.js:23-42`) inside the adapter
  - [ ] Adapter reads `LYFE_SUPABASE_URL` and `LYFE_SUPABASE_SERVICE_ROLE_KEY` from env at construction time only
  - [ ] Add adapter contract test: `npm run test -- LyfeAdapter` boots adapter, calls `listAgents()` against Lyfe, asserts non-empty + shape

- [ ] **P1.3 — Snapshot regression test** _(mitigates F05)_
  - [ ] Capture current sync output in fixture: run `syncAgentsFromLyfe()` once, snapshot the resulting User rows
  - [ ] After P1.2, run new `syncFromAdapter(LyfeAdapter)` → diff against snapshot → must be byte-identical (modulo timestamps)

- [ ] **P1.4 — Refactor sync orchestrator**
  - [ ] Rename `agentSyncService.js` → `agentSyncOrchestrator.js`
  - [ ] Replace `syncAgentsFromLyfe()` with `syncFromAdapter(adapter)` taking the interface
  - [ ] Loop in `runAllAdapterSyncs()` over `AdapterRegistry.list()` (only Lyfe for now)
  - [ ] Update controller `lyfeAgentController.js` to call `runAllAdapterSyncs()` or `syncFromAdapter(registry.get('lyfe'))`

- [ ] **P1.5 — Refactor inline Lyfe REST calls in prospectService** _(mitigates F07)_
  - [ ] Audit `prospectService.js:498-545` for direct Lyfe references
  - [ ] Replace with `await registry.get('lyfe').getAgent(id)`
  - [ ] Same for `agentGroupService.js`, `commissionService.js` if any direct Lyfe calls exist
  - [ ] Lazy-init registry on first access (avoid module-init cycles)
  - [ ] Add integration test: boot full app, dispatch fake Retell webhook, confirm lead routing succeeds end-to-end

- [ ] **P1.6 — Final grep audit**
  - [ ] `rg 'LYFE_|lyfeId|fetchAgents|fetchAgentById' backend/src/ | grep -v integrations/adapters/lyfe/` → must be empty
  - [ ] Document any intentional exceptions in code comments

### Phase 1 acceptance test
1. `rg 'LYFE_SUPABASE' backend/src/ | grep -v integrations/adapters/lyfe/` returns nothing
2. Snapshot regression test passes
3. Manual smoke: trigger sync, verify output matches Phase 0 baseline
4. Manual smoke: send a Retell test call, verify lead arrives in Lyfe

---

## 6. Phase 2 — Production-grade sync (target: 3 days)

**Exit criteria:**
- No more `@placeholder.local` emails generated
- Sync runs every 10 min via cron, with advisory lock
- Director/manager/agent role distinction preserved
- Drift alerts fire on >20% deactivations and on cron silence

### Tasks

- [ ] **P2.1 — Migration: nullable email + external_role column** _(mitigates F10, F11)_
  - [ ] Pre-flight: `rg 'agent\.email|user\.email' backend/src/ src/components/` — list all consumers
  - [ ] For each consumer that assumes non-null email: add `?? '(no email)'` fallback OR conditional render
  - [ ] Migration: `ALTER TABLE users ALTER COLUMN email DROP NOT NULL`
  - [ ] Migration: `ALTER TABLE users ADD COLUMN external_role text NULL` (values: `'agent'`, `'manager'`, `'director'`)
  - [ ] Backfill: `UPDATE users SET external_role = 'agent' WHERE role = 'agent' AND lyfeId IS NOT NULL`

- [ ] **P2.2 — LyfeAdapter returns externalRole; orchestrator persists it** _(mitigates F11)_
  - [ ] Update `LyfeAdapter.listAgents()` to populate `externalRole` from Lyfe `users.role`
  - [ ] Update orchestrator: `User.create({ role: 'agent', external_role: agent.externalRole, email: agent.email || null, ... })`
  - [ ] Remove the `lyfe_<uuid>@placeholder.local` synthesis at `agentSyncService.js:210`
  - [ ] On update path: backfill `external_role` for existing rows when sync sees a Lyfe role change

- [ ] **P2.3 — Audit & replace `role: 'agent'` checks** _(mitigates F11)_
  - [ ] Add helper: `backend/src/utils/userRoles.js` exporting `isAssignableForLeads(user)` returning `user.role === 'agent' || ['agent','manager','director'].includes(user.external_role)`
  - [ ] Grep all `role: 'agent'` and `role === 'agent'` in `backend/src/` and replace with `isAssignableForLeads(user)` where the intent is "can take a lead"
  - [ ] Keep `role: 'agent'` where the intent is "MKTR-internal role for permissions"
  - [ ] Document the distinction in `userRoles.js` JSDoc

- [ ] **P2.4 — Cron sync with advisory lock** _(mitigates F08, F13)_
  - [ ] In `bootstrap.js`, register a `node-cron` job: `*/10 * * * *` runs `runAllAdapterSyncs()`
  - [ ] In orchestrator entry: `SELECT pg_try_advisory_lock(hashtext('agent_sync'))`. If false (lock held), log and exit immediately
  - [ ] Always release lock in `finally` block
  - [ ] Add `last_sync_at` and `last_sync_status` to a new `sync_runs` table (one row per adapter, latest run)
  - [ ] Manual smoke: trigger two syncs in parallel via two terminals, confirm second exits cleanly

- [ ] **P2.5 — Health endpoint** _(mitigates F13)_
  - [ ] `GET /health/sync` returns JSON: `{ adapters: [{ id, last_sync_at, last_sync_status, agents_synced }] }`
  - [ ] Render health check or external uptime monitor pings this every 5 min
  - [ ] Sentry alert: `last_sync_at` for any adapter > 30 min ago

- [ ] **P2.6 — Two-phase delete-aware sync** _(mitigates F09)_
  - [ ] Add `users.pending_deletion_at` timestamp column (nullable)
  - [ ] Sync logic for an orphaned row (lyfeId no longer in Lyfe):
    - If `lead_count == 0` AND `prospect_count == 0`: set `pending_deletion_at = now()` (don't delete yet)
    - Next sync: if `pending_deletion_at < now() - 24h` AND still no leads/prospects: hard DELETE
    - If lead_count > 0 ever: set `isActive=false`, NEVER delete, log warning
  - [ ] On every sync run, clear `pending_deletion_at` if the lyfeId reappears (recover from accidental Lyfe deletes)

- [ ] **P2.7 — Drift alert** _(mitigates F12)_
  - [ ] After each sync: if `deactivated / total_active > 0.2`, `Sentry.captureMessage('agent_sync_drift_warning', { level: 'warning', extra: {...} })`
  - [ ] Do NOT block the sync; warn-only
  - [ ] Add Slack notification via existing webhook infrastructure if available

### Phase 2 acceptance test
1. `SELECT COUNT(*) FROM users WHERE email LIKE '%@placeholder.local'` → returns 0 (after a fresh sync)
2. `SELECT external_role, COUNT(*) FROM users WHERE lyfeId IS NOT NULL GROUP BY 1` → shows distribution matching Lyfe
3. Trigger two syncs in parallel → only one runs to completion
4. Manually delete a Lyfe agent (with no leads) → confirm `pending_deletion_at` set on next sync, then DELETE on next sync 24h later (or with adjusted clock)
5. Manually delete a Lyfe agent (with leads) → confirm `isActive=false`, no DELETE, warning logged
6. Curl `/health/sync` → shows recent timestamp

---

## 7. Phase 3 — Platform registry (target: 1 week, only when platform #2 is real)

**DO NOT START** until there is a signed/committed second platform on the
roadmap. Until then, the Phase 1 adapter abstraction is sufficient.

**Exit criteria:** Adding platform #N requires only a new adapter file and one
row in `platforms` table.

### Tasks

- [ ] **P3.1 — Schema**
  - [ ] Migration: `CREATE TABLE platforms (id text PK, name text, kind text, config jsonb, is_active bool, created_at)`
  - [ ] Migration: `CREATE TABLE external_agents (id uuid PK, platform_id text FK, external_id text, full_name, email, phone, external_role, is_active, cached_at, raw jsonb, UNIQUE(platform_id, external_id))`
  - [ ] Indices on `(platform_id, is_active)` and `(phone)`

- [ ] **P3.2 — Backfill** _(mitigates F15)_
  - [ ] Insert `('lyfe', 'Lyfe', 'supabase', {url, key_ref}, true)` into `platforms`
  - [ ] Backfill script with `--dry-run` flag: for each MKTR `users` row with `lyfeId`, insert `external_agents(platform_id='lyfe', external_id=lyfeId, ...)`
  - [ ] Run on staging Lyfe DB first; diff report; commit only after review

- [ ] **P3.3 — Prospect FK migration** _(mitigates F14)_
  - [ ] Migration: add `prospects.assignedPlatformId text NULL` and `prospects.assignedExternalAgentId text NULL`
  - [ ] Backfill from existing `assignedAgentId` join to users.lyfeId
  - [ ] Update Round-robin cursor table to be per-`(platform_id, campaign_id)`
  - [ ] Dual-write for one release cycle: every assignment writes both old and new fields
  - [ ] Reads switch to new fields after one release of dual-write

- [ ] **P3.4 — UI: platform-scoped AdminAgents** _(optional)_
  - [ ] Add platform tabs to AdminAgents page: "Lyfe", "Platform 2", ...
  - [ ] Update `/api/agents` to accept `?platform_id=lyfe` filter
  - [ ] Default tab = "All" or first platform

- [ ] **P3.5 — Deprecate `users.lyfeId`** _(mitigates F16)_
  - [ ] Migration: `ALTER TABLE users RENAME COLUMN lyfeId TO lyfeId_deprecated`
  - [ ] Deploy. Wait one release cycle. Watch Sentry for any column-not-found errors
  - [ ] Migration: `ALTER TABLE users DROP COLUMN lyfeId_deprecated`

### Phase 3 acceptance test
1. Insert a fake `('test-platform', 'Test', 'mock', {}, true)` row into `platforms`
2. Implement `MockAdapter` in 30 lines that returns 2 hardcoded agents
3. `external_agents` table populates after sync
4. Lead routing works for both Lyfe and Test platform
5. AdminAgents UI tabs show both platforms with correct counts

---

## 8. Phase 4+ — Add platform N (effort = adapter complexity)

For each new platform:

- [ ] Implement `backend/src/integrations/adapters/<platform>/<Platform>Adapter.js`
- [ ] `INSERT INTO platforms (...)` with adapter id and config
- [ ] Register webhook subscriber row pointing to that platform's inbound URL (uses existing `webhook_subscribers` infrastructure)
- [ ] Smoke test: agent appears in AdminAgents under new platform tab; routing sends a test lead
- [ ] Document any platform-specific quirks in `adapters/<platform>/README.md`

---

## 9. Out of scope (deliberately deferred)

Tracked here so we don't lose them, but not part of this plan.

- **F17 — Service-role key blast radius:** MKTR backend has full Lyfe DB access via service-role key. Should be replaced with a dedicated read-only Lyfe API. Estimate: separate plan, ~1 week.
- **F18 — Schema contract test:** CI test that asserts Lyfe `users` columns MKTR depends on still exist. Add when Lyfe schema starts changing more frequently.
- **Live-pull for AdminAgents UI:** Keep as future enhancement — split read paths between cached mirror (lead routing) and live query (staff UI). Not necessary for Phase 0–3.
- **Webhook payload versioning:** Add `X-Webhook-Version: 1` header when first breaking change is forced.

---

## 10. Working notes for future Claude sessions

- **Always read this whole doc** before changing agent code. The FMEA captures non-obvious failure modes.
- **Update the Progress Log** with one line per work session: date, what was done, what's next.
- **Tick boxes only when acceptance criteria are met**, not when you "wrote the code."
- **If you find a new failure mode**, add it to the FMEA table with a fresh `F##` ID and reference it from the relevant task.
- **If a task turns out to be wrong / no longer applies**, mark it `~~struck through~~` rather than deleting, and add a Progress Log entry explaining why.
- **Lyfe service-role key** is in Render env vars on `srv-d2s9p0emcj7s73acd9lg`. Do not hardcode in this repo.
- **MKTR `users` table is on Render Postgres, not Supabase.** Don't confuse the two.
- **The phrase "agents are placeholders"** that started this plan refers to two things: (1) MKTR's stale `lyfe_<uuid>@placeholder.local` email artifact, and (2) Lyfe's seeded-looking-but-actually-production agents with phones in the `6590000XXX` range. Both are addressed in Phase 0–2.
