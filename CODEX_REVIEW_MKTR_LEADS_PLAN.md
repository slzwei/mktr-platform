Read-only review complete. I did not modify files. Static code inspection only; I did not run the test suite.

**Phase 0: Current State And Guards**
Corrections:
- `should-fix`: the “what exists today” table is mostly accurate, but it omits the required `campaigns.external_eligible` migration/model field in [031-add-campaign-external-eligible.js](/private/tmp/mktr-main-plan/backend/src/database/migrations/031-add-campaign-external-eligible.js:11) and [Campaign.js](/private/tmp/mktr-main-plan/backend/src/models/Campaign.js:163).
- `nit`: migration `030` is real, but its header says “Migration 029” in [030-external-agent-wallet.js](/private/tmp/mktr-main-plan/backend/src/database/migrations/030-external-agent-wallet.js:1).
- `should-fix`: `resolveLeadAssignment()` is not purely “not wired”; `createProspect()` calls it when `allowExternal` is true in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:388). The comment in [systemAgent.js](/private/tmp/mktr-main-plan/backend/src/services/systemAgent.js:192) is stale.

Gaps:
- `should-fix`: there is no current API/admin surface for external agents, balances, external-campaign links, or `campaign.externalEligible`; campaign create/update validation and service code omit that field in [validation.js](/private/tmp/mktr-main-plan/backend/src/middleware/validation.js:68) and [campaignService.js](/private/tmp/mktr-main-plan/backend/src/services/campaignService.js:166).
- `should-fix`: `duplicateCampaign()` copies `externalEligible` via `...original.toJSON()` in [campaignService.js](/private/tmp/mktr-main-plan/backend/src/services/campaignService.js:332), so once a DB row is externally eligible, admin duplication can propagate it.

Risks:
- `blocker`: the three inert guards are real for the public web path: Joi rejects unknown `consentMetadata` in [validation.js](/private/tmp/mktr-main-plan/backend/src/middleware/validation.js:130), frontend only sends `consent_contact`/`consent_terms` in [LeadCapture.jsx](/private/tmp/mktr-main-plan/src/pages/LeadCapture.jsx:268), and external `lead.created` is suppressed in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:567). They are not sufficient against direct service/script callers or manual DB state.
- `should-fix`: Retell and Meta do not reach the external branch today; they create `Prospect` rows directly with internal assignment only in [retellService.js](/private/tmp/mktr-main-plan/backend/src/services/retellService.js:264) and [metaLeadService.js](/private/tmp/mktr-main-plan/backend/src/services/metaLeadService.js:240). I found no production import/seed path writing `consentMetadata.external`.

**Phase A: Routing**
Corrections:
- `blocker`: the double-routing diagnosis is correct. `createProspect()` first calls `resolveLeadRouting()` in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:201), then may call `resolveLeadAssignment()` later in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:393). Package leads can advance the same campaign cursor twice.
- `blocker`: stale `routeVia` is real. `resolveLeadAssignment()` returns `{ kind, internalAgentId | externalAgentId }` without `via` in [systemAgent.js](/private/tmp/mktr-main-plan/backend/src/services/systemAgent.js:207), while `decideAssignment()` later uses the earlier route metadata.

Gaps:
- `blocker`: the plan needs to define “external-only.” The schema only has `externalEligible`; mixed internal/external and external-only campaigns are not distinguishable.
- `should-fix`: a single-pass router should return `{kind, agentId, via, holdReason}` and be the only code path that advances the campaign cursor.
- `should-fix`: add tests for mixed rings, all-internal, all-external-funded, all-external-unfunded, and consent/no-consent traffic sharing the same cursor.

Risks:
- `blocker`: external balance is checked during routing, but charged later in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:505). Two concurrent leads can select the same buyer with balance `1`; one charge succeeds and the other returns `409` instead of rerouting or holding.
- `should-fix`: `pickFromRing()` is fair over entries, not over buyer classes. `resolveLeadAssignment()` orders all internal candidates before all external candidates in [systemAgent.js](/private/tmp/mktr-main-plan/backend/src/services/systemAgent.js:265), so business expectations for internal/external ratios must be explicit.
- `should-fix`: `enqueueCampaign()` is process-local in [systemAgent.js](/private/tmp/mktr-main-plan/backend/src/services/systemAgent.js:7); DB atomic cursor updates reduce damage, but multi-instance behavior and `findOrCreate` races still need tests.

**Phase B: Delivery**
Corrections:
- `blocker`: confirmed: `dispatchEvent()` broadcasts to all enabled subscribers whose `events` includes the event, with no destination filter in [webhookService.js](/private/tmp/mktr-main-plan/backend/src/services/webhookService.js:72). Destination-aware dispatch is mandatory before adding an MKTR Leads subscriber.
- `should-fix`: per-destination HMAC is structurally available because secrets are per subscriber in [webhookService.js](/private/tmp/mktr-main-plan/backend/src/services/webhookService.js:118), but the plan should require separate secrets, rotation, and no Lyfe secret reuse.

Gaps:
- `blocker`: B1-B4 omit `lead.assigned` and `lead.unassigned`. Lyfe is auto-registered for those events in [bootstrap.js](/private/tmp/mktr-main-plan/backend/src/database/bootstrap.js:134), and payloads include PII in [prospectHelpers.js](/private/tmp/mktr-main-plan/backend/src/services/prospectHelpers.js:86).
- `blocker`: no external delivery idempotency/refund/clawback model exists. `WebhookDelivery.deliveryId` dedupes delivery rows, not paid lead entitlement.
- `blocker`: queue overflow drops delivery work by returning early in [webhookService.js](/private/tmp/mktr-main-plan/backend/src/services/webhookService.js:27), while external charging has already happened.

