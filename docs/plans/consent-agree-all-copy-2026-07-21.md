# Agree-all consent copy — draft for legal review (tracker P1 · item "copy")

**Status:** INTERIM-APPROVED 2026-07-21 — **Variant C selected** with three refinements by an in-test stand-in counsel pass (§9); final canonical text in **§9.4**. **IMPLEMENTED same day:** #211 (wording-era registry + `consent_copy_version` intake) + #213 (main funnel) + #214 (marketplace + named-sponsor rule) live on main; #215 (globalev — GLOBAL `campaignId:null` grants + 082 window healing) completes the train. Line-level references in §5 describe the pre-rework code and are historical. A real PDPA practitioner re-reviews §7+§9 before redeem.sg goes live; if wording changes, mint a NEW era (registry entry + version string) — closed eras are never edited.
**Locked direction (21 Jul 2026):** one MANDATORY agreement block on both funnels covering (a) contact + marketing about other Redeem offers (brand-wide), (b) campaign T&Cs, (c) third-party disclosure on sponsored campaigns. Everything required to submit.

---

## 1. What is live today (the strings being replaced)

Both funnels show **three checkboxes**: contact consent (**pre-ticked**, optional), campaign T&Cs (required), third-party disclosure (un-ticked, optional). All contact copy is **campaign-scoped** — the audit's decisive finding: nothing licenses cross-campaign marketing.

**Main funnel — `src/components/campaigns/CampaignSignupForm.jsx`** (serves LeadCapture v1 + the v2 CampaignPageRenderer):

- `:905-907` — *"By the provision of your contact particulars in this form, you consent to be contacted by such means, including by: (a) phone call and text messages at the phone number provided; and (b) email, if your email address has been furnished, for the purposes identified in this form."*
- `:917-936` — *"By participating in this campaign, you hereby agree to the [terms and conditions]. \*"*
- `:945-947` — *"I consent to my contact details being disclosed to a partner financial advisory representative — who may be from a third-party agency — so that they may contact me about relevant financial products and services."*

**Marketplace — `src/pages/marketplace/MarketplaceFlow.jsx`** (consent step):

- `:813` — *"Contact me about this redemption using the details I've provided. (Pre-ticked — untick if you'd rather we didn't.)"*
- `:816-824` — *"I agree to this campaign's [terms & conditions]. REQUIRED"*
- `:827` — *"Share my contact details with the sponsoring licensed financial-advisory representative for this campaign. (Optional — a separate choice from the two above.)"*
- `:789` — step intro: *"Read once, tick what you agree to. No surprises later."*
- `:847` — footer: *"OTP-verified · consent recorded with submission · data used only as stated on the offer"*

**Backend evidence constants:**

- `backend/src/services/contactConsent.js:23` — `CONTACT_CONSENT_VERSION = '2026-07-20'`
- `contactConsent.js:30-31` — `CONTACT_CONSENT_COPY` (a **paraphrase**, not the on-screen text — the "copyhash" flaw)
- `contactConsent.js:37` — channels `['phone','text','email']` (no `whatsapp`)
- `backend/src/services/externalConsent.js:74` — `THIRD_PARTY_CONSENT_VERSION = '2026-06-26'`

**Prod baseline (audit 2026-07-20):** third-party opt-in 65/137 ≈ 47% when optional; contact consent ~100% (pre-ticked); 2 recorded unticks.

---

## 2. Design constraints baked into every variant

