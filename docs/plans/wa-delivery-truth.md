# WhatsApp/email delivery truth — silent marketing-cap drops + receipt honesty

**Incident (2026-07-26 03:06 SGT).** Shawn's test lead (`11a46df8-e1ca-4043-b9d9-7dc02ef1d876`,
+65 8012 9432) received the `draw_entry_pass` WhatsApp at 03:02 but never received the
`draw_boost_receipt` WhatsApp at 03:06 — while the admin lead profile shows **both** as
"boost receipt WhatsApp ✓". Yesterday's identical flow (25 Jul 16:04/16:07 SGT, other
signup of the same person) delivered both.

## Root cause — proven, three independent ways

1. **Category split.** WABA `1912683432731970` templates:
   `draw_entry_pass` = UTILITY (delivered both days), `draw_boost_receipt` = **MARKETING**
   (delivered 25 Jul as first-in-window, dropped 26 Jul), `reward_voucher` = **MARKETING**
   (same latent risk on real voucher deliveries), `draw_pass_receipt` = UTILITY,
   `draw_callback_optin` = MARKETING (intentional). Meta applies a **per-user marketing
   frequency cap**: a MARKETING template to a user who recently received one is accepted
   by the API (HTTP 200 + message id) and then **silently dropped** (error 131049,
   reported only via the statuses webhook). UTILITY templates are exempt.
2. **WABA analytics.** Half-hour bucket 2026-07-25T19:00Z (03:00–03:30 SGT): `sent=1,
   delivered=1` — but we made **two** 200-OK sends in that bucket (pass 19:02:15Z, boost
   19:06:18Z). The boost message was never even counted as *sent*: dropped post-acceptance,
   pre-send. Every message Meta actually sent in the last 3 days was delivered — this is
   not a device/network problem.
3. **Receipts.** `redemption_events` shows `notified{kind:boost_receipt, channel:whatsapp}`
   at 19:06:18Z — our ✓ is written on Meta HTTP 200 (`whatsappService.js` `sendTemplate`
   returns `{sent:true}` without reading the response body). The platform cannot currently
   observe any post-acceptance outcome:
   - **No statuses sink.** The WABA's `subscribed_apps` carries
     `override_callback_uri = https://rciuejxgziqxrwtifpbo.supabase.co/functions/v1/wa-debug`
     (a debug EF on the mktr-leads Supabase project, set during 07-23 template debugging) —
     and its logs show **zero** status callbacks ever arrived (app-level webhook field
     subscription for `messages` is missing/unconfirmable without the app secret;
     `META_APP_SECRET` in Render env is NOT the MKTR_wa app's secret — `debug_token`
     signature check fails).
   - **Emails are the same shape of lie, milder.** `mailer.js` `deliver()` discards the
     nodemailer `info` (SES SMTP `250 Ok <ses-message-id>`) and returns `{success:true}` —
     "emailed ✓" = SES accepted the envelope. Bounces/complaints after acceptance are
     invisible (no SES event destination configured).

## Fix

### A. Root cause — resubmit the two transactional templates as UTILITY

Meta template category is immutable post-creation → new names, same (already
flat-factual, receipt-register) copy. Precedent: `draw_pass_receipt` with near-identical
register passed review as UTILITY.

- `draw_boost_receipt_v2` — UTILITY, IMAGE header (Vault boost card sample), body verbatim
  from the approved `draw_boost_receipt` (3 params). No footer, no buttons (matches current).
- `reward_voucher_v2` — UTILITY, IMAGE header, body verbatim from approved `reward_voucher`
  (4 params, keeps the `https://redeem.sg/r/{{3}}` in-body link). This one guards the core
  product: a voucher that silently never arrives is a direct revenue/trust hit.
- Submission: extend `backend/scripts/submit-wa-marketing-templates.mjs` with a
  `--utility-pack` set (reuses its idempotent submit + resumable sample upload + `--status`
  poll). `allow_category_change: false` — if Meta's classifier disagrees we want a visible
  INCORRECT_CATEGORY rejection (editable + resubmittable), never a silent flip back to
  MARKETING. Keep any rejected shells (deleting risks the 30-day name block).
