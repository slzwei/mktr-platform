# Campaign Studio — layout × colour-preset audit (2026-07-22)

Audit of **all 11 v2 page layouts × all 10 curated colour presets** (110
combinations), plus the reused signup funnel that every layout embeds.

> Scope note: `main` locally was 23 commits behind. The five new layouts landed
> in **PR #226** (`3a7e3a5`). This audit is against `origin/main` @ `a198bc3`.

## Headline

**The five new draw layouts (Postcard, Gazette, Nightfall, Stub, Checklist) do
not respond to the colour presets at all — and the form inside them does.**

That split is the whole bug. PR #226 deliberately art-directed the five new
templates with *"fixed neutral palettes + the campaign theme's accent"*. But the
embedded funnel is still themed from the **preset** via
`buildFunnelTokens(resolveTheme(doc.theme))`. So one page ends up painted from
two different palettes that never agree:

- template chrome → a **fixed** neutral (cream, paper, or near-black)
- form text/labels → the **preset's** `ink` / `bodyText` / `muted`

Pick a dark preset and the form's near-white text lands on the template's
hardcoded light card. **The form goes invisible.**

### Proof — distinct page backgrounds rendered across the 10 presets

Measured with `getComputedStyle()` on the real renderer, 390px viewport:

| layout | distinct backgrounds / 10 | |
|---|---|---|
| editorial | **10** | follows the preset |
| poster | **10** | follows the preset |
| postcard | **1** | ignores it — always `rgb(246,244,238)` |
| gazette | **1** | ignores it — always `rgb(251,247,238)` |
| nightfall | **1** | ignores it — always `rgb(20,22,31)` |
| stub | **1** | ignores it — always `rgb(239,235,224)` |
| checklist | **1** | ignores it — always `rgb(255,255,255)` |

And on every one of the five, the funnel input still reports
`color: rgb(242,242,239)` (graphite's ink) on `background: rgb(255,252,246)`.

### Why nothing caught it

- PR #226 shipped **22 new tests** — all structural (does the prize chip render,
  does the CTA open the sheet). **None asserts a colour or a preset.**
- `PagePanel.jsx:345` does note *"Draw-focused template — art-directed neutrals
  with the theme accent."* — but the **Theme panel has no such warning**. It
  presents all 10 presets as live choices with full-colour swatches. The
  operator picks Graphite, the swatch highlights, and the page does not change.
- PR #226 called itself "dormant on merge — no existing campaign references the
  new template ids". That is **no longer true**: see production exposure below.

---

## The five new layouts, one by one

Screenshots: `scratchpad/sheets-new/sheet-<template>.png` (10 presets each).

### Checklist — BLOCKER on the 3 dark presets
Page is hardcoded `#FFFFFF`. On graphite / ink-lime / violet-hour the form
headline, every field label, the intro copy and the consent line render in the
preset's near-white ink **on white**. This is exactly the ghosted form in the
reported screenshot. **Reproduced identically.**

### Gazette — BLOCKER on the 3 dark presets
Page is hardcoded `#FBF7EE`. Same failure. The upper fact table (PRIZE / CLOSES /
ENTRY / BOOST) uses hardcoded dark ink so it stays readable — meaning the top
half of the page looks *identical* on all 10 presets while the bottom half
breaks on 3 of them.

### Postcard — BLOCKER on the 3 dark presets
Page is hardcoded `#F6F4EE`. Same failure inside the floating card.

### Stub — BLOCKER on the 3 dark presets
Ticket body is hardcoded `#EFEBE0`. Same failure across the whole stub.

### Nightfall — the inverse: MAJOR on all 7 light presets
Page is hardcoded `#141614` near-black on every preset. An operator choosing
Warm Cream, Paper White, Kopi, Botanic, Peranakan, Straits Teal or Tangerine
gets a fully dark page; only the CTA changes colour. Not a legibility failure —
the template is internally consistent and the CTA-revealed form sheet carries its
own light surface — but the preset is decorative.
*(Verified the CTA reveal works: 0 visible inputs before click → 6 after.)*

### Cross-cutting on all five
`content.headline` is painted by the layout **and** again by the form (the
funnel receives the same string as `formHeadline` via `funnelAdapter.js:43`), so
the headline renders twice on every draw template. With empty content both
default to `'Get Started'` — the doubled "Get Started" visible in the report.

---

## Pre-existing: the original 6 layouts + the shared funnel

These are **separate from** the new-layout problem and were already live. Full
contrast run: 300 pairs across 10 presets → 87 FAIL / 33 WARN.

