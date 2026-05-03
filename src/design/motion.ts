/**
 * Tropic — animation timing tokens (milliseconds).
 *
 * Use exponential ease-out curves (ease-out-quart / ease-out-quint) when animating,
 * never bounce/elastic. Animate transform + opacity only, never layout properties.
 */

export const ANIM = {
    MICRO: 200, // hover, press, toggle
    TRANSITION: 300, // tab switch, modal slide
    REVEAL: 600, // progress bar, entrance
} as const;

export type MotionToken = keyof typeof ANIM;