- After approval: flip Render env `WHATSAPP_TEMPLATE_DRAW_BOOST=draw_boost_receipt_v2`,
  `WHATSAPP_TEMPLATE_VOUCHER=reward_voucher_v2` (env-only, no deploy; service restarts).
- `draw_callback_optin` stays MARKETING deliberately (it is marketing; cap risk accepted).

### B. WhatsApp truth layer — wamid capture + statuses webhook

1. **Capture the message id.** `sendTemplate` success path: parse the response JSON,
   return `{ sent: true, to, messageId: messages[0].id }`. `writeDeliveryReceipt` stores
   `metadata.messageId`. (Also store `templateName` in the receipt metadata — lets the UI
   and future audits distinguish which template actually carried the send.)
2. **Webhook endpoint** `backend/src/routes/whatsappWebhook.js`, mounted publicly (no auth
   middleware, before the JSON-body auth chain), rate-limit-exempt like other
   server-to-server webhooks:
   - `GET /api/whatsapp/webhook` — Meta subscription handshake: `hub.mode=subscribe` +
     `hub.verify_token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN` → echo
     `hub.challenge` (plain 200); else 403.
   - `POST /api/whatsapp/webhook` — extend the existing raw-body capture (today only
     `/api/retell/` paths) to `/api/whatsapp/` so `X-Hub-Signature-256` can be verified:
     HMAC-SHA256(raw body, `WHATSAPP_APP_SECRET`), `crypto.timingSafeEqual`. If
     `WHATSAPP_APP_SECRET` is unset: log one boot-time warn and accept (statuses are
     low-sensitivity, unknown wamids are ignored, and nothing state-changing beyond
     receipt metadata + suppressions happens); when set, fail closed on bad signature.
     Always answer 200 fast (Meta retries + eventually disables noisy endpoints); all
     processing wrapped so a bad payload can never 500.
   - **Statuses** (`entry[].changes[].value.statuses[]`): for each
     `{id, status: sent|delivered|read|failed, timestamp, errors}` find the receipt
     `redemption_events` row (`type='notified'`, `metadata->>'messageId' = id`) and
     `jsonb_set` a `delivery` object: `{status, at, errorCode?, errorTitle?}` with
     **monotonic rank** (sent < delivered < read; failed terminal) so late/out-of-order
     webhooks never downgrade. Structured log every transition
     (`redeem_ops.wa.delivery_status`); unmatched wamids (e.g. screening-callback sends,
     which write no entitlement receipt) log at info and are otherwise ignored.
   - **Inbound STOP** (`value.messages[]`, `type=button` payload or text `STOP`): write the
     existing PR-B suppression (`ConsumerSuppression`, marketing scope, channel whatsapp,
     reason `wa_stop`) keyed by the normalized sender phone, via the consent service's
     writer (exact call verified at implementation). Today the approved marketing pack's
     "Reply STOP to unsubscribe" footer points into the void — this closes it before
     wapush goes live.
3. **Migration** `NNN-wa-delivery-status-index.js`: partial expression index on
   `redemption_events ((metadata->>'messageId')) WHERE type = 'notified'` (btree) — the
   webhook lookup path. Auto-runs on deploy.
4. **Repoint the WABA webhook** (post-deploy, ordered): set env
   (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` once provided,
   `WHATSAPP_WABA_ID=1912683432731970`), verify the endpoint answers the GET handshake,
   then `POST /{waba}/subscribed_apps` with
   `override_callback_uri=https://api.mktr.sg/api/whatsapp/webhook` + our verify token
   (WHATSAPP_TOKEN suffices for this call). If statuses still don't flow (the app-level
   `messages` field subscription may be absent — unverifiable without the app secret),
   complete `POST /{app-id}/subscriptions` (object `whatsapp_business_account`, fields
   `messages`, callback + verify token) using `941256445479495|WHATSAPP_APP_SECRET` —
   requires Shawn pasting the MKTR_wa app secret into Render env (App Dashboard →
   Settings → Basic). Empirical verify: fire a template send to Shawn's number, watch
   `sent → delivered` land in the receipt row within seconds.

### C. Email truth — capture what SES tells us, wire events later

1. **Now (code):** `mailer.deliver()` keeps the nodemailer `info` and returns
   `{ success: true, smtpResponse: info.response, sesMessageId: <parsed from "250 Ok <id>"> }`;
   `fulfilmentNotify` senders thread `sesMessageId` into their `{sent:true}` results →
   receipt `metadata.sesMessageId`. Zero behavior change, pure observability.
