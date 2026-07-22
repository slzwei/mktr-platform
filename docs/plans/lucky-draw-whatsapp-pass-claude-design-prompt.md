# Lucky-Draw Signup WhatsApp — Entry Pass Card + Message — claude.ai/design prompt

**Date:** 2026-07-22
**Target:** claude.ai/design, inside the **"QR Card Frames"** project (it holds the Editorial family — 1c — that shipped as the pass/voucher cards). Attach the two reference renders (`qr-card-pass-reference.png`, `qr-card-voucher-reference.png`) when pasting.
**Goal:** design the WhatsApp message a person receives the moment they sign up for a lucky-draw campaign (first live one: Tokyo Getaway Lucky Draw) — a new **draw-entry state** of the Editorial QR card family (the image header) plus the **template body copy** under it.
**After the design:** engineering re-implements the card in the satori compositor (`qrCardRenderer.js`) as a third state and submits the body to Meta as a UTILITY template, so every visual choice must be reproducible under the constraints in §1.4.

---

## Paste everything below this line into claude.ai/design

---

You are a senior brand/product designer extending the existing **Editorial QR card family** (the attached pass + voucher references are the family; match them exactly in construction and voice). This is a **new state of an existing artifact plus its message copy** — not a rebrand, not a new layout system. Invent nothing outside the scope below.

# 0. Ground rules

You do **not** have access to the codebase and must not ask for it. Section 1 is ground truth — do not invent capabilities beyond it. Deliverables are §2. Use the realistic seed data in §1.5 — no lorem ipsum, no placeholder gray boxes. The QR itself may be a realistic dummy QR.

# 1. Platform context (ground truth)

## 1.1 The moment this message lands

redeem.sg runs consumer reward campaigns in Singapore. A person finds the campaign page, fills a short form (name, mobile, email), verifies their mobile with a one-time SMS code, and submits. For **lucky-draw campaigns** that signup = one verified entry in the draw. Seconds later they get this WhatsApp (and a confirmation email). It is the only WhatsApp they receive at signup.

