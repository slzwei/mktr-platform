# WhatsApp MARKETING template pack — cohort pushes (`watemplates`)

**Status:** drafted 2026-07-22 · image-header variants added 2026-07-23 (§2.4) · submission pending (creds are Render-only — see §5) · Meta approval external
**Submission tool:** `backend/scripts/submit-wa-marketing-templates.mjs` (the canonical JSON lives there; `--dry` prints it)
**Consumers:** `wapush` (WhatsApp option on the cohort Push button, rides `whatsappService.js` + the email-broadcast runner) and `pushmeasure` (utm contract on the CTA button)

## 1. Scope & where these live

Three English MARKETING templates for curated cohort pushes: **new-campaign push**, **new-draw push**, and a **generic offer**. They are submitted to the **dedicated Redeem WABA** — the one that already holds the approved UTILITY templates `reward_pass` / `reward_voucher` and whose creds the backend uses as `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (see `envValidation.js`). Do **not** submit them under the OTP setup (`META_WA_*`) — that is a different sender.

Locked-in conventions (must match `whatsappService.js`):

| Convention | Value | Why |
|---|---|---|
| Language | `en` (plain "English", **not** "English (US)") | `WHATSAPP_TEMPLATE_LANG` defaults to `en`; an `en_US`-only approval makes every send fail with error 132001 template-not-found |
| Graph version | `v21.0` | `META_GRAPH_VERSION` default |
| Header style | TEXT set + IMAGE `_img` twins | Text approves with zero assets; the `_img` twins carry a per-send hero image (§2.4). Composer picks per push |
| Names | `marketing_new_campaign` · `marketing_new_draw` · `marketing_offer` (+ `_img` twins) | Same terse snake style as `reward_pass`; the `marketing_` prefix makes the category obvious in Manager and in future env defaults |

## 2. The templates (3 copy shapes × text/image headers = 6 names)

The exact submission payloads are in the script (single source of truth). Human-readable view:

### 2.1 `marketing_new_campaign` — a new reward campaign is live

> **New reward: FairPrice $20 Voucher**
>
> Hi Shawn, a new reward just went live on Redeem — a $20 FairPrice voucher for new sign-ups, from FairPrice. Quantities are limited and it's first come, first served.
>
> Tap below to view the reward and claim yours in about a minute.
>
> _MKTR Pte. Ltd. · Reply STOP to unsubscribe_
>
> **[ View reward ]** **[ Stop promotions ]**

| Slot | Content | Variables |
|---|---|---|
| Header (TEXT) | `New reward: {{1}}` | {{1}} campaign/reward title |
| Body | `Hi {{1}}, a new reward just went live on Redeem — {{2}}, from {{3}}. Quantities are limited and it's first come, first served.` ¶ `Tap below to view the reward and claim yours in about a minute.` | {{1}} first name · {{2}} offer one-liner (lowercase, mid-sentence) · {{3}} partner name |
| Footer | `MKTR Pte. Ltd. · Reply STOP to unsubscribe` | — |
| Button 1 (URL) | `View reward` → `https://redeem.sg/{{1}}` | {{1}} path+query suffix |
| Button 2 (quick reply) | `Stop promotions` | — |

### 2.2 `marketing_new_draw` — a lucky draw is open

> **Lucky draw: Tokyo Getaway**
>
> Hi Shawn, the Tokyo Getaway Lucky Draw is open for entries — stand a chance to win a 4D3N trip for two to Tokyo. Entries close 30 Oct 2026, and entering takes about a minute.
>
> Good luck 🍀
>
> _MKTR Pte. Ltd. · Reply STOP to unsubscribe_
>
> **[ Enter the draw ]** **[ Stop promotions ]**

| Slot | Content | Variables |
|---|---|---|
| Header (TEXT) | `Lucky draw: {{1}}` | {{1}} draw short name |
| Body | `Hi {{1}}, the {{2}} is open for entries — stand a chance to win {{3}}. Entries close {{4}}, and entering takes about a minute.` ¶ `Good luck 🍀` | {{1}} first name · {{2}} full draw name · {{3}} prize phrase · {{4}} close date |
| Footer / buttons | as 2.1, CTA label `Enter the draw` | |

### 2.3 `marketing_offer` — generic offer (reusable)

> **A little something for you**
>
> Hi Shawn, here's something we think you'll like: a $10 GrabFood voucher when you sign up this week. Available while stocks last.
>
> Tap below to see the details — it takes less than a minute.
>
> _MKTR Pte. Ltd. · Reply STOP to unsubscribe_
>
> **[ See details ]** **[ Stop promotions ]**

