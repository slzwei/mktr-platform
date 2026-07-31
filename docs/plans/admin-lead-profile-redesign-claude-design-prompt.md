# Claude Design prompt — redesign the admin Lead Profile page

Paste everything below the line into Claude Design (claude.ai/design). If you have a
screenshot of the live page (mktr.sg/admin/leads/<any id>), attach it too — the
"current state" section describes it faithfully, but pixels beat prose.

---

## The brief

Redesign **one page**: the **Lead Profile** page of MKTR's admin console ("Switchboard"),
route `/admin/leads/:id`. It shipped today, it works, and it is **neither nice nor
efficient** — it reads like a config dump. Your job is a composition that makes an
operator answer four questions in under five seconds, without scrolling, and enjoy
looking at it. Do not invent new data; every fact listed in the inventory below already
exists on the page. Do not redesign any other screen, the sidebar shell, or the tokens.

### Who uses it and when

One operator-admin (the founder), desktop, dozens of times a day. He lands here by
clicking a lead row in the Prospects table, a ⌘K search result, or a dashboard link.
The four questions, in priority order:

1. **Who is this person?** — canonical name, phone, how many campaigns they've joined,
   and the name they used on EACH signup ("Shawn Lee" on campaign A, "Shawn Tan" on
   campaign B — the variant matters; it's how duplicates and fraud smell).
2. **What did each campaign give them?** — for a lucky-draw campaign: their chances
   ("on track for ×10 — consultant scan recorded"), in a voice that never overclaims
   before the draw seals. For a reward campaign: reserved / unlocked / redeemed /
   expired, with the reward name.
3. **Did it actually reach them?** — pass/voucher delivery receipts (email ✓ /
   WhatsApp ✗), and whether the lead reached the mobile app ("Lyfe delivery").
4. **What happened, and what do I do?** — a scannable history, plus three actions:
   Assign to agent, Return to held, Delete.

### The current state (what you're fixing)

- **Everything is the same weight.** ~40 `label | value` rows in identical 12px kv
  styling across five lookalike cards. The page's entire point — the draw/reward
  outcome per campaign — is one 12.5px text line with an emoji inside a button.
- **No above-the-fold answer.** Layout is: header + chip soup → a 7-col "Campaigns"
  rail and a 5-col stack of five cards (This signup / Quiz / Consent & reachability /
  AI screening / Voice call) → a full-width flat History list. Answering the four
  questions takes ~5 screen-heights of vertical scanning.
- **Chip soup.** Status, held, screening verdict, priority, score, erased — six chips
  of equal weight under the title.
- **History is a mono timestamp column** with no day grouping, no per-event scent, no
  hierarchy between "signed up" and "marketing email skipped".
- **Dead dashes everywhere** — empty values render as "—" rows instead of disappearing.

### What good looks like (direction, not prescription)

- **A summary band that answers Q1–Q3 without scrolling.** Consider a hero strip:
  identity block (name, phone, signups·verified, first seen) + one **outcome tile per
  campaign** with the draw/reward state as the LOUDEST element on the page (the ×10, the
  "Redeemed ✓", the "🏆 Winner — claim by 5 Nov"). Receipts and diagnostics ride as
  small print inside the tile, not as separate rows.
- **Outcome-first campaign cards.** The rail's per-signup card should lead with the
  outcome, then the name-used line ("as Shawn Tan" + a variant flag that actually
  draws the eye), then source/verified/held as quiet metadata. Current card order is
  inverted.
- **Progressive disclosure for the long tail.** Screening transcript + recordings,
  quiz answers, session funnel, raw consent versions, DNC detail — none of these are
  five-second facts. Collapse them (accordion, tabs within a card, or a secondary
  column with disclosure rows) — but keep them one click away, never gone.
- **A history worth reading.** Day-grouped, icon-or-glyph per event family (signup /
  reward / delivery / screening / marketing / Lyfe), campaign tag on the right, the
  All · This signup · Person scope switch kept. Quiet rows for noise events.
- **Empty-state discipline.** A fact with no value doesn't render. A section with no
  facts doesn't render. The erased-person banner and the "Retell voice lead — no
  cross-campaign identity" note stay (they're honesty, not chrome).
- **Rhythm over cramming.** Density is welcome (this is an ops tool), but with a
  visible grid, aligned baselines, and two or three type sizes doing real work.

Propose **one strong direction** (a second variant is welcome only if it's genuinely
different in composition, not palette). You may restructure the layout completely —
columns, bands, tabs, sticky summary, whatever serves the five-second test — as long
as every inventory item below keeps a home and the actions stay reachable.

### Hard constraints

- **Stay inside the Switchboard design system** (tokens below). No new colors, fonts,
  or shadows. Light AND dark must both work (the tokens swap; design with variables,
  check both).
- State is **never color-alone** — every status carries a glyph or label.
- Focus-visible: 2px `--accent` outline, 2px offset, on everything interactive.
- Desktop-first, design at 1440. Note (one line is enough) how it collapses <900px:
  single column, rail first.
- The three actions (Assign to agent ▾ / Return to held / Delete-danger) and the
  "← Prospects" back link must stay visible without scrolling.
- Keep AA contrast on every text/background pair you use.

### Switchboard tokens (the real ones — use these variables verbatim)

```css
/* light */
--canvas:#F1F3F7; --surface:#FFFFFF; --surface-2:#F6F7FA;
--ink:#161A22; --ink-2:#535B6E; --ink-3:#8A92A6;
--line:#E2E6EE; --line-strong:#C9CFDC;
--accent:#2C46E6; --accent-ink:#FFFFFF; --accent-soft:#E8ECFE; --accent-text:#2440CC;
--ok:#0B7A44; --ok-soft:#DDF3E6; --warn:#9A5B00; --warn-soft:#FEF0D8;
--bad:#C42B1C; --bad-soft:#FCE4E0; --hold:#6440D4; --hold-soft:#ECE6FC;
--shadow:0 1px 2px rgba(22,26,34,.04), 0 6px 20px rgba(22,26,34,.05);
--font-ui:'Schibsted Grotesk',system-ui,sans-serif;
--font-mono:'IBM Plex Mono',ui-monospace,monospace;

/* dark ([data-theme="dark"]) */
--canvas:#0F1116; --surface:#171A21; --surface-2:#1E222B;
--ink:#EEF1F7; --ink-2:#A6AEC1; --ink-3:#707A8E;
--line:#272C38; --line-strong:#3A4150;
--accent:#6D7FFF; --accent-ink:#0F1116; --accent-soft:#232A4E; --accent-text:#96A3FF;
--ok:#4CC38A; --ok-soft:#153226; --warn:#F0A33A; --warn-soft:#37280F;
--bad:#F0655A; --bad-soft:#3B1815; --hold:#A78BFF; --hold-soft:#251D48;
```

House vocabulary you can lean on: white `--surface` cards with 1px `--line` borders on
the `--canvas` background; MICROCAPS section labels in `--ink-2`; `--font-mono` for
phone numbers, timestamps, ids; soft-tone chips (`--ok-soft` bg + `--ok` text, etc.)
with a glyph.

### Content inventory (every item needs a home; tiers = suggested prominence)

**Tier 1 — the five-second answers**
- Canonical person name · phone (mono) · `2 signups (2 verified)` · first seen date
- Per-campaign outcome, one per signup:
  - Draw voices (exact copy, keep the semantics): `On track for ×10 — consultant scan
    recorded · closes 30 Oct` (open, provisional) / `1 chance so far · boost window
    open until 15 Oct` / `Boost pending ops review` / `Not counted yet — phone
    unverified` / `In the pool — 1 chance · ×10 boost applies at seal` (frozen) /
    `Excluded at freeze` / `10 chances · sealed` / `Selected — claim by 5 Nov` /
    `🏆 Winner — claimed 2 Nov` / `Not selected (10 chances)` / `Draw void` /
    `Draw record unavailable (erased)`
  - Reward voices: `Reserved · expires 12 Aug` / `Unlocked · voucher live until
    12 Aug` / `Redeemed ✓ 2 Aug` / `Expired` / `Blocked`, always with the reward name
  - Delivery receipts microcopy: `pass emailed ✓ · WhatsApp ✓` or `email failed ✗`
  - No-reward diagnostic when nothing was issued: `No reward — quota full`, `Reward
    pending — issuance sweep hasn't landed`, etc.
- Name used on THIS signup: `as Shawn Tan` + a **name-variant flag** when ≠ canonical
- Status chip set (pick a hierarchy): lead status · held(+reason) · AI verdict ·
  erased. Priority/score exist but are minor.
- Actions: Assign to agent ▾ · Return to held · Delete (danger) · ← Prospects

**Tier 2 — scan-level detail**
- This signup: email, verified-at, source, UTM (source/medium/campaign/term/content),
  landing page, QR tag, campaign link ↗, assigned agent OR named external buyer
  (`Sarah K (Propnex)`), held since + reason, **Lyfe delivery** (`created: ✓ delivered ·
  assigned: ✗ failed ×3 (agent not found)` or `not sent — no app destination`),
  next-follow-up, commissions
- Consent & reachability: per-kind ledger rows (granted/denied + version + global/campaign
  scope), suppressions chips, DNC (`clear` / `no voice + SMS` + checked/valid dates),
  pinned draw-terms version, marketing touches (`2 broadcasts — 1 sent · 1 skipped`)
- AI screening: verdict + reason + sentiment + attempts + promised callback + cost
- History strip: day-grouped events with scope filter (All · This signup · Person) —
  signups ("Signed up as Shawn Tan — NTUC Trial"), reward transitions, delivery
  receipts, marketing sends/skips, Lyfe webhook outcomes, screening attempts, draw
  boosts, arrival ("Arrived — /c/tokyo")

**Tier 3 — on demand (collapse freely)**
- Screening transcript (chat-style, Sarah vs lead) + per-attempt audio players
- Voice-call card for Retell leads (sentiment, duration, from-number, summary, audio)
- Quiz answers · session funnel steps · other terminal draws (`drawHistory`)

**Page-level states**: skeleton loading; error ("may have been deleted") with back
link; **erased banner** ("This person was erased on <date> — profile shows only what
the allowlist rebuild kept"); consumer-less note ("Retell voice lead — the call
carries no caller phone, so there is no cross-campaign identity").

### Sample data for the mock (use exactly this — it exercises every voice)

Person: **Shawn Lee** · `+65 9123 4567` · 2 signups (2 verified) · first seen 1 May 2026.
Chips: `new` · `✓ AI qualified`.

Signup 1 (current, 20 Jul, QR code): **Tokyo Getaway Lucky Draw** — as **Shawn Lee**,
verified ✓ — draw: `On track for ×10 — consultant scan recorded · closes 30 Oct`,
receipts `pass emailed ✓ · WhatsApp ✓`.
Signup 2 (1 May, website): **NTUC Trial Reward** — as **Shawn Tan** ⚠ name variant,
verified ✓ — reward: `Redeemed ✓ 3 May — 1-for-1 latte`, receipts `voucher emailed ✓`.

This signup: email `shawn@x.com`, utm `fb / cpc / aug-tokyo`, landing `/c/tokyo`,
agent unassigned, Lyfe delivery `created: ✓ delivered`. Consent: marketing yes
(`2026-07-21-agree-all-v1`, global) · terms yes · third-party no; DNC `clear`
(checked 20 Jul, valid to 20 Aug); broadcasts `2 — 1 sent · 1 skipped (suppressed)`.
Screening: Qualified · "agreed to meet a consultant" · positive · 2 attempts ·
S$1.42. History (newest first): boost recorded 21 Jul → screening qualified 21 Jul →
pass emailed ✓ 20 Jul → signed up as Shawn Lee (Tokyo) 20 Jul → arrived /c/tokyo
20 Jul → voucher redeemed 3 May → voucher emailed ✓ 2 May → signed up as Shawn Tan
(NTUC) 1 May.

### Deliverable

One **self-contained HTML file** (inline CSS; the only external request allowed is the
Google Fonts import for Schibsted Grotesk + IBM Plex Mono), desktop 1440, wired to the
token variables so flipping `data-theme="dark"` on the root works. Seed it with the
sample data above. Follow it with a short **spec note**: the composition moves you
made and why each one buys speed (I'll implement it in React against this spec —
the data contract is fixed, so name things by the inventory labels above).
