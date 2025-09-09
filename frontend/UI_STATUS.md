## [2025-09-09] Notification bell

- Added `NotificationBell` in `src/components/layout/NotificationBell.jsx` showing role-based notifications (user signup, lead captured, QR scanned).
- Replaced static bell in `src/components/layout/DashboardLayout.jsx` header with dropdown bell.
- Uses `/api/notifications` endpoint; polls every 30s.

# ui_status.md — mktr ui build log (singapore-only)

> single source of truth for ui changes only. backend/service changes stay in `backend/project_status_v2.md`.

---

## conventions

1. tone: lower‑case, short, dated blocks.
2. append‑only; do not edit older entries.
3. each entry: timestamp (sgt), summary, changes, acceptance, links.

---

## append entries below

### [2025-09-09 14:05 sgt] — lead capture: label tweak on duplicate dialog

- summary:
  1. change button label from “Open Share Now” to “Share Now” in the unsuccessful (duplicate signup) dialog.
- changes:
  1. `src/pages/LeadCapture.jsx` — update button text.
- acceptance:
  1. trigger duplicate signup → dialog shows “Share Now”.
- links:
  - commit: n/a

### [2025-09-09 12:55 sgt] — admin prospects: mobile responsiveness

- summary:
  1. make prospects table clean on mobile by switching table layout to `table-auto` on small screens and hiding less-critical columns; ensure status/date don’t wrap and names truncate.
- changes:
  1. `src/components/ui/table.jsx` — responsive class `table-auto md:table-fixed`.
  2. `src/pages/AdminProspects.jsx` — hide `Contact` (sm+), `Assigned To` (md+), `Source` (md+), `Actions` (sm+); add `whitespace-nowrap` and `truncate` where needed.
- acceptance:
  1. open `/AdminProspects` on a phone viewport (~375px): headers align without overlapping; only columns shown are Prospect, Campaign, Status, Created; row action eye icon hidden but tapping a row is not required; details still accessible from larger screens.
  2. on tablet/desktop, all columns reappear.
- links:
  - commit: n/a

### [2025-09-08 23:45 sgt] — admin campaigns ui redesign

- summary:
  1. improved admin campaign management page with tabs (active/archived), search + status filter, list/grid toggle, quick stats, and consolidated actions menu.
- changes:
  1. `src/pages/AdminCampaigns.jsx` — add tabs, filters, grid/list views, dropdown actions; refine empty states.
- acceptance:
  1. open `/AdminCampaigns` as admin → see quick stats and controls.
  2. search by name filters results instantly; status filter toggles active/inactive.
  3. switch between list and grid view; actions available via "more" menu.
  4. archived tab shows restore/delete controls.
- links:
  - commit: n/a

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

### [2025-09-08 23:07 sgt] — admin sidebar: add “short links” item

- summary:
  1. add a left-nav item “short links” for admins pointing to `/AdminShortLinks`.
- changes:
  1. `src/components/layout/DashboardLayout.jsx`: add menu item under admin section with `Link2` icon.
- acceptance:
  1. login as admin → sidebar shows “short links”; clicking navigates to the management page.
- links:
  - commit: 0e924fa

### [2025-09-08 23:58 sgt] — admin users ui enhancements

- summary:
  1. improved admin users page with quick stats, lifecycle tabs (all/pending approval/pending registration/active/inactive), list/grid toggle, consolidated row actions, and csv export.
- changes:
  1. `src/pages/AdminUsers.jsx` — add tabs, quick stats, grid/list views, dropdown actions, export csv.
- acceptance:
  1. open `/AdminUsers` → see stats; switch tabs and views; actions via kebab menu.
  2. click Export CSV downloads current filtered/visible users.
- links:
  - commit: n/a

### [2025-09-09 13:05 sgt] — lead capture: open share dialog on duplicate signup

- summary:
  1. when a phone has already signed up for the same campaign, show the existing share dialog instead of an error with a back button.
- changes:
  1. `src/pages/LeadCapture.jsx` — detect 409 duplicate message ("already signed up for this campaign") during submit and set `submitted=true` + `shareOpen=true`.
- acceptance:
  1. submit once → share dialog opens as usual.
  2. submit again with the same phone for the same campaign → share dialog opens (no error back button).
- links:
  - commit: n/a

### [2025-01-27 14:30 sgt] — admin prospects: add delete buttons to every row

- summary:
  1. add delete buttons to every row in admin prospects table for both desktop and mobile views, with confirmation dialog.
- changes:
  1. `src/pages/AdminProspects.jsx` — add delete button with trash icon to each table row, confirmation dialog, delete handler function, and state management for delete confirmation.
- acceptance:
  1. open `/AdminProspects` as admin → see red trash icon button in each row.
  2. click delete button → confirmation dialog opens with prospect name.
  3. confirm deletion → prospect is removed from list and data refreshes.
  4. works on both desktop table view and mobile card view.
- links:
  - commit: n/a
