/**
 * Per-template hero-media guidance — the "what should I upload?" answer the
 * Studio shows beside the hero image/video picker.
 *
 * Every template frames `content.media` differently (see
 * `src/components/campaignPage/templates.jsx` + `drawTemplates.jsx`), and every
 * frame cover-crops (`MediaBlock`'s <img>/<video> hardcode `objectFit: cover`),
 * so the wrong aspect ratio is silently cropped rather than letterboxed. These
 * numbers are derived from the render geometry, not invented:
 *
 *   - FIXED-RATIO frames (editorial, journey — `MediaBlock` at its default
 *     16 / 9 inside a column that maxes out at 600px) → the frame ratio, at ~2×
 *     for retina. These are the ONLY two templates whose frame is really 16:9;
 *     every other template passes `aspectRatio: 'auto'` and sizes off its own
 *     container (`BackdropMedia`, and Poster/Split inline).
 *   - RESPONSIVE frames (everything else) → the GEOMETRIC MEAN of the desktop
 *     and mobile container ratios, measured at 1440×900 and 390×844 (the JS
 *     `mobile` breakpoint is 640px — CampaignPageRenderer's `useIsMobile`).
 *     e.g. Poster is 1440/480 = 3.0 on desktop and 390/430 = 0.91 on a phone;
 *     √(3.0 × 0.91) ≈ 1.65, so 16:9 sits between both crops. The mean balances
 *     the multiplicative mismatch between the two containers; it does not make
 *     any single crop "symmetrical" (centred cover always crops both edges).
 *
 * REFERENCE-STATE CAVEAT: split, postcard and nightfall size off `minHeight`,
 * not a fixed height, so a long form makes their desktop container taller and
 * pulls the true ratio below the number quoted here. Stub has no height at all
 * — its ticket head grows with headline/subheadline wrapping — so its ratio is
 * marked `variable` and the copy says so rather than pretending precision.
 *
 * `hidden` templates render no media on the campaign page. The upload is still
 * kept in the doc (switching templates must never lose it) AND still feeds the
 * marketplace listing (`listingDerivation.js` maps content.media → imageUrl for
 * image heroes), so the copy must not claim "nothing will show".
 *
 * Re-derive these whenever a template's media container changes.
 */

/** Ratio + pixel recommendation per template id (keys = TEMPLATE_IDS).
 *  `frame16x9` marks the only frames a 16:9 source fills exactly — it is the
 *  FRAME's ratio, deliberately not inferred from the `ratio` copy above (Poster
 *  recommends a 16:9 source into a ~3:1 frame; the two are different facts). */
export const HERO_MEDIA_SPECS = {
  editorial: {
    size: '1600 × 900',
    ratio: '16:9 landscape',
    frame16x9: true,
    frame: 'A fixed 16:9 card on top of the story block (column ≤ 600px).',
    tip: null,
  },
  poster: {
    size: '2400 × 1350',
    ratio: '16:9 landscape',
    frame: 'Full-bleed hero — 480px tall on desktop, 430px on mobile.',
    tip: 'Crops to a wide band on desktop and to near-square on mobile. Keep the subject centred and out of the bottom third, where the headline and scrim sit.',
  },
  split: {
    size: '1800 × 1500',
    ratio: '6:5 landscape',
    frame: 'A half-screen, full-height panel beside the form; a 220px band on mobile.',
    tip: 'Balanced between the tall desktop panel and the short mobile strip — both crop, so keep the subject centred. A long form makes the desktop panel taller still.',
  },
  spotlight: {
    hidden: 'Spotlight has no hero-media slot on the campaign page. The upload is kept, and an image still feeds this campaign’s marketplace listing — but the page itself will not show it.',
  },
  express: {
    hidden: 'Express has no hero-media slot on the campaign page. The upload is kept, and an image still feeds this campaign’s marketplace listing — but the page itself will not show it.',
  },
  journey: {
    size: '1600 × 900',
    ratio: '16:9 landscape',
    frame16x9: true,
    frame: 'A fixed 16:9 block between the headline and the numbered story steps.',
    tip: null,
  },
  postcard: {
    size: '1800 × 1800',
    ratio: '1:1 square',
    frame: 'A half-screen panel on desktop; a 300px hero band on mobile.',
    tip: 'Square survives both crops. The wordmark sits top-left and the headline bottom-left — leave that corner quiet.',
  },
  gazette: {
    size: '2100 × 600',
    ratio: '3.5:1 panorama',
    frame: 'The wide "prize destination" plate — 170px tall on desktop, 130px on mobile.',
    tip: 'Panoramic: everything above and below the centre band is cropped away.',
  },
  nightfall: {
    size: '2000 × 2400',
    ratio: '5:6 portrait',
    frame: 'A full-screen backdrop behind the headline, countdown and form.',
    tip: 'It sits under a heavy dark scrim, so fine detail disappears — use one simple, high-contrast subject and keep it in the upper half.',
  },
  stub: {
    size: '2000 × 500',
    ratio: '4:1 panorama',
    variable: true,
    frame: 'The ticket head above the perforation, on a 760px ticket.',
    tip: 'The head has no fixed height — it grows as the headline and subheadline wrap, so treat 4:1 as a starting point and check both previews. Keep the subject horizontally centred.',
  },
  checklist: {
    size: '2000 × 500',
    ratio: '4:1 panorama',
    frame: 'A full-width band under the wordmark — 190px tall on desktop, 150px on mobile.',
    tip: 'Panoramic: only the centre band survives the crop.',
  },
};

/** The spec for a template id; unknown ids fall back to editorial (the parity
 * baseline, and the shape every other 16:9 frame follows). */
export function heroMediaSpec(templateId) {
  return HERO_MEDIA_SPECS[templateId] || HERO_MEDIA_SPECS.editorial;
}

/**
 * Why this template will not show the upload on the campaign page right now —
 * the template has no media slot, or a template PARAM is currently suppressing
 * it. Returns null when the media renders. `params` is the doc's bag for that
 * template.
 */
export function heroMediaHiddenReason(templateId, params = {}) {
  const spec = heroMediaSpec(templateId);
  if (spec.hidden) return spec.hidden;
  if (templateId === 'stub' && params.ticketTone === 'accent') {
    return 'The Accent ticket header paints the ticket head in your accent colour and hides the image — switch Ticket header back to Photo to show it.';
  }
  if (templateId === 'checklist' && params.heroBand === false) {
    return 'Slim hero band is switched off — turn it back on to show the image.';
  }
  return null;
}

/**
 * Does a YouTube embed get padded inside this template's frame?
 *
 * `MediaBlock` gives the iframe the whole frame, but the YouTube player never
 * cover-crops — it fits the video inside the iframe and pads the leftover axis.
 * So any frame that is not the fixed 16:9 one shows bars for a standard video.
 * Reads the explicit `frame16x9` flag, never the `ratio` display string (that
 * string is the recommended SOURCE ratio — Poster's says 16:9 while its frame
 * is ~3:1). Returns null for templates that render no media at all.
 */
export function heroFramePadsYouTube(templateId) {
  const spec = heroMediaSpec(templateId);
  if (spec.hidden) return null;
  return spec.frame16x9 !== true;
}
