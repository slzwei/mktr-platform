/**
 * Tropic Office — typography tokens.
 *
 * Platform-free primitives. RN consumers should also import ./typography.native
 * for the ready-made TextStyle objects with Platform-aware letter spacing.
 *
 * ROLE RULES (enforced across every screen):
 * - SERIF (Fraunces):     greetings ONLY · ONE big hero number per screen ·
 *                         ONE italic accent per screen.
 *                         NEVER on labels, stat values, list-row names, activity items.
 * - SANS  (Albert Sans):  everything else. The workhorse. Body, labels, counts,
 *                         stat values, list rows, buttons, form fields.
 * - MONO  (JetBrains Mono): timestamps ("2m ago") and short IDs only.
 *                         NEVER on counts, percentages, currency, or UI labels.
 */

export const Fonts = {
    serif: 'Fraunces',
    serifItalic: 'Fraunces-Italic',

    sans: 'AlbertSans_400Regular',
    sansMedium: 'AlbertSans_500Medium',
    sansSemibold: 'AlbertSans_600SemiBold',
    sansBold: 'AlbertSans_700Bold',

    mono: 'JetBrainsMono',
    monoMedium: 'JetBrainsMono-Medium',
} as const;

/**
 * Web-friendly font-family stacks. Use these in Tailwind / CSS where the
 * RN font identifier ("AlbertSans_400Regular") is not a real CSS family.
 */
export const FontStacks = {
    sans: "'Albert Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    serif: "'Fraunces', Georgia, 'Times New Roman', serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** Pixel sizes for the Tropic type scale. */
export const FontSize = {
    display: 36,
    kpi: 28,
    section: 20,
    title: 16,
    body: 15,
    num: 14,
    meta: 12,
    eyebrow: 11,
} as const;

export const LineHeight = {
    display: 38,
    kpi: 34,
    section: 24,
    title: 22,
    body: 23,
    num: 18,
    meta: 16,
    eyebrow: 14,
} as const;

export const FontWeight = {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
} as const;

/**
 * iOS-only letter spacing. Android's Roboto overlaps at negative tracking;
 * use 0 on Android. RN consumers get a Platform-aware helper in typography.native.ts.
 * Web consumers may use these values directly.
 */
export const LetterSpacing = {
    display: -0.8,
    kpi: -0.8,
    section: -0.3,
    title: -0.1,
    eyebrow: 1,
} as const;
