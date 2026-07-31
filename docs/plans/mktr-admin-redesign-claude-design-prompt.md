# MKTR Admin redesign — claude.ai/design prompt (self-contained)

Paste the block below into a NEW claude.ai/design conversation (fresh project —
don't reuse the Redeem.sg one). Deliberately self-contained: NO codebase is
attached, so this document is the designer's only source of truth. Written
2026-07-15, grounded in the live admin (field names/enums verified against the
real API models at that date).

---

Design a complete redesign of the **MKTR admin dashboard** — the operator
cockpit of a Singapore lead-generation platform (mktr.sg). Produce an
interactive prototype plus a design-system reference, the same way you'd hand
off to an engineering team that will rebuild the surface in place.

This brief is your ONLY source of truth — no codebase or screenshots are
attached, deliberately, so nothing biases the visual direction. Everything you
need (data contracts, scale, vocabulary, tasks) is below. Where something is
genuinely unspecified, make the best-UX choice and record it in a short
"Assumptions" list rather than asking.

## What MKTR is

MKTR PTE. LTD. runs a lead-gen machine for insurance/financial-advisory
distribution in Singapore: consumers scan campaign QR codes or land on
redeem.sg campaign pages, submit an OTP-verified form, and leads are
round-robin-assigned to agents who buy lead credits. The admin surface is the
OPERATOR side: a small staff team (admin + a few ops people) lives here daily.

**Design language: start from a blank page.** The current admin is a dark,
terminal-flavoured theme — you are NOT bound by it, its colors, its typography,
or any legacy visual decision. Invent an entirely new language: **bright,
fresh, energetic, confident** — a modern operations tool that feels fast and
alive, not another dark-mode SaaS clone and not a sterile gray dashboard
template. The only brand givens: it's called MKTR, it's a professional tool,
and it must feel clearly distinct from the company's consumer brand (Redeem —
a warm cream/pine editorial look you should actively avoid resembling).

## Domain glossary (use this vocabulary on-screen)

- **Prospect / lead** — a consumer who submitted a campaign form (OTP-verified
  phone). The core object of the whole business.
- **Campaign** — a lead-capture funnel with its own landing page, QR codes and
  targeting. Types: regular (QR/web form), quiz (personality quiz funnel),
  guided review (long-form editorial funnel).
- **Round-robin assignment** — new leads auto-assign to the next agent with
  lead credits for that campaign.
- **Lead package / credits** — agents pre-purchase lead allocations; an agent
  with 0 credits stops receiving leads (an operator problem worth surfacing).
- **Held / quarantined lead** — captured but NOT delivered: either no funded
  agent was available (`no_funded_agent`) or it's pending a Do-Not-Call
  registry decision (`dnc_pending` / `dnc_registered`). Operators triage these.
- **DNC** — Singapore's Do-Not-Call registry. Registered numbers need explicit
  consent evidence before agents may call.
- **Lucky draw** — campaign variant where a verified signup = 1 draw entry;
  completing an activation step before a boost deadline multiplies it (e.g.
  ×10). Draws have a close date and winners.
- **Marketplace listing** — campaigns can additionally be published on the
  consumer marketplace (redeem.sg/offers/…) with a slug + capacity from a
  partner-funded reward.
- **Webhook delivery (Lyfe)** — every assigned lead is delivered to an external
  mobile app (Lyfe) via signed webhooks with retries; failures are an incident.

## Scale & realism (seed the mock to feel like this)

- ~9 active campaigns, ~3 archived at any time. Real campaign-name flavour:
  "Tokyo Getaway Lucky Draw", "Redeem a 20\" Cabin Luggage", "Redeem $10
  Fairprice Voucher", "No Ceiling Career Quiz", "Pre-natal Campaign",
  "One Night Pet Hotel Stay".
- Lead volume: tens per day on a good campaign; hundreds per month total.
  Conversion (won) in low single-digit % of total.
- 10–30 agents, a handful with 0 credits at any moment; 1–3 held leads on a
  typical morning, more after a big ad push.
