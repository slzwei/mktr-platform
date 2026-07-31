# Redeem.sg Redesign — Prompt Assessment + Reworked Brief for claude.ai/design

**Date:** 2026-07-14
**Purpose:** Shawn wants to run a full Redeem.sg rebrand/redesign on claude.ai/design **without giving it the codebase**. This doc assesses the draft prompt against that constraint and provides a reworked, paste-ready version.

---

## Part 1 — Assessment of the original prompt

**Verdict: strategically excellent, operationally mis-targeted.** The brand strategy, audience definitions, IA, conversion principles, DSA guardrails, and tone sections are genuinely strong — keep ~70% of it. But roughly a third of the prompt is written for an agent *with repository access*, and several requirements contradict how the platform actually works. Pasted as-is into claude.ai/design, these are the failure modes:

### 1. It orders a repository audit that cannot happen
"Before building, inspect the existing repository", the entire Phase 1, "use the repository's existing framework", "do not remove or break existing backend functionality". With no codebase attached, Claude Design will either stall asking for the repo or — worse — **hallucinate an audit** and build on invented assumptions. Every repo-facing instruction must be replaced with a written *platform context* section stating the facts as ground truth.

### 2. The fallback stack is wrong for the port target
The prompt defaults to **Next.js + SSR/SSG, route-level metadata, sitemaps, structured data**. Production redeem.sg is a **React 18 + Vite static SPA** (React Router v7, Tailwind 3, Radix/shadcn primitives, Framer Motion, TanStack Query) served behind Cloudflare/Render — there is no server rendering. A Next.js prototype would fight the port at every seam (routing, data fetching, image handling, metadata). The reworked prompt pins React + Tailwind + CSS-variable tokens + Framer Motion and bans SSR-specific features.

### 3. It invites Claude Design to reinvent a regulated, working funnel
The redemption-flow section reads as a green-field form design. In reality the LeadCapture funnel is live, legally reviewed, and has a **fixed contract**: campaign-configurable fields (name/phone/email/dob/postal_code/education_level/monthly_income), **mandatory phone OTP** (SMS or WhatsApp per campaign), **three consent checkboxes with fixed semantics** (contact = default-ticked opt-out; campaign T&C = required opt-in; third-party disclosure to a financial advisory representative = separate opt-in), a **post-OTP DNC consent gate**, an SC/PR screening gate, and neutral duplicate-redemption messaging. Claude Design can't know any of this without being told — it would design a flow that looks great and can't ship. The reworked prompt states the contract and asks for a *better presentation of the same steps*.

### 4. Scope bleed into the operator platform
Campaigns, leads, agent assignment, round-robin, partner CRM (Redeem Ops) all live on mktr.sg / ops.redeem.sg. The prompt's business-partner sections ("lead and appointment management", "track leads and bookings", "reporting", "attendance workflow") could pull Claude Design into designing partner dashboards that already exist elsewhere. Reworked: the For-Businesses page is **marketing + enquiry only**; no operator UI anywhere.

### 5. Unimplementable asks pollute the deliverables
Meta Pixel/CAPI, TikTok Events API, Google Analytics, sitemap/robots, Lighthouse optimisation, deployment docs, README — none of these are implementable or verifiable inside claude.ai/design. Reworked: analytics becomes a **documented event taxonomy mapped to the real stack** (including the hard rule that `Lead` fires only on completed OTP-verified submission); SEO becomes a content/metadata plan; deployment/README are dropped (that's the porting engineer's job — ours).

### 6. Ambiguities resolved with real facts
- "Sign in, only if an account system exists" → **there is no consumer account system**; nav must not include sign-in. Identity is per-redemption phone OTP. (**Superseded 2026-07-20:** a lightweight phone-OTP "My rewards" wallet is now IN scope — see the amended §1.1/§1.4 below. Still no passwords, no traditional accounts.)
- Partner logos → none are cleared for use; placeholder component mandated.
- Offer metadata (category, age range, inclusions, activation requirement, partner, expiry…) **does not exist in the schema yet** → reworked prompt asks for it as a proposed `design_config` extension schema with mock data seeded in that exact shape, so the backend can adopt it 1:1.
- Public URL contract (`/LeadCapture`, `/t/:slug`, `/p/:slug`, `/share/:slug`, `/r/:token`, `/winners`, `/personal-data-policy`, `/leads/privacy`) → stated so the new IA gives them a home instead of orphaning live QR codes and ad links.

