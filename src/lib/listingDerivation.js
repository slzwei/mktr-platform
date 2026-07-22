/**
 * Marketplace-inherits-the-campaign-page — CLIENT twin of
 * backend/src/utils/listingDerivation.js (Phase B, plan §3B).
 *
 * Purpose: Studio/classic editors preview the UNSAVED doc's inherited listing
 * before any save reaches the server. The derivation rules MUST match the
 * backend overlay — pinned by the lockstep test (listingDerivation.lockstep),
 * same discipline as the designConfigV2 twins.
 *
 * `VITE_MARKETPLACE_INHERIT_ENABLED` pairs with the backend's
 * MARKETPLACE_INHERIT_ENABLED — the runbook flips BOTH in one sitting
 * (frontend controls editor/preview chrome; the server controls what actually
 * serves, so a brief mismatch degrades to stale UI, never wrong data).
 */

import { readLegacyView, isV2 } from './designConfigV2';

export function marketplaceInheritEnabled() {
  return import.meta.env.VITE_MARKETPLACE_INHERIT_ENABLED === 'true';
}

/** Exactly the template default — mirror of the backend set. */
const GENERIC_HEADLINES = new Set(['get started']);

const clean = (v, max) => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s || undefined;
};

/** Mirror of the backend prize-row normalizer (luckyDraw.js cleanPrizes):
 * qty coerced to an int 1–99 (else 1), names trimmed/clamped to 80, empty
 * rows dropped, at most 8 rows. */
function normalizePrizeRows(prizes) {
  if (!Array.isArray(prizes)) return [];
  return prizes
    .map((p) => {
      // Mirror backend cleanString: trim + cap ONLY (inner whitespace kept).
      const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 80) : '';
      const q = Number(p?.qty);
      const qty = Number.isInteger(q) && q >= 1 && q <= 99 ? q : 1;
      return { qty, name };
    })
    .filter((p) => p.name)
    .slice(0, 8);
}

/** Mirror of derivePrizeSummary — "name" / "3× name", joined with " + ". */
function summarizePrizes(rows) {
  return rows.map((p) => (p.qty === 1 ? p.name : `${p.qty}× ${p.name}`)).join(' + ');
}

function legacyOf(doc) {
  try {
    return isV2(doc) ? readLegacyView(doc) : (doc || {});
  } catch {
    return {};
  }
}

/** The one title rule (backend deriveListingTitle mirror). */
export function deriveListingTitle(doc) {
  const legacy = legacyOf(doc);
  const headline = clean(isV2(doc) ? doc?.content?.headline : legacy.formHeadline, 120);
  if (!headline || GENERIC_HEADLINES.has(headline.toLowerCase())) return undefined;
  return headline;
}

/**
 * Consumer-side effective listing title — visible copy, browse/search, image
 * alt fallback AND the Meta/TikTok tracking name all route through here
 * (plan §9b.6): the served `dc.name` (derived when inheritance is on, stored
 * otherwise), else the campaign's internal name.
 */
export function listingTitleOf(campaign) {
  const dcName = campaign?.design_config?.name;
  return (typeof dcName === 'string' && dcName) || campaign?.name || '';
}

/**
 * The derived listing view of an (unsaved) doc — v1-flat keys, mirroring the
 * backend overlay's derived set. `base` (optional) plays the role of the
 * stored public dc the overlay mutates; keys the derivation owns are REPLACED
 * or DELETED exactly like the server.
 */
export function applyClientInheritance(base, doc, campaignName) {
  const out = { ...(base || {}) };
  const legacy = legacyOf(doc);
  const v2 = isV2(doc);
  const draw = doc?.luckyDraw?.enabled === true;

  const title = deriveListingTitle(doc);
  if (title) out.name = title;
  else delete out.name;

  const description = clean(legacy.storyText, 1200);
  if (description) out.description = description;
  else delete out.description;

  const regulatory = clean(legacy.regulatoryFooter, 1000);
  if (regulatory) out.regulatory_line = regulatory;
  else delete out.regulatory_line;

  // Prize facts mirror the server's normalize-then-summarize pipeline
  // (publicLuckyDraw → derivePrizeSummary): structured rows win, the stored
  // summary is only the legacy fallback (Phase B review finding 1).
  const drawRows = draw ? normalizePrizeRows(doc?.luckyDraw?.prizes) : [];
  const prizeFact = draw
    ? clean(drawRows.length ? summarizePrizes(drawRows) : doc?.luckyDraw?.prize, 80)
    : undefined;
  if (prizeFact) out.value_line = prizeFact;
  else delete out.value_line;

  const mediaKind = v2
    ? (doc?.content?.media?.kind || 'none')
    : (legacy.mediaType || (legacy.imageUrl ? 'image' : 'none'));
  const mediaSrc = v2 ? doc?.content?.media?.src : legacy.imageUrl;
  if (mediaKind === 'image' && typeof mediaSrc === 'string' && mediaSrc) {
    out.imageUrl = mediaSrc.slice(0, 2048);
    if (v2) {
      const alt = clean(doc?.content?.media?.alt, 120);
      if (alt) out.image_label = alt;
      else delete out.image_label;
    }
  } else {
    delete out.imageUrl;
    delete out.image_label;
  }

  if (draw) {
    const rows = normalizePrizeRows(doc?.luckyDraw?.prizes);
    if (rows.length) out.prize_breakdown = rows;
    else delete out.prize_breakdown;
    delete out.inclusions;
  } else {
    delete out.prize_breakdown;
  }

  void campaignName; // shape parity with the server signature
  return out;
}

/** Featured-drop tile title twin (backend deriveFeaturedDropTitle mirror). */
export function deriveFeaturedDropTitleClient(doc) {
  const title = deriveListingTitle(doc);
  return title ? title.slice(0, 40) : undefined;
}

/** Editor-preview rows: what the marketplace will show, with sources named. */
export function deriveListingPreview(doc, campaignName) {
  const d = applyClientInheritance({}, doc, campaignName);
  return [
    { label: 'Listing title', source: 'Page → headline', value: d.name || `${campaignName || 'campaign name'} (fallback)` },
    { label: 'Description', source: 'Page → story', value: d.description || '—' },
    {
      label: 'Value line',
      source: doc?.luckyDraw?.enabled === true ? 'Draw → prize facts' : 'Ops → retail value',
      value: d.value_line || (doc?.luckyDraw?.enabled === true ? '—' : 'Worth S$<retail> (from the live offer)'),
    },
    { label: 'Card image', source: 'Page → hero media', value: d.imageUrl ? d.imageUrl.split('/').pop() : 'none (non-image media)' },
    ...(doc?.luckyDraw?.enabled === true
      ? [{ label: 'Prizes', source: 'Draw → prize rows', value: (d.prize_breakdown || []).map((p) => `${p.qty}× ${p.name}`).join(' · ') || d.value_line || '—' }]
      : []),
    { label: 'Regulatory line', source: 'Page → footer', value: d.regulatory_line || '—' },
  ];
}