2. **Phase 2 (AWS-side, runbook not code):** SES configuration set with event publishing
   (Send/Delivery/Bounce/Complaint) → SNS HTTPS subscription →
   `POST /api/ses/events` (SNS signature-verified) updating receipt `metadata.delivery`
   keyed by `sesMessageId` — same shape as the WA layer. Requires AWS console/IAM access
   the repo doesn't hold; endpoint code ships dark, runbook documents the 5-minute
   console wiring. Out of this PR's live scope.

### D. Admin UI — show the truth

Traced end-to-end: `GET /api/prospects/:id?include=profile` →
`prospectService` → `leadProfileService.enrichJourneyProfile` →
**`deliveryReceipts()` (`backend/src/services/leadProfileService.js:94-113`)** builds
`delivery.{email,whatsapp} = { kind, at, ok }` per entitlement (SQL `DISTINCT ON`
latest-per-channel over `redemption_events` type `notified|notify_failed`; projects only
`type/createdAt/channel/kind` — `metadata` error/status never crosses the wire). The
frontend composes the label 100% client-side at
**`src/pages/adminv2/AdminV2LeadProfile.jsx:172-175`**: `` `${kind} ${channel} ${ok ? '✓' : '✗ failed'}` ``.

Changes:
- `deliveryReceipts()` SELECT adds `metadata->>'error' AS error` and
  `metadata->'delivery' AS delivery`; result object becomes
  `{ kind, at, ok, error, delivery: {status, at, errorCode, errorTitle} | null }`.
  Apply at **both** attach points — `enrichJourneyProfile` (`:243-254`) and the
  consumer-less B4 path in `getSignupProfile` (`:321-339`).
