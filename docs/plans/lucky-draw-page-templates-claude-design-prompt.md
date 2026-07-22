# Lucky-Draw Campaign Page — Multiple Template Directions — claude.ai/design prompt

**Date:** 2026-07-22
**Target:** claude.ai/design, as a fresh project (suggested name: **"Redeem Draw Page Templates"**). Attach when pasting: screenshots of the six current templates from Campaign Studio's preview (Editorial, Poster, Split, Spotlight, Express, Journey — any campaign, mobile width), and the Tokyo hero image.
**Goal:** a gallery of **distinct, selectable campaign-page templates purpose-built for lucky-draw campaigns**, so a draw campaign's page can be chosen per-campaign in the Campaign Studio template picker instead of borrowing a generic lead-capture layout with a small badge.
**After the design:** engineering implements the chosen direction(s) as new template ids in the design_config v2 renderer + Studio picker, so every direction must be reproducible under the constraints in §1.6.

---

## Paste everything below this line into claude.ai/design

---

You are a senior conversion/brand designer creating **new page templates** for an existing campaign-page system. The system, its form component, and its config contract already exist and are fixed — you are designing the compositions around them. Invent nothing outside the scope below.

# 0. Ground rules

You do **not** have access to the codebase and must not ask for it. Section 1 is ground truth — do not invent capabilities beyond it. Build an interactive prototype: a template **gallery/switcher** where each direction renders the same seed campaign (§1.5) as a full page — mobile-first, with a desktop pass — including all three page states (§2). Realistic seeded content only; the attached screenshots show the incumbent templates your directions must be clearly distinct from.

# 1. Platform context (ground truth)

## 1.1 What this page is

redeem.sg runs consumer reward campaigns in Singapore. A campaign page is a single-purpose lead-capture landing page: nearly all traffic is **paid social clicks on phones** (Instagram/Facebook/TikTok in-app browsers). The page's one job is form completion; everything else exists to earn that. Brand: **redeem.sg** wordmark, consumer-friendly, institutional-trust posture (SG audiences are highly scam-wary — especially of prize draws).

## 1.2 The lucky-draw mechanic (what the page must communicate)

