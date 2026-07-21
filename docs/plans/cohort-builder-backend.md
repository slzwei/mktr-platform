# Cohort Builder Backend (tracker "cohortapi")

Ships with this PR — the core of data-powerhouse activation (Phase 3): define
a group of people by what they did, and let the system keep only those we are
ALLOWED to message. Every future push (emailpush / wapush) starts from one of
these cohorts.

Design constraint from the consent work: `canMarketTo` (consentService) is THE
marketing gate. This PR gives it its first batch caller without forking its
semantics — the batch SQL is proven equivalent by a parity suite that runs
both implementations over the same fixtures, including forced timestamp ties
down to the uuid tie-break. Reviewed by Codex (gpt-5.6-sol xhigh) pre-merge;
§10 records the disposition of all 14 findings.

## 1. What this builds on

- `consumers` — the person spine (phone-keyed, `erasedAt` for PR-C erasure).
- `consent_events` — append-only ledger; current state = latest event per
  (kind, campaignId-or-global) with tie-break `occurredAt DESC, createdAt
  DESC, id DESC` (consentService.getConsentState).
- `consumer_suppressions` — exit door; channel `all|email|whatsapp|sms|voice`;
  reason `erasure` blocks everything, others block marketing.
- `canMarketTo({consumerId, phone, channel, campaignId})` — per-person gate:
  resolve consumer → not erased → not suppressed (marketing purpose: ANY row
  matching `channel IN ('all', :channel)`) → latest in-scope contact event
  granted ∧ verified. Scope: campaignId given ⇒ that campaign's events and
  global events compete on recency; campaignId null ⇒ ONLY global events
  count.
