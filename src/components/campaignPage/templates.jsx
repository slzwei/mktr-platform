/**
 * The six v2 campaign-page templates (Campaign Studio PR 2) — semantics ported
 * from the Campaign Page mock, never its code. Every template receives the
 * same prop bag from CampaignPageRenderer:
 *   { t, content, params, luckyDraw, funnel, formAnchorRef, scrollToForm,
 *     mobile, stage, referrerName }
 * where `t` is the resolved theme (+ fontStack) and `funnel` is the REUSED
 * production QuizGate + CampaignSignupForm wrapped in the theme provider.
 *
 * EDITORIAL is the migration parity baseline: its geometry mirrors the v1
 * LeadCaptureLayout EXACTLY (single centered column, maxWidth = formWidth or
 * the 480 render default, wordmark clamp(44px,11vw,64px)/900, story card with
 * 16:9 media + CTA pill, form card padding 28/24/32) — with warm-cream tokens
 * it must be screenshot-indistinguishable from the live page (the mock's
 * 460/620 numbers were approximations; production wins).
 */
import { useRef, useEffect } from 'react';
import { resolveImageUrl } from '@/components/campaigns/LeadCaptureLayout';
import { youTubeIdFrom, onColor, accentTextOn } from '@/lib/designConfigV2';
import { BrandFooter, DrawBadge, ReferredBadge, formatDrawDate } from './CampaignPageRenderer';

const SANS = "'Albert Sans', system-ui, sans-serif";

