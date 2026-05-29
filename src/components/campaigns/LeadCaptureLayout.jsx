import { useState } from 'react';
import { apiClient } from '@/api/client';
import { heroFontStack } from '@/lib/heroFonts';

/**
 * Shared layout shell for the public lead-capture page.
 *
 * Implements the warm-cream / heavy-serif editorial design language.
 *
 * Two-card structure:
 *   1. Hero / story card  — brand wordmark, hero media, primary CTA, marketing copy
 *   2. Form card          — the actual form (passed in as `children`)
 *
 * Around the cards: warm peach page background, plus an optional regulatory
 * footer + social icons row underneath.
 *
 * Backwards-compatible: when called without `story` / `wordmark` / `regulatoryFooter`,
 * only the form card renders (matches the previous single-card layout). This keeps
 * `public/Preview.jsx` working without changes.
 */

// Locked design tokens — these define the visual identity and intentionally
// do NOT vary with campaign theme. campaign.design_config.themeColor still
// drives the primary action color (CTAs, checkboxes) for per-campaign accent.
export const TOKENS = {
  pagebg: '#F1DDB8', // saturated warm tan peach
  storyCard: '#FAEAD0', // lighter cream peach for the narrative card
  formCard: '#FFFAF0', // warm white for the action card
  modal: '#FBF7F0', // cream for dialogs
  ink: '#3D1F0B', // very dark warm brown — display text
  body: '#5A301A', // mid warm brown — paragraph body
  muted: '#9A7E5C', // softer warm brown — helper / muted
  hairline: '#E8D7B8', // warm tan border
  divider: '#D8C09A', // slightly darker for stronger dividers
  accent: '#D17029', // primary action terracotta-orange (default)
  accentDeep: '#A85822', // hover state
  required: '#B33A2E', // distinct red for required-field asterisks
  success: '#7A8C6B', // sage for verified states
};

// Pixel-perfect helpers
export const RADIUS = {
  pill: 999,
  card: 24,
  modal: 28,
  image: 16,
  checkbox: 6,
};

export function resolveImageUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const apiOrigin = apiClient.baseURL.replace(/\/?api\/?$/, '');
  return `${apiOrigin}${url.startsWith('/') ? url : '/' + url}`;
}

