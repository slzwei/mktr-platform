# DNC Registry auto-scrubbing — design

**Status:** DRAFT — Codex-reviewed 2026-06-29 (full-doc pass + a focused **xhigh** deep-review of §5.5); findings verified against code + folded in (see §9). Ready for implementation once the open decisions in §8 are settled.
**Author:** Shawn / Claude
**Date:** 2026-06-29
**Driver:** Prudential "Leads to Success" (LTS) vendor onboarding requires every lead be scrubbed against Singapore's PDPC Do Not Call (DNC) Registry before it reaches an adviser who will contact it.

---

## 1. Goal

When a lead is captured (web form, QR, or Retell voice bot), automatically check the lead's Singapore phone number against the PDPC **DNC Registry API** and record, per channel (voice / SMS / fax), whether the number is **Registered (`R`)** or **Not Registered (`NR`)**. Use that result to **suppress or flag outbound contact on DNC-registered channels** before the lead is actionable by an agent, and to produce an **audit trail** that satisfies a Prudential/PDPC compliance review.

Non-goals (this iteration): a self-service DNC console UI; scrubbing of historical prospects beyond an optional one-off backfill; non-Singapore numbers (out of DNC scope).

---

## 2. What the DNC API actually is (from the PDPC spec v1.1 + FAQ)

- **Endpoint:** `POST {BASE}/check/registry`
  - UAT: `https://uat.dnc.gov.sg/realtime`
  - Prod: `https://www.dnc.gov.sg/realtime`