- Signing up = **one verified entry** in a prize draw. Free to enter, 18+.
- Entry requires SMS OTP verification of the mobile number — **one entry per verified number** (a genuine trust marker: verified, no bots, no multiple entries).
- Entries close at a fixed date (seed: **30 Oct 2026, 23:59 SGT**).
- **×10 boost:** complete a complimentary ~20-min financial review before the close date → the entry becomes ten. After signup the person receives a pass by WhatsApp/email; the consultant scans it at the session. The page should plant this (it's also how the business wins) without burying the primary signup action.
- One winner, drawn in a witnessed process after close; contacted directly; masked results published at redeem.sg/winners (a real page — linkable trust element).
- Anti-scam assurance is brand policy: **we never ask for payment to release a prize.**
- Full T&Cs open in a dialog from the form's consent checkbox; the page may also reference them.

## 1.3 The config contract (the slots a template composes)

Every template renders from the same campaign config. Slots available:

- **content**: `headline`, `subheadline`, `story` (a short paragraph), `emphasis` (one punchy line), `submitLabel` (form button text), `wordmark`, optional `heroCtaLabel`, `footer.regulatory`, and **media** (one hero image or video).
- **theme**: an `accent` color (seed: `#3B82F6` — but treat accent as a variable) and a light/dark `preset`.
- **form**: which fields show (seed: name, phone, email; others hidden), SMS verification on, terms HTML.
- **luckyDraw**: `enabled`, `closesAt`, `prize` string, `multiplier` (10). **Today the renderer shows only a small pill — "🎁 LUCKY DRAW · CLOSES 30 Oct 2026" — and the prize string is never rendered anywhere on the page.** Your templates own fixing that.
- Each template may additionally expose **2–3 template params** (knobs an admin can flip in Studio, e.g. media side, card style, overlay tone). Define yours per direction.

## 1.4 The form is a fixed component (hard contract)

One shared signup form component is dropped into every template: field inputs → SMS OTP send/verify step → required T&C consent checkbox (opens the terms dialog) → submit button. Templates decide its **container** (width, framing, position, reveal behavior) and receive its states, but must not reorder or redesign its internals. Assume it needs ~320–420px of comfortable width.

## 1.5 Seed campaign (use verbatim)

- **Tokyo Getaway Lucky Draw** — prize: **4D3N Tokyo getaway (flights + hotel)**, one winner, one pax.
- headline "Win a 4D3N Tokyo Getaway" · subheadline "Return flights + 3 nights' hotel, for one lucky winner. Free to enter." · emphasis "One winner. Flights + hotel. On us." · story "Drop your details and you're in the draw for a 4-day, 3-night Tokyo getaway — flights and hotel covered for one. Verified by a one-time SMS code: one entry per person, no app, no catch." · submitLabel "Enter the draw" · wordmark "redeem.sg"
- Hero: the attached Tokyo dusk image (Tokyo Tower, Mt Fuji, blossoms — clean sky area usable for type).
- closesAt/boost deadline: 30 Oct 2026 · multiplier ×10 · winners page: redeem.sg/winners

## 1.6 Hard production constraints

- **Mobile-first inside ad in-app browsers**: the signup path must be obvious within the first viewport-and-a-half on a 390×844 screen. Desktop is the adaptation, not the design.
- **Implementable in a React renderer with plain CSS capabilities**: flat color, gradients, borders, standard transforms/transitions are fine; no WebGL/shaders/canvas effects, no scroll-jacking, no heavy animation libraries, no new webfonts per template (system/site font stack + weight/size/spacing do the typographic work).
- **Performance**: one hero asset max above the fold; nothing that delays the form.
- **The close date is a fixed calendar fact.** A live countdown to `closesAt` is allowed if a direction earns it; fake scarcity (entry counters, "3 spots left") is forbidden.
- **Every direction must design all three states**: OPEN (the page), **DRAW CLOSED** (post-`closesAt`: entries no longer accepted, winner-notification explanation, link to winners page — today this is a plain gray fallback page; make it a designed moment), and **SUCCESS** (post-submit: today it's a generic "You're all set." — design the "you're in the draw" moment: entry confirmed, check WhatsApp/email for your pass, complete your session before the close date for ×10).
- Accent color and light/dark preset must be swappable without breaking any direction (show at least one direction in a second accent to prove it).

# 2. The brief — deliverables

**A. 4–6 named template directions**, each a genuinely different composition strategy for a draw page — not palette swaps of one layout. Each direction must place, deliberately: the **prize** (currently unrendered — hero it), the **close date** (urgency without scam-stink), the **×10 session mechanic** (secondary but present), the **verified-entry trust markers** (SMS-verified · one entry per number · free to enter · 18+), the **anti-scam line**, the **winners-page link**, and the **form container**. For each direction supply: name, one-line thesis, mobile comp, desktop comp, the three states (§1.6), the slot map (which config slot feeds which element), and its 2–3 template params with all values.

**B. The gallery switcher** — one prototype where I flip between directions (and states within a direction) on the same Tokyo seed data at mobile width, so choosing among them takes seconds.

**C. A recommendation** — which direction you'd ship as the default draw template and why, one short paragraph, conversion-first reasoning.

# 3. What NOT to do

- Don't redesign the form component's internals, the OTP flow, or the consent checkbox — containers only.
- Don't resemble the six incumbent templates (attached) — those already exist as choices; new directions must read as new.
- Don't add claims beyond §1.2 (no "guaranteed win", no fake urgency, no prize-value inflation, no partner/airline logos).
- Don't rely on photography beyond the one hero slot — campaigns swap heroes; compositions must survive a mediocre hero (show one direction with media hidden/none).