### What was kept nearly verbatim
Business context, positioning, the four audiences, brand direction + avoid-list, the page-by-page IA, design-system requirements, motion, responsive matrix, accessibility, conversion principles, tone, example homepage copy, strategic constraints, and the final standard. These are the strongest parts of the draft.

---

## Part 2 — Reworked prompt (paste everything below this line into claude.ai/design)

---

You are a senior brand strategist, product designer, UX architect, conversion specialist, motion designer, and frontend engineer.

Design and build a completely new **Redeem.sg** public website as a fully interactive, production-quality, responsive prototype — not a static mockup.

This is a **total rebrand**. Do not preserve or reference the current visual identity in any form: no "drop culture", no mystery-drop hype, no neon-on-black streetwear aesthetics, no existing logo, colours, typography, or information architecture. Start fresh.

# 0. Ground rules — read before anything else

You do **not** have access to the codebase, and you must not ask for it. Section 1 tells you everything about the existing platform; treat it as ground truth and do not invent platform capabilities beyond it.

You are building a high-fidelity interactive prototype that an engineering team will port into an existing production app. Therefore:

- Every interaction in the prototype must actually work — navigation, filters, forms, multi-step flows, all states — using realistic seeded mock data. No dead buttons, no lorem ipsum, no fake forms that go nowhere.
- Simulate server behaviour honestly: OTP send/verify, form submission, the DNC check, and data fetching are **mocked**, isolated behind a small clearly-labelled mock API layer so real API calls can replace them file-for-file.
- Do not implement real analytics, pixels, email, payments, or network calls.
- Do not design admin screens, dashboards, staff login, campaign management, or lead management. Those live on a separate operator platform and are permanently out of scope.

# 1. Platform context (ground truth)

## 1.1 Brand and system split

Redeem is the **consumer-facing brand** of MKTR PTE. LTD. (Singapore, UEN 202507548M). A separate operator platform (mktr.sg) handles everything internal: campaign creation via a campaign designer, lead management, agent assignment and round-robin routing, and a partner CRM. **Redeem.sg is purely the public consumer surface**: discovery, campaign landing pages, lead capture, confirmation, and trust/legal pages — plus marketing pages for prospective business partners.

There is **no password/account system** and you must not design one. Instead, design a lightweight **"My rewards" wallet keyed by phone OTP** (decision 2026-07-20): a visitor enters their mobile number, verifies with a one-time code, and sees their rewards and vouchers **across all campaigns**, their basic details, and their marketing preferences. A recognised returning consumer gets prefilled details in any redemption flow. No passwords, no email login, no profile pictures, no social features — verification IS the sign-in, every time. First-time visitors remain fully anonymous until they redeem or open the wallet.

## 1.2 Production stack (the port target)

- React 18 single-page app built with Vite, client-side routing (React Router v7), deployed as a **static site behind a CDN**. There is no server rendering — do not use or depend on SSR/SSG features, server components, or framework-specific metadata APIs.
- Tailwind CSS 3, Radix-based accessible primitives (shadcn-style components), Framer Motion for animation, lucide-react icons, TanStack Query for data fetching, an existing OTP input component, and an embla carousel.
- Build the prototype with **React + Tailwind CSS + design tokens as CSS variables + Framer Motion**. Component architecture should be clean and reusable so the port is cheap. TypeScript-style prop discipline even if writing JSX.

## 1.3 Offer/campaign data model

- Offers are "campaigns" served by a JSON REST API. Each campaign has an id, name, image assets, and a per-campaign **`design_config` JSON blob** that controls its public page: copy, images, which form fields are visible/required and their order, OTP channel (SMS or WhatsApp), an optional Singapore-Citizen/PR pre-screening gate, an optional quiz-style funnel variant, an optional DNC-check flag, and homepage featuring.
- A public endpoint already returns featured campaigns for the homepage.
- The richer offer metadata this redesign needs — category, suitable age range, school level, location/branches, inclusions, **activation requirement**, sponsor disclosure, expiry, capacity, partner identity and verified status — **does not exist in the schema yet**. Propose it as a documented `design_config` extension schema, and seed all of the prototype's mock campaign data in exactly that shape so the backend can adopt it one-to-one.

## 1.4 The existing redemption funnel (regulated — respect this contract)

The production lead-capture flow is live and legally reviewed. Your redemption flow must be a **better-designed presentation of the same contract**, not a new invention:

