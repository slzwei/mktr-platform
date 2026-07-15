# Redeem Ops (scoped context)

> This file loads only when you're working under `src/pages/redeemops/`. It
> carries redeem-ops-specific context that would otherwise ride along on every
> unrelated mktr-platform session. General pipeline/brand context → `../../../CLAUDE.md`.

**What it is:** an internal operations console for the Redeem side — partner CRM
(claim/dedupe), tasks / pools / queue, rewards + inventory ledger, activations→campaign
linkage, review-gated vouchers + redemptions, analytics, Discover (partner sourcing),
and Outreach-style cadences. **Not** customer-facing.

**Live since 2026-07-09** at `ops.redeem.sg` (4th Render static site `redeem-ops-frontend`,
`VITE_SURFACE=ops`) **and** `mktr.sg/redeem-ops`. Shipped as Phases 1–7 in PRs #93–#101.

## Where the code lives

| Layer | Path |
|---|---|
| Pages | `src/pages/redeemops/` (this dir) |
| Components / UI kit | `src/components/redeemops/` (`ui.jsx`, `cadence.jsx`, `RedeemOpsLayout.jsx`, `CadenceStudio.jsx`, …) |
| Route guard | `src/components/auth/RedeemOpsRoute.jsx` |
| Permissions | `src/lib/redeemOpsPermissions.js` (+ drift test `src/lib/__tests__/redeemOpsPermissionsDrift.test.js`) |
| API client | `src/api/redeemOps.js` |
| Backend | **shared** `backend/` — routes/services live alongside the main pipeline, not in a separate service |
| Design docs | `docs/redeem-ops/`, `docs/plans/redeem-ops-*.md` |

## Conventions & gotchas

- **UI language = Fresha** (PR #99). Design system "Redeem Ops Design System" on claude.ai/design. DesignSync gotcha: write `_ds_manifest.json` directly — `register_assets` doesn't update it.
- **Feature flags** gate most surfaces. `REDEEM_OPS_CADENCES_ENABLED` + `VITE_REDEEM_OPS_CADENCES_ENABLED` (cadences), plus a still-off **entitlements** flag. Discover is flag- + `APIFY_TOKEN`-gated. Check flag state on the live deploy before assuming a feature is on.
- **ops.redeem.sg** needs Render rewrites; its Cloudflare CNAME must be **DNS-only** (not proxied).
- **Google login on the ops origin** derives `redirect_uri` from the request origin; the Google OAuth client lives in the GCloud project **"MKTR Platform"** (not "MKTR Leads").
- **Discover**: Apify-backed partner sourcing with enrichment loop, fuzzy dup badge, category fail-fast, profile quotas, retention purge; AI keyword suggest is live. IG-hashtag discovery is a separate pilot behind `DISCOVERY_IG_ENABLED`.
- **Cadences**: Outreach-style sequencing engine; AI drafts live (both flags on). P2 = pool/Discover claim-and-enroll.
- **Testing backend**: run jest from `backend/` with a throwaway pg on 5433 (`unix_socket_directories=''`). `sync({force:true})` clobbers migration indexes → declare partial-unique indexes on the models too.

For live deploy state, flag values, and the running project log, see the
`project_redeem_ops` auto-memory (it's the source of truth for what's shipped vs dark).
