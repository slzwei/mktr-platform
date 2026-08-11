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

## 2. Sending identity & auth (the decision Shawn made + what it implies)

**One shared outreach mailbox** (v1), persona-named on the customer-facing domain:
`emily@redeem.sg` (final persona name = open question §9). Runs inside the existing Google
Workspace tenant.

**Auth: Google service account with domain-wide delegation (DWD), impersonating the mailbox.**
- A service account in the existing GCloud project "MKTR Platform" (the same project that holds
  the OAuth client `917664265015-…`), granted DWD in admin.google.com for scopes
  `gmail.send` + `gmail.readonly` (reply/bounce polling) — admin-controlled, no interactive
  re-auth, no refresh-token expiry/revocation risk. Key stored encrypted server-side using the
  `backend/src/utils/aiCredentialEncryption.js` pattern with its **own** env key
  (`OUTREACH_MAILBOX_ENCRYPTION_KEY` — never reuse `AI_SETTINGS_ENCRYPTION_KEY`; rotating one
  must not brick the other).
- Fallback documented but not built: per-mailbox OAuth connect flow à la the Meta
  "Connect Facebook" self-serve pattern (#435–#437). Only needed if DWD is refused.

**Workspace/DNS prerequisites (Shawn-side runbook, before Phase A ships):**
1. redeem.sg added as a (secondary) domain in the Workspace; `emily@redeem.sg` created as a
   real licensed user (NOT an alias — aliases complicate send-as and inbox polling). One extra
   Workspace seat of cost.
2. DKIM for redeem.sg generated in Admin console + CNAME/TXT published on Cloudflare
   (**DNS-only**, like every redeem.sg record); SPF `include:_spf.google.com`; DMARC start at
   `p=none; rua=…` and tighten after 2–4 clean weeks.
3. DWD grant for the service-account client ID with the two scopes above.

## 3. Data model (one migration, next free number at build time — check collisions per house rule)

- **`outreach_mailboxes`** — admin-managed in Settings (`settings.manage`), one row now, table
  so per-rep/persona mailboxes later need zero schema work: `id, address (unique),
  displayName ('Emily from Redeem'), provider 'google', authMode 'dwd', encryptedCredentials,
  isActive, dailySendCap (warm-up ramp, default 30), sentToday + sentTodayDate (SGT-keyed
  counter), lastHealthCheckAt, lastError, createdBy, timestamps`.
- **`outreach_emails`** — the OUTBOX, cloned from the proven `webhook_deliveries` durable-retry
  shape (`backend/src/models/WebhookDelivery.js` — persisted `nextRetryAt`, `(status,
  nextRetryAt)` index, atomic pending→sending claim, boot + interval recovery poll):
  `id, taskId (FK outreach_tasks, partial-unique WHERE status IN (queued,sending) — one live
  send per task), cadenceEnrollmentId, partnerOrganisationId, contactId, mailboxId, toAddress,
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
- **Sender worker**: in-process interval (60s) + boot recovery, exactly the webhook-queue
  pattern (`MAX_CONCURRENT` small, claim via conditional UPDATE … RETURNING). Per attempt it
  RELOADS everything and re-validates before sending: enrollment still `active`, task still
  `open|in_progress` and still the enrollment's current step, partner not merged/archived/LOST,
  mailbox active + under `dailySendCap`, recipient not in `outreach_suppressions`
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

- **v1: polling, no new infra.** Every 2 min list new INBOX messages via the Gmail API
  (history cursor persisted on the mailbox row); match `threadId` / `In-Reply-To` /
  `References` against `outreach_emails`. Match ⇒ `logActivityTx(type email_reply, direction
  inbound)` under the partner lock — the existing `onInboundActivity` hook exits the cadence
  (`replied`) and cancels open tasks; owner sees it in "Replied — keep the momentum".
  Unmatched human mail ⇒ listed on a small Settings "Outreach inbox" health card (count +
  deep-link to Gmail) — nobody has to tail the mailbox raw.
- **Bounces**: mailer-daemon/DSN in a tracked thread ⇒ outbox `failed(bounced)` + write
  `outreach_suppressions (channel email, reason bounced)` — the FIRST real writer for that
  table (it exists with zero write paths today; the engine already reads it pre-send). Partner
  card then parks honestly on the next email step.
- **Unsubscribe**: reply containing unsubscribe/remove-me (simple keyword list, conservative)
  ⇒ suppression `(email, opt_out)` + cadence exit; plus a standing footer line (see §6).
- **P2 upgrade path**: Gmail watch + Pub/Sub push (instant, no polling) — same matching code.

## 6. Deliverability & Singapore compliance (flagging once, then building pragmatically)

- Warm-up: `dailySendCap` starts 20–30/day, +10/wk to ~100; cap enforced in the claim query.
  Plain-text bodies (scripts already are), personalized 1:1, real reply-to. From:
  `"Emily from Redeem" <emily@redeem.sg>` (persona question §9).
- Spam Control Act: these are individualized B2B messages, not bulk blasts, but we adopt the
  safe posture anyway — accurate sender identity, a one-line footer
  (`MKTR PTE. LTD. · reply "unsubscribe" to opt out`), functional opt-out via §5, suppression
  honored before every send. PDPA business-contact-info exception covers the B2B addresses we
  hold. Flagged once here; not re-litigated per send.

## 7. UI inventory

- **Settings → Outreach mailbox** card (`settings.manage`): address, persona display name,
  status/health (last poll, last send, last error), daily cap + sent-today, **Send test email**
  button. DWD setup instructions inline (copy-paste of §2 runbook).
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

1. **Persona vs rep voice**: scripts today render `{{rep_name}}` → "I am Shawn from Redeem",
   but the mail arrives from `emily@redeem.sg`. Pick one: (a) auto-send emails sign as the
   MAILBOX persona (Emily) — consistent, but the rep on the follow-up call isn't Emily;
   (b) From reads `"Shawn from Redeem" <emily@redeem.sg>` and the body keeps the rep's name —
   replies still land in the shared inbox (recommended); (c) per-rep mailboxes later (D).
2. Final persona address(es) + display name to create in Workspace.
3. Daily cap comfort level for warm-up (default 30/day)?
4. Who owns unmatched inbox mail — leave-in-Gmail with the health-card count (default), or
   forward to someone?

## 10. Explicitly out of scope

WhatsApp/IG/call auto-anything; sending via SES/`mailer.js`; HTML template design; open/click
tracking (D); migrating existing manual email steps (they stay manual until an author flips
them, which version-bumps).