| Slot | Content | Variables |
|---|---|---|
| Header (TEXT, static) | `A little something for you` | — |
| Body | `Hi {{1}}, here's something we think you'll like: {{2}}. {{3}}.` ¶ `Tap below to see the details — it takes less than a minute.` | {{1}} first name · {{2}} offer one-liner · {{3}} availability/urgency line — **no trailing period** (template adds it) |
| Footer / buttons | as 2.1, CTA label `See details` | |

### 2.4 Image-header twins — `marketing_new_campaign_img` / `marketing_new_draw_img` / `marketing_offer_img`

Same body, footer, and buttons as their text twins; the header becomes **format IMAGE**. Three things make this the higher-impact variant with no ongoing cost:

- **The image is a send-time parameter.** Meta reviews only a *sample*; every push can then attach that campaign's own hero (Tokyo art for the Tokyo draw, partner hero for a partner reward) with **no re-approval**. Prod precedent: `reward_pass`/`reward_voucher` already send a per-customer QR card PNG as an IMAGE header through `whatsappService.uploadQrPng`.
- **Sample asset:** `backend/scripts/assets/wa-marketing-sample.png` — 1200×628 (Meta-recommended ~1.91:1), Editorial voucher-card palette/fonts (terracotta + Fraunces), generated with the same satori→resvg pipeline as the QR cards. Reviewers see this; it is also what Manager shows as the template preview.
- **Trade-off vs text twins:** the text headline ("New reward: X") is lost — the hero must carry that job, and the body still names the offer. WhatsApp renders the image above the body; chat-list preview crops to ~1.91:1, so heroes should keep key content centered.

Send-time header parameter (the `wapush` side): `{ type: 'image', image: { link: heroUrl } }` with a **public HTTPS JPEG/PNG ≤5 MB** (campaign heroes under `/uploads/` qualify), or upload-then-`{ id }` exactly like the QR path. WhatsApp does **not** take webp — if a stored hero is webp, `wapush` must transcode or fall back to the text twin.

## 3. Variable → data contract (for `wapush`)

| Variable | Source | Rules |
|---|---|---|
| First name | `prospect.firstName` via `cleanParam(x, 'there')` | cleanParam already strips newlines/URLs and caps at 60 chars — Meta rejects params containing newlines/tabs/4+ spaces |
| Campaign / draw title | campaign public title (design_config v2 heading or admin name) | ≤60 chars through cleanParam; composer should show a preview |
| Partner name | `RewardOffer.partner` tradingName → brandName → legalName, fallback `MKTR` | same fallback chain as `offerContextOf` |
| Prize phrase | draw `prizes[0]` name phrased as "a …" | human-written in the composer, not auto-derived |
| Close date | `toLocaleDateString('en-SG', { day:'numeric', month:'short', year:'numeric' })` | same formatter as the voucher expiry — "30 Oct 2026" |
| CTA suffix | `LeadCapture?campaign_id=<id>&utm_source=wa_push&utm_campaign=broadcast-<id8>` | URL button base is `https://redeem.sg/` + suffix; carries the pushmeasure utm contract; matches `customerLeadCaptureUrl` shape |
| Header image (`_img` twins only) | campaign hero → `{ image: { link: <public https url> } }`, or media-upload `{ id }` like `uploadQrPng` | JPEG/PNG ≤5 MB, never webp (transcode or fall back to the text twin); aim ~1.91:1 with key content centered |

## 4. Compliance rails baked into the copy