- `prospects` — one row per campaign signup; `consumerId` FK (indexed);
  `demographics` JSON ({dateOfBirth 'YYYY-MM-DD', income, education,
  gender…}), `location` JSON ({postalCode…}). Values are stored verbatim as
  the funnel collected them (display strings like "Degree", "$3,000 -
  $4,999") — hence the /facets endpoint (§6).
- `draw_entries` — drawId + prospectId (nullable) + phoneHash. On PDPA
  erasure the hash is REWRITTEN to an all-zeros sentinel and the consumer's
  own hash is nulled (erasureService) — erased people cannot re-enter a
  cohort through a draw. The phoneHash fallback branch exists for entries
  whose prospect was HARD-DELETED while the person still stands.
- `campaigns.tags` — TEXT holding a JSON array under a JS getter/setter, with
  no DB-level JSON constraint. Tracker item "taxonomy" populates it; the
  filter ships ready.

NOT built yet (tracker "rollup"): person-level attribute projection. The
attribute filters therefore resolve against prospect-level data via EXISTS —
documented as the interface that "rollup" later re-points at consumer
attributes without changing the API shape.

## 2. Data model — migration 084 + Cohort model

`cohorts`: id, name(120), description, `definition` JSONB, createdBy →
users (SET NULL), advisory snapshot columns (`lastTotalCount`,
`lastReachableCount`, `lastPreviewBreakdown`, `lastPreviewAt`), `archivedAt`,
timestamps. Indexes: `(archivedAt, createdAt DESC)` for the list view;
migration also adds `draw_entries("phoneHash")` and partial
`draw_entries("prospectId")` for the two draw-filter branches
(`uq_de_draw_prospect` leads on drawId and cannot serve a bare prospectId
probe). All guarded/idempotent like 080; models mirror every index because
test boot builds schema via `sync({force:true})`.

Soft-archive only, never hard-delete. Cohort rows are MUTABLE definitions —
they are NOT an audit record: when the push senders land, each send log MUST
snapshot the normalized definition, gate context, channel and counts it
resolved with (Codex #10). Create/update resolve the preview FIRST and
persist definition + snapshot in one write — a failing resolution leaves no
half-created row.

## 3. Cohort definition (the API contract)

```jsonc
{
  "filters": {
    "campaignIds":   ["uuid", …],      // signed up for ANY of these (max 50)
    "drawIds":       ["uuid", …],      // entered ANY of these draws (max 50)
    "anyDraw":       true,             // entered at least one draw
    "campaignTags":  ["parenting", …], // signed up for any campaign carrying ANY of these tags (max 20)
    "attributes": {                    // person attributes, values per /facets
      "postalPrefixes": ["52", "53"],  // location.postalCode starts with any (digits only, max 20)
      "incomes":     ["$3,000 - $4,999", …],
      "educations":  ["Degree", …],
      "genders":     ["female", …]
    }
  },
  "ageGate": { "minAge": 18, "maxAge": null },   // §9.5-2: 18 is a FLOOR — minAge < 18 is rejected
  "marketingContext": { "campaignId": null }     // consent-gate scope, must reference a real campaign; see §5
}
```

Combination semantics:
- ACROSS filter keys: AND. WITHIN a list: OR / ANY.
- Each attribute list is its own independent EXISTS over the person's signups
  — income may come from one signup and postal from another; both are facts
  about the person (matching what "rollup" will later materialize).
- Empty/absent `filters` ⇒ all consumers; the gate still applies.
- Route-level Joi gives loud 400s (no stripUnknown — internal admin route);
  the BINDING validation lives in `cohortService.normalizeDefinition`, which
  re-checks definitions loaded back out of the DB. Values are deduped,
  trimmed, length- and shape-checked; postalPrefixes are digits-only so LIKE
  metacharacters cannot exist, and patterns are built server-side.

## 4. Resolution pipeline

All SQL uses Sequelize `:replacements` (never string interpolation). The
jsonb `?`/`?|` operators are avoided (Sequelize positional-placeholder
collision) — and `campaigns.tags` is never cast to jsonb at all: it is
unchecked TEXT, and one malformed row would abort the whole query (Codex #9).
Tag filters resolve campaign ids in JS (malformed rows skipped) and the SQL
sees only a plain `campaignId IN` list.

### 4.1 Population (filters, pre-gate)

`consumers c WHERE c."erasedAt" IS NULL` AND, per requested filter, an
EXISTS subquery: prospects by campaignId; draw membership as TWO
independently-indexed branches (prospect-link join OR phoneHash equality);
tag-resolved campaign ids; postal `LIKE ANY ((ARRAY[:patterns])::text[])`
over `COALESCE(location->>'postalCode', location->>'zipCode')`; demographic
exact-IN per attribute list.

### 4.2 Age gate (§9.5-2, binding — always on)

dob is a 'YYYY-MM-DD' string in prospects.demographics. Nothing is ever cast
to `date`: comparisons are lexicographic against `to_char` cutoffs (ISO
strings order like dates), and validity is established by a full-anchored
shape regex PLUS a real-calendar day check (`day ≤ days-in-month`, leap-aware,
computed from the always-valid 'YYYY-MM-01') — so impossible dates like
2000-02-30 can neither abort the query nor sneak through as evidence (Codex
#1). Ages are measured against the SINGAPORE calendar day
(`now() AT TIME ZONE 'Asia/Singapore'`) — the DB session timezone is
deliberately not trusted. A 29-Feb birthday reaches an age on 1 Mar of
non-leap years (the conservative, later direction).

Three per-person facts:
- `in_window`: SOME valid dob satisfies the whole [minAge, maxAge] window —
  both bounds on the SAME row; conflicting dobs cannot combine to fake a pass.
- `minor_claim`: SOME valid dob puts the person under EIGHTEEN — checked
  against the binding floor independently of the cohort's minAge. ANY
  under-18 claim disqualifies outright, no matter how many adult dobs the
  person's other signups carry (fail-closed; Codex #1).
- `dob_known`: SOME valid dob exists.

Reasons: no valid dob → `age_unknown`; under-18 claim alongside an otherwise
qualifying dob → `age_conflict`; dob known but outside the window →
`age_ineligible`. The gate cannot be expressed away: minAge defaults to 18
and values below 18 are rejected (route 400 + service 422 — floor, not
default).

### 4.3 The gates

**Consent (batch canMarketTo)** — one LATERAL per person reproducing
`canMarketTo` EXACTLY: same scope rule, same three-key tie-break, same
`channel IN ('all', :channel)` suppression matching, same erased/fail-closed
posture. Note the semantics inherited deliberately: channel 'all' checks only
channel-'all' suppression rows (a person suppressed ONLY on email passes an
'all' check, exactly as `isSuppressed` behaves), and `ConsentEvent.channels`
is evidence, not a filter — parity with the blessed gate, locked by tests.

**Destination (cohort layer only)** — consent alone cannot make an email push
reach a person with no email (Codex #5). For channel `email` the person needs
a non-empty email (`missing_email`); for `whatsapp|sms|voice` a phone
(`missing_phone`); channel `all` is the abstract consent question and
requires none. This lives OUTSIDE canMarketToBatch to preserve parity.

`canMarketToBatch(consumerIds, {channel, campaignId})` is exported for the
push senders. Domain: consumer ids only — no phone fallback (per-person
canMarketTo keeps that); unknown ids report `not_found`; ids are processed in
bounded chunks and any chunk failure aborts the whole call. It lives in
cohortService today only to stay off files carried by in-flight parallel
work; fold it into consentService when that lands (Codex #4 — the parity
suite is the tripwire either way).

### 4.4 Outputs

Preview (aggregate, one resolution round-trip):
```jsonc
{
  "total": 212, "reachable": 180, "excluded": 32,
  "byReason": { "age_unknown": 2, "age_conflict": 1, "age_ineligible": 3,
                "missing_email": 0, "missing_phone": 0,
                "suppressed": 6, "not_consented": 15, "not_verified": 8 }, // overlapping counts
  "gate": { "channel": "all", "campaignId": null, "minAge": 18, "maxAge": null }
}
```
`excluded` is a distinct-person count; `byReason` counts overlap.

Members (paged ≤200, `status=all|reachable|excluded`): consumerId, name,
phone, email, verifiedSignupCount, lastSeenAt, `reachable`, `reasons[]`,
ordered `lastSeenAt DESC, id`. Full phone deliberately — admin-only surface
like the consumer journey endpoint.

## 5. The consent-gate scope (`marketingContext.campaignId`)

Default **null = the pure cross-campaign question** — only explicit GLOBAL
grants (agree-all era) pass. A cohort built to push ABOUT a specific campaign
sets `campaignId` to it (must reference a REAL campaign — phantom scopes
422), and people whose legacy scoped grant covers THAT campaign become
reachable for it. This is scope selection, not scope widening.

**Binding obligation on the senders (Codex #2):** the cohort's gate scope is
advisory, for audience-building. A sender MUST gate each send with the
campaign the message is ACTUALLY about (per-recipient, at send time, via the
per-person gate), and voice/SMS/WhatsApp pushes MUST DNC-scrub at send time
regardless of consent (§9.5-2). Cohort resolution never substitutes for
either.

## 6. Endpoints (routes/cohorts.js — all `authenticateToken, requireAdmin`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/cohorts/preview` | Stateless: definition → counts (UI live preview) |
| GET | `/api/cohorts/facets` | Live filter vocabulary: attribute values, campaign tags, campaigns, draws |
| POST | `/api/cohorts` | Create (resolves preview first; persists definition + snapshot together) |
| GET | `/api/cohorts` | List non-archived, newest first, stored snapshots |
| GET | `/api/cohorts/:id` | Definition + snapshot; `?refresh=1` recomputes + persists |
| PUT | `/api/cohorts/:id` | Update; definition change re-resolves before persisting |
| DELETE | `/api/cohorts/:id` | Soft-archive; idempotent 404 after |
| GET | `/api/cohorts/:id/members` | Paged resolved membership with per-person `reasons` |

No feature flag: additive admin-only routes (same posture as
/api/consumers/:id). Live proof = 401 probe on api.mktr.sg.

## 7. Conflict posture (parallel sessions)

ZERO edits to `consentService.js`, `contactConsent.js`,
`middleware/validation.js` — all carry uncommitted parallel work on the main
checkout. New files only, plus additive registrations in `models/index.js`
and index mirrors in `DrawEntry.js` (both clean). Migration 084 (083 =
propagate, merged). Joi schema lives inside routes/cohorts.js.

## 8. Tests (real-Postgres jest; 40 tests across two suites)

`cohortService.test.js`: filter semantics (campaigns, draws via both
branches + zero-sentinel, tags, attributes); age gate (default-18 floor,
`age_unknown` incl. impossible-calendar dob, `age_conflict` disqualification,
benign multi-dob, same-row maxAge window); reachability split + reasons;
scoped vs global gate; destination checks per channel; preview aggregates;
**the parity suite: canMarketToBatch === canMarketTo for every fixture ×
{null, campaign} scope × all five channels, plus forced createdAt and uuid
tie-breaks**; paging; facets; normalization hygiene.

`cohortRoutes.test.js`: 401/403 on every route, CRUD + snapshot lifecycle,
preview, phantom gate campaign 422, facets, validation rejections (minAge
16, unknown keys, bad uuids), malformed ids 404.

## 9. Non-goals / deferred

- Filling `campaigns.tags` (tracker "taxonomy") — the filter ships ready.
- Consumer-level attribute projection (tracker "rollup").
- Attribute-value canonicalization (Codex #8): /facets exposes the live
  verbatim vocabulary now; a normalizer belongs to "rollup"/"taxonomy".
- Recency/engagement filters, per-channel aggregate counts in one call,
  cohort revision history (send logs snapshot instead), materialization.
- Any send machinery (emailpush/wapush consume this; their obligations are
  §5).

## 10. Codex review round 1 (gpt-5.6-sol xhigh) — disposition

Verdict "implement with fixes"; all folded or dispositioned:

| # | Finding | Disposition |
|---|---|---|
| 1 | BLOCKER Age gate fail-open (shape-only regex, impossible dates, conflicting dobs, unpinned TZ) | FIXED: real-calendar validation, SGT day, minor-claim disqualifier + `age_conflict`, leap policy documented |
| 2 | BLOCKER Gate scope not bound to send purpose | FIXED in scope available: phantom-campaign 422 + binding sender obligations (§5); equality enforcement lands with the senders |
| 3 | MAJOR Batch domain narrower than canMarketTo | Documented: consumerId domain, not_found fail-closed; phone fallback stays per-person |
| 4 | MAJOR Second gate implementation | Accepted for now (§4.3): parallel-work conflict posture; fold-into-consentService noted + tie-break parity locks semantics |
| 5 | MAJOR 'all' ≠ any-channel; no destination check | FIXED: destination flags + missing_email/missing_phone; 'all' documented as the abstract consent question |
| 6 | MAJOR Erased-draw phoneHash claim wrong | FIXED: doc corrected (zero-sentinel), zero-sentinel fixture test added |
| 7 | MAJOR Draw predicate perf | FIXED: two indexed EXISTS branches + partial prospectId index; chunked batch documented |
| 8 | MAJOR Attribute vocabulary mismatch | FIXED: /facets endpoint; tests use real display-string values |
| 9 | MAJOR tags::jsonb cast abort | FIXED: JS-side tag resolution, no jsonb cast anywhere |
| 10 | MAJOR Mutable definitions vs audit | Documented duty on send logs (§2); revisions deferred |
| 11 | MAJOR Parity lacks tie cases | FIXED: forced createdAt tie + uuid tie fixtures; channels × scopes widened |
| 12 | MINOR Reason naming | FIXED: age_ineligible + age_conflict + missing_* |
| 13 | MINOR Snapshot ordering / stale plan | FIXED: preview-before-persist; plan trued |
| 14 | NIT Doc claims | FIXED: wording trued (in-flight helper, prod-data claims softened) |
