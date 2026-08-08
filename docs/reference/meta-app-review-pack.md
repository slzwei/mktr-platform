# Meta App Review pack — Connect Facebook (self-serve agent onboarding)

Everything Meta's reviewer (and future-us) needs to understand, test, and approve the
five Advanced Access permissions behind the MKTR Leads "Connect Facebook" feature.
Designed so the actual App Review submission is a copy-paste job.

**Companion docs:** design `docs/plans/facebook-connect-self-serve.md` · review trail
`docs/plans/fb-connect-review-round1.md` · pipe internals `docs/plans/meta-lead-ads-native-pipe.md`
· ops `docs/reference/meta-lead-ads-runbook.md`.

---

## 1. App identity

| Field | Value |
|---|---|
| App | **MKTR Lead Gen** — id `1957456775175661` (Business type, **Published/Live**) |
| Business | VoxaLabs AI (`645399914612858`) |
| Category | Business and pages |
| Privacy policy | https://redeem.sg/personal-data-policy |
| Contact | admin@mktr.sg |
| App domains | `api.mktr.sg`, `redeem.sg`, `mktr.sg` |
| Login product | Facebook Login for Business |
| Login configuration | **MKTR Agent Connect** — config_id `1082961057752303`, General variation, **User access token** type |

## 2. What the product does (reviewer summary)

MKTR runs a lead-generation platform for licensed consultants ("agents") in Singapore.
Agents use the **MKTR Leads** mobile app (App Store / Play: `sg.mktr.leads`) to receive
and work consumer leads. With Connect Facebook, an agent taps **Connect Facebook** in
the app's Profile tab, signs in with their own Facebook account, and grants access to
the business Page they advertise with. MKTR's backend then — with no further user
action — creates a ready-to-use **lead-gen form** on that Page (with our pinned PDPA
consent disclaimer), subscribes the Page to `leadgen` webhooks, and routes every form
submission to that agent's phone in real time. Disconnecting in the app tears the
integration down; the agent's ads and the form itself remain theirs on Meta.

No user content is ever posted. No consumer-facing Facebook surface exists. The only
data retrieved is (a) the user's Page list at connect time, (b) Page metadata for the
selected Page, and (c) lead submissions from the agent's own forms.

## 3. Permissions requested ↔ why ↔ where the screencast shows it

Requested set (must match `REQUIRED_SCOPES` in `backend/src/services/metaConnectService.js`
and the login configuration — a lint test pins this file to the code):

| # | Permission | Why we need it | Screencast step |
|---|---|---|---|
| 1 | `pages_show_list` | List the Pages the agent manages so they can pick the one they advertise with (auto-selected when they manage exactly one). | Step 4 — Page picker |
| 2 | `pages_read_engagement` | Read the selected Page's basic fields (name, id) to display in the app and validate the connection. Dependency of the management scopes. | Step 5 — "Setting up your Page" |
| 3 | `pages_manage_metadata` | Subscribe the app to the selected Page's `leadgen` webhook (`POST /{page}/subscribed_apps`) so lead submissions reach MKTR — the core of the integration. | Step 5 — automatic wiring |
| 4 | `pages_manage_ads` | Create the lead-gen form on the agent's Page (`POST /{page}/leadgen_forms`) with our compliance-pinned consent question. Form creation is gated on this permission. | Step 5 — form appears; Step 6 shows it in the app |
| 5 | `leads_retrieval` | Fetch the answers of each lead submitted on the agent's form when the `leadgen` webhook fires, so the lead lands in the agent's CRM app. | Step 7 — test lead arrives on the phone |

Explicitly **not** requested: `ads_management`, `ads_read`, `business_management` —
agents run their ads themselves in Ads Manager; MKTR never touches ad accounts.

## 4. Screencast script (dev-mode dress rehearsal = the recording)

1. Open MKTR Leads app → Profile tab → row **Facebook ads**.
2. Screen explains the feature → tap **Connect Facebook**.
3. System browser opens Facebook Login for Business (config `1082961057752303`);
   sign in, review the requested permissions, tick the business Page, approve.