1. **Optional pre-screening:** a campaign can require a Yes/No "Are you a Singapore Citizen or PR?" gate before the form. Answering "No" politely blocks with a courteous end state.
2. **Form fields** are campaign-configurable from this fixed set: name, mobile number, email, date of birth, postal code, education level, monthly income. Name, phone, and email are effectively always present. If your design needs any additional field (e.g. child's age, preferred branch, preferred timing), include it in the prototype **and flag it explicitly in the schema document as a proposed new field** — do not silently assume it exists.
3. **Phone OTP verification is mandatory** on every public submission (SMS default; WhatsApp optional per campaign). Design all states: idle, sending, pending entry, verified, failed, resend with cooldown.
4. **Consent model — one mandatory agreement block (amended 2026-07-20; supersedes the old three-checkbox opt-out/opt-in mix).** Receiving the reward is conditional on agreeing; a visitor who does not agree cannot submit. The block must cover, clearly and readably:
   - **Contact + marketing consent** — consent to be contacted about this campaign AND about other offers from Redeem (brand-wide scope, the basis for future cross-campaign offers).
   - **Campaign terms** — agreement to this campaign's terms and conditions.
   - **Third-party disclosure** — on sponsored campaigns: consent to disclose contact details to a partner financial advisory representative. This is where sponsored-campaign disclosure lives; design it to be understood, not skimmed.
   Design this as an honest, transparent "here's the deal" moment — the value exchange (reward ↔ permission) stated plainly, never buried or dark-patterned. Whether it renders as one combined acknowledgement or grouped required checkboxes is your design call; the semantics (all required to submit) are fixed. Exact legal copy comes from compliance later — build it as configurable content blocks. Mention of unsubscribe ("you can opt out of marketing anytime") belongs here or in the confirmation.
5. **DNC gate:** when a campaign has DNC checking enabled and the OTP-verified number is on Singapore's Do-Not-Call registry, a consent gate appears **after** OTP verification and blocks submission until the user explicitly consents to marketing contact. The current implementation is utilitarian — design this state to be clear and respectful.
6. **Duplicate handling:** repeat submissions show a neutral "you've already redeemed this offer" notice, never an error.
7. **Confirmation:** what was redeemed, what happens next, who will contact the user, expected response time, activation-requirement reminder.

All legal and disclosure copy will be finalised by compliance later — build every disclosure, consent line, and requirement panel as a **configurable content block** with realistic placeholder copy, never hard-coded prose scattered through components.

## 1.5 URL contract

These public routes exist in production (QR codes and paid ads point at them) and must have a home in your information architecture, restyled freely: `/` (homepage), `/LeadCapture?campaign_id={id}` (campaign form), `/t/:slug` (QR/tracking entry), `/p/:slug` (campaign preview), `/share/:slug`, `/r/:token`, `/winners` (lucky-draw winners page), `/personal-data-policy`, `/leads/privacy`. New routes for Explore, categories, DSA, businesses, about, and the **My rewards wallet** are yours to define — use clean, descriptive, indexable URLs.

## 1.6 Analytics — design for, do not implement

Production fires Meta Pixel + Conversions API and TikTok Pixel + Events API with deduplicated shared event IDs, and captures UTM parameters and click IDs for attribution. `ViewContent` fires on campaign page view; **`Lead` fires only on a completed, OTP-verified submission** — this is what ad platforms optimise on, so nothing in your design may imply firing it earlier. Deliverable: an **event taxonomy document** mapping every meaningful interaction in your design (offer impression, offer click, form start, OTP requested, OTP verified, consent acknowledged, submission complete, confirmation view, partner-enquiry submit) onto this stack, with no duplicate conversion events.

# 2. Business context

Redeem.sg is a Singapore consumer discovery and customer-acquisition platform.

Its original purpose is to help financial consultants generate qualified appointments by offering consumers attractive rewards, trials, experiences, assessments, vouchers, and partner benefits. Redeem also works with enrichment centres and other businesses that contribute free trials or high-value introductory experiences.

Example verticals: art and visual-arts assessments, DSA preparation programmes, coding and robotics trials, speech and drama, sports academies, music and dance, tuition and academic enrichment, beauty and wellness, fitness trials, health screenings, dining and lifestyle rewards, retail vouchers, financial-planning campaigns.

Redeem is **not primarily a coupon website**. It should feel like a trusted platform where Singapore consumers discover worthwhile opportunities from verified brands.

The business model can include: businesses contributing trials or promotional experiences; Redeem generating qualified consumers; financial consultants sponsoring selected campaigns; consumers completing a clearly disclosed activation requirement; partners receiving potential customers; consultants receiving qualified appointments; Redeem earning campaign, lead, attendance, sponsorship, or subscription revenue.

The site must support this broader model **without making the homepage feel like an insurance lead-generation website**.

# 3. Core positioning

Build the brand around this idea: **"Discover experiences and rewards worth showing up for."**

Alternative directions you may explore: "Discover something worthwhile" / "Better experiences from trusted Singapore brands" / "Try more. Discover more. Spend less." / "Real experiences. Real rewards. No points required." Do not use any line blindly — develop the strongest positioning from the full business model.

The homepage must make the following clear within five seconds:

1. Redeem helps consumers discover attractive experiences and rewards.
2. Offers come from real, verified Singapore businesses.
3. Some experiences involve an assessment, consultation, trial, appointment, or other **clearly disclosed activation requirement**.
4. No points to collect, no paid membership.
5. The site is safe, legitimate, modern, and easy to use.

Do not make "financial planning" the hero message. Do not hide campaign conditions — every campaign explains its activation requirement **before** the user submits details.

# 4. Target audiences

**Primary consumer — Singapore parents, roughly 30–50.** Looking for DSA-related enrichment, art/coding/robotics/speech/sports/music/academic classes, child assessments, trial lessons, family activities, useful household rewards. They value trust, clarity, convenience, credibility, strong brands, transparent conditions, child safety, and genuine value.

**Secondary consumer — Singapore adults** interested in lifestyle experiences, beauty and wellness, fitness, dining, retail rewards, financial education, property-related offers, professional services.

**Business partner — enrichment centres, academies, clinics, salons, gyms, retailers, restaurants, service businesses.** They want qualified customers, more bookings, better attendance, clear campaign reporting, lower acquisition risk, a professional brand environment, and simple onboarding. (Their operational tools live on the separate operator platform — on this site they only need to be *sold* and to *enquire*.)

**Financial consultant — a licensed consultant who sponsors or fulfils selected campaigns.** They want qualified appointments, clear eligibility, proper disclosures, consent, and reliable campaign economics. They never log in here.

# 5. Brand direction

Reimagine the entire brand: new logo, wordmark, brand symbol, colour system, typography system, icon style, illustration direction, photography direction, motion system, component system.

The brand should feel: warm, smart, optimistic, contemporary, trustworthy, distinctive, premium-but-accessible, family-friendly without looking childish, Singapore-relevant without clichés, and suitable across education, finance, wellness, lifestyle, and family categories.

**Avoid:** cryptocurrency aesthetics; streetwear "drop" culture; mystery-box aesthetics; neon-on-black as the dominant system; aggressive sales visuals; generic corporate blue; childish primary-school graphics; stock-template SaaS visuals; excessive gradients; overly luxurious styling that makes free trials look suspicious; cartoon mascots unless subtle and strategically justified.

The identity must work equally well for a DSA art assessment, a robotics class, a facial trial, a family activity, a financial-planning reward, and a premium retail campaign.

**Suggested creative direction:** explore an identity based on discovery, opportunity, doors opening, pathways, sparks, windows, tickets, or meaningful moments. Consider a brand symbol that can animate and transform across categories — e.g. a simple abstract Redeem mark that becomes a doorway, a ticket, a bookmark, a spark, a window, a path marker. Do not copy any existing consumer marketplace. Create something ownable.

# 6. Information architecture and pages

Build the following public pages and flows.

## A. Homepage

**Navigation** (desktop + mobile, sticky, subtle change on scroll): Explore, Education, Lifestyle, How it works, For businesses, About, **My rewards** (the phone-OTP wallet entry — quiet utility placement, not a "Sign up" growth lever; no password account exists).

**Hero:** strong headline, clear supporting copy, primary + secondary CTA, dynamic visual representing multiple experiences, category indicators, trust signal. CTA labels must be direct ("Explore experiences", "See what's available") — never vague hype ("Something is coming", "Unlock the unknown", "First drop loading").

**Interactive discovery section:** browse by child's age or school level, interest, category, location, availability, type of benefit. Categories: Art & creativity, Coding & robotics, Speech & performance, Sports & movement, Music & dance, Academic enrichment, Family & lifestyle, Wellness, Dining, Financial education. Visually distinctive category cards.

**Featured experiences:** realistic seeded campaigns. Each card includes partner name, offer title, image, location, suitable age, main reward or trial, **activation-requirement summary**, availability, verified status, clear CTA. Example: "Visual Arts Discovery Session — For Primary 3 to Primary 6. Includes: trial class, talent assessment, parent consultation, personalised feedback. Activation requirement: 'Parent attends a 20-minute financial-planning conversation before the session is confirmed.'" The requirement is card-visible, never fine print.

**How Redeem works:** 1) Discover an experience → 2) Check the details and requirements → 3) Submit and verify your details → 4) Complete the activation and enjoy the experience. Visually simple.

