# MKTR.sg Homepage Rewrite Plan — v2

**Status:** ✅ IMPLEMENTED 2026-06-02 (Shawn approved "build now"). Codex-reviewed v2 (NO-GO on v1 → all blockers/should-fixes folded in). Builds pass for both brands; lint clean; unit tests green (1 pre-existing unrelated CampaignForm failure). Backend waitlist endpoint inert until next deploy (migration 033 runs at bootstrap). Open items tracked in §9.
**Scope:** The public **index page** of `mktr.sg` (`src/pages/Homepage.jsx` + components) **plus the shared marketing chrome it can't be cleaned without** (SiteHeader, FooterSection/MarketingLayout, nav brand-gating, sitemap), and the backend capture endpoint for the new CTA.

> **v2 changelog (from Codex):** added the header's desktop+mobile `/AdminDashboard` CTAs and the footer "Dashboard" link to the cut list; made nav **brand-gated** (flipping `show*` alone 404s the nav); flagged `FooterSection` as **shared** across all marketing pages + redeem `/Contact`; pulled **`/Contact` handling into scope**; added "3x", "conversion rates" and generic **"AI-powered"** copy to the cut; **dropped Option B** (Joi-invalid + false-success) in favor of **Option A with persistence-based success**; corrected backend route registration to **auto-discovery via `meta`**; added **sitemap + meta + Pixel event + a11y** work.

---

## 1. Why — full index-page cut list (verified file:line)

**Discontinued / not-launching content to remove:**

| Category | Evidence |
|---|---|
| Commissions | `FeaturesSection.jsx:25-27`, `LeadSourcesSection.jsx:61-63`, `PricingSection.jsx:28-30` |
| Fleet / vehicles / PHV | `FeaturesSection.jsx:6-7`, `FeaturesSection.jsx:30-32`, `PricingSection.jsx:43-44` |
| Retell / AI voice / call bot | `FeaturesSection.jsx:10-12`, `LeadSourcesSection.jsx:38-41`, `PricingSection.jsx:28`, hero headline `HeroSection.jsx:26-34` |

**Fabricated claims to remove:**

| Claim | Evidence |
|---|---|
| "500+/10,000+/3x" proof bar | `LeadSourcesSection.jsx:7-16` |
| "Ready to **3x** Your Pipeline?" | `CTASection.jsx:20-23` *(missed in v1)* |
| "conversion rates" | `FeaturesSection.jsx:20-22` *(missed in v1)* |
| Fake testimonial naming Great Eastern | `TestimonialSection.jsx:20-25` |
| "Join hundreds … already using MKTR" | `CTASection.jsx:24-26` |
| Fake pricing tiers + "No credit card required" | `PricingSection.jsx:3-52`, `CTASection.jsx:50` |
| "property agents" | `FooterSection.jsx:13-16` |

**Anonymous-visitor CTAs that must not point at `/AdminDashboard` or `/LeadCapture`:**

| Where | Evidence |
|---|---|
| Hero "Get Started Free" → /AdminDashboard | `HeroSection.jsx:37-38` |
| Hero "Schedule Demo" → /LeadCapture | `HeroSection.jsx:41-42` |
| **Header desktop CTA → /AdminDashboard** *(missed in v1)* | `SiteHeader.jsx:93-98` |
| **Header mobile CTA → /AdminDashboard** *(missed in v1)* | `SiteHeader.jsx:195-200` |
| **Footer "Dashboard" → /AdminDashboard** *(missed in v1)* | `FooterSection.jsx:21-22` |
| Footer "Lead Capture" → /LeadCapture | `FooterSection.jsx:21` |
| Pricing CTAs → /AdminDashboard | `PricingSection.jsx:84-85` |
| CTA email form → /AdminDashboard | `CTASection.jsx:8-12` |
| AnnouncementModal → /AdminDashboard | `AnnouncementModal.jsx:34-36` |

**Dead links:** `FooterSection.jsx:28-29,35,37`.

**Generic "AI-powered" positioning (DECISION — see §9.1):** hero eyebrow `HeroSection.jsx:21-23`, hero subtitle "with AI" `:31-34`, "Our AI handles…" `LeadSourcesSection.jsx:29-30`, footer "AI-powered" `FooterSection.jsx:13-15`.

