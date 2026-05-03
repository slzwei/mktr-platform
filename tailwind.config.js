/**
 * Tailwind configuration for mktr-platform.
 *
 * Theme (colors, fonts, radii) is supplied by the Tropic design system preset
 * at src/design/tailwind-preset.cjs — regenerate with `npm run sync:design`
 * from the lyfe-master root.
 *
 * Local extensions below add admin-surface motion tokens. They intentionally
 * live outside the generated preset so they don't get clobbered on resync
 * and stay scoped to this app.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
    presets: [require('./src/design/tailwind-preset.cjs')],
    content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
    plugins: [require('tailwindcss-animate')],
    theme: {
        extend: {
            // Tropic motion language: 200ms micro / 300ms base / 600ms reveal,
            // exponential ease-out only (never bounce/elastic — dated & tacky).
            transitionDuration: {
                micro: '200ms',
                base: '300ms',
                reveal: '600ms',
            },
            transitionTimingFunction: {
                'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
                'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
            },
            keyframes: {
                'fade-in-up': {
                    '0%': { opacity: '0', transform: 'translateY(4px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'fade-in': {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
            },
            animation: {
                'fade-in-up': 'fade-in-up 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
                'fade-in': 'fade-in 200ms cubic-bezier(0.25, 1, 0.5, 1) both',
            },
        },
    },
};
