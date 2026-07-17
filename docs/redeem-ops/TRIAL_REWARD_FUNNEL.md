# Trial-Reward Funnel — Canonical Flow

> **Written 2026-07-16** from Shawn's canonical description of the funnel, cross-checked
> against a full code audit of `main` (which is what's deployed) plus live prod probes.
> This is the source of truth for how a partner trial travels from ad to consumed session.
> Design-era background: `docs/redeem-ops/MKTR_INTEGRATION.md` (§2 review-gated vouchers).

**The model in one line:** a partner gives us trial sessions as a *reward*; we advertise the
reward; the reward is the incentive for the prospect to sit a 20-minute consultation with an
insurance consultant; the voucher only becomes real after that meeting.

---

## 1. The flow at a glance

| # | Actor | What happens | Status |
|---|---|---|---|
| 1 | Partner + ops | Partner commits trial sessions as a **reward** with committed inventory | ✅ Built (live) |
| 2 | Ops (campaign_ops) | Campaign created on MKTR; campaign designer defines the lead-capture form; an **Activation** ties the reward to that campaign | ✅ Built (live) |
| 3 | Ops / marketing | Meta + TikTok ads run on the reward | ✅ Built (live) |
| 4 | Prospect | Signs up on the lead-capture form (phone OTP verified) | ✅ Built (live) |
| 5 | System | Confirmation email with **reservation-pass QR** (what the consultant will scan) | ✅ Built (live) |
| 6 | Consultant | Receives the lead (push), calls, arranges the meeting | ✅ Built (live) |
| 7 | Consultant | At the meeting: **scans the prospect's QR in the mktr-leads app** → unlock | ❌ **App screen not built** (backend live) |
| 8 | System | Reward unlocked → **redemption-QR voucher emailed** to the prospect | ✅ Built (live) |
| 9 | Prospect + partner | Prospect books with the partner; **partner scans the voucher QR to consume the session** | ❌ **No partner-facing surface** (ops console only) |

Rewards are **usually single-use**: one entitlement → at most one redemption, enforced by a
UNIQUE constraint. Multi-session rewards are out of scope for now.

---

## 2. Step-by-step with code anchors

### Step 1 — Partner commits a trial as a reward — BUILT
- Business must be **Partnered** (pipeline terminal stage; entry requires a contact with phone/email).
- Ops creates the reward at `/redeem-ops/rewards` → `POST /api/redeem-ops/rewards`.
- Model `RewardOffer`: `rewardType` (e.g. `free_trial`), `status draft|active|paused|ended`,
  `committedQuantity`, `claimExpiryDays` (how long the prospect has to attend the review),
  `redemptionExpiryDays` (voucher lifetime after unlock), optional `externalBookingUrl`
  (shown on the voucher page — fill this in so the prospect knows how to book).
- Every quantity movement lives in the append-only `reward_inventory_events` ledger with
  guarded counters (`committed ≥ allocated ≥ issued ≥ redeemed`) — supply cannot be oversubscribed.

### Step 2 — Campaign on MKTR + Activation — BUILT
- Campaign + lead-capture form: existing MKTR campaign designer (mktr.sg admin). Redeem Ops
  never edits campaigns — read-only projection + "Open in MKTR" deep link (`campaignProjection.js`).
- The **Activation** is the tie: `/redeem-ops/activations` → allocate quantity from the reward,
  link exactly one campaign (partial-unique: one live activation per campaign), set status
  `draft → preparing → active`.
- **Linkage guard (since 2026-07-17, PR C):** the campaign link is immutable while the
  activation is live (`preparing`/`active`/`paused`) — complete or cancel it first (typed
  409). Unlinking a live activation used to silently stop issuance with no trace. Issuance
  additionally requires `offer.status='active'` and the activation's `endDate` unset or in
  the future, and every SKIPPED issuance is persisted (`activation_issuance_skips`, 30-day
  retention) — the activation detail shows a last-24h reason breakdown, so a detached or
  starved funnel is visible instead of silent.
- `unlockPolicy` on the activation: **`agent_unlock` (default — this funnel)** or `on_capture`
  (instant voucher at signup; exists as a per-activation knob, not used in this flow).

### Step 3 — Ads — BUILT
- Meta: `src/lib/metaPixel.js` + `backend/src/services/metaCapiService.js`.
- TikTok: `src/lib/tiktokPixel.js` + `backend/src/services/tiktokEventsService.js`.
- Down-funnel events (ConfirmedResident/ClosedWon) already flow back from consultant outcomes.

### Step 4 — Prospect signs up — BUILT
- Lead-capture form on redeem.sg (per-campaign design). Phone OTP verification stamps
  `sourceMetadata.phoneVerifiedAt` **server-side** — this is the anti-farming gate for the reward.

### Step 5 — Reservation-pass email — BUILT, LIVE
- On capture, the lead-captured hook (`registerLeadCapturedHook`, registered in
  `backend/src/database/bootstrap.js` behind `REDEEM_OPS_ENTITLEMENTS_ENABLED`) calls
  `entitlementService`: preconditions = phone verified, prospect not quarantined, activation
  `active` with allocation remaining.
- Creates `RewardEntitlement` `status='eligible'` — a **locked reservation**. Only the
  **presentation token** is minted (`presentationTokenHash`); **no voucher token exists yet**.
- Prospect gets an email with the reservation-pass QR + a stable `redeem.sg/r/:token` link
  (`backend/src/routes/rewardClaim.js` renders pass now, voucher later — the same link for
  the credential's life; ops resend (PR A) deliberately RE-MINTS it, killing the old
  link/QR and emailing a fresh one).
- Idempotent: partial-unique `(activationId, prospectId)` + a 15-min reconciliation sweep
  (`bootstrap.js` fulfilment sweeps) make issuance exactly-once even across restarts.
- If a partner scans this pass at the outlet, verification rejects it with a typed 422
  ("reservation pass, not a voucher — unlocks at the review") — `redemptionService.js`.

### Step 6 — Consultant gets the lead — BUILT
- Existing MKTR lead pipeline: prospect → agent assignment → webhook → push notification;
  the consultant calls and books the meeting. Unchanged by Redeem Ops.

### Step 7 — Consultant scan-to-unlock — **GAP (app screen), backend LIVE**
- **Decision (2026-07-16): mktr-leads app only.** The Lyfe unlock endpoint exists too but no
  Lyfe screen is planned.
- Backend contract, live in prod: `POST /api/external/entitlements/unlock`
  (`backend/src/routes/externalEntitlements.js`, HMAC-signed with `EXTERNAL_APP_SECRET`).
- Server enforces: entitlement `eligible` + unexpired, activation live, and **the acting agent
  is the lead's assigned consultant** — no one else can unlock. *(Activation-live is enforced
  in code since 2026-07-17 (hardening PR C): pause is a full brake — a paused activation
  blocks unlocks with a typed 409 until reactivated; completed/cancelled are terminal. The
  check also lives inside the unlock transaction, so a pause racing an unlock loses. Replay
  of an ALREADY-unlocked reward stays idempotent regardless of activation state.)*