- **Category MARKETING**, submitted with `allow_category_change: true` so Meta recategorizes instead of rejecting on a category dispute.
- **Opt-out, twice:** footer text `Reply STOP to unsubscribe` **and** a `Stop promotions` quick-reply button (Meta's recommended marketing pattern — protects quality rating). The `wapush` STOP handler must treat **`STOP`, `UNSUBSCRIBE`, and the literal button text `Stop promotions`** (button taps arrive as a plain inbound message of the button text) as opt-out → write a whatsapp-channel suppression to the consent ledger. The inbound message opens a free 24-h service window, so the confirmation reply costs nothing.
- **Sender identification:** `MKTR Pte. Ltd.` in the footer (Spam Control Act identification requirement; the WABA display name adds the brand).
- **Audience is consent-gated upstream:** recipients only ever come from a cohort, i.e. `canMarketToBatch` / `canMarketTo purpose:'marketing'` (verified campaign-scoped grant + no suppression + 18+ binding), **plus** the DNC send-time scrub the `wapush` prompt makes binding (§9.5 safeguard — holds until counsel expressly blesses agree-all as a DNC override). The templates assume nothing about the audience beyond that.
- **Format rules obeyed** (Meta rejects otherwise): body ≤1024 chars, doesn't start/end with a variable, no adjacent variables; header ≤60 chars, ≤1 variable; footer ≤60 chars, no variables; button labels ≤25 chars; every variable ships an example value.

## 5. Submitting — two paths

Creds situation (verified 2026-07-22): `WHATSAPP_TOKEN` exists **only** in Render (`mktr-backend-jo6r` → Environment). No local `.env`, the Render MCP can't read env values, and Render SSH refuses this machine's keys — so submission needs Shawn once, either path, ~3 minutes.

### Path A — script (recommended)

```bash
# Easiest — Render dashboard → mktr-backend-jo6r → Shell tab (env already present):
node scripts/submit-wa-marketing-templates.mjs

# Or locally, with the token copied from that service's Environment tab:
WHATSAPP_TOKEN=… node backend/scripts/submit-wa-marketing-templates.mjs
```

Idempotent (skips names already on the WABA), auto-resolves the WABA id from the token (`WHATSAPP_WABA_ID` overrides), prints a status table, and sanity-checks it landed on the WABA that holds `reward_pass`. Submits all 6 by default: for the `_img` twins it first uploads the committed sample via the Resumable Upload API (app id auto-read from `debug_token`; `WHATSAPP_APP_ID` overrides; `--sample <path>` swaps the image). `--text-only` / `--images-only` narrow the set; `--dry` prints the payloads without network. If the sample upload fails, the text set still submits and the script says exactly what to fix.

> Note for the Shell-tab path: the sample PNG rides inside the Docker image (`COPY scripts/`), so the image variants work there too — but only after the deploy carrying it is live.

### Path B — WhatsApp Manager (manual)

1. business.facebook.com → **WhatsApp Manager** → pick the MKTR portfolio and the **Redeem WABA** (the account whose template list shows `reward_pass` / `reward_voucher` — that's how you know you're on the right one).
2. **Message templates → Create template** → Category **Marketing → Custom**.
3. Name exactly `marketing_new_campaign` (lowercase, underscores). Language **English** — *not* English (US).
4. Header **Text**, paste from §2, **Add variable** where `{{1}}` appears, fill the sample value.
5. Paste body and footer; fill a sample for every body variable (samples are mandatory).
6. Buttons → **Visit website**, label from §2, URL type **Dynamic**, `https://redeem.sg/{{1}}`, sample = a full LeadCapture URL. Then **Custom** quick reply `Stop promotions`.
7. Submit. Repeat for `marketing_new_draw` and `marketing_offer` (§2.3 has a static header — skip the variable).
8. For the `_img` twins: same steps but Header = **Image**, and drag-drop `backend/scripts/assets/wa-marketing-sample.png` as the sample. Everything else (body, samples, footer, buttons) is identical to the text twin.

## 6. Approval: expected wait & tracking

- **Wait:** review is mostly automated — typically **minutes to a few hours**; Meta's stated SLA is **up to 24 h**. Budget one day; it runs in parallel with everything else (that's why this item ships before `wapush`). The `_img` twins' sample image is policy-reviewed too — same window, but an off-policy sample would reject only those three.
- **Outcomes:** `PENDING → APPROVED` or `REJECTED` (reason shown in Manager and on the API as `rejected_reason`). Rejected → edit the same template and resubmit (rejected names are editable immediately; approved ones allow 1 edit/24 h, 10/month, each edit re-enters review). Deleting a name blocks reusing it for 30 days — prefer edit over delete.
- **Tracking:**
  - `WHATSAPP_TOKEN=… node backend/scripts/submit-wa-marketing-templates.mjs --status` — poll table (status, category, quality, rejection reason).
  - WhatsApp Manager → Message templates (status column; Meta also emails business admins on decisions).
  - Optional later: subscribe the app to the `message_template_status_update` webhook field for push notifications — nice-to-have, not needed for three templates.
- **Hard gate downstream:** `wapush` must verify `status === APPROVED` (script `--status` or a boot-time check) before the WhatsApp channel flag flips. A send against a pending/paused template fails receipted, not silently.

## 7. Ops notes for the send channel

- **Pricing:** SG marketing messages are per-message (rate-card, roughly US$0.07–0.08); confirm the current rate in WhatsApp Manager → Insights before the first big push.
- **Per-user marketing caps:** Meta frequency-caps marketing templates per recipient across all businesses — send error **131049** means "cap hit, retry later"; `wapush` should receipt it as a soft skip, never a hard failure.
- **Quality pausing:** poor engagement/blocks can set a template to `PAUSED` (3 h → 6 h → `DISABLED` ladder). The `--status` poll surfaces `quality_score`; cohort curation is the real defence.
- **TTL:** marketing template messages default to a 30-day delivery window; fine for us.
