import { useEffect, useRef, useState } from 'react';
import { buildJumpGroups, jumpStateById } from './studioJumpStates';

/**
 * Funnel-state jumper (Studio PR 3) — the mock's grouped dropdown with
 * disabled reasons, plus the reset control ("Replay the funnel from the top").
 * Lives in the canvas header (parent document, dark chrome).
 */
export default function FunnelJumper({ doc, campaign, jump, onPick, onReset }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups = buildJumpGroups(doc, campaign);
  const currentLabel = jumpStateById(jump)?.label || 'Default';

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 11px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,.16)',
          background: 'rgba(255,255,255,.07)',
          color: 'rgba(255,255,255,.85)',
          fontSize: 11.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        State: {currentLabel} <span aria-hidden="true">▾</span>
      </button>
      <button
        type="button"
        onClick={onReset}
        title="Replay the funnel from the top"
        aria-label="Reset preview state"
        style={{
          padding: '6px 9px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,.16)',
          background: 'transparent',
          color: 'rgba(255,255,255,.7)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        ↺
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Preview funnel state"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            width: 250,
            maxHeight: 420,
            overflowY: 'auto',
            background: '#1E2026',
            border: '1px solid rgba(255,255,255,.14)',
            borderRadius: 10,
            boxShadow: '0 18px 50px rgba(0,0,0,.5)',
            padding: 6,
          }}
        >
          {groups.map((g) => (
            <div key={g.name}>
              <div
                style={{
                  padding: '7px 9px 3px',
                  font: "600 9.5px ui-monospace, 'SF Mono', Menlo, monospace",
                  letterSpacing: '.09em',
                  color: 'rgba(255,255,255,.4)',
                }}
              >
                {g.name.toUpperCase()}
              </div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.disabled ? item.reason : undefined}
                  onClick={() => {
                    setOpen(false);
                    onPick(item.id);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    gap: 8,
                    padding: '7px 9px',
                    borderRadius: 7,
                    border: 'none',
                    textAlign: 'left',
                    fontSize: 12,
                    cursor: item.disabled ? 'not-allowed' : 'pointer',
                    color: item.disabled ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.85)',
                    background: (jump || 'default') === item.id ? 'rgba(64,89,200,.35)' : 'transparent',
                  }}
                >
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.disabled ? <span style={{ fontSize: 9.5, opacity: 0.7 }}>off</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
