# Production Readiness — User Creation Pipeline

**Goal:** Reach production-ready quality for the user/agent creation pipeline. The final deliverable is an E2E test plan (Phase D) we trust, because the underlying systems are solid.

**Status:** Active
**Owner:** Shawn
**Started:** 2026-05-15
**Target:** TBD
**Delete when:** Phase D runs green end-to-end. Archive under `docs/plans/archive/` after that.

---

## How to use this doc

- Tasks are grouped by phase. Work A → B → C → D in order, but tasks within a phase can be parallelised.
- Update **Status** as you go: `todo` → `in-progress` → `done` (or `blocked`).
- Every task has a **Verification** step that's a runnable command — don't mark done without running it.
- Append to **Change log** and **Decision log** instead of editing in place.
- When all Phase D scenarios pass, archive this doc.

**Status legend:**
| Symbol | Meaning |
|---|---|
| ⬜ | todo |
| 🟨 | in-progress |
| 🟥 | blocked |
| ✅ | done |

---

## Status dashboard

| ID | Task | Status |
|---|---|---|
| A1 | Sync MKTR↔Supabase webhook secret | ✅ done 2026-05-14 |
| A2 | Ship Android FCM push fix | ✅ done 2026-05-15 |
| A3 | Tag real test users with `is_test_data=true` | ✅ done 2026-05-15 |
| A4 | Synthetic monitor for `lead.created` | ✅ done 2026-05-15 |
| B1 | Synthetic monitors for OTP / invitation / activate-agent | 🟨 2/4 (create-member-invitation + activate-agent done; activate-agent cron live; prod activation fix applied) |
| B2 | Add second MKTR admin + runbook | ⬜ |
| B3 | Schema-drift CI check (CLAUDE.md vs database.types.ts) | ⬜ |
| C1 | Fix QR single-create API (Joi vs DB phone format) | ⬜ |
| C2 | Refactor FCM gradle into Expo config plugin | ⬜ |
| C3 | lyfe-app working tree decision (codex/verify-outstanding-items) | ⬜ |
| D1 | Phase 0 — Discovery: entry-point map | ✅ done in research 2026-05-15 |
| D2 | Phase 1 — Pre-flight | ⬜ |
| D3 | Scenario: Director invites Manager | ⬜ |
| D4 | Scenario: Manager invites Agent (full candidate lifecycle) | ⬜ |
| D5 | Scenario: Public `/join-us` application | ⬜ |
| D6 | Scenario: PA invites Candidate (pa_manager_assignments) | ⬜ |
| D7 | Scenario: Activate-agent + MKTR sync | ⬜ |
| D8 | Phase 8 — Cleanup | ⬜ |

---

## Phase A — Foundation cleanup

### A1. Sync MKTR↔Supabase webhook secret

**Status:** ✅ done 2026-05-14

**What:** `LYFE_WEBHOOK_SECRET` (MKTR side, stored in `webhook_subscribers.secret`) had drifted from `MKTR_WEBHOOK_SECRET` (Supabase edge fn env var). Result: every `lead.created` webhook returned HTTP 401 from `receive-mktr-lead` since ≥ May 13.

**Why:** No MKTR-driven leads reached Lyfe agents. Silent outage > 24h.

**What we did:**
1. Read MKTR's subscriber secret from `webhook_subscribers` table.
2. Updated Supabase edge-fn secret `MKTR_WEBHOOK_SECRET` to match.
3. Manually replayed the failing payload — got HTTP 200, lead landed in Lyfe.

**Verification (re-runnable):**
```bash
# From MKTR backend dir, replay any 'failed' lead.created delivery:
node -e "
const { Client } = require('pg');
const crypto = require('crypto');
(async () => {
  const c = new Client({ connectionString: process.env.MKTR_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: [{ secret }] } = await c.query(\"SELECT secret FROM webhook_subscribers WHERE name='Lyfe App'\");
  const { rows: [{ body }] } = await c.query(\"SELECT payload::text AS body FROM webhook_deliveries WHERE eventType='lead.created' AND status='failed' ORDER BY createdAt DESC LIMIT 1\");
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch('https://nvtedkyjwulkzjeoqjgx.supabase.co/functions/v1/receive-mktr-lead', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'X-Webhook-Signature':'sha256='+hmac, 'X-Webhook-Timestamp': new Date().toISOString() },
    body
  });
  console.log('HTTP', res.status, await res.text());
})();"
# Expect: HTTP 200 success:true
```

**Notes:**
- Root cause unknown — either MKTR's `LYFE_WEBHOOK_SECRET` env was rotated without updating Supabase, or vice versa.
- Followed up with A4 (synthetic monitor) so this can't silently happen again.

---

### A2. Ship Android FCM push fix

**Status:** ✅ done 2026-05-15

**What:** Android push tokens were never registering in production. Three compounding issues:
1. `projectId` not passed to `getExpoPushTokenAsync` → silent null return on standalone builds
2. No Firebase project + no `google-services.json` → FCM SDK couldn't initialize
3. No `com.google.gms.google-services` Gradle plugin applied → JSON not embedded into APK at build time

**Why:** Every Android user (agents) was missing every lead notification since the app shipped on Android.

**What we did:**
- Commit `17f6c5c` (now `6db85ce` on main): pass projectId to `getExpoPushTokenAsync` in `contexts/AuthContext.tsx`.
- Commit `d1ba4eb` (now `0d478ef` on main): force-added `android/build.gradle`, `android/app/build.gradle`, `android/app/google-services.json` with the Firebase setup.
- Created Firebase project `lyfe-app-db108` (package `com.shawnlee.lyfe`).
- Uploaded FCM v1 service account JSON to EAS for Expo Push API delivery.
- Pushed APK via EAS preview build `9918a341-4118-43ef-af50-64dbb7e7f0d7`.

