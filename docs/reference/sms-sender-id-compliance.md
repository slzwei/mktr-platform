# SMS Sender ID compliance (SGNIC SSIR)

Our posture against the SGNIC advisory of **21 Jul 2026** ("Advisory to secure your
SMS account(s) and Sender ID(s)") and SSIR User Agreement **cl. 2.3.2**.

---

## 1. What we actually send

| | |
|---|---|
| Registered Sender ID | **`MKTR`** — Live, case-sensitive, registered in `ap-southeast-1` |
| Transport | **AWS SNS** (`@aws-sdk/client-sns`). We do **not** hold a direct account with a Singapore Participating Aggregator — the "SMS account" the advisory refers to is our **AWS account**, and the "API keys" are **AWS IAM access keys**. |
| Message type | `Transactional` only. One template: `Your verification code is: NNNNNN` |
| Geography | +65 only, enforced server-side |

Three code paths publish under this sender ID:

| Path | File | Notes |
|---|---|---|
| Lead-capture OTP | `backend/src/services/verificationService.js` | Public, unauthenticated, highest volume |
| Supabase Auth phone OTP | `lyfe-app/supabase/functions/custom-sms-hook/index.ts` | Already uses a scoped `lyfe-sns-sms` IAM user; gated by an invitation allowlist |
| SA61 weekly reminder | `backend/scripts/sa61-weekly-reminder.js` | Utility script. Defaults to `us-east-1`, where the SID is **not** registered — messages sent from it can be relabelled "Likely-SCAM" |

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
| **Spike alert — 250/day** | `services/smsQuota.js` | Error log + Sentry + email to `SMS_ALERT_EMAIL`. Fires at most once per kind per day (atomic claim, so parallel instances can't double-send). |
| **Durable rate limiting** | `middleware/pgRateLimitStore.js` | Replaces MemoryStore, which counted per-process and reset on every redeploy. IPv6 collapsed to /64. Fails **open** on DB error — the quota layer above is what fails closed. |
| **Least-privilege creds** | `services/verificationService.js` | Prefers `SNS_AWS_*` over the shared `AWS_*` pair (which also carries SES). All-or-nothing pairing. |
| **No PII in counters** | `services/rateCounter.js` | Phone numbers are HMAC-blinded before becoming counter keys, so PDPA erasure has nothing to rebuild. |

Counters live in `rate_counters` (migration `083`), are atomic (`INSERT … ON
CONFLICT … RETURNING`, verified against live Postgres under 25-way concurrency),
self-heal on window expiry, and are swept daily from `bootstrap.js`.

**Sizing rationale:** 60-day traffic to 2026-07-21 — busiest day ever **16 leads**,
mean **5.7** per active day. OTP sends run ~2–3× leads once drop-off and resends are
counted, so the worst real day was ≈50 SMS. 500 leaves ~10× headroom; 250 alerts at
~5× peak. Both env-tunable — **raise them deliberately before a big launch rather
than letting an alert be ignored.**

---

## 3. Manual steps (AWS console — cannot be done from code)

### a. MFA audit — advisory §3, bullet 4
IAM → Users. Confirm MFA on the root account and every human user. Root without
MFA is the single worst finding an auditor could make here.

### b. Create an SNS-only IAM user — advisory §3, bullets 2 & 3
Today the backend's `AWS_ACCESS_KEY_ID` is **shared between SNS and SES**. Split it:

1. IAM → Users → Create user, e.g. `mktr-sns-sms`.
2. Attach an inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishSmsOnly",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["REPLACE_WITH_RENDER_OUTBOUND_IP_1/32",
                           "REPLACE_WITH_RENDER_OUTBOUND_IP_2/32"]
        }
      }
    }
  ]
}
```

`Resource: "*"` is required — direct-to-phone publishing has no topic ARN to scope
to. The `IpAddress` condition is advisory §3 bullet 5 (IP whitelisting); get the
addresses from **Render → mktr-backend-jo6r → Settings → Outbound IPs**. Omit the
whole `Condition` block if you want to defer this — the policy is still a large
improvement without it, but note that a leaked key is then usable from anywhere.

> The IP condition will also block local development against real SNS. Use the
> WhatsApp channel or a stub locally.

3. Create an access key for the new user and set on `mktr-backend-jo6r`:
   - `SNS_AWS_ACCESS_KEY_ID`
   - `SNS_AWS_SECRET_ACCESS_KEY`

   Set **both or neither** — a half-set pair is deliberately ignored (mixing a new
   key id with an old secret would fail every publish).

4. Deploy, send one real OTP to confirm delivery, **then** remove `sns:Publish`
   from whatever policy the shared `AWS_*` user carries.

### c. Rotate and prune keys — advisory §3, bullets 1 & 3
IAM → Users → Security credentials. Delete keys that are inactive or unused
(check "Last used"). Note the age of each surviving key and set a rotation
reminder — the advisory asks for *regular* rotation, and "never rotated" is the
finding to avoid.

### d. Cap SMS spend — advisory §3, bullet 6
AWS End User Messaging (or SNS console) → Text messaging preferences → set the
**account monthly SMS spend limit**. This is the backstop *below* our application
cap: even a total application bypass cannot exceed it. Lowering is self-service;
raising above the account limit needs a support ticket.

### e. Alarm on spend — advisory §3, bullet 6
CloudWatch → Alarms → create on namespace `AWS/SNS`, metric
`SMSMonthToDateSpentUSD`, threshold at roughly half the spend limit → SNS email
topic. This is the AWS-side twin of our in-app 250/day alert; it still fires if the
application is bypassed entirely.

### f. Set the alert address
On `mktr-backend-jo6r`, set `SMS_ALERT_EMAIL` — without it, spike and ceiling
alerts are log/Sentry only and nobody gets paged.

### g. Fix the SA61 script region
`backend/scripts/sa61-weekly-reminder.js` defaults to `us-east-1`, where `MKTR` is
not registered. Either set `AWS_REGION=ap-southeast-1` wherever it runs, or retire
the script.

---

## 4. Open question — the Letter of Authorisation (advisory §4)

Advisory §4 requires an LOA when a **third-party provider sends SMS bearing your
registered SID on your behalf**, lodged with the Participating Aggregator and
copied to `smsregistry@sgnic.sg`.

We send via AWS rather than holding a PA account directly, so whether AWS counts as
that third party depends on **how `MKTR` was registered**:

- If **we** registered it with SGNIC directly and merely send through AWS → §4
  arguably bites and an LOA should be filed.
- If **AWS** submitted the registration on our behalf through its own aggregator →
  likely already covered.

**Action: email `smsregistry@sgnic.sg` and ask.** It is cheap, and it puts a
good-faith enquiry on the record either way. Until answered, treat this as the one
genuinely unresolved item in this document.

**Forward-looking (Prudential LTS and similar):** if MKTR ever sends SMS on behalf
of a client under *their* SID, that client must file an LOA with their PA naming
MKTR as an authorised representative. Build it into the vendor checklist — in a
compliance-led sale it reads as a credibility signal, not overhead.

---

## 5. When an alert fires

1. **Is it real traffic?** Check leads created today against the SMS count. A
   genuine campaign spike shows leads roughly tracking sends.
2. **If real** → raise `SMS_DAILY_GLOBAL_CAP` on `mktr-backend-jo6r` and redeploy.
   Do not leave it hitting the ceiling; a hard stop means real users cannot verify.
3. **If not real** → the public OTP endpoint is being driven. Every one of those
   messages carries `MKTR`.
   - Drop `SMS_DAILY_CAP_PER_PHONE` to 2–3 to blunt it immediately.
   - Inspect `/api/verify/send` traffic for the source pattern.
   - Consider a CAPTCHA or campaign-validity requirement on send — the endpoint
     currently accepts any `campaignId`, including none at all.
   - Ceiling breaches are logged as `sms.global_ceiling_exceeded`; per-number
     rejections as `otp.phone_daily_cap_exceeded`.
4. Get ahead of SGNIC rather than waiting for a complaint. Under §7 they may
   suspend a SID immediately on a regulator's request.