- Dozens of QR tags across live campaigns.
- Singapore context: SGD currency, +65 8-digit mobiles (8/9 prefix), SGT
  timezone, local names (Tan, Lim, Nurul, Rajesh…).

## Data contract (field names verified against the real API — seed mock-api.js 1:1)

**`GET /dashboard/overview?period=7d|30d|90d`** →
`{ prospects: { total, new, assigned, converted, conversionRate },
   campaigns: { total, active } }`

**Prospect** (the lead row/drawer):
`id (uuid)`, `firstName`, `lastName`, `email`, `phone (+65…)`,
`leadSource: qr_code|website|referral|social_media|advertisement|direct|call_bot|other`,
`leadStatus: new|contacted|qualified|proposal_sent|negotiating|won|lost|nurturing`,
`priority: low|medium|high|urgent`, `score (0–100, nullable)`,
`campaignId`→campaign name, `assignedAgentId`→agent name (nullable =
unassigned), `qrTagId (nullable)`, `quarantinedAt (nullable)` +
`heldReason: no_funded_agent|dnc_pending|dnc_registered`,
`sourceMetadata.utm { utm_source, utm_medium, utm_campaign }` (ad attribution;
utm_source values: fb, ig, tiktok, an, msg), `createdAt`, `lastContactDate`,
`conversionDate`, `notes`, consent flags (contact/terms/third-party booleans).

**Campaign**:
`id`, `name`, `status: draft|active|paused|completed|archived`,
`type: lead_generation|quiz|guided_review`,
`start_date`, `end_date`, `min_age`, `max_age`, `is_active`,
`leadsTotal`, `leadsThisPeriod`, `qrTagCount`, `slug (nullable)` +
`marketplaceListed (bool)` — marketplace state, `luckyDraw { enabled,
closesAt, boostClosesAt, multiplier, winners } (nullable)`.

**Agent**: `id`, `name`, `email`, `phone`, `isActive`, `creditsRemaining`,
`assignedThisPeriod`, `lastAssignedAt`.

**QR tag**: `id`, `label`, `campaignId`, `scanCount`, `uniqueScanCount`,
`lastScanned`, `active`.

**Webhook delivery health**: `{ pending, failedLast24h, subscriberDisabled
(bool) }` — failures/disabled are incidents to surface.

Numbers on screen must be DERIVED from this mock data — no hardcoded values in
components. Anything you wish existed beyond these shapes goes in a clearly
marked "proposed metrics" wishlist, never on the default screens.

## Information architecture (keep the routes; you MAY regroup/rename sections)

- Overview: Dashboard
- Lead Generation: Prospects · Agents · Agent Groups · Campaigns · Lead
  Packages · QR Codes · Short Links
- System: Users · AI Settings
- Topbar: global search (⌘K), theme toggle, notifications
- (A separate flag-gated staff surface, "Redeem Ops" partner CRM, is out of
  scope — don't design it, don't remove its existence.)
- Note: legacy Fleet/Devices/Commissions/App-Versions sections are being
  retired — do NOT design for them or leave placeholder slots.

## The operator's top tasks (design placement around THESE)

1. **Morning health check (daily, 30 seconds):** anything held? any agent out
   of credits? any webhook delivery failing? what came in overnight and from
   which campaign/ad source?
2. **Lead lookup (many times daily):** find a lead by phone/name fast, see its
   full story (source, ad attribution, status history, assigned agent, consent
   state) without leaving the list.
3. **Triage held leads:** see why held (no funded agent vs DNC), release or
   reassign in bulk.
4. **Campaign pulse:** which campaigns drove this week's leads; is a draw
   closing soon; is a marketplace listing running low on capacity.
5. **Agent supply management:** who is low on/out of credits, who's absorbing
   the most leads.
6. **Period reporting:** eyeball 7/30/90-day trends and export a CSV.

**Today's dashboard fails these** — it's 5 generic stat cards with a period
picker. A scoreboard, not a cockpit. Nothing says what needs attention.

