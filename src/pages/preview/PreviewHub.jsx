import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import MktrWordmark from '@/components/brand/MktrWordmark';

const cards = [
  {
    id: 'atelier',
    name: 'Atelier',
    tagline: 'Claude / Fraunces editorial',
    description: 'Warm cream paper, Fraunces serif italic accents, single terracotta CTA. Editorial, hand-set, intimate.',
    palette: ['#F5F0E6', '#FBF7EE', '#D6552B', '#1B1A17'],
    fonts: 'Fraunces · Albert Sans',
    Preview: AtelierThumb,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Linear / Vercel glassmorphic',
    description: 'Animated aurora gradient on near-black, glass card with backdrop-blur, pink-amber CTA. Modern, ambient.',
    palette: ['#0A0A0F', '#7C3AED', '#EC4899', '#F59E0B'],
    fonts: 'Inter Tight · Inter',
    Preview: AuroraThumb,
  },
  {
    id: 'specimen',
    name: 'Specimen',
    tagline: 'Editorial bold',
    description: 'No card, no shadows. Massive Inter Tight headline, hairline rules, single red accent. Magazine-confident.',
    palette: ['#FAFAF7', '#0E0E0E', '#E63838', '#9B9B9B'],
    fonts: 'Inter Tight · Inter',
    Preview: SpecimenThumb,
  },
];

export default function PreviewHub() {
  useEffect(() => {
    document.title = 'Lead Capture — Design previews';
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#171717',
        color: '#E5E5E5',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '48px 24px 80px',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 56 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#737373',
              marginBottom: 14,
            }}
          >
            MKTR · Design exploration
          </div>
          <h1
            style={{
              fontFamily: 'Inter Tight, Inter, sans-serif',
              fontSize: 'clamp(36px, 5vw, 48px)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              margin: 0,
              color: '#FAFAFA',
            }}
          >
            Three lead capture forms.
            <br />
            <span style={{ color: '#737373' }}>Pick one to ship.</span>
          </h1>
          <p style={{ marginTop: 18, fontSize: 15, lineHeight: 1.6, color: '#A3A3A3', maxWidth: 620 }}>
            Each is a real, mounted route with working interactions. Click to open, then exercise the form on
            your phone. Once you've picked one, I'll wire it into the live{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace', color: '#FAFAFA', fontSize: 13 }}>
              /LeadCapture
            </code>{' '}
            flow.
          </p>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 20,
          }}
        >
          {cards.map((c) => (
            <Link
              key={c.id}
              to={`/preview/${c.id}`}
              style={{
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                position: 'relative',
              }}
            >
              <article
                style={{
                  backgroundColor: '#1F1F1F',
                  border: '1px solid #2A2A2A',
                  borderRadius: 16,
                  overflow: 'hidden',
                  transition: 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1), border-color 240ms',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.borderColor = '#404040';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = '#2A2A2A';
                }}
              >
                <div style={{ aspectRatio: '4 / 5', position: 'relative', overflow: 'hidden' }}>
                  <c.Preview />
                </div>

                <div style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                    <h2
                      style={{
                        fontFamily: 'Inter Tight, Inter, sans-serif',
                        fontSize: 22,
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                        margin: 0,
                        color: '#FAFAFA',
                      }}
                    >
                      {c.name}
                    </h2>
                    <span
                      style={{
                        fontSize: 11,
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                        color: '#737373',
                      }}
                    >
                      {c.fonts}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#A3A3A3', marginTop: 4, marginBottom: 12 }}>{c.tagline}</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55, color: '#B5B5B5', margin: 0, marginBottom: 16 }}>
                    {c.description}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {c.palette.map((color) => (
                        <div
                          key={color}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            backgroundColor: color,
                            border: '1px solid #2A2A2A',
                          }}
                          title={color}
                        />
                      ))}
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#FAFAFA',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      Open <span style={{ fontSize: 14 }}>→</span>
                    </span>
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>

        <footer style={{ marginTop: 56, fontSize: 12, color: '#737373', lineHeight: 1.6 }}>
          These are isolated prototype routes — they don't touch <code style={{ color: '#A3A3A3' }}>CampaignSignupForm</code>,{' '}
          <code style={{ color: '#A3A3A3' }}>LeadCapture</code>, or any production code. Safe to delete the{' '}
          <code style={{ color: '#A3A3A3' }}>src/pages/preview/</code> folder once you've chosen.
        </footer>
      </div>
    </div>
  );
}

/* --- Thumbnail components: stylized in-card mini-mockups --- */

