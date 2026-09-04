import { useMemo, useState } from 'react';
import { LIMITS, normalizeSgMobile } from '@/lib/rsvpLayout';
import { sendRsvpPhoneCode, checkRsvpPhoneCode } from '@/api/rsvpPublic';

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

/** The quiet button next to the mobile field — never competes with Submit. */
const secondaryBtn = (t, disabled) => ({
  padding: '10px 14px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer', color: t.ink, background: 'transparent',
  border: `1px solid ${t.line}`, borderRadius: t.r.btn, opacity: disabled ? 0.55 : 1,
});

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

export default function RsvpForm({
  fields, consentCopy, consentHash = null, submitLabel = 'RSVP', onSubmit, submitting = false, submitError = null, t, mode = 'live',
  // Mobile verification: the owner's toggle plus the field it governs. The
  // server enforces the same rule — this half is only the courtesy that stops
  // someone submitting into a refusal.
  verifyPhone = false, phoneKey = null,
  sendCode = sendRsvpPhoneCode, checkCode = checkRsvpPhoneCode,
}) {
  const [answers, setAnswers] = useState({});
  const [otp, setOtp] = useState({ stage: 'idle', code: '', busy: false, error: '', verifiedFor: '' });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [touched, setTouched] = useState(false);
  const clientErrors = useMemo(() => (touched ? validateAnswers(fields, answers, consent) : {}), [touched, fields, answers, consent]);
  const serverErrors = useMemo(() => serverErrorsByKey(submitError), [submitError]);
  const errorFor = (key) => clientErrors[key] || serverErrors[key];

  const set = (key, value) => setAnswers((prev) => ({ ...prev, [key]: value }));

  // --- mobile verification -------------------------------------------------
  const phoneValue = phoneKey ? String(answers[phoneKey] ?? '') : '';
  const phoneLocal = normalizeSgMobile(phoneValue);
  // Blank optional mobile = nothing to verify; the server agrees.
  const otpRequired = Boolean(mode === 'live' && verifyPhone && phoneKey && phoneValue.trim());
  // Bound to the NUMBER, so editing it after verifying drops back to unverified.
  const phoneVerified = Boolean(phoneLocal && otp.verifiedFor === phoneLocal);
  const otpBlocking = otpRequired && !phoneVerified;

  const setPhone = (key, value) => {
    set(key, value);
    setOtp((prev) => (prev.stage === 'idle' ? prev : { ...prev, stage: 'idle', code: '', error: '' }));
  };

  const requestCode = async () => {
    if (!phoneLocal || otp.busy) return;
    setOtp((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      await sendCode(phoneLocal);
      setOtp((prev) => ({ ...prev, stage: 'sent', busy: false, code: '', error: '' }));
    } catch (err) {
      setOtp((prev) => ({ ...prev, busy: false, error: err?.message || 'Could not send the code. Please try again.' }));
    }
  };

  const submitCode = async () => {
    const code = otp.code.trim();
    if (code.length < 6 || otp.busy) return;
    setOtp((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      await checkCode(phoneLocal, code);
      setOtp({ stage: 'verified', code: '', busy: false, error: '', verifiedFor: phoneLocal });
    } catch (err) {
      setOtp((prev) => ({ ...prev, busy: false, error: err?.message || 'That code did not verify. Please try again.' }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode !== 'live' || !onSubmit) return;
    setTouched(true);
    const errors = validateAnswers(fields, answers, consent);
    if (Object.keys(errors).length) return;
    if (otpBlocking) {
      setOtp((prev) => ({ ...prev, error: phoneLocal ? 'Please verify your mobile number first.' : 'Enter a Singapore mobile number so we can send you a code.' }));
      return;
    }
    // Echo the hash of the sentence this form displayed — the server refuses a
    // submit against wording that changed since (consent_changed).
    onSubmit({ answers: buildAnswersPayload(fields, answers), consent: true, website, ...(consentHash ? { consentHash } : {}) });
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
    ? (topCode === 'full' ? 'Sorry — this event just filled up.' : topCode === 'closed' || topCode === 'ended' ? 'RSVPs for this event have closed.' : topCode === 'consent_changed' ? 'The consent wording was updated — please read it again, tick the box, and resubmit.' : submitError.message || 'Something went wrong. Please try again.')
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
                    onChange={(e) => (f.key === phoneKey ? setPhone(f.key, e.target.value) : set(f.key, e.target.value))}
                    maxLength={f.type === 'email' ? 254 : LIMITS.answerShort}
                    style={inputStyle(bad)}
                  />
                )}
              </>
            )}
            {f.help ? <p style={helpStyle}>{f.help}</p> : null}
            {bad ? <p role="alert" style={errorStyle}>{bad}</p> : null}
            {verifyPhone && f.key === phoneKey && mode === 'live' ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {phoneVerified ? (
                  <p style={{ ...helpStyle, color: t.ink, fontWeight: 600 }}>Mobile verified.</p>
                ) : (
                  <>
                    {otp.stage === 'sent' ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label htmlFor="rsvp-otp" style={{ ...labelStyle, marginBottom: 0 }}>Code</label>
                        <input
                          id="rsvp-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={otp.code}
                          onChange={(e) => setOtp((prev) => ({ ...prev, code: e.target.value.replace(/[^0-9]/g, ''), error: '' }))}
                          style={{ ...inputStyle(false), width: 120, letterSpacing: '0.25em' }}
                        />
                        <button type="button" onClick={submitCode} disabled={otp.busy || otp.code.trim().length < 6} style={secondaryBtn(t, otp.busy || otp.code.trim().length < 6)}>
                          {otp.busy ? 'Checking…' : 'Verify'}
                        </button>
                        <button type="button" onClick={requestCode} disabled={otp.busy} style={{ ...secondaryBtn(t, otp.busy), border: 'none', textDecoration: 'underline' }}>
                          Send again
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={requestCode} disabled={otp.busy || !phoneLocal} style={secondaryBtn(t, otp.busy || !phoneLocal)}>
                        {otp.busy ? 'Sending…' : 'Send code'}
                      </button>
                    )}
                    <p style={helpStyle}>
                      {otp.stage === 'sent'
                        ? 'We sent a 6-digit code by SMS. Enter it here to confirm this is your number.'
                        : 'We will text you a 6-digit code to confirm this number. Singapore mobiles only.'}
                    </p>
                  </>
                )}
                {otp.error ? <p role="alert" style={errorStyle}>{otp.error}</p> : null}
              </div>
            ) : null}
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
        disabled={submitting || otpBlocking}
        style={{
          padding: '14px 18px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: submitting ? 'wait' : 'pointer',
          color: t.onAccent, background: t.accent, border: 'none', borderRadius: t.r.btn, opacity: submitting || otpBlocking ? 0.7 : 1,
        }}
      >
        {submitting ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}
