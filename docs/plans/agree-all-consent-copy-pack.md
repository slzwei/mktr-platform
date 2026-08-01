> **SUPERSEDED (2026-07-21):** two copy packs were drafted in parallel sessions; the canonical one — reviewed in-test (§9) and SHIPPED as era `2026-07-21-agree-all-v1` (PRs #211/#213/#214) — is `consent-agree-all-copy-2026-07-21.md`. This file is kept for history only.
# Agree-All Consent Copy Pack — mandatory brand-wide consent, both funnels

**Tracker:** data-powerhouse Phase 1, item `copy` (feeds `legal` → `funnelui` → `mktui` → `globalev` → `copyhash`)
**Status:** DRAFT for legal review — no code changes made. Copy + plan only.
**Date:** 2026-07-21
**Locked decisions this implements (2026-07-21):** the reward is the deal — one mandatory agreement block covering (a) contact + marketing about other Redeem offers (brand-wide), (b) campaign T&Cs, (c) third-party disclosure on sponsored campaigns. No agree, no submit. DNC gate flow unchanged.

---

## 1. What changes, in one paragraph

Today both funnels present three checkboxes with mixed semantics: contact consent (pre-ticked opt-out, campaign-scoped), campaign T&Cs (required opt-in), third-party disclosure (optional opt-in). The new contract replaces all three with **one mandatory agreement block**: a visitor who does not agree cannot submit, and the agreement is **brand-wide** (Redeem may market other offers to them — the legal basis `canMarketTo` needs for cross-campaign pushes). Sponsored campaigns additionally fold the third-party disclosure into the same mandatory block. Both funnels must render **byte-identical canonical copy** so the stored copy hash pins the real on-screen text (fixes the `copyhash` evidence flaw at the same time).

## 2. The two campaign classes

The block has exactly two canonical variants — the version string covers both; each gets its own copy hash:

- **Standard** (no sponsor disclosure configured): bullets a, b, c.
- **Sponsored** (campaign has a sponsoring FA representative): bullets a, b, **disclosure**, c.

"Sponsored" should key off an explicit campaign flag (e.g. `design_config.sponsored === true` / presence of sponsor config), never inferred silently — legal will want the disclosure shown exactly when a third-party recipient actually exists.

---

## 3. Copy variants

Conventions used below:
- **[hashed]** = part of the canonical consent copy — stored verbatim backend-side, hashed, byte-identical on both funnels.
- **[chrome]** = surrounding UI copy — should also match across funnels but is not part of the evidence hash.
- The words "terms and conditions" render as the T&Cs dialog link on both surfaces without altering the text bytes.
- Channel list is spelled out once: **"phone call, text message (including WhatsApp) or email"** — matches the planned WhatsApp marketing channel and keeps the channels array honest (see §5).

### Variant A — single tick over an itemized "here's the deal" panel  ★ RECOMMENDED

One framed panel states the full exchange; one required checkbox affirms it. Friction is identical to today (today also requires exactly one tick — T&Cs); scope is upgraded.

**[chrome] Panel title:** `Here's the deal`
**[chrome] Sub-line:** `This reward is free because you agree to be contactable. Plainly:`

**[hashed] Panel body — Standard:**

> • Redeem and this campaign's provider may contact you about this redemption at the details you've provided.
> • Redeem may send you offers and updates about other Redeem campaigns by phone call, text message (including WhatsApp) or email.
> • You accept this campaign's terms and conditions.
>
> You can opt out of marketing at any time — opting out later doesn't affect this reward.

**[hashed] Panel body — Sponsored** (adds the third bullet):

> • Redeem and this campaign's provider may contact you about this redemption at the details you've provided.
> • Redeem may send you offers and updates about other Redeem campaigns by phone call, text message (including WhatsApp) or email.
> • Your contact details will be shared with the sponsoring licensed financial advisory representative for this campaign, who may contact you about relevant financial products and services.
> • You accept this campaign's terms and conditions.
>
> You can opt out of marketing at any time — opting out later doesn't affect this reward.

**[hashed] Checkbox label (the operative first-person act):** `I agree to all of the above.`

**[chrome] Disabled-submit helper (shown only after an attempted submit without the tick):** `Agreeing above is required to claim this reward.`

**Why this one.** One explicit affirmative act with the purposes itemized right above it — the strongest blend of readability, honesty ("here's the deal" stated plainly, per the locked framing), and evidence quality (panel + tick label hashed together; tick is first-person). It does not increase required-tick count vs today. Itemization answers the classic bundled-consent critique: purposes are separately and clearly stated even though acceptance is joint — and since refusing any one of them means no reward, separate tick-boxes would be ceremony, not choice.

### Variant B — grouped required checkboxes (conservative evidence posture)

Same copy substance, split into per-purpose required ticks under one header. 2 ticks on standard, 3 on sponsored.

**[chrome] Header:** `To claim this reward, all of the below are required:`

**[hashed] Tick 1 — contact & marketing:**
> I agree that Redeem and this campaign's provider may contact me about this redemption, and that Redeem may send me offers and updates about other Redeem campaigns, by phone call, text message (including WhatsApp) or email. I can opt out of marketing at any time — opting out later doesn't affect this reward.

**[hashed] Tick 2 (sponsored only) — disclosure:**
> I agree that my contact details may be disclosed to the sponsoring licensed financial advisory representative for this campaign, who may contact me about relevant financial products and services.

**[hashed] Tick 3 — terms:**
> I agree to this campaign's terms and conditions.

**Why you might pick it.** Purpose-granular ticks are the most conservative evidence posture (a distinct recorded act per purpose) if legal is nervous about joint acceptance. Costs: 2–3 required ticks of friction, and the optics are worse, not better — a column of checkbox-shaped controls that all refuse to stay unticked reads more dark-pattern than one honest panel.

### Variant C — the CTA is the agreement (no checkbox)

Full Variant-A panel copy sits directly above the submit button; the button itself is the act.

**[hashed] Panel body:** identical to Variant A (Standard/Sponsored).
**[hashed] Button label:** `Agree & claim reward`
**[chrome] Under-button note:** `Tapping "Agree & claim reward" records your agreement to the above.`

**Why you might pick it.** Zero added friction; PDPC accepts consent by a clearly-labelled affirmative action. But it is the weakest ceremony (no discrete tick event to record ahead of submit), and it is the variant most likely to draw legal pushback given the marketing + third-party-disclosure scope. Included as the aggressive option.

---

## 4. New consent version string

- **`CONTACT_CONSENT_VERSION`** (backend/src/services/contactConsent.js:23): bump `'2026-07-20'` → **the date legal approval lands** (working placeholder: `'2026-08-01'` — stamp the real date on approval day, per the constant's own "bump to the date the copy changes" rule).
- **`THIRD_PARTY_CONSENT_VERSION`** (backend/src/services/externalConsent.js:74): bump `'2026-06-26'` → **the same date** (the disclosure wording changes and becomes mandatory-on-sponsored).
- The scope jump (campaign-scoped → brand-wide) is carried by the new version + new copy + the `globalev` item's `campaignId:null` ledger events — exactly what the contactConsent.js docblock demands ("a future GLOBAL opt-in must use a NEW version and campaignId:null events").
- Terms events keep their `'campaign-tnc'` version label (consentService.js:89) — campaign T&Cs remain campaign-owned content; the block version pins the *agreement wording*, not each campaign's terms body.

**Copy-hash plan (pre-solves the `copyhash` item):** store TWO canonical constants — `AGREE_ALL_COPY_STANDARD` and `AGREE_ALL_COPY_SPONSORED` (panel body + tick label, byte-identical to render) — each with its own SHA-256. Event metadata records the hash of the variant actually shown. Frontend renders from a twin module (`src/lib/consentCopy.js` ↔ `backend/src/services/contactConsent.js`, same pattern as the designConfigV2 twins) with a drift test that fails if the strings ever diverge.

**Channels constant:** `CONTACT_CONSENT_CHANNELS` (contactConsent.js:37) `['phone','text','email']` → `['phone','text','whatsapp','email']` so the recorded channels match the copy's "(including WhatsApp)". `THIRD_PARTY_CONSENT_CHANNELS` (externalConsent.js:81) already includes whatsapp.

---

## 5. Exact replacement map (file:line → what happens)

### Main funnel — `src/components/campaigns/CampaignSignupForm.jsx` (serves LeadCapture AND the v2 Studio renderer via CampaignPageRenderer.jsx:271)

| Site | Live string / behavior | Replacement |
|---|---|---|
| :905-907 | "By the provision of your contact particulars in this form, you consent to be contacted by such means, including by: (a) phone call and text messages at the phone number provided; and (b) email, if your email address has been furnished, for the purposes identified in this form." (pre-ticked, optional) | Removed — folded into the block's contact + marketing bullets |
| :917-936 | "By participating in this campaign, you hereby agree to the {terms and conditions}. *" (required) | Removed — folded into the block's terms bullet (link preserved) |
| :945-947 | "I consent to my contact details being disclosed to a partner financial advisory representative — who may be from a third-party agency — so that they may contact me about relevant financial products and services." (optional, un-ticked) | Removed — becomes the mandatory sponsored-campaign disclosure bullet |
| :94-96 | `consentContact` defaults **true** (pre-ticked); terms/thirdParty false | One `agreeAll` state, default **false** — nothing pre-ticked |
| :283-286 | Submit validation enforces only `consentTerms` | Enforces the full agreement |
| :428-436 | `submitDisabled` includes only `!consentTerms` | Includes `!agreeAll` |
| :312-314 | Payload `consent_contact` / `consent_terms` / `consent_third_party` | All derived from the single agreement (sponsored campaigns ⇒ `consent_third_party: true`; standard ⇒ third-party not granted). Keep the three flags on the wire for backend compatibility until `globalev` lands |

### Marketplace — `src/pages/marketplace/MarketplaceFlow.jsx` (tracker item `mktui`)

| Site | Live string / behavior | Replacement |
|---|---|---|
| :788-790 | "Read once, tick what you agree to. No surprises later." | Must change — it promises optionality. E.g. [chrome] "One agreement covers this reward — read it once, plainly." |
| :812-814 | "Contact me about this redemption using the details I've provided. (Pre-ticked — untick if you'd rather we didn't.)" | Removed — block bullets |
| :815-825 | "I agree to this campaign's {terms & conditions}. Required" | Removed — block terms bullet (link preserved) |
| :826-828 | "Share my contact details with the sponsoring licensed financial-advisory representative for this campaign. (Optional — a separate choice from the two above.)" | Removed — mandatory sponsored disclosure bullet |
| :105 | `consent` state `{contact: true, terms: false, third: false}` | Single `agreeAll: false` |
| :320, :448-451 | `submitReady` requires only `consent.terms` (+ activation ack + DNC); `missingText` says "Campaign terms consent is required." | Requires the full agreement; helper text becomes the Variant-A helper line |
| :342-345 | Payload flags | Same rule as main funnel |
| :903, :916 | Confirmation copy branches on `consentContact` ("at the number you verified") | Branch becomes vestigial (always consented) — simplify during `mktui` |

### Brand/policy surfaces

| Site | Live string | Replacement |
|---|---|---|
| `src/pages/PersonalDataPolicy.jsx:68` | "…unless you have unticked the marketing-consent checkbox above the submit button… The checkbox is ticked by default; if you untick it before submitting, no contact information is shared." | Rewrite: consent is part of claiming a reward; the opt-out story becomes "don't redeem, or withdraw marketing consent anytime afterwards (unsubscribe)" |
| `src/pages/PersonalDataPolicy.jsx:71` | "How to opt out: • Untick the marketing-consent checkbox before you submit a form… You can still submit the form." | Same rewrite — "You can still submit the form" is no longer true; point to the unsubscribe mechanism (PR B ledger) instead |

### Backend evidence constants

| Site | Change |
|---|---|
| `backend/src/services/contactConsent.js:23` | Version bump (approval date) |
| `backend/src/services/contactConsent.js:30-31` | `CONTACT_CONSENT_COPY` paraphrase → the two canonical AGREE_ALL strings, byte-identical to render (`copyhash` fix) |
| `backend/src/services/contactConsent.js:37` | Channels + whatsapp |
| `backend/src/services/externalConsent.js:74` | Version bump (same date) |
| `backend/src/services/consentService.js:82-83, 89, 96` | Capture events pick up new version/hashes; `globalev` item extends with `campaignId:null` contact+marketing grants |

### Explicitly UNCHANGED

- **DNC gate** — `src/components/campaigns/signup/DncConsentGate.jsx` and the MarketplaceFlow `dnc` step (:755-783). The agree-all block does **not** substitute for DNC clear consent: telemarketing to a DNC-registered number needs its own specific, recorded consent, so the post-OTP gate stays exactly as is on both funnels.
- **MarketingConsentDialog** — renders campaign-provided T&Cs content, not consent copy.
- **OTP flow, eligibility/advisor gates, duplicate handling** — untouched.

---

## 6. PDPA flags for the legal reviewer (headline list — full pack is tracker item `legal`)

1. **s14(2)(a) condition-of-consent reasonableness** — the core question. Position to test: the product IS a marketing-funded reward; contactability is the substance of the exchange (loyalty-programme analogy), stated plainly, with free withdrawal afterwards. The copy deliberately says the deal out loud rather than burying it.
2. **Mandatory third-party disclosure on sponsored campaigns** — the aggressive end (per our own audit). Mitigations built into the copy: appears only where a real sponsor exists, recipient class is named ("sponsoring licensed financial advisory representative"), purpose-limited ("relevant financial products and services"). Legal may prefer this bullet demoted to optional on low-value rewards — that decision changes copy variant selection, not the architecture.
3. **Withdrawal (s16)** — "opt out of marketing at any time — opting out later doesn't affect this reward" is load-bearing: consent stays withdrawable and withdrawal is not penalised retroactively. Unsubscribe mechanics exist (PR B ledger, consentService.js:348).
4. **DNC Act interplay** — brand-wide marketing consent does not override DNC for voice/text to registered numbers; the separate DNC gate (unchanged) is the clear-consent instrument. State this in the review pack so nobody "simplifies" the gate away.
5. **Evidence** — version string + per-variant copy hash + first-person tick + OTP-verified identity at the moment of consent. Ledger events (PR B) record it durably; `globalev` writes the brand-wide grant.

## 7. Sequence after sign-off

1. Legal approves a variant (tracker `legal`) — stamp the real version date.
2. `funnelui` — implement in CampaignSignupForm.jsx (plan-gated per tracker; serves LeadCapture + v2 renderer). Fold in `copyhash` (twin module + drift test).
3. `mktui` — apply the identical block to MarketplaceFlow.jsx (same version, same canonical strings, DNC step untouched), tests + redeem.sg verify.
4. `globalev` — capture writes GLOBAL (`campaignId:null`) contact/marketing grants; `canMarketTo` cross-campaign tests flip green for new signups.
5. PersonalDataPolicy rewrite ships with the funnel PRs (same release, so the policy never contradicts the live form).
