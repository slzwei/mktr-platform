import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const PAGE = '#FAFAF7';
const INK = '#0E0E0E';
const INK_SOFT = '#3F3F3F';
const INK_MUTED = '#9B9B9B';
const RED = '#E63838';
const HAIRLINE = '#E5E5E1';

export default function SpecimenPreview() {
  const [name, setName] = useState('John Tan');
  const [phone, setPhone] = useState('91234567');
  const [email, setEmail] = useState('you@example.com');
  const [dob, setDob] = useState('14/03/1992');
  const [otpState, setOtpState] = useState('idle');
  const [submitHover, setSubmitHover] = useState(false);
  const [focused, setFocused] = useState(null);

  useEffect(() => {
    document.title = 'Specimen — Lead Capture preview';
  }, []);

  const displayPhone = (v) => (v.length <= 4 ? v : `${v.slice(0, 4)} ${v.slice(4)}`);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleVerify = () => {
    if (otpState !== 'idle') return;
    setOtpState('sending');
    setTimeout(() => setOtpState('verified'), 900);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE,
        color: INK,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <BackToHub />

      {/* Top hairline */}
      <div style={{ height: 1, backgroundColor: INK }} />

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 24px' }}>
        {/* Eyebrow row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            paddingTop: 32,
            paddingBottom: 28,
          }}
        >
          <span
            style={{
              fontFamily: 'Inter Tight, Inter, sans-serif',
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: '-0.04em',
              color: INK_MUTED,
            }}
          >
            / 01
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: INK_MUTED,
              paddingBottom: 6,
            }}
          >
            Lead capture
          </span>
        </div>

        <Hairline />

        {/* Headline */}
        <h1
          style={{
            fontFamily: 'Inter Tight, Inter, sans-serif',
            fontWeight: 700,
            fontSize: 'clamp(52px, 12vw, 88px)',
            lineHeight: 0.95,
            letterSpacing: '-0.045em',
            color: INK,
            marginTop: 32,
            marginBottom: 24,
          }}
        >
          We don't
          <br />
          waste
          <br />
          your{' '}
          <span style={{ fontStyle: 'italic', color: RED, fontWeight: 700 }}>time.</span>
        </h1>

        {/* Sub */}
        <p
          style={{
            fontSize: 17,
            lineHeight: 1.55,
            color: INK_SOFT,
            margin: 0,
            marginBottom: 36,
            maxWidth: 440,
          }}
        >
          Three minutes. No follow-up calls without your consent.
        </p>

        <Hairline />

        {/* Form */}
        <div style={{ marginTop: 36 }}>
          <SpecField
            label="Full name"
            focused={focused === 'name'}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setFocused('name')}
              onBlur={() => setFocused(null)}
              style={inputStyle}
            />
          </SpecField>

          <SpecField
            label={
              <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Phone</span>
                <span style={{ fontWeight: 500, color: INK_SOFT, letterSpacing: '0.18em' }}>(+65)</span>
              </span>
            }
            focused={focused === 'phone'}
            trailing={
              otpState === 'idle' ? (
                <button
                  type="button"
                  onClick={handleVerify}
                  style={{
                    ...trailingTextButton,
                    color: RED,
                  }}
                  onMouseEnter={(e) => {
                    const arrow = e.currentTarget.querySelector('span');
                    if (arrow) arrow.style.transform = 'translateX(4px)';
                  }}
                  onMouseLeave={(e) => {
                    const arrow = e.currentTarget.querySelector('span');
                    if (arrow) arrow.style.transform = 'translateX(0)';
                  }}
                >
                  Verify <span style={{ display: 'inline-block', transition: 'transform 220ms' }}>→</span>
                </button>
              ) : otpState === 'sending' ? (
                <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK_MUTED }}>
                  Sending…
                </span>
              ) : (
                <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK }}>
                  ✓ Verified
                </span>
              )
            }
          >
            <input
              value={displayPhone(phone)}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onFocus={() => setFocused('phone')}
              onBlur={() => setFocused(null)}
              disabled={otpState === 'verified'}
              style={inputStyle}
            />
          </SpecField>

          <SpecField
            label="Email"
            focused={focused === 'email'}
            trailing={isEmail && <span style={{ fontSize: 16, color: INK }}>✓</span>}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              style={inputStyle}
            />
          </SpecField>

          <SpecField label="Date of birth" focused={focused === 'dob'}>
            <input
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              onFocus={() => setFocused('dob')}
              onBlur={() => setFocused(null)}
              placeholder="DD / MM / YYYY"
              style={inputStyle}
            />
          </SpecField>
        </div>

        {/* Submit — pure text, no button */}
        <div style={{ paddingTop: 56, paddingBottom: 56 }}>
          <button
            type="button"
            onMouseEnter={() => setSubmitHover(true)}
            onMouseLeave={() => setSubmitHover(false)}
            style={{
              fontFamily: 'Inter Tight, Inter, sans-serif',
              fontWeight: 700,
              fontSize: 'clamp(28px, 6vw, 36px)',
              color: RED,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              letterSpacing: submitHover ? '0.04em' : '-0.02em',
              transition: 'letter-spacing 320ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <span style={{ display: 'inline-block', transform: submitHover ? 'translateX(4px)' : 'translateX(0)', transition: 'transform 280ms' }}>
              →
            </span>
            {'  '}BEGIN
          </button>
        </div>
      </div>

      {/* Bottom hairline */}
      <div style={{ height: 1, backgroundColor: INK, marginTop: 48 }} />

      {/* Footer */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 24px 40px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: INK_MUTED,
            textAlign: 'center',
          }}
        >
          <span>Encrypted</span>
          <span>No spam</span>
          <span>WhatsApp</span>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  fontFamily: 'Inter, sans-serif',
  fontWeight: 500,
  fontSize: 22,
  lineHeight: 1.3,
  color: INK,
  backgroundColor: 'transparent',
  border: 'none',
  outline: 'none',
  padding: '6px 0 14px',
  WebkitAppearance: 'none',
};

const trailingTextButton = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
};

function SpecField({ label, focused, children, trailing }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: INK_MUTED,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        {trailing && <div style={{ flexShrink: 0 }}>{trailing}</div>}
      </div>
      <div
        style={{
          height: focused ? 2 : 1,
          backgroundColor: focused ? RED : INK,
          transition: 'all 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
    </div>
  );
}

function Hairline() {
  return <div style={{ height: 1, backgroundColor: HAIRLINE }} />;
}

function BackToHub() {
  return (
    <Link
      to="/preview"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        fontFamily: 'Inter, sans-serif',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: INK,
        textDecoration: 'none',
        padding: '8px 14px',
        backgroundColor: PAGE,
        border: `1px solid ${INK}`,
        zIndex: 50,
      }}
    >
      ← Previews
    </Link>
  );
}