## Design goals (in priority order)

1. **Dashboard = operator cockpit, not scoreboard.** One screen answers: is
   the machine healthy, what came in today, what needs my action? Think:
   "needs attention" queue (held/DNC leads, unassigned leads, agents out of
   credits, failing webhook deliveries, draws closing / campaigns ending),
   lead-flow sparkline (today vs trailing period), live funnel
   (scans → submits → assigned → won), recent-leads stream with source + agent,
   campaign leaderboard for the period.
2. **A design system for the whole admin**, not just one page: nav, page
   header pattern, KPI tiles, data tables (dense, sortable, bulk-select,
   status chips), detail drawer/page pattern, forms, empty/loading/error
   states, confirmation patterns. The rebuild rolls out page by page — old and
   new pages must coexist without jarring.
3. **Bright and light-first** — a fresh, optimistic palette with real color
   used purposefully (status, trends, attention), generous but disciplined
   whitespace, crisp type hierarchy. Ship a dark mode in the token system as
   the secondary theme, but design light-first. Keyboard-friendly, fast to
   scan on a 13" laptop; tabular numerals or mono for ids/numbers/timestamps.
4. **A brand-new visual identity**, invented for this surface. Explore before
   settling: bring 2–3 genuinely different directions for the design-system
   pass (e.g. airy editorial-meets-data, saturated color-block energy, soft
   depth with vivid accents) and recommend one. Avoid default-shadcn gray and
   generic dashboard-template looks.

## Deliverables

1. **Interactive prototype**: the Dashboard home, the Prospects table (with a
   lead detail drawer), and a Campaign detail/overview screen — wired to a
   `mock-api.js` seeded exactly per the data contract above.
2. **Design-system reference doc**: tokens (color/type/spacing/radius, light +
   dark), component inventory with variants (buttons, chips, tables, tiles,
   drawers, toasts), layout grid — with a Tailwind/shadcn mapping note per
   token so implementation is mechanical.
3. **A data-contract appendix**: per widget, exactly which field feeds it,
   plus the "proposed metrics" wishlist and your Assumptions list.

## Layout efficiency & UX standards (non-negotiable)

Every screen must be defensible against these:

- **Priority placement**: the most consequential information sits where the eye
  lands first (top-left → F-pattern). Dashboard order: health/attention signals
  first, then today's flow, then period trends, then leaderboards. Nothing
  critical below the fold at 1366×768.
- **One clear primary action per screen**, visually singular; secondary actions
  recede. Actions live next to the content they act on, never orphaned in a
  distant toolbar.
- **Grouping by proximity**: related controls, filters and their result sets
  form obvious clusters (Gestalt proximity/common region); unrelated content is
  separated by structure, not just gaps.
- **An 8pt spacing grid** applied consistently; a single content max-width
  rhythm per breakpoint; aligned edges everywhere (no ragged panels).
- **Progressive disclosure**: dense tables summarize, drawers elaborate;
  advanced filters collapse; nothing forces a full-page context switch for a
  glanceable answer.
- **Zero dead zones**: no decorative filler panels, no stat tiles that answer
  no operator question. If a widget can't name the task (above) it supports,
  cut it.
- **Status legibility**: state is never conveyed by color alone — pair color
  with icon/label; WCAG AA contrast in both themes; visible focus states;
  44px minimum interactive targets.
- **Recognition over recall**: persistent labels over icon-only controls,
  filters show their active state as removable chips, empty states teach the
  next action.
- **Latency honesty**: skeletons match final layout (no reflow jumps), row
  counts and "updated Xs ago" stamps on live data.

## Interaction contract — these must actually WORK in the prototype, not be painted on

- Sidebar navigation between the three screens (hash routing), with active state
- Dashboard period picker (7d/30d/90d) recomputes every tile, sparkline and
  leaderboard from mock-api data — no hardcoded numbers in components
- "Needs attention" queue items click through to the relevant screen,
  pre-filtered (e.g. held leads → Prospects filtered to held)