4. If several Pages were granted: the app shows the Page picker; choose one.
5. App shows "Setting up your Page…" while the backend provisions (form + webhook + routing).
6. Screen flips to **Connected** showing Page name and the created lead form's name.
7. Submit a test lead via Meta's Lead Ads Testing Tool on that form → the lead pops
   up on the agent's phone (push + Leads tab).
8. Tap **Disconnect** → confirmation explains ads/form keep running; status returns
   to not-connected. (Deauthorize via Facebook settings triggers the same teardown
   through the deauthorize callback.)

## 5. Reviewer test setup (fill the credentials at submission time)

- Test agent login for the MKTR Leads app: a dedicated test phone number + OTP
  (provided in the submission's test-credentials field).
- Facebook side: reviewers use their own test user; any FB account that manages a
  Page works. For dev-mode verification we use a scratch Page owned by the app
  admin (standard access restricts the dialog to app-role users until Advanced
  Access is granted — which is exactly what this submission requests).
- The completion web page (`https://redeem.sg/fb-connected`) and the deletion status
  page (`https://redeem.sg/fb-data-deletion`) are public and inspectable.

## 6. OAuth + lifecycle endpoints (all live on `api.mktr.sg`)

| Endpoint | Purpose |
|---|---|
| `GET /api/meta/oauth/callback` | Single-use opaque-nonce state; stores the code; 302 → completion page. Never does Graph work inline. |
| `POST /api/meta/oauth/deauthorize` | `signed_request` (HMAC-verified with the app secret) → auto-disconnect of the user's connection. |
| `POST /api/meta/oauth/data-deletion` | `signed_request` → full scrub of the user's connection rows + sealed tokens; responds with `{url, confirmation_code}` per Meta's contract; status visible at `https://redeem.sg/fb-data-deletion?code=…`. |

Valid OAuth Redirect URI (strict mode ON): `https://api.mktr.sg/api/meta/oauth/callback`.

## 7. Data handling, retention, deletion (the reviewer's privacy questions)

- **Stored:** Page id + name, form id + name, the app-scoped FB user id
  (`fbUserIdAppScoped`), and the selected Page's access token — sealed with
  AES-256-GCM (key never leaves the server env; AAD binds ciphertext to its row).
  Lead submissions (name/phone/answers) flow into the agent's CRM as first-party
  business records under MKTR's PDPA policy, with a consent ledger entry per lead.
- **Never stored:** Facebook passwords (OAuth only), long-lived user tokens beyond
  the provisioning window (page tokens only after setup), ad-account data.
- **Deletion paths:** in-app Disconnect (tears down webhook subscription + wipes the
  sealed token); Facebook-side deauthorize (callback auto-disconnects); Meta Data
  Deletion Request (full scrub + confirmation code); MKTR account deletion cascades
  the same teardown via the agent-sync deactivation hook.
- Consent text on every generated form is the pinned PDPA disclaimer in
  `backend/src/config/contactConsent.js` (checkbox key `mktr_pdpa_consent`;
  editing the copy mints a new consent era by design).

## 8. Access-level plan

- **Today (standard access):** the whole flow works end-to-end for users with app
  roles — how we run the dev-mode rehearsal and record the screencast.
- **This submission (Advanced Access, the 5 permissions above):** lets any MKTR
  agent — no app role — complete the dialog. UI is already live-but-dark in the
  shipped app; the backend flag `META_OAUTH_ENABLED` flips the feature on.
- **Tech Provider enrollment:** intentionally NOT part of this pack; it is a
  separate, explicitly-gated business decision.

## 9. Config registry (names only — values live in Render env / Meta dashboard)

`META_APP_ID` · `META_APP_SECRET` · `FB_LOGIN_CONFIG_ID` (=`1082961057752303`) ·
`META_OAUTH_CALLBACK_ORIGIN` (=`https://api.mktr.sg`) · `META_STATE_SECRET` ·
`META_PAGE_TOKEN_ENC_KEY` · `META_AGENT_ADS_CAMPAIGN_ID` · `META_OAUTH_ENABLED`
(master switch, prod-on requires the full group per `envValidation.js`) ·
EF-side: `MKTR_FACEBOOK_URL` + `EXTERNAL_APP_SECRET` (Supabase project `rciuejxgziqxrwtifpbo`).