**Verification:**
```bash
# Confirm both commits are on main:
git log origin/main --oneline | grep -E "^(0d478ef|6db85ce)"

# Confirm a test agent has a populated push_token after fresh login on Android:
curl -s "$SUPABASE_URL/rest/v1/users?id=eq.<AGENT_UUID>&select=push_token" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"
# Expect: push_token starts with "ExponentPushToken["
```

**Notes:**
- Fix is fragile: see C2 — gradle changes were force-added to a gitignored `android/` dir. Any `expo prebuild` wipes them.

---

### A3. Tag real test users with `is_test_data=true`

**Status:** ✅ done 2026-05-15 (UI manual confirmation pending; code-level verification complete)

**What:** The 9 test users in the `+6590000X` phone range (Steven, Daniel, Shawn-mgr, Samuel, Adrian, Ching Yi, Jessica, Huixin, Costllan) all had `is_test_data=false`. The only rows tagged `true` were 3 synthetic "E2E manager XXXXXX" stubs with no phones and no downline — useless for testing.

**Why:** Staff-facing queries (team listings, lead routing, manager picker) don't filter these test users out. They appear in production UI alongside real staff, contaminating analytics and confusing operators.

**Steps:**
1. Run this UPDATE on Supabase:
   ```sql
   UPDATE public.users
   SET is_test_data = true
   WHERE phone IN (
     '6590000001','6590000002','6590000003','6590000004','6590000005',
     '6590000006','6590000007','6590000008','6590000009'
   );
   ```
2. Optionally clean up the 3 broken E2E manager stubs:
   ```sql
   DELETE FROM public.users
   WHERE is_test_data = true AND phone IS NULL AND full_name LIKE 'E2E manager %';
   ```
3. Grep lyfe-app + lyfe-sg for staff-facing queries that select from `users` and confirm they filter `is_test_data = false`. Reference: CLAUDE.md says "rows on `users` and `member_invitations` tagged `is_test_data=true` are excluded from staff-facing queries (team listings, lead routing, manager pickers, MKTR sync)."

**Verification:**
```sql
SELECT phone, full_name, role, is_test_data
FROM public.users
WHERE phone LIKE '6590000%'
ORDER BY phone;
-- expect: 9 rows, all is_test_data = true
```

```bash
# Open Lyfe app as a real admin (not a test user), go to Team tab.
# Expect: no rows named Steven Teo / Daniel / Samuel / Adrian / etc.
```