- Prospects table: working sort, status + source filters, text search,
  row click opens the lead detail drawer (real fields from the mock),
  bulk-select with a visible action bar, pagination
- Campaign screen: status chip reflects mock state; leads-over-time chart
  reads the mock series
- Dark/light theme toggle that actually switches tokens
- Loading skeletons on simulated fetch latency (~500ms) + one empty state
  and one error state reachable via demo controls
- Demo hints pattern (small dashed badges) wherever a demo rule exists

Anything not listed may be static — but say so explicitly in the prototype
(a small "static in this prototype" note), never silently.

## Hard constraints

- Every widget maps to the data contract; proposed metrics go in the wishlist,
  never on the default screens.
- Keep the sidebar ROUTES stable (regrouping/renaming ok) — deep links are
  bookmarked by staff.
- Tables must handle 10k+ rows (pagination/virtualization patterns, not
  show-everything).
- Desktop-first (1280–1680px primary), tolerable at 1024; mobile is view-only
  triage, not parity.
- Implementable in React + Tailwind + shadcn/ui with recharts — no bespoke
  chart engines, no heavy animation. Respect prefers-reduced-motion.
- Singapore timezone everywhere; currency SGD.

Start with the 2–3 design-language directions plus the Dashboard home built in
the direction you recommend — show me that before building out the other two
screens.

---

## Follow-up change-order prompt (sent after the fleet/commissions/app-versions drop, 2026-07-15)

Use this in the SAME design conversation if the initial prompt was pasted
before the scope narrowing; the main prompt above is already scrubbed.

> Change order — the product scope has narrowed. Apply these UI changes across
> everything you've produced so far (and everything you produce from here)
> before we finalise:
>
> REMOVE ENTIRELY — we are retiring these product areas: sidebar items Fleet
> Management, Vehicle Fleet, Fleet Map, Tablet Devices, Finance → Commissions,
> System → App Versions. Final sidebar IA: Overview (Dashboard) · Lead
> Generation (Prospects · Agents · Agent Groups · Campaigns · Lead Packages ·
> QR Codes · Short Links) · System (Users · AI Settings). Remove dashboard
> widgets fed by the removed areas (Fleet Size, Ad Impressions, device
> online/offline, commissions tiles, offline-device attention items). Delete
> the Device entity + fleet/impressions/commissions fields from mock-api.js and
> the data-contract appendix; remove the PHV campaign type everywhere.
>
> Rules: no placeholders or "coming soon" slots — zero trace; re-balance every
> affected layout (no dead zones; re-check F-pattern priority after reflow);
> update the design-system doc + data-contract appendix to match. The operator
> story is now purely campaigns → QR/web lead capture → wallet/credit-funded
> agents → delivery. Show the updated Dashboard home first; implementation
> starts only after the full UI is finalised, so nothing needs backward
> compatibility with the old screens.

---

## Follow-up change-order #2 (wallet/commitment charging model, 2026-07-15)

Sent after the agent-wallet decision (docs/plans/agent-wallet-commitments.md):
replaces the lead-packages mental model in the design with wallets +
per-campaign commitments. Key instructions: sidebar "Lead Packages" →
"Wallets & Commitments" (balances, ledgers, manual adjustment w/ note);
agent contract walletBalanceCents + openCommitments; campaign contract
leadPriceCents + committedRemaining/committedValueCents; committed demand
surfaced as pre-sold revenue on campaign detail + dashboard; attention items
= low/zero balances + active campaigns with zero commitments; vocabulary
wallet/credits/commitment/top-up/takedown-refund (retire "package"); NO
agent-facing storefront in the admin (buying lives in the mktr-leads app).

> **NOTE (2026-07-15, later):** the two change-orders above were consolidated
> into ONE combined prompt (fleet/commissions/app-versions removal + wallet/
> commitment model + final IA with "Wallets & Commitments" replacing Lead
> Packages) and that single version is what was actually sent to the design
> conversation. Treat the combined semantics as canonical.
