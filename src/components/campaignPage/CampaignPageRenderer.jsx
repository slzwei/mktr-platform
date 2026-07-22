/**
 * design_config v2 campaign-page renderer (Campaign Studio PR 2).
 *
 * Mounted ONLY for `design_config.version === 2` documents (each mount
 * dispatches on classifyDesignConfigVersion; v1 docs keep the untouched
 * legacy trio). Replaces the PRESENTATION layer only — the interactive
 * funnel (QuizGate/CampaignQuiz + CampaignSignupForm + signup/*) is the
 * production implementation reused via funnelAdapter + CampaignThemeContext,
 * so endpoints, payloads, pixels, and legal copy are contract-identical by
 * construction. Page orchestration (campaign resolution, analytics moments,
 * submit outcomes, share sheet) stays with the mounting page.
 *
 * Templates: Editorial (v1 geometry EXACTLY — the parity baseline), Poster,
 * Split, Spotlight (quiz-first), Express, Journey, per the Campaign Studio
 * Phase 5 handoff + Campaign Page mock (semantics ported, code never copied).
 *
 * `jump` honors ONLY the renderer-owned blocked states in PR 2
 * ('inactive' | 'draw-closed'); the full funnel-state jumper ships with the
 * Studio (PR 3), which owns the preview-only controlled contract.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { brand } from '@/lib/brand';
import { heroFontStack } from '@/lib/heroFonts';
import { QuizGate } from '@/components/campaigns/CampaignQuiz';
import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import { CampaignThemeProvider } from './themeContext';
import { adaptCampaignForFunnel, deriveFunnelProps } from './funnelAdapter';
import { resolveJumpFixtures } from './previewJumpFixtures';
import { TEMPLATES } from './templates';
import { DRAW_TEMPLATES, DrawClosedPage } from './drawTemplates';

/** SGT day-end draw cutoff — mirrors marketplace content.js offerUnavailability
 * (entries close 23:59:59.999 SGT on closesAt; server 410s past it). */
export function isDrawClosed(luckyDraw, now = Date.now()) {
  if (!luckyDraw || luckyDraw.enabled !== true || !luckyDraw.closesAt) return false;
  const end = new Date(`${luckyDraw.closesAt}T23:59:59.999+08:00`).getTime();
  return Number.isFinite(end) && now > end;
}

function useIsMobile(nodeRef, breakpoint = 640) {
  // Initial value is a best guess from the parent-realm window (always correct
  // on live mounts). The effect re-measures from the rendered node's OWN
  // window (`ownerDocument.defaultView`) so the JS `mobile` branch is truthful
  // inside the Studio DeviceFrame iframe too (Studio PR 3) — on live pages
  // defaultView === window, so behavior is unchanged.
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const view =
      nodeRef.current?.ownerDocument?.defaultView ||
      (typeof window !== 'undefined' ? window : null);
    if (!view) return undefined;
    const measure = () => setMobile(view.innerWidth < breakpoint);
    measure();
    view.addEventListener('resize', measure);
    return () => view.removeEventListener('resize', measure);
  }, [nodeRef, breakpoint]);
  return mobile;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDrawDate(ymd) {
  // String-split, never Date math: closesAt is an SGT calendar date and any
  // timezone round-trip shifts it off by a day in other locales.
  const m = typeof ymd === 'string' ? ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : '';
}

/** Derive the page-chrome content slots from a v2 doc (same rules as
 * leadCaptureContent.js derives them from v1 keys). */
export function deriveCampaignPageContent(doc) {
  const content = doc.content || {};
  const host = doc.distribution?.host === 'mktr' ? 'mktr' : 'redeem';
  const wordmark = content.wordmark || (host === 'mktr' ? 'mktr.sg' : 'redeem.sg');
  const story = typeof content.story === 'string' ? content.story : '';
  const paragraphs = story.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const brandLine = content.footer?.brand || brand.defaultPoweredBy;
  const mktrIdx = brandLine.indexOf('MKTR');
  return {
    host,
    wordmark,
    headline: content.headline || 'Get Started',
    subheadline: content.subheadline || '',
    paragraphs,
    emphasis: content.emphasis || '',
    media: content.media || { kind: 'none', src: '', alt: '' },
    heroCtaLabel: (content.heroCtaLabel || '').trim(),
    submitLabel: content.submitLabel || 'Submit Now',
    regulatory: content.footer?.regulatory || brand.defaultRegulatory,
    // "MKTR" substring auto-links to mktr.sg (renderBrandFooter semantics).
    brandPre: mktrIdx >= 0 ? brandLine.slice(0, mktrIdx) : brandLine,
    brandLink: mktrIdx >= 0,
    brandPost: mktrIdx >= 0 ? brandLine.slice(mktrIdx + 4) : '',
  };
}

