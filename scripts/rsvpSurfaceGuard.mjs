/**
 * rsvp.redeem.sg build guard (docs/plans/rsvp-pages.md §7.6). The plan's
 * "no ad tech on the RSVP surface" is enforced HERE, at the build boundary:
 * index.html loads the Meta/TikTok/Google/AdRoll loaders whenever their
 * VITE_* ids are non-empty, so inheriting a Render env group would be enough
 * to contact Meta before React renders. The build fails instead.
 *
 * Imported by vite.config.js (Node) and by its vitest.
 */
export const AD_TECH_ENV_KEYS = [
  'VITE_META_PIXEL_ID',
  'VITE_TIKTOK_PIXEL_ID',
  'VITE_GOOGLE_ADS_CONVERSION_ID',
  'VITE_GOOGLE_ADS_LEAD_LABEL',
  'VITE_ADROLL_ADV_ID',
  'VITE_ADROLL_PIX_ID',
  'VITE_TOUCH_ENABLED',
];

export function assertRsvpSurfaceEnv(env = {}) {
  if (env.VITE_BRAND !== 'redeem') {
    throw new Error('rsvp surface must build with VITE_BRAND=redeem (it otherwise inherits the MKTR operator identity)');
  }
  const carried = AD_TECH_ENV_KEYS.filter((k) => env[k] !== undefined && String(env[k]).trim() !== '');
  if (carried.length) {
    throw new Error(`rsvp surface must not carry ad tech — unset on the rsvp-frontend service: ${carried.join(', ')}`);
  }
  return true;
}

/** The HTML identity the rsvp build ships regardless of inherited env. */
export const RSVP_HTML = Object.freeze({
  VITE_PAGE_TITLE: 'RSVP',
  VITE_META_DESCRIPTION: 'Event RSVP pages by Redeem.',
  VITE_FAVICON_SRC: '/redeem-favicon.svg',
  VITE_CANONICAL_BASE: 'https://rsvp.redeem.sg/',
});
