/**
 * The Lead Profile page's shared presentational primitives (P3-3).
 *
 * Four small pieces the page and the scoring card both reach for. They were
 * scattered through a 1,966-line module between the components that used them,
 * which is how a "small shared bit" becomes invisible and gets re-invented.
 *
 * Moved verbatim; nothing visual changed.
 */
import { useState } from 'react';

/** Themed hover hint — dotted underline invites the hover; the bubble uses the
 * page's own surface tokens instead of the native OS tooltip. */
export function HoverHint({ label, hint, underline = true, color, ariaLabel }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      aria-label={ariaLabel || undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Focusable because the hint is now the ONLY place several of these
      // reasons exist — the scoring card moved them off the row. A hint you
      // can only reach with a mouse is a hint a keyboard user cannot read at
      // all. Escape closes it without moving focus, so a reader who opened one
      // by tabbing is not trapped reading it.
      tabIndex={hint ? 0 : undefined}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <span
        style={{
          ...(underline ? { textDecoration: 'underline dotted', textDecorationColor: 'var(--ink-3)', textUnderlineOffset: 3 } : {}),
          ...(color ? { color } : {}),
        }}
      >{label}</span>
      {open && hint && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', left: 0, bottom: 'calc(100% + 7px)', zIndex: 40,
            width: 230, padding: '8px 11px', background: 'var(--surface)',
            border: '1px solid var(--line)', borderRadius: 9,
            boxShadow: '0 10px 28px rgba(0,0,0,.3)',
            fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-2)',
            fontFamily: 'var(--font-ui)', fontWeight: 500,
            whiteSpace: 'normal', textAlign: 'left', textDecoration: 'none',
          }}
        >{hint}</span>
      )}
    </span>
  );
}

export const FAMILY_TILE = {
  signup: { glyph: '●', bg: 'var(--accent-soft)', fg: 'var(--accent-text)' },
  assignment: { glyph: '→', bg: 'var(--accent-soft)', fg: 'var(--accent-text)' },
  unassignment: { glyph: '←', bg: 'var(--hold-soft)', fg: 'var(--hold)' },
  boost: { glyph: '◆', bg: 'var(--hold-soft)', fg: 'var(--hold)' },
  reward: { glyph: '◆', bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  outcome: { glyph: '★', bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  consent: { glyph: '✋', bg: 'var(--hold-soft)', fg: 'var(--hold)' },
  screening: { glyph: '✦', bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  delivery: { glyph: '✉', bg: 'var(--surface-2)', fg: 'var(--ink-2)' },
  arrival: { glyph: '○', bg: 'var(--surface-2)', fg: 'var(--ink-3)' },
  generic: { glyph: '○', bg: 'var(--surface-2)', fg: 'var(--ink-2)' },
};




// ── small presentational pieces ─────────────────────────────────────────────

export function KvRow({ label, mono = true, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '4px 0', alignItems: 'baseline' }}>
      <span style={{ width: 96, flex: 'none', color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)', color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

export function Disclosure({ label, count, children, indent = 34 }) {
  return (
    <details style={{ borderTop: '1px solid var(--line)' }}>
      <summary style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>
        <span className="disc-caret" aria-hidden="true" style={{ color: 'var(--ink-3)', display: 'inline-block', transition: 'transform .12s ease' }}>▸</span>
        {label}
        <span style={{ flex: 1 }} />
        {count && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{count}</span>}
      </summary>
      <div style={{ padding: `2px 16px 12px ${indent}px` }}>{children}</div>
    </details>
  );
}

export function GlyphTile({ family, size = 22 }) {
  const t = FAMILY_TILE[family] || FAMILY_TILE.generic;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, flex: 'none', borderRadius: size > 24 ? 9 : 7, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size > 24 ? 13 : 11 }}>
      {t.glyph}
    </span>
  );
}
