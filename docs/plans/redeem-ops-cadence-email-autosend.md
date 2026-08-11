# Redeem Ops — Cadence email AUTO-SEND (shared Workspace outreach mailbox)

**Status:** v1 PLAN — no code. Shawn's call (2026-08-11): real auto-send for cadence email
steps via a **shared outreach inbox** on the company's Google Workspace (the Workspace is the
`business@mktr.sg` account; outreach mailboxes live on the **redeem.sg** domain with persona
addresses, e.g. `emily@redeem.sg`). Plan-first per house loop (plan → adversarial review →
implement). Trigger: the CRM drafts the email, snapshots the recipient, and then makes the rep
copy-paste it into a mailbox by hand — "why insist on the email when there isn't even a send
button?" (screenshot of `Email a simple summary of the Redeem offer`, 11 Aug).

**Scope guard:** email steps only. Calls/WhatsApp/IG/visits stay manual tasks — that is the
cadence engine's design (`docs/plans/redeem-ops-cadences.md` §1 "all steps are manual tasks in
v1"; §4.2 already reserved `outreach_cadence_steps.mode = 'auto'` "for P3 email" — the model
carries it today, `backend/src/models/OutreachCadenceStep.js:10`). This plan is that P3, scoped
to the shared-mailbox decision. Explicitly NOT `mailer.js`/SES (`noreply@mktr.sg` is a
transactional identity: replies impossible, cold-outreach deliverability poison).

## 1. Product behavior (what a rep sees)

- The cadence **builder** gains, on email steps only: **Delivery: Manual task | Auto-send** and
  a **Subject** field (required for auto-send; merge fields allowed). Editing an existing
  cadence to flip a step to auto creates vN+1 as usual — in-flight enrollments stay on their
  pinned version (no surprise sends on live runs).
- An enrollment reaching an auto email step still materializes a TASK (visibility is
  non-negotiable): the queue/business page shows **"Scheduled email — sends Fri 14 Aug ·
  10:00 · → owner@cafe.sg"** with the rendered message, and actions **Send now · Edit message ·
  Convert to manual · Skip step**. "Edit message" edits the frozen snapshot (task description)
  before send; after send it's read-only history.
- At the due time the sender delivers it from the shared mailbox and **auto-completes the task
  with disposition `sent`** through the normal completion path — honest `email_sent` activity,
  NEW→CONTACTED auto-move, engine advances to the next step. Timeline reads exactly like a
  manual send logged by the rep.
- **A reply exits the cadence automatically** (existing `onInboundActivity` hook) and pings the
  owner — the shared inbox is monitored by the system, not by a human tailing Gmail.
- **Send failure is loud, never silent** (2026-08-11 no-silent-anything rule): after retries
  the task flips back to a plain manual email task with a red "auto-send failed — send it
  yourself" badge, surfaces in the queue, and the rep proceeds by hand (Copy message stays).
- Park semantics untouched: no email on record still parks with `blockedReason='no_email'`
  (now with a stronger reason to exist — the CRM itself needs the address to send).

## 2. Sending identity & auth (Shawn's setup, confirmed 2026-08-11)

**The real topology: ONE Workspace account, MANY persona aliases.** The personas
(`emily@redeem.sg`, `tyler@redeem.sg`, `jeremy@redeem.sg`, `dara@redeem.sg`, …) are **alternate
emails on the single `business@mktr.sg` account** — Shawn creates them manually in Admin
console; they already exist. redeem.sg is therefore already a domain/domain-alias in the
tenant. Consequences the design leans on:

- **The sending identity follows the persona working the deal**: if the rep maps to Emily, the
  mail goes out as `"Emily" <emily@redeem.sg>` — From name AND address are the persona's, and
  `{{rep_name}}` in an AUTO-sent body resolves to the persona's display name so the signature
  matches the envelope (manual steps keep resolving to the CRM rep as today).
- **One auth, one inbox**: the service account impersonates `business@mktr.sg` only. All
  persona aliases deliver replies into that single inbox, so the §5 polling loop watches ONE
  mailbox and attributes replies to personas via our outbox rows/`To:` header. No extra
  Workspace seats — aliases are free.
- **Send-as registration**: Gmail only puts a `From:` alias on the wire if that address is a
  registered "Send mail as" identity on `business@mktr.sg`. Same-account alternates verify
  instantly; Phase A registers any missing persona programmatically via the Gmail
  `settings.sendAs` API (DWD scope `gmail.settings.basic`) — or Shawn ticks them once in Gmail
  settings. The Settings health card shows each persona's send-as status.
