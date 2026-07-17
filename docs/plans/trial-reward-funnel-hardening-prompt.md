# Trial-Reward Funnel Hardening — session prompt

> **Execution status (2026-07-17):** PR A #177, PR B #178, PR C #179 merged + deploy-verified;
> PR D in flight (this doc + TRIAL_REWARD_FUNNEL.md committed into the repo as part of it).
> PR E (WhatsApp) remains gated on the Meta-side prereqs below.

Paste everything below into a fresh Claude Code session in `~/lyfe-master/mktr-platform`.

---

Read `docs/redeem-ops/TRIAL_REWARD_FUNNEL.md` first (canonical 9-step funnel). A full adversarial
audit of that funnel (2026-07-16, against main `ed42db9` + prod) confirmed the core is sound —
every structural invariant (partial uniques, UNIQUE redemptions.entitlementId, guarded counters,
typed 422, OTP anti-spoof) holds in code AND in the prod schema — but found the defects below.
Your job is to fix them in 5 PRs (A–D hardening + E WhatsApp channel). Trust these findings
(they were verified line-by-line) but re-read each cited site before editing.

## Verified defects

1. **Voucher email never fires on unlock (P0).** `notifyUnlock` is injected ONLY in bootstrap's
   capture-hook instance (`bootstrap.js:241-244`). All three unlock surfaces use bare instances
   with `notifyUnlock: null`: `routes/externalEntitlements.js:44`, `routes/lyfeEntitlementUnlock.js:81`,
   `controllers/redeemOps/fulfilmentController.js:3+27` (bare default import). Under
   `agent_unlock` (the funnel default) no voucher email is EVER sent. The Lyfe route message
   ("the customer has been notified") and the ops toast ("email with QR sent to the customer")
   are false. Mitigating quirk: the reservation email's `/r/<presentationToken>` link silently
   flips to a voucher QR post-unlock (`routes/rewardClaim.js:104-114`).
2. **Sweep-issued reservations are undeliverable (P0-adjacent).** The fulfilment sweep instance
   (`bootstrap.js:263-268`) has no notify, and `reconcileMissedLeads` discards the raw
   presentation token (`entitlementService.js:340`). Only hashes persist; there is NO
   resend/re-mint endpoint anywhere. A hook failure recovered by the sweep = a prospect who can
   never see their pass.
3. **Allocation burn by repeat signup (P0).** Nothing dedupes a HUMAN: same phone can submit the
   form N times within the 10-min OTP marker TTL → N prospect rows → N entitlements, each
   consuming allocation for the whole reservation window (default 30 days).
   `uq_re_activation_prospect` dedupes prospect rows, not people. Prod activation has
   allocated=10 — trivially drainable.
4. **Unlock ignores activation status (P1).** `unlockEntitlement` (`entitlementService.js:150-221`)
   never loads the activation — paused/completed/cancelled activations still unlock. The funnel
   doc CLAIMS "activation live" is enforced. Issuance also never checks `offer.status` or
   `activation.endDate`.
5. **Live activations can be silently detached (P1).** `PATCH /activations/:id/campaign` with
   `campaignId: null` has no status guard (`activationsController.js:47-54`,
   `activationService.js:98-108`). Unlink (or relink to a different campaign) on an ACTIVE
   activation silently stops issuance — the sweep skips null-campaign activations, the console
   still says "active", and no metric or log counts the `no_active_activation` skips.
6. **Hygiene (P2):** (a) duplicate migration number: `066-add-campaign-slug.js` +
   `066-cadence-draft-visibility.js` — `migrations.test.js` is red on main; (b) stale test
   `redeemOpsRewards.test.js` "seeded on PARTNERED transition" — fixture predates the PR #116
   contact-required entry gate (the gate is CORRECT, the fixture lacks a contact); (c)
   offers-only-on-PARTNERED is claimed by the doc but `rewardService.createOffer` accepts any
   non-merged partner regardless of stage (only `mergePartners` guards it); (d) missing
   `LYFE_LEAD_OUTCOME_SECRET` returns 401 like a bad signature (`lyfeEntitlementUnlock.js:42-58`)
   instead of failing loud like the external surface (500 "Server misconfigured");
   (e) `analyticsService.activationFunnels` shows counters only — doc claims per-status
   entitlement visibility.

## The work — 5 PRs, in order (E floats on external Meta approvals)

