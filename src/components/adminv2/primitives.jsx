/**
 * Switchboard primitives — the small set of composable pieces every v2 screen
 * uses. All token-driven via src/styles/adminV2.css; state is never color
 * alone (glyph/label rides along).
 */
import { PERIODS } from '@/lib/adminV2/constants';

export function Card({ title, meta, action, children, span, style }) {
  return (
    <section className="av2-card" style={{ gridColumn: span ? `span ${span}` : undefined, ...style }}>
      {(title || action) && (
        <div className="av2-card-head">
          <h2 className="av2-h2" style={{ margin: 0, flex: 1 }}>{title}</h2>
          {meta && <span className="av2-caption">{meta}</span>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Chip({ tone = '', children, glyph }) {
  return (
    <span className={`av2-chip ${tone ? `av2-chip--${tone}` : ''}`.trim()}>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}

export function PeriodSwitch({ value, onChange }) {
  return (
    <div className="av2-seg" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button key={p} type="button" aria-pressed={value === p} onClick={() => onChange(p)}>
          {p}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ height = 32, width = '100%', style }) {
  return <div className="av2-skeleton" aria-hidden="true" style={{ height, width, ...style }} />;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center' }}>
      <div className="av2-qicon" style={{ background: 'var(--bad-soft)', color: 'var(--bad)', margin: '0 auto 10px' }} aria-hidden="true">▲</div>
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>Couldn’t load this panel</div>
      <div className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
        {error?.message || 'Request failed'}
      </div>
      {onRetry && (
        <button type="button" className="av2-btn av2-btn--sm" style={{ marginTop: 12 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon = '○', title, hint, action }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center' }}>
      <div className="av2-qicon" style={{ background: 'var(--surface-2)', color: 'var(--ink-3)', margin: '0 auto 10px' }} aria-hidden="true">{icon}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
      {hint && <div className="av2-caption" style={{ marginTop: 4 }}>{hint}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

/**
 * Loading/error/empty blocks inside a role="table" container must still be
 * row/cell structured — bare children of a table role get flattened or
 * mis-announced by screen readers.
 */
export function StateRow({ children }) {
  return (
    <div role="row">
      <div role="cell" style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

/** Page header: title + mono meta line left, actions right (max one primary). */
export function PageHeader({ title, meta, children }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <h1 className="av2-h1" style={{ margin: 0 }}>{title}</h1>
        {meta && <div className="av2-meta" style={{ marginTop: 4 }}>{meta}</div>}
      </div>
      {children}
    </header>
  );
}
