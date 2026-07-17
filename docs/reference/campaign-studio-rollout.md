# Campaign Studio — rollout runbook (PR 5)

> The charter (implementation prompt, PR 5): *enable Studio for admins → migrate
> one low-stakes campaign → screenshot-diff → soak → migrate the rest → retire
> the old DesignEditor in a follow-up teardown PR.* This file is that checklist,
> committed. Every step is reversible; capture evidence at each gate.

## The two flags

| Flag | Where | Effect |
|---|---|---|
| `VITE_CAMPAIGN_STUDIO_ENABLED=true` | **mktr-platform static site only** (`srv-d2s3che3jp1c738qlgjg`) — build-time env + redeploy | Registers `/admin/campaigns/:id/studio` and swaps the workspace Design tab entry. redeem/ops builds stay flagless (their admin routes are guard-neutralized anyway). |
| `DESIGN_CONFIG_V2_WRITES_ENABLED=true` | `mktr-backend-jo6r` (`srv-d2s9p0emcj7s73acd9lg`) env | The server accepts version-tagged design_config writes. Read per-call — inert until a Studio save happens. |

**Order matters:** frontend flag first (Studio usable, saves 422 with the typed
writes-gated banner — expected), backend flag second. **Renderer dispatch is
version-driven, NOT flag-gated** — a v2 doc renders through the new path the
moment it exists, so the real commitment point is the first migrated campaign,
not either flag.

## Per-campaign migration loop

Prod inventory at PR 5 time: 16 campaigns, all v1 (9 active + 3 draft +
3 archived lead_generation; 1 draft guided_review which is OUT of Studio scope
and keeps the classic designer). Archived campaigns can stay v1 forever.

For each campaign, in order (drafts first, then ONE active + soak, then the rest):

1. **Snapshot** the stored doc (rollback input — keep the file):
   `SELECT design_config FROM campaigns WHERE id = '<id>'` → `snapshots/<id>.json`.
2. **Offline screenshot-diff** (zero prod traffic; the v2 side is the EXACT
   prospective server-clamped doc):
   ```
   VITE_BRAND=redeem VITE_API_URL=/api npx vite build --outDir dist-parity
   npx vite preview --outDir dist-parity --port 4319 --strictPort &
   node scripts/campaignPageParity.mjs 4319 /tmp/parity-<id> \
     --v1-doc snapshots/<id>.json --name <slug-or-id>
   ```
   **Hard gate** (nonzero exit): the v2 render failed to mount — never migrate
   that campaign until understood. The v1↔v2 PNG pair + pixel numbers are the
   HUMAN review artifact: expect the signed-off PR 2 form-section delta
   (edu/salary render-but-discard fields hidden, required-label truth — the
   page gets shorter); hero/story/chrome should match closely; anything else =
   stop and investigate. `parity-report.json` goes in the migration log.
3. **Migrate**: open the campaign in the Studio → Save (the Save button is
   enabled even with no edits — the no-edit save IS the migration; ⌘S works too).
4. **Confirm**: `SELECT design_config::jsonb->>'version' FROM campaigns WHERE id='<id>'`
   → `2`; spot-load the live lead-capture page.
5. **Active campaigns only — soak**: watch that campaign's `prospects` inserts,
   OTP verify rate, CAPI events and DNC behavior for the agreed window
   (default 24h) before migrating the rest.

## Rollback

- **Per campaign** (the only rollback that matters): restore the snapshot via
  the admin API with the explicit override —
  ```
  PUT /api/campaigns/<id>
  { "design_config": <snapshot JSON>, "confirmDesignRollback": true }
  ```
  Plain saves of a v1 doc over a stored v2 doc are 409-blocked by design
  (`DESIGN_CONFIG_VERSION_CONFLICT` protects against the classic editor); the
  flag is admin-only, audit-logged (after the write succeeds), and flows
  through the normal v1 clamp + draw invariants + marketplace-cache
  invalidation. Do NOT restore via raw SQL — it skips those side effects.
  **Merge semantics**: the admin policy applies — a snapshot that OMITS an
  admin subtree (`luckyDraw` / `featuredDrop`) PRESERVES the stored one, so a
  draw enabled after migration survives the rollback (its terms re-pin from
  the snapshot's `termsContent`; an empty-terms snapshot 422s with
  `DRAW_TERMS_REQUIRED` — that guard is correct). Disable the draw via ops
  first if the intent is full removal.
- **Flags**: both revert one-click, BUT flag-off is NOT a rollback for
  already-migrated campaigns — they keep rendering v2 (version-driven) and the
  classic editor shows them read-only. Roll campaigns back individually first
  if a full retreat is needed.

## Verification habits (push ≠ live)

Static-site flag flips are build-time: confirm a NEW deploy went live (Render
`list_deploys`), then verify behavior in a real browser (Playwright probe:
`/admin/campaigns/<id>/studio` renders the Studio for an admin session; while
the backend flag is still off, a save shows the typed "server has not enabled
Campaign Studio saves yet" banner).

## After the soak

Migrate the remaining non-archived campaigns (same loop), then the follow-up
**teardown PR**: retire the classic DesignEditor + `/AdminCampaignDesigner`
route, and drop `useStudioDoc`'s message-regex draw-422 fallback (typed codes
shipped in PR 5).