**Why people trust Redeem:** verified Singapore businesses; OTP-verified redemptions; clear activation conditions; no paid membership; no credit card; privacy and consent controls; support contact; registered business information (MKTR PTE. LTD., UEN 202507548M).

**Parent-focused section:** enrichment trials, DSA-related assessments, talent-development pathways, holiday programmes. Language: "Explore suitable programmes", "Discover your child's interests", "Understand possible development pathways". Never position Redeem as a DSA admissions authority; never promise school admission.

**Partner trust strip:** no real partner logos are cleared for use — build a clearly-marked placeholder component designed for easy replacement. Do not invent partnerships.

**For businesses teaser:** reach qualified customers, launch campaign offers, fill trial-class capacity, improve appointment attendance. CTA: "Become a partner".

**Financial-consultant context (subtle, not a major section):** "Some campaigns are sponsored by financial consultants and require a short financial-planning conversation. Every requirement is shown before you redeem."

**FAQ:** Is Redeem free? Do I need an account? How do I find my rewards again? Why is phone verification required? Will I receive sales calls? What is an activation requirement? Why do some campaigns involve a consultant? Can I cancel? How do I unsubscribe from offers? How are partners verified? Are DSA results guaranteed? How is my data used? Can I redeem more than once? What happens after submission?

**Footer:** Explore, categories, How it works, For businesses, Contact, Privacy Policy, Personal Data Protection Policy, Terms, DNC information, business registration details, social links, copyright, support email.

