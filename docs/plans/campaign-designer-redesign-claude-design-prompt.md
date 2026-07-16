# Campaign Designer revamp — claude.ai/design prompt (self-contained)

Paste the block between the `---` rules into a NEW claude.ai/design conversation
(fresh project — don't reuse the Redeem.sg or MKTR Admin ones). Deliberately
self-contained: NO codebase is attached, so this document is the designer's only
source of truth. Written 2026-07-16; every contract below was verified against
the live designer + LeadCapture runtime on `main` that date.

The goal: claude.ai/design ideates a ground-up **Campaign Studio** (editor +
customer-page template system) with zero legacy visual bias, but inside a
functional contract tight enough that we can port the result onto the existing
backend without losing a single feature. Parity is enforced by two deliverables:
a `design_config` v2 schema with a documented v1→v2 migration mapping, and a
knob-by-knob parity checklist.

An appendix at the bottom (NOT part of the prompt) lists pre-existing bugs the
audit surfaced — fix those during implementation regardless of the redesign.

---

You are a senior product designer, UX architect, systems designer, and frontend
engineer. Design and build **Campaign Studio** — a complete reinvention of the
campaign designer inside a Singapore lead-generation platform — as a fully
interactive, production-quality prototype, not a static mockup.

You are designing TWO coupled surfaces at once:

1. **The Studio (operator-facing editor)** — where a small ops team authors a
   campaign's public page: content, look, layout, form fields, eligibility
   gates, quiz funnel, and distribution extras. Today it is a cramped
   settings-form; you are replacing it with a modern design tool.
2. **The campaign page system (customer-facing output)** — the public
   lead-capture page consumers land on from QR codes and paid ads. Today every
   campaign renders in ONE locked layout with one accent-color knob; you are
   replacing it with a family of genuinely different, selectable layout
   templates driven by structured config.

Both surfaces are driven by a single JSON document per campaign (internally
called `design_config`). The editor writes it; the public page renders it
deterministically. That coupling is the core architecture — respect it
everywhere.

# 0. Ground rules — read before anything else

- You do **not** have access to the codebase, and you must not ask for it.
  This brief is ground truth; do not invent platform capabilities beyond it.
  Where something is genuinely unspecified, make the best-UX choice and record
  it in an "Assumptions" list rather than asking.
- Every interaction in the prototype must actually work with realistic seeded
  mock data — no dead buttons, no lorem ipsum. Server behaviour (save, AI
  generation, uploads, slug checks, OTP/DNC inside the preview) is **mocked**
  behind a small, clearly-labelled mock API layer so real calls can replace it
  file-for-file.
- Do not implement real analytics, pixels, SMS/WhatsApp, email, or network
  calls.
- The customer funnel is **live, legally reviewed, and regulated**. Your job on
  that funnel is a dramatically better *presentation* of the exact same
  contract (Section 2) — never a new invention of its logic, order, defaults,
  or consent semantics.
- Out of scope (exists elsewhere; do not design, do not remove): the rest of
  the admin console (campaign list, details/delivery/sources/launch tabs, lead
  tables), the consumer marketplace (offer cards, offer detail, flow pages),
  the partner CRM, the confirmation-email templates, and the specialized
  long-form "guided review" campaign designer. Your Studio replaces only the
  classic designer, for standard and quiz campaigns.

# 1. Platform context (ground truth)

## 1.1 Company, brands, hosts

MKTR PTE. LTD. (Singapore, UEN 202507548M) runs a lead-generation platform for
insurance/financial-advisory distribution plus consumer reward campaigns.
Two public brands share one backend:

- **redeem.sg** — the consumer brand (warm, editorial). Default home of every
  campaign page.
- **mktr.sg** — the operator brand. Hosts the admin console; can also serve a
  campaign's public page when that campaign opts in.

Each campaign carries `customerHost: 'redeem' | 'mktr'` (default `redeem`).
That single enum decides: which domain the campaign's links/QR codes point at,
the default wordmark shown on the page, the brand + sender of the confirmation
email, and the origin of share links. The page itself renders on whichever
host serves it — the toggle changes canonical links and branding, not a
redirect.

The Studio lives inside the mktr.sg admin console (a light-first ops design
system with dark mode), as part of a per-campaign workspace that also has
Details / Delivery / Sources / Launch areas. You may keep the Studio embedded
or take over the full viewport as an immersive editor (recommended — think
Framer/Typeform-class) with a clear "back to campaign" exit. Only admins use
it today; a few controls are admin-only even at the API level (marked §3).

## 1.2 Production stack (the port target)

- React 18 single-page app built with Vite, client-side routing, deployed as a
  static site behind a CDN. **No SSR** — never depend on server rendering.
- Tailwind CSS, Radix-based accessible primitives (shadcn-style), Framer
  Motion, lucide-react icons, TanStack Query, dnd-kit (already used for
  drag-reorder), an existing OTP input, DOMPurify for sanitizing configured
  HTML.
- Build the prototype with React + Tailwind + design tokens as CSS variables +
  Framer Motion. Clean component architecture; TypeScript-style prop
  discipline even in JSX.
- The customer page is an **ad landing page**: paid Meta/TikTok traffic on
  mid-range phones. Fast first paint, lazy heavy media (YouTube embeds are
  lazy today), no heavy animation libraries on the public page.

## 1.3 How config flows (architecture you must preserve)

1. The Studio edits an in-memory `design_config` document. **Save is manual**
   (single Save button, dirty indicator, unsaved-changes guard on leaving).
   Saving PUTs the whole document; the server clamps values (length limits,
   enums, admin-only keys) and persists. If the campaign is already active,
   a save is **live immediately** — design the affordance honestly (e.g.
   "Saved · live on redeem.sg").
2. Public pages never read the raw document: the server rebuilds a
   **public whitelist** of it (internal keys stripped). Never design a feature
   that requires leaking internal-only data to the public page.
3. **Preview = the real renderer.** In production, the editor preview renders
   the exact same components as the live page, fed with the in-progress
   (unsaved) document. Your prototype must be structured the same way: ONE
   campaign-page renderer, mounted both in the Studio canvas and as a
   standalone page. Pixel parity between preview and live is a hard product
   guarantee.
4. Two out-of-band previews exist and stay: a **Copy link** action (canonical
   public URL on the campaign's customer host) and a **shareable preview
   link** that mints a tokenized snapshot URL others can open without login
   (it renders the last SAVED state — design the "save first, then share"
   semantics honestly, e.g. auto-prompt to save).

## 1.4 Campaign object facts the Studio consumes but does not own

Set elsewhere in the workspace, and must be respected by the preview:
`name` (campaign name), `min_age` / `max_age` (defaults 18/65 — drive live
date-of-birth validation and the "Only available for ages X–Y" hint),
`status` (draft/active/paused/…), per-campaign `metaPixelId` / `tiktokPixelId`
overrides, and campaign `type`: `lead_generation` (standard) or `quiz`
(same page with a quiz gate before the form). A third type (`guided_review`)
has its own separate designer — out of scope.

Lucky-draw campaigns: a `luckyDraw` config block (prize, close date, boost
deadline, entry multiplier, winners count) is managed by admins via API, NOT
in the designer. The Studio must **surface** draw state read-only where it
matters (a badge, the preview's draw messaging, a mismatch warning if
marketplace copy dates disagree with the live draw record) and its save flow
must tolerate the server invariant "an enabled draw requires a close date and
non-empty campaign T&C" (terms get version-pinned on save). Do not build a
draw editor unless you flag it as a proposed extension.

# 2. The customer page — regulated funnel contract (parity required)

Everything in this section exists in production today and must survive your
redesign exactly in logic, order, defaults, and semantics. Presentation,
hierarchy, and styling are yours. All legal/disclosure copy must be built as
**configurable content blocks** with the current copy as realistic placeholder
— never hard-coded prose scattered through components.

## 2.1 Page anatomy (today's single layout — your baseline, not your ceiling)

Wordmark (configurable text; defaults to the host name "redeem.sg"/"mktr.sg"),
optional hero/story card: hero media (16:9 — image, OR uploaded video that is
auto-transcoded to a **silent** MP4 and autoplays muted/looped/inline, OR a
YouTube link rendered as a lazy privacy-mode embed), story paragraphs
(blank-line separated) + optional bold emphasis line, optional hero CTA pill
that smooth-scrolls to the form (renders only when hero media exists AND a
label is set). Then the form card, then a footer: regulatory paragraph
(configurable, brand default supplied) + brand line (default "Powered by
MKTR"; any "MKTR" substring auto-links to mktr.sg). A campaign-configurable
accent color tints CTAs/focus/checkboxes; one of five licensed display fonts
(Fraunces default, Playfair Display, Space Grotesk, Albert Sans, Inter)
styles wordmark/headline/gate headings.

## 2.2 Eligibility gates (before any form input; stack in this order)

1. **SG/PR gate** (per-campaign toggle): "Are you a Singapore Citizen or
   Permanent Resident?" — Yes reveals the form plus a persistent "✓ Confirmed:
   Singaporean or PR" chip with Edit; No shows a courteous, reversible
   ineligible card ("This promotion is only open to Singapore Citizens and
   Permanent Residents." + "I picked the wrong option" undo). Client-side and
   self-declared only.
2. **Financial-advisor exclusion** (separate toggle, stackable): "Are you a
   financial advisor, consultant, or insurance agent?" — Yes blocks
   reversibly ("This promotion is for members of the public…").
3. **Quiz gate** (quiz campaigns): intro screen (headline/subhead/CTA) →
   one single-select question per screen, tap auto-advances (~200ms), progress
   "n / N", no back button, optional option images → persona result reveal
   (profile title/color/description, optional readiness % meter + gap line,
   optional rarity line "About 1 in N share your result", value-exchange line,
   CTA subtext, disclaimer) → CTA continues to the form. A "qualification"
   quiz mode skips scoring/reveal and goes straight to the form. The quiz
   never disqualifies anyone. Answers are attached to the submission and
   re-scored server-side.

## 2.3 Form fields & validation

Fixed field set — campaigns configure visibility/required/order, never invent
fields:

| Field | Rules |
|---|---|
| Full Name | Always visible, always required. Split into first/last on submit. |
| Email | Always visible, **always required** (backend-enforced). Live regex check gates the submit button. |
| Phone | Always visible/required — it is the identity + dedupe key. Fixed "+65" prefix, digits-only input hard-capped at 8, must start 3/6/8/9, displayed "XXXX XXXX". Locked once OTP is pending/verified. |
| Date of Birth | Optional per campaign (visible by default). "DD / MM / YYYY" numeric input auto-inserting slashes; live errors ("Please enter a valid date", "Must be at least {min} years old", "Only available for ages {min}–{max}"), grey age-range hint when valid; re-validated server-side against campaign min/max age. |
| Postal Code | Optional per campaign (visible by default). 6 digits max, numeric. |
| Highest Education | Opt-in per campaign. Select: Secondary School or below / O Levels / Diploma / Degree / Masters and above. |
| Last Drawn Salary | Opt-in per campaign. Select: <$3,000 / $3,000–$4,999 / $5,000–$7,999 / >$8,000. |

Per-field required toggle shows a red `*` (default) or "(optional)" suffix —
except name/email/phone, which are always required (do not offer an optional
toggle for them). A note "All fields marked with * are required." always
renders. Fields can be arranged in rows; two *compact* fields (DOB, postal,
education, salary — never name/email/phone) may share a side-by-side 2-column
row that collapses to one column under 480px viewport width.

## 2.4 Phone OTP (mandatory on every real submission)

- "Verify" button beside the phone field → sends a 6-digit code via the
  campaign's configured channel: **SMS** (default) or **WhatsApp** (falls back
  to SMS on failure). An inline panel (not a modal) slides open: "Enter the
  6-digit code sent via {SMS|WhatsApp} to +65 XXXX XXXX", paste-friendly
  one-time-code input, auto-verifies on the 6th digit, manual Verify button,
  "Edit" cancels and unlocks the phone field, "Resend code" with a 30s
  cooldown countdown.
- States to design: idle → sending → pending → verifying → verified (button
  morphs to a "✓ Verified" badge with a brief success beat, panel collapses)
  → error (wrong code: "Incorrect code. Codes are time-sensitive…"; expiry;
  too-many-attempts; rate-limited with a long cooldown).
- Server facts: codes expire in 10 minutes, 5 attempts per code, single-use,
  send/verify rate-limited per IP. Verification is also a server-side
  precondition for draw entries.

## 2.5 DNC gate (per-campaign toggle "Check Do Not Call at submit")

Only after OTP verifies, the number is checked against Singapore's Do-Not-Call
registry (fail-open on errors; result invisible when clear). If registered: a
consent card appears under the phone field, **all other fields lock** (greyed,
lock icons) and submit disables until the user explicitly consents ("This
number is on Singapore's Do Not Call Registry. To receive {Advertiser}'s offer
and updates about it, please confirm below." → "I consent to be contacted").
Consented state is revocable ("Edit consent"). Cancelling OTP resets the gate.
Design this state to be clear and respectful — the current one is utilitarian.
Server-side, non-consenting DNC-registered leads are silently held for ops
review; **the customer always sees the normal success screen** — never expose
holds.

## 2.6 Consent model — three checkboxes with fixed semantics

Restyle the presentation; do not change logic or defaults:

1. **Contact consent** — default **ticked** (opt-out): consent to be contacted
   via the particulars provided. (Also gates whether hashed email/phone go to
   ad-platform server events.)
2. **Campaign T&C consent** — **required**, default unticked. Label links to a
   terms dialog: campaign-configurable rich HTML (sanitized) or the brand's
   default marketing-consent copy; dialog has Cancel / "I agree" (agree ticks
   the box).
3. **Third-party disclosure consent** — default unticked (opt-in): consent to
   disclose details to a partner financial-advisory representative. This is
   where sponsored-campaign disclosure lives; design it to be understood, not
   skimmed. (Ticking it can route the lead to an external buyer pool —
   invisible to the customer.)

## 2.7 Submit outcomes (state machine is fixed)

Submit button label is configurable (default "Submit Now"); disabled until
OTP verified, T&C ticked, validations pass, DNC gate (if shown) consented.
Sequential inline error messages for missing/invalid inputs. Outcomes:

- **Success (201)** → success screen ("You're all set." class of message) +
  auto-opening **share sheet**: the user's unique referral link (canonical
  short link on the campaign's customer host), Copy with feedback, WhatsApp +
  Telegram share, "We've also sent this link to your email." A referred
  visitor arriving via that link sees a "👋 Referred by {name}" badge above
  the form.
- **Duplicate (409)** — same phone + same campaign → neutral "You have
  already signed up for this campaign." screen with a 5-second countdown that
  auto-opens the same share sheet (their original referral link). Never an
  error tone. One phone may register across different campaigns.
- **Campaign inactive (410)** → "This campaign is no longer active." full-page
  state (also shown on load for inactive campaigns unless in preview).
- **Generic failure** → error state with retry guidance.
- A **confirmation email** is sent automatically (brand, sender, wordmark and
  footer follow the campaign's customerHost; lucky-draw campaigns get a draw
  variant with prize + multiplier). Email templates are fixed — not editable
  in the Studio; do not design an email editor.

## 2.8 Analytics — design for, do not implement

Production fires Meta Pixel + Conversions API and TikTok Pixel + Events API
with shared deduplicated event IDs, captures UTM/click-ids, and supports
per-campaign pixel ID overrides. The taxonomy is fixed:

- `ViewContent` once per session per campaign on page load,
- `CompleteRegistration` on quiz result reveal (quiz campaigns),
- `Lead` **only after a completed, OTP-verified successful submission** — this
  is what ad platforms optimize on; nothing in any layout may imply firing it
  earlier.

Every layout template must preserve a single canonical "campaign viewed"
moment and a single "submitted" moment. Previews and test campaigns suppress
pixels. Deliverable: a one-page note mapping your new layouts/states onto this
taxonomy (no new conversion events).

## 2.9 Non-negotiable furniture in EVERY template

Regulatory footer + brand line, the three consent checkboxes, T&C access, the
required-fields note, gate flows, OTP flow, DNC gate, and the success/
duplicate/inactive/error states. No template may hide, demote below reach, or
restyle these into ambiguity. Templates change composition and personality —
never compliance.

# 3. The current Studio — every knob (your parity floor)

Today: a 380px left panel with five tabs (Content / Design / Layout / Quiz /
Marketplace), a live preview on the right in a fake browser chrome, one manual
Save Design button. Every knob below must exist somewhere in your redesign —
regrouping, renaming, and better metaphors encouraged; dropping anything is
failure. (Server limits shown so you design honest counters/validation.)

**Content:** customer domain toggle (redeem.sg customer brand / mktr.sg
operator brand, with explainer); "Feature on redeem.sg homepage" switch +
drop title (≤40) + value label (≤12, e.g. "FREE", "S$20") + emoji (≤8) +
display cap (1–100000) + homepage end date (display-only — never stops
sign-ups; admin-only); form headline (≤80, default "Get Started"); form
sub-headline (≤150, newlines honored); brand wordmark (≤40, default = host);
hero font (5 options); hero story (≤1200, blank-line paragraphs) + emphasis
line (≤160); header media: none / image upload (JPEG/PNG/GIF/WebP, ~10MB
env-configurable, recommended 1200×600) / video upload (auto-transcoded to
silent web MP4, audio stripped — communicate this!) / YouTube link paste;
hero button label (≤40, only with media); submit button label (≤40);
regulatory footer (≤1000, brand default); brand footer line (≤80, default
"Powered by MKTR"); verification method (SMS / WhatsApp, with a
credentials-required warning for WhatsApp); form-field visibility + required
toggles (phone pinned "Always shown · Required for OTP"); SG/PR-only gate
switch; exclude-financial-consultants switch; DNC-check-at-submit switch;
T&C template picker (Default / Privacy Policy / Marketing Consent) that
stamps a rich-text/HTML terms editor (≤10000).

**Design:** accent theme color — 8 curated swatches + custom hex. (That is
the ENTIRE design tab today. This poverty is a core reason for the revamp.)

**Layout:** form width slider (300–600px, default 400); drag-and-drop field
order editor with merge-into-2-column-row and split, hidden fields shown as
chips. (No templates exist today — you are introducing them.)

**Quiz:** empty state offers "Load starter quiz" (a complete example:
6 weighted questions, 4 persona profiles, readiness %, lead-score bands,
reveal copy) or start blank. Controls: enable toggle; intro headline (≤80) /
subhead (≤160) / start label (≤40); scoring tie-break (prepared-first /
gap-first); readiness-% toggle; Hot/Warm/Cool lead-score toggle; result
profiles add/remove (id, title ≤40, description ≤400, CTA label ≤40, color,
internal "agent angle" ≤80); questions add/remove (prompt ≤140, weight 0–10,
single-select options: label ≤80 → mapped profile, internal tag). Advanced
knobs currently JSON-only (reveal-copy lines, gap template, rarity toggle,
per-option images, score matrices, lead-score points/bands) — surfacing them
properly in UI is an explicit upgrade opportunity.

**Marketplace** (content that syndicates the campaign onto the consumer
marketplace; the marketplace itself is out of scope): URL slug with live
availability check + "locks permanently after first activation"; "List on
the marketplace" switch (admin-only; only effective when slug + active +
redeem.sg host + a live ops activation all hold — today shown as a gate
checklist, keep that pattern); consumer title override (≤120); category
(10 fixed enums: art & creativity, coding & robotics, speech & performance,
sports & movement, music & dance, academic, family & lifestyle, wellness,
dining, financial education); offer type (trial/assessment/workshop/reward/
consultation); mode (physical/online/hybrid); image alt label (≤120); value
line (≤80); inclusions (≤8 × 120); show-remaining-capacity switch; audience
age min/max (display only — distinct from the submitter age gate); school
levels (≤12); DSA-related switch; availability days Mon–Sun + time slots
(≤8, HH:MM); activation requirement (switch, type ≤40, duration 5–240 mins,
summary ≤160, detail ≤600); sponsor disclosure (switch, kind ≤40, disclosure
≤400); data-use note (≤400); cancellation note (≤400); FAQ (≤6 Q&A);
QR scan landing choice (straight to form / offer page first); a composed
read-only consumer preview with ops facts (partner, capacity, expiry, draw
dates) + a draw-date mismatch warning.

**Preview (today):** same-renderer live preview, read-only banner "OTP &
submit disabled", stubbed OTP (any 6-digit code verifies) and submit
("Preview — your details were not submitted."), fake browser chrome showing
the live UNSAVED customer host + URL, forced light theme. No device toggle —
that omission was deliberate honesty (a fake phone frame lies about real CSS
breakpoints); your device preview must render TRUE viewport widths (e.g. a
scaled real-viewport frame), especially the <480px field-row collapse.

**Save:** manual save, dirty dot + "Unsaved changes", disabled-when-clean,
browser-close guard, server-side clamping, admin-only keys preserved on
non-admin saves. v2 rule for you: the editor must round-trip the FULL
document on save (today's partial writes silently drop keys — a real bug
class).

# 4. What to design (the revamp)

## 4.1 Layout template system — the centerpiece

Invent **4–6 genuinely different customer-page layout templates** (not
recolors): e.g. the current warm editorial story page; a full-bleed hero
poster with overlay form; a split-screen (media left / form right on desktop);
a quiz-first funnel that leads with the quiz before revealing anything else;
a minimal high-conversion card for retargeting traffic; a long-scroll
storytelling page for cold traffic. Name them, give each a personality, and
show each with realistic seeded campaigns. Every template must:

- Render entirely from the same `design_config` document (template id +
  per-template parameters + shared content) — deterministic, no freeform
  HTML/CSS, no arbitrary positioning.
- Survive template SWITCHING without content loss: shared content (headline,
  story, media, fields, gates) carries over; template-specific params get
  sensible defaults. Design the switch UX (gallery with live thumbnails
  rendered from the actual current content, not canned screenshots, if you
  can).
- Honor the compliance furniture (§2.9) and the funnel order (§2.2–2.7).
- Be flawless at 320–430px first; desktop is the secondary reading.

## 4.2 Theme system — beyond one accent color

Replace the single accent-color knob with a token-based theme layer: curated
palettes (page background, card, ink, muted, accent — the current locked
warm-cream identity should survive as one preset), font pairings (the five
licensed fonts; propose additions only as a flagged list), corner-radius
personality, background treatments. Keep it curated-first (operators are not
designers — make ugly hard), with an escape hatch for accent hex. Contrast
must be auto-checked (a readable-text-on-accent helper already exists in
prod); flag failing combos inline. Themes must be host-aware: sensible
defaults per redeem.sg / mktr.sg.

## 4.3 AI copy assist — required feature

A first-class "**Write it for me**" capability: the operator types a short
brief (what the campaign is, who it's for, the offer, tone) and the AI
populates **every text field of the current template** — headline, subhead,
story, emphasis, CTA labels, terms intro, quiz intro, even the marketplace
value line — as suggestions.

Ground truth about the backend you're designing against: an admin AI endpoint
pattern already exists (brief in → **schema-validated JSON draft out**,
provider = OpenAI or Anthropic chosen in admin AI settings, ~10 requests/min
rate limit, seconds-long latency, can fail). Design exactly that contract:

- Brief composer (topic, audience, objective, must-include — free text),
  generate action with honest progress (skeleton/streaming feel), rate-limit
  and failure states.
- **Review-then-apply**: generated copy lands as a reviewable proposal
  (per-field or per-section accept / edit / regenerate), never silently
  overwriting operator content. Show old→new clearly. One-click "apply all",
  per-field "keep mine".
- Per-field affordances too: a small "suggest" action on any text field,
  scoped regenerate ("shorter", "more formal", "add urgency").
- Singapore-English output; respects field length limits by construction.
- Deliverable: the exact JSON request/response schema per template, so the
  backend endpoint is mechanical to add.

## 4.4 Preview upgrades

Keep the parity floor (same-renderer live preview of UNSAVED state, read-only
stubbed OTP/submit, browser-chrome URL showing the live customer host). Add:

- **Device width toggle** (mobile ~390 / desktop) rendering true viewport
  widths — no lying frames (§3 Preview note).
- **Funnel state jumper** — jump the preview directly to any state instead of
  clicking through: default view · SG/PR gate + its ineligible card · advisor
  gate + its blocked card · quiz intro / a question / result reveal · OTP
  panel open / verified · DNC consent gate (notice + consented) · T&C dialog ·
  submitting · success + share sheet · duplicate screen · inactive campaign ·
  error state. This is the single biggest QA upgrade you can give operators.
- A "featured drop" card preview (the redeem.sg homepage tile the
  featured-drop fields feed) — it has NO preview today.
- Preview must respect workspace facts (campaign name, min/max age hints,
  draw badge when a draw is configured).

## 4.5 Editor UX

You own the editor paradigm — inspector panels, on-canvas inline editing, a
hybrid — as long as every edit writes a schema key (the JSON document remains
the single source of truth; a JSON/"advanced" view is a nice power-user
touch). Standards: progressive disclosure (defaults simple, depth on demand);
visible section completeness; char counters near limits; admin-only controls
clearly badged; destructive/irreversible things (slug lock after activation)
explained before commit; drag interactions (field order, quiz questions) with
keyboard alternatives; autosave-style *draft* protection may be proposed on
top of manual save, but explicit Save remains the commit gate (saves go live
on active campaigns).

## 4.6 Fix-by-construction (design these problems out)

- Full-document saves — no knob may be lost because a panel forgot to seed it.
- One coherent visibility/required model for all optional fields (today
  DOB/postal are opt-out while education/salary are opt-in, with a legacy
  quirk where they can render but be discarded — your v2 schema should make
  that state unrepresentable; the migration table handles legacy configs).
- Email is required, full stop — don't render an "(optional)" affordance for
  it.
- Honest upload limits and honest video messaging ("audio will be removed —
  pages autoplay muted").
- The DNC gate's advertiser name is currently an unfilled "{Advertiser}"
  placeholder — add a proper "advertiser display name" content field (flag it
  as a proposed new key).
- Launch-readiness visibility: the designer today hides readiness problems
  (e.g. quiz campaign with quiz disabled) until a separate Launch tab —
  surface a readiness/completeness signal inside the Studio.

# 5. Scale, realism, seeding

Seed the prototype with realistic campaigns that exercise everything: a
voucher campaign ("Redeem $10 FairPrice Voucher" — image hero, SG/PR gate,
DNC on, featured drop), a lucky draw ("Tokyo Getaway Lucky Draw" — video
hero, draw badge, boost deadline), a quiz campaign ("No Ceiling Career Quiz"
— quiz-first template, personas), and a minimal no-media campaign. Singapore
context throughout: SGD, +65 8-digit mobiles (start 3/6/8/9), SGT dates,
local names. A handful of staff use the Studio; ~9 active campaigns at a
time; a campaign page sees paid-traffic volumes on mobile.

# 6. Interaction contract — these must WORK in the prototype

1. One JSON document drives editor + preview live; every control round-trips.
2. Template gallery + switching that provably preserves content.
3. Theme presets + custom accent with live contrast validation.
4. Field visibility/required/order editing incl. 2-column merge/split and
   pinned name/email/phone rules.
5. Gate toggles (SG/PR, advisor, DNC) reflected instantly in preview + state
   jumper.
6. Quiz builder: load starter, edit questions/options/profiles/weights,
   toggles for readiness/lead-score; the preview quiz is playable end-to-end
   including the reveal.
7. AI assist fully mocked: brief → latency → schema-shaped suggestions →
   review/apply per field/section → regenerate variants → a visible
   rate-limit state and a failure state.
8. Device toggle + funnel state jumper (every state listed in §4.4).
9. Save lifecycle: dirty dot → saving → "Saved · live" (+ unsaved-changes
   guard note), admin-only badge behavior.
10. Upload flows simulated: image progress, video "processing (audio will be
    removed)" state, replace/remove, YouTube paste with recognition.
11. Marketplace: slug availability check (mock), the publication gate
    checklist recomputing as switches flip, composed consumer preview, slug
    lock explanation.
12. Featured-drop editor with its homepage-card preview.
13. Copy-link / shareable-preview affordances with the save-first semantics
    handled gracefully.

Anything not listed may be static — but label it "static in this prototype",
never silently.

# 7. Hard constraints

- Implementable in React 18 + Vite + Tailwind + Radix/shadcn + Framer Motion
  + dnd-kit; no SSR; no bespoke chart/canvas engines; respects
  prefers-reduced-motion; WCAG 2.2 AA (editor AND customer templates).
- Customer templates: mobile-first, fast (lazy media, no heavy JS), no
  horizontal overflow at 320px, 44px minimum touch targets, form inputs ≥16px
  font (iOS zoom), safe-area aware.
- Editor: desktop-first (1280–1680 primary, tolerable at 1024) — it is a
  professional tool; mobile editing is out of scope.
- Every configurable value keeps today's server limits (lengths/enums/ranges
  in §3) — design the counters/validation to match.
- The funnel contract (§2) is immutable: order, defaults, consent semantics,
  state machine, analytics taxonomy.
- Keep the JSON document as the only editor↔renderer contract; document every
  key you add.

# 8. Deliverables

1. **Interactive prototype**: the Studio (all panels/areas re-imagined) +
   live preview + device toggle + state jumper + AI assist, and the 4–6
   customer-page templates rendered from seeded campaigns (each viewable
   standalone as the customer would see it, mobile + desktop).
2. **Design-system reference**: tokens (light + dark for the editor; theme
   tokens for the page templates), component inventory with variants, with a
   Tailwind/shadcn mapping note per token.
3. **`design_config` v2 schema document**: every key (type, limits, default,
   which template/params consume it), the template + theme + AI extension
   keys, and a **v1→v2 migration mapping table** covering every v1 key in §3
   (including the legacy visibility quirk) so existing campaigns upgrade
   losslessly and the old renderer contract can be reproduced by a pure
   function.
4. **Parity checklist**: every knob in §3 → where it lives in the new UI →
   where it lives in v2 schema. Any knob you consciously relocate or merge,
   note the rationale. Zero rows may be empty.
5. **AI-assist contract**: request/response JSON schemas per template + the
   apply/merge semantics.
6. **Analytics taxonomy note** (§2.8) mapped to the new layouts/states.
7. **Assumptions list**.

# 9. Process

**Phase 1 — Product architecture.** The Studio's information architecture,
the template system model (shared content vs template params), the v2 schema
sketch, and the preview/state-jumper model. Present for review.

**Phase 2 — Design directions.** 2–3 genuinely different directions for (a)
the Studio's visual identity and (b) the template family's range, with one
template concept-rendered in each direction. Recommend one. **Pause for
approval before the full build.**

**Phase 3 — Full build.** Editor + preview + all templates + AI assist +
states. Do not stop after one panel.

**Phase 4 — QA against the parity checklist and §6.** Walk every row; walk
every funnel state on mobile and desktop; keyboard + reduced-motion pass.

**Phase 5 — Handoff.** The schema/migration/parity/AI documents (§8), plus a
short "how a campaign upgrades from v1" narrative.

The bar: an operator with no design skill produces a campaign page in 10
minutes that looks intentionally designed, on-brand, and legally complete —
and an engineer can port the result onto the existing backend without
guessing, because every pixel traces to a documented key in the schema.

---

## Appendix (for us — NOT part of the prompt): pre-existing defects found during the 2026-07-16 audit

Fix these during implementation regardless of the redesign; they're live bugs
in the current designer/runtime. Status updated 2026-07-17 — #1 #2 #4 #6 #7 #8
FIXED in revamp PR 0 (`fix/campaign-designer-live-bugs`, TRACKER B13–B19);
#3 #5 #9 get structural fixes in the revamp PRs.

1. **FIXED (PR 0)** ~~`heroFont` silently dropped on save~~ — `DesignEditor.jsx`'s
   state seed omitted `heroFont`, and the server clamp spreads the incoming
   document wholesale, so any classic-designer save erased a stored non-default
   font. Now conditionally seeded from the stored config.
2. **FIXED (PR 0)** ~~`featuredDrop` not seeded~~ — stored `enabled:true`
   rendered as OFF in the editor; re-toggling ON sent `{enabled:true}` only and
   wiped stored title/valueLabel/emoji/cap/endsAt on admin saves. Now
   conditionally seeded, so toggle edits merge onto the stored object.
3. **DEFERRED to revamp (v2 schema)** — education_level / monthly_income
   visibility semantics disagree: renderer shows them when the key is absent,
   submit discards their values unless `=== true`; legacy configs can render
   selects whose values are thrown away (`FieldRenderer.jsx:137-139` vs
   `CampaignSignupForm.jsx:283-286`). The v2 field model makes the state
   unrepresentable.
4. **FIXED (PR 0)** ~~Video upload copy says "Up to 60MB"~~ — the `/api/uploads/*`
   multer cap is `MAX_UPLOAD_SIZE_MB` (default 10MB). Copy + upload-failure
   toasts now derive from `src/lib/uploadLimits.js`
   (`VITE_MAX_UPLOAD_SIZE_MB`, default 10 — keep in sync with the backend env);
   dead `MAX_FILE_SIZE` entries in the backend env examples replaced.
5. **DEFERRED to revamp (Studio readiness chips)** — Workspace Design tab lacks
   the readiness banner / quiz analytics the legacy `/AdminCampaignDesigner`
   page shows.
6. **FIXED (PR 0)** ~~Dead 429 branch in OTP send~~ — read `err.response?.status`
   but the fetch client sets `err.status`, so the 10-minute cooldown never
   triggered. Fixed in `CampaignSignupForm` (send + check — the limiter is
   shared) and `AcceptInvite`; the idle Verify buttons now honor the cooldown
   (disabled + countdown). Note: the server window is 15 min (10 req) — the
   "wait 10 minutes" copy is unchanged, revisit wording in the Studio funnel.
7. **FIXED (PR 0)** ~~Email can be labelled "(optional)"~~ — while backend +
   submit-button logic require it. Name and email labels now hardcode the
   required asterisk like phone; `requiredFields` only drives the genuinely
   optional fields.
8. **FIXED (PR 0)** ~~DNC gate advertiser renders the literal `{Advertiser}`
   placeholder~~ — `CampaignSignupForm` now threads `campaign.name` (neutral
   "the advertiser" fallback); `DNC_CONSENT_VERSION` bumped to 2026-07-17.
   The `advertiserName` config key lands with the v2 schema (PR 1).
   **Related P0 found by the PR 0 review**: `LeadCapture.handleSubmit` dropped
   `consent_dnc` from the `/prospects` payload, stranding consented
   DNC-registered leads in the held state — also fixed in PR 0.
9. **DEFERRED to revamp (Studio share/preview guards)** — Header Preview button
   uses the last-SAVED customerHost: toggling the domain then previewing
   without saving opens the wrong host (`AdminCampaignWorkspace.jsx:88-115`).
