/**
 * Generic bottom sheet — the mobile replacement for every desktop dropdown,
 * popover and dialog on the v2 surface (design source 1694f8b2). Plain fixed
 * divs, no portal, so it stays inside the .admin-v2 subtree and inherits the
 * [data-theme] token scope — same reasoning as GlobalSearch's overlay.
 */
import { useEffect } from 'react';

export default function MobileSheet({ open, onClose, label, children, maxHeight = '84dvh' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(10, 12, 18, .5)', animation: 'av2m-fade-in .18s ease' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="av2m-sheet"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 131,
          background: 'var(--surface)', color: 'var(--ink)',
          borderRadius: '18px 18px 0 0', boxShadow: '0 -8px 40px rgba(10, 12, 18, .25)',
          animation: 'av2m-sheet-in .26s cubic-bezier(.32, .72, .35, 1)',
          maxHeight, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        }}
      >
        <div style={{ padding: '9px 0 2px', display: 'flex', justifyContent: 'center', flex: 'none' }} aria-hidden="true">
          <span style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-strong)' }} />
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 16px calc(18px + env(safe-area-inset-bottom, 0px))' }}>
          {children}
        </div>
      </div>
    </>
  );
}

/** Sheet header block: bold title + optional mono kicker below. */
export function SheetHead({ title, kicker, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0 12px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{title}</h3>
        {kicker && (
          <div className="av2-mono" style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--ink-3)', marginTop: 3, textTransform: 'uppercase' }}>
            {kicker}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/** Menu-style sheet rows (overflow actions). */
export function SheetMenuItem({ label, sub, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52,
        padding: '8px 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 12,
        marginBottom: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: danger ? 'var(--bad)' : 'var(--ink)' }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{sub}</span>}
      </span>
      <span style={{ color: 'var(--ink-3)', flex: 'none' }} aria-hidden="true">›</span>
    </button>
  );
}

/** Destructive / decisive confirm body for a sheet. */
export function SheetConfirm({ title, body, label, danger = true, onConfirm, onCancel }) {
  return (
    <>
      <div style={{ padding: '4px 0 16px' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{title}</h3>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.55 }}>{body}</div>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        style={{
          width: '100%', height: 48, border: 'none', borderRadius: 12, cursor: 'pointer',
          fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700,
          background: danger ? 'var(--bad)' : 'var(--accent)', color: '#fff',
        }}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{
          width: '100%', height: 44, marginTop: 8, background: 'var(--surface-2)', color: 'var(--ink-2)',
          border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700,
        }}
      >
        Cancel
      </button>
    </>
  );
}
