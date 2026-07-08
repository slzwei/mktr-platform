# Codex Review — Redeem Ops Phase 0 Docs (2026-07-08)

Reviewer: Codex CLI 0.135.0 (`codex exec`, read-only sandbox) against the working tree.
Verdict as issued: **REWORK** — "resolve the surface/host/auth boundary model, redesign entitlement
issuance so it is server-verified and durable, and tighten the role/migration/schema plan."

Per house workflow, every finding was **verified against the actual code before folding in**.
All accepted fixes are documentation/design-detail changes; none reversed the recommended
architecture (Option A). Post-fix status: all 14 findings dispositioned; docs updated in place.

| # | Sev (Codex) | Finding | Verification | Disposition |
|---|---|---|---|---|
| 1 | BLOCKER | "One-way dependency rule" contradicted by the Phase 6 hook (MKTR calls Redeem Ops at runtime) | Wording critique — the DI-seam design already avoided imports, but the rule text was absolute and self-contradictory | **Accepted (as wording fix, not redesign)**: rule restated as a one-way *import* rule with the hook as explicit dependency inversion (no-op default callback, wired at bootstrap). `RECOMMENDED_ARCHITECTURE.md` §1/§10.6, `MKTR_INTEGRATION.md` §2 |
| 2 | BLOCKER | Entitlement issuance would trust the SPA-only OTP gate — `POST /api/prospects` is public/unverified, so `lead.created` is forgeable (fake-reward + inventory-exhaustion vectors) | CONFIRMED: `routes/prospects.js` (no auth/verification), OTP client-side in `CampaignSignupForm.jsx:129-185`, server marker only used by DNC (`verificationService.js:228-233`) | **Accepted**: issuance precondition added — backend stamps `sourceMetadata.phoneVerifiedAt` at create (from `verifiedPhoneStore`, same DI-seam change); hook AND sweep issue only for stamped prospects; anti-farming test added. `MKTR_INTEGRATION.md` §2.0, `IMPLEMENTATION_PLAN.md` Phase 6 + risk register |
| 3 | MAJOR | Admin rate-limit bypass functionally dead for cookie sessions (`optionalAuth` mounted before `cookieParser`) | CONFIRMED: `server_internal.js:120` vs `:159`; `auth.js:174` reads `req.cookies`; SPA sends no Bearer (`client.js:29`) | **Accepted** — this is a **pre-existing MKTR bug**, now documented in `REPOSITORY_DISCOVERY.md` §4 and the risk register (fix ordering before relying on any `redeem_ops` bypass) |
| 4 | MAJOR | Ops host could reach `/api/admin/*` at the host layer (guard only blocks redeem hosts) | CONFIRMED: `internalRouteHostGuard.js:39-40`, `publicHost.js:69-73` | **Accepted**: explicit ops-host allow-policy specified (`isOpsHost()` → only `/api/auth`, `/api/redeem-ops`, `/api/notifications`; 403 other internal prefixes). `RECOMMENDED_ARCHITECTURE.md` §5, `USER_SURFACES…` §2, `IMPLEMENTATION_PLAN.md` Phase 1 |
| 5 | MAJOR | Future consumer claim endpoint at `/api/redeem-ops/fulfilment/claim` contradicts blocking that prefix from consumer redeem.sg | CONFIRMED contradiction within `ROUTE_MAP.md` | **Accepted**: consumer claim moved to a separate public namespace `POST /api/reward-claim`; surface matrix updated. `ROUTE_MAP.md` |
| 6 | MAJOR | `VITE_SURFACE` described as a verified mechanism; it doesn't exist (only `VITE_BRAND` does) | CONFIRMED: `vite.config.js:6-9` | **Accepted (precision)**: `VITE_SURFACE` re-labelled as proposed Phase 1 work replicating the verified `VITE_BRAND` precedent. `RECOMMENDED_ARCHITECTURE.md` §5, `USER_SURFACES…` §3 |
| 7 | MAJOR | Duplicate-signup 409 not race-safe: a lost concurrent insert hits the unique index and returns generic 400 | CONFIRMED: pre-check 409 at `prospectService.js:406-420`; `errorHandler.js:48-55` maps `SequelizeUniqueConstraintError` → 400; index from migration 010 | **Accepted (doc precision)**: nuance documented in `REPOSITORY_DISCOVERY.md` §9; optional MKTR fix noted in risk register. Pre-existing MKTR behaviour, not a Redeem Ops defect |
| 8 | MAJOR | Enum-migration guidance imprecise (runner has no implicit transaction; 029's comment wrong) and the role change omitted code touchpoints (`User.js` enum list, `userService.js:146` invite allowlist) | CONFIRMED: `runMigrations.js:52-63` non-transactional; `userService.js:146` allows only 3 roles; 029 comment claims "implicit transaction" | **Accepted**: exact touchpoint checklist added (model ENUM, invite allowlist, roleLabel, Joi schemas, `getDefaultRouteForRole`); transaction wording corrected. `ERD.md` §2, `IMPLEMENTATION_PLAN.md` Phase 1 + risk register, `REPOSITORY_DISCOVERY.md` §6 |
| 9 | MAJOR | `UNIQUE (activationId, prospectId)` incomplete: nullable `prospectId` → Postgres allows multiple NULLs | CONFIRMED Postgres semantics; NULL only arises post-deletion (no NULL-at-issuance path), so the practical risk was narrow | **Accepted**: changed to partial unique `WHERE prospectId IS NOT NULL` with rationale. `ERD.md` §3.16, `MKTR_INTEGRATION.md` §2 |
| 10 | MAJOR | `redemptions.entitlementId UNIQUE` conflicts with `status='reversed'` re-redemption | Design tension confirmed | **Accepted**: reversal declared **terminal** (re-fulfilment = cancel entitlement + manual re-issue); partial-unique escape hatch documented. `ERD.md` §3.17 |
| 11 | MAJOR | ERD under-indexed for 10k+ partner list workflows | Partially fair; the brief (§36) explicitly forbids speculative indexes | **Accepted in modified form**: hot-path indexes stay; list-view composites deferred to Phase 2, finalized via EXPLAIN on seeded data (measure-then-index note added). `ERD.md` §3.1 |
| 12 | MINOR | Inventory counts wrong (38 models not 39; migrations start 002; runner discovers only `.js`) | CONFIRMED by recount/listing | **Accepted**: counts corrected. `REPOSITORY_DISCOVERY.md` §2/§6 |
| 13 | MINOR | Post-commit fan-out overstated — assignment/confirmation emails fire from the controller, not the service | CONFIRMED: `prospectController.js:58-72` | **Accepted**: description split into service-level fan-out vs controller-level emails. `REPOSITORY_DISCOVERY.md` §9, `MKTR_INTEGRATION.md` §2 |
| 14 | MINOR | Render topology (3 services, rewrites) unverifiable from source — no `render.yaml` | CONFIRMED (topology is operational knowledge from the Render dashboard/MCP + CLAUDE.md) | **Accepted**: provenance note added marking deployment topology as operational knowledge. `REPOSITORY_DISCOVERY.md` §7 |

## Net assessment after fixes

- Codex's REWORK verdict rested on three themes; all are now addressed **without changing the
  chosen architecture**: (1) surface/host/auth boundary made explicit (ops-host allow-policy,
  VITE_SURFACE labelled as new work, public claim namespace split out); (2) entitlement issuance
  made server-verified and durable (verification stamp + partial-unique anchor + terminal-reversal
  policy); (3) role/migration plan made mechanical (touchpoint checklist, corrected transaction
  semantics).
- Bonus outcomes for MKTR itself (pre-existing, surfaced by this review): the dead admin
  rate-limit bypass for cookie sessions (`optionalAuth` before `cookieParser`), the
  duplicate-race 400-instead-of-409, and migration 029's inaccurate "implicit transaction"
  comment. None block Redeem Ops; the limiter ordering should be fixed before any bypass is
  extended to ops staff.
- Raw Codex output: session scratchpad (`codex_review_output.md`); this file is the durable record.
