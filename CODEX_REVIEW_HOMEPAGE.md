Read-only review completed. I did not modify files. I could not verify the plan’s live DB count claim (“6 agents, 15 leads”) or ACRA address accuracy from this repo alone; everything below is from source inspection.

**1. Content Audit**

The plan is mostly right about the homepage slop, but §1 does not catch every index-page instance.

Correctly caught:

- Commission claims are present at `src/components/homepage/FeaturesSection.jsx:25-27`, `src/components/homepage/LeadSourcesSection.jsx:61-63`, and `src/components/homepage/PricingSection.jsx:28-30`. Removing/reframing those sections is correct.
- Fleet/vehicle claims are present at `src/components/homepage/FeaturesSection.jsx:6-7`, `src/components/homepage/FeaturesSection.jsx:30-32`, and `src/components/homepage/PricingSection.jsx:43-44`. Removing them is correct.
- Retell/call-bot claims are present at `src/components/homepage/FeaturesSection.jsx:10-12`, `src/components/homepage/LeadSourcesSection.jsx:38-41`, and `src/components/homepage/PricingSection.jsx:28`. Removing them is correct.
- Fabricated stats are present at `src/components/homepage/LeadSourcesSection.jsx:7-16`; the plan correctly removes `SocialProofBar`.
- Fake testimonial is present at `src/components/homepage/TestimonialSection.jsx:20-25`; removing the section is correct.
- Fake pricing is present at `src/components/homepage/PricingSection.jsx:3-52` and rendered from `src/pages/Homepage.jsx:57-58`; removing it is correct.
- Dead `href="#"` links are present at `src/components/homepage/FooterSection.jsx:28-29`, `src/components/homepage/FooterSection.jsx:35`, and `src/components/homepage/FooterSection.jsx:37`; removing them is correct.
- `/LeadCapture` homepage links are present at `src/components/homepage/HeroSection.jsx:41-42` and `src/components/homepage/FooterSection.jsx:21`; removing them is correct.
- `/AdminDashboard` CTAs are present at `src/components/homepage/HeroSection.jsx:37-38`, `src/components/homepage/PricingSection.jsx:84-85`, `src/components/homepage/CTASection.jsx:8-12`, and `src/components/homepage/AnnouncementModal.jsx:34-36`; removing them is correct.

Misses / under-specified items:

- **blocker** — §1 misses the header’s anonymous `/AdminDashboard` CTAs, even though `SiteHeader` is rendered on the index page at `src/pages/Homepage.jsx:53`. Desktop CTA points to `/AdminDashboard` at `src/components/layout/SiteHeader.jsx:93-98`; mobile CTA does the same at `src/components/layout/SiteHeader.jsx:195-200`. §4.1 catches this later, but the remove-list audit is incomplete. Fix: replace both with a same-page waitlist anchor/button and leave only `Log In` for staff.
- **blocker** — §1/§4.8 miss the footer “Dashboard” anonymous link to `/AdminDashboard` at `src/components/homepage/FooterSection.jsx:21-22`. The plan removes “Lead Capture” but not “Dashboard”. Fix: remove `Dashboard` from the public footer or make it a low-emphasis staff login link, not a marketing CTA.
- **should-fix** — The plan catches “Join hundreds…” at `src/components/homepage/CTASection.jsx:24-26` but misses another fabricated stat in the same section: “Ready to 3x Your Pipeline?” at `src/components/homepage/CTASection.jsx:20-23`. Fix: rewrite the CTA heading with no numeric performance claim.
- **should-fix** — The plan’s acceptance criteria ban “conversion rate”, but §1 misses “conversion rates” in `src/components/homepage/FeaturesSection.jsx:20-22`. Fix: change to “lead sources, response times, and campaign performance” or similar non-fabricated wording.
- **should-fix** — If the intent is to remove all AI/voice posture until launch, §1 misses generic AI copy outside the named Retell/call-bot lines: hero eyebrow `AI-Powered Lead Generation` at `src/components/homepage/HeroSection.jsx:21-23`, hero subtitle “with AI” at `src/components/homepage/HeroSection.jsx:31-34`, “Our AI handles…” at `src/components/homepage/LeadSourcesSection.jsx:29-30`, and footer “AI-powered” at `src/components/homepage/FooterSection.jsx:13-15`. Fix: remove AI positioning from all index/header/footer copy unless it is a true currently shipped claim.
- **should-fix** — `property agents` is correctly identified at `src/components/homepage/FooterSection.jsx:13-16`, but note this footer is shared beyond the homepage through `MarketingLayout` (`src/components/layout/MarketingLayout.jsx:3`, `src/components/layout/MarketingLayout.jsx:47`). Fixing it affects sibling pages and redeem `/Contact`, not just the index.

