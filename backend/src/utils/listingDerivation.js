/**
 * Marketplace-inherits-the-campaign-page — Phase A derivation
 * (docs/plans/marketplace-inherits-campaign-page.md, Codex-reviewed v2).
 *
 * The single place marketplace listing COPY is derived from campaign-page
 * content. Behind MARKETPLACE_INHERIT_ENABLED (read per call; default off):
 * flag off, every read is byte-identical to the stored behavior — a true
 * emergency brake. Flag on, the derived value WINS over stored listing copy
 * for exactly the DERIVED set below; placement picks (category, mode,
 * availability, audience age_range, non-draw activation facts, FAQ/data-use,
 * non-draw inclusions, …) always pass through untouched.
 *
 * Derived set (plan §1.1):
 *   name           ← content headline (generic/empty → dropped so consumers
 *                    fall back to campaign.name via the usual `dc.name ||`)
 *   description    ← content story              (NEW key; door block in Phase B)
 *   regulatory_line← content footer regulatory  (NEW key; door footer in Phase B)
 *   value_line     ← draws: derived prize summary · non-draws: DROPPED so the
 *                    frontend's existing ops.retail_value fact-fallback renders
 *   image_label    ← v2 media alt (image-kind only; v1 docs have no alt source
 *                    so their stored image_label is left untouched)
 *   prize_breakdown← draws: luckyDraw.prizes rows (NEW key — rendered as
 *                    "Prizes" in Phase B, never through `inclusions`)
 *   inclusions     ← draws only: DROPPED (the "Includes ✓" framing implies
 *                    entitlement; prize_breakdown replaces it)
 *
 * Pure module: no models, no I/O — the same function the Phase B client twin
 * will mirror (lockstep-tested), and the rollout diff script replays.
 */

import { readLegacyViewSafe } from './designConfigV2Clamp.js';

export function marketplaceInheritEnabled() {
  return process.env.MARKETPLACE_INHERIT_ENABLED === 'true';
}

/** Headlines that are template defaults, not campaign copy — never a title.
 * Exactly the renderer/editor default (review finding 6: legitimate short
 * headlines like "Sign Up" must not be suppressed). */
const GENERIC_HEADLINES = new Set(['get started']);

const clean = (v, max) => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s || undefined;
};

function isV2Doc(raw) {
  return !!raw && typeof raw === 'object' && raw.version === 2;
}

/** Derived listing title, shared rule for every consumer (plan: listingTitleOf). */
export function deriveListingTitle(rawDc, legacy) {
  const headline = clean(
    isV2Doc(rawDc) ? rawDc.content?.headline : legacy.formHeadline,
    120
  );
  if (!headline || GENERIC_HEADLINES.has(headline.toLowerCase())) return undefined;
  return headline;
}

/** Featured-drop title inherits the same headline, at the drop's 40-char cap. */
export function deriveFeaturedDropTitle(rawDc) {
  const legacy = readLegacyViewSafe(rawDc || {}, {});
  const title = deriveListingTitle(rawDc, legacy);
  return title ? title.slice(0, 40) : undefined;
}

/**
 * Overlay the derived view onto the already-built public design_config.
 * `publicDc` is buildPublicDesignConfig's output (normalized picks + public
 * luckyDraw incl. structured prizes); `rawDc` is the stored doc (version-aware
 * reads); `campaign` supplies nothing yet but stays in the signature so the
 * client twin and future derivations share one shape.
 */
export function applyListingInheritance({ campaign: _campaign, publicDc, rawDc }) {
  const out = { ...publicDc };
  const legacy = readLegacyViewSafe(rawDc || {}, {});
  const v2 = isV2Doc(rawDc);
  const draw = out.luckyDraw?.enabled === true;

  // Title — derived wins; generic/absent headline deletes the stored title so
  // the campaign-name fallback (the pre-listing behavior) takes over.
  const title = deriveListingTitle(rawDc, legacy);
  if (title) out.name = title;
  else delete out.name;

  // Description + regulatory line — new keys, page-sourced only.
  const description = clean(legacy.storyText, 1200);
  if (description) out.description = description;
  else delete out.description;
  const regulatory = clean(legacy.regulatoryFooter, 1000);
  if (regulatory) out.regulatory_line = regulatory;
  else delete out.regulatory_line;

  // Value line — facts, not copy (plan §1.1), clamped to the existing
  // 80-char marketplace cap (review finding 7: a max structured summary is
  // ~700 chars; complete names live in prize_breakdown).
  const prizeFact = draw ? clean(out.luckyDraw?.prize, 80) : undefined;
  if (prizeFact) out.value_line = prizeFact;
  else delete out.value_line;

  // Card image — the page hero IS the card image (review finding 4: the
  // marketplace DTO never carried imageUrl at all). Image kind only, both
  // versions; non-image media has no card image and no alt. v1 docs have no
  // page-level alt, so their stored image_label survives only alongside a
  // real page image.
  const mediaKind = v2
    ? (rawDc?.content?.media?.kind || 'none')
    : (legacy.mediaType || (legacy.imageUrl ? 'image' : 'none'));
  const mediaSrc = v2 ? rawDc?.content?.media?.src : legacy.imageUrl;
  if (mediaKind === 'image' && typeof mediaSrc === 'string' && mediaSrc) {
    out.imageUrl = mediaSrc.slice(0, 2048);
    if (v2) {
      const alt = clean(rawDc.content?.media?.alt, 120);
      if (alt) out.image_label = alt;
      else delete out.image_label;
    }
  } else {
    delete out.imageUrl;
    delete out.image_label;
  }

  // Draw prize rows — structured output rendered as "Prizes" (Phase B); the
  // entitlement-flavored inclusions section is suppressed for draws.
  if (draw) {
    const prizes = Array.isArray(out.luckyDraw?.prizes) ? out.luckyDraw.prizes : null;
    if (prizes && prizes.length) out.prize_breakdown = prizes.map((p) => ({ qty: p.qty, name: p.name }));
    else delete out.prize_breakdown;
    delete out.inclusions;
  } else {
    delete out.prize_breakdown;
  }

  return out;
}
