# ui_status.md — mktr ui build log (singapore-only)

> single source of truth for ui changes only. backend/service changes stay in `backend/project_status_v2.md`.

---

## conventions

1. tone: lower‑case, short, dated blocks.
2. append‑only; do not edit older entries.
3. each entry: timestamp (sgt), summary, changes, acceptance, links.

---

## append entries below

### [2025-09-08 03:25 sgt] — marketing consent modal on lead capture + previews

- summary:
  1. add reusable marketing consent dialog and link it from lead capture form, public live preview, and interactive designer preview
- changes:
  1. `src/components/legal/MarketingConsentDialog.jsx` (new); wired in `src/components/campaigns/CampaignSignupForm.jsx` and `src/components/campaigns/DesignEditor.jsx`
- acceptance:
  1. `/LeadCapture`: click “marketing consent” below submit → dialog opens
  2. `/p/<slug>`: same behavior
  3. admin designer interactive preview: footer link opens dialog
- links:
  - commit: 7c34115

### [2025-09-08 03:32 sgt] — t&c text opens marketing consent dialog

- summary:
  1. make “terms & conditions” clickable to open the marketing consent dialog (same as consent link)
- changes:
  1. `src/components/campaigns/CampaignSignupForm.jsx`, `src/components/campaigns/DesignEditor.jsx`
- acceptance:
  1. clicking “terms & conditions” opens the dialog across capture, preview, and interactive preview
- links:
  - commit: 7549051

### [2025-09-08 03:38 sgt] — darker whatsapp share button (~15%)

- summary:
  1. slightly darken whatsapp share button for contrast
- changes:
  1. `src/pages/LeadCapture.jsx`, `src/pages/public/Preview.jsx` (bg-green-600 / hover:bg-green-700)
- acceptance:
  1. share dialog → whatsapp button appears darker
- links:
  - commit: 2e79ac9

### [2025-09-08 03:50 sgt] — t&c-only footer + mobile-friendly consent dialog

- summary:
  1. show only “terms & conditions” in footer; remove explicit “marketing consent” text
  2. make consent dialog smaller and scrollable, optimized for mobile
- changes:
  1. `src/components/campaigns/CampaignSignupForm.jsx`, `src/components/campaigns/DesignEditor.jsx` (footer copy)
  2. `src/components/legal/MarketingConsentDialog.jsx` (max-w-md/sm, max-h with overflow-y)
- acceptance:
  1. on mobile, T&C link opens a smaller, scrollable dialog
- links:
  - commit: 355438f

### [2025-09-08 22:17 sgt] — share dialog redesign + short links (share-only)

- summary:
  1. redesigned share dialog ui; dynamic title includes campaign name; shortens url for sharing only (tinyurl/is.gd), with automatic fallback to long url.
- changes:
  1. `src/pages/LeadCapture.jsx`, `src/pages/public/Preview.jsx` — ui revamp, shortener logic, refined buttons layout.
- acceptance:
  1. after submitting, dialog title reads “share <campaign> with your friends and family”.
  2. whatsapp/telegram open with short link when available; copy uses short link.
  3. if shortening fails, long link is used transparently.
- links:
  - commit: 240d845

### [2025-09-08 22:40 sgt] — admin short links management page

- summary:
  1. new admin page to list/search short links, view clicks, and extend expiry by +90 days.
- changes:
  1. `src/pages/AdminShortLinks.jsx` (new), route wired in `src/pages/index.jsx` under `/AdminShortLinks`.
- acceptance:
  1. as admin, navigate to `/AdminShortLinks` → see table; clicking “Clicks” shows recent click details; “Extend +90d” updates expiry.
- links:
  - commit: 95a9ca0
