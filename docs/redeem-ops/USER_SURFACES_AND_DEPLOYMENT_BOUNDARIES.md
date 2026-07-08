# Redeem Ops — User Surfaces and Deployment Boundaries

> Phase 0 deliverable (addendum §5). The domains below are **intended product boundaries**. The
> technical realization — one SPA codebase compiled per surface, one backend, one database — is
> deliberately shared; see `ARCHITECTURE_OPTIONS.md` for why domain separation here does not mean
> repository/service separation.

## 1. Surface map

| User Type | Intended Surface | Responsibilities | Canonical Data Access |
|---|---|---|---|
| MKTR Campaign Operator | Existing MKTR Platform (`mktr.sg`) | Create/manage campaigns, designer, launch workspace, QR/short links, tracking & pixel config | MKTR Campaign domain (full R/W via `requireRole('admin')`) |
| MKTR Lead Ops | Existing MKTR Platform (`mktr.sg`) | Lead management, routing, held queue, packages, agents, commissions | MKTR Lead domain (full R/W via existing role gates) |
| Redeem Internal Staff | **`ops.redeem.sg`** (new; interim dogfood at `mktr.sg/redeem-ops`) | Partner prospecting/CRM, claiming, tasks, pipeline, onboarding, Reward Offers, inventory, Activations, entitlement/redemption ops, partner analytics, renewal | Redeem Ops domains (R/W per capability) + **limited read-only MKTR references** (campaign projection, lead reference for entitlements) |
| External Partner Business | **`partners.redeem.sg`** (future — designed, not built) | View own org/offers/locations/quantities, verify redemptions, limited performance, renewal requests | **Strictly partner-scoped** Redeem data via separate principal table + token scope; zero MKTR access; zero lead PII |
| Consumer | `redeem.sg` (existing; per-campaign `mktr.sg` opt-in) | Campaign participation, lead capture, OTP, (future) reward claim/redemption journey | Public/consumer-scoped flows only (`/LeadCapture`, `/t/:slug`, `/p/:slug`; future `/r/:token`) |

## 2. How each surface is served (technical realization)

| Surface | Serving mechanism | Build flag | API path allowance (enforced server-side) |
|---|---|---|---|
| mktr.sg | Existing Render static site `mktr-platform` | `VITE_BRAND=mktr` (+ `VITE_REDEEM_OPS_ENABLED` for the interim `/redeem-ops` dogfood group) | Everything except future partner-portal namespace |
| ops.redeem.sg | **New third Render static site**, same repo/commit, relative `/api` proxy → api.mktr.sg | `VITE_SURFACE=ops` (new flag, built in Phase 1) | `/api/auth/*`, `/api/redeem-ops/*`, notifications; `/api/admin/*` and other internal namespaces **403 at the host layer** via the extended guard's ops-host allow-policy (`RECOMMENDED_ARCHITECTURE.md` §5) — roles/capabilities remain the primary gate |
| redeem.sg | Existing Render static site `redeem-frontend` | `VITE_BRAND=redeem` | Public capture/verify/tracker only — internal APIs 403 via `internalRouteHostGuard` (extended with `/api/redeem-ops`) |
| partners.redeem.sg (future) | Future static site (same mechanism) | future `VITE_SURFACE=partner` | Only future `/api/partner-portal/*` (distinct token scope); all internal namespaces blocked |
| api.mktr.sg | Single existing backend `mktr-backend-jo6r` | — | Serves all of the above; host + role + capability are three independent gates |

## 3. Boundary enforcement layers (per surface pair)

Reusing the proven D13 three-layer pattern:

1. **Build-time**: a surface's bundle only contains its own routes. `VITE_BRAND` is the **verified**
   mechanism (the redeem build demonstrably excludes admin code); `VITE_SURFACE` is **proposed new
   work** that replicates it for the ops surface (`vite.config.js` resolves only `VITE_BRAND`
   today).
2. **Edge**: Render redirect rules on consumer/partner sites bounce internal paths (as
   redeem-frontend does today with 16 rules).
3. **Backend**: `internalRouteHostGuard` (host allowlist) + `authenticateToken` +
   `requireRedeemOps(capability)` / `requireRole` — the only layers that actually count for
   security. Host checks never *grant* access, they only narrow exposure; capabilities are the
   real gate.

## 4. Data-access boundaries (canonical statements)

- **Campaign data** crosses into Redeem Ops only as: `activations.campaignId` FK, the read-only
  projection endpoint (id, name, status, type, customer URL, created), and read-only metric
  aggregates (`computeCampaignMetrics`). Editing links back to mktr.sg
  (`/admin/campaigns/:id/workspace`).
- **Lead data** crosses into Redeem Ops only as: `reward_entitlements.prospectId` FK and
  server-side joined display fields (name, masked contact) for staff with the relevant capability.
  No lead PII is stored in Redeem Ops tables; partners never see lead datasets.
- **Financial-planning information** (lead outcomes, `leadStatus` progression, CAPI signals) is
  never exposed on ops partner views or the future partner portal.
- **Consent** stays owned by MKTR capture (`prospects.consentMetadata`); Redeem Ops reads it when
  issuing entitlements (Phase 6) and never mutates it.
- **Redeem Ops data** (partners, rewards, redemptions) is invisible to MKTR surfaces in V1; the
  future partner portal sees only rows where `partnerOrganisationId` matches its token scope.

## 5. Session/identity boundaries

- Internal staff (MKTR operators and Redeem staff) share one identity system (`users` + JWT
  cookie). Cookies are host-only + SameSite=strict, so each surface has an independent session;
  authorization — not the session — decides what a user can do (`PERMISSION_MATRIX.md`).
- Future partner users are a **separate principal population** (`partner_users`, distinct token
  scope) — a partner credential can never authenticate against staff namespaces, and staff tokens
  are not honoured by the partner namespace.
- Consumers are unauthenticated (phone-OTP-verified per submission, not sessioned).