1. **One affirmative act.** A single un-ticked, required checkbox ("I agree to all of the above.") under short clauses. No pre-ticking anywhere — the tick becomes an explicit act, which is *stronger* evidence than today's pre-ticked box.
2. **Named controller + brand.** "MKTR Pte. Ltd. (the company behind Redeem)" — MKTR stays the legal controller on both hosts (matches PersonalDataPolicy D3 note).
3. **Channels spelled out**: phone call, text message (SMS or WhatsApp), email. Today's copy omits WhatsApp while WhatsApp delivery is live and marketing pushes are planned — close that gap now.
4. **Brand-wide scope in concrete words**: "other Redeem offers, rewards and lucky draws" — specific purposes (PDPA s20), not "marketing communications".
5. **Withdrawal stated in-line** (s16): unsubscribe link in every marketing email + contact via the Personal Data Policy. No "reply STOP" promise — no STOP handler exists yet.
6. **Sponsored clause (c) appears ONLY on sponsored campaigns** (`design_config.sponsor` present). Non-sponsored campaigns show a 2-clause block. The named-sponsor small-print line (MarketplaceFlow `:829-831`) stays adjacent — the clause stays generic so copy is hashable; the name rides next to it.
7. **Byte-identical copy on both funnels** — two canonical strings total (base, sponsored), each hashed; frontend renders from the same constants the backend hashes (twin-file + drift test, per the designConfigV2 precedent). Canonical string = the visible text, no markup.
8. **DNC gate untouched.** The DNC-override consent (registry-listed numbers) is a separate statutory act and stays its own campaign-scoped gate on both funnels.

---

## 3. Copy variants

Clause (c) text is identical across variants; only its surrounding register changes. `[terms & conditions]` marks the tappable words (opens the existing MarketingConsentDialog). `*` = the existing required marker.

### Variant A — "Here's the deal" (value-exchange, plainest) — REJECTED (§9.3)

> **Here's the deal**
>
> This offer is free because partners fund it. Submitting means you agree to everything below — all of it, plainly stated:
>
> • **Redeem can contact you — about this offer and new ones.** MKTR Pte. Ltd. (the company behind Redeem) may contact you by phone call, text message (SMS or WhatsApp) or email about this redemption, and to let you know about other Redeem offers, rewards and lucky draws. Opt out anytime — every marketing email has an unsubscribe link, or contact us via our Personal Data Policy.
>
> • **The campaign's terms apply.** You agree to this campaign's [terms & conditions].
>
> • *(sponsored campaigns only)* **The sponsor receives your details.** This campaign is sponsored: your name, contact details and answers in this form will be shared with the sponsoring licensed financial advisory representative, who may contact you about your reward and relevant financial products and services.
>
> ☐ **I agree to all of the above.** \*

Blocked-submit helper: *"You'll need to agree to the above to submit."*

**Rationale.** Leads with the honest quid-pro-quo — "free because partners fund it" — which is precisely the argument that the consent demanded is *reasonable to provide the product* (PDPA s14(2)(a)). Nothing is buried; a regulator reading it sees the deal stated before the ask. Tone is native to redeem.sg. **Risk:** "Here's the deal" reads breezy on formal campaigns (e.g. NTUC-style, mktr.sg-hosted); legal may prefer a soberer register.

### Variant B — formal enumerated consent (legal register) — REJECTED as primary (§9.3)

> **Consent & agreement**
>
> By ticking the box below and submitting this form, you: (a) consent to MKTR Pte. Ltd. (operator of Redeem) contacting you by phone call, text message (SMS or WhatsApp) at the number provided, and by email where furnished, in relation to this campaign and to inform you of other Redeem offers, rewards and lucky draws; (b) agree to this campaign's [terms & conditions]; and (c) consent to your name, contact particulars and responses in this form being disclosed to the licensed financial advisory representative sponsoring this campaign, who may contact you regarding your reward and relevant financial products and services. You may withdraw consent at any time via the unsubscribe link in any marketing email or by contacting us; withdrawal does not affect a redemption already in progress.
>
> ☐ **I have read and agree to the above.** \*

Non-sponsored campaigns omit limb (c); (a)/(b) renumber.

**Rationale.** A single instrument with lettered limbs — the shape lawyers mark up fastest, and closest to the existing main-funnel register, so the diff for legal is minimal. **Risk:** worst readability (a mobile wall of text); arguably weakens the "informed" quality of the consent and cuts against PDPC plain-language guidance. People will tick without reading.