**2. Routing / Brand Isolation**

The route gates do stop the sibling marketing pages from rendering, but navigation, sitemap, and shared layout still need work.

Correct:

- `/` renders `Homepage` only when `brand.showHomepage` is true; otherwise it renders `RedeemPlaceholder` for redeem builds or `LeadCapture` for non-redeem builds at `src/pages/index.jsx:97-99`.
- `/Homepage` is gated by `brand.showHomepage` at `src/pages/index.jsx:111-112`.
- `/features`, `/pricing`, and `/about` are gated by `brand.showFeatures`, `brand.showPricing`, and `brand.showAbout` at `src/pages/index.jsx:113-115`.
- Current MKTR config has all four enabled at `src/lib/brandConfigs/mktr.js:18-22`; flipping those booleans will make those routes render `NotFoundForBrand`.
- Redeem config has `showAbout`, `showFeatures`, `showPricing`, and `showHomepage` all false at `src/lib/brandConfigs/redeem.js:19-23`, so the homepage route does not render for redeem.
- Brand config selection is build-time via `@brand-config`; `src/lib/brand.js:9-15` explains the alias, and `vite.config.js:9-15` resolves it to the active brand config.

Findings:

- **blocker** — The header nav is not brand-gated. `SiteHeader` hardcodes `/features`, `/pricing`, `/about`, `/Contact` at `src/components/layout/SiteHeader.jsx:9-14`. If `showFeatures:false` or `showAbout:false` is used as the interim mitigation, the nav can still link visitors to 404s. Fix: derive nav links from `brand.show*` or switch “How it works” to `/#how-it-works`; do not leave `/features` when `showFeatures:false`.
- **should-fix** — The route gates do not update SEO. `vite.config.js:38-40` hardcodes MKTR sitemap routes as `/features`, `/pricing`, and `/about` regardless of the brand config flags. If pricing/features/about are hidden, the sitemap will still advertise them. Fix: build sitemap routes from the active brand config or remove hidden routes manually.
- **should-fix** — `Homepage` probably does not render in redeem, but homepage/shared components can still leak into redeem surfaces. `/Contact` is ungated at `src/pages/index.jsx:116`; `Contact` uses `MarketingLayout` at `src/pages/Contact.jsx:13` and `src/pages/Contact.jsx:67`; `MarketingLayout` renders `SiteHeader` and `FooterSection` at `src/components/layout/MarketingLayout.jsx:2-3` and `src/components/layout/MarketingLayout.jsx:43-47`. So redeem `/Contact` can show MKTR marketing header/footer content even though the homepage itself is hidden. Fix: brand-gate `/Contact` if it is MKTR-only, or make `SiteHeader`/`FooterSection` brand-aware.
- **nice-to-have / bundle risk** — `MarketingLayout` imports `FooterSection` and `FloatingElements` from the homepage barrel at `src/components/layout/MarketingLayout.jsx:3`; that barrel re-exports every homepage section at `src/components/homepage/index.js:4-12`. Production tree-shaking may remove unused re-exports, but this is a poor isolation boundary. Fix: import `FooterSection` and `FloatingElements` directly, or split shared marketing layout components out of `components/homepage`.

**3. Waitlist Endpoint**

Option A is the right direction. Option B is weaker and currently invalid unless the contact schema is changed.

Evidence:

- `/api/contact` is mounted by route metadata at `backend/src/routes/contact.js:6-10`.
- Contact rate limit is 5 submissions/minute at `backend/src/routes/contact.js:15-22`.
- Joi requires `name`, `email`, and `message`, with `message` min length 10 at `backend/src/routes/contact.js:24-33`.
- `userType` only accepts `advertiser`, `phv_driver`, `fleet_owner`, or `salesperson` at `backend/src/routes/contact.js:29-31`.
- The controller returns 200 success even when email was not sent at `backend/src/controllers/contactController.js:7-14`.
- `sendEmail` returns `{ success:false }` without sending when SMTP is unconfigured at `backend/src/services/mailer.js:53-58`; `processContactSubmission` reduces that to `{ sent: result.success }` at `backend/src/services/contactService.js:81-93`.

Findings:

- **blocker** — Option B as written is not valid if it sends `userType:"waitlist"`. Joi rejects that value because the valid set is only `advertiser`, `phv_driver`, `fleet_owner`, `salesperson` at `backend/src/routes/contact.js:29-31`. Email-only is also rejected because `name` and `message` are required at `backend/src/routes/contact.js:24-33`. Fix: do not use Option B unless the schema is deliberately changed; prefer Option A.
- **blocker** — Option B inherits the false-success footgun. The UI could say “you’re on the list” while SMTP is unconfigured, because the controller returns success when `sent` is false at `backend/src/controllers/contactController.js:9-12`, and there is no persistence. Fix: avoid email-only waitlist capture.
- **should-fix** — Option A avoids false success only if persistence is authoritative. If the waitlist inserts into DB first, then an unconfigured mailer is only a notification failure, not a signup failure. Fix: return success only after insert/upsert succeeds; log notification failure separately; do not make email delivery the source of truth.
- **should-fix** — The plan says to register in `backend/src/routes/index.js`, but this backend auto-discovers route files with `meta` exports. `loadRoutes` reads route files at `backend/src/routes/index.js:21-31` and mounts their `meta.path` at `backend/src/routes/index.js:40-54`. Fix: add `backend/src/routes/waitlist.js` with `export const meta = { path: '/api/waitlist' }`; no manual route table edit should be needed.
- **should-fix** — A new Sequelize model will auto-load from `backend/src/models/index.js:9-21`, but named exports are explicitly destructured at `backend/src/models/index.js:180-190`. Fix: add `WaitlistSignup` to the named exports if services import it by name.
- **should-fix** — Production schema needs a migration. Migrations are discovered from `backend/src/database/migrations` at `backend/src/database/runMigrations.js:8-10` and executed during bootstrap at `backend/src/database/bootstrap.js:32-34`. Fix: add a numbered migration creating `waitlist_signups`.
- **should-fix** — PDPA and abuse handling are not fully specified. Fix: normalize/lowercase email, unique index on normalized email, idempotent duplicate response, `source`/IP/user-agent if needed with retention policy, rate limit similar to contact, consent text linking `/personal-data-policy`, and avoid returning “already exists” in a way that enables email enumeration.

Also: existing `Contact.jsx` is already inconsistent with the backend. It sends `apiClient.post("/contact", formData)` at `src/pages/Contact.jsx:38-40`, but its dropdown includes `insurance_agent`, `property_agent`, `financial_advisor`, `agency_manager`, `fleet_owner`, and `other` at `src/pages/Contact.jsx:219-224`; most of those fail the backend Joi valid set at `backend/src/routes/contact.js:29-31`.

**4. Deletion / Broken-Import Safety**

- **blocker** — `Homepage.jsx` imports and renders the removable sections at `src/pages/Homepage.jsx:4-14` and `src/pages/Homepage.jsx:57-61`. Fix: remove `TestimonialSection`, `PricingSection`, and `AnnouncementModal` from both the import list and JSX.
- **blocker** — The homepage barrel re-exports the removable files at `src/components/homepage/index.js:4`, `src/components/homepage/index.js:9`, and `src/components/homepage/index.js:10`. If the files are deleted but these exports remain, the build breaks. Fix: delete those export lines when deleting the files.
- **should-fix** — Leaving the files unused will probably build after `Homepage.jsx` stops importing them, because grep found no other direct importers except the barrel and `Homepage.jsx`. However, the plan’s acceptance grep scans all of `src/components/homepage/`, so leaving stale files will still fail because `PricingSection`, `TestimonialSection`, and `AnnouncementModal` contain banned text. Fix: delete or rewrite unused files, and clean the barrel.
- **should-fix** — Do not delete `FooterSection` casually. It is used by the shared marketing layout at `src/components/layout/MarketingLayout.jsx:3` and `src/components/layout/MarketingLayout.jsx:47`, not just `Homepage.jsx`. Fix: rewrite `FooterSection` safely or split a homepage-specific footer from a shared footer.

