import { useEffect, useRef, useState } from 'react';
import { normalizeSgMobile } from '@/lib/rsvpLayout';

/**
 * The RSVP page's mobile row + inline verification panel.
 *
 * Deliberately the SAME choreography as the lead-capture funnel
 * (components/campaigns/signup/OTPVerification.jsx + the phone row in
 * FieldRenderer.jsx), rendered in the RSVP theme instead of the campaign one:
 *
 *   +65 [ 9123 4567 ]  ( Verify )      ← pill button beside the field
 *   ┌───────────────────────────────┐  ← panel slides down beneath it
 *   │ Enter the 6-digit code …  Edit │
 *   │ [ 6-digit code ]     ( Verify )│
 *   │ Resend code in 27s             │
 *   └───────────────────────────────┘
 *   +65 [ 9123 4567 ]  ( ✓ Verified ) ← panel collapses, badge takes over
 *
 * Details that matter and are easy to lose: one paste-friendly input (not six
 * boxes) with autocomplete="one-time-code" so iOS offers the code in the
 * keyboard bar; type="text" so a leading zero survives; auto-verify on the
 * sixth digit with the button as fallback; the number locked while a code is
 * outstanding, with "Edit" to go back; a resend cooldown.
 */

const CODE_LEN = 6;
const RESEND_SECONDS = 30;

/** 91234567 → "9123 4567" (display only; the value stays digits). */
export const displaySgMobile = (digits) => {
  const d = String(digits || '').replace(/[^0-9]/g, '').slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
};