### Variant C — headline bullets (hybrid) ★ SELECTED (interim review — refined final text in §9.4)

> **One agreement — read once**
>
> By submitting this form, you agree to the following. It's short, and it's everything:
>
> • **Contact from Redeem — this offer and future ones.** MKTR Pte. Ltd. (the company behind Redeem) may contact you by phone call, text message (SMS or WhatsApp) or email about this redemption and about other Redeem offers, rewards and lucky draws. You can opt out anytime — every marketing email includes an unsubscribe link, or contact us via our Personal Data Policy.
>
> • **This campaign's terms.** You agree to the campaign's [terms & conditions].
>
> • *(sponsored campaigns only)* **Sharing with this campaign's sponsor.** This campaign is sponsored: your name, contact details and form responses will be shared with the sponsoring licensed financial advisory representative, who may contact you about your reward and relevant financial products and services.
>
> ☐ **I agree to all of the above.** \*

Blocked-submit helper: *"You'll need to agree to the above to submit."*
Marketplace step intro replacement: *"One agreement covers everything below. No surprises later."*
Marketplace footer replacement: *"OTP-verified · consent recorded with submission · opt out anytime"*

**Rationale.** Bold headlines deliver the three facts even to a skimmer (headline-only reading still informs — the layered-notice pattern regulators consistently endorse); body lines carry the exact legal substance of Variant B. Register is neutral enough for both hosts and every campaign type. Best conversion-to-defensibility ratio of the three.

---

## 4. New consent version string

```
CONSENT_COPY_VERSION = '2026-07-21-agree-all-v1'
```

