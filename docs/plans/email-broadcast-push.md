# Email broadcast push (tracker "emailpush") — v2 post-Codex

Minimal-viable campaign push over email: an admin composes subject/body/CTA
about ONE campaign, picks a saved cohort, and the backend sends one clean
templated email to every reachable member — re-gating EVERY recipient through
the consent gate at send time, with the PR-B unsubscribe rails on every
message, throttled sending, and a persisted per-recipient send log.

Consumes: cohorts (#222/#223), consent ledger + PR-B unsubscribe rails,
`mailer.sendEmail`. Discharges the binding sender obligations of
`docs/plans/cohort-builder-backend.md` §5 for the email channel.

v2 folds a 25-finding Codex xhigh round (disposition table §10). The frame:
this is an admin-triggered, low-volume (≤5k), single-tenant tool on one
Render instance — we take every cheap correctness rail (CAS state machine,
at-most-once fence, address dedupe, erasure integration) and document the
fleet-scale items we deliberately do not build (§9).

## 1. Scope

In: composer (subject / body paragraphs / CTA label), cohort selection,
campaign selection (the campaign the message is ABOUT), send-time per-person
consent gate, per-address dedupe + address-level suppression check,
unsubscribe footer + verified `List-Unsubscribe` (+ One-Click) on every
send, sequential throttled sending with a CAS-guarded in-process worker,
cancel (emergency stop), resume after process death (never re-sending
ambiguous rows), send log (who/when/status/reason), erasure-matrix
integration, self-test-send, admin UI (list + composer + detail w/ log).

Out (non-goals, §9): scheduling, rich-text editor, A/B, merge fields beyond
first name, provider bounce/complaint webhooks, open/click tracking,
editable utm, multi-instance worker fleet, WhatsApp/SMS push ("wapush").

## 2. Data model — migration `085-email-broadcasts.js`

Migration follows 084's shape: `export async function up(queryInterface)`
only, raw SQL, `IF NOT EXISTS`-guarded, sync-tolerant; **indexes AND guarded
CHECK constraints mirrored per the 080 pattern; indexes also declared on
models** (test boot `sync({force:true})` runs before migrations).

`email_broadcasts` (model `EmailBroadcast`):
- `id` UUID pk (UUIDV4)
- `cohortId` UUID notNull, FK → `cohorts.id` ON DELETE RESTRICT (cohorts
  only soft-archive; sends keep their audit anchor)
- `campaignId` UUID **nullable**, FK → `campaigns.id` ON DELETE SET NULL
  (campaignService permanently deletes archived campaigns — history rows
  survive with the frozen `ctaUrl`/`subject`; a null campaign fails resume
  preflight, closing the gate correctly)
- `subject` STRING(200) notNull; `bodyText` TEXT notNull; `ctaLabel`
  STRING(80) notNull default 'Learn more'
- **Send-context snapshot, frozen at `preparing`** (cohortService's header
  contract: senders snapshot definition + context because cohort rows
  mutate): `definitionSnapshot` JSONB null (normalized definition with the
  gate campaign already overridden), `hostChoice` STRING(8) null
  ('redeem'|'mktr'), `emailContext` STRING(8) null, `ctaUrl` TEXT null.
  Worker + resume read ONLY the snapshot (+ row content), never live config.
- `status` STRING(16) notNull default 'draft' ∈ draft|preparing|sending|
  cancelling|completed|interrupted|failed|cancelled (guarded CHECK)
- `totalRecipients`/`sentCount`/`skippedCount`/`failedCount` INTEGER notNull
  default 0 (CHECK ≥ 0)
- `workerHeartbeatAt` DATE null (stale-lease detection, threshold 120s)
- `startedAt`/`completedAt` DATE null, `lastError` TEXT null
- `createdBy` UUID null FK → `users.id` SET NULL
- timestamps. Index `(status, createdAt)`.

`email_broadcast_recipients` (model `EmailBroadcastRecipient`) — send log +
per-recipient claim:
- `id` UUID pk
- `broadcastId` UUID notNull FK → `email_broadcasts.id` ON DELETE CASCADE
- `consumerId` UUID notNull FK → `consumers.id` (NO cascade action needed:
  erasure keeps an anonymized husk row, ids never vanish — retained-skeleton
  stance; person FKs deliberately stay meaningful)
- `email` STRING(320) null — address actually attempted (refreshed at send
  time, see §3.4); **nulled by erasure** (§5)
- `status` STRING(16) notNull default 'pending' ∈ pending|attempting|sent|
  skipped|failed (guarded CHECK)
- `reason` STRING(64) null — gate codes verbatim (`erased|suppressed|
  not_consented|not_verified|not_found`) + sender codes (`missing_email|
  duplicate_email|address_suppressed|unsub_token_error|send_error|
  ambiguous_crash|cancelled`)
- `error` TEXT null (transport message; **nulled by erasure**), `sentAt`
  DATE null. No `messageId` — nodemailer's result is discarded by the
  frozen `sendEmail` and we do not edit mailer.js.
- timestamps. Unique `(broadcastId, consumerId)`, index
  `(broadcastId, status)`.

`models/index.js` (additive): associations EmailBroadcast→Cohort/Campaign/
User(creator), EmailBroadcastRecipient→EmailBroadcast/Consumer; exports.

## 3. Send pipeline (`emailBroadcastService.js`)

Factory `makeEmailBroadcastService(overrides = {})` mirroring
`makeCohortService` — injectable `{ sequelize, models, sendEmail,
getTransporter, ensureUnsubToken, findConsumerByUnsubToken,
canMarketToBatch, listCohortMembers, normalizeDefinition, logger, sleep }`;
default instance + bound exports.

### 3.1 State machine (every transition a conditional UPDATE — CAS)

```
draft ──send──▶ preparing ──▶ sending ──▶ completed
  ▲                │              │            (outcome derived from counts)
  └──(preflight    │              ├──cancel──▶ cancelling ──▶ cancelled
      failure)◀────┘              ├──crash──▶ (stale heartbeat) ─▶ interrupted
                                  └──loop error──▶ failed
interrupted ──resume──▶ sending      interrupted/failed ──cancel──▶ cancelled
```

- Every transition: `UPDATE email_broadcasts SET status=? WHERE id=? AND
  status IN (...)` — `rowCount 0` → 409. No two processes can both win a
  transition; the module-level `activeSends` Set remains only as a cheap
  local short-circuit, not the fence.
- **One in-flight broadcast globally**: the draft→preparing CAS runs inside
  a txn that first counts `status IN ('preparing','sending','cancelling')`
  → 409 if any. Serializes sends AND makes the throttle globally true on
  the single-instance deployment (§9 for fleet caveats).
- PUT/DELETE: conditional on `status='draft'` → else 409. Worker re-reads
  the row after winning `preparing`, so it can never send stale in-memory
  content.
- Boot sweep (`bootstrap.js`, additive call): broadcasts in
  `preparing|sending|cancelling` with `workerHeartbeatAt` older than 120s
  (or null) → `interrupted` (+ their `attempting` rows → `failed/
  ambiguous_crash`). No auto-resume — a human presses Resume; nothing
  mass-sends on deploy.

### 3.2 preparing — preflight + materialize (all-or-back-to-draft)

1. Transporter configured (`getTransporter()` non-null) else revert +
   422-style error surfaced on the row (`lastError`).
2. Campaign exists, `status==='active'` AND `is_active===true` (the public
   surface's own gate — people land there); cohort exists, not archived.
3. CTA origin: `customerHostOrigin(normalizeCustomerHostChoice(
   design_config.customerHost))` MUST be https in production — a missing
   `PUBLIC_BASE_URL` must never leak a localhost link into real mail.
   Freeze snapshot: `definitionSnapshot` (normalized cohort definition with
   `marketingContext.campaignId := broadcast.campaignId` — §5 scope rule:
   the SEND is gated on the campaign the email is actually about),
   `hostChoice`, `emailContext` ('mktr' host → 'mktr', else 'redeem'),
   `ctaUrl` = origin + `/LeadCapture?` + `URLSearchParams({ campaign_id,
   utm_source:'mktr', utm_medium:'email',
   utm_campaign:'broadcast-'+id.slice(0,8) })`.
4. Resolve audience from the SNAPSHOT via `listCohortMembers(def, {
   channel:'email', status:'reachable', limit:200, offset })` paged
   back-to-back to exhaustion. Cap `EMAIL_BROADCAST_MAX_RECIPIENTS`
   (default 5000, clamped) → revert; 0 reachable → revert. Offset-paging
   drift under concurrent captures is accepted: it can only UNDER-claim
   (missed member = no mail — safe); over-claims are impossible (unique
   fence) and wrong sends are impossible (per-send gate). §9.
5. Bulk-insert claims `pending` (`ignoreDuplicates`), set
   `totalRecipients`, CAS → `sending`, fire worker (post-commit,
   fire-and-forget).

### 3.3 Worker loop — per recipient, throttled

Each iteration, in order:
1. **Heartbeat + cancel check** (one query): `UPDATE email_broadcasts SET
   workerHeartbeatAt=now() WHERE id=? AND status='sending' RETURNING
   status` — 0 rows → someone cancelled (or boot-swept): stop; if
   `cancelling`, CAS → `cancelled` (remaining rows get reason `cancelled`
   en masse, status stays their truth: `pending`→`skipped/cancelled`).
2. **Claim** (at-most-once fence): `UPDATE email_broadcast_recipients SET
   status='attempting' WHERE id=? AND status='pending'` — 0 rows → another
   worker took it, next. A crash from here until step 7 leaves
   `attempting` = ambiguous; resume NEVER retries it (→
   `failed/ambiguous_crash`). At-most-once per recipient, chosen
   deliberately over at-least-once (marketing mail: a missed send is
   recoverable, a double send is not).
3. **Destination refresh + dedupe**: reload consumer; current email through
   `emailNormKey` (synthetic `@calls.mktr.sg` → null). Missing → skip
   `missing_email`. Norm-key already attempted in THIS broadcast (in-memory
   Set, rebuilt from rows on resume) → skip `duplicate_email` (consumers
   are phone-keyed; two ids can share an address — one copy per address).
4. **Address-level suppression** (the "other consumer unsubscribed this
   address" hole): any OTHER consumer sharing the norm-key with a marketing-
   blocking `consumer_suppressions` row (`channel IN ('all','email')`) →
   skip `address_suppressed`.
5. **Send-time consent gate (§5 obligation)**: `canMarketToBatch(
   [consumerId], { channel:'email', campaignId: snapshotCampaignId })` →
   **`Map`**; `map.get(consumerId)` absent → fail closed
   (`not_found`); `.ok === false` → skip `reasons[0]`. Parity-proven ===
   `consentService.canMarketTo`; catches everyone who unsubscribed/was
   suppressed/erased between claim and send.
6. **Unsubscribe mint + VERIFY**: `ensureUnsubToken(consumerId)`, then
   `findConsumerByUnsubToken(token)` must return this consumer — else skip
   `unsub_token_error` (catches the known rotate-secret hash-mismatch
   without touching consentService; keyring rotation stays a platform
   follow-up). Marketing mail with a dead unsubscribe link is never sent.
7. **Send**: `sendEmail({to, subject, html, text, context:
   emailContext, headers})` with the PR-B pair `List-Unsubscribe:
   <url>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
   `result?.success === true` → `sent`+`sentAt` (email column updated to
   the address actually used); `success:false` (transporter vanished
   mid-run) → `failed/send_error` (no transport attempt was made); throw →
   `failed/send_error`+`error`. No per-recipient auto-retry — deterministic
   failures are visible in the log; a human decides.
8. **Throttle**: `await sleep(1000 / EMAIL_BROADCAST_RATE_PER_SEC)`
   (default 2, clamped 0.2–10).

Finalize: recount statuses from rows (authoritative), write counts,
`completedAt`, CAS `sending → completed`. Loop-level crash → `failed` +
`lastError` (rows keep truth). Always release the local lock. `completed`
means "worker finished" — the UI derives the outcome (all-sent / partial /
nothing-sent) from counts; it never claims delivery beyond SMTP acceptance.

Resume (`POST /:id/send {resume:true}`): allowed from `interrupted`, or
`sending` whose heartbeat is stale ≥120s (self-heal without waiting for a
boot). CAS → `sending`, sweep `attempting` → `failed/ambiguous_crash`,
rebuild the address-dedupe set from existing rows, re-enter the loop over
`pending` only. Resume NEVER re-resolves the audience or inserts rows.

### 3.4 Template (`emailBroadcastTemplate.js`, new file)

`renderBroadcastEmail({ subject, bodyText, ctaLabel, ctaUrl, brandName,
brandOrigin, unsubscribeUrl, recipientFirstName, testNotice })` →
`{ html, text }`. 600px single-column table in `getModernTemplate`'s visual
family (that fn is unexported; mailer.js untouched): greeting (`Hi
{firstName},` / `Hi there,`), paragraphs (blank-line split, **every field
HTML-escaped**, no raw-HTML path), one bulletproof CTA button, footer:
"You're receiving this because you signed up with {brandName}." +
unsubscribe link + `MKTR PTE. LTD. (UEN 202507548M), Singapore` identity
line. Text alt mirrors everything. Consented-recipients-only is a hard
invariant of the pipeline (gate at send), so this system never sends
unsolicited mail in the Spam Control Act sense; the platform-wide counsel
review (already pending for the consent chain) owns the final wording.

## 4. Endpoints — `routes/emailBroadcasts.js`, `meta.path='/api/email-broadcasts'`

`router.use(authenticateToken, requireAdmin)`; Joi local to the route file;
controller `emailBroadcastController.js` (`asyncHandler`, `{success,data}`)
— the cohort pattern verbatim.

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Create draft `{cohortId, campaignId, subject, bodyText, ctaLabel?}`; 422 phantom/archived cohort, phantom campaign |
| GET | `/` | List newest-first, cap 200, incl. cohort/campaign names |
| GET | `/:id` | Detail DTO: row + cohort `{id,name,definition}` + campaign `{id,name,status,is_active}` + computed ctaUrl preview for drafts |
| PUT | `/:id` | Draft-only (conditional update, else 409) |
| DELETE | `/:id` | Draft-only (else 409); hard delete |
| POST | `/:id/send` | Kick (draft) / `{resume:true}` (interrupted/stale) — 202-style; 409 on CAS loss or another broadcast in flight |
| POST | `/:id/cancel` | From preparing/sending → cancelling (worker stops ≤1 iteration); from interrupted/failed → cancelled directly |
| POST | `/:id/test` | Render + send ONE email **to the requesting admin only** (`req.user.email` — no address parameter), `[TEST] `-prefixed subject, visible test banner, unsubscribe link inert (`#`), logged via logger (actor/broadcast/time), not in the recipient log |
| GET | `/:id/recipients` | Send log, `?status=all\|pending\|attempting\|sent\|skipped\|failed`, paged ≤200 |

`'/api/email-broadcasts'` → `BLOCKED_PATH_PREFIXES` in
`internalRouteHostGuard.js` (NOT the ops allowlist). No feature flag —
additive admin-only routes (cohort posture); nothing sends without an
explicit admin action behind a confirm dialog. Live proof = 401 probe.

## 5. Erasure integration (`erasureService.js` — clean file, in scope)

`email_broadcast_recipients` joins the erasure matrix: for the erased
consumerId, null `email` + `error` (content about the person), keep
`status/reason/sentAt` + FK (delivery facts on the retained skeleton —
same stance as redemptions/commissions). The repair pass re-runs it by
construction. In-flight interplay: gate-at-send skips erased consumers;
the destination refresh (§3.3-3) sees the nulled email → `missing_email`.

## 6. Frontend (admin v2, same `VITE_ADMIN_V2_ENABLED` as cohorts)

- `src/api/adminV2.js`: `fetchEmailBroadcasts / fetchEmailBroadcast /
  createEmailBroadcast / updateEmailBroadcast / deleteEmailBroadcast /
  sendEmailBroadcast(id,{resume}) / cancelEmailBroadcast /
  testEmailBroadcast(id) / fetchEmailBroadcastRecipients(id,{status,limit,
  offset})` — thin `apiClient` fetchers.
- `AdminV2Broadcasts.jsx` — list (PageHeader + "New push"): subject, cohort,
  campaign, status chip, sent/skipped/failed, date. Composer dialog (shadcn
  Dialog + `av2-input`, sonner): cohort select (prefill `?cohort=`),
  campaign select — **active campaigns only** (filtered client-side from
  facets), defaulted from the cohort's stored gate scope; subject, body
  textarea, CTA label. Create → detail.
- `AdminV2BroadcastDetail.jsx` — status+counts tiles, frozen/preview CTA
  URL, **Send** behind `AlertDialog` confirm showing a live reachable
  estimate (`previewCohortDefinition(definition-with-campaign-override,
  'email')` on the definition from the detail DTO) AND the scope reminder:
  "This email must be about {campaign} — recipients consented to that."
  (the §5 free-form-copy obligation, surfaced at the moment of truth);
  **Cancel** while preparing/sending/cancelling; **Resume** when
  interrupted/stale; **Send test to my email**; recipients table (status
  filter + paging; reasons via cohort `reasonLabel` + local labels for the
  sender codes).
- `src/pages/index.jsx` (single-space indents): lazy `/AdminBroadcasts` +
  `/admin/broadcasts/:id`, cohort-route pattern. Nav: `{ to:
  '/AdminBroadcasts', label: 'Email Pushes' }` after Cohorts.
  `AdminV2CohortDetail.jsx` header gains **Push email** →
  `/AdminBroadcasts?cohort=<id>`.

## 7. Conflict posture (parallel sessions) — revised

Frozen (imports only, ZERO edits): `consentService.js`, `contactConsent.js`,
`middleware/validation.js` (uncommitted parallel work on the main checkout),
`cohortService.js`, `mailer.js` (stability; workarounds above are explicit:
no messageId, token verify-don't-fix, offset-paging acceptance).
In-scope edits (clean files, additive): `models/index.js`,
`internalRouteHostGuard.js`, `erasureService.js` (one matrix step),
`bootstrap.js` (one sweep call), `src/api/adminV2.js`, `src/pages/index.jsx`,
`src/lib/adminV2/nav.js`, `AdminV2CohortDetail.jsx` (one button).
New files: migration 085, 2 models, service, template, routes, controller,
2 pages, 4 test files. Branch `feat/email-broadcast`, isolated worktree.

## 8. Tests

Backend (real-Postgres jest, `test/helpers.js` boot; REAL cohortService +
consentService against the db — no simplified gate mocks; `sendEmail`/
`sleep` injected via factory):
- `emailBroadcastService.test.js`: happy path (counts, row statuses, PR-B
  headers present, escaping of `<script>` subject/body, CTA utm + 'mktr'
  host branch, from-context); gate-at-send skips (suppress AFTER claim →
  `suppressed`; scoped grant passes its campaign / skipped for another;
  erased → skip); destination refresh (email changed after claim → new
  address used + row updated; nulled → `missing_email`); two consumers one
  norm-key → one `sent` one `duplicate_email`; OTHER consumer's suppression
  on shared address → `address_suppressed`; unsub verify failure (corrupt
  stored hash) → `unsub_token_error`, nothing sent; `sendEmail`
  `{success:false}` → `failed/send_error`; throttle (`sleep` spy count);
  claim CAS (row pre-flipped to `attempting` → not re-sent); resume sweeps
  `attempting`→`ambiguous_crash`, sends only `pending`, never re-resolves
  (cohort edited between → membership unchanged); cancel mid-loop (status
  flip → worker stops, `pending`→`skipped/cancelled`); one-in-flight 409;
  inactive campaign (`is_active:false`, `status:'active'`) revert;
  empty-audience + over-cap revert; non-https CTA origin revert; finalize
  recount; boot sweep flips stale `sending`→`interrupted`.
- `emailBroadcastRoutes.test.js`: 401/403 everywhere; CRUD; draft-only
  PUT/DELETE 409; phantom cohort/campaign 422; double-send 409; cancel
  transitions; test-send goes to `req.user.email` only (no `to` accepted);
  recipients paging/filter; validation rejections; erasure integration
  (erase → recipient row email/error nulled, facts kept).

Frontend (vitest, mocked `@/api/adminV2`): `AdminV2Broadcasts.test.jsx`
(list, composer create, `?cohort=` prefill, active-only campaign options),
`AdminV2BroadcastDetail.test.jsx` (tiles, send-confirm calls
`sendEmailBroadcast`, cancel button by status, recipients + reasons).

## 9. Accepted limits (explicitly NOT built — single-instance posture)

- **Offset-paging audience drift** (Codex #11): under-send-only; exact
  `INSERT…SELECT` materialization needs a cohortService change — follow-up
  when volume warrants.
- **Multi-instance worker fleet** (#1/#14/#15 tails): CAS + heartbeat +
  one-in-flight give single-instance correctness and cross-instance
  *safety* (a second instance can't double-claim rows or run two
  broadcasts); a distributed limiter/lease-fencing beyond that waits for
  an actual second instance.
- **Provider bounce/complaint webhooks** (#19): no SES/SNS wiring exists
  platform-wide; manual admin suppression + address-level check cover the
  interim; volume is 3–4 digits, one broadcast at a time.
- **Unsub-secret keyring rotation** (#5 tail): pre-existing platform issue
  in frozen consentService; this sender VERIFIES tokens before sending so
  it can't ship dead links; keyring = platform follow-up.
- **Email-ownership verification** (#12 tail): consumers verify by phone
  OTP; email stays typo-prone. Accepted for consented low-volume pushes.
- Delivery beyond SMTP acceptance is unknowable without provider webhooks;
  statuses say so (`completed` + counts, never "delivered").

## 10. Codex round 1 (gpt-5.6-sol xhigh, 25 findings) — disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | BLOCKER no double-send fence | FOLDED §3.1/§3.3-2: CAS transitions, per-row conditional claim, heartbeat lease, one-in-flight |
| 2 | BLOCKER crash-after-SMTP resend | FOLDED §3.3-2: `attempting` fence, at-most-once, `ambiguous_crash` never retried |
| 3 | BLOCKER consumer-keyed dedupe/unsub | FOLDED §3.3-3/4: norm-key dedupe per broadcast + cross-consumer address suppression |
| 4 | BLOCKER raw email vs erasure | FOLDED §5: FK + erasure-matrix step (email/error nulled, facts kept) |
| 5 | BLOCKER unsub token after rotation | FOLDED §3.3-6 verify-before-send; keyring = platform follow-up (frozen file) |
| 6 | MAJOR batch return is a Map | FOLDED §3.3-5 (absent → fail closed); real gate in tests |
| 7 | MAJOR sendEmail return shape | FOLDED §3.3-7 (`success===true`), §3.2-1 transporter preflight; messageId dropped |
| 8 | MAJOR resume contradiction | FOLDED §3.1/§3.3: preparing≠resume, resume never re-resolves |
| 9 | MAJOR missing snapshots | FOLDED §2/§3.2-3: definition/host/context/ctaUrl frozen at preparing |
| 10 | MAJOR edit/send race | FOLDED §3.1: CAS first, conditional PUT/DELETE, worker re-reads row |
| 11 | MAJOR offset-paging drift | ACCEPTED §9: under-send-only; fence+gate prevent wrong sends |
| 12 | MAJOR stale destination | FOLDED §3.3-3 refresh; ownership verification accepted §9 |
| 13 | MAJOR localhost CTA / is_active | FOLDED §3.2-2/3: https-only origin, `status` AND `is_active` |
| 14 | MAJOR per-worker rate limit | FOLDED via one-in-flight; fleet limiter §9 |
| 15 | MAJOR webhook-posture claim false | FOLDED §3.1 boot sweep (no auto-resume); claim removed |
| 16 | MAJOR no emergency stop | FOLDED §3.3-1/§4: cancelling/cancelled + per-iteration check |
| 17 | MAJOR ungated test sends | FOLDED §4: self-only, logged, no address param |
| 18 | MAJOR free-form copy vs scope | SURFACED §6 confirm-dialog reminder + §3.2 snapshot; enforcement is human — documented operator obligation |
| 19 | MAJOR bounce/complaint loop | ACCEPTED §9 + §3.3-4 covers recorded suppressions; follow-up |
| 20 | MAJOR 'sent' ≠ sent | FOLDED: `completed` + derived outcome; delivery never claimed |
| 21 | MAJOR Spam Control Act breadth | FOLDED §3.4: consented-only invariant; wording → pending counsel review |
| 22 | MINOR CHECKs / FK actions | FOLDED §2: guarded CHECKs, campaign SET NULL, cohort RESTRICT |
| 23 | MINOR contract gaps | FOLDED §4 DTO / §6 active-only options + local reason labels / list cap |
| 24 | MAJOR test gaps | FOLDED §8 (single-process-provable set); fleet-harness items §9 |
| 25 | MAJOR frozen-files incompatibility | PARTIALLY FOLDED §7: erasureService+bootstrap now in scope; consent/cohort/mailer stay frozen with explicit workarounds |

## 11. Codex round 2 (gpt-5.6-sol xhigh, on the implementation diff) — disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | BLOCKER edit/send race (stale pre-CAS row into prepare) | FOLDED: reload after winning the CAS; edits are draft-conditional so the row is immutable from there |
| 2 | BLOCKER unsub/erasure commit between gate and SMTP | PARTIALLY FOLDED: post-write `repairRowIfErased` guarantees recipient rows never retain an erased person's PII (no manual re-erase needed). The residual ms-window send itself is ACCEPTED (§9): serializing sender/unsubscribe/erasure needs cross-service locks in frozen files; consent held at gate-time ms earlier, erasure repair-pass + suppression are the mop-up |
| 3 | BLOCKER stale resume lacks ownership fence | FOLDED: `workerLeaseId` minted per start/resume; heartbeat, finalizeCompleted and the crash handler are lease-keyed — a superseded zombie loses its next heartbeat and exits (≤1 in-flight send) |
| 4 | MAJOR one-in-flight NOT EXISTS write skew | FOLDED: both transitions run under `pg_advisory_xact_lock(870778002)` in a txn — concurrent starts/resumes serialize |
| 5 | MAJOR address dedupe not durable across crash | FOLDED (right-sized): the REFRESHED address is persisted on the row before transport, so resume's rebuilt set sees what was actually attempted. A durable per-address claim table (Codex's full design) stays out — single-instance, and erasure interplay would need claim-purge machinery |
| 6 | MAJOR cancel overwritten / rows mislabeled | FOLDED: `completed` only from `sending`+lease (loser lands the cancel); crash handler lands `cancelling→cancelled` before `sending→failed`; direct cancel terminalizes `attempting` as `ambiguous_crash` (never `skipped`); sweep lands stale `cancelling` in `cancelled`, never resumable |
| 7 | MINOR facets lack `is_active`; no stale-sending Resume in UI | ACCEPTED: facets live in frozen cohortService — the backend's loud 422 covers the picker gap; stale `sending` becomes `interrupted` (Resume button) within ≤5 min via the sweep |
| 8 | MINOR test gaps vs §8 promises | FOLDED: added erased-at-send, erased-during-SMTP repair, mktr-host branch, cancel-vs-complete landing, zombie-lease heartbeat, stale-cancelling sweep. True multi-process barrier harnesses stay out (§9 single-instance posture) |

## 12. Env / rollout / live proof

- `EMAIL_BROADCAST_RATE_PER_SEC` (default 2, clamp 0.2–10),
  `EMAIL_BROADCAST_MAX_RECIPIENTS` (default 5000, clamp 1–20000); defaults
  safe, no Render env change needed to ship.
- Deploys: backend (`mktr-backend-jo6r`) + `mktr-platform` static. Live
  proof: NEW deploys via `list_deploys`, then `api.mktr.sg/api/
  email-broadcasts` 401 probe + mktr.sg served-bundle grep for a unique
  string.
- Nothing sends on deploy; first real send is a human act behind a confirm.
