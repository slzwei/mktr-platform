/**
 * Tropic — 4pt spacing grid and icon sizes.
 */

export const SPACING = {
    XS: 4,
    SM: 8,
    MD: 12,
    LG: 16,
    XL: 20,
    XXL: 24,
} as const;

export const ICON = {
    SM: 16,
    MD: 20,
    LG: 24,
    XL: 32,
} as const;

export type SpacingToken = keyof typeof SPACING;
export type IconToken = keyof typeof ICON;
