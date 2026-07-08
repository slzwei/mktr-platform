# Redeem Ops — Architecture Options

> Phase 0 deliverable. Options are constrained to what the repository actually is (see
> `REPOSITORY_DISCOVERY.md`): a single Express+Sequelize backend on one Postgres, a single React SPA
> compiled into multiple Render static sites by build flag, no queue infra, no workspace tooling.
> The intended user surfaces (mktr.sg operators, ops.redeem.sg internal staff, future
> partners.redeem.sg, consumer redeem.sg) are product boundaries — evaluated here for how each
> option realizes them, not taken as a mandate for physical separation.

## Option A — Redeem Ops as a new surface of the existing application

New backend module namespace (`/api/redeem-ops/*`, flag-mounted) + new SPA route group
(`/redeem-ops/*`) in the same codebase. Exposure in two steps: dark on mktr.sg behind flags for
dogfooding, then a **third Render static site at `ops.redeem.sg`** built from the same commit with
a surface flag (exact mechanism the repo already uses for redeem.sg).

- **Advantages**
  - Reuses everything that is already proven: auth (`authenticateToken`), Joi validation,
    error/log/Sentry plumbing, route auto-loader with env-flag dark-launch, migration runner,
    DI-factory testing, shadcn UI kit, TanStack Query, DashboardLayout shell.
  - Direct FKs to `campaigns.id`, `prospects.id`, `users.id` — referential integrity and
    server-side joins instead of sync/projection code.
  - Zero new operational surface area until cutover; one deploy pipeline; single Sentry/logging.
  - The two-brand precedent (`VITE_BRAND`) means the ops.redeem.sg surface is configuration, not
    architecture: one Render static site + DNS + allowlist entries.
  - Smallest possible diff to reach the V1 goal (3 outreach staff working daily).
- **Disadvantages**
  - Monolith grows (~15 more models, ~8 route files); model/route dirs are flat by auto-loader
    constraint, so boundary discipline is by naming convention + review, not filesystem walls.
  - Shared blast radius: a bad Redeem Ops migration runs in the same boot path as production MKTR
    (mitigated: migrations are additive-only new tables; flag-gated routes).
  - Backend rate limiter / CORS / host-guard lists need deliberate updates for the new namespace
    and host.
- **Deployment impact**: none initially (flags off); later +1 static site + DNS records.
- **Authentication**: reuse JWT cookie identity unchanged; per-host sessions come free
  (host-only cookie). No new login system.
- **Authorization**: additive — new `redeem_ops` role value + `redeemOpsRole` sub-role +
  capability middleware; existing MKTR role gates untouched.
- **Database ownership**: same Postgres; Redeem Ops owns its tables (clear prefix set), touches
  MKTR tables only via FKs and read-only queries.
- **API coupling**: in-process service calls where needed (campaign projection, entitlement hook);
  no HTTP hop between "systems".
- **Development complexity**: low — one repo, one dev server pair, existing test harness.
- **Operational complexity**: low — one backend instance, in-process sweeps per house pattern.
- **Migration risk**: low — additive tables, flag-gated mounts, no changes to capture path until
  Phase 6 (and then post-commit + reconciliation only).
- **Long-term maintainability**: good if the module boundary is enforced by convention (namespaced
  files, `services/redeemOps/`, its own audit + permission modules). If Redeem Ops one day needs
  independent scaling/teams, the namespaced module + its table set is the extraction seam.

## Option B — Sibling frontend application in the repository, shared backend

A second Vite app (e.g. `ops-app/` with its own `package.json`, router, layout, design baseline),
still calling the same backend; backend work identical to Option A.

- **Advantages**
  - Hard bundle isolation: ops UI cannot leak into consumer/admin bundles and vice versa; freedom
    to diverge visually (denser B2B chrome) without touching MKTR pages.
  - Clear future home for a partner portal as a third sibling app.
- **Disadvantages**
  - Duplicates the entire frontend substrate: API client, auth store, query client, UI kit config,
    Tailwind/design tokens, Sentry init, test setup — either copied (drift) or extracted into a
    shared package (which drags in workspace tooling the repo deliberately does not have).
  - Two `node_modules`/build pipelines in one repo without workspace management is the worst of
    both worlds; introducing pnpm/Turbo contradicts the "only if justified" constraint — and it
    isn't: the existing `VITE_BRAND` mechanism already achieves per-surface bundles with tree-shaken
    route gating (verified: redeem build excludes admin code).
  - Slower V1: substrate duplication before any partner CRM value ships.