- What's missing: the **scan screen in the mktr-leads app** (separate repo) that reads the
  prospect's QR and calls this endpoint.
- Interim workaround: admin-only **Unlock** button on `/redeem-ops/redemptions`
  (`POST /api/redeem-ops/entitlements/unlock`, audited admin override).

### Step 8 — Voucher issued — BUILT, LIVE (delivery hardened 2026-07-16/17)
- On unlock: `status='issued'`, the **voucher token** is minted (`tokenHash` — its first
  existence), `expiresAt` re-stamps to the redemption window, and the prospect receives the
  voucher email (QR + short code + partner booking link when set). The same `/r/:token`
  page now renders the voucher, including the **Book your session** CTA
  (`externalBookingUrl`).
- Hardening PR A: delivery fires from ALL unlock surfaces (it previously never fired — the
  audit's P0), every attempt writes a `notified`/`notify_failed` receipt shown on the
  Redemptions console, a 15-min recovery sweep re-mints+retries undelivered rows (≤3
  attempts), and ops can resend by email or hand out a fresh link/WhatsApp bundle
  (`POST /api/redeem-ops/entitlements/:id/resend-pass`).

### Step 9 — Partner scan-to-consume — **GAP (no partner-facing surface)**
- What exists: verify → complete in the **ops console only** (`/redeem-ops/redemptions`,
  `POST /api/redeem-ops/redemptions/verify` + `/complete`, `redemptions.verify` capability).
- Single-use is structural: `redemptions.entitlementId` is UNIQUE — a voucher cannot be
  consumed twice. Reversal is terminal and flagged.
- What's missing: anything the **partner** can hold — no scan page, no partner login, no
  partner-facing verification at all. **Mechanism undecided** (see Open decisions).
- No-shows: expired `eligible` reservations are swept every 15 min and inventory returns to pool.

---

## 3. Production flag state (verified 2026-07-16)

| Flag | State | Verified how |
|---|---|---|
| `REDEEM_OPS_ENABLED` + `VITE_REDEEM_OPS_ENABLED` | ON | site live at ops.redeem.sg |
| `REDEEM_OPS_ENTITLEMENTS_ENABLED` | **ON** | probe: `/api/reward-claim/<junk>` returns the handler's own 404 shape (router mounts at boot only when true) |
| `REDEEM_OPS_CADENCES_ENABLED` (+ `_AI_`) | ON | probe 401 on `/api/redeem-ops/cadences` + live bundle |
| `DISCOVERY_ENABLED` (+ IG pilot, AI terms, search-terms, territories) | ON | deploy-verified 2026-07-12/14 |
| `DISCOVERY_RESULT_QUOTA_ENABLED` | OFF (dark) | the only dark flag in the module |
| `EXTERNAL_APP_SECRET` / `LYFE_LEAD_OUTCOME_SECRET` | set (endpoints 401, not error) | worth re-confirming values match the apps when building step 7. Since PR D a MISSING Lyfe secret returns 500 "Server misconfigured" (parity with the external surface) — a 401 now always means bad signature, so the probe is unambiguous |

---

## 4. Lead-experience guardrails (copy, not code)

1. **State the deal in the ad + form**: "trial unlocks after a 20-min session with a
   consultant." Mis-set expectations → no-shows and burned consultant calls. This is campaign
   copy, controlled per campaign in the designer.
2. **Frame the pass page as "Step 1 of 2"** so nobody takes the reservation pass to the studio.
3. **Always fill `externalBookingUrl`** on the reward so the voucher tells the prospect how to
   book with the partner.
4. **Measure before simplifying**: entitlement statuses (`eligible → issued → redeemed/expired/
   cancelled`) are visible per activation in `/redeem-ops/analytics` (real GROUP BY counts
   since PR D) plus the last-24h skipped-issuance breakdown on each activation's detail
   (PR C) — watch where prospects actually fall out before changing the funnel.

## 5. Pre-launch checklist (added PR D — prod's one activation satisfies NONE of these yet)

Before flipping an activation `active` for a real campaign:

1. **Campaign linked** and the campaign itself is active on mktr.sg (the linkage is
   immutable once the activation is live — get it right first).
2. **`claimExpiryDays` / `redemptionExpiryDays` set** on the reward (defaults 30/90 apply
   otherwise — decide deliberately).
3. **`externalBookingUrl` filled** so the voucher page/email can tell the winner how to book
   (guardrail #3 — rendered since PR D).
4. **Allocation > 0** on the activation, sized against the offer's committed supply.
5. Offer `status='active'` and activation `endDate` unset or in the future (issuance refuses
   otherwise since PR C).
6. Ad + form copy states the deal: "trial unlocks after the review" (guardrail #1).

## 6. Open decisions

1. **Step 9 mechanism — what does the partner hold?** Options range from the fully-designed
   Partner Portal (`partners.redeem.sg`, `partner_users` auth — designed, zero code) down to a
   lighter partner-facing verify surface. **Undecided — do not build until decided.**
2. Multi-session rewards (class packs): explicitly out of scope; rewards are single-use.

---

## Appendix — verification prompt for a fresh Claude session

Paste the following into a new Claude Code session in `~/lyfe-master/mktr-platform`:

```
Read docs/redeem-ops/TRIAL_REWARD_FUNNEL.md first. It describes our canonical 9-step
trial-reward funnel (partner trial → MKTR campaign → ads → signup → reservation pass →
consultant unlock → voucher → partner redemption) and claims a build status for every step.

Your job: independently VERIFY every claim in that doc against the actual code on main and
against prod, read-only. Do not trust the doc, CLAUDE.md, or memory — verify from source.
Do NOT change any code. Database access is SELECT-only.

For each step 1–9:
1. Locate the implementing code and confirm it is actually WIRED, not just present: routes
   mounted via their meta.flag, the lead-captured hook registered in bootstrap, emails fired
   on the right transitions (reservation email on entitlement creation, voucher email on
   unlock), sweeps scheduled.
2. Verify the safety invariants hold in code:
   - issuance requires server-stamped phone verification + active activation + allocation left
   - issuance is idempotent (partial unique on activationId+prospectId, plus reconcile sweep)
   - unlock enforces eligible+unexpired+activation-live AND the assigned-consultant binding
   - the voucher token is minted ONLY at unlock (never at capture)
   - redemptions.entitlementId is UNIQUE (double-redeem structurally impossible)
   - a reservation pass presented for redemption is rejected with the typed 422
   - expired reservations are swept and inventory returned
3. Run the backend tests covering these paths: jest from backend/ (throwaway postgres on
   port 5433 with unix_socket_directories='', JWT_SECRET inline,
   NODE_OPTIONS=--experimental-vm-modules). The shortlinkService suite is chronically red —
   pre-existing, ignore it. Report which entitlement/redemption/activation suites pass.
4. Verify prod without auth where possible:
   - GET https://api.mktr.sg/api/reward-claim/<20-char-junk> → the handler's own
     {"message":"Not found"} means the router is mounted (entitlements flag ON); the generic
     "Route ... not found" shape with details means OFF.
   - POST https://api.mktr.sg/api/external/entitlements/unlock → expect 401 (mounted + HMAC).
   - Grep live route chunks on https://redeem-ops-frontend.onrender.com (pages are
     lazy-loaded — grep the page chunk, not index-*.js).
   - Optional data sanity via Render MCP query_render_postgres on mktr-db, SELECT ONLY:
     counts of reward_offers/activations by status, reward_entitlements by status,
     redemptions count; is there at least one active activation linked to a campaign?
5. Steps 7 and 9 are KNOWN unbuilt on the client side (consultant scan screen lives in the
   separate mktr-leads repo; partner consume-scan surface is undecided). For these, verify
   the backend contract is READY instead: exact endpoint, auth scheme, request/response
   shape a client must implement — write that contract out.

Deliverable: a table (step | PASS/FAIL/PARTIAL | evidence file:line | risk notes), then:
anywhere the doc is wrong about the code, any invariant that does not hold, any prod
misconfiguration you can detect, and the top 3 risks for the first real campaign.
Be adversarial — try to find the break, not to confirm the happy path.
```
