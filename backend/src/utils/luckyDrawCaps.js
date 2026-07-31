/**
 * Lucky-draw prize caps — the ONE definition shared by the server normalizer
 * (luckyDraw.js cleanPrizes) and BOTH drawTermsTemplate twins (backend +
 * src/components/campaigns/workspace; the SPA imports this file directly,
 * the same cross-boundary pattern as studio/marketplaceOptions.js →
 * marketplaceContent.js). Terms minted from these caps can never state a
 * quantity/name/row the save-time clamp would rewrite.
 *
 * MUST stay dependency-free: it is bundled into the browser build.
 */
export const MAX_PRIZE_NAME = 80;
export const MAX_PRIZE_ROWS = 8;
export const MAX_PRIZE_QTY = 99;