export function MediaBlock({ t, media, radius, style = {} }) {
  const videoRef = useRef(null);
  useEffect(() => {
    // iOS requires the muted property (not just the attribute) for autoplay.
    if (videoRef.current) videoRef.current.muted = true;
  }, []);
  if (!media || media.kind === 'none' || !media.src) return null;
  const frame = {
    aspectRatio: '16 / 9',
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius ?? t.r.media,
    background: t.soft,
    ...style,
  };
  if (media.kind === 'youtube') {
    const id = youTubeIdFrom(media.src);
    if (!id) return null;
    return (
      <div style={frame}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`}
          title={media.alt || 'Campaign video'}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      </div>
    );
  }
  if (media.kind === 'video') {
    return (
      <div style={frame}>
        <video
          ref={videoRef}
          src={resolveImageUrl(media.src)}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }
  return (
    <div style={frame}>
      <img
        src={resolveImageUrl(media.src)}
        alt={media.alt || ''}
        loading="lazy"
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
}

function HeroCta({ t, label, onClick, style = {} }) {
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 46,
        padding: '0 22px',
        cursor: 'pointer',
        font: `700 14px ${SANS}`,
        color: t.onAccent,
        background: t.accent,
        border: 'none',
        borderRadius: t.r.btn === 999 ? 999 : t.r.btn,
        ...style,
      }}
    >
      {label} ↓
    </button>
  );
}

function FormCard({ t, formAnchorRef, funnel, maxWidth, padding = 18 }) {
  return (
    <div
      ref={formAnchorRef}
      style={{
        width: '100%',
        ...(maxWidth ? { maxWidth, margin: '0 auto' } : {}),
        boxSizing: 'border-box',
        background: t.card,
        border: `1px solid ${t.line}`,
        borderRadius: t.r.card,
        padding,
      }}
    >
      {funnel}
    </div>
  );
}

// ─────────────────────────── Editorial (parity baseline) ───────────────────────────

function Editorial({ t, content, params, luckyDraw, funnel, formAnchorRef, scrollToForm, referrerName }) {
  const maxWidth = params.formWidth || 480; // v1 render default, NOT the editor-seed 400
  const showHeroCard = content.media.kind !== 'none' || content.paragraphs.length > 0;
  const showCta = content.media.kind !== 'none' && !!content.heroCtaLabel;
  return (
    <div
      style={{
        minHeight: '100vh',
        background: t.bg,
        backgroundImage: t.bgCss !== 'none' ? t.bgCss : undefined,
        padding: 'max(20px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom))',
        boxSizing: 'border-box',
        fontFamily: SANS,
        color: t.ink,
      }}
    >
      <div style={{ maxWidth, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            textAlign: 'center',
            fontFamily: t.fontStack,
            fontWeight: 900,
            fontSize: 'clamp(44px, 11vw, 64px)',
            lineHeight: 1.05,
            letterSpacing: '-0.01em',
            paddingTop: 6,
            color: t.ink,
          }}
        >
          {content.wordmark}
        </div>
        <DrawBadge t={t} luckyDraw={luckyDraw} />
        {showHeroCard && (
          <div style={{ background: t.storyCard, border: `1px solid ${t.line}`, borderRadius: t.r.card, overflow: 'hidden' }}>
            <MediaBlock t={t} media={content.media} radius={0} />
            <div style={{ padding: '17px 18px 19px' }}>
              {showCta && (
                <div style={{ textAlign: 'center', margin: '2px 0 14px' }}>
                  <HeroCta t={t} label={content.heroCtaLabel} onClick={scrollToForm} />
                </div>
              )}
              {content.paragraphs.map((p, i) => (
                <p key={i} style={{ fontSize: 14, lineHeight: 1.65, margin: '0 0 10px', color: t.bodyText }}>{p}</p>
              ))}
              {content.emphasis && (
                <p style={{ fontSize: 15, fontWeight: 700, margin: '2px 0 0', color: t.ink }}>{content.emphasis}</p>
              )}
            </div>
          </div>
        )}
        <ReferredBadge t={t} referrerName={referrerName} />
        <div
          ref={formAnchorRef}
          style={{
            background: t.card,
            border: `1px solid ${t.line}`,
            borderRadius: t.r.card,
            padding: '28px 24px 32px',
            boxSizing: 'border-box',
          }}
        >
          {funnel}
        </div>
        <BrandFooter t={t} content={content} />
      </div>
    </div>
  );
}

// ─────────────────────────────────── Poster ───────────────────────────────────

function Poster({ t, content, params, luckyDraw, funnel, formAnchorRef, scrollToForm, mobile, referrerName }) {
  const dusk = params.overlay !== 'plain';
  const fade = dusk ? t.bg : 'rgba(12,10,8,.45)';
  // The hero copy sits where the gradient has already reached `fade`, so its
  // colour has to follow that surface — a fixed white vanished on light presets.
  const heroInk = dusk ? onColor(t.bg) : '#FFF';
  const heroBackdrop = t.dark ? t.card : '#17191E';
  const showCta = content.media.kind !== 'none' && !!content.heroCtaLabel;
  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: SANS, color: t.ink }}>
      <div style={{ position: 'relative', height: mobile ? 430 : 480, background: heroBackdrop, overflow: 'hidden' }}>
        <MediaBlock t={t} media={content.media} radius={0} style={{ position: 'absolute', inset: 0, aspectRatio: 'auto', height: '100%' }} />
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to top, ${fade} 4%, rgba(12,10,8,.28) 55%, rgba(12,10,8,.2))` }} />
        <div style={{ position: 'absolute', top: 16, left: 18, fontFamily: t.fontStack, fontSize: 18, fontWeight: 700, color: '#FFF' }}>
          {content.wordmark}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: mobile ? 16 : 26, maxWidth: 620, margin: '0 auto', boxSizing: 'border-box' }}>
          {luckyDraw?.enabled === true && (
            <div style={{ display: 'inline-block', font: "600 10px ui-monospace, 'SF Mono', Menlo, monospace", background: dusk ? t.soft : 'rgba(255,255,255,.14)', color: heroInk, borderRadius: 999, padding: '5px 11px', marginBottom: 10, backdropFilter: 'blur(4px)' }}>
              <DrawBadgeText luckyDraw={luckyDraw} />
            </div>
          )}
          <div style={{ fontFamily: t.fontStack, fontSize: mobile ? 32 : 46, lineHeight: 1.06, fontWeight: 700, color: heroInk, letterSpacing: '-0.01em' }}>
            {content.headline}
          </div>
          {content.subheadline && (
            <div style={{ fontSize: 14, lineHeight: 1.5, color: heroInk, opacity: 0.85, margin: '10px 0 14px', maxWidth: 440, whiteSpace: 'pre-line' }}>
              {content.subheadline}
            </div>
          )}
          {showCta && <HeroCta t={t} label={content.heroCtaLabel} onClick={scrollToForm} style={{ minHeight: 48, marginBottom: 6 }} />}
        </div>
      </div>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: mobile ? 16 : 26, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(content.paragraphs.length > 0 || content.emphasis) && (
          <div>
            {content.paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 14.5, lineHeight: 1.65, margin: '0 0 10px', color: t.bodyText }}>{p}</p>
            ))}
            {content.emphasis && <p style={{ fontSize: 15, fontWeight: 700, margin: '2px 0 0' }}>{content.emphasis}</p>}
          </div>
        )}
        <ReferredBadge t={t} referrerName={referrerName} />
        <FormCard t={t} formAnchorRef={formAnchorRef} funnel={funnel} maxWidth={480} />
        <BrandFooter t={t} content={content} />
      </div>
    </div>
  );
}