- **Deployment impact**: +1 static site (same as A eventually) but with its own build config.
- **Auth/Authorization/DB/API coupling**: identical to A (same backend).
- **Development complexity**: medium-high (double frontend maintenance).
- **Operational complexity**: medium (second build to keep green).
- **Migration risk**: low for MKTR, but higher chance of half-finished shared-code extraction.
- **Long-term maintainability**: only pays off if the ops UI must diverge radically; the existing
  brand-flag mechanism gives 90% of the isolation at 10% of the cost.

## Option C — Separate application (own repo/service) with an internal API to MKTR

Standalone Redeem Ops service (own backend + frontend + DB or schema), talking to MKTR over
HTTP/webhooks for campaign lookup and lead references.

- **Advantages**
  - Maximum isolation: independent deploys, independent failure domains, freedom of stack.
  - Cleanest story if Redeem Ops were ever a separately sold product or separately staffed team.
- **Disadvantages**
  - Duplicates by necessity everything the brief forbids duplicating: second auth system (or an
    SSO layer the repo doesn't have — the JWKS/auth-service spike is dormant and unproven in prod),
    second DB + credentials, second Sentry/CI/deploy, HMAC internal APIs for campaign search and
    lead reference, sync jobs and eventual-consistency handling for what would otherwise be a
    foreign key.
  - The entitlement flow (lead → entitlement) becomes a cross-service webhook with retry/dedup
    machinery — MKTR's webhook engine could serve it, but that's real new surface area for zero
    user value.
  - Two-sided changes for every integration tweak; slowest V1 by far.
  - Contradicts observed reality: this team runs one backend instance and consolidates (the
    microservices spike in `services/` was abandoned, in-process crons chosen over separate
    Render crons for exactly the credential/duplication reasons documented in `bootstrap.js`).
- **Deployment impact**: +2–3 services, +DB, +secrets management.
- **Authentication**: new system or federation — highest-risk element.
- **Authorization**: greenfield (no reuse).
- **Database ownership**: clean separation but loses FKs; PII references require API contracts.
- **API coupling**: high (every campaign/lead touch is a network call with auth).
- **Dev complexity**: high. **Ops complexity**: high. **Migration risk**: low for MKTR code, high
  for delivery. **Maintainability**: good isolation, poor economy at this team size.

## Comparison summary

| Dimension | A — new surface (same app) | B — sibling frontend | C — separate service |
|---|---|---|---|
| Time to V1 (3 staff daily use) | **Fastest** | Medium | Slowest |
| Reuse of proven infra | **Maximal** | Backend only | Minimal |
| Campaign/Lead integrity | **DB FKs** | DB FKs | API contracts + sync |
| New auth work | **None** | None | New system |
| Deploy/ops overhead | **None → +1 static site** | +1 build pipeline | +2–3 services |
| Boundary enforcement | Convention + review | Filesystem | Network |
| Extraction path later | Module seam exists | Same seam | Already extracted |
| Fits repo precedent | **Yes (two-brand pattern)** | Partially | No (spike abandoned) |

## Recommendation

**Option A**, with these boundary commitments (detailed in `RECOMMENDED_ARCHITECTURE.md`):

1. Backend namespace `redeemOps*` (routes flat per auto-loader; controllers/services under
   `controllers/redeemOps/` and `services/redeemOps/`), all mounts flagged `REDEEM_OPS_ENABLED`
   (default off).
2. Own table set (partner_*, reward_*, activations, redemptions, redeem_ops_audit_events) —
   MKTR tables referenced by FK, never written except via existing MKTR services.
3. Own authorization layer (`redeemOpsRole` + capability middleware) that cannot loosen any
   existing MKTR gate.
4. Surface exposure via the existing brand/surface build mechanism, targeting **ops.redeem.sg**
   as a third static site; mktr.sg `/redeem-ops/*` used only as the flagged dogfood entry before
   cutover.
5. Option C's seam is preserved deliberately: if extraction is ever justified, the module +
   its tables + `/api/redeem-ops/*` contract lift out; nothing in Phase 1–6 may blur that seam
   (e.g. no MKTR service importing Redeem Ops services — dependency direction is one-way,
   Redeem Ops → MKTR).

Option B is rejected as premature duplication; Option C is rejected as infrastructure the product
does not need and the team's own history argues against. Do not implement until
`RECOMMENDED_ARCHITECTURE.md` is accepted.
