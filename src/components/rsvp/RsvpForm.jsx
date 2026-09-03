import { useMemo, useState } from 'react';
import { LIMITS } from '@/lib/rsvpLayout';

/**
 * The RSVP form — the ONE interactive piece of an event page (docs/plans/
 * rsvp-pages.md §6). Renders the event's own field defs (nine types), the
 * server-rendered consent sentence, a honeypot, and submits
 * `{ answers, consent: true, website }` — exactly the public POST contract.
 *
 * Client validation is a courtesy (required / email shape / option
 * membership); the server re-validates everything against the same defs and
 * its `errors[]` (field paths like `answers.f_abcd`) are mapped back inline.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAnswers(fields, answers, consent) {
  const errors = {};
  for (const f of fields) {
    const v = answers[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (f.required && (empty || (f.type === 'checkbox' && v !== true))) {
      errors[f.key] = f.type === 'checkbox' ? 'Please tick this box' : 'This is required';
      continue;
    }
    if (empty) continue;
    if (f.type === 'email' && !EMAIL_RE.test(String(v).trim())) errors[f.key] = 'Enter a valid email address';
    if (f.type === 'number' && !Number.isFinite(Number(v))) errors[f.key] = 'Enter a number';
    if (f.type === 'text' && String(v).length > LIMITS.answerShort) errors[f.key] = `Keep this under ${LIMITS.answerShort} characters`;
    if (f.type === 'textarea' && String(v).length > LIMITS.answerLong) errors[f.key] = `Keep this under ${LIMITS.answerLong} characters`;
  }
  if (!consent) errors.consent = 'Please agree so we can save your RSVP';
  return errors;
}

/** Shape the controlled state into the wire payload: numbers numeric, empties dropped. */
export function buildAnswersPayload(fields, answers) {
  const out = {};
  for (const f of fields) {
    const v = answers[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === 'checkbox') {
      out[f.key] = v === true;
    } else if (f.type === 'multiselect') {
      if (Array.isArray(v) && v.length) out[f.key] = v;
    } else {
      out[f.key] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

function serverErrorsByKey(submitError) {
  const map = {};
  for (const e of submitError?.data?.errors || []) {
    const key = String(e.field || '').replace(/^answers\./, '');
    if (key && !map[key]) map[key] = e.message || 'Check this answer';
  }
  return map;
}

export default function RsvpForm({ fields, consentCopy, submitLabel = 'RSVP', onSubmit, submitting = false, submitError = null, t, mode = 'live' }) {
  const [answers, setAnswers] = useState({});
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [touched, setTouched] = useState(false);
  const clientErrors = useMemo(() => (touched ? validateAnswers(fields, answers, consent) : {}), [touched, fields, answers, consent]);
  const serverErrors = useMemo(() => serverErrorsByKey(submitError), [submitError]);
  const errorFor = (key) => clientErrors[key] || serverErrors[key];

  const set = (key, value) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode !== 'live' || !onSubmit) return;
    setTouched(true);
    const errors = validateAnswers(fields, answers, consent);
    if (Object.keys(errors).length) return;
    onSubmit({ answers: buildAnswersPayload(fields, answers), consent: true, website });
  };

  const inputStyle = (bad) => ({
    width: '100%', boxSizing: 'border-box', padding: '11px 13px', fontSize: 16, fontFamily: 'inherit',
    color: t.ink, background: t.inputBg, border: `1px solid ${bad ? t.danger : t.line}`, borderRadius: t.r.input, outline: 'none',
  });
  const labelStyle = { display: 'block', fontSize: 13.5, fontWeight: 600, color: t.ink, marginBottom: 6 };
  const helpStyle = { fontSize: 12.5, color: t.muted, margin: '5px 0 0' };
  const errorStyle = { fontSize: 12.5, color: t.danger, margin: '5px 0 0' };
  const topCode = submitError?.data?.code;
  const topMessage = submitError && !Object.keys(serverErrors).length
    ? (topCode === 'full' ? 'Sorry — this event just filled up.' : topCode === 'closed' || topCode === 'ended' ? 'RSVPs for this event have closed.' : submitError.message || 'Something went wrong. Please try again.')
    : null;

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="RSVP form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {fields.map((f) => {
        const id = `rsvp-f-${f.key}`;
        const bad = errorFor(f.key);
        const value = answers[f.key];
        const req = f.required ? <span aria-hidden="true" style={{ color: t.danger }}> *</span> : null;
        return (
          <div key={f.key}>
            {f.type === 'checkbox' ? (
              <label htmlFor={id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: t.ink, cursor: 'pointer' }}>
                <input id={id} type="checkbox" checked={value === true} onChange={(e) => set(f.key, e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: t.accent }} />
                <span>{f.label}{req}</span>
              </label>
            ) : f.type === 'multiselect' ? (
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={labelStyle}>{f.label}{req}</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(f.options || []).map((opt) => {
                    const checked = Array.isArray(value) && value.includes(opt);
                    return (
                      <label key={opt} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14.5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          name={f.key}
                          value={opt}
                          checked={checked}
                          onChange={() => set(f.key, checked ? value.filter((o) => o !== opt) : [...(Array.isArray(value) ? value : []), opt])}
                          style={{ width: 18, height: 18, accentColor: t.accent }}
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <>
                <label htmlFor={id} style={labelStyle}>{f.label}{req}</label>
                {f.type === 'textarea' ? (
                  <textarea id={id} rows={4} value={value || ''} onChange={(e) => set(f.key, e.target.value)} maxLength={LIMITS.answerLong} style={{ ...inputStyle(bad), resize: 'vertical' }} />
                ) : f.type === 'select' ? (
                  <select id={id} value={value || ''} onChange={(e) => set(f.key, e.target.value)} style={inputStyle(bad)}>
                    <option value="">Choose one</option>
                    {(f.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input
                    id={id}
                    type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined}
                    autoComplete={f.key === 'name' ? 'name' : f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'off'}
                    value={value || ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    maxLength={f.type === 'email' ? 254 : LIMITS.answerShort}
                    style={inputStyle(bad)}
                  />
                )}
              </>
            )}
            {f.help ? <p style={helpStyle}>{f.help}</p> : null}
            {bad ? <p role="alert" style={errorStyle}>{bad}</p> : null}
          </div>
        );
      })}

      {/* Honeypot: hidden from people, filled by bots; the server ignores such submissions. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="rsvp-website">Website</label>
        <input id="rsvp-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <label htmlFor="rsvp-consent" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45, color: t.bodyText, cursor: 'pointer' }}>
        <input id="rsvp-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, flex: 'none', accentColor: t.accent }} />
        <span>{consentCopy}</span>
      </label>
      {errorFor('consent') ? <p role="alert" style={{ ...errorStyle, marginTop: -8 }}>{errorFor('consent')}</p> : null}
      {topMessage ? <p role="alert" style={{ ...errorStyle, fontSize: 14 }}>{topMessage}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: '14px 18px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: submitting ? 'wait' : 'pointer',
          color: t.onAccent, background: t.accent, border: 'none', borderRadius: t.r.btn, opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}