function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&modestbranding=1&playsinline=1`;
  }
  return null;
}

function HeroMedia({ design }) {
  const [videoError, setVideoError] = useState(false);
  const mediaType = design?.mediaType || (design?.imageUrl ? 'image' : 'none');

  if (mediaType === 'none') return null;

  const youtubeUrl = mediaType === 'video' && design?.videoUrl ? getYouTubeEmbedUrl(design.videoUrl) : null;

  // YouTube — always show the embed (player handles its own play UI)
  if (youtubeUrl) {
    return (
      <div
        className="w-full relative overflow-hidden"
        style={{ aspectRatio: '16/9', borderRadius: RADIUS.image, backgroundColor: TOKENS.ink }}
      >
        <iframe
          src={youtubeUrl}
          title="Campaign video"
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  // Hosted mp4 — silent, auto-looping hero background. `muted` both strips the
  // audio at playback AND is required for autoplay on iOS/Android; the ref
  // setter guarantees the muted property is applied so autoplay isn't blocked.
  if (mediaType === 'video' && design?.videoUrl && !videoError) {
    return (
      <div
        className="w-full relative overflow-hidden"
        style={{ aspectRatio: '16/9', borderRadius: RADIUS.image, backgroundColor: TOKENS.ink }}
      >
        <video
          ref={(el) => {
            if (el) el.muted = true;
          }}
          src={resolveImageUrl(design.videoUrl)}
          className="w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setVideoError(true)}
        />
      </div>
    );
  }

  // Image — only in image mode, so a leftover imageUrl never leaks into video
  // mode (as a poster, a pre-upload placeholder, or a video-error fallback).
  if (mediaType === 'image' && design?.imageUrl) {
    return (
      <div
        className="w-full relative overflow-hidden"
        style={{ aspectRatio: '16/9', borderRadius: RADIUS.image, backgroundColor: TOKENS.hairline }}
      >
        <img
          src={resolveImageUrl(design.imageUrl)}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return null;
}

function BrandWordmark({ wordmark, fontFamily }) {
  if (!wordmark) return null;
  return (
    <div
      className="text-center"
      style={{
        paddingTop: 28,
        paddingBottom: 24,
        fontFamily: fontFamily || 'Fraunces, serif',
        fontWeight: 900,
        fontSize: 'clamp(44px, 11vw, 64px)',
        lineHeight: 0.92,
        letterSpacing: '-0.02em',
        color: TOKENS.ink,
      }}
    >
      {wordmark}
    </div>
  );
}

function HeroStoryCard({ design, story, primaryCta }) {
  if (!story && !design?.imageUrl && !design?.videoUrl) return null;

  return (
    <article
      className="overflow-hidden"
      style={{
        backgroundColor: TOKENS.storyCard,
        borderRadius: RADIUS.card,
        boxShadow: '0 4px 20px rgba(60, 40, 20, 0.06), 0 1px 4px rgba(60, 40, 20, 0.04)',
        padding: 20,
        marginBottom: 20,
      }}
    >
      <HeroMedia design={design} />

      {primaryCta && (
        <div style={{ paddingTop: 20, paddingBottom: 4 }}>
          <button
            type="button"
            onClick={primaryCta.onClick}
            className="w-full inline-flex items-center justify-center transition-colors"
            style={{
              height: 56,
              borderRadius: RADIUS.pill,
              backgroundColor: primaryCta.color || TOKENS.accent,
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Albert Sans, system-ui, sans-serif',
              fontWeight: 600,
              fontSize: 17,
              letterSpacing: '0.005em',
              gap: 12,
              boxShadow: '0 4px 14px rgba(209, 112, 41, 0.18)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TOKENS.accentDeep)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = primaryCta.color || TOKENS.accent)}
          >
            <span>{primaryCta.label}</span>
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.18)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
              aria-hidden="true"
            >
              →
            </span>
          </button>
        </div>
      )}

      {story?.paragraphs && story.paragraphs.length > 0 && (
        <div
          style={{
            paddingTop: 24,
            paddingLeft: 4,
            paddingRight: 4,
            fontFamily: 'Albert Sans, system-ui, sans-serif',
            fontSize: 15.5,
            lineHeight: 1.6,
            color: TOKENS.body,
          }}
        >
          {story.paragraphs.map((p, i) => (
            <p key={i} style={{ margin: 0, marginBottom: i === story.paragraphs.length - 1 && !story.emphasis ? 0 : 16 }}>
              {p}
            </p>
          ))}
          {story.emphasis && (
            <p
              style={{
                margin: 0,
                marginTop: 4,
                fontWeight: 700,
                color: TOKENS.ink,
              }}
            >
              {story.emphasis}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function RegulatoryFooter({ regulatoryFooter, social, brand }) {
  if (!regulatoryFooter && !social && !brand) return null;

  return (
    <footer
      className="text-center"
      style={{
        marginTop: 36,
        paddingBottom: 48,
        fontFamily: 'Albert Sans, system-ui, sans-serif',
      }}
    >
      {social && social.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
          {social.map((s, i) => (
            <a
              key={i}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              aria-label={s.type}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                backgroundColor: TOKENS.accent,
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SocialIcon type={s.type} />
            </a>
          ))}
        </div>
      )}

      {regulatoryFooter && (
        <p
          style={{
            color: TOKENS.muted,
            fontSize: 12,
            lineHeight: 1.65,
            margin: 0,
            marginBottom: brand ? 24 : 0,
            padding: '0 8px',
          }}
        >
          {regulatoryFooter}
        </p>
      )}

      {brand && (
        <div
          style={{
            color: TOKENS.muted,
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {brand}
        </div>
      )}
    </footer>
  );
}

function SocialIcon({ type }) {
  if (type === 'facebook') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z" />
      </svg>
    );
  }
  if (type === 'instagram') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

export default function LeadCaptureLayout({
  design = {},
  maxWidth,
  showTrustFooter = false, // legacy prop — ignored; regulatoryFooter replaces it
  // Root min-height. Defaults to the full viewport (live page / /p/ preview).
  // The in-editor preview passes '100%' so the cream fills the preview pane
  // instead of forcing a viewport-tall scroll region inside it.
  rootMinHeight = '100vh',
  // New optional content slots
  wordmark,
  story,
  primaryCta,
  regulatoryFooter,
  social,
  brand,
  children,
}) {
  // Backwards-compat: when no narrative content is provided, render the
  // single-card layout (legacy behavior used by /p/:slug preview).
  const hasStory = !!(wordmark || story || primaryCta);

  return (
    <div
      style={{
        minHeight: rootMinHeight,
        backgroundColor: TOKENS.pagebg,
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div
        className="mx-auto"
        style={{
          maxWidth: maxWidth ? `${maxWidth}px` : 480,
          padding: '0 16px',
        }}
      >
        {hasStory && (
          <>
            <BrandWordmark wordmark={wordmark} fontFamily={heroFontStack(design?.heroFont)} />
            <HeroStoryCard design={design} story={story} primaryCta={primaryCta} />
          </>
        )}

        <article
          className="overflow-hidden"
          style={{
            backgroundColor: TOKENS.formCard,
            borderRadius: RADIUS.card,
            boxShadow: '0 4px 20px rgba(60, 40, 20, 0.06), 0 1px 4px rgba(60, 40, 20, 0.04)',
            marginBottom: hasStory ? 0 : 32,
            marginTop: hasStory ? 0 : 28,
          }}
        >
          {/* Legacy single-card path — render media at top inside form card */}
          {!hasStory && (
            <div style={{ padding: 16 }}>
              <HeroMedia design={design} />
            </div>
          )}

          <div style={{ padding: '28px 24px 32px' }}>{children}</div>
        </article>

        <RegulatoryFooter regulatoryFooter={regulatoryFooter} social={social} brand={brand} />
      </div>
    </div>
  );
}
