# Meta Lead Ads — operator runbook

How to wire a Facebook/Instagram instant form into the lead pipeline.
Design doc: `docs/plans/meta-lead-ads-native-pipe.md`. Everything here is
operator clicking + env pasting — no code.

## 1. One-time: Meta Business Manager side

1. **System user token** — business.facebook.com → Business settings → Users
   → System users → create (admin type, e.g. `mktr-leads-integration`) →
   **Assign assets**: the Facebook Page(s) that will run lead ads (full
   control) → **Generate token** with scopes: `leads_retrieval`,
   `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`.
   Copy the token — this is the page access token (business-owned; survives
   staff password changes).
2. **App secret** — developers.facebook.com → your business app → Settings →
   Basic → App secret.
3. **Invent a verify phrase** — any random string; Meta echoes it during
   webhook registration.
4. **App Review** (for Live mode): request `leads_retrieval` +
   `pages_manage_metadata`. Development mode already works for pages the app
   admins own — enough for the full dry run below. Business verification is
   already done (WhatsApp Cloud API required it).

## 2. One-time: Render env (user-only — paste in the dashboard)

| Var | Value |
|---|---|
| `META_LEAD_ADS_ENABLED` | `true` |
| `META_APP_SECRET` | from step 1.2 |
| `META_VERIFY_TOKEN` | from step 1.3 |
| `META_PAGE_TOKEN_ENC_KEY` | generate: `openssl rand -hex 32` |
| `META_PAGE_ID` / `META_PAGE_ACCESS_TOKEN` | OPTIONAL pair — skip if registering pages via the admin API (preferred) |

Boot refuses to start with the flag on and any of the three secrets missing
— an error in Render logs naming the missing var is this, not a crash.
Preflight-confirm these are still `true` (all live today):
`WEBHOOK_ENABLED`, `HELD_LEAD_PING_ENABLED`, `HELD_LEADS_EXTERNAL_ENABLED`.

## 3. One-time: webhook wiring (after deploy is verified live)

1. App dashboard → **Webhooks** → object **Page** → Add callback:
   URL `https://api.mktr.sg/api/meta/webhook`, verify token = your phrase →
   Verify and save (green = our GET handshake answered).
2. Tick the **`leadgen`** field subscription.
3. **Subscribe the Page to the app** — Graph API Explorer (page token):
   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`.

## 4. Per page: register it (admin JWT required)

```bash
curl -X POST https://api.mktr.sg/api/meta/pages \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"pageId":"<numeric page id>","name":"MKTR / Redeem page","accessToken":"<system-user token>"}'
```

The token is sealed at rest and never echoed back. Deactivating a page
(`isActive:false` via the same endpoint) STOPS its leads — it does not fall
back to anything.

## 5. Per form: build it right, then map it

**In Ads Manager (instant form builder):**

- Phone number: **required**. Email: recommended. (A lead with an
  unparseable phone still captures, with the raw value preserved in notes.)
- Privacy policy link: your Personal Data Policy URL (Meta mandates one).
- **Custom disclaimer → add ONE optional checkbox** with key
  `mktr_pdpa_consent` and EXACTLY this text (consent evidence is pinned to
  this wording — registry era `2026-08-06-meta-leadgen-v1`; changing the
  text requires a new registry era first):

  > I consent to MKTR Pte. Ltd. (Redeem) contacting me by phone call, text
  > message (SMS or WhatsApp) or email about this offer and my sign-up,
  > using the details provided in this form. I can opt out at any time —
  > see the Redeem Personal Data Policy for details.

  Unchecked/absent = the lead still arrives, with NO consent recorded
  (agents can still work it; it is excluded from marketing nurture).

**Then map the form** (form ID is in the form library / leadgen tooling):

```bash
curl -X POST https://api.mktr.sg/api/meta/form-mappings \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"formId":"<numeric form id>","formName":"Aug CareShield form","campaignId":"<mktr campaign uuid>","qrTagId":null}'
```

- `campaignId` decides delivery: fund agents with lead packages on that
  campaign (auto round-robin + instant push) or leave it quota-enforced
  (held queue → you dispatch by hand).
- `qrTagId` (optional) = direct-to-one-agent routing: the lead behaves like
  a scan of that agent's QR. Only QRs directly owned/assigned to an active
  agent on the SAME campaign are accepted.
- **An unmapped form is never lost**: its leads land in the `[Meta] Unmapped`
  held pool and ping the admin app. Map the form, then dispatch them.

## 6. Dry run (zero ad spend)

developers.facebook.com/tools/lead-ads-testing → pick page + form → Create
lead → within seconds: prospect in MKTR admin, push on the agent's phone,
FB/IG badge on the card. Delete the test lead in the tool afterwards.
(Test leads fetch through the same Graph call; already-deleted test leads
show up as inbox rows dead with `lead_not_found` — harmless.)

## 7. Watch + troubleshoot

- **Dead letters**: `GET /api/meta/inbox?status=dead` (admin). Revive one:
  `POST /api/meta/inbox/{leadgenId}/retry`.
- **`unknown_page`** dead rows = leads from a Page nobody registered (step 4).
- **`token_unreadable`** or repeated Graph 401/403 in logs = token
  rotated/expired → re-save it via step 4; queued leads deliver on retry.
- **No push but prospect exists** = check the campaign's funded agents /
  held queue; held leads are a feature, not a failure.
- Meta retries undelivered webhooks with backoff and can disable the
  subscription after sustained failures — if Render was down long, check
  the app dashboard's webhook health pane, then the inbox.
