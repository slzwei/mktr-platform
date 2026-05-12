import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const TERRACOTTA = '#D6552B';
const TERRACOTTA_DEEP = '#A53F1E';
const CREAM = '#F5F0E6';
const PAPER = '#FBF7EE';
const HAIRLINE = '#E6E0D1';
const INK = '#1B1A17';
const INK_SOFT = '#4A4640';
const INK_MUTED = '#8B857A';
const SAGE = '#7A8C6B';

export default function AtelierPreview() {
  const [name, setName] = useState('John Tan');
  const [phone, setPhone] = useState('91234567');
  const [email, setEmail] = useState('you@example.com');
  const [dob, setDob] = useState('14/03/1992');
  const [otpState, setOtpState] = useState('idle');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(null);

  useEffect(() => {
    document.title = 'Atelier — Lead Capture preview';
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
      className="min-h-screen w-full font-sans antialiased"
      style={{
        backgroundColor: CREAM,
        color: INK,
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
      }}
    >
      <BackToHub />

      {/* Top terracotta hairline */}
      <div style={{ height: 1, backgroundColor: TERRACOTTA }} />

      <div className="mx-auto" style={{ maxWidth: 460, padding: '40px 28px 64px' }}>
        {/* Eyebrow */}
        <div
          className="flex items-center justify-between"
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontWeight: 500,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: INK_MUTED,
            marginBottom: 56,
          }}
        >
          <span>MKTR / Careers</span>
          <span>01 / 03</span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 500,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: '-0.01em',
            color: INK,
            margin: 0,
          }}
        >
          Begin your
          <br />
          <span style={{ fontStyle: 'italic' }}>conversation.</span>
        </h1>

        {/* Sub */}
        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 17,
            lineHeight: 1.55,
            color: INK_SOFT,
            marginTop: 20,
            marginBottom: 0,
            maxWidth: 380,
          }}
        >
          A few details, in confidence, to start the matching process.
        </p>

        {/* Short rule */}
        <div style={{ width: 24, height: 1, backgroundColor: HAIRLINE, marginTop: 44, marginBottom: 36 }} />

        {/* Fields */}
        <Field
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
        </Field>

        <Field label="Phone" focused={focused === 'phone'}>
          <div className="flex items-center" style={{ gap: 14 }}>
            <span
              style={{
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontSize: 18,
                color: INK_MUTED,
              }}
            >
              +65
            </span>
            <input
              value={displayPhone(phone)}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onFocus={() => setFocused('phone')}
              onBlur={() => setFocused(null)}
              style={{ ...inputStyle, flex: 1 }}
              disabled={otpState === 'verified'}
            />
            {otpState === 'idle' && (
              <button
                type="button"
                onClick={handleVerify}
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: 15,
                  color: TERRACOTTA,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 0',
                  position: 'relative',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
              >
                Verify ↗
              </button>
            )}
            {otpState === 'sending' && (
              <span style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: 14, color: INK_MUTED }}>
                Sending…
              </span>
            )}
            {otpState === 'verified' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: 14,
                  color: SAGE,
                }}
              >
                <SageCheck />
                Verified
              </span>
            )}
          </div>
        </Field>

        <Field label="Email" focused={focused === 'email'} trailing={isEmail ? <SageCheck /> : null}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setFocused('email')}
            onBlur={() => setFocused(null)}
            style={inputStyle}
          />
        </Field>

        <Field label="Date of birth" focused={focused === 'dob'}>
          <input
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            onFocus={() => setFocused('dob')}
            onBlur={() => setFocused(null)}
            placeholder="DD / MM / YYYY"
            style={inputStyle}
          />
        </Field>

        {/* Short rule */}
        <div style={{ width: 24, height: 1, backgroundColor: HAIRLINE, marginTop: 12, marginBottom: 36 }} />

        {/* CTA */}
        <button
          type="button"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            width: '100%',
            height: 60,
            backgroundColor: hovered ? TERRACOTTA_DEEP : TERRACOTTA,
            color: PAPER,
            border: 'none',
            borderRadius: 8,
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontWeight: 500,
            fontSize: 19,
            letterSpacing: '0.005em',
            cursor: 'pointer',
            transition: 'background-color 240ms cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span>Begin</span>
          <span
            style={{
              transform: hovered ? 'translateX(2px)' : 'translateX(0)',
              transition: 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            —
          </span>
        </button>

        {/* Terms */}
        <p
          style={{
            fontFamily: 'Albert Sans, sans-serif',
            fontSize: 12,
            lineHeight: 1.6,
            color: INK_MUTED,
            textAlign: 'center',
            marginTop: 18,
            marginBottom: 56,
          }}
        >
          By beginning, you accept our{' '}
          <a href="#" style={{ color: INK_SOFT, textDecoration: 'underline' }}>
            terms
          </a>
          .
        </p>

        {/* Footer */}
        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontSize: 12,
            color: INK_MUTED,
            textAlign: 'center',
            margin: 0,
          }}
        >
          Encrypted in transit · Stored in Singapore
        </p>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  fontFamily: 'Albert Sans, sans-serif',
  fontWeight: 400,
  fontSize: 18,
  lineHeight: 1.4,
  color: INK,
  backgroundColor: 'transparent',
  border: 'none',
  outline: 'none',
  padding: '8px 0 10px',
  WebkitAppearance: 'none',
};

function Field({ label, focused, children, trailing }) {
  return (
    <div style={{ marginBottom: 28, position: 'relative' }}>
      <label
        style={{
          display: 'block',
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: INK_MUTED,
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        {children}
        {trailing && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          >
            {trailing}
          </div>
        )}
      </div>
      {/* hairline */}
      <div
        style={{
          height: 1.5,
          backgroundColor: HAIRLINE,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: TERRACOTTA,
            transform: focused ? 'scaleX(1)' : 'scaleX(0)',
            transformOrigin: 'left',
            transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  );
}

function SageCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7.5" stroke={SAGE} strokeWidth="1" fill="none" />
      <path d="M5 8.2L7 10.2L11 6" stroke={SAGE} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackToHub() {
  return (
    <Link
      to="/preview"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        fontFamily: 'Fraunces, serif',
        fontStyle: 'italic',
        fontSize: 12,
        color: INK_MUTED,
        textDecoration: 'none',
        padding: '8px 12px',
        backgroundColor: 'rgba(251, 247, 238, 0.7)',
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 999,
        backdropFilter: 'blur(8px)',
        zIndex: 50,
      }}
    >
      ← Previews
    </Link>
  );
}