## B. Explore page

Marketplace-style discovery: search, filters, sort, category tabs, age filters, school-level filters, location, online vs physical, weekday vs weekend, free vs discounted, offer type (trial / assessment / workshop / reward / consultation), DSA-related, verified partners only, available now, ending soon. Desktop: sidebar or top filter bar. Mobile: filter drawer or bottom sheet. Include loading skeletons, empty states, error states, no-results recommendations.

## C. Category landing template

One reusable, theme-able template (not ten bespoke pages) covering: Education, Art & creativity, Coding & robotics, Speech & drama, Sports, Music & dance, Academic enrichment, Lifestyle, Wellness, Family experiences. Each instance: category-specific hero, featured offers, short educational guide, relevant FAQs, partner CTA, cross-category recommendations.

## D. DSA discovery page

Headline direction: "Explore programmes that may support your child's talent-development journey." Include: what DSA is, talent categories (visual arts, music, dance, drama, debate/public speaking, sports, robotics/STEM, languages, leadership development), typical preparation activities, how to evaluate a provider, questions parents should ask, current offer listings, and a clear disclaimer that **admission is determined by schools — no guaranteed outcomes, no success-rate claims**. The page must feel useful even before the user submits anything.

## E. Offer-detail page (critical conversion page)

Include: offer title, partner, verified badge, images, clear value, full inclusions, suitable age, school level, location, date/time options, duration, capacity, eligibility, what to bring, parent-attendance requirement, campaign expiry, redemption steps, **activation requirement**, sponsor disclosure, data-use disclosure, cancellation policy, FAQ, partner information, map placeholder, similar offers, sticky mobile CTA. No fabricated reviews.

Use a prominent **"Before you redeem" panel** — e.g. "To activate this offer, a parent must attend a 20-minute financial-planning sharing with a licensed consultant. No purchase is required. The consultant may contact you to arrange the session." Require acknowledgement before submission. Never bury this in terms and conditions.

## F. Redemption flow

