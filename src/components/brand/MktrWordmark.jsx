import { forwardRef } from 'react';

const SIZE_PX = { sm: 14, md: 22, lg: 34, xl: 56 };

const TERRACOTTA = '#D9542A';

/**
 * The MKTR brand wordmark: `› mktr▮` rendered in JetBrains Mono.
 *
 * The prompt glyph (›, U+203A) is always terracotta and slightly heavier
 * than the body. The body and the cursor bar inherit `currentColor`, so
 * callers control tone by setting `color` on a parent (e.g. `text-background`
 * on the dark navbar, `text-foreground` on a light page).
 *
 * The trailing cursor is a CSS rect (not the underscore character) so its
 * width/height stay consistent across font fallbacks. Set `blink` to make
 * it pulse with the terminal-style sharp on/off cadence.
 *
 * Props:
 *   size:      'sm' | 'md' | 'lg' | 'xl' | number (px)
 *   blink:     boolean — animate the cursor bar (default false)
 *   ariaLabel: override aria-label (default "MKTR")
 */
const MktrWordmark = forwardRef(function MktrWordmark(
  { size = 'md', blink = false, ariaLabel = 'MKTR', className = '', style, ...rest },
  ref
) {
  const fontSize = typeof size === 'number' ? size : (SIZE_PX[size] ?? SIZE_PX.md);

  return (
    <span
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        fontWeight: 500,
        fontSize,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      <span aria-hidden="true" style={{ fontWeight: 600, marginRight: '0.18em', color: TERRACOTTA }}>
        &#8250;
      </span>
      <span aria-hidden="true">mktr</span>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '0.5em',
          height: '0.12em',
          marginLeft: '0.06em',
          transform: 'translateY(0.36em)',
          background: 'currentColor',
          ...(blink ? { animation: 'mktr-blink 1.12s steps(2, jump-none) infinite' } : null),
        }}
      />
      {blink && (
        <style>{`@keyframes mktr-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }`}</style>
      )}
    </span>
  );
});

export default MktrWordmark;
