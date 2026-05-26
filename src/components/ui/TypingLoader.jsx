import { useEffect, useState } from 'react';

/**
 * Full-screen loading state — "› mktr▮" terminal-typing animation.
 *
 * The terracotta prompt appears instantly, `mktr` types in left-to-right
 * at TYPE_STEP_MS per char, then the cursor bar blinks with the terminal
 * sharp on/off cadence. Visual specification mirrors <MktrWordmark /> so
 * the loader and the static wordmark feel like the same mark.
 *
 * Backwards-compatible: same default export, same call signature
 * (optional `message`), so existing call sites in LeadCapture/Preview
 * and the MKTRAnimatedLogo re-export don't need any changes.
 */
const TERRACOTTA = '#D9542A';
const CREAM = '#F5F0E6';
const INK = '#1B1A17';
const TYPE_TARGET = 'mktr';
const TYPE_STEP_MS = 220;

export default function TypingLoader({ message }) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let i = 0;
    setTyped('');
    const tick = setInterval(() => {
      i += 1;
      setTyped(TYPE_TARGET.slice(0, i));
      if (i >= TYPE_TARGET.length) clearInterval(tick);
    }, TYPE_STEP_MS);
    return () => clearInterval(tick);
  }, []);

  return (
    <div
      role="status"
      aria-label="Loading MKTR"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: INK,
        color: CREAM,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        zIndex: 50,
      }}
    >
      <div
        style={{
          fontSize: 'clamp(40px, 8vw, 88px)',
          fontWeight: 500,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden="true" style={{ fontWeight: 600, marginRight: '0.18em', color: TERRACOTTA }}>&#8250;</span>
        <span aria-hidden="true">{typed}</span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '0.5em',
            height: '0.12em',
            marginLeft: '0.06em',
            transform: 'translateY(0.36em)',
            background: 'currentColor',
            animation: 'mktr-blink 1.12s steps(2, jump-none) infinite',
          }}
        />
      </div>
      {message && (
        <div style={{ marginTop: 24, fontSize: 14, color: 'rgba(245, 240, 230, 0.65)' }}>
          {message}
        </div>
      )}
      <style>{`@keyframes mktr-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }`}</style>
    </div>
  );
}