- **Shared-account limits**: Gmail's ~2,000/day Workspace ceiling is per ACCOUNT — all personas
  share it. Our per-persona warm-up caps (§6) sit far below it, but the sender also enforces an
  account-level sum.

**Auth: Google service account with domain-wide delegation (DWD), impersonating
`business@mktr.sg`.** Service account in the existing GCloud project "MKTR Platform" (the one
holding OAuth client `917664265015-…`); DWD grant in admin.google.com for `gmail.send` +
`gmail.readonly` + `gmail.settings.basic`. Key stored encrypted server-side via the
`backend/src/utils/aiCredentialEncryption.js` pattern with its **own** env key
(`OUTREACH_MAILBOX_ENCRYPTION_KEY` — never reuse `AI_SETTINGS_ENCRYPTION_KEY`; rotating one
must not brick the other). Fallback documented but not built: OAuth connect flow à la the Meta
"Connect Facebook" pattern (#435–#437), only if DWD is refused.

**Onboarding a persona (runbook — §7's Settings card walks through this):**
1. Shawn creates the alternate email on `business@mktr.sg` in Admin console (his existing
   manual step — already done for the four above).
2. Persona registered as a Gmail "Send mail as" identity (automatic in Phase A, or manual).
3. **Tie who-is-who in ops Settings**: assign the persona to a CRM rep (User) + display name +
   daily cap. This mapping is REQUIRED before that rep's auto steps can send — an auto step
   whose assignee has no persona falls back LOUDLY to a manual task ("no sending persona
   assigned"), never picks one silently.
4. One-time domain checks: DKIM for redeem.sg generated in Admin console + published on
   Cloudflare (**DNS-only**), SPF `include:_spf.google.com` on redeem.sg, DMARC `p=none` →
   tighten after 2–4 clean weeks.
5. DWD grant for the service-account client ID (once, not per persona).

## 3. Data model (one migration, next free number at build time — check collisions per house rule)

- **`outreach_personas`** — admin-managed in Settings (`settings.manage`), one row per alias:
  `id, address (unique, e.g. emily@redeem.sg), displayName ('Emily'), assignedUserId (FK users,
  UNIQUE — the who-is-who tying; one persona per rep, reassignable), sendAsRegistered,
  isActive, dailySendCap (warm-up ramp, default 30), sentToday + sentTodayDate (SGT-keyed),
  lastError, createdBy, timestamps`. The shared ACCOUNT (`business@mktr.sg`) + encrypted DWD
  credentials live in ONE `outreach_accounts` singleton row (provider 'google', accountEmail,
  encryptedCredentials, historyCursor for §5 polling, lastHealthCheckAt) — personas FK it, so
  a second account later (per-domain, per-team) is schema-free.
- **`outreach_emails`** — the OUTBOX, cloned from the proven `webhook_deliveries` durable-retry
  shape (`backend/src/models/WebhookDelivery.js` — persisted `nextRetryAt`, `(status,
  nextRetryAt)` index, atomic pending→sending claim, boot + interval recovery poll):
  `id, taskId (FK outreach_tasks, partial-unique WHERE status IN (queued,sending) — one live
  send per task), cadenceEnrollmentId, partnerOrganisationId, contactId, personaId, toAddress,
  subject, bodyText, messageIdHeader (our own RFC Message-ID, minted at enqueue — makes retry
  idempotency CHECKABLE: before any retry, search Gmail for it; found ⇒ mark sent, never
  double-send), gmailMessageId, gmailThreadId, status queued|sending|sent|failed|cancelled,
  attempts, nextAttemptAt, lastError, sentAt, timestamps`.
- **`outreach_cadence_steps.subjectTemplate`** (nullable STRING(160)) — subjects for email
  steps, merge fields allowed; REQUIRED by validation when `mode='auto'`. (`mode` itself
  already exists — no schema change.)
- **`outreach_cadence_enrollments.gmailThreadId`** (nullable) — first sent email stores it;
  later auto emails in the same enrollment send with `In-Reply-To`/`References` so the
  prospect sees ONE thread, and reply-matching gets trivial.

## 4. Engine integration (the part that must not corrupt cadence semantics)

- **Materialization** (`placeAtStepTx` → `tryMaterializeTx`): unchanged for manual steps. For
  `mode='auto'` email steps: create the task exactly as today (recipient snapshot, rendered
  body, dueAt via `sgtWindowClamp`) **plus** enqueue an `outreach_emails` row with
  `nextAttemptAt = task.dueAt` in the same transaction. Park/suppression logic runs first and
  unchanged — a parked step enqueues nothing.
- **Persona resolution at enqueue**: the task's assignee (= partner owner, engine invariant) →
  their assigned persona. No persona ⇒ NO outbox row; the task materializes as a plain manual
  email task with a "no sending persona assigned" badge + Settings nudge (loud, never a
  silently-borrowed identity). Reassign hook re-points open tasks today; Phase B extends it to
  re-point queued outbox rows to the new owner's persona (or drop to manual if none).
- **Sender worker**: in-process interval (60s) + boot recovery, exactly the webhook-queue
  pattern (`MAX_CONCURRENT` small, claim via conditional UPDATE … RETURNING). Per attempt it
  RELOADS everything and re-validates before sending: enrollment still `active`, task still
  `open|in_progress` and still the enrollment's current step, partner not merged/archived/LOST,
  persona active + send-as registered + under `dailySendCap` (and the shared account under its
  ceiling), recipient not in `outreach_suppressions`
  (**re-checked at send time**, not just materialization), and — send-window honesty — `now`
  within a sane SGT window (dueAt is already window-clamped; add ±10 min jitter so sends don't
  all fire at :00). Any check fails terminally ⇒ cancel the outbox row, leave the task manual.
- **After a 2xx send**: store `gmailMessageId/ThreadId`, then auto-complete via
  `completeCadenceTask(taskId, { disposition: 'sent' }, ownerAsActor)` — the engine's existing
  "owner stands in for system contexts" precedent (cadenceService materialization actor
  fallback) satisfies the assignee check; everything downstream (activity, NEW→CONTACTED,
  advance, park-at-next-block) is the one battle-tested path. No parallel completion code.
- **Failure ladder**: retry 3× exp backoff (network/5xx only, never 4xx — mirror
  `graphFetch`'s rule from the WhatsApp hardening); exhausted ⇒ outbox `failed`, task stays
  open flagged `autoSendFailed` (snapshot field on the task or derived from outbox status),
  queue surfaces it, rep sends manually and logs the outcome. Restart loses nothing (durable
  rows + recovery poll).
- **Cancellation coherence**: every path that cancels open cadence tasks today (pause, stop,
  skip, exits via hooks, reassign keeps) must ALSO cancel `queued` outbox rows for those tasks
  — one helper called from `endEnrollmentTx`/pause/skip/onSnooze so a paused cadence can never
  fire an email mid-snooze. (The send-time revalidation is the backstop; the cancel is the
  correctness statement.)

## 5. Replies, bounces, unsubscribes (why this needs the inbox, not just SMTP)

- **v1: polling, no new infra — and only ONE inbox to watch.** Every persona alias delivers
  into `business@mktr.sg`, so a single 2-min poll covers all of them (history cursor persisted
  on the `outreach_accounts` row); match `threadId` / `In-Reply-To` / `References` against
  `outreach_emails` (whose row also names the persona, for attribution). Match ⇒
  `logActivityTx(type email_reply, direction inbound)` under the partner lock — the existing
  `onInboundActivity` hook exits the cadence (`replied`) and cancels open tasks; owner sees it
  in "Replied — keep the momentum". Unmatched human mail ⇒ listed on a small Settings
  "Outreach inbox" health card (count + deep-link to Gmail) — nobody has to tail the mailbox
  raw. (Note the shared inbox also receives `business@mktr.sg`'s own unrelated mail — the
  matcher only ever acts on tracked threads; unmatched counting can filter to `To:
  *@redeem.sg` personas so ordinary business mail doesn't inflate the counter.)
- **Bounces**: mailer-daemon/DSN in a tracked thread ⇒ outbox `failed(bounced)` + write
  `outreach_suppressions (channel email, reason bounced)` — the FIRST real writer for that
  table (it exists with zero write paths today; the engine already reads it pre-send). Partner
  card then parks honestly on the next email step.
- **Unsubscribe**: reply containing unsubscribe/remove-me (simple keyword list, conservative)
  ⇒ suppression `(email, opt_out)` + cadence exit; plus a standing footer line (see §6).
- **P2 upgrade path**: Gmail watch + Pub/Sub push (instant, no polling) — same matching code.

## 6. Deliverability & Singapore compliance (flagging once, then building pragmatically)

- Warm-up: `dailySendCap` starts 20–30/day per persona, +10/wk to ~100; enforced in the claim
  query alongside the shared-account ceiling (§2). Plain-text bodies (scripts already are),
  personalized 1:1, real reply-to. From: the persona's display name + alias, e.g.
  `"Emily" <emily@redeem.sg>` (§2, resolved).
- Spam Control Act: these are individualized B2B messages, not bulk blasts, but we adopt the
  safe posture anyway — accurate sender identity, a one-line footer
  (`MKTR PTE. LTD. · reply "unsubscribe" to opt out`), functional opt-out via §5, suppression
  honored before every send. PDPA business-contact-info exception covers the B2B addresses we
  hold. Flagged once here; not re-litigated per send.

## 7. UI inventory

- **Settings → Outreach personas** card (`settings.manage`): the persona list (address,
  display name, **assigned rep** — the who-is-who tying, one persona per rep, reassignable),
  send-as status, daily cap + sent-today, account health (last poll/send/error), **Send test
  email** per persona. Onboarding checklist from §2 inline.
- **Builder/editor**: Delivery toggle + Subject on email steps; validation (auto ⇒ subject
  required, subject merge-fields same allowlist as body); AI drafter (`cadenceAiService`) emits
  subjects for email steps (small prompt/schema addition; drafts stay Manual by default —
  flipping to auto is a human act).
- **Task surfaces** (queue/tasks/business page/mobile strip): scheduled-email rendering +
  Send now / Edit message / Convert to manual / Skip step; failed badge; sent steps show as
  completed with the thread link (`https://mail.google.com/mail/u/0/#all/<threadId>`).
- Flags: `REDEEM_OPS_EMAIL_AUTOSEND_ENABLED` (backend master + worker) and
  `VITE_REDEEM_OPS_EMAIL_AUTOSEND_ENABLED` (builder toggle + surfaces) — twin-flag pattern,
  ships dark.

## 8. Phasing (each = one PR, tests, review, dark until the flag flips)

- **A — Mailbox + transport** (migration, `outreachMailboxService`, DWD client, encryption,
  Settings card, test-send). No engine changes. ~1 PR.
- **B — Outbox + sender + auto-complete** (materialization enqueue, worker, retries,
  failure→manual, cancellation coherence, builder Delivery/Subject, task surfaces). The big
  one. ~1–2 PRs.
- **C — Inbox loop** (polling, reply→exit, bounce/unsub→suppression, health card). ~1 PR.
- **D — Later**: Pub/Sub push, open/click via the KIV'd tracked-link spec
  (`docs/plans/redeem-ops-cadence-link-engagement.md` dovetails here), more personas
  (`marcus@redeem.sg`…) with rotation, per-rep identities.

## 9. Open questions for Shawn (needed before Phase A)

1. ~~Persona vs rep voice~~ **RESOLVED, then SIMPLIFIED 2026-08-11**: the "personas" are the
   REPS THEMSELVES — every team member sends as their own first name on redeem.sg ("all
   @redeem.sg", roster screenshots), no matter which address they log in with (most log in
   @mktr.sg; Tyler already logs in as tyler@redeem.sg). So From, body signature and the human
   on the follow-up call are the same person — `{{rep_name}}` needs no special auto-send
   handling at all. Aliases hang under `business@mktr.sg` (Shawn creates them manually).
2. ~~Who-is-who mapping~~ **RESOLVED 2026-08-11** — seed from the team roster, matched by
   first name, assignment stays editable in Settings:
   | CRM user | Sends as |
   |---|---|
   | Emily Wong (emily@mktr.sg) | emily@redeem.sg |
   | Jeremy Ho Wei Kang (jeremy@mktr.sg) | jeremy@redeem.sg |
   | Dara Tia (dara@mktr.sg) | dara@redeem.sg |
   | Tyler Lim Yang Zhe (tyler@redeem.sg) | tyler@redeem.sg |
   | David Kim (david@mktr.sg) | david@redeem.sg |
   | Jacqueline Teh (jacqueline@mktr.sg) | jacqueline@redeem.sg |
   Shawn confirmed emily/tyler/jeremy/dara aliases exist in Workspace; **david@redeem.sg +
   jacqueline@redeem.sg to be confirmed/created** (his manual Admin-console step — the Phase-A
   health card flags any alias that isn't sendable yet). Default From display name = the rep's
   full CRM name (e.g. `"Emily Wong" <emily@redeem.sg>`), editable per persona.
3. Daily cap comfort level for warm-up (default 30/day per persona)?
4. Who owns unmatched inbox mail — leave-in-Gmail with the health-card count (default), or
   forward to someone?
5. Confirm redeem.sg DKIM is set up in Admin console (the aliases prove the domain is in the
   tenant; DKIM is a separate toggle + DNS record — §2 step 4).

## 10. Explicitly out of scope

WhatsApp/IG/call auto-anything; sending via SES/`mailer.js`; HTML template design; open/click
tracking (D); migrating existing manual email steps (they stay manual until an author flips
them, which version-bumps).
