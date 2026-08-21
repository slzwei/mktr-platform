# Redeem Ops — Cadence email AUTO-SEND (shared Workspace outreach mailbox)

**Status:** v4 PLAN — no code. v1–v3 written 2026-08-11 from Shawn's calls (real auto-send;
shared outreach inbox on the `business@mktr.sg` Google Workspace; persona aliases on
redeem.sg; personas ARE the reps, `firstname@redeem.sg` for all six; Workspace directory
integrated into the platform, read-only, reusable). **v4 folds a 3-agent Fable 5 adversarial
review** (Google-API facts verified against official docs with URLs; engine integration
verified against code file:line; product/ops). Findings referenced as F# (Google), C#/M#/m#
(engine), P# (product). Trigger: the CRM drafts the email, snapshots the recipient, then makes
the rep copy-paste — "why insist on the email when there isn't even a send button?"

**Scope guard:** email steps only. Calls/WhatsApp/IG/visits stay manual tasks
(`docs/plans/redeem-ops-cadences.md` §1; §4.2 reserved `outreach_cadence_steps.mode='auto'`
"for P3 email" — the model carries it today, `backend/src/models/OutreachCadenceStep.js:10`).
NOT `mailer.js`/SES (`noreply@mktr.sg` = transactional identity; cold outreach from it is
deliverability poison and can't receive replies).

**The governing rule (Shawn, this morning): no silent actions, ever.** The adversarial review
found four ways v3 could still act silently (send reply-blind, send because a record field got
fixed, send stale text after an edit, send "Hi Test," unattended) — every one is closed below
and each closure is marked ⚑.

## 1. Product behavior (what a rep sees)

- The cadence **builder** gains, on email steps only: **Delivery: Manual task | Auto-send** and
  a **Subject** field (required for auto-send; merge fields allowed). Flipping a step to auto
  creates version N+1 as usual — in-flight enrollments stay pinned to their version (verified
  structural: `cadenceService.js:246-268`, `insertDefinitionTx` makes fresh step rows). The
  enroll dialog says it plainly when any step is auto: "steps marked auto are SENT by the CRM
  at the scheduled time", and those steps render as "Email — sends automatically" (P10).
- An enrollment reaching an auto email step still materializes a TASK: **"Scheduled email —
  CRM sends this — Fri 14 Aug · 10:00 · → owner@cafe.sg"** with the rendered message and a
  first-class inline **Don't send** button (= Convert to manual) plus **Send now · Edit
  message · Skip step** (Skip's confirm states it cancels the scheduled email). MyQueue gains
  a dedicated **"Scheduled sends"** group listing EVERY queued auto-send the rep owns
  (uncapped/with total — the 3-day/10-row upcoming bucket hides them otherwise,
  `queueService.js:80-83`); a send due <24h sorts atop Due today. The mobile strip renders the
  same distinct treatment ("Sends itself Fri 10:00" + Don't send) (P11).
- ⚑ **Approval ramp (P4)**: outbox rows support `needs_approval`. (a) The first N (default 10)
  sends of each cadence VERSION hold for one-tap approval on the card ("Approve · sends
  DATE"); (b) a data-lint forces approval regardless of N: contact/partner name in {test,
  asdf, single letter, contains digits}, body/subject carrying a fallback greeting ("Hi
  there"), disposable/test recipient domain. After N clean approvals the version runs
  unattended. This is a ramp, not a brake — the "Hi Test," screenshot is why it exists.
- At the due time the sender delivers from the rep's persona and **auto-completes the task
  with disposition `sent`** through the normal completion path — honest `email_sent` activity,
  NEW→CONTACTED, engine advances (or parks the NEXT step; that park surfaces via the
  `waitingOnInfo` queue bucket + partner banners — stated surfacing, no toast exists unattended,
  m3). Timeline shows the send with an "(auto-sent as emily@redeem.sg)" suffix and the audit
  row carries a machine marker (`requestId: autosend:<outboxId>`) — a rep can always prove "I
  didn't type this" (P16/m2). The card shows the message in-app (NOT a Gmail deep link — that
  only works signed into business@, F11).
- **A reply exits the cadence automatically** and is **auto-forwarded to the owning rep's real
  login mailbox** ("Reply from {partner} — {persona} thread", body = inbound text + partner
  deep link; `gmail.send` already granted, zero new infra) — the Replied queue bucket alone
  would mean "SLA = next time the rep opens the queue" (P7). The Replied card asks the rep to
  classify (interested / not now / **opt-out** → writes the suppression the keyword matcher
  may have missed, P18).
- **Failure is loud, never silent**: after retries the task flips back to a manual email task
  with a red "auto-send failed — send it yourself" badge (Copy message intact), surfaced in
  the queue.
- **Per-partner opt-out (P13)**: `autoEmailOptOut` on the business (Partner Detail toggle,
  audited) — auto steps materialize as plain manual email tasks ("manual only for this
  business"). For prospects who must never get machine-timed mail.
- Park semantics untouched: no email on record still parks with `blockedReason='no_email'`.

## 2. Sending identity & auth (Shawn's setup + Google-doc-verified mechanics)

**Topology: ONE Workspace account, persona aliases.** emily/tyler/jeremy/dara(/david/
jacqueline)@redeem.sg are alternate emails on `business@mktr.sg` (Shawn creates them manually;
four exist). Verified: aliases receive mail automatically, are free, no extra seat
(support.google.com/a/answer/33327). redeem.sg is a domain in the tenant.

- **The sending identity follows the rep**: Emily Wong's deals send as
  `"Emily Wong" <emily@redeem.sg>` (display name = full CRM name, editable per persona).
  `{{rep_name}}` keeps rendering the owner's FIRST name exactly as manual steps do today
  (`cadenceService.js:436`) — no special auto-send handling (nit-21 resolved: first name
  everywhere, From display name is the full name).
- ⚑ **Parentage pre-flight (F2 — CRITICAL)**: an alias only routes replies into business@ if
  it is business@'s OWN alias. Google forbids an alias sharing a name with an existing Google
  Account, and Tyler's CRM login is `tyler@redeem.sg` — if that address exists as its own
  Google ACCOUNT, it is NOT an alias: his replies would land in HIS mailbox (invisible to the
  §5 poll) and cross-account send-as brings SMTP verification friction + Google is
  deprecating third-party send-as (Jan 2027, support.google.com/mail/answer/22370). Phase A
  therefore asserts each persona address appears in `users.get('business@mktr.sg').aliases[]`
  SPECIFICALLY (parentage, not mere tenant existence) — and the §2a drift check stays
  parentage-aware. A persona that turns out to be its own account gets a SECOND
  `outreach_accounts` row impersonating THAT address (same DWD grant covers any subject; the
  §5 poller iterates accounts) — never cross-account send-as.
- **Send-as registration (F1 — CRITICAL, scope corrected)**: Gmail puts an alias on the From:
  line only if it's a registered "Send mail as" identity, and it is NOT auto-created
  (developers.google.com/workspace/gmail/api/guides/alias_and_signature_settings).
  Programmatic `sendAs.create` requires `gmail.settings.sharing` — an admin-restricted,
  wide-blast scope (delegates/forwarding) we deliberately do NOT take. Registration is
  **Shawn's one-time manual tick per persona** in Gmail settings (same-account aliases:
  no SMTP form expected; if Gmail asks for SMTP credentials, that address is NOT an alias —
  see parentage pre-flight). The platform VERIFIES via `sendAs.list`
  (`gmail.settings.basic` suffices) and requires `verificationStatus=accepted` before a
  persona can send (F6); the health card shows per-persona status.
- **DWD auth**: service account in GCloud project "MKTR Platform"; ONE grant
  (Admin console → Security → API controls → Domain-wide delegation) for scopes
  `gmail.send` + `gmail.readonly` + `gmail.settings.basic` + `admin.directory.user.readonly`.
  JWT flow verified (oauth2.googleapis.com/token, `sub=business@mktr.sg`, ≤1h assertion,
  ~3600s tokens; signed with the service-account key). ⚑ **Key-creation pre-flight (F5)**:
  newer GCP orgs enforce `iam.disableServiceAccountKeyCreation` by default — Phase A step 0 is
  "mint the key"; if blocked, lift the org policy for this project (runbook) — keyless
  `signJwt` impersonation needs an ambient GCP identity Render doesn't have. Key stored
  encrypted via a parameterized sibling of `backend/src/utils/aiCredentialEncryption.js`
  (own env key `OUTREACH_MAILBOX_ENCRYPTION_KEY`; the existing util hardwires its env var —
  build the key-source-parameterized twin, m8).
- **Shared-account ceiling (F7)**: Workspace sends ~2,000/day per ACCOUNT — alias and
  delegated sends count against it, and **hitting any limit can lock business@ out of sending
  for up to 24h** (Shawn's real mailbox). Hard account ceiling 500/day in
  `outreach_accounts.dailySendCap`, alert at 80% (§7b). External-recipient limit 3,000/day is
  the binding outreach number — 16× above plan volume.

**Onboarding a persona (runbook; the §7 Settings card walks through it):**
1. Shawn creates the alternate email on business@ in Admin console (done for four).
2. Shawn ticks "Send mail as" for it in Gmail settings (one-time; "treat as alias" on).
3. **Tie who-is-who in ops Settings**: pick the rep + display name + daily cap. REQUIRED
   before that rep's auto steps send — no persona ⇒ auto steps materialize as manual tasks
   with a "no sending persona assigned" badge, never a borrowed identity.
4. One-time domain checks: **DKIM for redeem.sg is non-negotiable** — without it Google signs
   with `d=*.gappssmtp.com`, which can never DMARC-align with redeem.sg, and SPF alignment
   alone dies under forwarding (F10; Admin console per-domain DKIM + Cloudflare DNS-only
   records); SPF `include:_spf.google.com` on redeem.sg; DMARC `p=none` → tighten after 2–4
   clean weeks. Register redeem.sg in **Google Postmaster Tools** (§7b).
5. DWD grant once (client ID + the four scopes, exact-match or token exchange fails).

### 2a. Workspace directory integration — SHARED platform module

- **`backend/src/services/google/workspaceService.js`** — generic, redeemOps-agnostic: DWD JWT
  auth + Directory reads: `listUsers()` (`emails[]`/`aliases[]` per user — verified fields),
  `listUserAliases(email)` (both calls accept `admin.directory.user.readonly` — verified),
  `listDomains()`, plus Gmail `sendAs.list`. Directory impersonation subject must be
  admin-capable — business@ is the tenant admin (verified requirement). Future features
  import the same module; at most add a scope to the one grant.
- **Read-only on purpose**: no `users.aliases.insert`, no `sendAs.create` (F1). Creating
  things in Google stays Shawn's manual Admin/Gmail step.
- **Endpoint**: `GET /api/redeem-ops/outreach/workspace-addresses` (`settings.manage`) — the
  live user/alias list for the Settings picker; the drift health check diffs configured
  personas against business@'s OWN `aliases[]` (parentage-aware, F2) and flags both ways.

## 3. Data model (migration 119 — next free verified; re-check collisions at build)

- **`outreach_accounts`** — one row now, more later (F2 escape hatch): `id, provider 'google',
  accountEmail (unique), encryptedCredentials, dailySendCap (default 500, F7), sentToday +
  sentTodayDate (SGT), historyCursor, lastSuccessfulPollAt (⚑ the sender's reply-loop health
  gate, §4/§8), lastHealthCheckAt, lastError, isActive, timestamps`.
- **`outreach_personas`** — `id, accountId FK, address (unique), displayName, assignedUserId
  (FK users, UNIQUE — reassignable), sendAsRegistered + sendAsVerified (from sendAs.list),
  isActive, dailySendCap (default 30), sentToday + sentTodayDate, consecutiveFailures (auto-
  disable at threshold, §7b), lastError, createdBy, timestamps`.
- **`outreach_emails`** (outbox; `webhook_deliveries` durable-retry clone —
  `backend/src/models/WebhookDelivery.js`, claim/`nextRetryAt`/recovery verified): `id, taskId
  (FK, partial-unique WHERE status IN (queued,sending,needs_approval)), cadenceEnrollmentId,
  partnerOrganisationId, contactId, personaId, accountId, toAddress, status
  queued|needs_approval|sending|sent|failed|cancelled, attempts, nextAttemptAt, approvedBy/
  approvedAt, wireMessageId, gmailMessageId, gmailThreadId, lastError, sentAt, timestamps`.
  ⚑ **No body/subject on the outbox row (C3/M3 — single source of truth)**: the worker renders
  what it sends FROM THE TASK at send time, after the atomic claim — task `description` = body
  (already editable via the generic PATCH, `taskService.js:155-166`) + new task
  `emailSubject` column (editable through the same PATCH allowlist; also fixes
  subject-uneditable, P14). While a row is `sending`, description/subject PATCHes 409
  ("sending right now") — an accepted edit is guaranteed to be the text that sends. The
  outbox stores the SENT copy post-send for the record. `autoSendFailed` is DERIVED from the
  outbox row status (no task column; list APIs join the outbox — decided, M7).
  ⚑ **Idempotency without trusting minted Message-IDs (F4)**: Gmail's API likely REWRITES
  caller Message-IDs (docs silent; strong secondary evidence). After 2xx: store the send
  response `id`/`threadId`, then `messages.get(format=metadata)` for the REAL wire
  `Message-ID` → `wireMessageId`; References/reply-matching use wire IDs only. Crash-window
  dedupe before any retry: search `in:sent to:<addr> after:<enqueue-epoch>` (+ subject) and
  scan `history.list` from the cursor — never `rfc822msgid:` on a minted ID. Phase A includes
  an empirical test-send settling whether minted IDs survive. Found-a-prior-send ⇒ mark sent
  AND still run the completion path (duplicate-completion 409s are safe, M5).
  Stale-`sending` reclaim after `STALE_SENDING_MS` on boot + poll (the webhookService part v3
  forgot to copy, `webhookService.js:596-616`, M5). FKs ON DELETE CASCADE from task/
  enrollment/partner (partner hard-delete relies on DB cascades, m11).
- **`outreach_cadence_steps.subjectTemplate`** (nullable STRING(160); REQUIRED when
  `mode='auto'`); **`outreach_cadence_enrollments.gmailThreadId`**; **`partner_organisations.
  autoEmailOptOut`** (P13). ⚑ **Threading (F3)**: the send passes `threadId` in the message
  resource AND sets References/In-Reply-To (wire IDs) AND reuses the first email's rendered
  subject ("Re: "-prefixed) — Gmail requires all three to thread; per-step subjects on
  threaded follow-ups fork conversations, so the builder warns and the sender ignores a
  divergent subjectTemplate on threaded sends.
- Caps enforced atomically: single conditional UPDATE on the persona/account row (SGT
  rollover + increment + cap in one statement) — read-then-send races across concurrent
  attempts otherwise (m5).

## 4. Engine integration (verified against `cadenceService.js` as of PR #439)

- **Materialization**: unchanged for manual steps. `mode='auto'` email steps (unless partner
  `autoEmailOptOut` or assignee has no persona → manual task, loudly badged): create the task
  exactly as today + enqueue the outbox row (`nextAttemptAt = task.dueAt`, ±10 min jitter) in
  the same transaction. Parked steps enqueue nothing.
- ⚑ **Automatic resume never insta-sends (P2 — CRITICAL)**: the contact-info hook/reconciler
  resuming INTO an auto step schedules the send no sooner than the NEXT send window ≥1 hour
  out, and the park banner/toast copy for auto steps reads "Scheduled email — will send
  DATE TIME unless you cancel". A rep's explicit Retry-now on an auto step relabels to
  **"Send email now"** with a confirm showing the rendered message — it IS a send button, so
  it must look like one.
- **Sender worker**: 60s interval + boot recovery inside bootstrap's `NODE_ENV !== 'test'` +
  `REDEEM_OPS_ENABLED` + cadence-engine nesting (`bootstrap.js:322-358` pattern; autosend-on
  with cadences-off logs a boot warning, m9). Atomic claim (conditional UPDATE … RETURNING).
  ⚑ **Refuses ALL sends unless the reply loop is healthy**: inbox polling enabled AND
  `lastSuccessfulPollAt` < 10 min old (P1 — Phase B can never ship reply-blind; also covers
  poller death/DWD revocation mid-flight).
- **Send-time revalidation (per attempt, everything reloaded)**: enrollment `active`; task
  open AND still the enrollment's current step; partner not merged/archived/LOST and not
  `autoEmailOptOut`; ⚑ recipient RE-RESOLVED via `resolveRecipientTx` — changed address ⇒
  cancel to manual "recipient changed — review before sending", none ⇒ cancel + park
  `no_email` (P5); persona active + sendAs verified + **still the task assignee's currently-
  assigned persona** (Settings re-mapping guard, M6) — actor built from the RELOADED task's
  `assigneeUserId` (m1); suppression re-check (`isSuppressedTx` — export it from the service,
  m4); persona + account caps (atomic); SGT window sanity. ⚑ For threaded sends
  (enrollment has `gmailThreadId`): `threads.get` first — any message in the thread not sent
  by us ⇒ abort to manual (closes the unpolled-reply race, P8). Any terminal failure ⇒ cancel
  the outbox row, task stays/became manual, loudly.
- **After 2xx**: store ids + wire Message-ID (§3), then auto-complete via
  `completeCadenceTask(taskId, {disposition:'sent'}, ownerAsActor)` — verified to pass every
  gate (engine review "verified correct" #2–4). ⚑ **The orphaned-send window (C1 —
  CRITICAL)**: if completion 409s because the world moved during the SMTP call (paused/
  stopped/skipped mid-send), the send STILL HAPPENED — fall back to direct
  `logActivityTx(email_sent, outbound, suppressCadenceHooks)` + outbox `sent` + audit action
  `cadence.email_sent_orphaned`. The timeline never loses a real email. Residual accepted
  race: a row already CLAIMED (`sending`) cannot be cancelled — the pause/stop happened
  during the seconds of the SMTP call; the orphan record is the honest outcome.
- ⚑ **Cancellation coherence — complete list**: one helper cancels `queued`/`needs_approval`
  outbox rows, called from `endEnrollmentTx`, `pauseEnrollment`, `skipCurrentStep`,
  `onSnooze` (the four verified cancel sites) **and `completeCadenceTask` (any disposition)**
  — the rep who sent it themselves must kill the queued machine-send in the same transaction
  (C1b/M2/P19); flag-off runs a reaper that cancels queued rows and flips their tasks to
  manual with the failed-badge treatment — turning the feature off converts the backlog to
  visible human work, not silent limbo (P6). Reassign re-points queued rows only after
  RE-RENDERING body/subject templates for the new owner (else From says Tyler, signature says
  Emily — simpler alternative: drop to manual for review, P17; build whichever is smaller,
  stated in the PR).
- **Send now**: reuses the SAME outbox row via the same atomic claim (no parallel path),
  counts against caps, MAY override the SGT window (rep-initiated = deliberate) (P15).

## 5. Replies, bounces, unsubscribes

- **Polling v1** (no new infra): every 2 min per ACCOUNT row (F2 may add tyler's), Gmail
  `history.list` from `historyCursor` (`historyTypes=messageAdded`, `labelId=INBOX`);
  ⚑ **404 ⇒ full re-sync re-baseline** (documented requirement, not an option — cursor can
  expire; bootstrap cursor from `getProfile`, F8). Quota verified trivial (poll 2 units;
  send 100; 80M/day project budget, F9). Update `lastSuccessfulPollAt` on every clean pass —
  the sender's health gate reads it.
- **Matching**: `threadId`/`References` (wire IDs) against `outreach_emails`. ⚑ Before
  logging, chase `partner.mergedIntoId` to the SURVIVOR (enrollment rows are never repointed
  by merge — verified `partnerService.js:838-845` — and `logActivityTx` 404s on merged rows,
  M4); log on the survivor, whose live cadence then exits via the hook. Unowned partner
  (released): log with system actor via the reassign escape-hatch path — define once in the
  PR; never drop the reply.
- Match ⇒ `logActivityTx(email_reply, inbound)` under the partner lock → `onInboundActivity`
  exits (`replied`), open tasks cancelled (verified) → **auto-forward to the rep's login
  mailbox** (§1/P7). Unmatched human mail to persona addresses ⇒ Settings health-card count
  (filtered `To: *@redeem.sg` so ordinary business@ mail doesn't inflate it).
- **Bounces**: DSN in a tracked thread ⇒ outbox `failed(bounced)` + **upsert** (unique
  (channel,value), m10) `outreach_suppressions (email, bounced)` — the table's FIRST writer
  (verified zero writers today). **Unsubscribe**: conservative keyword list ⇒ suppression
  `(email, opt_out)` + exit; plus the Replied-card classification writes what keywords miss
  (P18).
- **P2 upgrade**: Gmail watch + Pub/Sub (re-`watch` daily — expiry duty, F12).

## 6. Deliverability & Singapore compliance

- ⚑ **Account-level warm-up (P9)**: `outreach_accounts` cap starts 30–50/day TOTAL (not
  30×6), +~50%/week toward 300–400 under the hard 500 ceiling (F7); 2–3 personas active in
  week 1, stagger the rest. Accepted trade-off, stated once: outreach rides the consumer
  brand's root domain — a spam-listing hits redeem.sg itself (subdomain personas rejected:
  the aliases already exist).
- Plain-text, personalized 1:1, real reply-to. Footer: `MKTR PTE. LTD. · reply "unsubscribe"
  to opt out`. Spam Control Act posture (P20, decided once): functional opt-out (footer +
  keyword + send-time suppression re-check — all three mandatory), accurate sender identity;
  `<ADV>` labeling consciously NOT adopted for genuinely individualized 1:1 B2B prospecting
  at modest volume — chosen, not missed. PDPA business-contact exception covers the
  addresses.

## 7. UI + API inventory (per M1/M7 — the concrete touchpoints)

- **Backend routes** (new `redeemOpsOutreach.js`, `meta.flag REDEEM_OPS_EMAIL_AUTOSEND_ENABLED`
  + inner `REDEEM_OPS_ENABLED` guard, house pattern): workspace-addresses (§2a); personas
  CRUD/import/health/test-send (`settings.manage`); outbox: approve, send-now,
  convert-to-manual (`tasks.manage` + owner-or-admin row rules); task PATCH gains
  `emailSubject` in `CADENCE_EDITABLE`.
- **Builder/validator — the five layers v3 hand-waved (M1)**: Joi `stepSchema`
  (`cadenceController.js:38-46`) + `validateBuilderDefinition` (auto⇒email-only,
  subject-required, subject merge-field allowlist; `cadenceService.js:160-196`) +
  `insertDefinitionTx` copies mode/subject (`:203-207`) + frontend round-trip
  `cadenceBuilder.js` (`emptyStep`/`toBuilderSteps`/`toPayload`) + `CadenceEditorPage.jsx`
  Delivery toggle/Subject field + `cadenceAiService.js` DRAFT_SCHEMA/normalize emit subjects
  (drafts default Manual — flipping to auto is human).
- **Task surfaces**: `taskService.listTasks` + `queueService.getMyQueue` join the live outbox
  row (scheduled/needs_approval/failed states); queue "Scheduled sends" group; card
  actions per §1; in-app sent-message view (no Gmail deep link, F11).
- **Settings → Outreach personas** card (`settings.manage`): account health (poll age, DWD
  ok, key fingerprint), personas (address, rep, send-as/verification status from
  `sendAs.list`, caps, sent-today, consecutive failures), Import-from-Workspace picker
  (parentage-aware, §2a), per-persona Send test email. Optional garnish: Team page column
  "sends as emily@redeem.sg".
- **Flags**: `REDEEM_OPS_EMAIL_AUTOSEND_ENABLED` + `VITE_REDEEM_OPS_EMAIL_AUTOSEND_ENABLED`
  (twin pattern), ship dark.

### 7b. Operating it (P12 — the runbook §2 stops at day 1)

Postmaster Tools registered + checked weekly during warm-up · circuit breaker: trailing
bounce-rate >4–5% or any complaint signal ⇒ auto-pause the ACCOUNT (not just a persona), ping
Shawn · per-persona auto-disable after N consecutive failures (webhook precedent: 50 — use
lower, e.g. 10) · spam-placement playbook: halve caps, pause worst persona, check Postmaster,
re-warm · DWD key lifecycle: the key impersonates the tenant admin with read access to the
ENTIRE business@ inbox — crown jewels; rotate on any exposure, rotation steps documented,
encrypted row readable by no endpoint · offboarding: deactivating a rep auto-deactivates
their persona, queued rows drop to manual/reassign, alias keeps receiving (replies still
match) · alert when queued rows sit past `nextAttemptAt` + 15 min (worker wedged) or
`lastSuccessfulPollAt` goes stale.

## 8. Phasing (each = one PR, tests, review, dark)

- **A — Foundations**: pre-flights (service-account key mintable F5; parentage of all six
  aliases F2; sendAs status F6; empirical minted-Message-ID test F4); migration 119;
  `google/workspaceService`; encryption twin; persona service + Settings card + import +
  test-send. No engine changes. Independently valuable (the Workspace address listing Shawn
  asked for).
- **B — Outbox + sender + approval ramp + builder**: everything in §3/§4/§7; bounce/unsub
  suppression writers ride HERE not C (parent-plan precondition "bounce→suppression before
  auto mode", m6) — DSN detection needs the poll, so:
- **C — Inbox loop**: polling, reply-exit, forwards, health. ⚑ **The flag stays OFF until C
  is merged and green — enforced in code**: the sender refuses to claim while the reply loop
  is dark (§4). B alone can never send.
- **Rollout pilot (P10)**: flip with ONE persona active + ONE cadence flipped to auto; ≥1
  week; review outbox/spam placement (seed addresses)/reply matching; then stagger personas
  (§6 warm-up).
- **D — Later**: Pub/Sub push (F12), open/click via the tracked-link spec (draft PR #157 —
  spec lives on that unmerged branch, not in-tree, m7), per-rep accounts if parentage
  pre-flight forces them anyway (F2), more personas.

## 9. Open questions for Shawn

1. ~~Persona voice~~ / 2. ~~who-is-who~~ — RESOLVED (roster §2; personas are the reps).
3. Warm-up: OK with ACCOUNT-level 30–50/day total to start (not 30/persona — review finding)?
4. Unmatched inbox mail: leave in Gmail + Settings counter (default), or forward?
5. Confirm redeem.sg DKIM in Admin console (F10 makes this non-negotiable before real sends).
6. **NEW (F2): is `tyler@redeem.sg` its own Google account** (he signs into Google with it?)
   or a true alias under business@ like the rest? Phase A's parentage pre-flight answers this
   definitively either way — if it's an account, Tyler rides a second account row (handled,
   no redesign).
7. **NEW (P4): approval ramp default N=10 first sends per cadence version** — comfortable?

## 10. Explicitly out of scope

WhatsApp/IG/call auto-anything; SES/`mailer.js`; HTML templates; open/click tracking (D);
`gmail.settings.sharing` scope and any programmatic creation of Google-side objects;
migrating existing manual email steps (authors flip them, version-bumps).
