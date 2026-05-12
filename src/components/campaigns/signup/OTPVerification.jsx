import { useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { TOKENS, RADIUS } from '@/components/campaigns/LeadCaptureLayout';

/**
 * Verification Code modal — opens when otpState === 'pending'.
 *
 * Editorial pattern: small eyebrow → heavy-serif title → body explaining the
 * channel → 6-digit input + inline Resend timer → Cancel / Verify pill buttons.
 *
 * Auto-verify still fires when the user types the 6th digit, but a real Verify
 * button is always present (matches Goodies SG / AIA pattern).
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
  const isOpen = otpState === 'pending';
  const accent = themeColor || TOKENS.accent;

  // Auto-verify on 6 digits
  useEffect(() => {
    if (otp.length === 6 && !showSuccessTick && loading !== 'verifying') {
      handleVerifyOtp(otp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !showSuccessTick) handleCancelOtp();
      }}
    >
      <DialogContent
        className="border-0 p-0 gap-0"
        style={{
          backgroundColor: TOKENS.modal,
          borderRadius: RADIUS.modal,
          maxWidth: 440,
          width: 'calc(100vw - 32px)',
          padding: 28,
          boxShadow: '0 24px 64px rgba(60, 40, 20, 0.18), 0 4px 16px rgba(60, 40, 20, 0.08)',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: TOKENS.muted,
            marginBottom: 8,
          }}
        >
          Verification
        </div>

        {/* Heavy-serif title */}
        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 800,
            fontSize: 28,
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            color: TOKENS.ink,
            margin: 0,
            marginBottom: 12,
          }}
        >
          Verification Code
        </h2>

        {/* Body */}
        <p
          style={{
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 15,
            lineHeight: 1.55,
            color: TOKENS.body,
            margin: 0,
            marginBottom: 20,
          }}
        >
          A verification code has been sent to you via {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}:{' '}
          <span style={{ fontWeight: 700, color: TOKENS.ink }}>{displayPhone(phone)}</span>.
          <br />
          Please check and enter the code below.
        </p>

        {/* Code input + resend */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Enter 6-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading === 'verifying' || showSuccessTick}
            autoFocus
            maxLength={6}
            style={{
              flex: '1 1 200px',
              minWidth: 180,
              height: 44,
              padding: '0 16px',
              fontSize: 16,
              letterSpacing: '0.32em',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              color: TOKENS.ink,
              backgroundColor: '#ffffff',
              border: `1px solid ${error ? TOKENS.required : TOKENS.hairline}`,
              borderRadius: RADIUS.pill,
              outline: 'none',
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
            onClick={handleSendOtp}
            disabled={resendCooldown > 0 || loading === 'sending'}
            style={{
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontSize: 13,
              fontWeight: 500,
              color: resendCooldown > 0 ? TOKENS.muted : TOKENS.body,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
              textDecoration: resendCooldown > 0 ? 'none' : 'underline',
              textUnderlineOffset: 3,
              whiteSpace: 'nowrap',
            }}
          >
            {loading === 'sending'
              ? 'Sending…'
              : resendCooldown > 0
                ? `Resend in ${resendCooldown > 60 ? `${Math.ceil(resendCooldown / 60)}m` : `${resendCooldown}s`}`
                : 'Resend code'}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 20,
              padding: '10px 14px',
              borderRadius: RADIUS.pill,
              backgroundColor: TOKENS.required + '15',
              color: TOKENS.required,
              fontSize: 13.5,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
            }}
          >
            {error}
          </div>
        )}

        {/* Cancel + Verify buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            type="button"
            onClick={handleCancelOtp}
            disabled={showSuccessTick}
            style={{
              height: 48,
              paddingLeft: 24,
              paddingRight: 24,
              borderRadius: RADIUS.pill,
              backgroundColor: '#ffffff',
              color: TOKENS.body,
              border: `1px solid ${TOKENS.hairline}`,
              cursor: 'pointer',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleVerifyOtp(otp)}
            disabled={otp.length !== 6 || loading === 'verifying' || showSuccessTick}
            style={{
              height: 48,
              paddingLeft: 28,
              paddingRight: 28,
              borderRadius: RADIUS.pill,
              backgroundColor: accent,
              color: '#ffffff',
              border: 'none',
              cursor: otp.length === 6 ? 'pointer' : 'not-allowed',
              opacity: otp.length === 6 && loading !== 'verifying' && !showSuccessTick ? 1 : 0.5,
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontWeight: 600,
              fontSize: 15,
              minWidth: 110,
              transition: 'opacity 200ms ease',
            }}
          >
            {showSuccessTick ? '✓' : loading === 'verifying' ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