**PR A — voucher/pass delivery actually delivers.** *(Scope expanded 2026-07-16 with Shawn:
+ copy-link/WhatsApp-paste channel, + delivery receipts, + honest row UI. Amended same day
after an in-depth Codex review — every amendment was re-verified against the code line-by-line
before being folded in. Decisions already made with Shawn — do not re-litigate: manual issue
now emails the customer too; resend on an expired entitlement is a typed 409; the wa.me deep
link may embed the RAW phone because the endpoint is capability-gated + audited.)*
- Create ONE shared wired factory `services/redeemOps/entitlementWiring.js` exporting
  `makeWiredEntitlementService(overrides)` that injects BOTH `notifyUnlock`
  (→ `makeFulfilmentNotify().sendVoucherEmail`) and a NEW null-safe `notifyReservation` dep
  (→ `sendReservationEmail`), spreading `overrides` last (DI seams for tests). Use it at all
  three unlock surfaces (`routes/externalEntitlements.js`, `routes/lyfeEntitlementUnlock.js`,
  `controllers/redeemOps/fulfilmentController.js` module-level instance) AND both bootstrap
  instances (capture hook + fulfilment sweep).
- Move delivery INTO the service: `issueForProspect` fires post-commit fire-and-forget
  delivery on FRESH issuance only (`agent_unlock` → notifyReservation with the presentation
  token; `on_capture` → notifyUnlock with the voucher token). Delete bootstrap's inline email
  branching — the service is the single choke point, so hook-, sweep-, and manual-issued
  entitlements all deliver (fixes defect 2's delivery half). `issueManual` therefore emails
  too when a usable email exists; raw tokens still returned to staff.
- **Durable delivery (Codex blocker, verified):** fire-and-forget alone still strands an
  entitlement if the process dies post-commit pre-send or SMTP fails — the sweep skips rows
  that already exist and only hashes persist. Add a delivery-recovery pass to the 15-min
  fulfilment sweep: find `eligible`/`issued` entitlements with a deliverable email and NO
  successful `notified` receipt for their CURRENT kind (pass for eligible, voucher for
  issued), re-mint atomically via the same resend machinery, send, write the receipt. Cap at
  3 attempts per kind (count prior receipt rows; sweep interval = natural backoff), then
  leave it to the ops console (the row shows "email failed"). Prod table is empty — no
  legacy-row hazard in treating "no receipt" as undelivered.
- Fix `issueManual` activation mismatch (Codex blocker, verified — pre-existing bug that
  emails make customer-visible): `issueManual` loads the REQUESTED `activationId`
  (`entitlementService.js:224`) but `issueForProspect` re-resolves by
  `campaignId+status='active'` (`:65`) and can issue/email a DIFFERENT activation's reward
  while the audit logs the requested one. Thread an `activationId` override through
  `issueForProspect` (findByPk, require `status='active'`, allocation guard on THAT
  activation). Cross-campaign manual issue stays allowed deliberately (audited).
- `canEmailProspect(prospect)` helper exported from `fulfilmentNotify.js` (email present and
  not `@calls.mktr.sg`) — the single definition, used by the EMAIL sender + email receipts.
  The notify SEAM itself stays channel-agnostic (always receives the prospect; each channel
  decides its own deliverability) — PR E's WhatsApp must not be suppressed by email logic.
- Truth the messages: `unlockEntitlement` returns `emailQueued` meaning **a fresh email
  attempt was scheduled by THIS call** — `false` on idempotent replay (`already:true`), on
  no-usable-email, and on unwired notify. All three unlock responses expose it; Lyfe route
  message + ops unlock toast branch on it, including the "no email on file — share a link"
  case. Test: replay returns `emailQueued:false` and sends no duplicate mail.
- Delivery receipts: every email attempt writes a RedemptionEvent — type `notified` on
  accepted hand-off, `notify_failed` on failure (extend the model's type comment; the column
  is STRING(24), no DB constraint) with metadata `{ kind: 'pass'|'voucher', channel: 'email',
  to: <masked> }`. Shape the list payload **per channel** from day one:
  `delivery: { email: { kind, at, ok } | null }` (PR E adds a `whatsapp` key — a single
  scalar would let one channel's result hide the other's). The resend ACTION itself logs as
  type `manual_override` + `metadata.action: 'resend_pass'|'resend_voucher'`, mirroring
  cancel's idiom, with event + audit written INSIDE the resend transaction.
- **Sender result contract + mailer log hygiene (Codex, verified):** the fulfilment senders
  currently discard `sendEmail`'s result, and an unconfigured mailer RESOLVES
  `{success:false}` instead of throwing — naively mapping "resolved" to `notified` records
  false receipts. Senders return a normalized `{ sent, skipped?: 'no_email', to }`;
  receipts map `success:false`/throw → `notify_failed`. While in `mailer.js`: mask the `to`
  address in its logs and drop the token-bearing debug body preview (log length only) —
  today it logs raw recipient on failure and full HTML at debug level.
- **Token redaction in logs/telemetry (Codex blocker, verified — exposure exists in prod
  TODAY):** `/api/reward-claim/:token` puts a live bearer credential in every pino-http
  request log (`server_internal.js:135`), in `errorHandler.js`'s `req.originalUrl`, and
  Sentry's `event.request.url` is never scrubbed (`sentryScrub.js` scrubs data/extra only);
  the frontend api client `console.error`s failing endpoints incl. tokens (`client.js:166`).
  Add one shared mask helper (`/api/reward-claim/<...>` → `/api/reward-claim/[token]`, same
  for `/r/`) applied at: pino-http serializer, errorHandler's log, `scrubEvent`
  (request.url + breadcrumbs), and the frontend client's error log. With resend rotating
  tokens, old-token 404s would otherwise spray dead-but-recent credentials into logs. Tests
  for each layer.
- Audited ops resend/share: `POST /api/redeem-ops/entitlements/:id/resend-pass`, body
  `{ channel: 'email' | 'link' }`, capability `entitlements.issue_manual`:
  - **The re-mint is an ATOMIC conditional transition (Codex blocker, verified)** —
    mirror unlock/redeem's idiom: inside a transaction,
    `UPDATE ... SET <hash fields> WHERE id = :id AND status = '<expected>' AND
    (expiresAt IS NULL OR expiresAt > NOW())`; rowCount 0 → typed 409 ("state changed —
    refresh"). DB-time expiry check, not JS-time. `manual_override` event + audit row in
    the SAME transaction; email fires after commit. Otherwise a resend racing an unlock /
    redemption / the sweep rotates hashes for the wrong state and emails stale copy.
  - Per-entitlement cooldown: any resend/delivery attempt for the same kind in the last
    60s → 429 (the global 200-per-IP limiter is no protection here); frontend disables
    the button while pending.
  - Status `eligible` (unexpired): re-mint presentation token, update `presentationTokenHash`.
    Status `issued` (unexpired): re-mint voucher token, update `tokenHash`+`tokenHint`.
    Expired or any other status → typed 409. Old QR dying is intended — say so in the
    response (for `issued` only the old VOUCHER credential dies; the post-unlock
    presentation link surviving is the out-of-scope step-9 design — don't claim otherwise).
  - `channel: 'email'` → send via fulfilmentNotify; no usable email → typed 409.
  - `channel: 'link'` → NO email; return once `{ url, waMessage, waUrl }`: `waMessage` is a
    prefilled WhatsApp-ready message (pass/voucher variants — reward, partner, /r/ link,
    expiry date), `waUrl` = `https://wa.me/<digits>?text=<urlencoded waMessage>` (normalize
    the prospect phone to bare digits). This is the ONLY delivery path for no-email
    prospects (Retell leads) — the raw link lets staff WhatsApp/SMS it themselves.
    Contract hardening (Codex, verified): build the url with a SHARED campaign-branded
    claim-URL builder factored out of `fulfilmentNotify.claimOrigin` (no duplicated origin
    logic); `prospectId` is SET-NULL-on-delete and `phone` is nullable, so `waUrl` is
    nullable with a typed `waUnavailableReason: 'no_phone'` (waMessage falls back to
    "there" for the name); respond `Cache-Control: no-store` (raw credential in the body).
  - Audit `entitlement.resend_delivery` with `{ kind, channel }` — never the raw token or
    phone in audit rows.
- `listEntitlements` additionally returns per row: `emailDeliverable` + the per-channel
  `delivery` object above (one extra batched event query for the page, not per row).
  PII guard (Codex, verified): the prospect include must SELECT `email` for the
  `canEmailProspect` computation but STRIP it in the existing masking mapper before
  serialization — today the projection deliberately excludes email; don't regress it.
- RedemptionsPage (ops console — the only screen touched): per-row delivery status line
  ("Pass emailed · <ts>" / "Voucher email failed" / "Never delivered — share a link"), amber
  "No email" tag when `!emailDeliverable`, actions gated by
  `hasCapability(user, 'entitlements.issue_manual')`: **Resend pass / Resend voucher**
  (hidden when `!emailDeliverable`) + **Copy link** (dialog via existing
  `src/components/ui/dialog.jsx`: the /r/ url + copy, copy-message, Open-in-WhatsApp via
  `waUrl` — hidden when null). Both actions rotate a live credential, so both require an
  EXPLICIT confirm step in the dialog before the request fires (never rotate on open).
  Unlock toast branches on `emailQueued`. New api-client methods in `src/api/redeemOps.js`.
- Tests REQUIRED (the audit found zero email assertions — that's how this shipped broken).
  Mock `mailer.js` via `jest.unstable_mockModule`, real app + DB:
  - notify fires on external (genuinely-signed body HMAC + timestamp) / lyfe (signed
    `${ts}.${rawBody}`) / admin unlock; fake-email prospect unlocks with NO email,
    `emailQueued:false`, truthful message; unlock REPLAY sends nothing, `emailQueued:false`.
  - sweep-issue sends the pass and the emailed token resolves 200 on
    `/api/reward-claim/:token`; delivery-recovery sweep re-sends when no `notified` receipt
    exists, stops after 3 attempts; exactly ONE delivery under hook/sweep unique-conflict
    races; `on_capture` sends the VOUCHER (not reservation) email.
  - `issueManual` issues + emails the REQUESTED activation (not campaign-resolved) while
    still returning raw tokens.
  - resend email re-mints (old token 404s, new 200s); ISSUED resend leaves the old
    presentation link valid while killing only the old voucher token; resend vs
    unlock/redeem/expiry races → typed 409s (conditional-update proof); double-resend →
    429 cooldown; resend link returns a working url + waUrl with digits-only phone and
    encoded text, sends NOTHING, and `Cache-Control: no-store` is set; no-phone prospect →
    `waUrl:null` + reason; no-email + channel email → 409; `bdm` role → 403.
  - receipts: `notified` on success, `notify_failed` on mailer `{success:false}` AND on
    throw; audit + `manual_override` rows contain no raw token/phone/email.
  - redaction: pino request log, errorHandler, `scrubEvent(request.url)`, and the frontend
    client error log all mask reward-claim tokens.
  - `entitlementUnlockVia.test.js` MUST be updated, not just re-run (the plan's earlier
    "mocks remain compatible" claim was FALSE — Codex-verified): `fulfilmentNotify.js`
    statically imports RewardOffer/PartnerOrganisation/Campaign/Activation from
    `models/index.js`, whose mock exports only `User` → ESM link error once the routes
    import the wiring. Fix: mock `entitlementWiring.js` in that suite (routes now import
    the wiring, not the service).
  - `redeemOpsFulfilment.test.js` stays green untouched (bare `makeEntitlementService()`
    keeps null notify deps). One focused RedemptionsPage vitest (infra exists: vitest +
    testing-library; first page test): capability/status button gating + confirm-before-
    rotate flow.

**PR B — anti-farming: one live reward per phone per activation.**
- Migration `075-entitlement-phone-dedupe.js`: add `phoneKey` (text, nullable) to
  `reward_entitlements`; partial unique
  `(activationId, phoneKey) WHERE "phoneKey" IS NOT NULL AND status IN ('eligible','issued','redeemed')`
  so expired/cancelled free the slot. MIRROR the index on the model — `sync({force:true})` in
  test mode builds from models (the lucky-draw lesson).
- `issueForProspect`: stamp `phoneKey` from the prospect's normalized phone; pre-check for a
  typed `duplicate_phone` reason; extend the `SequelizeUniqueConstraintError` catch. Prod table
  is empty — no backfill.
- Tests: two prospect rows, same phone, same activation → exactly one entitlement (concurrent
  too); expired entitlement frees the slot; different activation unaffected; `issueManual`
  behavior decided + tested (default: same rule applies, admin sees the typed 409).
- *(Codex review notes, verified)* A prospect with no phone gets `phoneKey` NULL and bypasses
  the dedupe entirely — decide the rule explicitly: hook/sweep issuance requires a normalized
  phone (they are OTP-verified so it always exists — typed `no_phone` reason if not); manual
  issue without a phone stays allowed (audited). The DB partial unique — not the pre-check —
  remains the authoritative guard (the pre-check is UX only). Deploy note: B ships migration
  075 while 074 only appears later in D — the `_migrations` runner tracks by FILENAME, so
  out-of-numeric-order execution is fine; state it in the PR description so nobody "fixes" it.

**PR C — liveness gates + linkage guards + observability.**
- Unlock requires the activation live: load activation in `unlockEntitlement`; status
  `paused` → typed 409 "activation is paused", `completed`/`cancelled` → typed 409. (Paused =
  full brake — deliberate.) Keep replay idempotency (`already:true`) working.
- Issuance additionally requires `offer.status='active'` and (`endDate` null or future) — add to
  the `issueForProspect` preconditions with typed reasons.
- Guard `linkCampaign`: unlink or relink only when activation status is NOT live
  (`preparing/active/paused`) → typed 409 "Pause or complete the activation first". Update the
  ActivationDetail UI accordingly.
- Observability: structured log per skipped issuance (reason, campaignId, activationId) at the
  hook site + a last-24h reason breakdown in the activation detail payload (and/or
  `analyticsService.activationFunnels`). A detached/starved funnel must be visible.
- *(Codex review notes, verified)* (a) Load-then-check is still TOCTOU — the liveness/offer/
  endDate guards must live INSIDE the issuance and unlock transactions (extend the conditional
  UPDATE predicates or lock the activation row; `inventoryService.recordIssued` guards
  quantity only). (b) Issuance must reject EVERY non-`active` activation, including
  draft/preparing, with typed reasons. (c) The linkCampaign guard message "Pause or complete
  the activation first" is wrong — paused is itself in the protected set; say "Complete or
  cancel the activation first". (d) A last-24h skip breakdown CANNOT be produced from logs
  alone (no log analytics exists) — persist skip data (lightweight tally keyed by
  reason/activation/day, written at BOTH the hook and sweep skip sites), then read the
  breakdown from that.
- Update `TRIAL_REWARD_FUNNEL.md` step 7 (activation-live now true) and §2 notes.

**PR D — hygiene + truth the doc.**
- Renumber `066-cadence-draft-visibility.js` → `074-cadence-draft-visibility.js` AND STRIP the
  backfill `UPDATE` from the renamed file. CRITICAL: `_migrations` tracks by FILENAME
  (`runMigrations.js:44-52`), so the renamed file WILL re-run on prod boot — the column-add is
  `IF NOT EXISTS` (harmless) but the backfill would force-publish any cadence drafts. Strip it;
  it was historical (empty tables on fresh DBs). `migrations.test.js` goes green.
  *(EXECUTION NOTE 2026-07-17: the 074 slot was independently claimed by
  `074-redeem-ops-category-filter-words.js` (PR #169) while this series was in flight — the
  rename landed as **077** instead. Verified against prod `_migrations` before renaming.)*
- Fix the stale PARTNERED fixture in `redeemOpsRewards.test.js` (add a contact with
  phone/email before the stage change). Suite goes green.
- Enforce offers-only-on-PARTNERED in `rewardService.createOffer` (typed 422 mirroring
  `assertPartneredEntryRequirements` language). Update tests that create offers on
  non-partnered fixtures.
- `lyfeEntitlementUnlock.js`: missing `LYFE_LEAD_OUTCOME_SECRET` → 500 "Server misconfigured"
  (parity with `externalBillingController.verifyExternalHmac`).
- Analytics: add per-activation entitlement status counts (eligible/issued/redeemed/expired/
  cancelled — GROUP BY on reward_entitlements) to `activationFunnels`.
- Update `TRIAL_REWARD_FUNNEL.md`: step 8 wording, §3 note that the LYFE secret probe is now
  distinguishable, §4 analytics claim, and add a pre-launch checklist (campaign linked + active,
  `claimExpiryDays`/`redemptionExpiryDays` set, `externalBookingUrl` filled, allocation > 0) —
  prod today: 1 draft activation, unlinked, none of those set.
- *(Codex review notes, verified)* Also re-word the funnel doc's step-5 "same link for life"
  claim — PR A's eligible-resend deliberately rotates the link. And the doc's
  `externalBookingUrl` guardrail is FALSE end-to-end today: `rewardClaim.js` selects the field
  but omits it from the response, and `RewardClaim.jsx` renders no booking action — include it
  in the voucher-state response + render the booking CTA (guardrail #3 depends on it), or
  truth the doc. Preferred: fix it.

**PR E — WhatsApp delivery channel (added 2026-07-16; build after D, but externally gated —
slot it wherever Meta approvals land).**
Rationale: the phone is the OTP-VERIFIED identity in this funnel; the email is unverified
free text, and Retell voice leads have no real email at all. Deliver the reservation pass at
signup AND the voucher at unlock to WhatsApp in addition to email.
- Prereqs (Shawn, Meta-side — can start anytime, days of lead time; the build is blocked on
  these, nothing else): dedicated sender number NOT already on personal WhatsApp (a spare
  Singtel DDI works; it must be able to receive one registration OTP call/SMS), Meta business
  verification on the existing Business Manager, create the WABA + display name ("Redeem"),
  submit UTILITY templates for approval — reservation-pass + voucher variants, body text with
  the `/r/` link (the link IS the pass; no QR media needed). SG utility pricing is cents per
  message — negligible at funnel volume.
- Build: `services/redeemOps/whatsappService.js` (Meta Cloud API template sends; env
  `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / template names; flag
  `REDEEM_OPS_WHATSAPP_ENABLED` default false). Plug into the SAME notify seam in
  `entitlementWiring.js` — `notifyReservation`/`notifyUnlock` fan out to email + WhatsApp,
  each channel fire-and-forget and independent (one failing never blocks the other).
- Delivery receipts reuse PR A's `channel` field (`'whatsapp'`) — the RedemptionsPage row UI
  shows them with zero rework. Resend endpoint gains `channel: 'whatsapp'`.
- Consent (*Codex-corrected, verified — the earlier "consented signup" framing was
  overstated*): only TERMS gate submission in `CampaignSignupForm.jsx`; `consent_contact` is
  OPTIONAL and is submitted `false` when unticked. PR E must therefore make an explicit
  decision with Shawn at kickoff: gate WhatsApp sends on `consent_contact === true`, or
  document a transactional-delivery basis (delivering the thing the lead just requested)
  covering non-consented rows. The visible consent copy does name phone/text/WhatsApp —
  re-verify the exact wording then.
- Tests: template payload shape; fan-out independence (email failure ≠ WhatsApp failure);
  flag off → byte-identical PR A behavior.

## Out of scope — do not build

Step-9 partner-facing surface (mechanism undecided), tightening the post-unlock
presentation-token-as-redemption-credential design (belongs to the step-9 decision),
Lyfe-side reassignment back-sync, System-Agent delivery gap, fleet/devices/commissions
(being retired), in-house SMS sending (the PR A copy-link flow is the manual bridge;
automated WhatsApp is PR E, not out of scope).

## Constraints & recipes

- This checkout is SHARED by concurrent sessions: do branch work in a disposable git worktree,
  stage with explicit paths only, and verify the branch inside the commit command itself.
- One PR at a time: branch → implement → full relevant test pass → PR → merge before starting
  the next (A → B → C → D → E). PR E is additionally gated on Shawn's Meta-side approvals —
  its prereq checklist can start anytime, and E slots in whenever approvals land without
  touching B–D's scope. Shawn may run a Codex review between plan and implementation —
  offer the plan for review before large diffs.
- Tests: run jest from `backend/` with a THROWAWAY Postgres you start yourself
  (`initdb` + `pg_ctl -o "-p 5433 -c unix_socket_directories=''"`, user `mktr_local`, db
  `mktr_test`, trust auth; if 5433 is occupied by another session's instance, use 5434 and pass
  `DB_PORT=5434`). `JWT_SECRET` inline, `NODE_OPTIONS=--experimental-vm-modules`. The
  `shortlinkService` suite is chronically red — ignore it. After PR D, `migrations.test.js` and
  `redeemOpsRewards.test.js` must BOTH be green.
- Everything here ships behind flags that are ALREADY ON in prod (`REDEEM_OPS_ENABLED`,
  `REDEEM_OPS_ENTITLEMENTS_ENABLED`) — merging to main = live behavior change. That is intended
  for PR A (emails start sending). Deploy-verify per CLAUDE.md (origin curl for the new chunk /
  a string unique to the change; confirm a NEW Render deploy actually ran).
- Database: SELECT-only against prod. All schema changes via numbered migrations (075+ is free
  after PR D's rename claims 074). Never DELETE/TRUNCATE/DROP on prod.
- When all 5 PRs are merged and deploy-verified, re-run the verification prompt in the appendix
  of `docs/redeem-ops/TRIAL_REWARD_FUNNEL.md` and update the doc's status table with what you
  find.
