import { getPath } from '../useStudioDoc';

/**
 * Shared inspector primitives for the Studio rail panels (Studio PR 3) —
 * the mock's light "Control Room" inspector language on the admin-v2 tokens,
 * plus the LIMITS character counters (warn at 85%).
 */

export function PanelSection({ title, children, first = false }) {
  return (
    <section style={{ padding: '14px 16px 16px', borderTop: first ? 'none' : '1px solid var(--line, #E3E6EB)' }}>
      <h4
        style={{
          margin: '0 0 10px',
          font: "600 10px ui-monospace, 'SF Mono', Menlo, monospace",
          letterSpacing: '.09em',
          color: 'var(--ink-3, #9BA0AB)',
        }}
      >
        {title}
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </section>
  );
}

export function FieldLabel({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2, #5B616E)', marginBottom: 4 }}>
      {children}
    </label>
  );
}

function Counter({ value, limit }) {
  if (!limit) return null;
  const len = String(value ?? '').length;
  const warn = len > limit * 0.85;
  return (
    <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: warn ? '#B97D10' : 'var(--ink-3, #9BA0AB)' }}>
      {len}/{limit}
    </span>
  );
}

/** Build a binder over the Studio doc: bind(path, limit) → input props + counter. */
export function makeBind(doc, setPath) {
  return function bind(path, limit) {
    const raw = getPath(doc, path);
    const value = raw == null ? '' : String(raw);
    return {
      value,
      onChange: (e) => {
        let next = e?.target ? e.target.value : e;
        if (limit && typeof next === 'string') next = next.slice(0, limit);
        setPath(path, next);
      },
      counter: <Counter value={value} limit={limit} />,
    };
  };
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  height: 32,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--line-strong, #C6CAD2)',
  background: 'var(--surface, #fff)',
  color: 'var(--ink, #171A20)',
  fontSize: 12.5,
};

/** Optional per-field AI affordance (Studio PR 4) — a tiny ✦ beside the
 * counter; renders only when the field is given an `onSuggest`. Exported for
 * panels whose control isn't a panelKit field (e.g. the inclusions textarea). */
export function SuggestButton({ onSuggest, label }) {
  if (!onSuggest) return null;
  return (
    <button
      type="button"
      onClick={onSuggest}
      aria-label={`AI suggest — ${label}`}
      title="Write it for me"
      style={{
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        padding: '0 2px',
        fontSize: 11,
        lineHeight: 1,
        color: 'var(--accent, #4059C8)',
      }}
    >
      ✦
    </button>
  );
}

export function TextField({ id, label, bind, placeholder, onSuggest }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <SuggestButton onSuggest={onSuggest} label={label} />
          {bind.counter}
        </span>
      </div>
      <input id={id} type="text" style={inputStyle} value={bind.value} onChange={bind.onChange} placeholder={placeholder} />
    </div>
  );
}

export function TextAreaField({ id, label, bind, rows = 4, placeholder, onSuggest }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <SuggestButton onSuggest={onSuggest} label={label} />
          {bind.counter}
        </span>
      </div>
      <textarea
        id={id}
        rows={rows}
        style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.5 }}
        value={bind.value}
        onChange={bind.onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

export function Seg({ label, options, value, onChange, ariaLabel }) {
  return (
    <div>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div role="group" aria-label={ariaLabel || label} style={{ display: 'flex', gap: 2, background: 'var(--surface-2, #F4F5F7)', padding: 3, borderRadius: 9, width: 'fit-content' }}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onChange(o.value)}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 600,
                color: active ? 'var(--ink, #171A20)' : 'var(--ink-2, #5B616E)',
                background: active ? 'var(--surface, #fff)' : 'transparent',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ToggleRow({ id, label, hint, checked, onChange }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink, #171A20)' }}>{label}</span>
        {hint ? <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #9BA0AB)', marginTop: 1 }}>{hint}</span> : null}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 18,
          borderRadius: 999,
          flexShrink: 0,
          background: checked ? 'var(--accent, #4059C8)' : 'var(--line-strong, #C6CAD2)',
          position: 'relative',
          transition: 'background 140ms ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 14 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 140ms ease',
          }}
        />
      </span>
    </label>
  );
}

export function WarnNote({ children, tone = 'warn' }) {
  const colors = tone === 'bad' ? ['#FBE9E7', '#8F2F28'] : tone === 'info' ? ['#EFF1F4', '#5B616E'] : ['#F8EED8', '#8A5B07'];
  return (
    <div style={{ background: colors[0], color: colors[1], borderRadius: 8, padding: '7px 10px', fontSize: 11, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}
