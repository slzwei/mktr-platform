# Spike — Instagram-first Discovery (Phase 5)

**Status:** Measurement complete (2026-07-14). Internal tool, ~3 operators.
**Question:** Can Discover source SG business prospects from Instagram that Google Maps *misses*?

---

## Decision — GO for a hashtag-based IG-native pilot; REJECT the Google-backed search paths

A live measurement (~$0, within Apify's free credit) settles it, and the two IG paths point in **opposite** directions:

- **Place / user search** is ~94% Google-sourced → it re-serves the same data our Maps discovery already uses. **~0 novelty. Reject.**
- **Hashtag (IG-native) search** surfaces the SG home-based / IG-only businesses Maps structurally can't see. **86% SG, 100% novel vs our Maps data, ~45% home-based. This is the pilot.**

Build on the **hashtag path**, reusing the Category + Territory model with a filter layer for precision. Keep Google Maps as the primary discovery source; do **not** build the place/user search — it duplicates Maps.

## What was measured

`apify/instagram-search-scraper` (place, user) + `apify/instagram-hashtag-scraper` (hashtag), verticals nail / facial-lashes / pet-grooming, one run each, cross-checked against the **151 existing Maps candidates** in prod.

| Path | Source | SG-relevant | Novel vs our Maps data | Contact / geo |
|---|---|---|---|---|
| place search | ~94% google | 29/29 in SG box | **~0%** (3 direct handle dupes; same Google source) | address/phone/coords/category — rich |
| user search | ~67% google | ~75% (1 was KL) | low | followers/bio/business flag |
| **hashtag** | **Instagram** | **50/58 (86%)** | **58/58 (100%) absent from Maps** | handle + bio only; ~45% home-based/mobile |

Hashtag samples — all novel, none in our Maps data: `@juicyclawz.sg` (home-based nail artist), `@april.collective` (Woodlands nails), `@my.nailsg` (Yishun), `@cyberdoll.nails` (press-ons), `@cherrylashes_studio_sg`, `@lashesbykim.sg`.

**Why place fails / hashtag wins:** the search actor's place/user rows carry `searchSource: "google"` — Google Places behind an IG wrapper, the *same* source as our `compass/crawler-google-places` Maps discovery. The hashtag scraper reads Instagram's own hashtag graph, so it reaches the home-based / IG-only long tail that never made a Google listing — exactly the strategic target.

## Pilot UX / parameter spec

Operator picks stay **identical to Maps** (Category + Territory); only the provider mechanism differs.

**Primary:**
- **Provider** — toggle *Instagram (hashtag)* vs *Google Maps*.
- **Category** — same taxonomy; each category carries admin-curated **hashtags** (the IG analog of the Phase 2a Google search-terms). e.g. Nail Salon → `#sgnails #nailsg #biabsg #apresgelsg #homebasednailssg`.
- **Territory** — pick a town or All-Singapore. **Soft filter** on IG (no reliable coordinates): fires town-flavoured tags + keeps accounts whose bio/location mentions the town. All-SG = SG-signal only. **Default All-SG + filters.**
- **Results / budget** — posts to scan; cost divided across the category's hashtags (same per-tag division as Phase 2a).

**Filter panel (post-scrape — where the richness lives):**
- Business accounts only (`isBusinessAccount`) — default on.
- Follower range (e.g. 300–20k) — skip dead accounts *and* chains/influencers.
- Home-based / mobile only — bio/caption signal (the Maps-invisible segment).
- Has contact (external URL / booking link / email in bio) — outreach-ready.
- Active recently (posted ≤ N days).
- Exclude verified/large brands + accounts already in pipeline.

**Power-user:** custom hashtags on top of the category defaults — the Phase 1 `discovery.explore` capability applied to IG.

> Design note: the hashtag scraper only accepts *hashtags + a post limit*. Every filter above is applied by **us** on the scraped + enriched accounts — so "rich parameters" = a good filter UI over a simple scrape, not actor config.

## Engineering shape

`hashtag-scrape → extract distinct authoring accounts → SG/business filter → profile-enrich (existing apify_instagram actor) → dedup by handle → human review → pipeline`.

**Identity (the real cost):** IG accounts have no Google place ID, so generalise the Maps-specific identity to a tuple `(source, kind, externalId)` — e.g. `instagram/profile/<numeric IG user id>` (prefer the numeric ID; handles rename/transfer, keep normalised handle as a matching signal). Re-key the within-run idempotency index (`migration 053:78`) and `discovery_place_memory` (`056`) on the tuple. **Candidate→partner dedup needs no change** — `classifyAgainstPartners` already matches on phone/domain/handle/name.

## Tradeoffs / caveats

- **Contact = handle + bio only.** Home-based shops hide phone/address → outreach is **IG-DM-first** (fits the Redeem model — keep outreach IG-first). Enrich followers/bio via the existing actor.
- **Precision needs a review step.** 86% SG is a bio/caption heuristic; hashtags also pull customers, influencers, resellers → business filter + human triage before anything reaches the pipeline.
- **Geo is soft** — bio/location tags only, no coordinates.
- **Data hygiene** (IG returns more per-account data than Maps): business-account filter, fast purge (~7–14 days) of rejected / non-business / indeterminate rows, 90-day purge for accepted candidates only, memory stays contact-free.
- **Reliability:** unofficial, revocable dependency (can break when IG changes) → schema/partial-result handling, a provider **kill switch**, and Maps as the primary fallback.

## Cost (measured)

Maps baseline $0.007/result. Hashtag scrape ~$2.30–2.60/1k posts + profile enrichment ~$1.60–2.60/1k. This entire spike scraped ~208 results ≈ **$0.55 list → $0 out of pocket** (Apify FREE $5 monthly credit). Comfortably inside the ≤2× Maps gate.

## Verdict

**GO — pilot the hashtag path.** Measurement confirms the novel-source hypothesis: IG hashtags reach the SG home-based / IG-only businesses Maps can't. Build on Category + Territory + a filter panel + handle-keyed identity, ship behind its own provider flag (like every other phase), keep Google Maps as the primary/fallback discovery source, and leave the Google-backed place/user search rejected.
