/**
 * Curated hero/display fonts a campaign creator can pick for the lead-capture
 * hero — the brand wordmark (LeadCaptureLayout) and the form headline
 * (CampaignSignupForm) — via `design_config.heroFont`.
 *
 * `id` is the value stored in design_config; `stack` is the CSS font-family.
 * Fraunces / Albert Sans / Inter are already loaded globally; Playfair Display
 * and Space Grotesk are added to the Google Fonts import in `src/index.css`.
 * Google Fonts only fetches a family's woff2 when it's actually rendered, so
 * options a campaign doesn't use cost nothing on the public page.
 *
 * Keep every option multi-weight (>=700 available) — the hero renders at
 * fontWeight 800-900, and single-weight display faces would get faux-bolded.
 */
export const HERO_FONTS = [
  { id: 'fraunces', label: 'Fraunces', kind: 'Serif', stack: "'Fraunces', Georgia, serif" },
  { id: 'playfair', label: 'Playfair Display', kind: 'Serif', stack: "'Playfair Display', Georgia, serif" },
  { id: 'space-grotesk', label: 'Space Grotesk', kind: 'Sans', stack: "'Space Grotesk', system-ui, sans-serif" },
  { id: 'albert-sans', label: 'Albert Sans', kind: 'Sans', stack: "'Albert Sans', system-ui, sans-serif" },
  { id: 'inter', label: 'Inter', kind: 'Sans', stack: "'Inter', system-ui, sans-serif" },
];

// Matches the historical hardcoded hero face, so existing campaigns are unchanged.
export const DEFAULT_HERO_FONT = 'fraunces';

const STACK_BY_ID = HERO_FONTS.reduce((acc, f) => {
  acc[f.id] = f.stack;
  return acc;
}, {});

/**
 * Resolve a stored `heroFont` id (or empty / legacy / unknown) to a CSS
 * font-family stack. Always returns a usable stack — never undefined.
 */
export function heroFontStack(id) {
  return STACK_BY_ID[id] || STACK_BY_ID[DEFAULT_HERO_FONT];
}