---

## 2. Decisions locked with Shawn (2026-06-01)

1. **Positioning:** done-for-you lead service — *"We capture and deliver qualified insurance leads straight to your phone."* Audience = insurance agents in SG. Not internal-tool, not self-serve SaaS, not the buy-leads marketplace.
2. **Primary CTA:** waitlist / register interest (pre-launch). One email field, **genuine** capture. **No pricing.**
3. **Hard exclusions:** PHV/drivers/fleet/vehicles, commissions, Retell/AI-voice, fabricated numbers, testimonials, pricing/billing, "internal tool", "property agents".
4. **AI wording (resolved 2026-06-01):** remove **all** "AI-powered" copy — nothing AI ships until Retell launches. Sell outcomes, not buzzwords.
5. **Contact (resolved):** **hide** `/Contact` from nav/footer; replace with a `mailto:` + WhatsApp link. Defer the Contact-page rewrite.
6. **Launch framing (resolved):** neutral "join the waitlist", **no date**.
7. **Exclusive leads (resolved):** **claimable** — each lead is round-robin-assigned to a single agent, so "exclusive leads, never resold" is true.

---

## 3. The honest core (claimable)

- Capture high-intent insurance prospects across SG (QR at events/roadshows + web/campaign forms).
- Consent-based, PDPA-compliant capture (`brand.defaultRegulatory`).
- Auto-routed to the right agent (round-robin).
- Delivered to the agent's phone in seconds with full context (push + Lyfe app).
- *Optional:* "exclusive leads (never resold)" — **only if true** (§9.4).

No numbers, no testimonials, no voice, no vehicles, no commissions.

---

## 4. New page + chrome structure

Proposed `Homepage.jsx` composition: FloatingElements, SiteHeader, **Hero**, **HowItWorks**, **WhatYouGet**, **Waitlist**, Footer. (Testimonial, Pricing, AnnouncementModal removed from import list **and** JSX `Homepage.jsx:4-14,57-61`.)

### 4.1 SiteHeader (`src/components/layout/SiteHeader.jsx`) — shared chrome
- **Brand-gate the nav.** `SiteHeader.jsx:9-14` hardcodes `/features`, `/pricing`, `/about`. Derive nav items from `brand.show*`, or replace with same-page anchors (`/#how-it-works`, `/#what-you-get`). **Do not leave a `/features` link when `showFeatures:false` — it 404s to `NotFoundForBrand`.**
- **Replace BOTH `/AdminDashboard` CTAs** (desktop `:93-98`, mobile `:195-200`) with a **"Join the waitlist"** action (scrolls to waitlist). Keep a small low-emphasis **"Log In"** for staff (`:84-92` desktop / mobile equivalent).

### 4.2 Hero (`src/components/homepage/HeroSection.jsx`)
- New headline (no voice hook). Drafts: *"Qualified insurance leads, delivered to your phone."* / *"Spend less time prospecting. More time closing."*
- Eyebrow: pre-launch signal (see §9.5 launch framing). **Resolve §9.1** before keeping "AI-Powered Lead Generation".
- Subtitle: *"MKTR captures high-intent prospects across Singapore and routes each one to the right agent — instantly."*
- CTAs: primary "Join the waitlist"; secondary "See how it works" (anchor). Remove the two old CTAs (`:37-42`).
- Remove the stock Pexels video (`:8-16`); use brand gradient/asset (§9.3).

### 4.3 HowItWorks (`src/components/homepage/LeadSourcesSection.jsx`)
- Remove `SocialProofBar` (`:3-20`). Optional non-numeric trust chips only.
- Rewrite 3 steps (`:33-65`): (1) We capture the leads · (2) We route them to you · (3) You close. No call-bot, no commission tracking. Resolve §9.1 for the "Our AI handles…" line (`:29-30`).

### 4.4 WhatYouGet (`src/components/homepage/FeaturesSection.jsx`)
- Remove cards: Commission (`:25-28`), Fleet (`:29-33`), AI Call Bot (`:9-13`).
- Reframe remaining as agent benefits; drop "vehicles" (`:6-7`) and "conversion rates" (`:20-22`). Update icon imports (drop `DollarSign`, `Phone`, etc.).

