# MKTR Admin redesign — repo reconciliation (2026-07-15)

> **STATUS: DESIGN FINAL (verified 2026-07-15).** The fix round below was
> applied by the design conversation and diff-verified: AI Settings redesigned
> to the real shape (defaultProvider, per-provider model, encrypted keys shown
> as last-4 hints w/ Replace key, guardrails + workstyle textareas; invented
> scoring/call-bot/tagging → wishlist); Agent Groups reduced to name/
> description/members + computed funded-vs-wallets count; Users shows real
> Admin role only (invited + last-active kept — both real); Design System
> assumptions 13–16 added (quarantineReason DTO alias, overview extension,
> single-value filters + no sort param today, wallets external-only v1) and
> the three invented concepts parked in the wishlist. mock-api.js updated to
> match on all three shapes. One implementation note: the mock's staff key is
> `lastActiveAt` — map from `users.lastLogin` in the DTO, same pattern as
> heldReason/quarantineReason. Next artifact: combined implementation plan
> (wallet backend → admin rebuild → fleet teardown) + Codex review.

Design project `57e68763-9fd1-47ed-b5f9-14224a016ff4` ("Switchboard" direction):
`MKTR Admin.dc.html` (all 11 routes + stubs), `MKTR Mobile.dc.html` (approved
round 2), `Design System.dc.html`, `mock-api.js`. Reviewed against the live
repo. Verdict: **strong — one design fix round needed (3 screens contain
invented features), plus a net-new backend inventory for the implementation
plan.**

## Verified correct against the repo (no change)

- Prospect enums exact: leadSource (8 values incl call_bot), leadStatus (8),
  priority, score(0–100 nullable), lastContactDate, conversionDate,
  sourceMetadata.utm (fb/ig/tiktok/an/msg), qrTag label join.
- Held semantics: quarantinedAt + reasons no_funded_agent/dnc_pending/
  dnc_registered ✓ — AND the real list API already supports the design's
  filters via `assignment: 'held'|'unassigned'` (unassigned = not assigned AND
  not held — matches the design's definition exactly), plus search, leadStatus,
  leadSource, campaignId, page/limit (prospectService.listProspects).
- Campaign fields: name/status(draft|active|paused|completed|archived)/type/
  min_age/max_age/start_date/end_date/is_active + slug + marketplaceListed +
  luckyDraw (with the appendix-10 YYYY-MM-DD SGT parse rule) — all real.
- QR tags: label/campaignId/scanCount/uniqueScanCount/lastScanned/active ✓.
- Short links: maps cleanly — short→slug, target→targetUrl, clicks→clickCount;
  `active` derivable as !expired (expiresAt) ; lastClickedAt also available.
- Users: `lastLogin` (→ "last active") and invited-state (invitationToken set,
  no login) are REAL and derivable. Only the 'Ops' ROLE is invented (below).
- Wallets & Commitments screens are 1:1 with docs/plans/
  agent-wallet-commitments.md: ledger types topup|commit|takedown_refund|
  adjustment, mandatory-note manual adjustment (working in the prototype),
  read-only commitments, no buying UI, no self-cancel. Top-ups "via agent app".
- Interaction contract + honesty rules fully satisfied: period recompute,
  filters as removable chips, sort, pagination, bulk bar (actions
  static-toasted), drawer, working CSV export, theme toggle w/ accent
  variants, demo modes (normal/quiet-day/API-error), latency knob,
  seq-guarded fetches, labeled stubs preserving query state.

## Design fixes required (one round)

1. **AI Settings screen is fiction (MAJOR).** The design invents lead-scoring
   (model/threshold/auto-priority), a call-bot (greeting/hours) and tagging
   taxonomy. The REAL AiSettings row is: defaultProvider (openai|anthropic),
   openaiModel/anthropicModel, encrypted API keys with last-4 hints,
   globalGuardrails (text), workstylePreferences (text). → Redesign the screen
   around key management + provider/model + guardrails; move scoring/call-bot/
   tagging to the proposed-metrics wishlist.
2. **Agent Groups invents fields (MEDIUM).** Real AgentGroup = id/name/
   description/createdBy + members join. No isActive ("Round-robin on" chip)
   and no campaign linkage (campaignNames). Groups today are named agent
   collections used as pickers. → Row = name, description, member count,
   funded-member count (computed vs wallets); campaign linkage + on/off →
   wishlist.
3. **Users 'Ops' role doesn't exist (SMALL).** Real staff roles today: admin
   (agent/driver/fleet_owner are not back-office staff; fleet roles are being
   retired). → Show real role chips (Admin; render others as-is if present),
   keep Invited (real) + last active (lastLogin). An 'ops' staff role is a
   product proposal → wishlist.
4. **Appendix additions:** (a) real column is `quarantineReason` — heldReason
   is a display alias the DTO provides; (b) the real overview endpoint today
   returns prospects {total(all-time!), new} only — assigned/converted/
   conversionRate + period-scoped totals are the backend extension named in
   the net-new inventory; (c) status/source filters are single-value on the
   real API today (multi-select needs comma-list support) and there is no
   `sort` param yet; (d) wallets exist for EXTERNAL (mktr-leads) agents only
   in v1 — internal agents render "—" in wallet columns until migrated.

## Net-new backend inventory (feeds the implementation plan)

| Piece | Status |
|---|---|
| Overview extension: period-scoped assigned/converted/conversionRate (+ decide total semantics) | extend `dashboardService.getAdminStats` |
| Dashboard aggregates: attention queue (held by reason, unassigned, zero-commit campaigns, wallets zero/low, draws ≤7d, webhook health), daily lead series, funnel | new `GET /api/dashboard/attention` + `/series` + `/funnel` (or one composite) |
| Webhook health aggregate (failedLast24h/pending/subscriberDisabled) | aggregate over existing per-subscriber stats |
| listProspects: `sort` param + comma-list leadStatus/leadSource | small extension |
| Campaign list/detail aggregates: leadsThisPeriod/leadsTotal/qrTagCount + committedRemaining/committedValueCents + commitments rows + 30d series + recent leads | extend admin campaign endpoints; committed* comes from the wallet build |
| Wallets admin endpoints (list w/ balances+commitments, ledger, manual adjustment w/ note) | already scoped in agent-wallet-commitments.md — the design consumes exactly that contract |
| Agents roster: assignedThisPeriod/lastAssignedAt aggregates | small extension |
| AI Settings | real page/model already exist — reskin only after design fix |
| Fleet/commissions/app-versions teardown | phase one of the rebuild (new IA has no slots for them) |

## Sequencing note

The admin rebuild depends on the wallet/commitments backend for: Wallets &
Commitments screens, committed-demand tiles/badges, zero-commitment incidents,
and Agents wallet columns. Implementation order: wallet backend (external
agents) → admin rebuild consuming it → fleet teardown rides the rebuild.