export function BrandFooter({ t, content, compact = false }) {
  return (
    <div style={{ textAlign: 'center', padding: compact ? '2px 8px 18px' : '6px 8px 22px' }}>
      {content.regulatory ? (
        <p style={{ fontSize: compact ? 10 : 10.5, lineHeight: 1.6, color: t.muted, margin: '0 0 8px', opacity: 0.85 }}>
          {content.regulatory}
        </p>
      ) : null}
      <div style={{ fontSize: compact ? 11 : 11.5, color: t.muted }}>
        {content.brandPre}
        {content.brandLink && (
          <a
            href="https://mktr.sg"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: t.muted, textDecoration: 'underline' }}
          >
            MKTR
          </a>
        )}
        {content.brandPost}
      </div>
    </div>
  );
}

export function DrawBadge({ t, luckyDraw, inverted = true }) {
  if (!luckyDraw || luckyDraw.enabled !== true) return null;
  const closes = formatDrawDate(luckyDraw.closesAt);
  return (
    <div
      style={{
        alignSelf: 'center',
        font: "600 10.5px ui-monospace, 'SF Mono', Menlo, monospace",
        letterSpacing: '.06em',
        background: inverted ? t.ink : t.soft,
        color: inverted ? t.bg : t.ink,
        border: inverted ? 'none' : `1px solid ${t.line}`,
        borderRadius: 999,
        padding: '6px 12px',
        width: 'fit-content',
      }}
    >
      {`🎁 LUCKY DRAW${closes ? ` · CLOSES ${closes.toUpperCase()}` : ''}`}
    </div>
  );
}

function BlockedPage({ t, content, reason, luckyDraw }) {
  const isDraw = reason === 'draw';
  const closes = formatDrawDate(luckyDraw?.closesAt);
  return (
    <div
      data-campaign-page-blocked={reason}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 32,
        boxSizing: 'border-box',
        background: t.bg,
        color: t.ink,
        fontFamily: "'Albert Sans', system-ui, sans-serif",
      }}
    >
      <div style={{ fontFamily: t.fontStack, fontSize: 19, fontWeight: 700, marginBottom: 26 }}>{content.wordmark}</div>
      <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden="true">{isDraw ? '🎁' : '⏸️'}</div>
      <div style={{ fontFamily: t.fontStack, fontSize: 24, fontWeight: 700, marginBottom: 8, maxWidth: 400 }}>
        {isDraw ? 'This draw has closed.' : 'This campaign is no longer active.'}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: t.muted, maxWidth: 380 }}>
        {isDraw
          ? `Entries closed${closes ? ` on ${closes}` : ''}, 11:59pm SGT. Winners will be notified by SMS and email.`
          : `Follow ${content.host === 'mktr' ? 'mktr.sg' : 'redeem.sg'} for upcoming campaigns and rewards.`}
      </div>
      <div style={{ fontSize: 11, color: t.muted, marginTop: 34, opacity: 0.8 }}>
        {content.brandPre}
        {content.brandLink && (
          <a href="https://mktr.sg" style={{ color: t.muted, textDecoration: 'underline' }}>MKTR</a>
        )}
        {content.brandPost}
      </div>
    </div>
  );
}

export function ReferredBadge({ t, referrerName }) {
  if (!referrerName) return null;
  return (
    <div
      style={{
        margin: '0 auto 14px',
        width: 'fit-content',
        background: t.storyCard,
        border: `1px solid ${t.hairline || t.line}`,
        borderRadius: 999,
        padding: '7px 14px',
        fontFamily: "'Albert Sans', system-ui, sans-serif",
        fontSize: 13,
        color: t.bodyText,
      }}
    >
      👋 Referred by {referrerName}
    </div>
  );
}

