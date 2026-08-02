/**
 * campaignPage shared chrome + helpers (P4-7). templates.jsx and
 * drawTemplates.jsx used to import these FROM CampaignPageRenderer while the
 * renderer imported their registries back — an import cycle the renderer
 * worked around with a lookup-time template merge. Everything both template
 * registries need now lives here, one layer down; the renderer re-exports
 * for external callers (StudioTopBar, tests).
 */
import { brand } from '@/lib/brand';
import { LIMITS } from '@/lib/designConfigV2';

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
const DRAW_COPY_KEYS = ['trustRow', 'scamLine', 'winnersNote', 'ctaSubline', 'freeEntryTag', 'boostBody'];

/** Overrides are honored ONLY as trimmed non-empty strings — the Studio binder
 * writes '' into the unsaved doc while a field is being cleared, and an empty
 * override must fall back to the composed default, never blank the line. */
function sanitizeDrawCopy(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const key of DRAW_COPY_KEYS) {
      const v = raw[key];
      if (typeof v === 'string' && v.trim()) out[key] = v.trim();
    }
  }
  return out;
}

/** Submit-CTA size (px) with the same real-number guard the funnel form and
 * the save clamp apply — the Studio feeds the UNSAVED doc, so junk mid-edit
 * must fall back to 16 (and Number() coercion would turn null into 12). */
function sanitizeSubmitFontSize(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 16;
  return Math.min(LIMITS.submitFontSizeMax, Math.max(LIMITS.submitFontSizeMin, Math.round(raw)));
}

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
    drawCopy: sanitizeDrawCopy(content.drawCopy),
    subheadline: content.subheadline || '',
    paragraphs,
    emphasis: content.emphasis || '',
    media: content.media || { kind: 'none', src: '', alt: '' },
    heroCtaLabel: (content.heroCtaLabel || '').trim(),
    submitLabel: content.submitLabel || 'Submit Now',
    submitFontSize: sanitizeSubmitFontSize(content.submitFontSize),
    regulatory: content.footer?.regulatory || brand.defaultRegulatory,
    // "MKTR" substring auto-links to mktr.sg (renderBrandFooter semantics).
    brandPre: mktrIdx >= 0 ? brandLine.slice(0, mktrIdx) : brandLine,
    brandLink: mktrIdx >= 0,
    brandPost: mktrIdx >= 0 ? brandLine.slice(mktrIdx + 4) : '',
  };
}

/* `data-se` marks a Studio-editable text slot for canvas click-to-edit
 * (studioEditTargets.js). Inert on live pages — no CSS or JS reads it
 * outside the Studio's [data-studio-edit-scope] wrapper. */
export function BrandFooter({ t, content, compact = false }) {
  return (
    <div style={{ textAlign: 'center', padding: compact ? '2px 8px 18px' : '6px 8px 22px' }}>
      {content.regulatory ? (
        <p data-se="content.footer.regulatory" style={{ fontSize: compact ? 10 : 10.5, lineHeight: 1.6, color: t.muted, margin: '0 0 8px', opacity: 0.85 }}>
          {content.regulatory}
        </p>
      ) : null}
      <div data-se="content.footer.brand" style={{ fontSize: compact ? 11 : 11.5, color: t.muted }}>
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