### Blockers in the shared funnel (hit all 11 layouts)

| # | What | Where | Effect |
|---|---|---|---|
| B1 | Input fill hardcoded `#FFFCF6` with `color: TOKENS.ink` | `FieldRenderer.jsx:39-40` | Typed text **1.07–1.10:1** on the 3 dark presets — invisible. `inputBg` is never emitted by `buildFunnelTokens()`, so the `\|\|` fallback always wins. |
| B2 | OTP code field `backgroundColor: '#ffffff'` | `OTPVerification.jsx:165-166` | The 6-digit code is invisible on dark presets — verification cannot complete. Panel at `:97` (`#FFFCF6`) hides its helper text, phone number, Edit and Resend too. |
| B3 | `'#ffffff'` + `color: TOKENS.body` buttons | `CampaignSignupForm.jsx:555` (SG/PR "No"), `:692` (advisor "Yes"), `MarketingConsentDialog.jsx:106` ("Cancel") | **1.03:1** on dark presets — blank white pills. These gates are the *first* screen of a gated campaign. |
| B4 | `readableTextOn(TOKENS.hairline)` | `FieldRenderer.jsx:275-276` | `contrast.js` parses hex only; 9/10 presets have an `rgba()` hairline → returns `#ffffff`. Disabled "Verify"/"Wait 9:59" is white on ~`#E6E6E6` (**1.27:1**) on 6 light presets. Verified at runtime. |
| B5 | Outcome screens never call `useCampaignTheme()` | `LeadCaptureOutcomes.jsx:5, 40, 53` | "You're all set." is `#3D1F0B` on `#2C2E33` = **1.15:1**. The confirmation screen is unreadable on dark presets. `:140` also hardcodes a terracotta CTA on all 9 non-warm presets. |
| B6 | Poster hero: `#FFF` over a fade ending at `t.bg` | `templates.jsx:200, 206, 216, 220` | Default `overlay: 'dusk'` sets `fade = t.bg`. Headline **1.05–1.33:1** on the 7 light presets; unreadable with no media. |
| B7 | Consent tick `stroke="#ffffff"` on `accent` | `CampaignSignupForm.jsx:1038` | ~1.8:1 on ink-lime/violet-hour. User cannot tell whether the **required** T&C box is ticked. `onAccent` already holds the right value; `ConsentCheckbox:1000` never reads it. |

### Systemic root causes

1. `buildFunnelTokens()` (`themeContext.jsx:53-83`) emits no input surface — no `inputBg`.
2. `danger` `#B4443C` / `success` `#2F6B43` are preset-blind (`designConfigV2.js:559-560`) → 1.93–2.75:1 on dark cards. The "Verified" badge is unreadable.
3. `line`/`hairline` is an `rgba()` string on 9/10 presets, used both as a *fill* and fed to a hex-only parser.
4. `onColor()` falls back to `#3D1F0B` — warm-cream's ink — so all 3 dark presets get warm-brown button labels.
5. Three components never consume the theme: `LeadCaptureOutcomes`, `DncConsentGate` (a cream/sage card that *locks the form*), `ShareCampaignDialog` (paints from the app-global Tailwind palette).
6. No `-webkit-autofill` rule anywhere in `src/` — Chrome repaints autofilled fields pale-blue via `!important`. Any B1 fix must ship with one.
7. No `color-scheme: dark` on the campaign root — native selects, caret and scrollbars stay light on dark presets.

### Original-6 layout notes
- **Split / Poster**: hardcoded `#17181B` media panel — an empty black slab when there is no media, on every preset.
- **Spotlight**: uses `t.muted` for *body* paragraphs → 2.86:1 on warm-cream.
- **Journey**: step numerals are `t.accent` on a `t.soft` band → 2.36:1 warm-cream; the band vanishes on dark presets. Renders the headline three times.
- **Editorial / Express**: cleanest — only themed tokens.

---

## Production exposure (checked live, `campaigns` table)

| campaign | template | preset | risk |
|---|---|---|---|
| Redeem $20 NTUC Fairprice Vouchers | editorial | **violet-hour** (dark) | **B1 live** — typed text invisible in every field |
| Tokyo Getaway Lucky Draw | **checklist** | paper-white | safe by luck — light preset on a light fixed template |
| Free Pet Hotel 1 Night Trial | poster | tangerine | B6 — white hero copy over a light fade |
| Redeem $10 Fairprice Voucher | editorial | tangerine | funnel blockers only |
| [Retell] Luggage | editorial | warm-cream | parity baseline, fine |

