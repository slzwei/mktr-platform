import { useRef, useState } from 'react';
/**
 * Small inspector inputs for the RSVP designer panels — the Studio's panelKit
 * look (admin-v2 tokens) on plain value/onChange props, so the panels do not
 * need the Studio's doc binder.
 */

/**
 * Image slot: pick a file (optimised in the browser before it is sent) or paste
 * a URL. Uploads are stored ABSOLUTE, because the public RSVP page is served
 * from rsvp.redeem.sg, which does not proxy /uploads.
 */
export function ImageField({ idBase, label, url, alt, onUrl, onAlt, limitUrl, limitAlt, uploadImage }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const pick = async (event) => {
    const file = event.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const { url: next, note: savedNote } = await uploadImage(file);
      onUrl(next);
      setNote(savedNote || '');
    } catch (err) {
      setError(err?.message || 'Upload failed. Please try again.');
    }
    setBusy(false);
  };

  return (
    <>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={inputRef}
            id={`${idBase}-file`}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={pick}
            data-testid={`${idBase}-file`}
          />
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : url ? 'Replace image' : 'Upload image'}
          </button>
          {url ? (
            <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={busy} onClick={() => { onUrl(''); setNote(''); setError(''); }}>
              Remove
            </button>
          ) : null}
        </div>
        {error ? <Note tone="bad">{error}</Note> : note ? <Note>{note}</Note> : null}
      </div>
      <Field
        id={`${idBase}-u`}
        label={label}
        value={url}
        onChange={(v) => { onUrl(v); setNote(''); setError(''); }}
        limit={limitUrl}
        placeholder="https://…"
        hint="Upload a picture, or paste an https:// link. Uploads are resized and converted to WebP so the page loads fast."
      />
      <Field id={`${idBase}-a`} label="Image description" value={alt} onChange={onAlt} limit={limitAlt} hint="Read aloud by screen readers." />
    </>
  );
}

export function Field({ id, label, value, onChange, limit, placeholder, disabled = false, hint, type = 'text' }) {
  const len = String(value ?? '').length;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <label htmlFor={id} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2, #5B616E)' }}>{label}</label>
        {limit ? <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: len > limit * 0.85 ? '#B97D10' : 'var(--ink-3, #9BA0AB)' }}>{len}/{limit}</span> : null}
      </div>
      <input
        id={id}
        type={type}
        className="av2-input"
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={limit}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {hint ? <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #9BA0AB)' }}>{hint}</p> : null}
    </div>
  );
}

export function AreaField({ id, label, value, onChange, limit, rows = 4, placeholder, disabled = false, hint }) {
  const len = String(value ?? '').length;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <label htmlFor={id} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2, #5B616E)' }}>{label}</label>
        {limit ? <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: len > limit * 0.85 ? '#B97D10' : 'var(--ink-3, #9BA0AB)' }}>{len}/{limit}</span> : null}
      </div>
      <textarea
        id={id}
        className="av2-input"
        rows={rows}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={limit}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
      />
      {hint ? <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #9BA0AB)' }}>{hint}</p> : null}
    </div>
  );
}

export function SelectField({ id, label, value, onChange, options, disabled = false, hint }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2, #5B616E)', marginBottom: 4 }}>{label}</label>
      <select id={id} className="av2-input" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint ? <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #9BA0AB)' }}>{hint}</p> : null}
    </div>
  );
}

export function Toggle({ id, label, checked, onChange, disabled = false, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink, #171A20)' }}>
        {label}
        {hint ? <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--ink-3, #9BA0AB)', marginTop: 2 }}>{hint}</span> : null}
      </label>
      <input id={id} type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }} />
    </div>
  );
}

export function Section({ title, children, first = false }) {
  return (
    <section style={{ padding: '14px 14px 16px', borderTop: first ? 'none' : '1px solid var(--line, #E3E6EB)' }}>
      <h4 style={{ margin: '0 0 10px', font: "600 10px ui-monospace, 'SF Mono', Menlo, monospace", letterSpacing: '.09em', color: 'var(--ink-3, #9BA0AB)', textTransform: 'uppercase' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </section>
  );
}

export function Note({ children, tone = 'info' }) {
  const colors = tone === 'warn' ? { bg: '#FFF7E6', ink: '#8A5B07' } : tone === 'bad' ? { bg: '#FBE9E7', ink: '#8F2F28' } : { bg: 'var(--surface-2, #F4F5F7)', ink: 'var(--ink-2, #5B616E)' };
  return <p style={{ margin: 0, padding: '8px 10px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.45, background: colors.bg, color: colors.ink }}>{children}</p>;
}

export const randomId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
