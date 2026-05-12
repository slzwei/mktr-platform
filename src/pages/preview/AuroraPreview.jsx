import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const PAGE = '#0A0A0F';
const TEXT = '#F5F5F7';
const TEXT_MUTED = '#A1A1AA';
const GLASS_FILL = 'rgba(255, 255, 255, 0.04)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.10)';
const GLASS_HIGHLIGHT = 'rgba(255, 255, 255, 0.16)';
const PINK = '#EC4899';
const AMBER = '#F59E0B';
const PURPLE = '#7C3AED';
const SUCCESS = '#34D399';

const GRADIENT = `linear-gradient(135deg, ${PINK} 0%, ${AMBER} 100%)`;

export default function AuroraPreview() {
  const [name, setName] = useState('John Tan');
  const [phone, setPhone] = useState('91234567');
  const [email, setEmail] = useState('you@example.com');
  const [dob, setDob] = useState('14/03/1992');
  const [otpState, setOtpState] = useState('idle');
  const [focused, setFocused] = useState(null);

  useEffect(() => {
    document.title = 'Aurora — Lead Capture preview';
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
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        color: TEXT,
      }}
    >
      <style>{`
        @keyframes aurora-1 { 0%,100% { transform: translate(-10%, -20%) scale(1); } 50% { transform: translate(10%, 10%) scale(1.2); } }
        @keyframes aurora-2 { 0%,100% { transform: translate(20%, 0%) scale(1); } 50% { transform: translate(-10%, 20%) scale(1.1); } }
        @keyframes aurora-3 { 0%,100% { transform: translate(0%, 30%) scale(1.1); } 50% { transform: translate(15%, 0%) scale(0.9); } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes float-particle { 0%,100% { transform: translateY(0) translateX(0); } 50% { transform: translateY(-30px) translateX(20px); } }
        .aurora-blob { position: absolute; border-radius: 50%; filter: blur(120px); pointer-events: none; }
        .input-glass:focus-within { border-color: ${GLASS_HIGHLIGHT} !important; box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.18); }
      `}</style>

      <BackToHub />

      {/* Aurora blobs */}
      <div
        className="aurora-blob"
        style={{
          width: 600,
          height: 600,
          top: '-15%',
          left: '-10%',
          background: PURPLE,
          opacity: 0.55,
          animation: 'aurora-1 32s ease-in-out infinite',
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: 560,
          height: 560,
          top: '20%',
          right: '-15%',
          background: PINK,
          opacity: 0.5,
          animation: 'aurora-2 38s ease-in-out infinite',
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: 500,
          height: 500,
          bottom: '-20%',
          left: '20%',
          background: AMBER,
          opacity: 0.4,
          animation: 'aurora-3 44s ease-in-out infinite',
        }}
      />

      {/* Particles */}
      {[
        { top: '15%', left: '20%', size: 3, delay: 0 },
        { top: '40%', left: '80%', size: 2, delay: 4 },
        { top: '70%', left: '15%', size: 4, delay: 8 },
        { top: '25%', left: '70%', size: 2, delay: 2 },
        { top: '85%', left: '60%', size: 3, delay: 6 },
      ].map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.4)',
            boxShadow: '0 0 12px rgba(255, 255, 255, 0.3)',
            animation: `float-particle ${18 + p.delay}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Card */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 460,
            backgroundColor: GLASS_FILL,
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border: `1px solid ${GLASS_BORDER}`,
            borderRadius: 24,
            padding: 32,
            position: 'relative',
            boxShadow: '0 32px 80px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          {/* Top edge highlight (faux specular) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 24,
              right: 24,
              height: 1,
              background: `linear-gradient(90deg, transparent 0%, ${GLASS_HIGHLIGHT} 50%, transparent 100%)`,
            }}
          />

          {/* Wordmark + step counter */}
          <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: GRADIENT,
                  boxShadow: `0 0 12px ${PINK}`,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.02em' }}>MKTR</span>
            </div>
            <span
              style={{
                fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                fontSize: 12,
                color: TEXT_MUTED,
                letterSpacing: '0.04em',
              }}
            >
              01 / 03
            </span>
          </div>

          {/* Headline */}
          <h1
            style={{
              fontFamily: 'Inter Tight, Inter, sans-serif',
              fontWeight: 700,
              fontSize: 40,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              margin: 0,
              color: TEXT,
            }}
          >
            Get started
            <br />
            in{' '}
            <span
              style={{
                background: GRADIENT,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              seconds.
            </span>
          </h1>

          {/* Sub */}
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.55,
              color: TEXT_MUTED,
              marginTop: 12,
              marginBottom: 28,
            }}
          >
            Match with an advisor in under two minutes.
          </p>

          {/* Fields */}
          <FloatingField
            label="Full name"
            value={name}
            focused={focused === 'name'}
            onFocus={() => setFocused('name')}
            onBlur={() => setFocused(null)}
            onChange={(e) => setName(e.target.value)}
          />

          {/* Phone — split glass cells */}
          <div style={{ marginBottom: 16 }}>
            <div
              className="input-glass"
              style={{
                display: 'flex',
                height: 56,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${GLASS_BORDER}`,
                transition: 'border-color 200ms, box-shadow 200ms',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 16px',
                  borderRight: `1px solid ${GLASS_BORDER}`,
                  fontSize: 15,
                  color: TEXT_MUTED,
                  gap: 6,
                }}
              >
                +65 <span style={{ fontSize: 10 }}>▾</span>
              </div>
              <input
                value={displayPhone(phone)}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                disabled={otpState === 'verified'}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: TEXT,
                  fontSize: 17,
                  fontWeight: 500,
                  padding: '0 16px',
                  fontFamily: 'inherit',
                }}
              />
              {otpState === 'idle' && (
                <button
                  type="button"
                  onClick={handleVerify}
                  style={{
                    width: 96,
                    border: 'none',
                    borderLeft: `1px solid ${GLASS_BORDER}`,
                    background: 'transparent',
                    color: TEXT,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundImage: GRADIENT,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Verify
                </button>
              )}
              {otpState === 'sending' && (
                <div
                  style={{
                    width: 96,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderLeft: `1px solid ${GLASS_BORDER}`,
                    color: TEXT_MUTED,
                    fontSize: 13,
                  }}
                >
                  …
                </div>
              )}
              {otpState === 'verified' && (
                <div
                  style={{
                    width: 96,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderLeft: `1px solid ${GLASS_BORDER}`,
                    color: SUCCESS,
                    fontSize: 13,
                    fontWeight: 600,
                    gap: 6,
                  }}
                >
                  <span style={{ filter: `drop-shadow(0 0 6px ${SUCCESS})` }}>✓</span>
                  Verified
                </div>
              )}
            </div>
          </div>

          <FloatingField
            label="Email"
            value={email}
            focused={focused === 'email'}
            onFocus={() => setFocused('email')}
            onBlur={() => setFocused(null)}
            onChange={(e) => setEmail(e.target.value)}
            trailing={
              isEmail && (
                <span style={{ color: SUCCESS, filter: `drop-shadow(0 0 8px ${SUCCESS})`, fontSize: 16 }}>✓</span>
              )
            }
          />

          <FloatingField
            label="Date of birth"
            value={dob}
            focused={focused === 'dob'}
            onFocus={() => setFocused('dob')}
            onBlur={() => setFocused(null)}
            onChange={(e) => setDob(e.target.value)}
            placeholder="DD / MM / YYYY"
          />

          {/* CTA */}
          <button
            type="button"
            style={{
              width: '100%',
              height: 56,
              marginTop: 8,
              border: 'none',
              borderRadius: 14,
              background: GRADIENT,
              color: '#fff',
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: `0 8px 32px ${PINK}40, 0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2)`,
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)',
                animation: 'shimmer 8s linear infinite',
                pointerEvents: 'none',
              }}
            />
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Continue <span style={{ fontSize: 18 }}>→</span>
            </span>
          </button>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 20,
              fontSize: 12.5,
              color: TEXT_MUTED,
            }}
          >
            <LockIcon />
            <span>End-to-end encrypted · GDPR compliant</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatingField({ label, value, focused, onFocus, onBlur, onChange, trailing, placeholder }) {
  const isFloated = focused || (value && value.length > 0);
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="input-glass"
        style={{
          position: 'relative',
          height: 56,
          borderRadius: 12,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: `1px solid ${GLASS_BORDER}`,
          transition: 'border-color 200ms, box-shadow 200ms',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <label
          style={{
            position: 'absolute',
            left: 16,
            color: TEXT_MUTED,
            fontSize: isFloated ? 11 : 15,
            fontWeight: 500,
            letterSpacing: '0.02em',
            top: isFloated ? 8 : '50%',
            transform: isFloated ? 'translateY(0)' : 'translateY(-50%)',
            transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: 'none',
          }}
        >
          {label}
        </label>
        <input
          value={value}
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={isFloated ? placeholder : ''}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: TEXT,
            fontSize: 17,
            fontWeight: 500,
            paddingTop: isFloated ? 18 : 0,
            transition: 'padding 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            fontFamily: 'inherit',
          }}
        />
        {trailing && (
          <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)' }}>{trailing}</div>
        )}
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 5V3.5C3 2.12 4.12 1 5.5 1S8 2.12 8 3.5V5M2 5h7v6H2V5z"
        stroke={TEXT_MUTED}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
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
        fontFamily: 'Inter, sans-serif',
        fontSize: 12,
        fontWeight: 500,
        color: TEXT_MUTED,
        textDecoration: 'none',
        padding: '8px 12px',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: 999,
        backdropFilter: 'blur(12px)',
        zIndex: 50,
      }}
    >
      ← Previews
    </Link>
  );
}