The NTUC campaign is **active and taking leads on a dark preset today.**

---

## Fixes applied — branch `fix/studio-preset-theming`

### Token layer (`designConfigV2.js` twins, backend first)
New derived tokens on `resolveTheme()`, plus `mixHex()` and `accentTextOn()`:

| token | why |
|---|---|
| `inputBg` | opaque input fill that tracks the theme. `mixHex(card,'#FFFFFF',.4)` reproduces warm-cream's frozen `#FFFCF6` **byte-exactly**; dark presets lift off the card instead. |
| `disabledBg` / `onDisabled` | disabled control fill + label. `hairline` was being used as a fill *and* fed to a hex-only contrast helper that returned white for the 9 presets whose hairline is `rgba()`. |
| `accentText` | the accent stepped until it is legible as TEXT on the card — lime/periwinkle accents were 1.8:1. |
| `danger` / `success` | now surface-aware; the light pair sat at ~2:1 on dark cards. |

Measured after (was 1.07–1.10:1 on the three dark presets):

```
preset        inputBg   ink-on-input   danger-on-card  success-on-card  accentText-on-card
warm-cream    #FFFCF6      14.66            5.67            3.49              4.89
graphite      #3D3F43       9.41            6.03            7.46              5.15
ink-lime      #373831      10.83            6.69            8.28              8.18
violet-hour   #4A3F66       8.46            5.44            6.72              9.09
```

### Funnel
`buildFunnelTokens` now emits the new tokens (`DEFAULT_CAMPAIGN_THEME` deliberately does **not**, so unprovidered v1 mounts keep falling back to their original literals). Fixed: input + OTP fills (B1/B2), screening-gate and Cancel buttons (B3), disabled Verify/Submit (B4), outcome screens now consume the theme (B5), consent tick uses `onAccent` (B7), accent-derived button glow, and a root `<style>` supplying the previously absent `-webkit-autofill` and `::placeholder` rules plus `color-scheme`.

### Original six templates
Poster's hero copy now follows `onColor(t.bg)` so it stays legible wherever the dusk gradient lands (B6); Split/Poster media backdrops follow the preset; Spotlight body copy moved from `muted` to `bodyText`; Journey numerals use `accentTextOn`.

### The five draw layouts — light/dark twins
`drawTemplates.jsx` gains `PALETTES` (5 templates × light/dark) and an exported
`drawPalette(id, t)` resolver; each template shadows its own palette name so the
~100 existing `PC.x`/`GZ.x`/… references are untouched. The shared helpers
(`Perforation`, `StubHeader`, `ChecklistHeader`, `GazetteMasthead`,
`ChancesRow`, `NextSteps`) now take their colours as props, and both the success
and closed-page `chrome` tables resolve from `pal`. Every `#fff` that hosts the
funnel or a card became `pal.card` — that is the fix for the invisible form.

Accent handling: every `#fff` on an accent fill became `t.onAccent`; every
accent-coloured *text* node became `accentTextOn(accent, <its surface>)`.
Two unconditional AA failures that had nothing to do with theming were also
fixed — Gazette's gold (2.39:1) and Checklist's `#8B8477` mono captions (3.28:1).

Light presets are byte-identical except where an accent genuinely failed AA.
**Nightfall is the exception**: its existing palette *was* the dark variant, so
it now flips to a light body on light presets while keeping its dark hero plate
(pinned to `NF_HERO`, since the hero scrims are translucent over the page).

Measured after — form headline + field labels, 5 draw templates × 6 presets,
30 combinations: **worst case 10.49:1** (was 1.02–1.13:1 on the dark presets).

### Result
Contrast matrix **87 FAIL → 30 FAIL**. All 30 remaining are decorative card hairlines at 1.25–1.56:1 — the frozen v1 baseline is 1.36:1, and they are card edges, not control boundaries. Full suite **1715/1715**, including the frozen warm-cream parity and twin-lockstep tests.

## Reproducing

Worktree `audit/studio-theme-matrix` @ `origin/main`, harness
`theme-audit.html` + `src/dev/themeAudit.jsx` (uncommitted).
`npx vite --port 5199`, then
`theme-audit.html?template=<id>&preset=<id>&media=0|1&jump=<state>`.
Drivers (`shoot.mjs`, `probe.mjs`, `respond.mjs`, `contrast-audit.mjs`) and
contact sheets in the session scratchpad.
