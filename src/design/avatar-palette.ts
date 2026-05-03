/**
 * Tropic — deterministic avatar colors. Warm palette, one cool note (sage)
 * for visual differentiation across large lists.
 */

export const AVATAR_COLORS = [
    '#D6552B', // Terracotta — flagship accent
    '#A5623C', // Clay / burnt umber
    '#B27AAE', // Dusty plum — warm-cool bridge
    '#7A8C6B', // Sage — one cool note
    '#C89B3C', // Ochre / butter
    '#9C5E6B', // Dusty rose
] as const;

export const PA_MANAGER_COLORS = [
    '#D6552B',
    '#A5623C',
    '#B27AAE',
    '#7A8C6B',
    '#C89B3C',
] as const;

/** Deterministic avatar color from a name string. */
export function getAvatarColor(name: string): string {
    if (!name || name.length === 0) return AVATAR_COLORS[0];
    return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