function DrawBadgeText({ luckyDraw }) {
  const closes = formatDrawDate(luckyDraw?.closesAt);
  return <>{`🎁 LUCKY DRAW${closes ? ` · CLOSES ${closes.toUpperCase()}` : ''}`}</>;
}

// ─────────────────────────────────── Split ───────────────────────────────────

function Split({ t, content, params, luckyDraw, funnel, formAnchorRef, mobile, referrerName }) {
  const mediaSide = params.mediaSide === 'right' ? 'right' : 'left';
  const mediaPanel = (
    <div style={{ position: 'relative', background: t.dark ? t.card : '#17191E', minHeight: mobile ? 220 : 'auto', overflow: 'hidden' }}>
      <MediaBlock t={t} media={content.media} radius={0} style={{ position: 'absolute', inset: 0, aspectRatio: 'auto', height: '100%', objectFit: params.mediaFit === 'contain' ? 'contain' : 'cover' }} />
      {luckyDraw?.enabled === true && (
        <span style={{ position: 'absolute', top: 14, left: 14, font: "600 10px ui-monospace, 'SF Mono', Menlo, monospace", background: 'rgba(12,10,8,.72)', color: '#FFE9A8', borderRadius: 999, padding: '5px 11px' }}>
          <DrawBadgeText luckyDraw={luckyDraw} />
        </span>
      )}
    </div>
  );
  const formPanel = (
    <div style={{ background: t.card, padding: mobile ? '18px 16px' : '34px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ maxWidth: 440, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ fontFamily: t.fontStack, fontSize: 16, fontWeight: 700 }}>{content.wordmark}</div>
        <div style={{ fontFamily: t.fontStack, fontSize: mobile ? 25 : 31, lineHeight: 1.12, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {content.headline}
        </div>
        {content.subheadline && (
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: t.muted, whiteSpace: 'pre-line' }}>{content.subheadline}</div>
        )}
        <ReferredBadge t={t} referrerName={referrerName} />
        <div ref={formAnchorRef}>{funnel}</div>
        <BrandFooter t={t} content={content} compact />
      </div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : mediaSide === 'left' ? '1fr 1.05fr' : '1.05fr 1fr', minHeight: '100vh', background: t.bg, fontFamily: SANS, color: t.ink }}>
      {mediaSide === 'left' || mobile ? (
        <>
          {mediaPanel}
          {formPanel}
        </>
      ) : (
        <>
          {formPanel}
          {mediaPanel}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────── Spotlight ───────────────────────────────────

function Spotlight({ t, content, luckyDraw, funnel, formAnchorRef, stage, referrerName }) {
  const pastQuiz = stage !== 'quiz';
  return (
    <div style={{ minHeight: '100vh', background: t.bg, backgroundImage: t.bgCss !== 'none' ? t.bgCss : undefined, fontFamily: SANS, color: t.ink, padding: '16px 16px 0', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100vh', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
          <span style={{ fontFamily: t.fontStack, fontSize: 17, fontWeight: 700 }}>{content.wordmark}</span>
          <DrawBadge t={t} luckyDraw={luckyDraw} inverted={false} />
        </div>
        {pastQuiz && (
          <div>
            <div style={{ fontFamily: t.fontStack, fontSize: 24, lineHeight: 1.15, fontWeight: 700, marginBottom: 7 }}>{content.headline}</div>
            {content.paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 8px', color: t.bodyText }}>{p}</p>
            ))}
            {content.emphasis && <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{content.emphasis}</p>}
          </div>
        )}
        <ReferredBadge t={t} referrerName={referrerName} />
        <div
          ref={formAnchorRef}
          style={{
            background: pastQuiz ? t.card : 'transparent',
            border: pastQuiz ? `1px solid ${t.line}` : 'none',
            borderRadius: t.r.card,
            padding: pastQuiz ? 18 : 4,
          }}
        >
          {funnel}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <BrandFooter t={t} content={content} compact />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────── Express ───────────────────────────────────

function Express({ t, content, params, luckyDraw, funnel, formAnchorRef, referrerName }) {
  return (
    <div style={{ minHeight: '100vh', background: t.bg, backgroundImage: t.bgCss !== 'none' ? t.bgCss : undefined, fontFamily: SANS, color: t.ink, display: 'flex', flexDirection: 'column', justifyContent: 'safe center', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 430, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', fontFamily: t.fontStack, fontSize: 18, fontWeight: 700 }}>{content.wordmark}</div>
        <DrawBadge t={t} luckyDraw={luckyDraw} />
        <ReferredBadge t={t} referrerName={referrerName} />
        <FormCard t={t} formAnchorRef={formAnchorRef} funnel={funnel} padding="20px 18px" />
        {params.trustLine && (
          <div style={{ textAlign: 'center', fontSize: 11.5, color: t.muted }}>{params.trustLine}</div>
        )}
        <BrandFooter t={t} content={content} compact />
      </div>
    </div>
  );
}

// ─────────────────────────────────── Journey ───────────────────────────────────

function Journey({ t, content, params, luckyDraw, funnel, formAnchorRef, scrollToForm, mobile, stage, referrerName }) {
  const alternate = params.sectionRhythm !== 'stacked';
  const showSticky = params.stickyCta !== false && stage !== 'outcome';
  return (
    <div style={{ minHeight: '100vh', background: t.bg, backgroundImage: t.bgCss !== 'none' ? t.bgCss : undefined, fontFamily: SANS, color: t.ink }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: mobile ? 16 : 26, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ textAlign: 'center', fontFamily: t.fontStack, fontSize: 20, fontWeight: 700, paddingTop: 6 }}>{content.wordmark}</div>
        <DrawBadge t={t} luckyDraw={luckyDraw} />
        <div style={{ fontFamily: t.fontStack, fontSize: mobile ? 30 : 40, lineHeight: 1.1, fontWeight: 700, textAlign: 'center', letterSpacing: '-0.01em' }}>
          {content.headline}
        </div>
        <MediaBlock t={t} media={content.media} />
        {content.paragraphs.map((p, i) => (
          <div key={i} style={{ background: alternate && i % 2 === 0 ? t.soft : 'transparent', borderRadius: t.r.card, padding: alternate && i % 2 === 0 ? '16px 17px' : '4px 17px' }}>
            <div style={{ font: "600 10px ui-monospace, 'SF Mono', Menlo, monospace", letterSpacing: '.12em', color: accentTextOn(t.accent, t.bg), marginBottom: 7 }}>
              {`0${i + 1}`}
            </div>
            <p style={{ fontSize: 14.5, lineHeight: 1.7, margin: 0, color: t.bodyText }}>{p}</p>
          </div>
        ))}
        {content.emphasis && (
          <div style={{ border: `1.5px solid ${t.accent}`, borderRadius: t.r.card, padding: '14px 16px', textAlign: 'center', fontSize: 15, fontWeight: 700 }}>
            {content.emphasis}
          </div>
        )}
        <ReferredBadge t={t} referrerName={referrerName} />
        <FormCard t={t} formAnchorRef={formAnchorRef} funnel={funnel} maxWidth={480} />
        <div style={{ paddingBottom: showSticky ? 74 : 0 }}>
          <BrandFooter t={t} content={content} />
        </div>
      </div>
      {showSticky && (
        <div style={{ position: 'sticky', bottom: 0, background: t.card, borderTop: `1px solid ${t.line}`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {content.headline}
          </span>
          <button
            type="button"
            onClick={scrollToForm}
            style={{ minHeight: 42, padding: '0 18px', cursor: 'pointer', font: `700 13.5px ${SANS}`, color: t.onAccent, background: t.accent, border: 'none', borderRadius: t.r.btn === 999 ? 999 : t.r.btn, whiteSpace: 'nowrap' }}
          >
            {content.submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export const TEMPLATES = {
  editorial: Editorial,
  poster: Poster,
  split: Split,
  spotlight: Spotlight,
  express: Express,
  journey: Journey,
};
