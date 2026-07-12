---
name: verify
description: Build/launch/drive recipe for verifying mktr-platform frontend changes end-to-end (both brands) with Playwright.
---

# Verifying frontend changes (mktr-platform SPA)

One React/Vite SPA builds into multiple brands via `VITE_BRAND`. A change must be
verified on the brand(s) whose routes it touches, and regression-checked on the other.

## Build + serve

```bash
VITE_BRAND=redeem npx vite build                      # → dist/ (redeem.sg build)
VITE_BRAND=mktr   npx vite build --outDir dist-mktr   # → dist-mktr/ (mktr.sg build)
npx vite preview --port 4317 --strictPort                       # serves dist/
npx vite preview --port 4318 --strictPort --outDir dist-mktr    # serves dist-mktr/
```

`vite preview` has SPA history fallback, so client routes work. There is no local
backend: pages that call `/api/*` hit `https://api.mktr.sg` cross-origin and get
**CORS-blocked — that console noise is environment, not a bug** (e.g. LeadCapture's
`/analytics/events`, `/qrcodes/session`). Judge console cleanliness per-page.

## Drive it

Playwright is in `node_modules` (no browsers downloaded) — launch the system Chrome:

```js
import { chromium } from '<repo>/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
```

Scripts living outside the repo (scratchpad) must import playwright by absolute path.

Worth checking every time:
- apex `/` renders the right brand surface (redeem → RedeemHome; mktr → Homepage —
  note Homepage plays a ~5s typewriter intro before content appears, so wait past
  `networkidle` before asserting/screenshotting)
- brand route gates hold: `/pricing` etc. 404 on redeem, work on mktr
- `/LeadCapture` still mounts on both brands
- mobile viewport (390×844) has no horizontal overflow:
  `document.documentElement.scrollWidth - clientWidth <= 1`
- no RedeemHome chunk fetched on the mktr apex (capture `page.on('request')`)

## Gotchas

- `src/pages/redeemHome.css` resets `.rh-page a { color: inherit }` (0,1,1) —
  any new anchor-button variant needs a `.rh-page a.rh-*` override or its color loses.
- Raw `chrome --headless --screenshot --window-size=420,...` clamps to ~500px window
  and crops — use Playwright viewports for narrow-screen checks, never the Chrome CLI.
- Redeem homepage content (drops/FAQ/marquee) lives in `src/pages/redeemHomeContent.js`;
  to exercise the live-drop path, temporarily set `status: 'live'` + a `claimUrl`,
  rebuild, and revert.