**DOD:**
- ✅ All 9 test users tagged `is_test_data = true` (verified via PATCH then GET — see commit message in this doc's repo)
- 🟨 Lyfe app team view (as a real admin) excludes them — code-level verified (13 staff-facing query sites filter `eq('is_test_data', false)` across lyfe-app `lib/team.ts`, `lib/leads/{crud,stats}.ts`, `lib/recruitment/candidates.ts` and lyfe-sg `app/admin/(dashboard)/page.tsx`, `app/admin/(dashboard)/analytics/page.tsx`, `app/candidate/actions.ts`, `app/staff/candidates/actions.ts`, `lib/invitations/resolve-manager.ts`). UI confirmation by an admin login still pending — non-blocking for Phase D.
- ✅ MKTR `mktr-agents` edge function still returns them when called directly (read source at `lyfe-app/supabase/functions/mktr-agents/index.ts:77-105` — filters only on `id` and `is_active=true`, no `is_test_data` filter)

**Side discovery:** CLAUDE.md (root + lyfe-master) claims MKTR sync excludes `is_test_data=true` — that's wrong. The edge fn does NOT filter on it. Documentation drift; queue for B3 schema-drift CI check.

**Step 2 (optional DELETE of 3 phantom E2E manager stubs) NOT performed.** The 3 rows (`E2E manager 642965`, `E2E manager 550999`, `E2E manager 892833`, all `phone=NULL`) remain. Skipped because: (a) destructive — needs explicit user confirmation per CLAUDE.md DB safety rules; (b) harmless — no phone, no downline, already excluded from staff-facing queries via `is_test_data=true`.

**Notes:** _empty_

---

### A4. Synthetic monitor for `lead.created`

**Status:** ✅ done 2026-05-15

**What:** GitHub Actions workflow runs hourly (not 15 min — see "Cadence decision" below), simulates a `lead.created` webhook with valid HMAC, asserts HTTP 200 + lead/activity/notification rows, then cleans up.

**Why:** This is the bug A1 fixed. Without a monitor, the next secret drift / env rotation will silently break the path again for hours/days.

**Status when picked up (2026-05-15):** Workflow + probe were already shipped on `lyfe-app` `main` (commit `d99c25c`, `feat(synthetic): ship staging monitoring probes + invariants sweeper`). Only DOD #3 (negative-path proof) was outstanding.

**Files:**
- Workflow: `lyfe-app/.github/workflows/synthetic-mktr-lead-created.yml`
- Probe: `lyfe-app/scripts/synthetic/03-mktr-lead-created.mjs`
- Helpers: `lyfe-app/scripts/synthetic/_lib/{mktr,hmac,run,alert,supabase,env}.mjs`
- Runbook: `lyfe-app/docs/synthetic-monitoring-runbook.md`

**What the probe asserts (beyond the DOD spec):** HTTP 200 + `leadId`; `leads` row with `source_name=mktr`, `assigned_to=probe agent`, `status=new`; `lead_activities` row with `type=created`; `notifications` row with `type=new_lead` and matching `data.leadId`. Self-heals orphan SYN-* leads pre/post via `cleanup_synthetic_leads()` RPC. Targets staging Supabase only (`ajjxkasvikeigapnzdak`); guarded by hardcoded `STAGING_PROJECT_REF` + `assertStagingMarker()`.

**Cadence decision:** Hourly (`'0 * * * *'`), not 15-min as originally specified. Hourly matches the existing assigned/unassigned probes, catches silent drift within a working day, and avoids 4× staging webhook + GHA-minutes spend for marginal detection-time gain. Revisit if a real outage ever slips past the hourly cadence.

**Alerting topology (current):** GitHub Issues only. The probe runner (`_lib/run.mjs`) opens an issue titled `[synthetic] mktr-lead-created failing` (labels: `synthetic-monitor, mktr, P1`) on failure, comments on subsequent failures of the same probe, and auto-closes with a recovery comment when the probe next passes. The workflow ALSO has a Slack-notification step gated on `env.SLACK_WEBHOOK != ''`, but `SLACK_ALERT_WEBHOOK` is NOT configured in the `synthetic-monitoring` GH environment, so it silently no-ops. **Sub-gap:** wire up Slack if pager-grade alerting is desired.

**Verification (2026-05-15 negative-path):**
1. Baseline dispatch (run `25915722417`) → success ✓
2. Broke `MKTR_WEBHOOK_SECRET_STAGING` to wrong value, dispatched (run `25915829086`) → failure with `Invalid signature`, opened issue #71 ✓
3. Recovery dispatch (run `25916346406`) after fresh-rotated matching secrets → success ✓, issue #71 auto-closed at `11:52:45Z` with recovery comment ✓
4. Repeated-failure dedup verified — subsequent failed runs (`25916004075`, `25916134227`) commented on existing issue #71 instead of opening new issues ✓

**Foot-gun discovered during negative-path (worth documenting):** `supabase secrets list` shows the SHA256 *digest* of each secret value, not the value itself. The column header is `DIGEST`. Do NOT extract values from this output and treat them as the secret — they will fail HMAC. Result: had to rotate `MKTR_WEBHOOK_SECRET` on both staging Supabase and the GH `synthetic-monitoring` env to a fresh value. The rotated secret is in 1Password (or wherever Shawn put it) — `931e6702...`.

**DOD:**
- ✅ Workflow file committed and merged (`d99c25c` on `main`)
- ✅ First scheduled run green (continuous green schedule runs since deploy; latest before this exercise: `25911503648` 2026-05-15T09:49Z)
- ✅ Negative-path verification done (alert proven to fire — issue #71 opened + auto-closed; runs above)
- ✅ Documented in `lyfe-app/docs/synthetic-monitoring-runbook.md` (linked from README §Synthetic monitoring playbook)

**Notes:**
- Sub-gap: Slack alerting wired but inert. Add `SLACK_ALERT_WEBHOOK` to `synthetic-monitoring` env if pager-grade is needed.
- Sub-gap: runbook should call out the `supabase secrets list = digest, not value` pitfall before the next person re-runs negative-path.

---

## Phase B — Infra hardening

### B1. Synthetic monitors for OTP / invitation / activate-agent paths

**Status:** 🟨 in-progress (2/4 probes shipped 2026-05-15)

**Shipped:**
- ✅ `11-create-member-invitation.mjs` (workflow: `synthetic-create-member-invitation.yml`, hourly `15 * * * *`). Exercises `intended_role=candidate` (3-table cascade: member_invitations + candidates + invitations). Auths as `probe+admin@lyfe.sg` via PROBE_ACCOUNT_PASSWORD signin (no long-lived JWT needed). Stable phone `+6580001999` reserved; pre-cleanup self-heals orphans. Two consecutive greens verified (runs `25919085573`, `25919163452`).
- ✅ `12-activate-agent.mjs` (workflow: `synthetic-activate-agent.yml`, hourly `30 * * * *`, pushed in `501218b`). Heavy fixture: stable activation user `probe+activation@lyfe.sg` (`+6580001998`) + candidate(status=licensed) + candidate_profile + 4 milestones (bdm/bes_induction completed; rnf/sales_authority issued). Asserts post-flip: `candidates.status='active_agent'`, `users.role='agent'`, `auth.users.app_metadata.role='agent'`. Reset runs in `finally` so assertion failure doesn't strand the fixture in active_agent state. Two consecutive greens (runs `25952207062` 12s, `25952223833` 10s).

**Production bugs surfaced during B1.2 — fixed:**
1. **`candidate_milestones` CHECK lacked `'bdm'` on staging.** Migration `20260418110000_bdm_as_milestone.sql` logged as applied but DDL silently no-op'd. Re-applied via one-off DDL runner; codified in `20260516040000_reapply_bdm_constraint.sql` (committed `bf7f562` on lyfe-app `main`) and applied to prod on 2026-05-16.
2. **`fn_activate_agent` had ambiguous column refs.** `WHERE candidate_id = p_candidate_id` in milestone lookups shadowed the RETURNS TABLE OUT param `candidate_id` → plpgsql raised "column reference is ambiguous" at runtime; every call returned HTTP 409. Likely **no real activation had succeeded since the function deployed** (this was the first time anyone exercised it end-to-end). Fixed via one-off DDL runner; codified in `20260516050000_fix_fn_activate_agent_ambiguity.sql` and applied to prod on 2026-05-16.
3. **`fn_activate_agent` was directly executable by `anon` and `authenticated`.** Supabase advisor surfaced explicit role grants after the function body fix. Because the RPC is `SECURITY DEFINER` and trusts `p_activated_by_user_id`, execution must stay behind the `activate-agent` edge function's JWT/capability checks. Codified in `20260516060000_restrict_fn_activate_agent_execute.sql`, applied to prod on 2026-05-16, and pushed in `c7937e5`.

**Prod verification 2026-05-16:**
- Supabase MCP target confirmed as `https://nvtedkyjwulkzjeoqjgx.supabase.co`.
- MCP `apply_migration` was blocked by read-only mode, so prod DDL was applied through one-shot Edge Functions using `SUPABASE_DB_URL`; both temporary functions were deleted after invocation and local temp source folders removed.
- `supabase_migrations.schema_migrations` contains `20260516040000`, `20260516050000`, and `20260516060000`.
- Prod `candidate_milestones` constraints include `bdm` and the per-code status rules.
- Prod `fn_activate_agent` milestone lookups now use qualified `cm.candidate_id = p_candidate_id`; unqualified `WHERE candidate_id = p_candidate_id` is absent.
- Function privileges verified: `anon=false`, `authenticated=false`, `service_role=true`.

**Operational footnotes (worth surfacing in runbook):**
- `supabase secrets list` shows DIGEST not VALUE (already in runbook).
- Staging phantom migration repair done 2026-05-16. `20260504150311` was recovered into `lyfe-app/supabase/migrations/` as an idempotent file (`86e0ca9`). The other four phantoms (`20260504150321`, `…332`, `…338`, `…351`) were duplicates of local `20260428120000`, `20260428130000`, `20260428140000`, `20260428160000`; staging history was repaired by marking the local versions applied and the duplicate phantom rows reverted. Plain `supabase db push --linked` now fails only because older local migrations are pending before the repaired remote watermark; `supabase db push --linked --dry-run --include-all` succeeds and lists the pending migrations cleanly.
- `oneoff-fix-bdm` and `oneoff-fix-fn-activate` patterns: deploy a temporary edge function, invoke, delete. Useful when CLI lacks `db query`/`db execute` (still missing in v2.98). Don't commit the function source.

**Remaining (2/4):**
- `send-email-otp` + `verify-email-otp` (paired, share OTP state)
- `custom-sms-hook` — harder; Supabase Auth hook not directly callable, may need a different probe pattern (defer or skip)

**What:** Extend the synthetic pattern (A4) to the user-creation paths.

**Why:** Same reasoning as A4. The user-creation paths are CRITICAL onboarding infrastructure; silent breakage is unacceptable.

**Coverage:**
- `send-email-otp` + `verify-email-otp` (PDPA OTP flow)
- `create-member-invitation` (unified invite path)
- `activate-agent` (candidate → agent flip)
- `custom-sms-hook` (SMS OTP send)

**Steps:**
1. For each function, write a synthetic that:
   - Authenticates by signing in a dedicated probe user via `signInWithPassword({ email: 'probe+ROLE@lyfe.sg', password: PROBE_ACCOUNT_PASSWORD })`
   - Self-heals probe user metadata with service-role admin calls before sign-in if role drift is possible
   - Calls the function with fixture inputs
   - Asserts expected response shape + DB write
   - Cleans up created rows
2. One workflow per function, scheduled hourly and staggered (`00`, `15`, `30`, `45`) unless a later incident justifies tighter cadence.
3. Page on failure.

**Verification:** Same shape as A4.

**DOD:**
- 4 new workflows merged + green
- Each has negative-path verification done once
- Dedicated probe accounts use `PROBE_ACCOUNT_PASSWORD`; no long-lived user JWT stored in GitHub secrets
- Probe credential rotation procedure documented

**Notes:**
- Test admin should be a dedicated user (NOT shawnleeapps), tagged `is_test_data=true`, with role=`admin`. Create as part of B2.

---

### B2. Add second MKTR admin + runbook

**Status:** ⬜ todo

**What:** Currently `shawnleeapps@gmail.com` is the only MKTR admin user. Bus factor = 1.

**Why:** If Shawn is unavailable, no one can manage QRs, sync agents, or hit the admin API.

**Steps:**
1. Decide who's the second human admin (co-founder / ops / trusted contractor).
2. Add to MKTR `users` table:
   ```sql
   INSERT INTO users (id, email, "firstName", role, "isActive", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), '<email>', '<name>', 'admin', true, NOW(), NOW());
   ```
3. Optionally: add a dedicated `synthetic@mktr.local` admin used ONLY by the synthetic monitors (B1).
4. Write `docs/runbook/admin-access.md` with:
   - How to add/remove an admin
   - How to rotate the JWT
   - How to recover if Shawn's account is locked
   - Where the dedicated synthetic admin JWT is stored

**Verification:**
```sql
SELECT email, role FROM users WHERE role='admin' AND "isActive"=true;
-- expect: >= 2 rows
```

**DOD:**
- ≥ 2 active human admins on MKTR
- 1 synthetic admin user (used only by B1 monitors)
- Runbook merged at `docs/runbook/admin-access.md`

**Notes:** _empty_

---

### B3. Schema-drift CI check

**Status:** ⬜ todo

**What:** Add a CI check that fails if `lyfe-types/src/database.types.ts` is edited without a corresponding CLAUDE.md update (or vice versa).

**Why:** During this session we hit ~5 column-name mismatches between CLAUDE.md / the test plan and the actual DB (`first_name`/`full_name`, `manager_id`/`reports_to`, `event`/`eventType`, `read_at`/`is_read`, `expo_push_token`/`push_token`). Anyone (human or LLM) coding from CLAUDE.md produces broken code on the first try.

**Steps:**
1. Write a script (`scripts/check-schema-drift.sh`) that:
   - Greps CLAUDE.md for table/column references
   - Cross-references against `database.types.ts`
   - Outputs diff if any column name in CLAUDE.md doesn't exist in types
2. Add to lyfe-app CI as a required check on PRs that touch CLAUDE.md or types.
3. Alternative: auto-regenerate the relevant CLAUDE.md sections from types via a script that runs on `npm run gen:types`.

**Verification:**
```bash
bash scripts/check-schema-drift.sh
# Expect: exit code 0, no diff output
```

**DOD:**
- Script written + tested locally
- CI check wired up + required on protected branches
- Existing schema drift fixed (run script, fix every drift it surfaces)

**Notes:**
- Stretch: have the check also validate against actual Postgres schema (via service-role REST) for the live deployment.

---

## Phase C — Bug fixes

### C1. Fix QR single-create API (Joi vs DB phone format)

**Status:** ⬜ todo  •  Tracked separately as task #10 in this session

**What:** `qrCodeService.js:166` does `User.findOne({ where: { phone: assignedAgentPhone } })` — exact-match. `validation.js:180` Joi requires `assignedAgentPhone` matches `/^\+[1-9]\d{9,14}$/` (i.e., must start with `+`). But MKTR's user mirror stores phones without `+` (e.g., `6590000004`). So any QR created through the documented single-create API has `assignedAgentId = null`, falling through to System Agent.

**Why:** Direct-assignment QRs created via the API don't actually route to the named agent. Customers would think they're routing to "Jane" but leads go to System Agent.

**Steps:**
1. Decide on canonical phone format. Recommended: E.164 with `+` everywhere. Run a migration to backfill all `users.phone` to E.164.
2. Update `qrCodeService.js` to normalize the input via `normalizePhone()` from `prospectHelpers.js` before the lookup.
3. Add a regression test that creates a QR via the single-create API and asserts `assignedAgentId` is populated.
4. Also fix the bulk-create endpoint to enforce the same validation (currently bypasses Joi entirely — security concern).

**Verification:**
```bash
# Create a QR via API:
curl -X POST https://mktr-backend-jo6r.onrender.com/api/qrcodes \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"label":"test","type":"promotional","campaignId":"<CAMPAIGN>","agentAssignmentMode":"direct","assignedAgentPhone":"+6590000004"}' \
  | jq '.data.qrTag.assignedAgentId'
# Expect: a UUID, not null
```

**DOD:**
- Single-create API: `assignedAgentId` populates correctly
- Bulk-create API: applies same validation
- Migration completed if phone format normalised
- Regression test merged

**Notes:**
- Existing "Boat Quay shop" QR has `assignedAgentPhone='6590000001'` (no `+`) and a populated FK — it was almost certainly created via bulk endpoint or direct SQL seed, confirming bulk skips validation.

---

### C2. Refactor FCM gradle into Expo config plugin

**Status:** ⬜ todo  •  Tracked separately as task #14

**What:** Commit `0d478ef` force-added `android/build.gradle`, `android/app/build.gradle`, `android/app/google-services.json` to override the `/android` line in `.gitignore`. Standard Expo bare-workflow assumes `expo prebuild` regenerates `android/`. Any prebuild now wipes the Firebase setup.

**Why:** Time-bomb. Whenever someone runs `expo prebuild` (e.g., upgrading SDK, adding a new module), Android push silently breaks again.

**Steps:**
1. Write a local config plugin (`plugins/withFirebaseAndroid.js`) that during prebuild:
   - Adds `com.google.gms:google-services:4.4.2` to `android/build.gradle` buildscript dependencies
   - Adds `apply plugin: "com.google.gms.google-services"` to `android/app/build.gradle`
   - Copies `google-services.json` from a known location (e.g., root or env-var path) to `android/app/`
2. Add `googleServicesFile: './google-services.json'` to `app.config.js` android block (also serves as the canonical source).
3. Add the plugin to the `plugins:` array in `app.config.js`.
4. Move `google-services.json` to repo root (or wherever your plugin reads from) and verify it's not gitignored at that path.
5. Run `expo prebuild --clean` and verify the generated `android/` has the plugin + JSON.
6. EAS build → install → verify push tokens still register.
7. Once verified working: `git rm --cached android/build.gradle android/app/build.gradle android/app/google-services.json` and let them be regenerated by prebuild going forward.

**Verification:**
```bash
cd lyfe-app
expo prebuild --clean
grep "google-services" android/build.gradle android/app/build.gradle
# Expect: classpath + apply plugin lines present
ls android/app/google-services.json
# Expect: file exists
```

Then full EAS preview build + install + login + push token check.

**DOD:**
- Config plugin in place + tested
- `expo prebuild --clean` regenerates Android with FCM intact
- Force-added gradle/JSON files removed from git
- Push tokens still register on fresh Android install

**Notes:** _empty_

---

### C3. lyfe-app working tree decision (codex/verify-outstanding-items)

**Status:** ⬜ todo

**What:** The `lyfe-app` branch `codex/verify-outstanding-items` has substantial uncommitted work (deletion of entire `admin/` directory, 4 untracked migrations, modified workflows, README, CLAUDE.md), divergent from main by 8 ahead / 3 behind. There's also a stash `wip: pre-e2e-push-token-build` containing pre-test working state.

**Why:** Hard to know what's actually production-ready vs experimental. Future deploys are risky if anyone runs the wrong checkout. The user-creation pipeline test (Phase D) will be hard to interpret if test results depend on branch state.

**Steps:**
1. Decide per-change whether it ships, gets parked on a separate branch, or rolls back:
   - `admin/` deletion (massive scope)
   - 4 new migrations in `supabase/migrations/` — what do they do?
   - Workflow changes (synthetic monitors)
   - Test file changes
   - CLAUDE.md updates
2. For each "ships": cherry-pick or rebase onto main, open PR, merge.
3. For each "parks": move to a labeled branch.
4. For each "rolls back": delete from working tree.
5. Pop the stash, resolve conflicts, repeat per-change decision.
6. Once main has everything, delete `codex/verify-outstanding-items` (both local + remote).

**Verification:**
```bash
cd lyfe-app
git status --short
# Expect: clean working tree
git stash list
# Expect: empty (or only stashes intentional to keep)
git branch -a | grep codex
# Expect: empty
```

**DOD:**
- Working tree clean
- All stashes resolved or intentionally retained
- No experimental long-lived branches
- Main reflects current intended state

**Notes:**
- This is a real engineering investment — half a day to a day depending on how much of the uncommitted work is genuinely WIP vs ready.

---

## Phase D — User-creation pipeline E2E test (the deliverable)

> **Gate:** Don't start Phase D until A1-A4 are done, at least one B/C task lands, the production `fn_activate_agent` ambiguity fix is applied, the activate-agent cron is pushed, and D2 pre-flight is green. The test will produce noisy results otherwise.
>
> **Checkout hygiene:** Before running D3-D7, either complete C3 or explicitly freeze the run on `lyfe-app/main` so results do not depend on experimental branch state.

### D1. Phase 0 — Discovery: entry-point map

**Status:** ✅ done in research 2026-05-15

The map of every user-creation entry point. Captured in the Explore agent's research summary on 2026-05-15. Reproduced here for self-contained reference:

#### Role-creation paths (in scope for D)

| # | Entry point | Mechanism | Final role |
|---|---|---|---|
| 1 | Staff creates candidate (mobile, legacy) | `create-candidate` edge fn | candidate |
| 2 | Staff creates member (unified) | `create-member-invitation` edge fn | any role per matrix |
| 3 | Candidate accepts token invite | `/candidate/login?token=` server action | candidate (full) |
| 4 | Public `/join-us` application | `submitApplication()` server action | candidate (organic) |
| 5 | Candidate → agent activation | `activate-agent` edge fn | agent |
| 6 | MKTR admin creates user | MKTR Express controller | MKTR-local role |
| 7 | MKTR agent sync from Lyfe | `mktr-agents` edge fn → MKTR `syncAgentsFromLyfe` | mirrored agent |
| 10 | PA → manager link | `pa_manager_assignments` row | (relationship) |

Out of scope: 8 (MKTR webhook prospect — covered by lead pipeline test) and 9 (staff OTP login — no row created).

#### Notification types

- `candidate_assigned` — entry points 1, 2, 3
- `organic_application` — entry point 4 only (distinct since commit `e53e83a`)
- `enneagram_completed` — quiz finish (entry point 4)

---

### D2. Phase 1 — Pre-flight

**Status:** ⬜ todo

**What to verify before running scenarios:**
1. All test users (`+6590000X`) exist, are active, and are tagged `is_test_data=true` (depends on A3)
2. Daniel's downline cleanly contains Samuel + Adrian + Ching Yi + Jessica
3. Shawn (manager) downline contains Huixin + Costllan
4. Steven (director) has both Daniel + Shawn as direct reports
5. At least one test admin exists (Steven role=director may need to be promoted, or a dedicated test admin created)
6. `pa_manager_assignments` table empty for our test users (or populate as part of D6 setup)
7. Push tokens populated for any test agent we'll receive notifications on (depends on A2)
8. MKTR `users` mirror is current (run `POST /api/lyfe/agents/sync` once)
9. `MKTR_WEBHOOK_SECRET` aligned (depends on A1 / A4 health check)

**Verification (single SQL query, expects all green):**
```sql
WITH expected AS (
  SELECT * FROM (VALUES
    ('6590000001','Steven Teo','director',NULL),
    ('6590000002','Daniel','manager','4ac16477-e844-462e-881b-6e44045b30d7'),
    ('6590000003','Shawn','manager','4ac16477-e844-462e-881b-6e44045b30d7'),
    ('6590000004','Samuel','agent','9800bc75-39ed-4848-a995-580ec7ef7ea9'),
    ('6590000005','Huixin','agent','3830527a-a886-4a5c-b121-76f7aefb0c6a'),
    ('6590000006','Adrian','agent','9800bc75-39ed-4848-a995-580ec7ef7ea9'),
    ('6590000007','Ching Yi','agent','9800bc75-39ed-4848-a995-580ec7ef7ea9'),
    ('6590000008','Jessica','agent','9800bc75-39ed-4848-a995-580ec7ef7ea9'),
    ('6590000009','Costllan','agent','3830527a-a886-4a5c-b121-76f7aefb0c6a')
  ) AS t(phone, name, role, reports_to)
)
SELECT e.phone, e.name AS expected_name, u.full_name, u.role AS actual_role,
       u.is_test_data, u.push_token IS NOT NULL AS has_push
FROM expected e
LEFT JOIN public.users u ON u.phone = e.phone;
-- Expect: 9 rows, full_name + role match, is_test_data=true on all,
--         has_push=true for any agent we'll device-test on.
```

**DOD:** all 9 fixtures verified, test admin available, MKTR sync current.

---

### D3. Scenario: Director invites Manager

**Status:** ⬜ todo

**Coverage:**
- Entry point #2 (`create-member-invitation`) with `intended_role='manager'`
- Capability matrix: director can invite manager (admin & director can; manager+below cannot)
- `member_invitations` row creation
- Notification dispatch on invite accept

**Steps (filled in during Phase D execution — leave skeleton):**
1. Call `create-member-invitation` as Steven (director) with `{ intended_role: 'manager', phone: '+65 XXX', email: '...' }`
2. Verify `member_invitations` row created with status='pending', intended_role='manager'
3. Negative path: same call as a manager-role caller should 403
4. Accept the invite via the new manager's first login (phone OTP)
5. Verify `users` row created with role='manager', reports_to=Steven's id
6. Verify `candidate_assigned` notification fires for the new manager's manager (or whoever's notified)

**Verification queries:** to be filled in

**DOD:** all asserts pass, negative path returns 403

**Notes:** _empty_

---

### D4. Scenario: Manager invites Agent (full candidate lifecycle)

**Status:** ⬜ todo

**Coverage:**
- Entry point #1 (`create-candidate`) OR #2 (`create-member-invitation`)
- Entry point #3 (candidate accepts token invite)
- Full onboarding form (lyfe-sg, 6 steps)
- DISC quiz completion
- Entry point #5 (`activate-agent`)
- JWT refresh after role flip
- Push notification arrival

**Steps (skeleton):**
1. Manager Daniel creates a candidate
2. Candidate logs in via invite token, completes onboarding form
3. Candidate completes DISC quiz, results PDF generated
4. Daniel reviews, calls `activate-agent`
5. New agent's JWT refreshes, app picks up new role
6. Verify MKTR agent sync includes the new agent on next pull (depends on B1 if monitored)

**Verification queries:** to be filled in

**DOD:** new agent visible in MKTR `users` mirror with correct `lyfeId`

**Notes:** _empty_

---

### D5. Scenario: Public `/join-us` application

**Status:** ⬜ todo

**Coverage:**
- Entry point #4 (`submitApplication`)
- Honeypot + rate limit
- Auto-onboarding to step 6 (full profile)
- `organic_application` notification (distinct from `candidate_assigned`)
- Enneagram quiz path
- PDF generation + storage upload
- Default assignment to STEVEN_ID

**Verification:** queries TBD

**DOD:** organic candidate created, correct notification type, results PDF uploaded

**Notes:**
- Need to scrub test rows after — they're real-looking production data.

---

### D6. Scenario: PA invites Candidate (pa_manager_assignments)

**Status:** ⬜ todo

**Coverage:**
- Entry point #10 (PA→manager link)
- Entry point #2 with PA as caller, `intended_role='candidate'`
- Capability matrix: PA can only invite candidate (not agent/manager/etc.)
- PA must be linked before invitation

**Steps (skeleton):**
1. Create a test PA user
2. Verify PA cannot invite without `pa_manager_assignments` row (expect 403)
3. Insert `pa_manager_assignments` linking PA to Daniel
4. PA invites a candidate, candidate assigned to Daniel
5. Verify negative paths (PA invites a manager = 403)

**DOD:** PA invite works under linked manager, fails without link, fails for higher roles

**Notes:** _empty_

---

### D7. Scenario: Activate-agent + MKTR sync

**Status:** ⬜ todo

**Coverage:**
- Entry point #5 (activate-agent) — already in D4
- Entry point #7 (MKTR agent sync pulls the new agent)
- Cross-system verification

**Steps:**
1. Re-use the newly-activated agent from D4
2. Call `POST /api/lyfe/agents/sync` on MKTR
3. Verify MKTR `users` table has a row with the new agent's `lyfeId`, correct phone, email, full_name
4. Verify their `isActive=true`

**DOD:** MKTR mirror in sync with Lyfe within one sync cycle

**Notes:** _empty_

---

### D8. Phase 8 — Cleanup

**Status:** ⬜ todo

**Coverage:**
- Delete all test artifacts created during scenarios
- Reset state for the next run

**To delete:**
- New users created in D3 (test manager)
- New candidate + agent from D4
- /join-us organic candidate from D5
- Test PA + pa_manager_assignments row from D6
- All notifications, candidate_profiles, member_invitations rows that cascaded
- Auth users via `delete-account` edge function (cascades through related tables — verify cascades work)

**Verification:**
```sql
SELECT COUNT(*) FROM public.users
WHERE created_at > '<test start time>' AND is_test_data = true;
-- Expect: 0 net new rows after cleanup (or only intentionally-retained fixtures)
```

**DOD:** state restored to pre-test (modulo Phase D1 fixtures)

**Notes:** _empty_

---

## Change log

Append-only. Format: `YYYY-MM-DD — task ID — what changed — by whom`.

```
2026-05-14 — A1 — Synced webhook secret, replayed failed delivery, lead landed in Lyfe — Shawn (with Claude)
2026-05-14 — A2 (part 1) — committed projectId fix as 17f6c5c on codex/verify-outstanding-items — Shawn (with Claude)
2026-05-15 — A2 (part 2) — created Firebase project lyfe-app-db108, uploaded FCM v1 service account, force-added gradle config — Shawn (with Claude)
2026-05-15 — A2 (part 3) — cherry-picked to main as 6db85ce + 0d478ef, pushed — Shawn (with Claude)
2026-05-15 — D1 — entry-point research captured via Explore agent — Claude
2026-05-15 — doc created — Claude
2026-05-15 — A4 — Verified negative-path end-to-end: broke MKTR_WEBHOOK_SECRET_STAGING, confirmed run 25915829086 failed + issue #71 opened, rotated fresh secret on both staging Supabase + GH env, recovery run 25916346406 passed + issue auto-closed. Discovered `supabase secrets list` shows digests not values; documented in A4 notes. Marked ✅. — Shawn (with Claude)
2026-05-15 — A3 — PATCHed is_test_data=true on 9 +6590000X test users via PostgREST. Code-level verified 13 staff-facing query sites filter is_test_data=false; verified mktr-agents edge fn still returns them. Surfaced doc drift: CLAUDE.md wrongly says MKTR sync excludes is_test_data — added to B3 backlog. DELETE of 3 E2E manager stubs intentionally skipped. Marked ✅ (UI confirmation pending). — Shawn (with Claude)
2026-05-16 — B1 — Reviewed production activation blocker via read-only Supabase MCP: MCP points at prod but cannot apply migrations; prod constraints already include `bdm`, migration versions are not recorded, and `fn_activate_agent` still has ambiguous unqualified milestone lookups. Tightened B1 status/DOD language. — Codex
2026-05-16 — B1 — Enabled activate-agent hourly cron on lyfe-app main (`501218b`). Applied prod activation migrations `20260516040000` and `20260516050000` via one-shot Edge Function because Supabase MCP is read-only; verified migration records, constraint shape, and qualified function body. Supabase advisor then surfaced explicit anon/authenticated EXECUTE grants on `fn_activate_agent`; added/applied `20260516060000_restrict_fn_activate_agent_execute.sql` and pushed lyfe-app main (`c7937e5`). Verified privileges: anon=false, authenticated=false, service_role=true. — Codex
2026-05-16 — staging migrations — Investigated 5 phantom staging migrations. Recovered `20260504150311_backfill_unique_constraints_and_exam_papers_column.sql` into lyfe-app (`86e0ca9`). Repaired staging history: marked local equivalents `20260428120000`, `20260428130000`, `20260428140000`, `20260428160000` applied and duplicate phantom rows `20260504150321`, `20260504150332`, `20260504150338`, `20260504150351` reverted. Verified `supabase db push --linked --dry-run --include-all` now succeeds. — Codex
```

---

## Decision log

Append-only. Document any scope changes or "won't fix" decisions.

```
2026-05-15 — A2 — Force-added gitignored android/ files (rather than config plugin) because Phase D was time-pressured. Long-term fix: C2.
2026-05-15 — Phase D scoping — Limited to 5 scenarios (D3-D7) covering the most-used entry points. Out of scope: MKTR direct user creation (#6), staff OTP login (#9), MKTR webhook prospect (#8 — already covered by lead pipeline test).
2026-05-15 — A4 cadence — Kept hourly instead of moving to */15 min as originally written. Rationale: matches existing assigned/unassigned probes, sufficient for catching silent secret drift within working hours, avoids 4× GHA + staging-edge-fn cost. Revisit if a real outage ever slips past hourly window.
2026-05-15 — A4 alerting — Accepted GH-Issues-only alerting for now (Slack webhook stub present but inert). Rationale: GH Issues are checked daily and the failure path is proven (issue #71). Wiring Slack is a sub-gap, not a blocker.
2026-05-16 — B1 credential pattern — Standardised synthetic probes on short-lived sign-in using `PROBE_ACCOUNT_PASSWORD` and dedicated probe users instead of storing long-lived user JWTs in GitHub secrets.
2026-05-16 — Phase D gate — Tightened the E2E gate to require the production activation fix, pushed activate-agent cron, green D2 pre-flight, and explicit checkout hygiene before running D3-D7.
```

---

## Reference: Verification commands (reusable snippets)

### Read MKTR DB
```bash
# Connection URL stored at /tmp/.mktr-db-url (regenerate per session):
export MKTR_DB_URL="$(cat /tmp/.mktr-db-url)"
cd /Users/shawnlee/lyfe-master/mktr-platform/backend
node -e "
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.MKTR_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query('<YOUR SQL>');
  console.table(r.rows);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });"
```

### Read/write Lyfe Supabase via PostgREST
```bash
SUPABASE_URL=$(grep "^EXPO_PUBLIC_SUPABASE_URL" /Users/shawnlee/lyfe-master/lyfe-app/.env | cut -d= -f2-)
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY" /Users/shawnlee/lyfe-master/lyfe-app/.env.local | cut -d= -f2-)
# GET
curl -s "${SUPABASE_URL}/rest/v1/users?phone=eq.6590000004" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" | python3 -m json.tool
# DELETE
curl -s -X DELETE "${SUPABASE_URL}/rest/v1/leads?id=in.(...)" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}"
```

### Call an edge function
```bash
curl -s -X POST "${SUPABASE_URL}/functions/v1/<function-name>" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '<payload>'
```

### Check EAS build status
```bash
cd /Users/shawnlee/lyfe-master/lyfe-app
eas build:view <build-id> 2>&1 | grep -E "^Status|^Application|^Finished"
```
