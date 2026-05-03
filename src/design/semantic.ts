/**
 * Semantic aliases that map shadcn / CSS-var conventions onto Tropic tokens.
 * Used by scripts/build.ts to emit :root / .dark HSL triplets for web consumers.
 *
 * The key is the shadcn semantic CSS variable name (without the -- prefix).
 * The value is a path into Colors: { scheme: 'light' | 'dark', token: <ColorToken> }
 * or a literal hex string.
 *
 * Shape is shared with ./colors.ts — light and dark are resolved at build time.
 */

import { Colors } from './colors';

type SemanticMap = Record<string, { light: string; dark: string }>;

const pair = (lightKey: keyof typeof Colors['light'], darkKey?: keyof typeof Colors['dark']) => ({
    light: Colors.light[lightKey] as string,
    dark: Colors.dark[(darkKey ?? lightKey) as keyof typeof Colors['dark']] as string,
});

// shadcn-compatible semantic tokens. Every CSS variable shadcn/Radix primitives
// expect is included so the existing mktr-platform UI keeps working after the
// palette swap — only the hex values change.
export const Semantic: SemanticMap = {
    // Page surfaces
    background: pair('background'),
    foreground: pair('textPrimary'),

    // Card surfaces
    card: pair('cardBackground'),
    'card-foreground': pair('textPrimary'),

    // Popover surfaces
    popover: pair('surfaceElevated'),
    'popover-foreground': pair('textPrimary'),

    // Primary (Tropic terracotta)
    primary: pair('accent'),
    'primary-foreground': pair('textInverse'),

    // Secondary surfaces (tint on cream, warm-dark in dark mode)
    secondary: pair('tintTerra'),
    'secondary-foreground': pair('accentDark', 'accent'),

    // Muted surfaces (sage tint)
    muted: pair('tintSage'),
    'muted-foreground': pair('textSecondary'),

    // Accent hover (same as secondary by convention)
    accent: pair('tintTerra'),
    'accent-foreground': pair('accentDark', 'accent'),

    // Destructive
    destructive: pair('danger'),
    'destructive-foreground': pair('textInverse'),

    // Info (dusty slate-blue) — non-shadcn-standard but useful for status dots + callouts
    info: pair('info'),
    'info-foreground': pair('textInverse'),

    // Success (sage) — non-shadcn-standard
    success: pair('success'),
    'success-foreground': pair('textInverse'),

    // Warning (butter) — non-shadcn-standard
    warning: pair('warning'),
    'warning-foreground': pair('textInverse'),

    // Chrome
    border: pair('border'),
    input: pair('inputBorder'),
    ring: pair('accent'),

    // Chart palette — Tropic semantic colors
    'chart-1': pair('accent'), // terracotta (primary series)
    'chart-2': pair('success'), // sage
    'chart-3': pair('info'), // dusty slate-blue
    'chart-4': pair('warning'), // butter
    'chart-5': pair('statusProposed'), // dusty plum

    // Sidebar (shadcn convention)
    'sidebar-background': pair('surfacePrimary'),
    'sidebar-foreground': pair('textSecondary'),
    'sidebar-primary': pair('accent'),
    'sidebar-primary-foreground': pair('textInverse'),
    'sidebar-accent': pair('tintTerra'),
    'sidebar-accent-foreground': pair('accentDark', 'accent'),
    'sidebar-border': pair('border'),
    'sidebar-ring': pair('accent'),
};

export const Radius = {
    lg: '0.75rem',
} as const;