- **Transport:** plain HTTPS (1-way TLS). **No client cert at the TLS layer.** Caller authenticity + integrity is via an **RSA-SHA256 signature** in the `Authorization` header, which PDPC verifies against the **X.509 public cert we submit at onboarding**. Access is additionally gated by **IP allowlisting** at PDPC's firewall.
- **Batch:** up to **100 numbers per call**, results returned synchronously ("immediately").
- **Cost:** **1 prepaid credit per number checked**, deducted from MKTR's org DNC account.
- **Validity:** each response carries a human-readable validity end date in `msg` (PDPC's worked example = ~30 days). We can rely on a result until that date → **cache, don't re-check inside the window** (saves credits).
- **Three registers** returned per number: `no_voice_call`, `no_text_message`, `no_fax`, each `R` or `NR`.

### 2.1 Authorization header (order-sensitive)

The `Authorization` header value is four `&`-joined fields **in this exact order**:

```
orgCode=<ORG_CODE>&eServiceId=<ESERVICE_ID>&timestamp=<EPOCH_MS>&appSignature=<BASE64_SIG>
```

- `orgCode`, `eServiceId` — fixed values PDPC assigns at onboarding.
- `timestamp` — epoch **milliseconds**, must be a positive integer and **monotonically non-decreasing** across our requests (`>=` previous).
- `appSignature` — see below.

### 2.2 Signature

```
baseString = "orgCode=<ORG_CODE>&eServiceId=<ESERVICE_ID>&timestamp=<EPOCH_MS>"
sig        = RSA-SHA256(baseString) signed with our PEM private key
appSignature = base64(sig)          # strict base64, NO line breaks
```

The `timestamp` inside `baseString` **must be the same value** sent in the header. Node reference (matches the spec's worked example):

```js
const signer = crypto.createSign('RSA-SHA256');
signer.update(baseString);
const appSignature = signer.sign(privateKeyPem, 'base64');
```

### 2.3 Request body

```json
{ "numbers": ["90000001", "90000002"], "total": 2, "checkOnBehalf": "N" }
```

- `numbers` — **8-digit** local SG numbers, each starting `3` / `6` / `8` / `9`, max 100.
- `total` — must equal `numbers.length`. (Spec table says `String`; both worked examples show a JSON number — **verify the accepted type in UAT**.)
- `checkOnBehalf` — `"Y"` to check on behalf of another organisation, else `"N"` (default). See §3 for why this matters.

### 2.4 Response body

```json
{
  "msg": "These results are valid until 06-Nov-2020",
  "numbers": [
    { "number": "90000001", "no_voice_call": "NR", "no_text_message": "NR", "no_fax": "NR" }
  ],
  "transactionid": "5506778",
  "created_time": "2020-10-07 17:34:53",
  "status_code": "S000"
}
```

### 2.5 Status codes (Annex A)

| Code | Meaning | Our handling |
|---|---|---|
| `S000` | Success | Persist per-number result + `dnc_valid_until` from `msg`. |
| `S101` | numbers array size ≠ `total` | Bug in our request → Sentry, do not retry as-is. |
| `S102` | > 100 numbers | Bug (we batch ≤100) → Sentry. |
| `S301` | Insufficient credits | **Alert admin**, mark `pending`, stop further calls until topped up. |
| `S401` | Unauthorized | Config/onboarding issue → Sentry + alert. |
| `S402` | Bad orgCode / eServiceId | Config issue → Sentry + alert. |
| `S403` | Bad timestamp format | Code bug → Sentry. |
| `S404` | Auth failed, no mapping for eServiceId | Config/onboarding issue → Sentry + alert. |
| `S405` | HTTP method not allowed | Code bug → Sentry. |
| `S501` | DNC internal error | Transient → retry with backoff, then `pending`. |

---

## 3. Compliance model (decisions that gate the build)

> These are **business/compliance** decisions, not code decisions. The recommended defaults below are encoded as config so they can change without a redeploy. **Confirm with Prudential compliance + PDPC before go-live.**

### 3.1 Who is the "caller"? → `checkOnBehalf` + whose account

Under the PDPA the DNC duty falls on whoever *sends* the marketing message. In the LTS model a **Prudential adviser** makes the call, so the duty is theirs. Two operating models:

- **(Recommended) Scrub-as-data-quality.** MKTR checks under its *own* DNC account (`checkOnBehalf="N"`), suppresses/flags DNC-registered channels, and hands over **clean** leads. This is almost certainly what LTS wants — MKTR delivers leads an adviser can safely contact.
- **Check-on-behalf.** If PDPC/Prudential require the check to be attributable to Prudential as the eventual caller, set `checkOnBehalf="Y"`. This changes onboarding (whose org account, whose credits).

→ **Encoded as `DNC_CHECK_ON_BEHALF` (default `N`).** Decision owner: Shawn, after Prudential confirmation.

### 3.2 Consent interplay

Clear, unambiguous, recorded consent *can* be a lawful basis to contact a DNC-registered number. The lead form already captures `sourceMetadata.consent_contact`. **But** Prudential will likely require scrubbing regardless. So:

- Always check + store the DNC result **and** the consent (we already store consent).
- **Default: suppress voice contact to a `no_voice_call="R"` number even when consent is present**, unless Prudential explicitly accepts documented consent as an override.
- → Encoded as `DNC_CONSENT_OVERRIDES` (default `false`). **If ever enabled it must be per-campaign and evidence-backed** — `sourceMetadata.consent_contact` is only marketing-contact consent and is *not* sufficient for a DNC override on its own; an override needs recorded, unambiguous consent evidence in the `consentMetadata.external` shape (`prospectService.js:178`). Not legal advice; confirm with Prudential/PDPC.

### 3.3 Fail-safe default

If the check errors, times out, or is pending, treat the number as **"unknown — do not contact until cleared"** (fail safe). An outage degrades to *held-pending-scrub*, never *delivered-un-scrubbed*.

### 3.4 Enforcement: hard-block vs flag (per channel)

DNC status is **per channel**. Enforcement is configurable:

- **`flag`** — deliver the lead with prominent per-channel flags ("⛔ Do Not Call", "✅ SMS OK"). Agent-friendly; relies on adviser discipline.
- **`block`** — withhold delivery on a registered channel. For the Prudential pipeline (advisers phone leads), the strongest posture is **block voice when `no_voice_call="R"`** while still allowing the lead through on clear channels.

→ Encoded as `DNC_ENFORCEMENT` (`flag` | `block`, default `block`). Recommended: `block` for the Prudential campaign(s), `flag` elsewhere — can be per-campaign later.

---

## 4. PDPC onboarding prerequisites (parallel track, has lead time)

The code can't hit even UAT until PDPC issues `orgCode` + `eServiceId`. In progress / to-do:

1. **[in progress]** Terminate the **individual** DNC account (Shawn applied 2026-06-29).
2. Register an **organisation** DNC account for MKTR PTE. LTD. via **Corppass**; assign the "DNC Registry" e-Service to the DNC user's Corppass. *(New-account fees apply.)*
3. Buy **prepaid DNC credits** (size to lead volume × ~1 credit/number/30 days).
4. Generate an **RSA keypair**; submit the **X.509 public cert** (`mycert.cer`) to PDPC for **both UAT and Prod**. Keep `privatekey.key` as a backend secret.
   - **DECIDED: self-signed X.509** (RSA-2048, used with RSA-SHA256). Cryptographically sufficient because PDPC uses the cert only to verify our request signature — not for TLS trust — so a CA chain buys nothing here. Generated locally at `~/dnc-keys/` (`mycert.cer` = public, submit to PDPC; `privatekey.key` = secret → Render `DNC_PRIVATE_KEY`). Only fall back to a CA cert if PDPC's UAT explicitly rejects self-signed.
5. Provide PDPC the **public egress IP** + **fully-resolved hostname** of our backend for UAT + Prod, and open our firewall to `uat.dnc.gov.sg` / `www.dnc.gov.sg`.
6. Complete **UAT** with PDPC (mandatory) → receive prod creds → go live.

### 4.1 ⚠️ Egress IP is the #1 infra risk

The backend (`mktr-backend-jo6r`) runs on Render. PDPC allowlists the IP our requests come **from**.

- **Checked 2026-06-29:** `mktr-backend-jo6r` = `srv-d2s9p0emcj7s73acd9lg` — **Singapore** region, **starter** plan (paid), **1 instance**. Render's static **outbound IPs are NOT exposed via the API/MCP**; read them from the dashboard (service → Connect / Settings → "Outbound IP Addresses", a set of ~3). They're static per Render but are **shared Render egress IPs that can change** with infra updates — awkward for a government firewall allowlist that's painful to re-submit.
- **DECIDED: dedicated DigitalOcean Singapore droplet** running a tinyproxy `CONNECT` proxy (~USD 4–6/mo). The fixed egress = the droplet's **primary public IPv4** (submit *that* to PDPC — NOT a Reserved/Floating IP, which is inbound-only). Only DNC calls route through it via `DNC_HTTPS_PROXY`. Full setup: **`docs/dnc/egress-proxy-runbook.md`**.
- → `DNC_HTTPS_PROXY` (optional) lets `dncService` route through the proxy without touching the rest of the backend's egress.

---

## 5. Architecture

```
lead capture ──► createProspect / retellService ──► (post-commit) dncService.checkAndRecord(prospect)
                                                          │
                                  ┌───────────────────────┼───────────────────────┐
                                  ▼                        ▼                        ▼
                         sign + POST DNC API      persist result on prospect   ProspectActivity audit
                         (RSA-SHA256, ≤100)       (columns + dncMetadata)      ("DNC check: voice=NR…")
                                  │
                                  ▼
                 enforcement gate decides what the lead.created webhook carries / whether it fires
                                  │
                                  ▼
                 receive-mktr-lead (Lyfe)  ──►  agent app shows per-channel DNC flags

  bootstrap scheduler ──► dncBackfill: retry `pending` + re-check rows nearing dnc_valid_until
```

### 5.1 New service: `backend/src/services/dncService.js`

Mirrors `metaCapiService.js` (pure builders + injectable `fetch`, never throws to caller, Pino + Sentry on failure).

```
formatDncNumber(phone) -> "8-digit" | null     // reuse normalizePhone, strip +65, validate ^[3689]\d{7}$
buildBaseString({ orgCode, eServiceId, timestamp }) -> string   // exported, unit-tested vs spec example
signRequest(baseString, privateKeyPem) -> base64                // exported
buildAuthHeader({ orgCode, eServiceId, timestamp, appSignature }) -> string
checkNumbers(numbers[], { checkOnBehalf }, deps) -> { statusCode, validUntil, results[], transactionId }
checkAndRecord(prospect, deps) -> { dncStatus, ... }            // single-number convenience; persists + audits
nextTimestamp() -> ms                                            // monotonic guard: max(Date.now(), last+1)
```

- **Monotonic timestamp (process-wide, restart-safe):** don't rely on the single-instance assumption alone — the `setInterval` backfill can overlap request-path checks, and restarts/replicas can regress the wall clock. Serialize ALL outbound DNC calls (request-path **and** backfill) through ONE lock using **`pg_try_advisory_xact_lock`** — transaction-scoped, pinned to one connection, auto-released — **not** session-level `pg_advisory_lock`, which leaked under Sequelize's pool (the unlock ran on a different pooled connection; lesson documented at `agentSyncService.js:216`). Scope the lock **per DNC API call** (sign+send), not the whole backfill run, so a fresh lead never queues behind a refresh batch. Persist `lastTimestampMs` so `nextTimestamp()` returns `max(Date.now(), lastUsed+1)` across restarts. Strictly increasing timestamps then hold regardless of concurrency/instances (avoids `S403`).
- **Timeout:** ~5s per call (the FAQ promises real-time); on timeout → `pending` + backfill retry.
- **Secrets:** private key from `DNC_PRIVATE_KEY` (PEM). Redaction today does NOT cover it — extend **both**: add `DNC_PRIVATE_KEY` / `privateKey` / `appSignature` / `signature` / `secret` / `authorization` to `logger.js` `redact.paths` (`logger.js:14`) **and** widen the `sentryScrub.js` `PII_KEY_PATTERN` regex (`sentryScrub.js:6`, currently `phone|email|nric|name|token|jwt|address|otp|password`). Never log the key, the `Authorization` header, or the full signature.

### 5.2 Data model — migration `041-add-prospect-dnc.js`

Follow the idempotent `describeTable` guard convention (see `032-add-prospect-consent-metadata.js`). Hybrid: **discrete columns for the things we filter on** + a **JSONB blob for the full evidence**.

| Column | Type | Purpose |
|---|---|---|
| `dncStatus` | `STRING(16)` (indexed) | `pending` \| `clear` \| `registered` \| `error` \| `skipped` (non-SG). The thing admin queues filter on. |
| `dncNoVoiceCall` | `BOOLEAN` null | `true` = registered (R) on voice. Drives voice block/flag. |
| `dncNoTextMessage` | `BOOLEAN` null | text register. |
| `dncNoFax` | `BOOLEAN` null | fax register. |
| `dncCheckedAt` | `DATE` null | last successful check. |
| `dncValidUntil` | `DATE` null (indexed) | from response `msg`; cache-skip + backfill trigger. |
| `dncMetadata` | `JSONB` null | full evidence: `{ transactionId, createdTime, rawMsg, statusCode, checkOnBehalf, numberChecked }` for audit. |

(Indexes on `dncStatus` and `dncValidUntil` go **in the migration** — `ensurePostgresIndexes()` no longer exists (replaced by migration `010-add-postgres-indexes.js`; the `retellCallId` comment in `Prospect.js:249` is stale). Use migration `040`'s compliance-grade style: an `ignoreExists` helper that swallows only "already exists"/"duplicate" and re-throws everything else, plus a post-`up` assertion — **not** blanket `.catch(() => {})`, since this is a compliance table.)

### 5.3 Integration points

**The leakage problem (P0).** Suppressing only the `lead.created` webhook is *not* enough. An actionable lead also leaks via (i) the controller's `sendLeadAssignmentEmail`, fired on the returned `assignedAgentId`/`assignedAgent` (`prospectController.js:59`), and (ii) the local `quarantined`/`assignedAgentId` variables, which a *post-commit* mutation does not retroactively change. And a bare "check after commit" leaves no crash-safe record if the process dies between commit and check.

**Chosen model — born-held-pending, release-on-clear.** Reuses the existing hold→release machinery, is crash-safe, and never holds a DB transaction open across an HTTP call:

1. **Inside the create transaction**, set `dncStatus='pending'` durably. Under `DNC_ENFORCEMENT=block`, also create the lead **non-deliverable from birth**: `assignedAgentId=null`, `quarantinedAt=now`, `quarantineReason='dnc_pending'`. Because it is born held with no agent, the existing `!quarantined && !externalAgentId` guard at `prospectService.js:716` suppresses the webhook **and** the controller's `if (assignedAgentId && assignedAgent)` email gate (`prospectController.js:59`) is naturally false — **both leak paths close with no bolt-on suppression logic.** (Do NOT call the DNC API inside the transaction — that would pin a DB connection across an external request.)
2. **Post-commit**, run `dncService.checkAndRecord(prospect)`:
   - **Clear** (or registered only on non-enforced channels) → set `dncStatus='clear'` and **release via the existing release path** (`prospectService.js:1048`: atomic clear of `quarantinedAt`, credit deduct, fire the first `lead.created`). That release is the single delivery — it cannot double-fire.
   - **Registered on an enforced channel** → keep held, set `quarantineReason='dnc_registered'`.
   - **Error/timeout** → stays `dnc_pending`; the backfill (§5.5) retries. Fail-safe holds.
3. Under `DNC_ENFORCEMENT=flag`, skip the birth-hold: create normally, check post-commit, carry the result as flags in the payload (§5.4). A flag-mode lead can momentarily dispatch before the check lands — acceptable only because `flag` explicitly trades strictness for agent UX.

**Retell — `retellService.js`.** Same born-held-pending hook, mirrored in its inline create (`:271`) + dispatch (`:350`). ⚠️ **Confirm a pre-existing bug first:** the lead's number is stored as `phone: to_number`, with `from_number` only in `sourceMetadata.fromNumber` (`retellService.js:275,296`). DNC must scrub *the number an agent will dial back* — for an **inbound** consumer→bot call that is `from_number`, not `to_number` (the MKTR DDI). Confirm Retell call direction and fix the mapping before scrubbing Retell leads; scrubbing the wrong number is compliance theatre.

### 5.4 Enforcement gate + webhook payload

Add a `dnc` block to **every** delivery payload — not only `buildLeadCreatedPayload` (`prospectHelpers.js:62`), but also `buildLeadAssignedPayload` (`:113`, used when a held lead is released/reassigned) and Retell's **inline** payload (`retellService.js:350`, which doesn't use the helper):

```js
dnc: {
  status: prospect.dncStatus,
  noVoiceCall: prospect.dncNoVoiceCall,   // true = do NOT call
  noTextMessage: prospect.dncNoTextMessage,
  noFax: prospect.dncNoFax,
  checkedAt: prospect.dncCheckedAt,
  validUntil: prospect.dncValidUntil,
}
```

- `DNC_ENFORCEMENT=flag` → always dispatch; Lyfe renders per-channel flags (needs a **lyfe-app repo** change: `receive-mktr-lead` + UI read `data.lead.dnc`, show a "Do Not Call" badge / disable the call button).
- `DNC_ENFORCEMENT=block` → enforced via the born-held-pending model (§5.3), **not** a post-hoc suppression. `dnc_pending` and `dnc_registered` become **first-class hold reasons** that must be FENCED like `no_funded_external_buyer`:
  - `assignProspect` today blocks manual release of ONLY `no_funded_external_buyer` (`prospectService.js:1036`) and releases any other quarantined row + fires `lead.created` (`:1048`). **Add `dnc_pending`/`dnc_registered` to that block** (with an explicit, audited admin-override capability for `dnc_registered` if the business wants one) — otherwise an admin can manually push a DNC-registered lead to an adviser.
  - The auto release-sweep (`releaseSweep.js`) must also skip these reasons. Its claim is currently **reason-blind** (filters only on `quarantinedAt IS NOT NULL`, `:81`), so it WILL grab `dnc_*` holds unless its candidate query + claim are made reason-aware — add the fence; don't assume it already filters.
  - The **only** sanctioned release of `dnc_pending` is the DNC-clear transition in §5.3 / the backfill.
- Fail-safe: `pending`/`error` ⇒ blocked-until-cleared under `block`.

### 5.5 Caching, re-scrub & release — the DNC state machine

§5.5 is a **paid, mutating background job**, so it's specified as a reason-fenced, row-claimed, DB-locked, bounded, resumable state machine — not "caching prose." (Hardened via Codex xhigh review; verified against `releaseSweep.js` and the `agentSyncService` lock lesson — see §9.)

- **Cache.** Skip a fresh API call when `dncStatus IN ('clear','registered')` and `now() < dncValidUntil` (the check is the only thing that costs a credit).

- **Eligibility (credit-burn scope).** Re-validation/retries select ONLY contactable leads — **exclude terminal `leadStatus IN ('won','lost')`** (real enum: `new/contacted/qualified/proposal_sent/negotiating/won/lost/nurturing`, `Prospect.js:67`; "dead" is not an enum) and inactive/archived campaigns. Held `dnc_registered` rows are re-checked at most once per validity window and bounded by age/status, so a permanently-held lead isn't re-billed forever.

- **DNC-clear release (a `dnc_pending` lead comes back CLEAR).** Mirror `releaseSweep.js:77–152`, **NOT** `assignProspect` (which is fenced against `dnc_*` and would otherwise fire `lead.assigned` instead of the first `lead.created`). In ONE transaction: (1) **atomic, reason-scoped claim** — `UPDATE … SET assignedAgentId=:agent, quarantinedAt=NULL, quarantineReason=NULL, dnc…=:result WHERE id=:id AND quarantineReason='dnc_pending' AND quarantinedAt IS NOT NULL RETURNING id` (exactly one releaser wins; the reason scope IS the fence — `assignProspect`'s claim at `:1048` is reason-blind, so we can't reuse it); (2) authoritative `chargeLeadCredit(agent, campaign, t)`, rollback→re-hold on failure; (3) `persistEventDeliveries('lead.created', …, t)` — the **outbox inside the tx** (the `releaseSweep`/`webhookService.js:68` crash-safety guarantee), fail-closed if no subscriber; (4) commit, then `flushDeliveries`.

- **Crash-safety / no-API release backlog.** Recording the clear result and releasing must be **atomic (same tx)** — a crash between "write `dncStatus='clear'`" and "release" would strand the lead, because the cache rule then skips it forever while it stays `dnc_pending`. Belt-and-suspenders: the job also sweeps `dncStatus='clear' AND quarantineReason='dnc_pending' AND quarantinedAt IS NOT NULL` as a **no-API** release backlog (re-drives stranded leads, zero extra credits).

- **Scheduler (NOT the bare redeemed-audience pattern).** That `setInterval` has no re-entrancy guard and is "idempotent" only because Meta dedups (`bootstrap.js:137`) — duplicate DNC runs each burn a credit. The DNC job needs: (a) an in-process `running` flag, (b) a **DB job lock** so a slow run can't overlap the next tick, and (c) `SELECT … FOR UPDATE SKIP LOCKED` row claims so concurrent selection never double-processes a row. Batch ≤100 numbers/call.

- **Outbound-call serialization (shared with §5.1).** Every DNC API call — request-path **and** backfill — goes through `dncService` so they share ONE call lock: `pg_try_advisory_xact_lock` (txn-scoped, one connection, auto-released), **scoped per call** (sign+send), so a fresh lead never queues behind a big refresh batch.

- **`lead.updated` (forward flip — a clear lead later becomes registered).** New event, currently **UNWIRED**: the Lyfe subscriber is seeded with only created/assigned/unassigned (`bootstrap.js:191`), the receiver rejects unknown events (`receive-mktr-lead/index.ts:127`), and lyfe-app has no DNC fields. Wiring needs subscriber + receiver + lyfe-app handler (DNC fields → disable/enable the call affordance). Dispatch via `persistEventDeliveries` (outbox) in the same tx as the state change — not fire-and-forget `dispatchEvent`. Target the lead's **current** owner/destination; idempotent if the Lyfe lead is missing/deleted; skip terminal leads.

- **Reverse flip (registered → clear).** Required and symmetric (else rechecking held rows just burns credits): a held `dnc_registered` lead that becomes clear AND is still contactable runs the same DNC-clear release; a flag-mode lead already delivered gets a `lead.updated` re-enabling the call.

### 5.6 Config / env (Render backend)

| Var | Default | Purpose |
|---|---|---|
| `DNC_API_ENABLED` | `false` | Master switch. |
| `DNC_BASE_URL` | `https://uat.dnc.gov.sg/realtime` | UAT → flip to prod at go-live. |
| `DNC_ORG_CODE` | — | Assigned by PDPC. |
| `DNC_ESERVICE_ID` | — | Assigned by PDPC. |
| `DNC_PRIVATE_KEY` | — | **Secret** PEM. Pino-redacted, never committed. |
| `DNC_CHECK_ON_BEHALF` | `N` | §3.1. |
| `DNC_ENFORCEMENT` | `block` | `flag` \| `block` (§3.4). |
| `DNC_CONSENT_OVERRIDES` | `false` | §3.2. |
| `DNC_HTTPS_PROXY` | — | Optional fixed-IP egress proxy (§4.1). |
| `DNC_BACKFILL_ENABLED` | `false` | Re-scrub/retry scheduler. |
| `DNC_REVALIDATE_DAYS` | `5` | Re-check this many days before `dncValidUntil`. |

### 5.7 Observability & audit

- Pino: `dnc.check.sent` / `dnc.check.blocked` / `dnc.check.error` / `dnc.backfill.done` (mirror `capi.*`, `redeemed_audience.sync.done`).
- Sentry on `S301`/`S401`/`S402`/`S404`/`S501` and transport errors.
- **`ProspectActivity`** per check — the compliance evidence Prudential/PDPC will ask for: `"DNC check: voice=NR text=R fax=NR · valid until 2026-07-29 · txn 5506778"`.

---

## 6. Testing

Mirror `metaCapiService.test.js` / `redeemedAudienceService.test.js` (mock `fetch`):

- **Signature** (freeze before UAT): `buildBaseString` exact-match the spec example; build the `Authorization` header by **raw string concatenation in the documented order** (never `URLSearchParams`, which may reorder/encode); `crypto.createSign('RSA-SHA256')` over UTF-8 input; **normalize PEM newlines** from the env var (`\n` → real newlines); round-trip verify the base64 signature with the public key. Cover `total` as **both string and number** until UAT confirms which PDPC accepts.
- **Vendor the spec as test vectors:** the realtime API contract (100-batch limit, header, status codes) isn't publicly documented, so commit the PDPC spec PDF + a sample request/response under `docs/dnc/` and drive the signature/parse tests from those fixtures.
- **Number formatting**: `+65 9123 4567` / `6591234567` / `91234567` → `91234567`; non-SG / landline-not-`3689` → `null` → `skipped`.
- **Status codes**: each Annex-A code → correct `dncStatus` + side-effect.
- **Caching**: in-window → no API call.
- **Enforcement**: `block` + `noVoiceCall` → quarantined / voice suppressed; `flag` → dispatched with `dnc` block; `pending` → fail-safe blocked.
- **Backfill**: picks `pending`/`error` + near-expiry; batches ≤100.
- Run with the project's jest setup (sandbox off + inline `JWT_SECRET`); the ~5 DB-dependent suites that need local Postgres are expected to ECONNREFUSED locally.

---

## 7. Rollout sequence

1. **Parallel now:** PDPC onboarding (§4) — org account, credits, keypair/cert, IP/firewall, UAT booking.
2. **Resolve egress IP** (§4.1) before submitting an IP to PDPC.
3. Build behind `DNC_API_ENABLED=false`: migration, `dncService`, integration hooks, payload extension, backfill, tests. Ships dark.
4. Point at **UAT** creds; complete PDPC UAT.
5. lyfe-app change (read `data.lead.dnc`, render flags / disable call) — separate repo, coordinate.
6. Flip to **prod** creds + `DNC_API_ENABLED=true` for the Prudential campaign(s); start `flag`, then `block`.
7. Optional one-off backfill of recent open leads.

---

## 8. Open decisions (need Shawn / Prudential / PDPC)

1. **Who is the caller** → `checkOnBehalf` + whose DNC account/credits (§3.1).
2. **Consent override** allowed? → `DNC_CONSENT_OVERRIDES` (§3.2).
3. **Enforcement**: `block` vs `flag`, globally or per-campaign (§3.4).
4. ~~Egress~~ → **DECIDED: DigitalOcean SG droplet `CONNECT` proxy**; submit the droplet's primary public IPv4 to PDPC (`docs/dnc/egress-proxy-runbook.md`, §4.1).
5. ~~Cert: self-signed vs CA~~ → **DECIDED: self-signed X.509** (RSA-2048), generated at `~/dnc-keys/` (§4 step 4).
6. **Sync-before-dispatch vs async+pending** webhook (§5.3).
7. **`total`** field type (string vs number) — verify in UAT (§2.3).
8. **Retell number mapping**: is `prospect.phone` (`to_number`) the consumer's number or the MKTR DDI (inbound)? Fix before scrubbing Retell leads (§5.3).

---

## 9. Revision log — Codex review (2026-06-29, verified against code)

All findings below were verified against the actual source before folding in.

**P0 (correctness/compliance — reworked the design):**
- **Webhook suppression alone leaks the lead.** The controller emails the adviser on the returned `assignedAgentId` (`prospectController.js:59`), and a post-commit mutation doesn't change the local `quarantined` state. → Replaced "await-then-suppress" with the **born-held-pending, release-on-clear** model (§5.3), which closes both the webhook and email leak paths via existing machinery.
- **Quarantine reuse collided with manual release.** `assignProspect` releases any held row except `no_funded_external_buyer` (`:1036`/`:1048`). → `dnc_pending`/`dnc_registered` are now first-class **fenced** hold reasons in `assignProspect` + `releaseSweep.js` (§5.4).
- **No crash-safe pending record.** → `dncStatus='pending'` is written **inside the create transaction**; the backfill re-drives anything stuck (§5.3/§5.5).

**P1 (folded in):**
- Retell scrubs `to_number`, which may be the MKTR DDI, not the consumer (§5.3, §8.8).
- `dnc` block must extend `buildLeadAssignedPayload` + Retell's inline payload, not just `buildLeadCreatedPayload` (§5.4).
- Indexes belong in the migration (`ensurePostgresIndexes` is gone); use `040`'s `ignoreExists`+assert style (§5.2).
- Monotonic timestamp must be process-wide (advisory lock + persisted `lastTimestampMs`), not "single-instance" hand-waving (§5.1).
- Redaction doesn't cover the key/signature/secret — extend `logger.js` + `sentryScrub.js` (§5.1).
- `consent_contact` is not strong enough to override DNC; require evidence-backed per-campaign consent (§3.2).

**P2 (folded in):** raw-order signing tests + PEM-newline normalization + `total` string/number (§6); vendor the spec PDF as test fixtures (§6); `lead.updated` downstream-flip path for re-scrub (§5.5); structured per-check audit via `ProspectActivity`, not a latest-only blob (§5.2/§5.7).

### §5.5 deep-review — Codex xhigh (2026-06-29, verified against code, folded into §5.5 + §5.1)

§5.5 was rewritten from "caching prose" into a reason-fenced release/revalidation **state machine**:
- **Release path = mirror `releaseSweep.js:77–152`, not `assignProspect`.** Verified `assignProspect`'s release claim is **reason-blind** (`:1048`, `WHERE quarantinedAt IS NOT NULL`), so reusing it would both hit the new `dnc_*` fence and misfire `lead.assigned` instead of the first `lead.created`. The release uses an atomic reason-scoped claim + in-tx `chargeLeadCredit` + `persistEventDeliveries` outbox + `flushDeliveries`.
- **Crash-safety:** record-clear and release must be atomic, else a crash strands the lead (cache rule then skips it forever); added a no-API `clear ∧ dnc_pending ∧ quarantined` release-backlog sweep.
- **Scheduler:** the redeemed-audience `setInterval` has **no re-entrancy guard** (`bootstrap.js:137`) and is credit-unsafe for a paid API → running-flag + DB job lock + `FOR UPDATE SKIP LOCKED` row claims.
- **Timestamp lock:** `pg_try_advisory_xact_lock` **per call**, not session-level `pg_advisory_lock` — verified the latter leaked under Sequelize pooling and was already replaced (`agentSyncService.js:216`). §5.1 corrected.
- **Credit-burn scope:** exclude terminal `won`/`lost` (verified enum, `Prospect.js:67`; no "dead") + archived campaigns; bound held re-checks.
- **`lead.updated` is unwired:** verified the subscriber seeds only created/assigned/unassigned (`bootstrap.js:191`) and the Lyfe receiver rejects unknown events (`receive-mktr-lead/index.ts:127`); needs subscriber + receiver + lyfe-app work, dispatched via the outbox (not `dispatchEvent`).
- **Reverse flip (registered→clear)** added as a required symmetric path.

---

## 10. Implementation status — build on `feat/dnc-scrubbing` (2026-06-30)

**Done + unit-tested** (49 DNC tests; 124 incl. existing `prospectAssignment`/`prospectHelpers` suites all green → no live-pipeline regression):
- Migration `041-add-prospect-dnc.js` + 7 `Prospect` columns (§5.2).
- `dncService.js` — RSA-SHA256 signing (PEM-newline-safe, verified against a public key in tests), number formatting, Annex-A status map, `parseResponse`, monotonic `nextTimestamp`, `pg_try_advisory_xact_lock` per-call serialization, `node-fetch` + lazy `https-proxy-agent`, `checkNumbers`, `checkAndRecord`, validity cache (§2, §5.1).
- `dncGate.js` — born-held-pending state machine: `releaseDncClearedLead` (releaseSweep-style atomic reason-scoped claim + in-tx authoritative charge + `persistEventDeliveries` outbox + flush) and `gateHeldDncLead` (§5.3, §5.5).
- `createProspect` (web/QR) — block-mode born-held + post-commit gate; flag-mode check+record (§5.3).
- `assignProspect` DNC fence; `dnc` payload block on `buildLeadCreatedPayload` + `buildLeadAssignedPayload` (§5.4). `releaseSweep` is already candidate-scoped to `no_funded_agent`, so it's DNC-safe as-is.
- Config (`env.example`) + redaction (`logger.js`, `sentryScrub.js`) + `https-proxy-agent` dep declared.
- Everything is behind `DNC_API_ENABLED` (`dncEnforcement → 'off'`) → **ships dark**; the existing pipeline is byte-for-byte unchanged when DNC is disabled.

**Remaining:**
- **Retell source** (`retellService.js`) — the born-held-pending hook is not yet wired there. The web/QR funnel (redeem.sg/LeadCapture) is the Prudential path; Retell is a secondary source. Until wired, Retell leads aren't scrubbed even when DNC is on.
- **Backfill** (`dncBackfillService.js` + bootstrap) — re-scrub/retry job, no-API release backlog, reverse flip, and the `lead.updated` event (needs Lyfe subscriber + receiver + a lyfe-app handler). Until done: error/timeout-held leads aren't auto-retried and results aren't revalidated before expiry.
- `https-proxy-agent` is declared in `package.json` + lockfile; the proxy path dynamic-imports it only when `DNC_HTTPS_PROXY` is set.