**5. Risk & Omissions**

- **should-fix** — CSS dead code is real and more extensive than “likely”. Pricing/testimonial/proof/CTA styles exist in `src/pages/Homepage.css`, including proof styles at `src/pages/Homepage.css:190-215`, testimonial styles at `src/pages/Homepage.css:399-465`, pricing styles at `src/pages/Homepage.css:475-596`, and CTA/email styles at `src/pages/Homepage.css:601-671`. Fix: clean or rename after the component rewrite; otherwise future maintainers will keep dead marketing surface area around.
- **blocker** — Public Contact remains slop if nav keeps it. Contact page says “500-person team” at `src/pages/Contact.jsx:77-80`, exposes `Property Agent` and `Fleet Owner` at `src/pages/Contact.jsx:219-224`, and has backend validator mismatch as above. Fix: either rewrite Contact now, hide Contact from the homepage header/footer, or keep only a direct email/WhatsApp link until Contact is cleaned.
- **should-fix** — Legacy PHV roles remain in the contact pipeline: `phv_driver` and `fleet_owner` are valid in Joi at `backend/src/routes/contact.js:29-31`, and email labels render “PHV Driver” / “Fleet Owner” at `backend/src/services/contactService.js:3-8`. Fix when Contact is rewritten, or do not expose Contact from the new homepage.
- **should-fix** — SEO/meta is under-accounted for. `index.html` has only `%VITE_PAGE_TITLE%` and canonical at `index.html:7-8`, with no meta description. MKTR title defaults to generic “MKTR Marketing Platform” at `vite.config.js:21-25` and `src/lib/brandConfigs/mktr.js:15`. Fix title/description/canonical for the new positioning, and update sitemap routes as above.
- **should-fix** — Cutover redirects are not verifiable from checked-in deployment config. The SPA itself renders `/Homepage` when `showHomepage` is true at `src/pages/index.jsx:111-112`, and `/` renders `Homepage` when `showHomepage` is true at `src/pages/index.jsx:97-99`. `CLAUDE.md` documents that `/Homepage` and `/` redirects were removed and only lead-capture paths redirect (`CLAUDE.md:21-34`), but there is no Render config in the repo. Fix: verify Render static-site redirect rules before launch; do not assume `/LeadCapture` or apex behavior from SPA code alone.
- **nice-to-have** — Analytics/Meta Pixel is not currently bound to homepage CTAs. Meta base loader exists in `index.html:10-24`, but actual tracking is restricted to `/LeadCapture` by `shouldTrack` at `src/lib/metaPixel.js:24-45`, and `trackLead` is fired from `src/pages/LeadCapture.jsx:222-240`. Fix: decide whether waitlist submit should fire a separate event such as `Subscribe` or first-party analytics; do not accidentally reuse LeadCapture conversion semantics.
- **should-fix** — Waitlist form accessibility is unspecified. The existing CTA email input relies on placeholder text only at `src/components/homepage/CTASection.jsx:31-34`; no visible label or `aria-label` is present. Fix: add a real `<label>`, clear error/success status with `aria-live`, disabled/loading state, keyboard-safe submission, and privacy/consent helper text.
- **should-fix** — “Exclusive leads” is not proven by code. The plan flags this as open, correctly. Fix: do not ship that claim until business rules confirm leads are not resold.

**Recommendation**

NO-GO on implementing the plan exactly as written. The direction is right, but the implementation brief misses enough public-surface and backend details that it could still ship broken links, 404 nav, sitemap lies, a false-success waitlist, or MKTR slop on redeem/contact surfaces.

Top 3 fixes before building:

1. Define the full public-surface cut: header nav, footer links, Contact exposure, brand gates, and sitemap must agree.
2. Use Option A for waitlist with DB persistence, rate limiting, duplicate handling, PDPA consent, and success based on insert/upsert, not email delivery.
3. Delete or rewrite stale homepage files and barrel exports so banned content is gone from `src/components/homepage/`, not merely unrendered.