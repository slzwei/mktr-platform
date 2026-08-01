/**
 * Fixed bottom bars for mobile screens (design source 1694f8b2):
 * - MobileActionBar: primary action + ⋯ overflow, floats above the tab bar
 *   on profile/detail screens.
 * - MobileSelectBar: ink-filled multi-select bar that REPLACES the tab bar
 *   while a selection exists (✕ · count · actions).
 * - MobileFooterBar: full-width fixed footer for editor screens (live count
 *   left, one primary right) — used where the tab bar is hidden.
 */

export function MobileActionBar({ children }) {
  return (
    <div
      style={{
        position: 'fixed', bottom: 'calc(59px + env(safe-area-inset-bottom, 0px))', left: 0, right: 0,
        zIndex: 99, padding: '8px 12px 10px', display: 'flex', gap: 8, boxSizing: 'border-box',
        background: 'linear-gradient(to top, var(--canvas) 62%, transparent)', pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flex: 1, pointerEvents: 'auto' }}>{children}</div>
    </div>
  );
}

export function MobilePrimaryBtn({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, height: 48, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none',
        borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-ui)',
        fontSize: 14, fontWeight: 700, boxShadow: 'var(--shadow)', opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function MobileMoreBtn({ onClick, label = 'More actions' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 48, height: 48, flex: 'none', background: 'var(--surface)', border: '1px solid var(--line-strong)',
        borderRadius: 12, cursor: 'pointer', color: 'var(--ink)', fontSize: 17, fontWeight: 700, boxShadow: 'var(--shadow)',
      }}
    >
      ⋯
    </button>
  );
}

export function MobileSelectBar({ count, onCancel, actions = [] }) {
  return (
    <div
      className="av2m-selectbar"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 105,
        background: 'var(--ink)', color: 'var(--canvas)',
        padding: '10px 12px calc(12px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', alignItems: 'center', gap: 6, boxSizing: 'border-box',
        animation: 'av2m-slide-up .2s ease',
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel selection"
        style={{ width: 40, height: 40, flex: 'none', background: 'transparent', border: '1px solid var(--ink-2)', borderRadius: 10, color: 'var(--canvas)', cursor: 'pointer', fontSize: 14 }}
      >
        ✕
      </button>
      <span className="av2-mono" style={{ fontSize: 11, fontWeight: 600, flex: 'none', padding: '0 4px' }}>{count}</span>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 6, overflowX: 'auto', paddingLeft: 4 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            disabled={a.disabled}
            style={{
              height: 40, flex: 'none', padding: '0 11px', borderRadius: 10, cursor: a.disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              background: a.tone === 'danger' ? 'var(--bad)' : a.tone === 'primary' ? 'var(--canvas)' : 'transparent',
              color: a.tone === 'danger' ? '#fff' : a.tone === 'primary' ? 'var(--ink)' : 'var(--canvas)',
              border: a.tone ? '1px solid transparent' : '1px solid var(--ink-2)',
              opacity: a.disabled ? 0.5 : 1,
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MobileFooterBar({ left, button }) {
  return (
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--surface)', borderTop: '1px solid var(--line)',
        padding: '10px 14px calc(12px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', alignItems: 'center', gap: 10, boxSizing: 'border-box',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{left}</span>
      {button}
    </div>
  );
}
