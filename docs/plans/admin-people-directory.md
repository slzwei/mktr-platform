# People directory — the deduplicated person list at `/AdminPeople`

**Status:** scoped 2026-07-26 · Codex-reviewed twice (gpt-5.6-sol xhigh — R1: 20
findings/RETHINK → rewritten; R2: 9 findings/AMEND → amended; dispositions in §8) ·
open questions resolved with Shawn 2026-07-26 (§7) · **SHIPPED 2026-07-26: #278
(`a90407d`) + #279 (`efd33cc`) both merged and deploy-verified live** — backend
/api/consumers 401s on prod origin, AdminV2People lazy chunk serves its markers; CI's
unit step is green for the first time in weeks (§5 step-5 outcome note records the
inherited 5-suite integration follow-up) · No Claude Design pass: the page
composes entirely from shipped admin-v2 idioms (contrast the Lead Profile, a new page
type that warranted one); revisit only if a v2 grows into a people workspace
**Surface:** new admin-v2 list page `/AdminPeople` + new endpoint `GET /api/consumers`
**Direct ancestor:** data-powerhouse audit P1 #6 first half — "Consumer search + list API/UI
(phone → person)" (`docs/reference/data-powerhouse-readiness-audit-2026-07-20.md:235-236`);
explicitly named out-of-scope by the Lead Profile plan
(`docs/plans/admin-lead-profile-page.md` §6) and left on the table when that page shipped.
**Citation anchor:** every `file:line` is **`origin/main`** — verified @ `14b7bca` and
re-checked unchanged for all cited files through `35d53fb` (2026-07-26). Provenance note
for reviewers: the two ancestor docs above (and this one) are **untracked local plan docs**
in Shawn's workspace, not in the repo — code citations are repo-verifiable, doc citations
are not. The checkout this was scoped from is a stale draw branch (forked at #264) that
predates the Lead Profile feature — **build in a fresh worktree off `origin/main`.**

---

## 1. Why

The Prospects table is deliberately one-row-per-signup — the same person appears once per
campaign. The operator questions it therefore cannot answer:

- **"Have we seen +65 9123 4567 before?"** — search returns N signup rows, not one person.
- **"Who are our repeat people?"** — the whole point of the consumer spine (the audit's
  live proof: 5 people already signed 2 campaigns organically with zero cross-sell
  machinery), and no surface lists them.
- **"List the people the spine knows"** — the person-grain table (`consumers`) has counts,
  first/last-seen, and an erasure flag, reachable today ONLY as an embedded block on one
  prospect's detail payload. (Deliberately NOT "everyone": consumer-less prospects —
  Retell voice leads, pre-spine rows — are outside the spine and stay on the Prospects
  table; the page says so rather than pretending to be exhaustive. §3.1.)