### 4.5 / 4.6 Testimonial + Pricing — **REMOVE** from page; **delete the files and their barrel exports** (see §4.10). Leaving the files unused still fails the acceptance grep (they contain banned text).

### 4.7 Waitlist (replaces `CTASection.jsx`)
- Email field (optionally name/phone) → **POST `/api/waitlist`** (§5). **Success state is driven by DB insert, not email send.**
- **Accessibility:** real `<label>` (current input is placeholder-only `:31-34`), `aria-live` status, loading/disabled state, keyboard-safe submit.
- **Consent:** short PDPA line linking `/personal-data-policy`.
- **Analytics:** decide a dedicated Pixel event (e.g. `Subscribe`) — do **not** reuse `/LeadCapture`'s `trackLead` conversion semantics (`src/lib/metaPixel.js:24-45`, `LeadCapture.jsx:222-240`).
- Remove the `/AdminDashboard` redirect (`:8-12`) and "No credit card required" (`:50`).

### 4.8 Footer (`src/components/homepage/FooterSection.jsx`) — **SHARED chrome**
- ⚠️ `FooterSection` is used by `MarketingLayout.jsx:3,47` across **all** marketing pages and **redeem `/Contact`** — edits ripple. **Rewrite safely; do not delete.** Consider splitting a shared footer from a homepage-only one.
- Fix: drop "and property agents" + "AI-powered" (`:13-16`, pending §9.1); remove **"Dashboard"** (`:21-22`) and **"Lead Capture"** (`:21`) links; remove dead `href="#"` (`:28-29,35,37`); keep only real destinations (Privacy `/personal-data-policy`; Contact pending §9.2). **Verify** ACRA address (`:46`).

### 4.9 AnnouncementModal — **REMOVE** from page; delete file + barrel export.

### 4.10 Barrel + imports
- `src/components/homepage/index.js:4,9,10` re-export Testimonial/Pricing/AnnouncementModal — **delete those lines** when deleting files or the build breaks.
- `MarketingLayout.jsx:3` imports `FooterSection`/`FloatingElements` from the homepage barrel — consider importing directly to fix the isolation boundary.

---

## 5. Backend: waitlist capture — **Option A only**

Option B (reuse `/api/contact`) is **rejected**: Joi rejects `userType:"waitlist"` and email-only (`backend/src/routes/contact.js:24-33`), and the controller returns success even when email fails (`contactController.js:7-14` + `mailer.js:53-58`) — a false-success trap.