Risks:
- `blocker`: charging before durable external delivery means a permanently failed webhook creates paid-but-undelivered leads. Add a ledger with `pending/delivered/refunded` states or move charge finalization after durable acceptance.
- `should-fix`: admin webhook CRUD already lets an admin create a subscriber for `lead.created` in [webhookAdminService.js](/private/tmp/mktr-main-plan/backend/src/services/webhookAdminService.js:15). With `WEBHOOK_ENABLED=true`, that subscriber receives all current internal leads unless B1 lands first.

**Phase C: Consent**
Corrections:
- `blocker`: yes, `consentMetadata` is blocked by validation today; Joi object validation does not allow unknown keys in [validation.js](/private/tmp/mktr-main-plan/backend/src/middleware/validation.js:4).
- `blocker`: yes, if service-level input contains `consentMetadata`, `createProspect()` persists it through `...incoming` in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:440).
- `should-fix`: `hasValidExternalConsent()` only validates shape: version, channels, and parseable `consentedAt` in [externalConsent.js](/private/tmp/mktr-main-plan/backend/src/services/externalConsent.js:30). It does not verify source URL, campaign, version allowlist, server timestamp, or future dates.

Gaps:
- `blocker`: do not simply whitelist client-supplied `consentMetadata`. The server should construct the external consent record from a narrow client boolean plus known campaign/source/version/request metadata.
- `blocker`: source-specific consent must be explicit. Web can use checkbox/versioned copy; Meta and Retell should remain internal unless mapped to equivalent form/verbal consent evidence.
- `should-fix`: PDPA third-party disclosure needs disclosure text, versioning, withdrawal handling, disclosure audit logs, and data-subject-right propagation to the external buyer.

Risks:
- `blocker`: accepting arbitrary client `consentMetadata.external` turns consent into a client assertion and can activate external delivery without enforceable server-side proof.

**Phase D: External Buyer Admin / Supabase**
Corrections:
- `blocker`: no external-agent CRUD, funding, or campaign-link API exists; only models/migrations and balance deduction exist in [ExternalAgent.js](/private/tmp/mktr-main-plan/backend/src/models/ExternalAgent.js:14), [ExternalCampaignAgent.js](/private/tmp/mktr-main-plan/backend/src/models/ExternalCampaignAgent.js:12), and [leadCredits.js](/private/tmp/mktr-main-plan/backend/src/services/leadCredits.js:105).
- `should-fix`: the separate MKTR Leads Supabase project is only a comment-level contract today in [ExternalAgent.js](/private/tmp/mktr-main-plan/backend/src/models/ExternalAgent.js:9).

Gaps:
- `blocker`: D must define source of truth, sync direction, buyer identity mapping, top-up ledger, conflict handling, and receiver auth before B2/B3 can be implemented.
- `should-fix`: campaign `externalEligible` enablement belongs here too; it currently cannot be set via normal campaign APIs.

Risks:
- `blocker`: funding without a ledger makes refunds, clawbacks, audit, and balance reconciliation impossible.

**Phase E: Manual Paths**
Corrections:
- `blocker`: actual assignment writer is `assignProspect()` in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:773). It does not guard external leads. Assigning an external lead to an internal agent will hit the DB check unless `externalAgentId` is cleared intentionally.
- `blocker`: unassigning an external lead leaves `externalAgentId` intact and can emit `lead.unassigned` to all subscribers in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:781).
- `blocker`: bulk assign does not filter `externalAgentId IS NULL` in [prospectService.js](/private/tmp/mktr-main-plan/backend/src/services/prospectService.js:901).
- `blocker`: quarantine release sweep can pick any quarantined prospect and internally dispatch `lead.created` in [releaseSweep.js](/private/tmp/mktr-main-plan/backend/src/services/releaseSweep.js:35), so external holds must be excluded or represented separately.

Gaps:
- `should-fix`: the plan’s audit list should add user deactivation/delete/bulk-delete assignment clearing in [userService.js](/private/tmp/mktr-main-plan/backend/src/services/userService.js:329), plus Retell/Meta direct creators if those sources are ever made external-capable.
- `should-fix`: current route authorization allows agents as well as admins to assign leads; external lead conversion should likely be admin-only.

Risks:
- `blocker`: if Phase A represents “external no buyer” as ordinary quarantine with no external marker, the release sweep can later leak that lead into Lyfe.

**Sequencing And Missing Phases**
Corrections:
- `blocker`: the proposed order is too permissive. Do not land public backend consent acceptance or external subscriber registration before destination filtering, manual guards, external hold semantics, idempotent charge ledger, and delivery failure handling.
- `should-fix`: the Retell fake-email issue does not appear current; Retell stores `email: null` in [retellService.js](/private/tmp/mktr-main-plan/backend/src/services/retellService.js:267). Still test external payloads with null email.

Missing phases:
- `blocker`: add external charge ledger, idempotency key, refund/clawback, and reconciliation.
- `blocker`: add observability and alerts for external assignment, charge failure, delivery failure, refund, low balance, destination mismatch, and consent rejection.
- `should-fix`: add rate limiting/replay protection for the external receiver and stricter abuse controls around public lead capture if leads become monetized.
- `should-fix`: add privacy operations: DSR propagation, withdrawal handling, retention/deletion sync, and disclosure records.

**Overall Verdict**
The plan is a useful scaffold, but it is not complete or safe enough as an activation roadmap. It is safe to start Phase A refactoring and B1 destination-routing design from it, but before any public consent whitelist, external subscriber, or live buyer funding, add and resequence these blockers: destination-aware dispatch for all lead events, server-derived consent, external hold semantics, idempotent charge/refund ledger, delivery failure handling, manual-path guards, and Supabase/source-of-truth design.
