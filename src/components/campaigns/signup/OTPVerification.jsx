import { useEffect } from 'react';
import { TOKENS, RADIUS } from '@/components/campaigns/LeadCaptureLayout';
import { readableTextOn } from '@/lib/contrast';

/**
 * Inline verification panel — slides down directly beneath the phone field when
 * otpState === 'pending'. Replaces the old modal so the user never leaves the
 * form flow (modals add friction + fight the mobile keyboard on step inputs).
 *
 * SMS-OTP best practices (web.dev / Twilio):
 *  - a single <input> (paste-friendly — needed for the WhatsApp "Copy code" button)
 *  - autocomplete="one-time-code" + inputmode="numeric" → iOS surfaces the SMS
 *    code in the keyboard suggestion bar (one tap to fill)
 *  - type="text" (not "number") so leading zeros are preserved
 *  - auto-verify on the 6th digit, with a manual Verify button as the fallback
 *  - resend timer + an "Edit" affordance for wrong-number recovery
 *
 * Stays mounted through the post-verify success tick (otpState is still
 * 'pending' for ~1.1s while the ✓ shows), then unmounts when otpState flips to
 * 'verified' and the phone row's "Verified" badge takes over.
 */
export default function OTPVerification({
  otpState,
  otp,
  setOtp,
  loading,
  error,
  showSuccessTick,
  resendCooldown,
  displayPhone,
  phone,
  themeColor,
  handleVerifyOtp,
  handleCancelOtp,
  handleSendOtp,
  channel = 'sms', // 'sms' | 'whatsapp'
}) {
  const accent = themeColor || TOKENS.accent;

  // Auto-verify once the 6th digit lands (e.g. after iOS autofill / paste).
  useEffect(() => {
    if (otp.length === 6 && !showSuccessTick && loading !== 'verifying') {
      handleVerifyOtp(otp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  if (otpState !== 'pending') return null;

  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'SMS';

  return (
    <div
      style={{
        marginTop: 12,
        padding: 16,
        backgroundColor: '#FFFCF6',
        border: `1px solid ${TOKENS.hairline}`,
        borderRadius: RADIUS.image,
        animation: 'lc-reveal 260ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Helper line + edit-number affordance */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <p
          style={{
            margin: 0,
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 13.5,
            lineHeight: 1.5,
            color: TOKENS.body,
          }}
        >
          Enter the 6-digit code sent via {channelLabel} to{' '}
          <span style={{ fontWeight: 700, color: TOKENS.ink, whiteSpace: 'nowrap' }}>+65 {displayPhone(phone)}</span>
        </p>
        <button
          type="button"
          onClick={handleCancelOtp}
          disabled={showSuccessTick}
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: showSuccessTick ? 'default' : 'pointer',
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            color: TOKENS.muted,
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Edit
        </button>
      </div>

      {/* Code input + verify */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          placeholder="6-digit code"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={loading === 'verifying' || showSuccessTick}
          autoFocus
          maxLength={6}
          aria-label={`Verification code sent via ${channelLabel}`}
          style={{
            flex: 1,
            minWidth: 0,
            height: 52,
            padding: '0 22px',
            fontSize: 16, // 16px avoids iOS auto-zoom on focus
            // Wide tracking only on typed digits — applying it to the placeholder
            // overflows "6-digit code" and clips it.
            letterSpacing: otp ? '0.3em' : 'normal',
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            color: TOKENS.ink,
            backgroundColor: '#ffffff',
            border: `1px solid ${error ? TOKENS.required : TOKENS.hairline}`,
            borderRadius: RADIUS.pill,
            outline: 'none',
            WebkitAppearance: 'none',
            transition: 'border-color 200ms ease, box-shadow 200ms ease',
          }}
          onFocus={(e) => {
            if (!error) {
              e.target.style.borderColor = accent;
              e.target.style.boxShadow = `0 0 0 3px ${accent}22`;
            }
          }}
          onBlur={(e) => {
            e.target.style.borderColor = error ? TOKENS.required : TOKENS.hairline;
            e.target.style.boxShadow = 'none';
          }}
        />
        <button
          type="button"
          onClick={() => handleVerifyOtp(otp)}
          disabled={otp.length !== 6 || loading === 'verifying' || showSuccessTick}
          style={{
            height: 52,
            paddingLeft: 24,
            paddingRight: 24,
            borderRadius: RADIUS.pill,
            backgroundColor: showSuccessTick ? TOKENS.success : accent,
            color: readableTextOn(showSuccessTick ? TOKENS.success : accent),
            border: 'none',
            cursor: otp.length === 6 && !showSuccessTick ? 'pointer' : 'not-allowed',
            opacity: showSuccessTick ? 1 : otp.length === 6 && loading !== 'verifying' ? 1 : 0.5,
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontWeight: 600,
            fontSize: 15,
            minWidth: 96,
            whiteSpace: 'nowrap',
            transition: 'opacity 200ms ease, background-color 200ms ease',
          }}
        >
          {showSuccessTick ? '✓' : loading === 'verifying' ? 'Verifying…' : 'Verify'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 13,
            lineHeight: 1.5,
            color: TOKENS.required,
          }}
        >
          {error}
        </div>
      )}

      {/* Resend */}
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={handleSendOtp}
          disabled={resendCooldown > 0 || loading === 'sending' || showSuccessTick}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: resendCooldown > 0 || showSuccessTick ? 'default' : 'pointer',
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            color: resendCooldown > 0 ? TOKENS.muted : TOKENS.body,
            textDecoration: resendCooldown > 0 ? 'none' : 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {loading === 'sending'
            ? 'Sending…'
            : resendCooldown > 0
              ? `Resend code in ${resendCooldown > 60 ? `${Math.ceil(resendCooldown / 60)}m` : `${resendCooldown}s`}`
              : 'Resend code'}
        </button>
      </div>
    </div>
  );
}
