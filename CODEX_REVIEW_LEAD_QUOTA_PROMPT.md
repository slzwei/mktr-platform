Read-only review. Do NOT modify any files. This is the FINAL implementation review of
the lead-quota (hard paywall) feature on branch feat/lead-package-quota.

Scope: review the NET feature diff vs main:
  git diff origin/main...HEAD -- backend/
The merge with main's quiz/TikTok work is NOT the subject — focus on the lead-quota
changes. The feature is ALREADY validated (14 integration tests pass against a real
Postgres + 1051 unit tests pass), so do NOT re-litigate "does it basically work" — hunt
for SUBTLE correctness bugs, race conditions, and edge cases the tests may not cover.

Scrutinize specifically:
1. leadCredits.js `chargeLeadCredit` — the CTE with `FOR UPDATE OF a SKIP LOCKED`. Is it
   truly race-safe AND campaign-scoped? Can it over-charge, charge the wrong campaign's
   package, drive leadsRemaining negative, or double-spend the last credit under
   concurrent transactions? Is the owed_leads_count fallback correct? Transaction
   ownership (caller tx vs own) + the rethrow-on-caller-tx path — can it leave a caller
   transaction poisoned or silently swallow a real failure?
2. leadQuota.js `decideAssignment` — exempt (self/admin) vs gated (qr/package/fallback);
   the `charged` flag preventing the caller's best-effort double-deduct; any via/route
   that could slip the gate.
3. systemAgent.js `resolveLeadRouting` — correct route labelling; is it behaviour-
   preserving vs the old resolveAssignedAgentId for the non-quota path?
4. prospectService.js — createProspect (quota branch, webhook suppression on quarantine,
   no double-deduct), assignProspect (release-aware: the atomic claim UPDATE, lead.created
   vs lead.assigned, double-click/concurrent-sweep safety), updateProspect (PUT reassign
   leak closed), bulkAssignProspects (skips held), listHeldProspects + its module-level
   export.
5. retellService.js + metaLeadService.js — identical quota wiring; soft campaigns MUST
   stay deduct-free (they never deducted before); webhook + agent email suppressed on
   quarantine; idempotency key still written for held leads.
6. releaseSweep.js — FIFO drain + atomic claim-then-charge in ONE tx (rollback un-claims
   on charge fail); guaranteed termination / no infinite loop; the MAX_RELEASE_PER_SWEEP
   bound; SKIP LOCKED spurious-skip implications; the assignPackage/updateAssignment
   triggers (fire-and-forget dynamic import — any lost-error or ordering risk) + the
   periodic backstop.
7. migrations/035-add-lead-package-quota.js — DDL correctness + idempotency.
8. Webhook semantics end-to-end: suppress lead.created on quarantine, fire exactly one
   lead.created on release — correct given Lyfe dedups by external_id+source_name? Any
   path that emits lead.created for a held lead, or lead.assigned for a lead Lyfe never saw?

Also flag anything in the createProspect MERGE with main's quiz/TikTok additions that
looks logically mis-combined (e.g., quota charge/quarantine interacting with quiz scoring,
Meta CAPI, or TikTok dispatch in the wrong order, or a suppressed webhook that should
still fire a CAPI/TikTok conversion).

Output (house style like CODEX_REVIEW_HOMEPAGE.md): numbered sections, each finding tagged
**blocker** / **should-fix** / **nice-to-have**, every claim backed by file:line. State up
front anything you could NOT verify from the repo alone.