- **Anchored to the locked-decision date.** If legal edits the wording before ship, restamp the date to the approval date and keep `-agree-all-v1`; later rewording under the same regime bumps to `-v2`.
- **One shared value** replaces both `CONTACT_CONSENT_VERSION` (`'2026-07-20'`) and `THIRD_PARTY_CONSENT_VERSION` (`'2026-06-26'`) — the block is one act, so `contact` and `third_party` ledger events carry the same version. The `agree-all` token makes regime membership queryable in the ledger without date arithmetic.
- **Two copy hashes under one version:** `AGREE_ALL_COPY_BASE` and `AGREE_ALL_COPY_SPONSORED` (canonical visible text, newline-joined, links flattened to their words). Event metadata records `{ copyHash, variant: 'base' | 'sponsored' }`.
- `campaign_terms` events keep their `'campaign-tnc'` version (identifies per-campaign content, not this block's wording).
- **Boundary:** the version string is evidence labelling only. The *legal basis* for cross-campaign marketing comes from writing `campaignId:null` grant events at capture — tracker item "globalev", per the audit's rule: never reinterpret old events.

---

## 5. Exact replacement mapping (file:line, verified 2026-07-21)

### Funnel copy — replaced by the approved variant

| # | Site | Today | Becomes |
|---|---|---|---|
| 1 | `src/components/campaigns/CampaignSignupForm.jsx:905-907` | campaign-scoped contact copy | clause 1 (contact + brand-wide marketing) |
| 2 | `CampaignSignupForm.jsx:917-936` | "By participating… [terms and conditions]. \*" | clause 2 (link → same MarketingConsentDialog) |
| 3 | `CampaignSignupForm.jsx:945-947` | optional third-party copy | clause 3, rendered **only when sponsored** |
| 4 | `CampaignSignupForm.jsx:897-949` (block) | three `ConsentCheckbox`es | one agreement block + single required checkbox |
| 5 | `CampaignSignupForm.jsx:284` | "Please agree to the terms and conditions to continue." | "You'll need to agree to the above to submit." |
| 6 | `MarketplaceFlow.jsx:813` | pre-ticked contact line + "(Pre-ticked…)" | clause 1 |
| 7 | `MarketplaceFlow.jsx:815-825` | terms line + REQUIRED chip | clause 2 |
| 8 | `MarketplaceFlow.jsx:826-828` | optional third-party line + "(Optional…)" | clause 3, sponsored-only |
| 9 | `MarketplaceFlow.jsx:789` | "Read once, tick what you agree to. No surprises later." | "One agreement covers everything below. No surprises later." |
| 10 | `MarketplaceFlow.jsx:451` | "Campaign terms consent is required." | "You'll need to agree to the above to submit." |
| 11 | `MarketplaceFlow.jsx:847` | "…data used only as stated on the offer" | "…opt out anytime" (old promise is false under brand-wide scope) |

Kept: `MarketplaceFlow.jsx:829-831` sponsor named-disclosure small print (adjacent transparency for clause 3); the DNC gate on both funnels; activation-ack; draw CTA.

### State / gating semantics (implemented in "funnelui" / "mktui", listed for completeness)

| # | Site | Change |
|---|---|---|
| 12 | `CampaignSignupForm.jsx:94-96` | three consent states → one `consentAll` (default **false**) |
| 13 | `CampaignSignupForm.jsx:87-96` | comment block rewritten (model description) |
| 14 | `CampaignSignupForm.jsx:434` | `!consentTerms` → `!consentAll` in `submitDisabled` |
| 15 | `CampaignSignupForm.jsx:312-314` | payload derived: `consent_contact: true`, `consent_terms: true`, `consent_third_party: isSponsored` — **wire contract preserved**, zero backend/CAPI/mktr-leads breakage |
| 16 | `CampaignSignupForm.jsx:990-993` | T&C dialog "Agree" must no longer tick the block (it covers more than the T&Cs) — make the dialog read-only/close |
| 17 | `MarketplaceFlow.jsx:105` | `{contact:true, terms:false, third:false}` → single `agree:false` |
| 18 | `MarketplaceFlow.jsx:320,342-344,448` | guard/payload/submitReady on the single flag, same derivation as #15 |

Sponsorship predicate: one shared helper (e.g. `isSponsoredCampaign(design_config)`) over `design_config.sponsor` (v2 object; v1 mirror via the designConfigV2 mapping) — both funnels and the payload derivation use it. Exact predicate (e.g. `sponsor.disclosed !== false`) is a funnelui implementation decision.

### Backend evidence constants

| # | Site | Change |
|---|---|---|
| 19 | `backend/src/services/contactConsent.js:23` | version → `'2026-07-21-agree-all-v1'` |
| 20 | `contactConsent.js:30-31` | paraphrase → canonical BASE text verbatim + new SPONSORED constant + both hashes (**resolves tracker "copyhash"**) |
| 21 | `contactConsent.js:37` | channels → `['phone','text','whatsapp','email']` |
| 22 | `contactConsent.js:3-16` | header comment: campaign-scoped statement → agree-all regime description |
| 23 | `backend/src/services/externalConsent.js:74` | version → same `'2026-07-21-agree-all-v1'` |
| 24 | `externalConsent.js:69-73` | comment: wording now lives in the shared agree-all block |
| 25 | `backend/src/services/consentService.js:19-23` | "There is NO global variant" header — rewritten **only when "globalev" lands** (not this item) |
| 26 | `backend/src/services/dncConsent.js:16` | comment nit: references the pre-ticked model |

### Policy page — MUST ship in the same release (promises become false otherwise)

| # | Site | Change |
|---|---|---|
| 27 | `src/pages/PersonalDataPolicy.jsx:68` | "…unless you have unticked the marketing-consent checkbox… ticked by default…" → describe the mandatory agreement + hashed-PII consequence |
| 28 | `PersonalDataPolicy.jsx:71` | "How to opt out: Untick the marketing-consent checkbox… **You can still submit the form.**" → post-submission opt-out (unsubscribe link / contact us); keep the Meta off-facebook + browser bullets |

### Display-only / dead code

- `src/pages/adminv2/AdminV2Prospects.jsx:187` — "marketing yes/no" chip keeps working (always yes for new signups); cosmetic follow-up only.
- `src/components/campaigns/signup/ConsentSection.jsx` — **zero imports anywhere**; legacy dead code, delete opportunistically.

### Tests touched at implementation time

- `src/components/campaigns/__tests__/CampaignSignupForm.test.jsx:106,257` — ticks `consent_terms` to submit → tick the agree-all box.
- `src/pages/marketplace/__tests__/marketplaceFlow.test.js` — consent-step interactions.
- `backend/test/unit/consentLedgerUnit.test.js`, `backend/test/integration/consentLedger.test.js`, `backend/test/externalConsent.test.js`, `backend/test/unit/externalConsent.test.js` — version/copy assertions.
- **NEW** twin drift test: frontend consent-copy module ↔ backend constants byte-equal (designConfigV2-twin pattern).

### Explicitly unchanged

`backend/src/middleware/validation.js:229-237` Joi booleans stay **optional** — Retell / Meta-Lead-Ads captures never send them; absence remains fail-closed (no grant written). Server-side "required" enforcement is unnecessary and would break non-form sources.

---

## 6. Consequences to sign off (business, not legal)

1. **Sponsored campaigns:** third-party opt-in is 47% today when optional → becomes agree-or-abandon. Expect a conversion hit on sponsored campaigns; that is the locked trade.
2. **Non-sponsored campaigns stop capturing third-party consent entirely** (the box disappears for them). External/mktr-leads delivery basis will exist **only for sponsored-campaign leads** going forward. Matches the sponsor-funded model — but it is a real narrowing vs today's always-shown optional box.
3. **Contact consent goes from pre-ticked (~100%, passive) to an affirmative tick** — stronger evidence, same effective rate (mandatory), no more `granted:false` unticks from these funnels (abandonment leaves no event).

## 7. Questions for the legal reviewer (feeds tracker item "legal")

> Interim answers in §9.2 — re-put every one of these to real counsel before go-live.

1. **s14(2)(a) reasonableness** of conditioning a free reward on brand-wide marketing consent — is the value-exchange framing (esp. Variant A/C preamble) sufficient?
2. **Mandatory sponsor disclosure** on sponsored campaigns — reasonableness for low-value rewards; and must the sponsor be **named inside the consent sentence**, or does the adjacent named-disclosure line suffice (our design)?
3. **Purpose specificity** — is "other Redeem offers, rewards and lucky draws" specific enough under s20, or should categories be enumerated further?
4. **DNC interplay** — the agree-all block is evidenced written consent for marketing calls/texts. Does it constitute "clear and unambiguous" consent surviving DNC registration brand-wide, or must the separate campaign-scoped DNC-override gate remain the only basis for DNC-listed numbers? (We conservatively keep the gate.)
5. **Withdrawal mechanics** — unsubscribe link + "contact us" (no SMS/WhatsApp STOP handler yet): sufficient for s16?
6. **Minors** — campaigns collect DOB with per-campaign age gates; is a floor age needed for the marketing consent itself?

## 8. Ship-sequencing note

Copy, version bump, funnel UI, `campaignId:null` global events and the copy-hash fix must land as **one release train** (single PR or stacked PRs merged together): a version bump without the new copy — or new copy hashed under the old version — corrupts the evidence chain the ledger exists to provide. Legal approval gates the train; the approved text gets restamped with the approval date before merge.

---

## 9. Interim legal review (test environment — Claude as stand-in counsel, 2026-07-21)

> **Scope & standing:** PDPA Parts 4–6 (consent, purpose, notification), s16 withdrawal, Part 9 DNC, Spam Control Act touchpoints. This is a rigorous stand-in pass so the build can proceed in test — it is not legal advice. A qualified Singapore practitioner re-reviews §7 + this section before redeem.sg goes live; tracker item "legal" stays open until then.

### 9.1 Findings by issue

**(1) Mandatory consent as the price of a free reward — s14(2)(a) reasonableness: DEFENSIBLE.**
The provision bars demanding consent "beyond what is reasonable to provide the product". The product here is a free, marketing-funded reward: the marketing permission is not padding bolted onto a sale — it *is* the commercial basis on which the product exists. This is the free-gift / lucky-draw exchange PDPC's Key Concepts guidelines treat as legitimate, because the consumer faces no necessity: declining costs only the freebie; no essential or paid service is withheld. Conditions that keep it defensible — all present in the selected copy: the exchange is stated *before* the ask; scope is limited to Redeem's own offers; opt-out is easy and does not claw back granted rewards.

**(2) Mandatory sponsor disclosure on sponsored campaigns: AGGRESSIVE BUT ARGUABLE — the conditional design is what saves it.**
Disclosure to a financial adviser for the adviser's own marketing goes beyond Redeem's brand marketing, making this the hardest s14(2)(a) ask. The argument: the sponsor funds that specific reward; the lead is the consideration; without disclosure the campaign has no economic basis — so disclosure *is* reasonably required to provide that product. What makes it defensible is that it is demanded **only where a sponsor actually exists** — demanding it on every campaign would likely fail reasonableness. Strengtheners adopted: the sponsor is named adjacent to the clause and the named line becomes **mandatory** on sponsored campaigns (§9.5-1); the recipient's permitted purposes are bounded ("about your reward and relevant financial products and services"). This remains the #1 question for real counsel.

**(3) Purpose specificity — s20: PASS.** "Other Redeem offers, rewards and lucky draws" is a concrete category of own-brand direct marketing, not an open-ended "for marketing purposes".

**(4) DNC (Part 9) — the sleeper issue: SAFE ONLY WITH AN OPERATIONAL SAFEGUARD.**
For numbers on the DNC registry, marketing calls/texts require clear-and-unambiguous evidenced consent — and the Act *separately* invalidates, for DNC purposes, consent demanded as an unreasonable condition of supply (the s46 mirror of s14(2)(a)). Messages addressed to a Singapore number over apps like WhatsApp are in scope. So even if the Part-4 analysis passes, relying on the agree-all tick to override a DNC listing is the single most exposed reading of this consent.
**Safeguard adopted (binding on Phase 3):** until real counsel expressly blesses agree-all as a DNC override, every cohort push by voice/SMS/WhatsApp is scrubbed against the DNC registry at **send time** (the PDPC transport is already built, pending onboarding), and the capture-time DNC gate stays separate and campaign-scoped. Email pushes are outside DNC (Spam Control Act instead — unsubscribe facility already live). With the scrub in place, the s46 question is academic in the interim.

**(5) Withdrawal — s16: PASS with one copy addition.** Mechanisms (unsubscribe link in every marketing email + the contact point in the Personal Data Policy) are reasonable. Added to clause 1: *"Opting out later won't affect a reward you've already claimed"* — the consequence-of-withdrawal statement, which also kills any "agree or lose your voucher" dark-pattern reading. WhatsApp marketing templates must carry opt-out language when they ship (Meta requires it anyway).

**(6) Accuracy / no false or misleading practices — s14(2)(b): DECISIVE AGAINST VARIANT A.** A's preamble "This offer is free because partners fund it" is **false on self-funded (non-sponsored) campaigns** — an accuracy defect baked into the consent moment itself. C's preamble makes no funding claim and is accurate on every campaign type.

**(7) Minors: ops guardrail, not copy.** PDPC treats individuals 13+ as generally able to self-consent; these funnels target adults and campaigns carry age gates. Guardrail for the cohort builder (Phase 3): default **18+ filter** on marketing cohorts and sponsor handoffs.

### 9.2 Interim answers to the §7 questions

1. **Reasonableness** — yes, defensible with the value exchange stated upfront (9.1-1).
2. **Sponsor naming** — adjacent named line suffices, and it becomes mandatory on sponsored campaigns (9.1-2).
3. **Purpose specificity** — sufficient (9.1-3).
4. **DNC** — do **not** rely on agree-all as a DNC override yet; send-time scrub safeguard adopted (9.1-4).
5. **Withdrawal** — sufficient; consequence line added (9.1-5).
6. **Minors** — 18+ cohort/handoff filter as the ops default (9.1-7).

### 9.3 Variant verdicts

- **A — rejected.** Accuracy defect on non-sponsored campaigns (9.1-6); casual register weakens the evidentiary tone on formal campaigns.
- **B — rejected as primary.** Substantively complete but a mobile wall of text: the weakest "was the person actually informed" evidence, against PDPC plain-language guidance. Its withdrawal-consequence clause was ported into C.
- **C — SELECTED**, with three refinements: (i) withdrawal-consequence line added to clause 1; (ii) "(named on this page)" added to the sponsor clause, with the named-sponsor line mandatory on sponsored campaigns; (iii) "about this redemption" → "about your signup and reward" so lucky-draw entries read correctly.

### 9.4 FINAL approved-for-test copy (canonical — version `2026-07-21-agree-all-v1`)

The canonical constants and hashes derive from these strings (visible text; `[terms & conditions]` = the tappable words).

**Base (non-sponsored campaigns):**

> **One agreement — read once**
>
> By submitting this form, you agree to the following. It's short, and it's everything:
>
> • **Contact from Redeem — this offer and future ones.** MKTR Pte. Ltd. (the company behind Redeem) may contact you by phone call, text message (SMS or WhatsApp) or email about your signup and reward, and about other Redeem offers, rewards and lucky draws. You can opt out anytime — every marketing email includes an unsubscribe link, or contact us using the details in our Personal Data Policy. Opting out later won't affect a reward you've already claimed.
>
> • **This campaign's terms.** You agree to the campaign's [terms & conditions].
>
> ☐ **I agree to all of the above.** \*

**Sponsored campaigns add (third bullet, before the checkbox):**

> • **Sharing with this campaign's sponsor.** This campaign is sponsored: your name, contact details and form responses will be shared with the sponsoring licensed financial advisory representative (named on this page), who may contact you about your reward and relevant financial products and services.

Unchanged from §3: the blocked-submit helper ("You'll need to agree to the above to submit."), the marketplace step-intro and footer replacements.

### 9.5 Obligations this review adds to the implementation items

1. **funnelui / mktui:** sponsored campaigns MUST render the sponsor's name — the adjacent disclosure line becomes a requirement, not decoration ("(named on this page)" must always be true). Enforce at design-config level if possible (sponsor object requires a name).
2. **cohortapi / emailpush / wapush (Phase 3):** voice/SMS/WhatsApp pushes scrub against the DNC registry at send time regardless of agree-all consent, until real counsel says otherwise; cohorts default to 18+.
3. **watemplates:** opt-out language in every marketing template.
4. **legal:** stays open — real counsel re-reviews §7 + §9 before go-live; if wording changes, restamp the version date and re-derive the hashes.
5. **Resubscribe rule (ADOPTED 2026-07-22, Shawn's decision — for counsel's confirmation):** a fresh, OTP-verified acceptance of the agree-all block by a previously-UNSUBSCRIBED person LIFTS their unsubscribe (latest-explicit-consent-wins; live as PR #228 + consumer updates). Only the person's own self-service unsubscribe auto-lifts — admin/complaint suppressions and erasure never do; every recorded ambiguity (timestamp ties, missing evidence) resolves toward staying suppressed; the lift itself is ledger-evidenced (`source:'resubscribe'` with a snapshot of the lifted suppression). Counsel question: confirm that a mandatory-to-submit consent block validly supersedes a prior explicit opt-out under the PDPA, or advise an explicit separate re-opt-in checkbox for previously-unsubscribed visitors.