A conversion-optimised multi-step flow implementing **exactly the funnel contract in Section 1.4** with progressive disclosure (never all fields at once). Suggested steps: eligibility/pre-screening → parent or participant details → child details when relevant → preferences (branch, day, time) → phone OTP verification → DNC gate when triggered → activation-requirement acknowledgement → consent → confirmation. Include progress indicator, back navigation, inline validation, all OTP states, submission protection, duplicate-lead messaging, and success state. **Design the returning-consumer variant too:** once the phone is OTP-verified and recognised (or the visitor arrives already verified from My rewards), known details prefill and the flow visibly shortens — show both the first-timer and the recognised paths. Collect no unnecessary data; flag any field not in the Section 1.4 set as a proposed schema addition.

## G. Confirmation page

What was redeemed, what happens next, who will contact the user, expected response time, activation-requirement reminder, add-to-calendar action, contact support, a **"find this anytime in My rewards" pointer**, and a personalised **"next for you" cross-sell block** (related offers drawn from the mock data — this is a deliberate audience-growth surface, not an afterthought).

## H. For businesses page

Professional B2B marketing page for enrichment centres, academies, clinics, gyms, salons, retailers, restaurants, service businesses. Value propositions: fill unused class or appointment capacity; acquire qualified customers; run trial or assessment campaigns; reach verified consumers; track campaign performance; pay based on agreed outcomes; use Redeem's campaign and lead infrastructure. Include how campaigns work, example campaign economics, lead-qualification options, onboarding overview, and a **partner enquiry form** (designed and working in the prototype with a mocked submit). No testimonials unless real. **Do not design any partner dashboard or reporting UI** — that exists on the operator platform.

## I. About and trust page

Redeem's purpose, relationship with MKTR PTE. LTD. (registered company details), privacy practices, partner-verification process, consumer-protection principles, contact and support process.

## J. Legal page templates

Privacy Policy, Personal Data Protection Policy, Terms, DNC information — as structured content templates with configurable blocks (final wording comes from compliance).

# 7. Visual design system

Create a full token-based design system: primary/secondary/accent colours, neutrals, success/warning/error/info, background surfaces, borders, text hierarchy, shadows, radii, spacing scale, breakpoints, grid, container widths, typography scale, motion durations, easing, focus states. **No arbitrary one-off values** — use CSS variables/tokens throughout.

**Typography:** highly readable, modern, with editorial personality; excellent mobile readability; clear display-vs-body distinction; suitable for families and business partners; accessible. Avoid condensed fonts, all-caps body copy, and novelty type for essential information. Use properly licensed, properly loaded web fonts.

**Imagery:** authentic Singapore families, children in real activities, hands-on learning, natural expressions, warm candid photography. Avoid generic AI-looking faces, over-posed stock, American school environments, unrealistic luxury, or imagery implying guaranteed DSA success. Use replaceable placeholder components where real imagery is unavailable.

# 8. Motion and interaction

Motion is welcome — performance and clarity come first. Include: subtle hero parallax, layered card movement, scroll-triggered reveals, staggered category-card animation, smooth section transitions, an animated brand symbol, hover/press states, card image zoom, filter transitions, mobile bottom-sheet animation, accordion animation, metric count-ups, sticky-CTA transitions, skeleton loading, success-state animation, micro-interactions in OTP and form validation.

Avoid: scroll hijacking, long delays, animating every text element, disorienting transforms, heavy 3D, animations that block action, aggressive parallax on mobile. Respect `prefers-reduced-motion`, keyboard navigation, touch, and low-powered devices. Keep animations GPU-friendly (transform and opacity).

# 9. Responsive behaviour

Fully responsive; **mobile is a primary experience**, not a stacked desktop. Design and test at 320 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 px and wide screens. Requirements: thumb-friendly CTAs, sticky redemption CTA, readable type, no horizontal overflow, proper image cropping, compact navigation, responsive cards, mobile filters, accessible form inputs with appropriate input types, safe-area support, keyboard-safe form behaviour, minimum 44px interactive targets.

# 10. Accessibility

Target WCAG 2.2 AA: semantic HTML, proper heading hierarchy, keyboard navigation, visible focus states, accessible menus/dialogs/accordions, labelled form fields, clear error messaging, ARIA only where necessary, sufficient contrast, screen-reader text, reduced-motion support, alt text, logical tab order, no colour-only status indicators.

# 11. Conversion principles

Every page must answer: What is this? Who is it for? What do I receive? What must I do? Is it free? What happens next? Who will contact me? Why should I trust this? How is my information used?

