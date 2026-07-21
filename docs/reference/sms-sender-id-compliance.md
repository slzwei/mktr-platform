# SMS Sender ID compliance (SGNIC SSIR)

Our posture against the SGNIC advisory of **21 Jul 2026** ("Advisory to secure your
SMS account(s) and Sender ID(s)") and SSIR User Agreement **cl. 2.3.2**.

Verified end-to-end against the live AWS account on **2026-07-22**. Where this
document previously guessed, it now states what was measured.

---

## 1. What we actually send

| | |
|---|---|
| Registered Sender ID | **`MKTR`** (`SG`, Transactional + Promotional) |
| Registration | `arn:aws:sms-voice:ap-southeast-1:872926860708:sender-id/MKTR/SG` — **registered through AWS** as an `SG_SENDER_ID_REGISTRATION`, status `COMPLETE`. See §4. |
| Transport | **AWS SNS** (`@aws-sdk/client-sns`), `ap-southeast-1`. We hold no direct account with a Singapore Participating Aggregator — the "SMS account" the advisory refers to is our **AWS account**, and the "API keys" are **AWS IAM access keys**. |
| Message type | `Transactional` only. One template: `Your verification code is: NNNNNN` |
| Geography | +65 only, enforced server-side |
| Measured price | **$0.03918 per message** (TPG Telecom, MCC 525) |

Code paths that publish under this sender ID:

| Path | File | Notes |
|---|---|---|
| Lead-capture OTP | `backend/src/services/verificationService.js` | Public, unauthenticated, highest volume. Uses `mktr-sns-sms`. |
| Supabase Auth phone OTP | `lyfe-app/supabase/functions/custom-sms-hook/index.ts` | Separate scoped `lyfe-sns-sms` IAM user; gated by an invitation allowlist |
| SA61 weekly reminder | `backend/scripts/sa61-weekly-reminder.js` | **Cron is suspended.** Also defaults to `us-east-1`, where the SID is not registered — fix the region before ever re-enabling it |

---

## 2. Controls in code

The exposure that matters is not a stolen key — it is that `POST /api/verify/send`
is **public and unauthenticated**, and causes a message bearing `MKTR` to be
delivered to any caller-supplied number. Under cl. 8A.1.2 a regulator complaint
can get the SID suspended outright, and a dead OTP channel blocks *all* lead
capture (`campaignReadinessService` already treats it as a total blocker). So this
is uptime, not just paperwork.

| Control | Where | Behaviour |
|---|---|---|
| **Per-number daily cap — 7/day** | `services/smsQuota.js` | Keyed on the *number* (IPs rotate for free; the victim's number cannot). Counts SMS **and** WhatsApp. Fails closed. Returns `429`. |
| **Global daily ceiling — 500/day** | `services/smsQuota.js` | Hard stop; refuses to publish past it. Counts only real SNS publishes, including the WhatsApp→SMS fallback. |
| **Spike alert — 250/day** | `services/smsQuota.js` | Error log + email to `SMS_ALERT_EMAIL`. At most once per kind per day (atomic claim, so parallel instances can't double-send). |
| **Durable rate limiting** | `middleware/pgRateLimitStore.js` | Replaces MemoryStore, which counted per-process and reset on every redeploy. Fails **open** on DB error — the quota layer above is what fails closed. |
| **Real-visitor keying** | `middleware/pgRateLimitStore.js` | `api.mktr.sg` is Cloudflare-fronted, so `req.ip` is the *edge* address. We use `CF-Connecting-IP`, but only when the request genuinely arrived from a published Cloudflare range — otherwise a direct-to-origin caller could spoof the header and mint unlimited buckets. |
| **Least-privilege creds** | `services/verificationService.js` | Prefers the SNS-only `SNS_AWS_*` pair, all-or-nothing, falling back to `AWS_*`. |
| **No PII in counters** | `services/rateCounter.js` | Phone numbers are HMAC-blinded before becoming counter keys, so PDPA erasure has nothing to rebuild. |
| **No PII in logs** | `services/verificationService.js` | Numbers are masked (`+65****4567`). Render logs sit outside the erasure matrix. |

Counters live in `rate_counters` (migration `083`), are atomic
(`INSERT … ON CONFLICT … RETURNING`, verified under 25-way concurrency), self-heal
on window expiry, and are swept daily from `bootstrap.js`.

**Sizing rationale:** 60-day traffic to 2026-07-21 — busiest day ever **16 leads**,
mean **5.7** per active day. OTP sends run ~2–3× leads once drop-off and resends are
counted, so the worst real day was ≈50 SMS. Both caps are env-tunable — **raise them
deliberately before a big launch rather than letting an alert be ignored.** But see
the spend ceiling in §3d first: AWS, not this cap, is the binding constraint.

---

## 3. AWS-side posture

### a. Root MFA ✅
`AccountMFAEnabled = 1`. There are no human IAM users — every IAM user is a service
account with console access disabled — so **root is the "admin account"** the
advisory's §3 bullet 4 refers to, and it is protected.

### b. Credential separation ✅ (done 2026-07-22)
Previously `AWS_ACCESS_KEY_ID` on the backend belonged to
**`ses-smtp-user.20251229-003043`**, which carried *both*:

- `AmazonSesSendingAccess` — inline, via group `AWSSESSendingGroupDoNotRename`
- `AmazonSNSFullAccess` — **attached directly**, i.e. `sns:*`, not `sns:Publish`

So one credential could send all our email *and* do anything in SNS. Now:

| User | Policy | Used for |
|---|---|---|
| `mktr-sns-sms` | `MktrSnsSmsPublish` — `sns:Publish` only | OTP SMS (`SNS_AWS_*`) |
| `ses-smtp-user.20251229-003043` | `AmazonSesSendingAccess` via group only | Email (SMTP) |

`AmazonSNSFullAccess` has been detached, and that user's never-used 129-day-old
second key deleted. `sns:Publish` is provably sufficient — `PublishCommand` is the
only SNS call anywhere in the backend.

> **IP whitelisting (advisory §3 bullet 5) is not yet applied.** The policy can be
> conditioned on `aws:SourceIp` using Render's outbound IPs
> (Render → `mktr-backend-jo6r` → Settings → Outbound IPs). Deferred because it
> breaks local development against real SNS.

### c. Delivery status logging ✅
Enabled in `ap-southeast-1` at 100% success sampling, writing to
`sns/ap-southeast-1/872926860708/DirectPublishToPhoneNumber` with **30-day
retention**. Retention matters: these records contain **full destination phone
numbers** and sit outside the consent ledger and PDPA erasure matrix.

First captured record:

```
status           : SUCCESS
providerResponse : Message has been accepted by phone carrier
dwellTimeMs      : 36
priceInUSD       : 0.03918
phoneCarrier     : TPG Telecom  (MCC 525 / MNC 10)
smsType          : Transactional
```

**AWS hands off in 36 ms and Singapore carriers accept `MKTR` cleanly.** Any
user-perceived OTP delay is downstream of the carrier — typically the roaming leg
when the handset is abroad. Do not chase it in our code.

### d. Spend ceiling ⚠️ the real constraint
```
TEXT_MESSAGE_MONTHLY_SPEND_LIMIT   EnforcedLimit: 50   MaxLimit: 50
```
`MaxLimit: 50` is the **account maximum** — it cannot be raised in the console and
requires an **AWS support ticket**. At $0.03918/message that is a hard ceiling of
**~1,276 SMS/month (~42/day sustained)**.

Sustained at our historical peak (~50/day) that is ~$59/month — **over the cap**,
so SMS would stop mid-month and take lead capture with it. Our app-level 500/day
(≈$588/month) would never be reached first.

**Request headroom before a campaign, not during one.**

### e. Spend alarms ✅
Two CloudWatch alarms on `AWS/SNS → SMSMonthToDateSpentUSD`, notifying SNS topic
`mktr-sms-spend-alerts`:

| Alarm | Threshold |
|---|---|
| `MKTR-SMS-spend-warning-25USD` | $25 — halfway to the ceiling |
| `MKTR-SMS-spend-critical-45USD` | $45 — imminent outage |

### f. Key rotation ⚠️ outstanding
Several keys are 92–138 days old (AWS flags ≥90 days). Rotate them and set a
recurring reminder — "never rotated" is exactly what advisory §3 bullet 1 targets.

---

## 4. The Letter of Authorisation question — resolved

Advisory §4 requires an LOA when a **third-party provider sends SMS bearing your
registered SID on your behalf**, lodged with the Participating Aggregator and
copied to `smsregistry@sgnic.sg`.

`describe-sender-ids` shows `MKTR` held as an **AWS-managed
`SG_SENDER_ID_REGISTRATION`, status `COMPLETE`**, inside our own account. AWS
submitted the SSIR registration on our behalf and owns the aggregator relationship
behind it.

That is not the arrangement §4 targets. The clause addresses registering a SID
directly with SGNIC and then handing it to a third party who sends through a
*different* PA account. Here **AWS is the registered route**, not a third party
bolted onto a separately-registered SID. An LOA is very likely unnecessary.

**Residual action:** a one-line confirmation to `smsregistry@sgnic.sg` to put the
answer on record. Not a live risk.

**Forward-looking:** if MKTR ever sends SMS on behalf of a client under *their* SID
(e.g. the Prudential LTS engagement), that client must file an LOA with their PA
naming MKTR as an authorised representative. Build it into the vendor checklist.

---

## 5. When an alert fires

1. **Is it real traffic?** Compare leads created today against the SMS count. A
   genuine campaign spike shows leads roughly tracking sends.
2. **If real** → raise `SMS_DAILY_GLOBAL_CAP` **and check the AWS spend ceiling
   (§3d)** — raising ours alone achieves nothing if AWS cuts you off at $50.
3. **If not real** → the public OTP endpoint is being driven. Every one of those
   messages carries `MKTR`.
   - Drop `SMS_DAILY_CAP_PER_PHONE` to 2–3 to blunt it immediately.
   - Inspect `/api/verify/send` traffic for the source pattern.
   - Consider a CAPTCHA or campaign-validity requirement on send — the endpoint
     currently accepts any `campaignId`, including none at all.
   - Ceiling breaches log as `sms.global_ceiling_exceeded`; per-number rejections
     as `otp.phone_daily_cap_exceeded`.
4. Get ahead of SGNIC rather than waiting for a complaint. Under §7 they may
   suspend a SID immediately on a regulator's request.

## 6. Diagnosing "no SMS arrived"

In order, because each step rules out a layer:

1. **Backend logs** — `Sending OTP` / `SMS sent` with no error means SNS accepted it
   and returned a message ID. Credentials and permissions are then proven fine.
2. **`rate_counters`** — confirms the caps aren't silently rejecting
   (`otp:phone:<hmac>:<sgt-day>`, `sms:global:<sgt-day>`).
3. **Delivery logs** (§3c) — `providerResponse` gives the carrier's verdict and
   `dwellTimeMs` the real latency. A missing `…/Failure` log group means nothing has
   failed at all.
4. **Only then** suspect the handset: roaming, opt-out list, or carrier filtering.

SNS `Publish` is asynchronous — it returns success the moment AWS queues the
message, so "accepted" never proves "delivered". That gap is exactly what delivery
status logging closes.
