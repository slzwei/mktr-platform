/**
 * RSVP page theme — the campaign Studio's presets/fonts/radii (pure data from
 * designConfigV2) resolved for the RSVP renderer. `theme` is the rsvp_layout
 * v1 theme block: { preset, accent, font, radius } where '' means "inherit
 * from the preset" (resolveTheme already treats a falsy override that way).
 */
import { resolveTheme } from '@/lib/designConfigV2';
import { heroFontStack } from '@/lib/heroFonts';

export function resolveRsvpTheme(theme = {}) {
  const t = resolveTheme({
    preset: theme?.preset,
    accent: theme?.accent || undefined,
    font: theme?.font || undefined,
    radius: theme?.radius || undefined,
  });
  return { ...t, fontStack: heroFontStack(t.fontId) };
}
