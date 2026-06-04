Read-only review. Do NOT modify any files. Review the plan in
LEAD_PACKAGE_QUOTA_PLAN.md against the actual source in this repo.

Context: lead packages currently METER consumption but don't GATE delivery. This
plan makes them a hard quota — opt-in per campaign (enforceLeadQuota), quarantine
(never reject) when no agent is funded. It claims to reuse the external-buyer
paywall pattern. Verify every claim against code; do NOT trust the plan's
file:line refs — re-derive them.

Verify specifically:
1. The 5-tier assignment in backend/src/services/systemAgent.js
   (resolveAssignedAgentId AND the additive resolveLeadAssignment) — is the plan's
   tier breakdown and the "tier-5 always assigns" claim accurate? Does skipping
   tier-5 under enforceQuota actually yield an unassigned outcome, with no other
   path silently re-adding an agent?
2. backend/src/services/leadCredits.js — is deductLeadCredit really best-effort
   (returns true without a full charge)? Would the proposed atomic chargeLeadCredit
   be race-safe under concurrent last-credit contention, the way
   deductExternalLeadBalance is?
3. backend/src/services/prospectService.js createProspect — confirm the deduction
   branch (internal best-effort vs external authoritative 409 rollback) and the
   QR-level routing override (~lines 300-355). Does decision (a) "explicit/QR
   exempt" hold given BOTH the resolver tier-3 AND this QR block can set
   assignedAgentId?
4. ALL lead sources that assign+deduct — confirm web form, retellService.js, and
   metaLeadService.js are the complete set. Flag any other call site that would
   leak the quota if not routed through the shared helper.
5. Webhook events (lead.created/assigned/unassigned) — is suppressing the webhook
   on quarantine, and firing exactly one lead.created on release, correct given
   Lyfe's dedup by external_id+source_name? Cite receive-mktr-lead behavior if
   visible in this repo.
6. Schema: is "assignedAgentId NULL AND externalAgentId NULL" genuinely an
   unreachable/safe representation for quarantine today, or can it already occur?
   Check the mutual-exclusion CHECK and migration 028.
7. Answer the 6 open questions in section 8 with a concrete recommendation each.

Output format (match the house style in CODEX_REVIEW_HOMEPAGE.md): numbered
sections, each finding tagged **blocker** / **should-fix** / **nice-to-have**,
every claim backed by file:line. Up top, state anything you could NOT verify from
the repo alone.
