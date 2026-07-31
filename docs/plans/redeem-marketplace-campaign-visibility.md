# Putting campaigns (incl. lucky draws) on redeem.sg — placement map + plan

**Date:** 2026-07-22 · **Status:** capability EXISTS (per-campaign opt-in); this doc maps where things appear, the eligibility gates, and the optional enhancements.

## 1. TL;DR

Any lead-gen campaign can appear on redeem.sg **if and only if you opt it in** — nothing is ever auto-published. There are two independent channels:

| Channel | Trigger | Discoverable? |
|---|---|---|
| **Direct campaign page** | Campaign is **Active** | No (ads/QR/short-links only) — `redeem.sg/LeadCapture?campaign_id=…` |
| **Marketplace** | Marketplace **listing toggled on** in Studio (+ gates in §3) | Yes — homepage, explore grid, category page, own door URL |

The marketplace is already fully draw-aware — no build needed for draws to appear correctly.

## 2. Where exactly a listed campaign shows on redeem.sg

The apex homepage is a fixed section stack: Hero → **Categories** → **"Featured this week"** → How it works → Trust → Parents band → Business teaser → Consultant note → FAQ. A listed campaign appears in:

1. **Homepage → "Featured this week"** (3rd section, ~6 cards, mobile = swipe carousel). Selection rule: campaigns with `featuredDrop` set win these slots (up to 6); if none have it, the first 6 listed campaigns show. → *To guarantee homepage placement, set the campaign's featured drop.*
2. **`/explore`** — the full offer grid (every listed campaign), with client-side category filters.
3. **`/c/{category}`** — the category page for whichever category the listing declares (10 exist: 6 education, 4 lifestyle incl. `family_lifestyle`, `wellness`, `dining`, `financial_education`). Category tiles on the homepage link here.
4. **`/offers/{slug}`** — the campaign's own marketplace door (hero, partner block, requirement box, CTA into the entry flow).

**What a lucky-draw card looks like** (already built): apricot **"Lucky draw"** pill on the card image, a draw box — *"Verified sign-up = 1 chance · boost ×10 by completing the activation step"* — a `closes {date}` fact line, and a **"View draw"** CTA. The door and entry flow have matching draw states, and after 23:59 SGT on close day the draw **auto-delists** from all grids while its door shows the "This draw has closed" state (winners-page pointer included). Winners later publish at `/winners`.

## 3. Eligibility gates (ALL must hold to be listed)

From `marketplaceService.passesStaticGate` + `composeOps`:

1. `status='active'` AND `is_active=true` (launch it)
2. **Slug set** (`/offers/{slug}` — Studio's slug editor, uniqueness-checked)
3. **`distribution.marketplace.listed = true`** + listing details (title, category, offer type, mode, value line, image) — Studio → Distribution panel, admin-only, with a server publication gate that blocks incomplete listings
4. Customer host = `redeem` (default)
5. Type ∈ {lead_generation, brand_awareness, product_promotion, event_marketing} — **quiz and guided_review campaigns can never list**; lucky draws (= lead_generation) can
6. **A live Redeem-Ops chain: Partner → Reward Offer → Activation linked to the campaign.** `composeOps` returns null without it and the campaign is dropped from the list — the marketplace only shows offers it can actually service. Zero remaining allocation also delists.
7. Draws only: entry cutoff not passed.

**Key consequence for the Tokyo draw:** marketplace visibility requires the same **ops A–C** (partner → offer → activation) that the ×10 mechanic needs. One setup unlocks both.

## 4. Runbook — putting the Tokyo draw on redeem.sg

1. Redeem Ops (`ops.redeem.sg`): create/choose partner → reward offer (set `claimExpiryDays ≥ ~110` to cover signup→30 Oct) → Activation linked to the campaign, allocation ≥ expected signups. *(Also arms ×10 + pass delivery.)*
2. Studio → Distribution: set a slug (e.g. `tokyo-getaway`), fill listing (suggest category `family_lifestyle`, value line e.g. "4D3N Tokyo getaway — flights + hotel"), card image (use a **web-sized** hero, not the 30MB master), toggle **Listed**.
3. Optionally set the **featured drop** to hold a homepage "Featured this week" slot.
4. Launch the campaign (workspace → Launch). It then appears in §2's four placements; entrants round-robin to consultants only if lead credits exist (separate ops item).

## 5. Optional enhancements (not required — scoped if wanted)

| Idea | What it adds | Size |
|---|---|---|
| **"Live lucky draws" homepage band** | A dedicated rail between Featured and How-it-works, shown only when ≥1 listed draw exists (draw cards + closes-in countdown). Today draws compete for the same 6 Featured slots. | S–M (frontend only) |
| **Draws category/filter** | `lucky_draws` category tile + `/c/lucky-draws`, or an "ending soon" sort on /explore. | S |
| **Winners cross-link** | Card/door link to `/winners` once a campaign's draw is published. | XS |

None of these block anything — the existing surfaces render draws correctly today.
