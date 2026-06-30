# DNC consent gate on the lead-capture form — design

**Status:** DRAFT (for Codex xhigh review, then implementation)
**Date:** 2026-06-30
**Relationship:** This is the **consumer-facing** half of DNC compliance. The backend scrubbing (`docs/plans/dnc-scrubbing.md`, shipped dark in PR #81) is the compliance *backstop*; this captures **documented consent at the point of opt-in** so a DNC-registered prospect can be lawfully contacted — i.e. it produces the evidence that powers the backend's consent override.

---

## 1. What it does

Per-campaign toggle. When ON, the lead-capture form checks the entered phone against the DNC Registry **concurrently with the OTP send**, and:
- **Not on DNC →** the prospect sees **nothing different** (zero UX change).
- **On DNC →** a consent checkbox **slides out** under the phone/OTP field with a disclosure ("Your number is on Singapore's Do Not Call Registry. Tick to consent to being contacted by {advertiser} about this offer."). Until it's ticked, **all other fields are locked and Submit is disabled**. Ticking it unlocks the form. The consent (+ the DNC result) is recorded as evidence on the lead.

Composition with the backend: a consented registered lead carries `consentMetadata.dnc` → the backend block-mode gate **releases** it (consent override) instead of holding it. An un-consented registered lead can't be submitted here, and even if forged, the backend still holds it (defence in depth).

---

## 2. Why the cost/abuse model is the crux

**Every DNC check costs a real prepaid credit** — and (Codex P0, verified) **the public `POST /api/prospects` create path already bills one**: it's public, IP-limited only (10/min), and does **no** OTP verification (OTP is frontend-only; `routes/prospects.js:29`), and `createProspect` already calls the DNC gate. So once `DNC_API_ENABLED=true`, the *create endpoint itself* is the cheapest drain — cheaper than the new check endpoint. **The cost defence therefore cannot live on the new endpoint; it must sit at the backend, below every caller:**

1. **Per-campaign gate (master control).** Both the form-time check AND the backend create-time scrub run **only** when `campaign.design_config.dncCheck === true` — one toggle scopes all DNC spend to opted-in campaigns. *This requires changing the shipped backend, which currently scrubs on the GLOBAL `DNC_ENFORCEMENT` — see §9.*
2. **Budget guard inside `dncService.checkNumbers`** (not the endpoint) — a global hourly credit cap every caller (create, Retell, backfill, form) passes through. Over budget → fail-open, backend block-mode still backstops.
3. **Server-side per-number cache** (hashed, TTL ≤ validity) — repeat checks don't re-bill, and capture reuses it (no double-bill, §5).
4. **SG-only** (`formatDncNumber` null → skip); **IP + per-number rate limits**; **never expose the API to the browser** (private key + proxy backend-only).
5. **No DNC-status oracle:** reveal `registered` to the browser **only after OTP is verified** (proving control of the number) — otherwise the endpoint leaks "is X on DNC?" for any number.

---

## 3. UX flow (CampaignSignupForm.jsx)

The form already has the OTP state machine (`otpState: idle→pending→verified`, `handleSendOtp → POST /verify/send`, `OTPVerification` component). The DNC check rides the OTP-entry latency:

1. User enters phone → taps "Send OTP". `handleSendOtp` fires `/verify/send` **and** (if `dncCheck` on + SG number) fires `POST /api/dnc/check` **concurrently** (fire-and-forget; sets `dncState: 'checking'`).
2. While the user types the 6-digit code (~seconds), the check returns. New state: `dncState ∈ {idle, checking, clear, registered, error}` + `dncConsent: boolean`.
3. `registered` → render `<DncConsentSlideout>` (mirrors the existing `ConsentSection`; animated reveal) under the OTP block; set `formLocked = true`.
4. `formLocked` → every `FieldRenderer` field gets `disabled`, Submit `disabled`. Ticking the consent box (default **unticked**) sets `dncConsent=true` → `formLocked=false`.
5. `clear` / `error` / non-SG → no slideout, form behaves exactly as today (**fail-open**: an errored check must never block a non-registered user; the backend is the net).
6. **Number changed after a check →** reset `dncState=idle`, `dncConsent=false`; a new OTP send re-checks the new number (the consent is bound to the checked number).
7. On submit: include `consent_dnc` + the opaque check token (§5) so the backend ties consent to the server-known result.
8. **Preview/demo (`/p/:slug`)** stubs all network — DNC check simulated locally (configurable "pretend registered" so admins can preview the slideout), never bills.

---

## 4. Campaign designer toggle (ContentPanel.jsx)

Mirror the `sgPrOnly` toggle (`ContentPanel.jsx:435`): a `FieldToggle` "Check Do Not Call (DNC) at submit" with helper text, bound to `currentDesign.dncCheck` via `onDesignChange('dncCheck', checked)`. Stored in `campaign.design_config.dncCheck` (boolean, default false). Optional: an editable disclosure-copy field (else a sensible default + the advertiser name). `campaignService.updateCampaign` already persists `design_config`; add `dncCheck` to any clamp/allowlist.

---

## 5. Backend endpoint + no-double-bill + consent → override

**`POST /api/dnc/check`** (new; public, like `/verify/send`):
- Body: `{ phone, campaignId, otpRef }`. 
- Gates: campaign `dncCheck` on → valid live OTP session for `phone` → SG number → rate/budget OK.
- Reuses `dncService.checkNumbers([number])` through the egress proxy.
- Caches the result server-side by `hashPhone(number)` (TTL ≤ validity) and returns a **minimal** body: `{ registered: boolean, token }` — `token` is an opaque, signed, short-TTL handle to the cached result (the browser never sees channels/transactionId).
- Returns `{ registered:false }` fail-open on error/over-budget.

**No double-bill / authoritative result:** on prospect creation, `createProspect` resolves the form `token` (or re-looks-up the number cache) → reuses the **server-known** DNC result (no second API call, no second credit) → writes it to the `dnc*` columns. So the form-time credit IS the capture credit. The client-sent `consent_dnc` is recorded, but the *registered* fact comes from the server cache (client can't forge "not registered").

**Consent → backend override:** `createProspect` writes `consentMetadata.dnc = { consented, consentedAt, disclosureVersion, dncTransactionId, sourceUrl }`. The born-held-pending gate then: registered **+ consented** → release (override); registered **+ not consented** → hold `dnc_registered` as today. This is the evidence-backed path the backend's `DNC_CONSENT_OVERRIDES` referenced — so that env flag's "must be evidence-backed" condition is now satisfiable.

---

## 6. Trust, fail-safe, edge cases

- **Server-authoritative registered fact** (browser gets only a boolean + opaque token) → a tampered client can't claim "clear" to skip the gate (backend re-derives from cache; absent cache → backend checks at capture, still gates).
- **Fail-open at the form, fail-safe at the backend.** Form-time errors never block; the backend born-held-pending gate is the compliance backstop.
- **Consent default OFF** (PDPA active opt-in); unticking re-locks.
- **i18n / a11y:** the disclosure is regulatory copy — needs the brand's regulatory styling, screen-reader association (`aria-describedby`), and focus moved to the consent box on reveal.
- **Composition with `sgPrOnly`:** both can be on; DNC slideout is independent of the SG/PR screening card.

---

## 7. Testing

- Frontend (`CampaignSignupForm.test.jsx`): not-registered → no UI change; registered → slideout + locked fields + disabled submit; tick → unlocks; number change → resets; error → fail-open; preview → stub, no network.
- Backend: `/api/dnc/check` gating (campaign off / no OTP session / non-SG / over-budget → no spend), cache reuse (no double-bill), token round-trip, consent → override in `createProspect`.
- Designer: toggle persists `design_config.dncCheck`.

## 8. Open decisions

1. **OTP-session gate mechanism** — reuse the existing OTP store to prove a live session, or a dedicated short-lived nonce returned by `/verify/send`?
2. **Budget cap** value + behavior on exceed (fail-open vs queue).
3. **Disclosure copy** — fixed default vs per-campaign editable; advertiser name source.
4. **Cache store** — in-memory (single-instance, simplest) vs Redis (already used elsewhere?).
5. **Token vs re-lookup** at capture — signed token in the submit, or backend re-reads the number cache by phone?
6. Whether to **also** surface the per-channel flags to the agent app (needs the lyfe-app receiver change already deferred in the backend plan §10).

---

## 9. Codex xhigh review (2026-06-30) — verified against code, folded in

**P0 (reshaped the design):**
- **The public create path is the real credit-drain — not the new endpoint.** `POST /api/prospects` is public + IP-limited only + does NO server-side OTP check (`routes/prospects.js:29`; verified zero OTP/verification in the create controller/service), and `createProspect` already calls the DNC gate. So the cost defence moved to the backend (§2): per-campaign gate + a budget guard inside `checkNumbers`. **⚠️ Action item for the SHIPPED backend (PR #81), before `DNC_API_ENABLED=true`: (a) gate create-time DNC on `campaign.design_config.dncCheck` — it currently scrubs on the global `DNC_ENFORCEMENT` — and (b) add the budget guard in `checkNumbers`. Otherwise the live create endpoint drains credits.**
- **OTP store can't prove a live session + oracle risk.** `Verification` is keyed by phone only, `/verify/send` returns no ref + is IP-limited, verify destroys the row (`verificationService.js:171,227`). 'Send-only' proves nothing, and returning `registered` pre-verify leaks DNC status → reveal the result **only after OTP verify**; treat the form check as best-effort UX, the backend as authoritative.
- **Consent override isn't implemented.** `dncGate.js:150-157` always holds registered-on-voice → add a **server-built** DNC-consent evidence validator that releases `registered + consented`. **Do NOT reuse `consent_contact`** — it defaults `true` in the form (`CampaignSignupForm.jsx:74`), so it would auto-override everyone. Follow the `consentThirdParty` / `externalConsent.js:97` pattern (separate, default-OFF, server-built evidence).

**P1 (folded in):**
- No-double-bill needs a real injection point: `gateHeldDncLead` hard-calls `checkAndRecord` (`dncGate.js:144`); add a gate variant that accepts a pre-known result. AND fix `checkAndRecord`'s cache-hit return — it omits channel flags (`dncService.js:297`), so a reused `registered` result has `noVoiceCall===undefined` → `dncGate.js:152` would mis-treat it as deliverable.
- `consent_dnc` + any token are stripped by the route + schema + `createProspect`'s drop of client `consentMetadata` (correct defensively) → DNC evidence must be **server-built**; the client sends only the intent boolean.
- Submit can fire before DNC returns (OTP auto-verifies on the 6th digit, `OTPVerification.jsx:49`; DNC ~5s) → **disable submit while `dncState==='checking'`** for DNC campaigns.
- Toggle persistence: add `dncCheck` to `DesignEditor.jsx`'s explicit `currentDesign` init + save (it whitelists keys, `:58`), not just `ContentPanel`.

**P2 (folded in):** `FieldRenderer` needs a `disabled` prop (only phone is OTP-locked today, `:209`); mirror the inline `ConsentCheckbox` (`CampaignSignupForm.jsx:926`), not `ConsentSection` (just a terms link); a11y (focus the revealed checkbox, `aria-describedby`, announce the disclosure); add a preview 'pretend registered' state.