The draw mechanic they just agreed to (it's in the T&Cs they ticked):

- One entry per verified mobile number. Free to enter.
- Entries close at a fixed date (Tokyo: **23:59 SGT, 30 October 2026**).
- **×10 boost:** complete a complimentary ~20-min financial review before the close date, and the entry becomes **ten entries**. The consultant records the completed session by **scanning this exact pass** at the meeting.
- One winner, drawn after close in a witnessed process; contacted directly by phone/SMS; 14 days to claim; masked results published at redeem.sg/winners.
- Anti-scam posture is a brand pillar: **we never ask for payment to release a prize** (draw scams are rampant in SG — this message must feel institutional, not like a prize-scam blast).

So this one message must do three jobs at once: **confirm the entry** ("you're in"), **hand over the pass** (the QR the consultant will scan), and **plant the ×10 reason to book the session** — without reading as marketing spam.

## 1.2 The message anatomy (fixed)

Meta WhatsApp Cloud API **UTILITY template**: an **image header** (the 1080×1080 card PNG, rendered per-customer and uploaded at send time) above a short **body text** with numbered placeholders. That's the whole message — no buttons, no footer, no document attachments. The existing sibling message (reservation pass for non-draw campaigns) uses exactly this anatomy.

## 1.3 The Editorial card family (what you are extending — see attached references)

One 1080×1080 canvas, vertical flex stack, two existing states:

| Slot (top→bottom) | Spec | 'pass' state (cream) | 'voucher' state (terracotta) |
|---|---|---|---|
| Header row | wordmark left, kicker right, margin 40px top / 48px sides | "Redeem" 34px Albert Sans 800 + accent-dot period `#D6552B` | same, ink `#FBF7EE` |
| Kicker | 24px Albert Sans 600, letter-spacing 4.8 | `RESERVATION PASS` in `#6B6558` | `VOUCHER · UNLOCKED` in `#F7E7DC` |
| Display word | Fraunces italic 600, 64px, centered | *Reserved.* in gold `#C89B3C` | *Unlocked.* in `#F7E7DC` |
| Partner line | 24px 600, ls 3.8, flanked by 2px hairlines, 120px side padding | partner name uppercase, `#6B6558` / hairline `#E6E0D1` | same, cream on `rgba(251,247,238,.38)` hairlines |
| Title | Fraunces 600, 42px, centered, 80px side padding | reward name, `#1B1A17` | reward name, `#FBF7EE` |
| **QR panel** | **594×594 white panel, centered; 450×450 QR inside (the white margin is the quiet zone). SACRED — geometry and whiteness never change.** | 2px border `#E6E0D1` | borderless (white floats on terracotta) |
| Status line | 13px dot + Fraunces italic 400, 30px | "Held for {name} — unlock at your appointment" | "Unlocked — present once to redeem" |
| Footer stack | bottom-anchored, centered, 28px bottom pad | JetBrains Mono 600 28px code line → 24px ls 3.4 expiry line → 24px fine print `#8B8477` → `POWERED BY MKTR` mono 24px ls 2.9 | same in cream tones |

Palettes: **pass** = bg `#FBF7EE`, ink `#1B1A17`, gold `#C89B3C`, accent `#D6552B`, muted `#6B6558`, hairline `#E6E0D1`, fine print `#8B8477`. **voucher** = bg `#D6552B`, ink/cream `#FBF7EE`, soft cream `#F7E7DC`.

Family voice: editorial restraint. Flat fills, hairlines, one italic display word doing the emotional work, mono for machine-ish lines. No gradients, no shadows, no illustration, no photos.

## 1.4 Hard production constraints

- **WhatsApp crop:** the chat bubble preview crops toward the middle band — the display word, title, and QR must survive the crop; header/footer may be lost in preview. (The references already obey this; keep their vertical rhythm.)
- **Compositor:** the card is rebuilt in satori (flexbox-only layout, the three family fonts above, flat colors, simple borders/hairlines only). If your design needs masks, gradients, rotation, or new fonts, it won't ship — don't.
- **Dynamic text is single-line and clamped:** customer first name ≤24 chars, reward/prize title ≤70, partner ≤48, dates render like `30 Oct 2026`. Design the slots to tolerate the max lengths.
- **QR encodes a claim link** (`redeem.sg/r/…`). A human who scans it lands on a branded pass page; the consultant's scanner is what records the ×10 session. Don't caption the QR with anything that contradicts either use.
- **Template body (Meta rules):** ≤1024 chars, plain text + emoji, numbered `{{n}}` params; params are single-line, ≤60 chars, and may not contain URLs (the one link, `redeem.sg/r/{{token}}`, lives in the fixed template text). The template must plausibly pass Meta's **UTILITY** review: it confirms a transaction the person just initiated (their entry) — confirmational statements, not promotional questions/exclamations, or Meta reclassifies it as MARKETING.

## 1.5 Seed data (use verbatim)

- Campaign: **Tokyo Getaway Lucky Draw** · prize **4D3N Tokyo getaway (flights + hotel)** · entries close **30 Oct 2026** (23:59 SGT) · multiplier **×10**
- Customer: **Sarah**, +65 9•••• 4312
- Partner/consultant context: the session is a complimentary financial review with an MKTR-partnered consultant (no external partner brand on draw cards — the partner-line slot needs a draw-appropriate treatment, e.g. campaign or issuer language; your call, in-family)
- Wordmark: **Redeem.** · footer keeps **POWERED BY MKTR**
- The pass has no manual code (nothing to type); it may show an entry/serial-style mono line if that slot earns its place. Expiry-slot equivalent: the close date.

# 2. The brief — deliverables

**A. The draw-entry card state.** Design the third state of the family: the card that confirms "you're in the draw" AND works as the scannable ×10 session pass. Explore **2–3 directions within the family** — e.g. cream with the draw treated in gold; a third colorway (if you introduce one, it must sit naturally beside cream + terracotta and keep the sacred white QR panel); a ticket/entry-stub accent achievable with hairlines alone — then recommend one. For the chosen direction, specify every slot exactly as §1.3 does: kicker text, display word, partner-line treatment, title content (prize vs campaign name — your call), status line, footer lines (incl. how the close date reads), and all hex values. Show it rendered with the §1.5 seed data at 1080×1080, plus a small mock of how it crops inside a WhatsApp bubble.

**B. The message body copy.** Write the template body that rides under the card: the `{{n}}` parameterized template string (with a param table: position → content → example) AND the rendered Sarah example. It must confirm the entry, state the ×10-by-session mechanic and the close date, carry the fixed `redeem.sg/r/{{token}}` link as the tap fallback, include the never-pay-for-a-prize assurance, and stay UTILITY-classifiable per §1.4. Keep it tight — this sits in a chat bubble under a card that already says most of it.

**C. One-line consistency note.** The same PNG is reused as the inline image of the signup email — confirm the chosen direction reads correctly on a white email background (the cream card currently relies on its own bg; if your direction needs a hairline border for white contexts, say so).

# 3. What NOT to do

- Don't redesign the existing pass/voucher states, the layout skeleton, fonts, or the QR panel geometry.
- Don't add buttons, links, or claims beyond §1.1 facts (no "guaranteed", no urgency countdown, no prize imagery).
- Don't produce marketing-tone copy (exclamation-heavy, question hooks) — it must survive Meta's utility review and SG scam-wariness.