**Option A — dedicated endpoint + table:**
- `backend/src/routes/waitlist.js` with **`export const meta = { path: '/api/waitlist' }`** — the backend **auto-discovers** routes (`routes/index.js:21-31,40-54`); **no manual table edit** needed.
- `controllers/waitlistController.js` + `services/waitlistService.js` (reuse `mailer.js` for notification only).
- Sequelize model `WaitlistSignup` — add to **named exports** in `backend/src/models/index.js:180-190` if imported by name.
- Numbered **migration** creating `waitlist_signups` (`backend/src/database/migrations`, run via `runMigrations.js` at bootstrap).
- **Success = insert/upsert success**; email is a side-effect (log failure separately).
- PDPA/abuse: lowercase+normalize email, unique index on normalized email, idempotent duplicate response (avoid enumeration), rate-limit (~match contact's 5/min `contact.js:15-22`), optional source/IP/UA with a retention note, consent text.

---

## 6. Shared-surface cleanup pulled INTO scope (Codex blockers)

These can't be deferred without shipping broken/embarrassing public surface:

- **Nav brand-gating** (§4.1) — else 404s.
- **`/Contact` handling (§9.2 decision):** the page is slop ("500-person team" `Contact.jsx:77-80`; Property Agent/Fleet Owner dropdown `:219-224` that also mismatches the backend Joi set `contact.js:29-31`) and is **ungated** (`index.jsx:116`), so redeem shows MKTR chrome too. Options: (a) rewrite Contact now, (b) hide Contact from header/footer and use a `mailto:`/WhatsApp link, (c) brand-gate `/Contact`.
- **Sitemap** hardcodes `/features /pricing /about` (`vite.config.js:38-40`) — rebuild from active brand `show*` flags so hidden routes aren't advertised.
- **SEO meta**: `index.html:7-8` has title + canonical but **no description**; MKTR title is generic "MKTR Marketing Platform" (`vite.config.js:21-25`, `brandConfigs/mktr.js:15`). Update for the new positioning.

**Still deferred (flagged):** full rewrite of `/features`, `/pricing`, `/about` bodies (hidden via `show*` for now); legacy PHV roles in `contactService.js:3-8` ROLE_LABELS + `Contact.jsx` dropdown (fix when Contact is done); `Homepage.css` dead code (proof `:190-215`, testimonial `:399-465`, pricing `:475-596`, CTA `:601-671`).

---

## 7. Files to change

```
src/pages/Homepage.jsx
src/components/homepage/HeroSection.jsx
src/components/homepage/LeadSourcesSection.jsx
src/components/homepage/FeaturesSection.jsx
src/components/homepage/CTASection.jsx            # → waitlist
src/components/homepage/FooterSection.jsx         # shared — careful
src/components/homepage/TestimonialSection.jsx    # delete
src/components/homepage/PricingSection.jsx        # delete
src/components/homepage/AnnouncementModal.jsx     # delete
src/components/homepage/index.js                  # remove deleted barrel exports
src/components/layout/SiteHeader.jsx              # nav brand-gate + CTA → waitlist (desktop+mobile)
src/components/layout/MarketingLayout.jsx         # import isolation; Contact chrome
src/lib/brandConfigs/mktr.js                      # showPricing/showFeatures(/showAbout) gates + title
src/pages/Homepage.css                            # dead-code cleanup
vite.config.js                                    # sitemap from brand flags; title/description
index.html                                        # meta description
# Backend (Option A):
backend/src/routes/waitlist.js                    # meta-export auto-discovered
backend/src/controllers/waitlistController.js
backend/src/services/waitlistService.js
backend/src/models/WaitlistSignup.js (+ named export in models/index.js)
backend/src/database/migrations/<n>_create_waitlist_signups.js
# Decision-dependent: src/pages/Contact.jsx (rewrite) OR header/footer Contact link change
```

---

## 8. Acceptance criteria

1. `grep -riE "commission|fleet|vehicle|driver|retell|voice|call bot|property|conversion rate" src/pages/Homepage.jsx src/components/homepage/ src/components/layout/SiteHeader.jsx` → no product/marketing claims.
2. No fabricated numbers anywhere public (`500\+`, `10,000`, `\b3x\b`, "hundreds").
3. No testimonial, no pricing section, no AnnouncementModal; their files + barrel exports gone.
4. **No `/AdminDashboard` or `/LeadCapture` link reachable by an anonymous visitor** (hero, header desktop+mobile, footer, modal all clean).
5. Waitlist POSTs to `/api/waitlist`; success reflects **DB persistence**; renders genuine success + has a real label + consent line.
6. No `href="#"` in footer; every nav/footer link resolves (no `NotFoundForBrand`).
7. Sitemap lists only routes enabled by the active brand config; `index.html` has a real description.
8. `npm run build` passes for **both** brands; redeem build shows no MKTR marketing chrome on `/Contact` (per §9.2 choice).
9. Hero headline + eyebrow contain no voice/"conversation" hook (and no "AI" per §9.1).

---

## 9. Decisions

**Resolved 2026-06-01:** AI positioning → remove all · `/Contact` → hide + mailto/WhatsApp · launch framing → neutral, no date · exclusive leads → claimable.

**Defaults (proceeding unless Shawn objects):**
- **Hero background:** clean brand gradient (no stock clips), pending a real asset.
- **Waitlist Pixel event:** fire a dedicated `Subscribe` event (not `/LeadCapture`'s `trackLead`).

**Still needed from Shawn before build:**
- **Public contact email** to surface (e.g. `hello@mktr.sg`? — the current form goes to personal `shawnleeapps@gmail.com`, not ideal for public).
- **Business WhatsApp number** for the contact link.