The Lead Profile page (shipped #269/#271/#273) built the person **detail** view. This scope
builds the person **list** that clicks into it. One page, one endpoint, no new detail views.

## 2. Current-state findings (verified 2026-07-26)

### The spine

- `consumers` is a **rebuildable projection of prospects keyed by E.164 phone**
  (`backend/src/models/Consumer.js:4-20`). Attributes (`:21-51`): `id`, `phone` (null only
  after erasure), `phoneHash`, `firstName`, `lastName`, `email`, `firstSeenAt`,
  `lastSeenAt`, `signupCount`, `verifiedSignupCount`, `unsubTokenHash`, `erasedAt`.
  DB columns are **camelCase, quoted** — `underscored: false` + `freezeTableName: true`
  (`backend/src/database/connection.js:26-29`).
- **The model's own invariant: "never trust a counter over a recompute"**
  (`Consumer.js:9-12`). Counters are incremented at capture and otherwise ASSIGNED by
  best-effort recomputes whose failures are swallowed (`consumerService.js:226-230`,
  called untransacted from `updateProspect`, `prospectService.js:1611-1613`). A partial
  failure can zero a consumer's counts while prospects still link to it. **Consequence:
  the list must derive existence from prospect rows, never from `signupCount`** (§3.2).
- `prospects.consumerId` FK (`backend/src/models/Prospect.js:209-214`), association
  `Consumer.hasMany(Prospect, { as: 'signups' })` (`backend/src/models/index.js:86-87`).
- **Indexes** — sufficient at current scale; **this PR ships no migration**:
  - `idx_consumers_last_seen` on `(lastSeenAt)` — the default sort
    (`Consumer.js:61`, migration `078-consumer-spine.js:39`);
  - `idx_prospects_consumer` on `prospects("consumerId")` (`Prospect.js:354`,
    `078:61`) — narrows the `latestProspectId` lookup to one consumer's rows, which are
    then sorted un-indexed (no composite with `createdAt` exists; `idx_prospects_createdat`
    at `Prospect.js:366` is separate). At 136 prospects / ≤5 rows per consumer that sort
    is trivial; the composite `("consumerId","createdAt" DESC)` is a named future lever,
    mirrored model+migration, if an `EXPLAIN` at ≥~10k prospects shows per-row sorts.
  - `uq_consumers_phone` partial unique + `idx_consumers_phone_hash`
    (`Consumer.js:59-60`).
  House rule: any FUTURE index must be mirrored model **and** migration — test boot runs
  `sequelize.sync({force:true})` before migrations (`Consumer.js:55-58`; the 080
  `idx_consumers_unsub_token` at `080-consent-ledger.js:62-63` already violates the
  mirror and survives only by accident — don't add a second violation).
- **Scale (prod, queried 2026-07-26):** 129 consumers / 136 prospects, **1** row with
  `signupCount = 0`, **0** erased, 3 consumer-less prospects. Search can seq-scan for a
  long time; `pg_trgm` is the named lever if `consumers` ever passes ~50k rows.

### Reads and writes today

- Writers: capture (`prospectService.js:974` → `resolveConsumerForCaptureTx`), phone/email
  edits and deletes (→ `recomputeConsumersByPhone`, `prospectService.js:1611-1613` /
  `:1715-1717` — note the delete-path guard `deletedPhone && … !== 'call_bot'`: deleting a
  phone-less row, e.g. an erased skeleton, triggers NO recompute), full reconcile
  (migration 079 / `scripts/rebuild-consumer-spine.js` — never scheduled).
- Person read: `getConsumerJourney(consumerId, { includeRaw })`
  (`backend/src/services/consumerService.js:406`) — identity block `:446-457`, per-signup
  rows with `agentName`/`externalBuyer` `:458-476`. Two callers: the admin prospect
  detail (`prospectService.js:1474`, inside the `?include=profile` admin branch) and
  `GET /api/consumers/:id`.
- **`GET /api/consumers/:id` exists (admin) with ZERO frontend callers** — confirmed by
  full-src grep; `src/api/adminV2.js` has no consumer function. Routes are auto-mounted
  from `export const meta = { path: '/api/consumers' }` (`backend/src/routes/consumers.js:5`,
  loader `backend/src/routes/index.js:52-53`); both existing routes are
  `authenticateToken, requireAdmin` (`consumers.js:12,15`) — deliberately stricter than
  prospects detail because it aggregates cross-campaign (`consumers.js:9-11`).
- **No list/search endpoint anywhere**: `Consumer.findAll`/`findAndCountAll` appear
  nowhere in `backend/src`. Caveat for reviewers: cohorts DO read `consumers` via raw SQL —
  `buildResolution` resolves definition membership (`cohortService.js:330`),
  `canMarketToBatch` consent-checks a batch (`:565`), and `listCohortMembers` (`:476-517`)
  pages the resolved membership — but that is definition-scoped, not a global search.
  This scope creates the first one.
- The `listProspects` search sanitizer (`prospectService.js:2294-2308`): `slice(0,100)` +
  `%`/`_` escaping — **no trim, no backslash escaping, no `ESCAPE` clause**. Don't copy it
  verbatim; §4.1 specifies a corrected shared helper.

### Semantics the display decisions hang on

- **`signupCount = 0`** — normally means a phone edit moved every signup away:
  `recomputeConsumersByPhone` zeroes the counts and leaves the row
  (`consumerService.js:207-214`); the reconciler does the same at scale (`:356-367`).
  Rows are **never deleted** (no `Consumer.destroy` exists). But per the counter caveat
  above, `signupCount = 0` can ALSO be drift on a still-linked person — which is why the
  filter is row-existence, not the counter (§3.2).
- **Erasure** (`erasureService.js`) — consumer PII is fully nulled: `phone`, `phoneHash`,
  `firstName`, `lastName`, `email`, `unsubTokenHash` (`erasureService.js:605-610`); no
  pseudonymous tombstone by design. **Counts and seen-dates survive** (erasureService
  never touches them). Linked prospects are scrubbed to skeletons — `firstName='Erased'`,
  `phone = NULL` (`:310-325`) — but **keep their `consumerId`**; that link is how the Lead
  Profile renders its erased banner (`AdminV2LeadProfile.jsx:496-501`). So an erased
  person: unfindable by any identity search (nothing left to match — by design), still
  browsable while skeletons remain, still clickable into the profile.
  - **Known data-debt edge (Codex #5, out of this page's power to fix):** deleting an
    erased skeleton triggers no recompute (phone is null, `prospectService.js:1715-1716`)
    and the reconciler can neither zero nor heal a null-phone consumer
    (`consumerService.js:357-366` targets `phone IS NOT NULL`) — the consumer's counters
    then overstate forever. The row-existence filter keeps THIS page truthful regardless;
    the skeleton-deletion policy is **deferred and currently untracked** per §7 Q5.
- **Erasure fences are asymmetric today (Codex R1 #6 + R2 #9, verified):**
  single-prospect edits are fenced — `sourceMetadata.erased === true` → 410
  (`prospectService.js:1523-1527`) — but **bulk assign** (`:1975-2022`: scope +
  releasable-hold conditions only, then `Prospect.update` sets `assignedAgentId`) and
  **Return to held, single AND bulk** (`returnProspectToHeld` `:2824-2848` checks only
  `quarantinedAt`; `bulkReturnProspectsToHeld` `:2976-2998` loops it) have **no erased
  check**, and the profile's command bar renders Assign / Return / Delete
  unconditionally (`AdminV2LeadProfile.jsx:440-443`). A People page that makes erased
  rows one click away must not widen that hole: §3.3 suppresses the mutating controls
  client-side; the backend fences (all four paths above, with tests) are a named
  follow-up — a shipped-surface gap reachable today via `/admin/leads/:id` directly.
- **Consumer-less prospects** (3 in prod): `call_bot` rows never link (the phone is our
  own DDI — `consumerService.js:20-22`) and pre-spine/empty-phone rows may not. These
  people are **not in this directory**; the Prospects table remains their only surface.

### The click target (Lead Profile, shipped)

- One route, two views (`src/pages/adminv2/AdminV2LeadProfile.jsx:1-17`):
  `/admin/leads/:prospectId` = signup drill-in; **`?view=profile` = the person view**
  (`:252` picks the view) — identity card, campaigns rail, person-wide history. Data:
  `GET /prospects/:id?include=profile` (`src/api/adminV2.js:64-67`,
  `useProspectProfile` `src/hooks/queries/useAdminV2.js:25`).
- **`state.from` contract**: Prospects rows navigate with
  `state: { from: pathname + search }` (`AdminV2Prospects.jsx:99-101`); the profile
  validates it with `location.state.from.startsWith('/AdminProspects')` and otherwise
  falls back to `/AdminProspects` (`AdminV2LeadProfile.jsx:265-267`). It feeds two back
  links (`:385`, `:434`, label hardcoded "← Prospects"), every internal re-anchor
  (`:268-269`), and the post-delete redirect (`:309`). **A People-origin visit is
  silently rejected by the guard today** — §3.4 replaces it with exact-path validation.
  Router state does not survive reload/direct links — the fallback IS the contract there.
- **Command-bar mutations anchor on the URL's prospect** — Return and Delete act on
  `prospectId` directly (`:294`, `:304`); only Assign asks "which campaign's lead?" when
  the profile view has several signups (`:405-411`); the delete confirm names the
  campaign (`:851`). From People, the anchor is the *newest* signup, which the operator
  did not consciously pick — §3.5 extends the existing two-step picker to Return/Delete
  in profile view.
- House phone display `+65 XXXX XXXX` exists ONLY as a module-local in the profile
  (`fmtPhone`, `AdminV2LeadProfile.jsx:42-45`); every table renders raw phones
  (`AdminV2Prospects.jsx:410`). `src/lib/adminV2/format.js` has no phone helper.

### The list idiom to copy

- `AdminV2Prospects.jsx`: URL params are the single filter truth (`readFilters` `:34-47`),
  debounced search writes `q` through a live `paramsRef` (the RR7 stale-closure fix,
  `:103-125`), server pagination `PAGE_SIZE = 25` (`src/lib/adminV2/constants.js:100`),
  hand-rolled table (`av2-thead` / `av2-row`, rows `role="button"` + Enter/Space,
  `:393`), `PageHeader` + `Skeleton`/`ErrorState`/`EmptyState` from
  `src/components/adminv2/primitives.jsx` (8 exports; no table/pagination primitives —
  hand-roll like everyone else).
- **React Query caveat (Codex #15, verified):** the repo is on RQ **v5** (`package.json`:
  `^5.90.21`) but `useProspects` still passes `keepPreviousData: true`
  (`useAdminV2.js:50-56`) — a removed v4 option, silently ignored, so Prospects flashes
  on page flips. The v5 idiom is live next door: `placeholderData` in
  `AdminV2CohortDetail.jsx:46-51`. `useConsumers` uses the v5 form; the one-line
  `useProspects` repair rides along as a drive-by.
- Routes: `ADMIN_V2 = import.meta.env.VITE_ADMIN_V2_ENABLED === 'true'`
  (`src/pages/index.jsx:72`); v2-only pages use the `{ADMIN_V2 && <Route …/>}` form
  (leads `:359-369`, cohort detail `/admin/cohorts/:id` `:383`); list paths are
  `/AdminX`-style (`/AdminProspects` `:334`, `/AdminCohorts` `:372`).
- Sidebar `src/lib/adminV2/nav.js` — entries are `{ to, label }` under group labels
  (`Lead Generation` `:12-24`). The ⌘K palette derives its Pages group from `NAV`
  automatically (`src/components/adminv2/GlobalSearch.jsx:16`, `:130-137`) — **a nav
  entry is a palette entry for free**.

### The cohort fast-follow target

- `listCohortMembers` (`cohortService.js:476-517`) returns per member: `consumerId`,
  `firstName`, `lastName`, `phone`, `email`, `verifiedSignupCount`, `lastSeenAt`,
  `reachable`, `reasons` (`:505-515`) — **no prospect id**, so
  `AdminV2CohortDetail.jsx:181-187` renders `role="row"`/`role="cell"` rows with
  `cursor: 'default'`, keyed by `m.consumerId`, unclickable. Two callers: the admin
  members endpoint (`routes/cohorts.js:80`, blanket `authenticateToken, requireAdmin` at
  `:71`) and the **broadcast send fan-out** (`emailBroadcastService.js:276-289`, DB-backed
  suite `backend/test/emailBroadcastService.test.js`) — any enrichment must not tax the
  send path.

### CI reality (Codex #17, verified — changes the merge gate)

`.github/workflows/ci.yml:60-67` runs backend unit tests as a step BEFORE the integration
step; a failing step skips the rest of the job. The chronically-red
`test/unit/shortlinkService.test.js` therefore doesn't just stain the badge — **it
prevents every backend integration suite (including this plan's new ones) from running in
CI at all.** Root cause identified: `shortlinkService.js:3` imports `Prospect` (and more)
from `models/index.js`, but the suite's `jest.unstable_mockModule` factory exports only
`ShortLink`, `ShortLinkClick`, `sequelize` (`shortlinkService.test.js:52-56`) — an ESM
named-import of a missing export kills the suite at load. §5 makes repairing that mock a
precursor commit; if it goes green, the merge gate hardens from "only that suite failing"
to "backend job green".

---

## 3. Design

### 3.1 The page

**`/AdminPeople`** — "People" in the sidebar directly under Prospects (`nav.js`, Lead
Generation group): the person-grain sibling of the signup-grain table. ADMIN_V2-gated
`{ADMIN_V2 && <Route …>}` + `ProtectedRoute requiredRole="admin"` + `AdminV2Shell`,
copying the `/AdminCohorts` registration. New file `src/pages/adminv2/AdminV2People.jsx`.

```
People                                       [ 128 LINKED PEOPLE · SERVER-SIDE 25/PAGE ]
⌕ Search name, phone, email
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ PERSON ▲▼                     PHONE           SIGNUPS ▲▼            LAST SEEN ▲▼     │
│ Shawn Lee                     +65 9123 4567   3 signups (2 verified)   2d ago      › │
│ shawn@x.com                                                                          │
│ Jane Tan                      +65 9888 0000   1 signup (1 verified)    3w ago      › │
│ Erased person  [⊘ erased]     —               2 signups                12 May      › │
└──────────────────────────────────────────────────────────────────────────────────────┘
  Voice (Retell) and pre-spine leads have no linked person — find them in Prospects.
                                                            1–25 of 128   ← Prev  Next →
```

- **The metric is "LINKED PEOPLE"**, not "people" — the directory covers consumers with
  ≥1 linked signup row (§3.2); the footer line above states the exclusion persistently
  (not only in the empty state), so the total never reads as "everyone" (Codex #19).
- **Columns**: PERSON (name bold, email mono sub-line — the Prospects Lead-cell shape) ·
  PHONE (`fmtPhone` house display) · SIGNUPS (`N signups (M verified)` — the profile's
  meta-line voice, `AdminV2LeadProfile.jsx:520-524`; counters are display-only and may
  drift between reconciles — they never gate anything) · LAST SEEN (`fmtRelative`,
  absolute on hover).
- **Search**: one box, URL param `q`, debounced 350ms via the `paramsRef` idiom copied
  from Prospects (the RR7 stale-closure lesson is load-bearing — copy, don't rewrite).
- **Sort**: URL param `sort`, default `-lastSeenAt` (indexed). `SortHeader` on PERSON
  (`name`), SIGNUPS (`signupCount`), LAST SEEN (`lastSeenAt`); allowlist server-side,
  **`NULLS LAST` on both name directions** (PG defaults DESC to NULLS FIRST — erased
  rows would float to the top; Codex #13).
- **No selection, no bulk bar, no CSV in v1.**
- **Row click** → `navigate('/admin/leads/<latestProspectId>?view=profile',
  { state: { from: location.pathname + location.search } })` — the PERSON view of the
  existing profile; back-link restores this list's exact query string. Rows are
  `role="button"` + Enter/Space (Prospects `:393`). Defensive only: a row missing
  `latestProspectId` renders inert — the filter makes that state near-impossible (§3.2),
  but the page must never produce a dead click.

### 3.2 Decision: membership = row existence, never the counter (Codex #4 — adopted)

The filter is `WHERE EXISTS (SELECT 1 FROM prospects p WHERE p."consumerId" = c.id)`
in both the count and page queries — NOT `"signupCount" > 0`. The counter is exactly what
`Consumer.js:9-12` says it is: a display projection that best-effort writers can strand
(swallowed recompute failure → counts zeroed while rows still link, or the converse).
Row existence is the truth the page navigates on, and it makes `latestProspectId`
non-null by construction (same statement, same snapshot). Consequences, all intended:

- Pure edit-artifacts (counts zeroed AND rows moved away — prod's 1 such row) drop out.
- A drift victim (counts zeroed, rows still linked) **stays visible** with an honest
  `0 signups` cell — present and clickable beats silently hidden.
- An erased person whose skeletons were later deleted drops out (nothing to open);
  erasure accountability lives in `consumer_suppressions` + the consent ledger, not here.

### 3.3 Decision: erased people are shown, read-only-leaning, with a `⊘ erased` chip

Browsable, not searchable (identity is nulled — that asymmetry is PDPA-correct: you
cannot look an erased person up by PII, you can still account for them while their
skeletons exist). Row renders "Erased person" muted + `⊘ erased` chip (the profile's chip
voice, `AdminV2LeadProfile.jsx:533`), `—` for phone/email, counts as stored. Click lands
on the profile, which already banners erasure.

**In-scope hardening (Codex #6, amended):** the profile's command bar suppresses
**Assign** and **Return to held** when `person.erasedAt` is set — there is no legitimate
re-dispatch of an erased lead, and the backend bulk paths don't fence it yet
(`prospectService.js:1975-2022`). Delete stays (skeleton cleanup is a real operation;
its counter side-effect is §2's named data-debt). The **backend** fences (single +
bulk assign/return reject erased, with tests) are a tracker follow-up, not this PR —
the gap is reachable today without this page and deserves its own reviewed change.

### 3.4 Lead Profile: back-link learns new origins via exact-path validation (Codex #14)

Replace the raw `startsWith('/AdminProspects')` (`AdminV2LeadProfile.jsx:265-267`) with a
small validator built on **canonical equality** (Codex R2 #3 — `new URL()` NORMALIZES dot
segments before any pathname check, so an origin check alone can't "reject" them): parse
`url = new URL(from, window.location.origin)`, require `url.origin ===
window.location.origin` **and `from === url.pathname + url.search`** — the raw value
equaling its own canonical form rules out dot segments, backslashes, `//network-path`
refs, and fragments in one comparison — then match `url.pathname` **exactly** against
`['/AdminProspects', '/AdminPeople']` or `^/admin/cohorts/[0-9a-f-]{36}$`. Anything else
falls back to `/AdminProspects` as today. Back-link label derives from the match (Prospects / People /
Cohort) at both consumption sites (`:385`, `:434`). Post-delete (`:309`) and re-anchor
forwarding (`:268-269`) are unchanged. Reload/direct-link keeps today's contract: no
state → fallback. Tests: each origin honored, `/AdminPeople-nope` rejected, `..`-path
rejected, junk falls back.

`fmtPhone` moves from the profile's module scope (`:42-45`) to an export in
`src/lib/adminV2/format.js` (+ cases in `src/lib/adminV2/__tests__/adminV2.test.js`);
profile imports it, People uses it. Other tables keep raw phones (out of scope).

### 3.5 Lead Profile: person-origin mutations pick their signup explicitly (Codex #7)

From People, the URL's anchor is the *newest* signup — an accident of sorting, not an
operator choice — yet Return and Delete act on it directly (`:294`, `:304`). The existing
menu is Assign-shaped (campaign stage always advances to the agent stage, `:450-479`), so
this is a small **generalization, not a bolt-on** (Codex R2 #4): menu state becomes
`{ action: 'assign'|'return'|'delete', stage: 'campaign'|'agent', targetId }`. In
**profile view with >1 signup**, all three actions open the "Which campaign's lead?"
stage; Assign then advances to the agent stage, Return mutates the picked `prospectId`
directly, Delete opens the confirm dialog **with the picked signup's campaign name**
(confirmation copy derives from the selection, not the URL-anchored `currentSignup`,
`:846-858`). Both mutations take an explicit target parameter. Drill-in view is unchanged
(there the anchor IS the operator's choice). Tests: both views, and multi-signup Delete
on an ERASED person (Assign/Return suppressed per §3.3, Delete still two-step).

### 3.6 Cohort fast-follow (PR 2)

- `listCohortMembers` gains `includeProspect = false`. When true, AFTER paging, one batch
  query over the page's consumer ids — **house replacement idiom, not `ANY(:ids)`**
  (Sequelize replacements expand arrays for `IN`; cf. `cohortService.js:574` and the
  `ANY(ARRAY[:x]::text[])` form at `consumerService.js:362-366`; Codex #8):
  `SELECT DISTINCT ON ("consumerId") "consumerId", id FROM prospects
   WHERE "consumerId" IN (:ids) ORDER BY "consumerId", "createdAt" DESC, id DESC`
  — skipped entirely when the page is empty. Member rows gain nullable
  `latestProspectId`. **Zero ADDITIONAL prospect-enrichment queries when the flag is
  off** (the baseline count+page SQL always runs, `cohortService.js:491-499`) — the
  broadcast fan-out caller (`emailBroadcastService.js:276-289`) never pays for the new
  lookup; the spy assertion is "no SQL matching `FROM prospects … IN (:ids)` on the
  flag-off path", not "no queries".
- `cohortController.members` passes `includeProspect: true` (the endpoint is already
  admin-only and single-purpose; the flag protects the service's other caller).
- `AdminV2CohortDetail.jsx:181-187`: **keep the `role="row"`/`role="cell"` structure**
  (Codex #16) — the Person cell gains a keyboard-accessible `<Link>` to
  `/admin/leads/<id>?view=profile` with `state.from = pathname + search` when
  `latestProspectId` is present; rows without stay plain text. Requires §3.4's validator
  (cohort detail path `/admin/cohorts/:id`, `index.jsx:383`).

### 3.7 Named decisions from the seeds

- **Per-person outcome rollups in v1: NO.** The profile holds the full outcome story one
  click away; rollups would re-add the `?include=outcome`-style fan-out to a page whose
  job is finding the person. Revisit only with a concrete operator ask.
- **⌘K: nav entry only.** The Pages group picks up "People" automatically
  (`GlobalSearch.jsx:130-137`); one palette assertion added to its test. A person-ENTITY
  search group (typing a phone into ⌘K) is named out, cheap later on this endpoint.
- **Indexes: none now.** Grounded in prod scale (129 consumers / 136 prospects); the two
  named levers (`pg_trgm` on names/email; composite `("consumerId","createdAt")`) each
  come with a threshold and the model+migration mirror rule.

---

## 4. API contract

### 4.1 `GET /api/consumers` (new)

Route added to the existing auto-mounted router (`backend/src/routes/consumers.js`):
`router.get('/', authenticateToken, requireAdmin, consumerController.listConsumers)` —
same middleware chain as its siblings. There is no non-admin variant to keep
byte-identical; the existing `GET /:id` and `POST /:id/erase` are untouched by this PR.

Query params:

| param | rule |
|---|---|
| `q` | shared new helper `escapeLike(raw)`: trim → slice 100 → escape `\`, `%`, `_` (the `listProspects` sanitizer at `prospectService.js:2294-2308` does neither trim nor backslash — corrected here, with an explicit `ESCAPE '\'` in the SQL; Codex #3). Matches `firstName` / `lastName` / `concat_ws(' ', "firstName", "lastName")` / `email` ILIKE `%q%`; ADDITIONALLY, when `q` stripped to digits has ≥ 4 digits, `phone LIKE '%<digits>%'` (consumers.phone is compact E.164 — no spacing to strip) |
| `page` | strict: must match `/^\d+$/`, then `Number()` + safe-integer check; anything else → 1; capped at 10 000 (offset bound; Codex R1 #11 + R2 #7 — `parseInt` is NOT strict, it accepts `2junk`/`2.5`/`1e2`) |
| `limit` | same parsing, clamped 1..100, default 25 |
| `sort` | allowlist `-lastSeenAt` (default) · `lastSeenAt` · `-signupCount` · `signupCount` · `name` · `-name` (name = `lastName, firstName`, **`NULLS LAST` both directions**) · `-firstSeenAt` · `firstSeenAt`; unknown → default (lenient, like the list idiom) |

Always-on filter: the `EXISTS` predicate of §3.2. Erased rows pass it while skeletons
remain; they never match a `q` (identity columns null).

Implementation: raw SQL (the spine's house style), **both statements inside one
`sequelize.transaction` at `Transaction.ISOLATION_LEVELS.REPEATABLE_READ`** — the
connection sets no default isolation (`connection.js:18-57`) and READ COMMITTED takes a
NEW snapshot per statement, so a default transaction would not give the shared snapshot
this claims (Codex R2 #1; house precedent for explicit isolation:
`consumerService.js:381-383`). The ordering claim is "deterministic under a static
dataset" (id tiebreak), NOT cross-request stability — offset pages can shift under
concurrent writes, which is the accepted list idiom here (Codex R1 #10):

```sql
SELECT count(*)::int AS total FROM consumers c
 WHERE EXISTS (SELECT 1 FROM prospects p WHERE p."consumerId" = c.id) AND <q-filter>;

SELECT c.id, c."firstName", c."lastName", c.email, c.phone,
       c."signupCount", c."verifiedSignupCount",
       c."firstSeenAt", c."lastSeenAt", c."erasedAt",
       lp.id AS "latestProspectId"
  FROM consumers c
  JOIN LATERAL (
    SELECT p.id FROM prospects p
     WHERE p."consumerId" = c.id
     ORDER BY p."createdAt" DESC, p.id DESC
     LIMIT 1
  ) lp ON true                      -- inner lateral: doubles as the EXISTS
 WHERE <q-filter>
 ORDER BY <allowlisted> , c.id DESC
 LIMIT :limit OFFSET :offset;
```

(`count(*)::int` because node-postgres returns bare `count(*)` as an int8 **string** —
the cast is the established idiom, `cohortService.js:491-493`; Codex #9. The page query's
plain `JOIN LATERAL` enforces existence without a second predicate; the count query uses
`EXISTS`.)

Lives in `consumerService` as `listConsumers({ q, page, limit, sort })` (keeps the
spine's SQL in one module, DI-testable via `makeConsumerService`); controller mirrors
`getConsumer`'s shape and error idiom (`consumerController.js:13-23`).

Response:

```jsonc
{ "success": true, "data": {
  "total": 128, "page": 1, "limit": 25,
  "rows": [{
    "id": "…", "firstName": "Shawn", "lastName": "Lee",       // null-triple when erased
    "email": "shawn@x.com", "phone": "+6591234567",           // null when erased
    "signupCount": 3, "verifiedSignupCount": 2,               // display-only projection
    "firstSeenAt": "…", "lastSeenAt": "…",
    "erasedAt": null,
    "latestProspectId": "…"                                    // non-null by construction
  }]
} }
```

### 4.2 Cohort members (enriched, additive)

`GET /api/cohorts/:id/members` rows gain `latestProspectId` (nullable) via §3.6. Every
existing field is untouched — pinned by a new contract test asserting the FULL current
field set plus the new one (today no test pins the member shape;
`cohortRoutes.test.js:154-167` checks three fields — this PR closes that gap while
touching the payload).

### 4.3 Frontend client

`src/api/adminV2.js`: `fetchConsumers(params)` → `{ rows, total }` (normalizing like
`fetchProspects` `:34-47`), with an envelope-normalization test.
`src/hooks/queries/useAdminV2.js`: `useConsumers(params)` — query key
`['adminV2', 'consumers', params]`, `staleTime: 10_000`, and the **RQ v5 idiom
`placeholderData: keepPreviousData`** (import from `@tanstack/react-query`), NOT the
dead v4 `keepPreviousData: true` that `useProspects` still carries (§2; the one-line
`useProspects` repair rides along as a drive-by with its own assertion).

---

## 5. Implementation plan

**Two PRs** (Codex #20): **PR 1** = precursor CI fix + endpoint + page + profile
guard/mutation changes. **PR 2** = cohort click-through. Work in a disposable worktree
off `origin/main`:

```
git -C ~/lyfe-master/mktr-platform worktree add ../mktr-people-wt -b feat/admin-people-directory origin/main
ln -s ~/lyfe-master/mktr-platform/node_modules ../mktr-people-wt/node_modules
ln -s ~/lyfe-master/mktr-platform/backend/node_modules ../mktr-people-wt/backend/node_modules
# commit with --no-verify (husky breaks in worktrees) AFTER running lint/tests manually
```

**PR 1**

0. **Precursor commit — repair the shortlink unit-suite mock. MANDATORY, no revert
   path** (Codex R2 #2 — a revert-and-merge option would contradict the green-gate
   prerequisite this plan claims): add `Prospect: { findByPk: jest.fn() }` (and any
   other import the service list needs) to the `jest.unstable_mockModule` factory in
   `backend/test/unit/shortlinkService.test.js:52-56`. If the fix surfaces further
   unit failures, **fix those too** until `test/unit/` is green locally — CI's
   integration step only exists behind it. The merge gate for this and future PRs is
   "backend job green".
1. **Backend** — `escapeLike` helper + `consumerService.listConsumers` (§4.1) +
   controller + route line.
2. **Backend tests** — new `backend/test/consumersList.test.js` (supertest, DB-backed,
   `./helpers.js` harness like `prospects.test.js:1-35`; jest picks up both test dirs —
   no `testMatch` in `backend/jest.config.js`): 401 anon + 403 agent (the
   `cohortRoutes.test.js:48-65` table idiom) · shape incl. numeric `total` ·
   name/email search · full-name "shawn lee" search (`concat_ws`) · phone-digit search ·
   `%`/`_`/`\` escaping · EXISTS filter: zero-signup artifact hidden, **counter-drift row
   (signupCount=0, prospect still linked) visible with latestProspectId** ·
   erased row browsable with null identity · erased row NOT matched by old name/phone ·
   `latestProspectId` = newest by `(createdAt, id)` · sort allowlist + unknown→default ·
   `-name` places erased rows LAST · limit/page clamps · deterministic page-2 (id
   tiebreak, static data).
   Run: `cd backend && JWT_SECRET=test-secret NODE_OPTIONS=--experimental-vm-modules
   npx jest test/consumersList.test.js test/unit/shortlinkService.test.js` — needs the
   throwaway Postgres on 5433 (user `mktr_local`, db `mktr_test`; recreate via
   initdb/pg_ctl in the session scratchpad with `-c unix_socket_directories=''` if
   down). ECONNREFUSED = DB not up, not a code fault.
3. **Frontend** — `AdminV2People.jsx`; route (`{ADMIN_V2 && …}` form); nav entry;
   `fmtPhone` lift; §3.4 validator + labels; §3.5 two-step Return/Delete; §3.3 erased
   control suppression; `useConsumers` (v5 placeholderData) + `useProspects` drive-by.
4. **Frontend tests** (`npx vitest run src/pages/adminv2 src/lib/adminV2
   src/components/adminv2 src/api src/hooks` — the api/hooks dirs are IN the command so
   the new assertions actually execute; Codex R2 #5): new `src/api/__tests__/`
   suite asserting `fetchConsumers`'s envelope normalization (mock `@/api/client`), a
   behavioral placeholder-data assertion in the People page test (page flip keeps prior
   rows rendered), and `AdminV2People.test.jsx` copying the
   `AdminV2Prospects.navigation.test.jsx` idiom — **mock `@/api/adminV2`, real
   `MemoryRouter` + `QueryClientProvider`, a location-probe route** (NOT hook mocks —
   that file mocks the API layer; Codex #2) — rows render · click navigates to
   `/admin/leads/<id>?view=profile` with `state.from` carrying the query string ·
   erased chip + dashes + suppressed-mutations flow · debounce writes `q` · footer scope
   line. `AdminV2LeadProfile.test.jsx` additions: People/cohort `from` honored with
   right label · `/AdminPeople-nope` and dot-segment rejected · erased hides
   Assign/Return · profile-view Return/Delete two-step. `adminV2.test.js`: `fmtPhone`
   cases. `GlobalSearch.test.jsx`: "People" appears in Pages group.
5. **Gates** — suites above + `npx vite build`. Merge gate per precursor outcome (step 0).
   **Outcome (built 2026-07-26):** unit step GREEN in CI (98/98). Un-skipping the
   integration step exposed one more fatal-crash harness (prospectServiceBulkOps —
   fixed in-PR) and then a pre-existing red set: 5 suites / 28 tests (pipelineE2E,
   retell, retellWebhook, externalHeldLeadsController, analytics), **verified
   inherited** (identical signature on clean `origin/main` @ `012fd5c`). Their
   remediation is a named follow-up, NOT this PR; the gate for #278 is "unit green +
   integration completes with exactly that known set".

**PR 2** — cohort `includeProspect` batch (house `IN (:ids)` idiom) + controller flag +
member-shape contract test + `AdminV2CohortDetail` Link-in-cell + its tests; run
`test/cohortService.test.js test/cohortRoutes.test.js test/emailBroadcastService.test.js`
(the broadcast caller must stay green and query-free on the flag-off path — DI query-spy
assertion; Codex #18).

**Deploy-verify** — push, confirm a NEW Render deploy appeared (deploys API status),
marker-grep the served bundle for a string unique to this change (e.g. `LINKED PEOPLE`)
— never the local chunk hash. `VITE_ADMIN_V2_ENABLED` gates the surface; the endpoint
ships unflagged (admin-auth is the gate, like its siblings).

**Estimate:** ~2–2.5 days total (Codex #20 accepted: the honest touch surface is ~5
backend files + ~8 frontend files + 6 test files, plus the CI precursor).
PR 1 ≈ 1.5–2 days (precursor ~1h · backend + tests ≈ 4h · page/nav/profile changes +
tests ≈ 6–7h · gates/deploy ≈ 1h) · PR 2 ≈ half a day.
**Cut to fit:** CSV export, palette entity group, outcome rollups, any filters beyond
one search box, table-wide phone formatting, backend erasure fences (tracker item).

## 6. Out of scope (named so they aren't rediscovered)

- **Backend erasure fences on bulk assign/return** (`prospectService.js:1975-2022` admits
  erased rows) — tracker follow-up with its own tests; §3.3 suppresses the UI meanwhile.
- **Erased-skeleton deletion policy** (deleting them strands consumer counters forever —
  §2 data-debt note) — deliberately deferred per Shawn 2026-07-26 (0 erased rows in
  prod; the EXISTS filter keeps this page truthful meanwhile). Revisit when erasure
  volume is real.
- Person-level outcome/rollup columns (profile has them one click away — §3.7).
- ⌘K person-entity search group (phone-into-palette) — later, on this endpoint.
- Merge/split tooling for two consumers that are one human (needs product rules).
- A consumer-anchored detail page (`/admin/people/:consumerId`) — the prospect-anchored
  profile is the deliberate detail surface (`admin-lead-profile-page.md` §3.1); §3.4/§3.5
  make person-origin arrival safe on it without a new route.
- CSV export of people; consumer-less (Retell) prospects in this directory; non-admin
  access; editing person attributes; scheduling `reconcileConsumerSpine` (real, tiny
  drift — 1 row in prod — and predates this page).

## 7. Open questions — RESOLVED with Shawn, 2026-07-26

1. Erased rows: **visible by default with the `⊘ erased` chip** (as scoped, §3.3).
2. Two-step Return/Delete in profile view: **in v1** (as scoped, §3.5).
3. Nav position: **directly under Prospects** (as scoped, §3.1).
4. `name` sort: **kept** in the allowlist (as scoped, §4.1).
5. Erased-skeleton deletion policy: **leave as-is, decide later** — no fence, no
   recompute work now (0 erased rows in prod; §6 note updated). Not a tracker item yet.

## 8. Codex review dispositions (gpt-5.6-sol xhigh, 2026-07-26)

20 findings; every load-bearing claim re-verified against `origin/main` before adoption.
17 adopted (some amended), 2 adopted-in-part, 1 half-refuted. Verdict was RETHINK; §3.2,
§3.3, §3.4, §3.5, §4.1 and the §5 gates were rewritten accordingly.

| # | Sev | Verdict | Disposition |
|---|---|---|---|
| 1 | MEDIUM | half-refuted | Anchor re-verified through `35d53fb` (cited files unchanged). The "missing" ancestor docs aren't missing — they're deliberately untracked local plan docs; provenance note added instead of committing them |
| 2 | LOW | adopted | `cohortService.js:565` reworded (`canMarketToBatch`, not paging); RTL idiom description corrected (API-layer mock + MemoryRouter, verified against the real file); 401/403 cite moved to `cohortRoutes.test.js:48-65` |
| 3 | MEDIUM | adopted | "Exactly the listProspects sanitizer" was false (no trim, no backslash) — new shared `escapeLike` with `\`/`%`/`_` + `ESCAPE '\'` + `concat_ws` full-name; escaping tests |
| 4 | BLOCKER | adopted | Membership filter rewritten from `"signupCount" > 0` to row-existence (`EXISTS` / inner lateral) — verified the drift path (`consumerService.js:207-230` swallow + untransacted call `prospectService.js:1611-1613`); drift-row test added; counters demoted to display-only |
| 5 | HIGH | adopted-in-part | Verified (delete of phone-less skeletons never recomputes; reconciler can't touch null-phone consumers). §3.2's row-existence keeps the PAGE truthful; the deletion policy itself → out-of-scope + open question 5 (not buildable inside a read-only list) |
| 6 | BLOCKER | adopted (amended) | Verified: single-edit fenced 410 (`prospectService.js:1523-1527`), bulk assign unfenced (`:1975-2022`), profile buttons unconditional (`:440-443`). In scope: suppress Assign/Return on erased in the profile. Backend fences → named tracker follow-up (pre-existing, reachable without this page) |
| 7 | HIGH | adopted (amended) | Newest-signup anchor + direct Return/Delete verified (`:294`, `:304` vs Assign's picker `:405-411`). Fix = extend the existing two-step picker to Return/Delete in profile view (not a new read-only route — the ask forbids new detail views); drill-in unchanged |
| 8 | BLOCKER | adopted | Verified house idiom (`IN (:ids)` at `cohortService.js:574`; `ANY(ARRAY[...])` at `consumerService.js:362-366`) — sketch corrected, empty-page skip added. (Severity inflated for a plan sketch, but the correction is real) |
| 9 | MEDIUM | adopted | `count(*)::int` (int8-string footgun; house cast at `cohortService.js:491-493`) |
| 10 | MEDIUM | adopted | Count+page wrapped in one transaction; "stable pages" claim downgraded to deterministic-ordering-under-static-data |
| 11 | LOW | adopted | Strict parseInt semantics + page cap 10 000 specified |
| 12 | MEDIUM | adopted | Verified: `idx_prospects_consumer` is single-column (`Prospect.js:354`), no composite with `createdAt` (`:366` separate). Current-scale exemption made explicit with the composite as a thresholded, mirror-rule lever |
| 13 | LOW | adopted | `NULLS LAST` both name directions + erased-placement test |
| 14 | MEDIUM | adopted | Prefix `startsWith` replaced with URL-parse + exact-path/regex allowlist; prefix-confusion and dot-segment tests; reload fallback documented as the existing contract |
| 15 | MEDIUM | adopted | Verified: RQ `^5.90.21` + dead v4 `keepPreviousData: true` in `useProspects` (`useAdminV2.js:50-56`). `useConsumers` uses v5 `placeholderData: keepPreviousData`; one-line `useProspects` repair rides as drive-by |
| 16 | MEDIUM | adopted | Cohort rows keep `role="row"`/`role="cell"`; Link-in-Person-cell instead of row-as-button |
| 17 | HIGH | adopted | Verified both halves: ci.yml step ordering skips integration on unit failure (`ci.yml:60-67`), and the shortlink mock omits `Prospect` that `shortlinkService.js:3` imports (`shortlinkService.test.js:52-56`). Repair promoted to PR 1 precursor commit; merge gate hardens if green |
| 18 | MEDIUM | adopted | `emailBroadcastService.test.js` added to PR 2's run (verified it exists and exercises the caller); `fmtPhone` cases in `adminV2.test.js`; `fetchConsumers` envelope test; `GlobalSearch` palette assertion |
| 19 | MEDIUM | adopted (amended) | Metric renamed "LINKED PEOPLE" + persistent footer scope line + §1 rephrased. (Full unlinked-prospect count/link rejected — cross-table counts on every page load for 3 prod rows isn't worth a query) |
| 20 | MEDIUM | adopted | Split into 2 PRs; estimate re-based to 2–2.5 days; CI precursor is the "green gate" prerequisite. (Reconciliation scheduling stays out — §3.2 removes the page's dependency on counter freshness, which was the only lever this page had) |

### Pass 2 (same reviewer, on the revised doc, 2026-07-26 — verdict AMEND)

9 findings, all verified and adopted; the affected sections were amended in place.

| # | Sev | Disposition |
|---|---|---|
| R2-1 | HIGH | §4.1 transaction pinned to `REPEATABLE_READ` (READ COMMITTED snapshots per statement; connection sets no default isolation) |
| R2-2 | HIGH | Precursor made mandatory with no revert path; further unit failures get fixed, not tolerated |
| R2-3 | MEDIUM | Validator rebuilt on canonical equality (`from === url.pathname + url.search`) — `new URL()` normalizes dot segments, so the old spec's "reject" claim was untestable |
| R2-4 | MEDIUM | Picker generalized to `{ action, stage, targetId }`; Delete confirm copy derives from the picked signup; erased multi-signup Delete test named |
| R2-5 | MEDIUM | api/hooks test dirs added to the vitest command; envelope suite in `src/api/__tests__/`; placeholder-data asserted behaviorally |
| R2-6 | MEDIUM | Cohort claim corrected to "zero ADDITIONAL prospect-enrichment queries"; spy assertion re-specified accordingly |
| R2-7 | LOW | Page/limit parsing spec corrected to `/^\d+$/` + safe-int (parseInt is not strict) |
| R2-8 | LOW | §2/§7 tracker-status contradiction fixed (deferred AND untracked) |
| R2-9 | LOW | Return paths (`:2824-2848`, `:2976-2998`, verified unfenced) added to the erasure-fence finding + follow-up scope |