No hidden obligations. No deceptive urgency, fake countdowns, or fake scarcity. Show only real capacity, real expiry, real availability, real partner information (mocked realistically in the prototype). Design for **qualified conversions**, not maximum form submissions.

# 12. Content tone

Friendly, clear, reassuring, direct, Singapore-aware, respectful. Not overly casual, not corporate, not hype, not childish, no marketing jargon. Avoid vague phrases ("Unlock endless possibilities", "Embark on a journey", "Transform your future"). Use specific language — instead of "Unlock your child's unlimited potential", write "Let your child try the programme, receive feedback, and decide whether it is a suitable next step."

**Example homepage direction (improve on this, don't copy):** Eyebrow: "Experiences from verified Singapore brands". Headline: "Discover something worth trying." Support: "Explore enrichment trials, family experiences, wellness offers and useful rewards. Every requirement is shown clearly before you redeem." Primary CTA: "Explore experiences". Secondary: "How Redeem works". Trust line: "No paid membership. No credit card. Clear conditions before you submit." Financial disclosure block: "Why do some offers include a financial-planning conversation? Selected campaigns are sponsored by licensed financial consultants. When this applies, the requirement is shown clearly before you redeem. No purchase is required."

# 13. Deliverables

1. Brand strategy summary, positioning statement, and brand personality
2. At least three written brand directions with a recommendation (see process below)
3. Logo/wordmark/symbol concept for the chosen direction
4. Colour palette, typography system, and design tokens (CSS variables)
5. Sitemap and user journeys
6. Responsive homepage
7. Explore marketplace page
8. Category landing template (theme-able, shown with at least two categories)
9. DSA discovery page
10. Offer-detail page
11. Redemption flow (full state coverage per Section 1.4)
12. Confirmation page
12b. **My rewards wallet** — phone-OTP entry, cross-campaign rewards/voucher list (live, redeemed, expired states), voucher re-access, basic details, marketing preferences incl. unsubscribe
13. For businesses page (with working mocked enquiry form)
14. About and trust page + legal page templates
15. Fully functional navigation, motion system, and empty/loading/error/success states throughout
16. Seeded campaign mock data in the proposed schema shape
17. **`design_config` extension schema document** (all proposed offer fields, with types and examples)
18. **Analytics event taxonomy document** (per Section 1.6)
19. Content/metadata plan (page titles, descriptions, URL structure — documentation, not framework implementation)
20. Accessibility notes and a short before-and-after explanation of the strategic redesign

# 14. Process

**Phase 1 — Product architecture.** From Sections 1–6, present the sitemap, navigation model, page purposes, user journeys, campaign/offer taxonomy, disclosure model, and conversion flow.

**Phase 2 — Brand exploration.** Present at least three distinct brand directions in written form (strategic idea, logo concept, colour direction, typography, visual language, strengths, risks). Recommend one and explain why. **Pause for approval before building.**

**Phase 3 — Design system.** Tokens, typography, grid, core components (buttons, forms, cards, navigation, disclosure panels), motion primitives.

**Phase 4 — Full build.** All pages and flows. Do not stop after the homepage.

**Phase 5 — QA.** Mobile/tablet/desktop, keyboard navigation, reduced motion, form validation, empty/loading/error states, broken links, overflow, console errors.

**Phase 6 — Handoff documentation.** Architecture, component system, content configuration, how to add or edit a campaign in the mock data, the schema and analytics documents.

# 15. Strategic constraints

Redeem must remain compatible with its original financial-adviser lead-generation objective. Do not pivot it into a pure DSA portal — DSA is one important education vertical. The brand and architecture must support education, family, wellness, lifestyle, retail, finance, and services coherently in one identity. Do not create two disconnected websites or a separate DSA sub-brand; use reusable category theming within one strong Redeem identity.

# 16. Final standard

The website should look and feel credible enough that a Singapore parent trusts it with personal details, an enrichment centre is proud to appear on it, a financial institution is comfortable sponsoring a campaign, a consultant sees it as a serious acquisition platform, and a visitor immediately understands what Redeem does. The experience must work beautifully on mobile, be distinctive without sacrificing clarity, and scale to hundreds of campaigns and partners.

Do not optimise for awards, novelty, or spectacle at the expense of comprehension. Motion should improve storytelling; branding should improve recognition; UX should improve trust. Every major design decision must support the business model.

Begin with Phase 1 (product architecture) and Phase 2 (brand directions), and wait for approval before the full build.