function AtelierThumb() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#F5F0E6',
        position: 'relative',
        padding: '24px 20px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: '#D6552B' }} />
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: 9,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: '#8B857A',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <MktrWordmark size={12} />
        <span>01 / 03</span>
      </div>
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontWeight: 500,
          fontSize: 26,
          lineHeight: 1.05,
          color: '#1B1A17',
          marginBottom: 14,
        }}
      >
        Begin your
        <br />
        <span style={{ fontStyle: 'italic' }}>conversation.</span>
      </div>
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: 11,
          color: '#4A4640',
          marginBottom: 18,
        }}
      >
        A few details, in confidence.
      </div>
      <ThumbInputAtelier label="FULL NAME" value="John Tan" />
      <ThumbInputAtelier label="PHONE" value="+65 9123 4567" trailing="Verify ↗" />
      <ThumbInputAtelier label="EMAIL" value="you@example.com" trailing="✓" />
      <div
        style={{
          marginTop: 18,
          height: 32,
          borderRadius: 4,
          backgroundColor: '#D6552B',
          color: '#FBF7EE',
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        Begin —
      </div>
    </div>
  );
}

function ThumbInputAtelier({ label, value, trailing }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: 8,
          letterSpacing: '0.16em',
          color: '#8B857A',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 12, color: '#1B1A17' }}>{value}</span>
        {trailing && (
          <span
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: 10,
              color: trailing === '✓' ? '#7A8C6B' : '#D6552B',
            }}
          >
            {trailing}
          </span>
        )}
      </div>
      <div style={{ height: 1, backgroundColor: '#E6E0D1', marginTop: 4 }} />
    </div>
  );
}

function AuroraThumb() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0A0A0F',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: '70%',
          height: '70%',
          top: '-20%',
          left: '-10%',
          background: '#7C3AED',
          opacity: 0.55,
          filter: 'blur(60px)',
          borderRadius: '50%',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '70%',
          height: '70%',
          bottom: '-20%',
          right: '-10%',
          background: '#EC4899',
          opacity: 0.55,
          filter: 'blur(60px)',
          borderRadius: '50%',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '50%',
          height: '50%',
          bottom: '-15%',
          left: '20%',
          background: '#F59E0B',
          opacity: 0.45,
          filter: 'blur(50px)',
          borderRadius: '50%',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '14% 12%',
          backgroundColor: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 18,
          color: '#F5F5F7',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, color: '#A1A1AA', textAlign: 'right' }}>
          01 / 03
        </div>
        <div
          style={{
            fontFamily: 'Inter Tight, Inter, sans-serif',
            fontWeight: 700,
            fontSize: 24,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            marginTop: 6,
          }}
        >
          Get started
          <br />
          in{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #EC4899, #F59E0B)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            seconds.
          </span>
        </div>
        <div style={{ marginTop: 16 }}>
          <ThumbInputAurora label="Full name" value="John Tan" />
          <ThumbInputAurora label="Email" value="you@example.com" trailing="✓" />
        </div>
        <div
          style={{
            marginTop: 14,
            height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #EC4899, #F59E0B)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(236, 72, 153, 0.3)',
          }}
        >
          Continue →
        </div>
      </div>
    </div>
  );
}

function ThumbInputAurora({ label, value, trailing }) {
  return (
    <div
      style={{
        height: 30,
        backgroundColor: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        padding: '4px 10px',
        marginBottom: 8,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 8, color: '#A1A1AA' }}>{label}</div>
      <div style={{ fontSize: 10, color: '#F5F5F7', display: 'flex', justifyContent: 'space-between' }}>
        <span>{value}</span>
        {trailing && <span style={{ color: '#34D399' }}>{trailing}</span>}
      </div>
    </div>
  );
}

function SpecimenThumb() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FAFAF7',
        position: 'relative',
        padding: '20px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#0E0E0E' }} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: 'Inter Tight, Inter, sans-serif',
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            color: '#9B9B9B',
            lineHeight: 0.9,
          }}
        >
          / 01
        </span>
        <span style={{ fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9B9B9B' }}>
          Lead capture
        </span>
      </div>
      <div style={{ height: 1, backgroundColor: '#E5E5E1', marginBottom: 14 }} />
      <div
        style={{
          fontFamily: 'Inter Tight, Inter, sans-serif',
          fontWeight: 700,
          fontSize: 30,
          lineHeight: 0.95,
          letterSpacing: '-0.045em',
          color: '#0E0E0E',
          marginBottom: 12,
        }}
      >
        We don't
        <br />
        waste
        <br />
        your{' '}
        <span style={{ fontStyle: 'italic', color: '#E63838' }}>time.</span>
      </div>
      <div style={{ height: 1, backgroundColor: '#E5E5E1', margin: '14px 0 12px' }} />
      <ThumbInputSpec label="FULL NAME" value="John Tan" />
      <ThumbInputSpec label="EMAIL" value="you@example.com" trailing="✓" />
      <div
        style={{
          marginTop: 14,
          fontFamily: 'Inter Tight, Inter, sans-serif',
          fontWeight: 700,
          fontSize: 18,
          color: '#E63838',
          letterSpacing: '-0.02em',
        }}
      >
        →  BEGIN
      </div>
    </div>
  );
}

function ThumbInputSpec({ label, value, trailing }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '0.18em', color: '#9B9B9B' }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#0E0E0E' }}>{value}</span>
        {trailing && <span style={{ fontSize: 12, color: '#0E0E0E' }}>{trailing}</span>}
      </div>
      <div style={{ height: 1, backgroundColor: '#0E0E0E', marginTop: 4 }} />
    </div>
  );
}