- `AdminV2LeadProfile.jsx:172-175` row label by precedence:
  `delivery.status='failed'` → "✗ not delivered" + reason (131049 → "Meta marketing
  frequency cap"), destructive styling; `delivered`/`read` → "✓✓"; `sent` or no
  `delivery` (legacy rows, emails) → today's "✓" (meaning: accepted). Mirror the same
  ok/failed suffix in `receiptBits()` (`:125-129`, campaign drill-in hero).
- Tests: `backend/test/leadProfileService.test.js` +
  `src/pages/adminv2/__tests__/AdminV2LeadProfile.test.jsx` (fixture gains the
  `delivery` sub-object).
- Known pre-existing display gaps, deliberately untouched: latest-receipt-per-channel
  collapses a failed→resent sequence to the resend; `buildHistory` skips delivery rows
  for consumer-less leads (Rewards list covers them).

## Rollout order

1. Implement + unit tests (webhook route: handshake, signature, status ranking,
   STOP suppression; sendTemplate wamid parse; mailer response capture) — in a
   disposable worktree off `origin/main` (the main checkout carries unrelated WIP).
2. Codex review of this plan + the diff; fold must-fixes.
3. Push `main` → Render auto-deploy (verify via deploys API + `_migrations` row).
4. Env: add `WHATSAPP_WEBHOOK_VERIFY_TOKEN` + `WHATSAPP_WABA_ID` (autonomous),
   `WHATSAPP_APP_SECRET` (Shawn — one paste). Repoint `subscribed_apps` override to
   api.mktr.sg; empirically verify statuses flow end-to-end.
5. Submit `--utility-pack`; poll `--status`; on APPROVED flip the two template env vars.
6. Remediate the missed message: resend the boost receipt (WhatsApp leg) for entitlement
   `15fa630f-c5bc-4041-b2ea-b532aabe66ee` via the ops resend path — now carried by the
   UTILITY template, and now with a delivery-status paper trail. Watch it hit `delivered`.
7. Memory/tracker updates; note the reward_voucher exposure closed.

## v2 — Codex review deltas (2026-07-26, 30 findings; accepted unless noted)

**Design change (dissolves findings 5/7/8/9/10/11):** statuses land in a new
**`wa_message_statuses` inbox table** (migration `090`, with `down()`): `wamid` PK,
`status`, `errorCode`, `errorTitle`, `recipientHash` (sha256 of E.164 — no raw phone
stored), `occurredAt`. Webhook = validate → **atomic rank-guarded upsert**
(`INSERT … ON CONFLICT (wamid) DO UPDATE … WHERE` rank(new) > rank(old); sent=1 <
delivered=2 < read=3 < failed=4 terminal) → 200 only after commit; DB failure → 500 so
Meta retries. Receipts are **never mutated** — readers (`leadProfileService`,
`entitlementService` ops projection) LEFT JOIN the inbox on `metadata->>'messageId'`.
No expression index needed (join is receipt→PK); the old §B.3 migration is dropped.

Other accepted deltas:
- Signature **required in prod**: `WHATSAPP_APP_SECRET` unset → POST answers 200 but
  processes nothing (warn); invalid signature → 401. Bind every payload:
  `entry.id === WHATSAPP_WABA_ID`, `value.metadata.phone_number_id ===
  WHATSAPP_PHONE_NUMBER_ID`; cap entries processed per request. Add `/api/whatsapp/`
  to the global limiter skip (HMAC-first, cheap reject).
- STOP = **global marketing unsubscribe** via existing `applyUnsubscribe(consumer,
  {source:'wa_stop'})` (channel `all` + reason `unsubscribe` — the model has no
  per-channel reason and the existing resubscribe lift path then applies). Accepted
  forms: `stop`, `stop promotions`, `unsubscribe`, `cancel` (quick-reply button text
  or plain text); idempotent writer makes Meta redelivery harmless. Unknown phone →
  log + skip.
- `sendTemplate` parses the send response **non-throwingly**: 2xx without
  `messages[0].id` stays `sent:true, messageId:null` ("accepted, untrackable").
  Receipts gain `metadata.messageId` + `templateName`. Screening-callback sends store
  their wamid in the screening JSONB patch too.
- **Resend remediation**: `resendEntitlement` currently rejects draw entitlements
  (no voucher to rotate) — add a boost-receipt mode (issued draw entitlement → kind
  `boost_receipt`, no token rotation, honors channel selection).
- Email: `providerMessageId` + `provider` (SES only when the host says so), threaded
  through BOTH `fulfilmentNotify` normalizers (`sendEmail` has no `deliver()`; two
  duplicate normalizers exist). UI labels say "accepted", never implied-delivered.
- Erasure: scrub `messageId`/`providerMessageId` from receipt metadata; delete inbox
  rows by `recipientHash`.
- Ops console (`RedemptionsPage`) receipt chips get the same delivery state, not just
  the lead profile.
- Legacy channel-less receipts: `COALESCE(metadata->>'channel','email')` inside
  `DISTINCT ON` + `id DESC` tie-break.
- Rollout checklist gains: `WHATSAPP_QR_HEADER` must not be `false` and
  `WHATSAPP_TEMPLATE_LANG` must be unset/`en` before flipping template env names
  (v2 templates are IMAGE-header, `en`).
- Deferred, documented: `graphFetch` retry can double-send with a lost first wamid
  (pre-existing; unmatched statuses simply rest in the inbox);
  `reconcileMissedDeliveries` stays email-only (truth layer + UTILITY templates
  remove the recurrence class; sweep extension is follow-up); rejected-shell
  edit/resubmit tooling built only if Meta rejects (both v2 templates ACCEPTED
  as PENDING/UTILITY on 2026-07-26).
- Evidence provenance: template categories/analytics/subscription state are
  **externally observed** via Graph API + prod SQL on 2026-07-26 (not code-derivable).

## Risks / notes

- Webhook is additive: no existing send path changes semantics; a webhook outage merely
  leaves receipts at "accepted" (today's baseline).
- `redemption_events` is append-only by design; enriching the SAME fact's row
  (`metadata.delivery`) is a deliberate, documented exception (alternative — one event row
  per status transition — triples history noise for every message; rejected).
- If Meta rejects the UTILITY resubmissions (INCORRECT_CATEGORY), fallback: keep MARKETING
  sends but the truth layer now surfaces every 131049 in the admin UI + logs, and ops
  learns to space marketing sends; escalate copy edits on the rejected shells.
- The 03:06 drop itself needs no data repair: entitlement state (`issued`, ×10 boost) is
  correct; only the notification was lost.