export default function CampaignPageRenderer({
  campaign,
  previewMode = false,
  jump = null,
  inactive = false,
  referrerName = null,
  onSubmit,
  onQuizReveal,
  onQuizComplete,
}) {
  const adapted = useMemo(() => adaptCampaignForFunnel(campaign), [campaign]);
  const doc = adapted.doc;
  // resolveTheme yields a font ID; templates need the CSS stack (production helper).
  const t = useMemo(
    () => ({ ...adapted.theme, fontStack: heroFontStack(adapted.theme?.fontId) }),
    [adapted.theme]
  );
  const content = useMemo(() => deriveCampaignPageContent(doc), [doc]);
  const rootRef = useRef(null);
  const mobile = useIsMobile(rootRef);
  const [stage, setStage] = useState('quiz');
  const formAnchorRef = useRef(null);
  const scrollToForm = useCallback(() => {
    formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const templateId = doc.template?.id || 'editorial';

  const blocked = jump === 'inactive' || inactive
    ? 'inactive'
    : jump === 'draw-closed' || isDrawClosed(doc.luckyDraw)
      ? 'draw'
      : null;
  if (blocked) {
    // The five draw templates own their designed closed page; everything else
    // (and the inactive state) keeps the shared BlockedPage.
    if (blocked === 'draw' && DRAW_TEMPLATES[templateId]) {
      return (
        <DrawClosedPage
          templateId={templateId}
          t={t}
          content={content}
          luckyDraw={doc.luckyDraw}
          campaignName={campaign?.name}
        />
      );
    }
    return <BlockedPage t={t} content={content} reason={blocked} luckyDraw={doc.luckyDraw} />;
  }

  // Studio jump fixtures (PR 3): resolved ONLY in previewMode against the
  // current doc; the Studio remounts this whole renderer per jump/reset, so
  // fixtures act purely as initial state. Live mounts (jump=null) skip this.
  const jumpFixtures = previewMode ? resolveJumpFixtures(jump, doc) : null;
  const funnelProps = deriveFunnelProps(adapted, {
    onSubmit,
    previewMode,
    previewFixture: jumpFixtures?.form,
  });
  const funnel = (
    <CampaignThemeProvider value={adapted.funnelTheme}>
      {/* Keyed on previewMode (Codex diff-review #1): fixture state lives in
          lazy useState initializers, so a hypothetical preview→live rerender
          of the SAME mount must REMOUNT the funnel — otherwise seeded state
          would survive into a live capture. Every current call site passes a
          static previewMode; this makes the component contract safe even for
          a future one that doesn't. */}
      <QuizGate
        key={previewMode ? 'funnel-preview' : 'funnel-live'}
        quiz={adapted.legacy.quiz}
        themeColor={t.accent}
        previewMode={previewMode}
        previewFixture={jumpFixtures?.quiz}
        onReveal={onQuizReveal}
        onComplete={onQuizComplete}
        onStageChange={setStage}
      >
        <CampaignSignupForm {...funnelProps} />
      </QuizGate>
    </CampaignThemeProvider>
  );

  // Merged at lookup time (not module scope) — templates.jsx and
  // drawTemplates.jsx sit in an import cycle with this file, so a module-scope
  // spread of either registry would hit the const TDZ depending on entry order.
  const Template = TEMPLATES[templateId] || DRAW_TEMPLATES[templateId] || TEMPLATES.editorial;
  const params = doc.template?.params?.[templateId] || {};

  return (
    <div ref={rootRef} data-campaign-page-template={templateId} data-campaign-page-ready="true">
      <Template
        t={t}
        content={content}
        params={params}
        luckyDraw={doc.luckyDraw}
        funnel={funnel}
        formAnchorRef={formAnchorRef}
        scrollToForm={scrollToForm}
        mobile={mobile}
        stage={stage}
        referrerName={referrerName}
        campaignName={campaign?.name}
        formJumpActive={Boolean(jumpFixtures?.form)}
      />
    </div>
  );
}