function Tick({ color, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7L6 10L11 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RsvpPhoneVerify({
  id, label, required, help, value, onChange, fieldError, t,
  inert = false, sendCode, checkCode, onVerifiedChange,
}) {
  const [stage, setStage] = useState('idle'); // idle | pending | verified
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');       // '' | 'sending' | 'verifying'
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [tick, setTick] = useState(false);
  const codeRef = useRef(null);

  const digits = String(value || '').replace(/[^0-9]/g, '').slice(0, 8);
  const local = normalizeSgMobile(digits);
  const canSend = Boolean(local) && !cooldown && busy !== 'sending' && !inert;

  useEffect(() => {
    if (!cooldown) return undefined;
    const id2 = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id2);
  }, [cooldown]);

  const reset = (next) => {
    setStage(next);
    setCode('');
    setError('');
    onVerifiedChange?.(next === 'verified' ? local : null);
  };

  const send = async () => {
    if (!canSend) return;
    setBusy('sending');
    setError('');
    try {
      await sendCode(local);
      setStage('pending');
      setCode('');
      setCooldown(RESEND_SECONDS);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (err) {
      // A 429 is the shared limiter or the per-number daily cap; both want a wait.
      if (err?.status === 429) setCooldown(600);
      setError(err?.message || 'We could not send the code. Please try again.');
    }
    setBusy('');
  };

  const verify = async (entered) => {
    const c = String(entered ?? code).trim();
    if (c.length !== CODE_LEN || busy || inert) return;
    setBusy('verifying');
    setError('');
    try {
      await checkCode(local, c);
      setTick(true);
      // Hold on the tick, then collapse into the badge — same beat as the funnel.
      setTimeout(() => { setTick(false); reset('verified'); }, 750);
    } catch (err) {
      setError(err?.message || 'That code did not verify. Please try again.');
      setBusy('');
      return;
    }
    setBusy('');
  };

  const onCode = (raw) => {
    const next = raw.replace(/[^0-9]/g, '').slice(0, CODE_LEN);
    setCode(next);
    setError('');
    if (next.length === CODE_LEN) verify(next);
  };

  const locked = stage !== 'idle';
  const pill = t.r.input;
  const control = {
    height: 50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    padding: '0 20px', fontSize: 14.5, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
    border: 'none', borderRadius: t.r.btn, minWidth: 104,
  };

  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: t.ink, marginBottom: 6 }}>
        {label}{required ? <span aria-hidden="true" style={{ color: t.danger }}> *</span> : null}
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
              fontSize: 16, color: locked ? t.muted : t.bodyText, pointerEvents: 'none',
            }}
          >
            +65
          </span>
          <input
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="9123 4567"
            maxLength={9}
            value={displaySgMobile(digits)}
            disabled={locked}
            aria-invalid={fieldError ? 'true' : undefined}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
            style={{
              width: '100%', boxSizing: 'border-box', height: 50, padding: '0 13px 0 58px',
              fontSize: 16, fontFamily: 'inherit', color: t.ink,
              background: locked ? t.disabledBg : t.inputBg, colorScheme: t.dark ? 'dark' : 'light',
              border: `1px solid ${fieldError ? t.danger : t.line}`, borderRadius: pill, outline: 'none',
            }}
          />
        </div>

        {stage === 'verified' ? (
          <div style={{ ...control, background: `${t.success}22`, color: t.success, cursor: 'default' }}>
            <Tick color={t.success} />
            <span>Verified</span>
          </div>
        ) : stage === 'idle' ? (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            style={{
              ...control,
              cursor: canSend ? 'pointer' : 'not-allowed',
              background: canSend ? t.accent : t.disabledBg,
              color: canSend ? t.onAccent : t.onDisabled,
            }}
          >
            {busy === 'sending' ? 'Sending…' : cooldown ? `Wait ${cooldown}s` : 'Verify'}
          </button>
        ) : null}
      </div>

      {help ? <p style={{ fontSize: 12.5, color: t.muted, margin: '5px 0 0' }}>{help}</p> : null}
      {fieldError ? <p role="alert" style={{ fontSize: 12.5, color: t.danger, margin: '5px 0 0' }}>{fieldError}</p> : null}

      {stage === 'pending' ? (
        <div style={{ marginTop: 12, padding: 16, background: t.modal, border: `1px solid ${t.line}`, borderRadius: t.r.media }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: t.bodyText }}>
              Enter the 6-digit code we sent by SMS to{' '}
              <span style={{ fontWeight: 700, color: t.ink, whiteSpace: 'nowrap' }}>+65 {displaySgMobile(digits)}</span>
            </p>
            <button
              type="button"
              onClick={() => reset('idle')}
              disabled={tick}
              style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: tick ? 'default' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', color: t.muted, textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Edit
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <input
              ref={codeRef}
              id={`${id}-code`}
              aria-label="Verification code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              maxLength={CODE_LEN}
              value={code}
              disabled={busy === 'verifying' || tick}
              onChange={(e) => onCode(e.target.value)}
              style={{
                flex: 1, minWidth: 0, height: 50, padding: '0 20px', fontSize: 16, fontFamily: 'inherit',
                letterSpacing: code ? '0.3em' : 'normal', color: t.ink, background: t.inputBg,
                colorScheme: t.dark ? 'dark' : 'light',
                border: `1px solid ${error ? t.danger : t.line}`, borderRadius: pill, outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => verify()}
              disabled={code.length !== CODE_LEN || busy === 'verifying' || tick}
              style={{
                ...control,
                background: tick ? t.success : t.accent,
                color: tick ? t.onAccent : t.onAccent,
                cursor: code.length === CODE_LEN && !tick ? 'pointer' : 'not-allowed',
                opacity: tick || code.length === CODE_LEN ? 1 : 0.55,
              }}
            >
              {tick ? (<><Tick color={t.onAccent} size={16} />Verified</>) : busy === 'verifying' ? 'Verifying…' : 'Verify'}
            </button>
          </div>

          {error ? <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: t.danger }}>{error}</p> : null}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={send}
              disabled={!canSend || tick}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: canSend && !tick ? 'pointer' : 'default', color: cooldown ? t.muted : t.bodyText, textDecoration: cooldown ? 'none' : 'underline', textUnderlineOffset: 3 }}
            >
              {busy === 'sending' ? 'Sending…' : cooldown ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'idle' && !error && !fieldError ? (
        <p style={{ fontSize: 12.5, color: t.muted, margin: '5px 0 0' }}>
          Singapore mobiles only. We text a 6-digit code to confirm this is your number.
        </p>
      ) : null}
      {stage === 'idle' && error ? <p role="alert" style={{ fontSize: 12.5, color: t.danger, margin: '5px 0 0' }}>{error}</p> : null}
    </div>
  );
}
