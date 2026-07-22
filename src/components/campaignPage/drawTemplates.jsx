/**
 * The five lucky-draw page templates (claude.ai/design "Design Review: Three
 * Colorways" → Campaign Templates.dc.html, 2026-07-22) — Postcard (default
 * recommendation), Gazette, Nightfall, Stub, Checklist. Semantics ported from
 * the design file, never its markup.
 *
 * Unlike the six generic templates (templates.jsx), these are ART-DIRECTED:
 * each carries its own fixed neutral palette and the Fraunces / Albert Sans /
 * JetBrains Mono stack (all loaded globally via index.css); only the ACCENT
 * follows the campaign theme (design proof: accent swap across all five).
 * The funnel form inside still renders with the campaign's funnelTheme —
 * pick light presets for these templates.
 *
 * Every direction owns all three page states:
 *  - OPEN      → registry component (same prop bag as templates.jsx)
 *  - SUCCESS   → DrawSuccessPage (mounted by LeadCapture after submit)
 *  - CLOSED    → DrawClosedPage (mounted by CampaignPageRenderer past closesAt)
 * Draw chrome is conditional on luckyDraw.enabled — with no draw these render
 * as clean lead-capture layouts, so selecting them on a non-draw campaign is
 * safe (the picker does not restrict them).
 */
import { useState } from 'react';
import {
  ReferredBadge,
  deriveCampaignPageContent,
  formatDrawDate,
} from './CampaignPageRenderer';
import { MediaBlock } from './templates';
import { accentTextOn, resolveTheme } from '@/lib/designConfigV2';
import { DRAW_RECORD_PHRASE } from '@/lib/drawCopy';

const SANS = "'Albert Sans', system-ui, sans-serif";
const SERIF = "'Fraunces', Georgia, serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const TRUST_ROW = 'SMS-VERIFIED · ONE ENTRY PER NUMBER · FREE TO ENTER';
const SCAM_LINE = 'We never ask for payment to release a prize.';
const WINNERS_URL = 'https://redeem.sg/winners';

const mono = (fontSize, extra = {}) => ({ fontFamily: MONO, fontSize, ...extra });
const serifItalic = (fontSize, extra = {}) => ({
  fontFamily: SERIF, fontStyle: 'italic', fontWeight: 600, fontSize, ...extra,
});

/** '2026-10-30' → '30 Oct 2026' (string split — closesAt is an SGT calendar date). */
export function formatDrawDateFull(ymd) {
  const short = formatDrawDate(ymd);
  if (!short) return '';
  return `${short} ${ymd.slice(0, 4)}`;
}

/** Whole days until the SGT day-end of closesAt (display-only countdown). */
export function drawDaysLeft(closesAt, now = Date.now()) {
  if (!closesAt) return null;
  const end = new Date(`${closesAt}T23:59:59+08:00`).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 86400000));
}

/** '+6591234312' / '91234312' → '+65 9••• 4312' (success-screen confirmation). */
export function maskSgPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('65') && digits.length === 10 ? digits.slice(2) : digits;
  if (local.length < 5) return null;
  return `+65 ${local[0]}••• ${local.slice(-4)}`;
}

/** All the derived draw strings the three states share. */
function drawStrings(luckyDraw, campaignName) {
  const draw = luckyDraw?.enabled === true ? luckyDraw : null;
  const m = draw?.multiplier || 10;
  const closesFull = draw ? formatDrawDateFull(draw.closesAt) : '';
  const boostFull = draw ? formatDrawDateFull(draw.boostClosesAt || draw.closesAt) : '';
  // Winner-count-aware copy: `winners` is derived from structured prizes on
  // the server (Σqty) and defaults to 1 for legacy single-prize draws — the
  // singular strings below stay byte-identical when winners ≤ 1.
  const winners = Number.isInteger(draw?.winners) && draw.winners > 1 ? draw.winners : 1;
  return {
    draw,
    multiplier: m,
    prize: draw?.prize || '',
    winners,
    winnersLine: winners > 1 ? `${winners} winners, drawn in a witnessed process.` : 'One winner, drawn in a witnessed process.',
    closesFull,
    closesMono: closesFull ? closesFull.toUpperCase() : '',
    boostFull,
    kicker: (campaignName || '').toUpperCase(),
    boostBody: `Meet a consultant for a complimentary 20-minute financial review before ${boostFull} — when ${DRAW_RECORD_PHRASE}, your 1 entry becomes ${m}.`,
    steps: [
      'Your entry pass arrives by WhatsApp and email.',
      `Book your complimentary ~20-min financial review — any time before ${boostFull}.`,
      `Meet your consultant — when they record your completed session, your 1 entry becomes ${m} entries.`,
    ],
    closedBody: winners > 1
      ? `The ${winners} winners are being drawn in a witnessed process and will be contacted directly by phone or SMS.`
      : 'The winner is being drawn in a witnessed process and will be contacted directly by phone or SMS.',
    freeSessionLine: `FREE SESSION · NO PAYMENT EVER · BEFORE ${boostFull.toUpperCase()}`,
  };
}

const accentSoftOf = (accent) => `${accent}1A`;

/**
 * The art-directed neutrals, in both polarities. `light` is the frozen palette
 * each direction shipped with; `dark` is its twin. Without the flip a dark
 * preset left the page cream while the funnel painted its own text from the
 * preset's near-white `ink` — the whole form went light-on-light.
 * `card` is the surface that HOSTS the funnel (every '#fff' box reads it);
 * `line` is the single divider key the success/closed chrome reads for all
 * five. Nightfall is the one direction whose shipped palette WAS the dark
 * block, so its `light` twin is new rather than frozen.
 */
const PALETTES = {
  postcard: {
    light: { bg: '#F6F4EE', ink: '#17181B', body: '#4A463C', mut: '#8B8477', faint: '#9A948A', line: '#E4E1D6', heroInk: '#17191E', card: '#FFFFFF' },
    dark: { bg: '#16171A', ink: '#F4F3EF', body: '#C8C5BC', mut: '#928D82', faint: '#7C776D', line: '#2C2E31', heroInk: '#0E0F12', card: '#202226' },
  },
  gazette: {
    light: { bg: '#FBF7EE', ink: '#1B1A17', body: '#4A463C', mut: '#6B6558', faint: '#9A948A', hair: '#E6E0D1', line: '#E6E0D1', gold: '#A97B1E', card: '#FBF7EE' },
    dark: { bg: '#171613', ink: '#F5F2EA', body: '#CFCABD', mut: '#A39D8F', faint: '#7E7969', hair: '#33302A', line: '#33302A', gold: '#E3B85C', card: '#1F1E1A' },
  },
  nightfall: {
    light: { bg: '#F5F4F0', ink: '#16171B', body: '#3E4048', mut: '#6E7180', faint: '#8B8E9A', border: 'rgba(22,23,27,.14)', line: 'rgba(22,23,27,.14)', card: '#FFFFFF' },
    dark: { bg: '#14161F', ink: '#F2F1EC', body: '#C9CBD6', mut: '#A7A9B8', faint: '#6E7180', border: 'rgba(242,241,236,.18)', line: 'rgba(242,241,236,.18)', card: '#1E212C' },
  },
  stub: {
    light: { bg: '#EFEBE0', ink: '#1B1A17', body: '#4A463C', mut: '#6B6558', faint: '#9A948A', dash: '#D9D4C8', line: '#DDD8CB', card: '#FFFFFF' },
    dark: { bg: '#171613', ink: '#F3F0E8', body: '#CBC6BA', mut: '#A09A8C', faint: '#807A6C', dash: '#3A372F', line: '#33302A', card: '#201F1B' },
  },
  checklist: {
    light: { bg: '#FFFFFF', ink: '#17181B', body: '#4A463C', mut: '#6B6558', faint: '#9A948A', line: '#E9E6DD', railBg: '#F3F1EA', card: '#FFFFFF' },
    dark: { bg: '#15161A', ink: '#F3F3F0', body: '#C7C5BE', mut: '#9C9A92', faint: '#7B7972', line: '#2B2D31', railBg: '#212227', card: '#1D1F23' },
  },
};

/** Art-directed neutrals, flipped by the preset's light/dark polarity. */
export const drawPalette = (id, t) => PALETTES[id]?.[t?.dark ? 'dark' : 'light'] || PALETTES.postcard.light;

/** Nightfall's hero is a hardcoded dark plate — its scrims are translucent and
 *  its type is white — so the plate keeps the dark base on every preset. */
const NF_HERO = PALETTES.nightfall.dark.bg;

/** Absolute-fill hero media (poster-template pattern) behind a scrim. */
function BackdropMedia({ t, media }) {
  if (!media || media.kind === 'none' || !media.src) return null;
  return (
    <MediaBlock
      t={t}
      media={media}
      radius={0}
      style={{ position: 'absolute', inset: 0, aspectRatio: 'auto', height: '100%' }}
    />
  );
}

function WinnersLink({ color }) {
  return (
    <a href={WINNERS_URL} target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: 'underline' }}>
      redeem.sg/winners
    </a>
  );
}

/** scam + winners + regulatory stack used by every open state's footer. */
function DrawFootnotes({ draw, linkColor, mutedColor, faintColor, content, center = false }) {
  const align = center ? 'center' : 'left';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: align }}>
      {draw && (
        <div style={{ fontSize: 12.5, color: mutedColor, fontFamily: SANS }}>
          {SCAM_LINE} Masked results at <WinnersLink color={linkColor} />.
        </div>
      )}
      <div style={{ fontSize: 11, color: faintColor, fontFamily: SANS }}>
        {content.regulatory}
        <span style={{ display: 'block', marginTop: 4 }}>
          {content.brandPre}
          {content.brandLink && (
            <a href="https://mktr.sg" target="_blank" rel="noopener noreferrer" style={{ color: faintColor, textDecoration: 'underline' }}>MKTR</a>
          )}
          {content.brandPost}
        </span>
      </div>
    </div>
  );
}

// ───────────────────────── shared SUCCESS building blocks ─────────────────────────

function ChancesRow({ accent, accentLabel, inkColor, mutedColor, multiplier }) {
  const cell = (big, label, color, labelColor) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 38, lineHeight: 1, color }}>{big}</div>
      <div style={mono(9.5, { letterSpacing: 1, color: labelColor })}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      {cell('1x', 'NOW', inkColor, mutedColor)}
      <div style={{ fontSize: 22, color: mutedColor }}>→</div>
      {cell(`${multiplier}x`, 'AFTER YOUR REVIEW', accent, accentLabel || accent)}
    </div>
  );
}

// `accent` fills the CTA; `accentText` is the same accent stepped until it is
// legible AS TEXT on the card, and `onAccent` is what sits ON the fill.
function NextSteps({ s, accent, accentText, onAccent, stepBg, stepColor, bodyColor, lastColor, mutedColor, label, bookingUrl, ctaRadius = 9 }) {
  return (
    <>
      <div style={mono(11, { letterSpacing: 1.5, color: accentText, fontWeight: 600 })}>{label}</div>
      {s.steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: stepBg, color: stepColor, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: SANS }}>{i + 1}</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: i === 2 ? lastColor : bodyColor, fontWeight: i === 2 ? 600 : 400, fontFamily: SANS }}>{step}</div>
        </div>
      ))}
      {bookingUrl && (
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ background: accent, color: onAccent, border: 'none', borderRadius: ctaRadius, padding: 13, fontSize: 14.5, fontWeight: 700, fontFamily: SANS, textAlign: 'center', textDecoration: 'none', display: 'block' }}
        >
          Book your 20-min review
        </a>
      )}
      <div style={mono(9.5, { letterSpacing: 0.8, color: mutedColor, textAlign: 'center' })}>{s.freeSessionLine}</div>
    </>
  );
}

function successSubOf(submittedPhone) {
  const masked = maskSgPhone(submittedPhone);
  return `Entry confirmed${masked ? ` for ${masked}` : ''} — you have 1 chance in the draw. Your entry pass is on its way by WhatsApp and email.`;
}

// ═══════════════════════════════ POSTCARD ═══════════════════════════════

function Postcard({ t, content, params, luckyDraw, funnel, formAnchorRef, mobile, referrerName, campaignName }) {
  const accent = t.accent;
  const PC = drawPalette('postcard', t);
  const accentInk = accentTextOn(accent, PC.bg);
  const s = drawStrings(luckyDraw, campaignName);
  const flush = params.cardStyle === 'flush';
  const cardFrame = {
    background: PC.card,
    borderRadius: 14,
    ...(flush
      ? { border: `1px solid ${PC.line}`, margin: '14px 16px 0' }
      : { boxShadow: '0 8px 28px rgba(23,24,27,.10)', margin: '-36px 16px 0', position: 'relative' }),
    padding: '18px 18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  };
  const facts = s.draw ? [
    <><strong style={{ color: PC.ink }}>One verified entry.</strong> SMS code confirms your number — one entry per person, no bots.</>,
    <><strong style={{ color: PC.ink }}>Entries close {s.closesFull},</strong> 23:59 SGT. {s.winnersLine}</>,
    <><strong style={{ color: PC.ink }}>Make it ×{s.multiplier}.</strong> {s.boostBody}</>,
  ] : [];
  const hero = (
    <div style={{ position: 'relative', height: mobile ? 300 : 'auto', minHeight: mobile ? 300 : '100%', flexShrink: 0, background: PC.heroInk }}>
      <BackdropMedia t={t} media={content.media} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(18,19,28,.15) 40%, rgba(18,19,28,.68))' }} />
      <div style={{ position: 'absolute', top: 16, left: 20, right: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: '#fff', fontFamily: SANS }}>{content.wordmark}</div>
        {s.draw && <div style={mono(10, { letterSpacing: 1.5, color: 'rgba(255,255,255,.85)' })}>LUCKY DRAW · FREE ENTRY</div>}
      </div>
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: mobile ? 56 : 36, color: '#fff' }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: mobile ? 33 : 46, lineHeight: 1.12 }}>{content.headline}</div>
        {content.subheadline && (
          <div style={{ marginTop: 6, fontSize: mobile ? 14 : 17, color: 'rgba(255,255,255,.88)', fontFamily: SANS, whiteSpace: 'pre-line' }}>{content.subheadline}</div>
        )}
      </div>
    </div>
  );
  const cardHeader = s.draw && (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ background: accentSoftOf(accent), color: accentInk, fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: '5px 10px', borderRadius: 99, fontFamily: SANS, textTransform: 'uppercase' }}>
        {s.prize || 'LUCKY DRAW'}
      </div>
      {s.closesMono && <div style={mono(10.5, { color: PC.mut })}>{`CLOSES ${s.closesMono}`}</div>}
    </div>
  );
  const belowCard = (
    <div style={{ padding: '22px 24px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {content.paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize: 14, lineHeight: 1.55, color: PC.body, fontFamily: SANS }}>{p}</div>
      ))}
      {content.emphasis && <div style={{ fontSize: 15, fontWeight: 700, color: PC.ink, fontFamily: SANS }}>{content.emphasis}</div>}
      {facts.length > 0 && (
        params.factStyle === 'inline' ? (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: PC.body, fontFamily: SANS }}>
            One verified entry per number · Entries close {s.closesFull}, 23:59 SGT · ×{s.multiplier} after your complimentary review.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {facts.map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 12 }}>
                <div style={mono(12, { color: accentInk, fontWeight: 600 })}>{`0${i + 1}`}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: PC.body, fontFamily: SANS }}>{f}</div>
              </div>
            ))}
          </div>
        )
      )}
      <div style={{ borderTop: `1px solid ${PC.line}`, paddingTop: 14 }}>
        <DrawFootnotes draw={s.draw} linkColor={accentInk} mutedColor={PC.mut} faintColor={PC.faint} content={content} t={t} />
      </div>
    </div>
  );
  const formCard = (
    <div style={cardFrame} ref={formAnchorRef}>
      {cardHeader}
      <ReferredBadge t={t} referrerName={referrerName} />
      {funnel}
      {s.draw && <div style={mono(9.5, { letterSpacing: 0.8, color: PC.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
    </div>
  );
  if (!mobile) {
    const mediaLeft = params.mediaSide !== 'right';
    const formPane = (
      <div style={{ width: '50%', padding: '44px 48px', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box' }}>
        {cardHeader}
        <div style={{ background: PC.card, borderRadius: 14, boxShadow: flush ? 'none' : '0 8px 28px rgba(23,24,27,.08)', border: flush ? `1px solid ${PC.line}` : 'none', padding: 22 }} ref={formAnchorRef}>
          <ReferredBadge t={t} referrerName={referrerName} />
          {funnel}
        </div>
        {s.draw && <div style={mono(10.5, { letterSpacing: 0.8, color: PC.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
        {content.paragraphs.map((p, i) => (
          <div key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: PC.body, fontFamily: SANS }}>{p}</div>
        ))}
        <div style={{ marginTop: 'auto' }}>
          <DrawFootnotes draw={s.draw} linkColor={accentInk} mutedColor={PC.mut} faintColor={PC.faint} content={content} t={t} />
        </div>
      </div>
    );
    const heroPane = <div style={{ width: '50%', position: 'relative', background: PC.heroInk }}>
      <BackdropMedia t={t} media={content.media} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(18,19,28,.1) 40%, rgba(18,19,28,.7))' }} />
      <div style={{ position: 'absolute', top: 26, left: 32, fontWeight: 800, fontSize: 20, color: '#fff', fontFamily: SANS }}>{content.wordmark}</div>
      <div style={{ position: 'absolute', left: 32, right: 32, bottom: 36, color: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 46, lineHeight: 1.1 }}>{content.headline}</div>
        {content.subheadline && <div style={{ fontSize: 17, color: 'rgba(255,255,255,.88)', fontFamily: SANS, whiteSpace: 'pre-line' }}>{content.subheadline}</div>}
      </div>
    </div>;
    return (
      <div style={{ minHeight: '100vh', background: PC.bg, display: 'flex', fontFamily: SANS, color: PC.ink }}>
        {mediaLeft ? <>{heroPane}{formPane}</> : <>{formPane}{heroPane}</>}
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100vh', background: PC.bg, display: 'flex', flexDirection: 'column', fontFamily: SANS, color: PC.ink }}>
      {hero}
      {formCard}
      {belowCard}
    </div>
  );
}

// ═══════════════════════════════ GAZETTE ═══════════════════════════════

function gazetteSerial(campaignName, closesAt) {
  const initials = (campaignName || '')
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => /[a-zA-Z]/.test(c || ''))
    .slice(0, 3)
    .join('')
    .toUpperCase() || 'DRW';
  const year = typeof closesAt === 'string' ? closesAt.slice(0, 4) : '';
  return `SER. ${initials}${year ? `-${year}` : ''}`;
}

/** Rendered by the open, success AND closed gazette states — each passes its
 *  own resolved neutrals rather than closing over one frozen palette. */
function GazetteMasthead({ content, kickerText, inkColor, mutedColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `2px solid ${inkColor}`, paddingBottom: 10, gap: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 17, fontFamily: SANS }}>{content.wordmark}</div>
      <div style={mono(10, { letterSpacing: 1.6, color: mutedColor, textAlign: 'right' })}>{kickerText}</div>
    </div>
  );
}

function Gazette({ t, content, params, luckyDraw, funnel, formAnchorRef, mobile, referrerName, campaignName }) {
  const accent = t.accent;
  const GZ = drawPalette('gazette', t);
  const accentInk = accentTextOn(accent, GZ.bg);
  const s = drawStrings(luckyDraw, campaignName);
  const dense = params.ruleDensity === 'dense';
  const rowPad = dense ? '6px 0' : '10px 0';
  const linkColor = params.accentUse === 'text' ? GZ.ink : accentInk;
  const factRow = (label, node, last = false) => (
    <div key={label} style={{ display: 'flex', gap: 14, borderTop: `1px solid ${GZ.hair}`, ...(last ? { borderBottom: `1px solid ${GZ.hair}` } : {}), padding: rowPad }}>
      <div style={mono(10.5, { letterSpacing: 1, color: GZ.mut, paddingTop: 2, width: mobile ? 72 : 86, flexShrink: 0 })}>{label}</div>
      <div style={{ fontSize: mobile ? 13.5 : 15, fontFamily: SANS }}>{node}</div>
    </div>
  );
  const factTable = s.draw && (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {factRow('PRIZE', <strong>{s.prize || content.headline}</strong>)}
      {factRow('CLOSES', <strong>{s.closesFull} · 23:59 SGT</strong>)}
      {factRow('ENTRY', 'One per verified mobile · SMS-verified · Free')}
      {factRow('BOOST', `×${s.multiplier} when a consultant meets you and scans your pass at a free 20-min review`, true)}
    </div>
  );
  const photoPlate = content.media.kind !== 'none' && content.media.src ? (
    <div style={{ borderTop: `1px solid ${GZ.hair}`, borderBottom: `1px solid ${GZ.hair}`, padding: '10px 0 8px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ height: mobile ? 130 : 170, overflow: 'hidden', position: 'relative' }}>
        <BackdropMedia t={t} media={content.media} />
      </div>
      <div style={mono(9, { letterSpacing: 1.2, color: GZ.mut })}>PRIZE DESTINATION</div>
    </div>
  ) : null;
  const formBox = (
    <div ref={formAnchorRef} style={{ background: GZ.card, border: `1.5px solid ${GZ.ink}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={mono(10.5, { letterSpacing: 1.6, fontWeight: 600 })}>ENTRY FORM — 01</div>
        {params.showSerial !== false && <div style={mono(10, { color: GZ.mut })}>{gazetteSerial(campaignName, s.draw?.closesAt)}</div>}
      </div>
      <ReferredBadge t={t} referrerName={referrerName} />
      {funnel}
      {s.draw && <div style={mono(9.5, { letterSpacing: 0.8, color: GZ.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
    </div>
  );
  const footnotes = (
    <DrawFootnotes draw={s.draw} linkColor={linkColor} mutedColor={GZ.mut} faintColor={GZ.faint} content={content} t={t} center={mobile} />
  );
  if (!mobile) {
    return (
      <div style={{ minHeight: '100vh', background: GZ.bg, padding: '36px 56px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 26, fontFamily: SANS, color: GZ.ink }}>
        <GazetteMasthead content={content} kickerText={`OFFICIAL ENTRY FORM${s.kicker ? ` · ${s.kicker}` : ''}`} inkColor={GZ.ink} mutedColor={GZ.mut} />
        <div style={{ display: 'flex', gap: 56 }}>
          <div style={{ flex: 1.1, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 52, lineHeight: 1.08 }}>{content.headline}</div>
            {content.paragraphs.map((p, i) => (
              <div key={i} style={{ fontSize: 16, lineHeight: 1.55, color: GZ.mut }}>{p}</div>
            ))}
            {photoPlate}
            {factTable}
            {content.emphasis && <div style={serifItalic(19, { color: GZ.ink })}>{content.emphasis}</div>}
            {footnotes}
          </div>
          <div style={{ width: 400, flexShrink: 0 }}>{formBox}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100vh', background: GZ.bg, display: 'flex', flexDirection: 'column', padding: '18px 20px 24px', boxSizing: 'border-box', fontFamily: SANS, color: GZ.ink }}>
      <GazetteMasthead content={content} kickerText="OFFICIAL ENTRY FORM" inkColor={GZ.ink} mutedColor={GZ.mut} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 36, lineHeight: 1.1 }}>{content.headline}</div>
          {content.subheadline && <div style={{ fontSize: 14, lineHeight: 1.5, color: GZ.mut, whiteSpace: 'pre-line' }}>{content.subheadline}</div>}
        </div>
        {photoPlate}
        {factTable}
        {formBox}
        {footnotes}
      </div>
    </div>
  );
}

// ═══════════════════════════════ NIGHTFALL ═══════════════════════════════

function Nightfall({ t, content, params, luckyDraw, funnel, formAnchorRef, mobile, referrerName, campaignName, formJumpActive = false }) {
  const accent = t.accent;
  const NF = drawPalette('nightfall', t);
  const accentInk = accentTextOn(accent, NF.bg);
  const s = drawStrings(luckyDraw, campaignName);
  const [sheetOpen, setSheetOpen] = useState(formJumpActive);
  const days = s.draw && params.showCountdown !== false ? drawDaysLeft(s.draw.closesAt) : null;
  const scrim = params.overlayTone === 'dusk'
    ? 'linear-gradient(rgba(43,36,54,.22) 30%, rgba(28,24,38,.86) 78%)'
    : 'linear-gradient(rgba(20,22,31,.30) 30%, rgba(20,22,31,.92) 78%)';
  const ctaRadius = params.ctaStyle === 'pill' ? 999 : 10;
  const countdownChip = days !== null && (
    <div style={{ alignSelf: 'flex-start', border: '1px solid rgba(255,255,255,.35)', borderRadius: 99, padding: '6px 12px', ...mono(10.5, { letterSpacing: 1.2, color: '#fff' }) }}>
      {`${days} DAYS LEFT · CLOSES ${s.closesMono}`}
    </div>
  );
  const trustLine = s.draw && (
    <div style={mono(9.5, { letterSpacing: 0.8, color: 'rgba(255,255,255,.65)' })}>{TRUST_ROW}</div>
  );
  if (!mobile) {
    return (
      <div style={{ minHeight: '100vh', background: NF_HERO, position: 'relative', display: 'flex', flexDirection: 'column', fontFamily: SANS }}>
        <BackdropMedia t={t} media={content.media} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, rgba(20,22,31,.9) 34%, rgba(20,22,31,.35))' }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '26px 40px' }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{content.wordmark}</div>
          {s.draw && <div style={mono(11, { letterSpacing: 1.6, color: 'rgba(255,255,255,.8)' })}>FREE ENTRY</div>}
        </div>
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', gap: 60, padding: '0 56px 40px' }}>
          <div style={{ flex: 1, color: '#fff', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {countdownChip}
            <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 58, lineHeight: 1.06 }}>{content.headline}</div>
            {content.subheadline && <div style={{ fontSize: 18, lineHeight: 1.5, color: 'rgba(255,255,255,.85)', maxWidth: 440, whiteSpace: 'pre-line' }}>{content.subheadline}</div>}
            {trustLine}
            {s.draw && (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)' }}>
                {SCAM_LINE} Masked results at <WinnersLink color="#fff" />.
              </div>
            )}
          </div>
          <div ref={formAnchorRef} style={{ width: 400, flexShrink: 0, background: NF.card, borderRadius: 16, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {content.emphasis && <div style={{ ...serifItalic(20), color: NF.ink }}>{content.emphasis}</div>}
            <ReferredBadge t={t} referrerName={referrerName} />
            {funnel}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100vh', background: NF.bg, color: NF.ink, display: 'flex', flexDirection: 'column', position: 'relative', fontFamily: SANS }}>
      <div style={{ position: 'relative', minHeight: '100vh', background: NF_HERO, display: 'flex', flexDirection: 'column' }}>
        <BackdropMedia t={t} media={content.media} />
        <div style={{ position: 'absolute', inset: 0, background: scrim }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#fff' }}>{content.wordmark}</div>
          {s.draw && <div style={mono(10, { letterSpacing: 1.5, color: 'rgba(255,255,255,.8)' })}>FREE ENTRY</div>}
        </div>
        <div style={{ position: 'relative', flex: 1 }} />
        <div style={{ position: 'relative', padding: '0 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {countdownChip}
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 40, lineHeight: 1.08, color: '#fff' }}>{content.headline}</div>
          {content.subheadline && <div style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,.85)', whiteSpace: 'pre-line' }}>{content.subheadline}</div>}
          {trustLine}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            style={{ background: accent, color: t.onAccent, border: 'none', borderRadius: ctaRadius, padding: 16, fontSize: 16, fontWeight: 700, fontFamily: SANS, cursor: 'pointer' }}
          >
            {content.submitLabel}
          </button>
          {s.draw && (
            <div style={mono(9.5, { letterSpacing: 0.8, color: 'rgba(255,255,255,.65)', textAlign: 'center' })}>
              {`THEN MEET A CONSULTANT · PASS SCANNED · ENTRY ×${s.multiplier}`}
            </div>
          )}
          {s.draw && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', textAlign: 'center' }}>{SCAM_LINE}</div>}
        </div>
      </div>
      <div style={{ padding: '26px 22px 30px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {content.emphasis && <div style={{ ...serifItalic(20), color: NF.ink }}>{content.emphasis}</div>}
        {content.paragraphs.map((p, i) => (
          <div key={i} style={{ fontSize: 14, lineHeight: 1.6, color: NF.mut }}>{p}</div>
        ))}
        {s.draw && (
          <div style={{ border: `1px solid ${NF.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={mono(11, { letterSpacing: 1.5, color: accentInk, fontWeight: 600 })}>{`MAKE IT ×${s.multiplier}`}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: NF.body }}>{s.boostBody}</div>
          </div>
        )}
        {s.draw && (
          <div style={{ fontSize: 12.5, color: NF.mut }}>
            {s.winners > 1 ? 'Winners contacted directly.' : 'Winner contacted directly.'} Masked results at <WinnersLink color={NF.ink} />.
          </div>
        )}
        <div style={{ fontSize: 11, color: NF.faint }}>{content.regulatory}</div>
      </div>
      {/* Backdrop + sheet stay MOUNTED across open/close (the funnel's typed
          fields + OTP state must survive a close/reopen) and animate like a
          native phone sheet: slide up on open, slide back down on close.
          visibility flips only after the slide-down so the closed sheet stays
          out of the a11y tree / tab order exactly as display:none did. */}
      <div
        onClick={() => setSheetOpen(false)}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, background: 'rgba(10,11,18,.55)', zIndex: 40,
          opacity: sheetOpen ? 1 : 0,
          pointerEvents: sheetOpen ? 'auto' : 'none',
          transition: 'opacity 300ms cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      />
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 41,
          background: NF.card, color: NF.ink, borderRadius: '18px 18px 0 0',
          padding: '18px 20px 22px', boxShadow: '0 -12px 40px rgba(0,0,0,.4)',
          maxHeight: '88vh', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 14,
          transform: sheetOpen ? 'translateY(0)' : 'translateY(100%)',
          visibility: sheetOpen ? 'visible' : 'hidden',
          transition: sheetOpen
            ? 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)'
            : 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), visibility 0s linear 300ms',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={serifItalic(19, { color: NF.ink })}>{content.emphasis || content.headline}</div>
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            aria-label="Close entry form"
            style={{ border: 'none', background: '#F0EDE5', borderRadius: 99, width: 28, height: 28, fontSize: 14, cursor: 'pointer', color: '#6B6558', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
        <div ref={formAnchorRef}>
          <ReferredBadge t={t} referrerName={referrerName} />
          {funnel}
        </div>
        {s.draw && <div style={mono(9.5, { letterSpacing: 0.8, color: NF.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════ STUB ═══════════════════════════════

/** Ticket tear line. `dashColor`/`notchColor` are passed in — the open and the
 *  success states resolve their own polarity. */
function Perforation({ children, notchColor, dashColor }) {
  return (
    <div style={{ position: 'relative', borderTop: `2px dashed ${dashColor}` }}>
      <div style={{ position: 'absolute', left: -9, top: -9, width: 18, height: 18, borderRadius: '50%', background: notchColor }} />
      <div style={{ position: 'absolute', right: -9, top: -9, width: 18, height: 18, borderRadius: '50%', background: notchColor }} />
      {children}
    </div>
  );
}

/** Also the header of the stub + checklist closed states, so the muted tone
 *  arrives as a prop instead of being read off one frozen palette. */
function StubHeader({ content, mutedColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
      <div style={{ fontWeight: 800, fontSize: 17, fontFamily: SANS }}>{content.wordmark}</div>
      <div style={mono(10, { letterSpacing: 1.5, color: mutedColor })}>FREE ENTRY</div>
    </div>
  );
}

function Stub({ t, content, params, luckyDraw, funnel, formAnchorRef, mobile, referrerName, campaignName }) {
  const accent = t.accent;
  const ST = drawPalette('stub', t);
  const accentInk = accentTextOn(accent, ST.bg);
  const s = drawStrings(luckyDraw, campaignName);
  const accentTone = params.ticketTone === 'accent';
  const hasMedia = content.media.kind !== 'none' && !!content.media.src;
  // The `paper` head is a hardcoded dark plate (white type is right on it); the
  // `accent` head paints on the accent, so its type follows onAccent.
  const headInk = accentTone ? t.onAccent : '#fff';
  const ticketHead = (
    <div style={{ position: 'relative', padding: mobile ? '16px 18px' : '22px 28px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', background: accentTone ? accent : '#17181B' }}>
      {!accentTone && hasMedia && <BackdropMedia t={t} media={content.media} />}
      {!accentTone && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(23,24,27,.34), rgba(23,24,27,.62))' }} />}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 10, opacity: 0.92 }}>
        <div style={mono(10, { letterSpacing: 1.6, color: headInk, fontWeight: 600 })}>{s.kicker || content.wordmark.toUpperCase()}</div>
        {s.draw && <div style={mono(10, { letterSpacing: 1.6, color: headInk, fontWeight: 600 })}>ADMIT 1 ENTRY</div>}
      </div>
      <div style={{ position: 'relative', fontFamily: SERIF, fontWeight: 600, fontSize: mobile ? 29 : 36, lineHeight: 1.12, color: headInk }}>{content.headline}</div>
      {content.subheadline && <div style={{ position: 'relative', fontSize: mobile ? 13.5 : 14.5, color: headInk, opacity: 0.88, fontFamily: SANS, whiteSpace: 'pre-line' }}>{content.subheadline}</div>}
    </div>
  );
  const stubLine = s.draw && (
    <div style={{ padding: '13px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <div style={mono(10.5, { letterSpacing: 1, color: ST.ink, fontWeight: 600 })}>{`CLOSES ${s.closesMono} · 23:59 SGT`}</div>
      {params.showSerial !== false && <div style={mono(10.5, { color: ST.mut })}>NO. 0000001</div>}
    </div>
  );
  const formBody = (
    <div ref={formAnchorRef} style={{ padding: mobile ? '16px 18px' : '22px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ReferredBadge t={t} referrerName={referrerName} />
      {funnel}
    </div>
  );
  if (!mobile) {
    return (
      <div style={{ minHeight: '100vh', background: ST.bg, padding: '34px 0', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, fontFamily: SANS, color: ST.ink }}>
        <div style={{ width: 760, maxWidth: 'calc(100vw - 48px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{content.wordmark}</div>
          <div style={mono(11, { letterSpacing: 1.5, color: ST.mut })}>FREE ENTRY</div>
        </div>
        <div style={{ width: 760, maxWidth: 'calc(100vw - 48px)', background: ST.card, borderRadius: 14, boxShadow: '0 10px 30px rgba(27,26,23,.09)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {ticketHead}
          <div style={{ display: 'flex' }}>
            <div style={{ flex: 1, borderRight: `2px dashed ${ST.dash}` }}>{formBody}</div>
            <div style={{ width: 250, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }}>
              {s.draw && <div style={mono(10.5, { letterSpacing: 1, fontWeight: 600 })}>{`CLOSES ${s.closesMono}`}<br />23:59 SGT</div>}
              {s.draw && (
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: ST.body }}>
                  <strong>Make it ×{s.multiplier}.</strong> {s.boostBody}
                </div>
              )}
              {params.showSerial !== false && <div style={{ marginTop: 'auto', ...mono(10, { color: ST.mut }) }}>NO. 0000001</div>}
            </div>
          </div>
        </div>
        <div style={{ width: 760, maxWidth: 'calc(100vw - 48px)', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }}>
          {s.draw && <div style={mono(10, { letterSpacing: 0.8, color: ST.mut })}>{TRUST_ROW}</div>}
          <DrawFootnotes draw={s.draw} linkColor={accentInk} mutedColor={ST.mut} faintColor={ST.faint} content={content} t={t} center />
        </div>
      </div>
    );
  }
  const ticket = (
    <div style={{ background: ST.card, borderRadius: 12, boxShadow: '0 6px 22px rgba(27,26,23,.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {params.stubEdge === 'top' ? (
        <>
          {stubLine && <div>{stubLine}<Perforation notchColor={ST.card} dashColor={ST.dash}><span /></Perforation></div>}
          {ticketHead}
          {formBody}
        </>
      ) : (
        <>
          {ticketHead}
          {formBody}
          {stubLine && <Perforation notchColor={ST.bg} dashColor={ST.dash}>{stubLine}</Perforation>}
        </>
      )}
    </div>
  );
  return (
    <div style={{ minHeight: '100vh', background: ST.bg, display: 'flex', flexDirection: 'column', padding: '18px 16px 26px', boxSizing: 'border-box', gap: 14, fontFamily: SANS, color: ST.ink }}>
      <StubHeader content={content} mutedColor={ST.mut} />
      {ticket}
      {s.draw && <div style={mono(9.5, { letterSpacing: 0.8, color: ST.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
      {s.draw && (
        <div style={{ background: ST.card, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={mono(11, { letterSpacing: 1.5, color: accentInk, fontWeight: 600 })}>{`MAKE IT ×${s.multiplier}`}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: ST.body }}>{s.boostBody}</div>
        </div>
      )}
      {content.paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize: 14, lineHeight: 1.55, color: ST.body, padding: '0 6px' }}>{p}</div>
      ))}
      {content.emphasis && <div style={{ fontSize: 15, fontWeight: 700, color: ST.ink, padding: '0 6px' }}>{content.emphasis}</div>}
      <div style={{ borderTop: `1px solid ${ST.line}`, padding: '12px 6px 0' }}>
        <DrawFootnotes draw={s.draw} linkColor={accentInk} mutedColor={ST.mut} faintColor={ST.faint} content={content} t={t} />
      </div>
    </div>
  );
}

// ═══════════════════════════════ CHECKLIST ═══════════════════════════════

/** Shared by the checklist open + success states, so the muted tone is a prop. */
function ChecklistHeader({ content, s, mutedColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontWeight: 800, fontSize: 17, fontFamily: SANS }}>{content.wordmark}</div>
      {s.closesMono && <div style={mono(10, { letterSpacing: 1.5, color: mutedColor })}>{`CLOSES ${s.closesMono}`}</div>}
    </div>
  );
}

function Checklist({ t, content, params, luckyDraw, funnel, formAnchorRef, mobile, referrerName, campaignName }) {
  const accent = t.accent;
  const CL = drawPalette('checklist', t);
  const accentInk = accentTextOn(accent, CL.bg);
  const s = drawStrings(luckyDraw, campaignName);
  const hasMedia = content.media.kind !== 'none' && !!content.media.src;
  const showBand = params.heroBand !== false && hasMedia;
  const rail = params.railStyle === 'dots'
    ? { width: 0, borderLeft: `2px dotted ${CL.line}` }
    : { width: 2, background: CL.line };
  const circle = (inner, kind) => (
    <div
      style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: kind === 'plus' ? MONO : SANS, fontSize: kind === 'plus' ? 10 : 12, fontWeight: 700,
        ...(kind === 'filled' ? { background: accent, color: t.onAccent } : {}),
        ...(kind === 'outline' ? { border: `2px solid ${accentInk}`, color: accentInk } : {}),
        ...(kind === 'plus' ? { background: CL.railBg, color: CL.mut, fontWeight: 600 } : {}),
      }}
    >
      {inner}
    </div>
  );
  const spineStep = (key, circleNode, title, body, { last = false, children = null } = {}) => (
    <div key={key} style={{ display: 'flex', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {circleNode}
        {!last && <div style={{ flex: 1, ...rail }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 18, minWidth: 0, display: 'flex', flexDirection: 'column', gap: children ? 10 : 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, paddingTop: 3, fontFamily: SANS }}>{title}</div>
        {body && <div style={{ fontSize: 13, lineHeight: 1.5, color: CL.mut, marginTop: 4, fontFamily: SANS }}>{body}</div>}
        {children}
      </div>
    </div>
  );
  const boostInline = s.draw && params.boostStep !== 'footnote';
  const spine = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {spineStep('s1', circle('1', 'filled'), 'Drop your details', null, {
        children: (
          <div ref={formAnchorRef} style={{ background: CL.card, border: `1px solid ${CL.line}`, borderRadius: 12, padding: 14 }}>
            <ReferredBadge t={t} referrerName={referrerName} />
            {funnel}
          </div>
        ),
      })}
      {spineStep('s2', circle('2', 'outline'), 'Verify with an SMS code', 'One entry per verified number — no bots, no multiple entries. Free.')}
      {spineStep('s3', circle('3', 'outline'), s.draw ? "You're in the draw" : "You're in",
        s.draw
          ? `Your entry pass arrives by WhatsApp and email. ${s.winners > 1 ? `${s.winners} winners` : 'One winner'} drawn after ${s.closesFull} in a witnessed process.`
          : 'Your details are received securely and confirmed by email.',
        { last: !boostInline })}
      {boostInline && spineStep('s4', circle('+', 'plus'), `Bonus: make it ×${s.multiplier}`, s.boostBody, { last: true })}
    </div>
  );
  const footnote = s.draw && params.boostStep === 'footnote' && (
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: CL.mut, fontFamily: SANS }}>
      <strong style={{ color: CL.ink }}>{`Bonus ×${s.multiplier}:`}</strong> {s.boostBody}
    </div>
  );
  const footer = (
    <div style={{ borderTop: `1px solid ${CL.line}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {s.draw && <div style={mono(9.5, { letterSpacing: 0.8, color: CL.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
      {footnote}
      <DrawFootnotes draw={s.draw} linkColor={accentInk} mutedColor={CL.mut} faintColor={CL.faint} content={content} t={t} center />
    </div>
  );
  if (!mobile) {
    return (
      <div style={{ minHeight: '100vh', background: CL.bg, padding: '34px 56px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 24, fontFamily: SANS, color: CL.ink }}>
        <ChecklistHeader content={content} s={s} mutedColor={CL.mut} />
        {showBand && (
          <div style={{ position: 'relative', height: 190, borderRadius: 14, overflow: 'hidden' }}>
            <BackdropMedia t={t} media={content.media} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(23,24,27,0), rgba(23,24,27,.2))' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 56 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 48, lineHeight: 1.08 }}>{content.headline}</div>
            {content.paragraphs.map((p, i) => (
              <div key={i} style={{ fontSize: 16, lineHeight: 1.55, color: CL.mut }}>{p}</div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 14 }}>{circle('1', 'filled')}<div style={{ fontSize: 14.5, lineHeight: 1.5, color: CL.body, paddingTop: 3 }}><strong>Drop your details</strong> in the form.</div></div>
              <div style={{ display: 'flex', gap: 14 }}>{circle('2', 'outline')}<div style={{ fontSize: 14.5, lineHeight: 1.5, color: CL.body, paddingTop: 3 }}><strong>Verify with an SMS code</strong> — one entry per verified number.</div></div>
              <div style={{ display: 'flex', gap: 14 }}>{circle('3', 'outline')}<div style={{ fontSize: 14.5, lineHeight: 1.5, color: CL.body, paddingTop: 3 }}><strong>{s.draw ? "You're in." : 'Done.'}</strong> {s.draw ? `Pass by WhatsApp/email; ${s.winners > 1 ? `${s.winners} winners` : 'winner'} drawn after ${s.closesFull}.` : 'Your details are received securely.'}</div></div>
              {s.draw && <div style={{ display: 'flex', gap: 14 }}>{circle('+', 'plus')}<div style={{ fontSize: 14.5, lineHeight: 1.5, color: CL.body, paddingTop: 3 }}><strong>Bonus ×{s.multiplier}:</strong> {s.boostBody}</div></div>}
            </div>
            {s.draw && (
              <div style={{ fontSize: 13, color: CL.mut }}>
                {SCAM_LINE} Masked results at <WinnersLink color={accentInk} />.
              </div>
            )}
          </div>
          <div style={{ width: 400, flexShrink: 0 }}>
            <div ref={formAnchorRef} style={{ background: CL.card, border: `1px solid ${CL.line}`, borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ReferredBadge t={t} referrerName={referrerName} />
              {funnel}
              {s.draw && <div style={mono(9.5, { letterSpacing: 0.6, color: CL.mut, textAlign: 'center' })}>{TRUST_ROW}</div>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 'auto', borderTop: `1px solid ${CL.line}`, paddingTop: 12 }}>
          <DrawFootnotes draw={null} linkColor={accentInk} mutedColor={CL.mut} faintColor={CL.faint} content={content} t={t} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100vh', background: CL.bg, display: 'flex', flexDirection: 'column', padding: '18px 20px 26px', boxSizing: 'border-box', gap: 16, fontFamily: SANS, color: CL.ink }}>
      <ChecklistHeader content={content} s={s} mutedColor={CL.mut} />
      {showBand && (
        <div style={{ position: 'relative', height: 150, margin: '0 -20px', overflow: 'hidden' }}>
          <BackdropMedia t={t} media={content.media} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(23,24,27,0), rgba(23,24,27,.25))' }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 34, lineHeight: 1.12 }}>{content.headline}</div>
        {content.subheadline && <div style={{ fontSize: 14, lineHeight: 1.5, color: CL.mut, whiteSpace: 'pre-line' }}>{content.subheadline}</div>}
      </div>
      {spine}
      {footer}
    </div>
  );
}

// ═══════════════════════════════ SUCCESS ═══════════════════════════════

/**
 * The post-submit "you're in the draw" page. Mounted by LeadCapture instead of
 * the generic SuccessState when the campaign is a v2 draw on one of the five
 * draw templates. Chrome follows the template; content is shared.
 */
export function DrawSuccessPage({ campaign, submittedPhone = null }) {
  const doc = campaign?.design_config || {};
  const theme = resolveTheme(doc.theme || {});
  const accent = theme.accent;
  const content = deriveCampaignPageContent(doc);
  const s = drawStrings(doc.luckyDraw, campaign?.name);
  const templateId = DRAW_TEMPLATE_IDS.includes(doc.template?.id) ? doc.template.id : 'postcard';
  const sub = successSubOf(submittedPhone);
  const bookingUrl = s.draw?.bookingUrl || null;
  const closesLine = s.closesMono ? `ENTRIES CLOSE ${s.closesMono} · 23:59 SGT` : '';
  const pal = drawPalette(templateId, theme);
  // Accent AS TEXT, stepped for the surface it actually lands on: postcard is
  // the only filled box, the other four are border-only over the page.
  const accentOnCard = accentTextOn(accent, pal.card);
  const accentOnPage = accentTextOn(accent, pal.bg);
  const accentOnBox = templateId === 'postcard' ? accentOnCard : accentOnPage;

  const chrome = {
    postcard: {
      pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, divider: pal.line,
      title: "You're in.", dot: accent, tenX: accentOnBox, label: 'NEXT STEP · EARN ×10 CHANCES',
      box: { background: pal.card, borderRadius: 14, boxShadow: '0 8px 28px rgba(23,24,27,.08)' },
      stepBg: accentSoftOf(accent), stepColor: accentOnCard, wordmark: true,
    },
    gazette: {
      pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, divider: pal.line,
      title: 'Entered.', dot: pal.gold, tenX: pal.gold, label: 'NEXT STEP · EARN ×10 CHANCES',
      box: { border: `1.5px solid ${pal.ink}` },
      stepBg: accentSoftOf(accent), stepColor: accentOnCard, masthead: true,
    },
    nightfall: {
      pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.faint, divider: pal.line,
      title: "You're in.", dot: accent, tenX: accentOnBox, label: 'NEXT STEP · EARN ×10 CHANCES',
      box: { border: `1px solid ${pal.border}`, borderRadius: 12 },
      stepBg: pal.line, stepColor: pal.ink, wordmark: true,
    },
    stub: {
      pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, divider: pal.line,
      title: "You're in.", dot: accent, tenX: accentOnBox, label: 'NEXT STEP · EARN ×10 CHANCES',
      box: {}, stepBg: accentSoftOf(accent), stepColor: accentOnCard, ticket: true, header: true,
    },
    checklist: {
      pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, divider: pal.line,
      title: "You're in.", dot: accent, tenX: accentOnBox, label: 'ONE STEP LEFT · EARN ×10 CHANCES',
      box: { border: `1px solid ${pal.line}`, borderRadius: 12 },
      stepBg: accentSoftOf(accent), stepColor: accentOnCard, check: true, header: true,
    },
  }[templateId];

  const label = chrome.label.replace('×10', `×${s.multiplier}`);
  const monoMut = pal.mut;
  const chances = (
    <div style={{ ...chrome.box, padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={mono(11, { letterSpacing: 1.5, color: templateId === 'gazette' ? pal.ink : accentOnBox, fontWeight: 600 })}>CHANCES</div>
      <ChancesRow accent={chrome.tenX} accentLabel={accentTextOn(chrome.tenX, chrome.pageBg)} inkColor={chrome.ink} mutedColor={monoMut} multiplier={s.multiplier} />
    </div>
  );
  const nextSteps = (
    <div style={{ ...chrome.box, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <NextSteps
        s={s}
        accent={templateId === 'gazette' ? accent : accent}
        accentText={accentOnBox}
        onAccent={theme.onAccent}
        stepBg={chrome.stepBg}
        stepColor={chrome.stepColor}
        bodyColor={chrome.body}
        lastColor={chrome.ink}
        mutedColor={monoMut}
        label={label}
        bookingUrl={bookingUrl}
      />
    </div>
  );
  const intro = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      {chrome.check ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: accent, color: theme.onAccent, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
          <div style={mono(10.5, { letterSpacing: 1.5, color: monoMut })}>ENTRY VERIFIED · YOU'RE IN THE DRAW</div>
        </div>
      ) : (
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: chrome.dot }} />
      )}
      <div style={serifItalic(42, { color: chrome.ink })}>{chrome.title}</div>
      <div style={{ fontSize: 14.5, lineHeight: 1.55, color: chrome.body, fontFamily: SANS }}>{sub}</div>
    </div>
  );
  const footerLine = (
    <div style={{ marginTop: 'auto', fontSize: 12.5, color: pal.mut, borderTop: `1px solid ${chrome.divider}`, paddingTop: 14, fontFamily: SANS }}>
      {SCAM_LINE} Results at <WinnersLink color={theme.dark ? pal.ink : accentOnPage} />.
    </div>
  );

  let body;
  if (chrome.ticket) {
    body = (
      <>
        <StubHeader content={content} mutedColor={pal.mut} />
        <div style={{ background: pal.card, borderRadius: 12, boxShadow: '0 6px 22px rgba(27,26,23,.08)', overflow: 'hidden', marginTop: 20 }}>
          <div style={{ background: accentSoftOf(accent), padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: accent }} />
            <div style={serifItalic(38, { color: pal.ink })}>{chrome.title}</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: pal.body, fontFamily: SANS }}>{sub}</div>
          </div>
          <div style={{ padding: '16px 18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={mono(11, { letterSpacing: 1.5, color: accentOnCard, fontWeight: 600 })}>CHANCES</div>
            <ChancesRow accent={accentOnCard} accentLabel={accentTextOn(accentOnCard, pal.card)} inkColor={pal.ink} mutedColor={monoMut} multiplier={s.multiplier} />
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <NextSteps s={s} accent={accent} accentText={accentOnCard} onAccent={theme.onAccent} stepBg={accentSoftOf(accent)} stepColor={accentOnCard} bodyColor={pal.body} lastColor={pal.ink} mutedColor={monoMut} label={label} bookingUrl={bookingUrl} />
          </div>
          {s.closesMono && (
            <Perforation notchColor={pal.bg} dashColor={pal.dash}>
              <div style={{ padding: '13px 18px', ...mono(10.5, { letterSpacing: 1, color: pal.ink, fontWeight: 600 }) }}>{`ENTRY HELD · CLOSES ${s.closesMono}`}</div>
            </Perforation>
          )}
        </div>
        <div style={{ marginTop: 'auto', fontSize: 12.5, color: pal.mut, padding: '0 6px', fontFamily: SANS }}>{SCAM_LINE}</div>
      </>
    );
  } else {
    body = (
      <>
        {chrome.masthead && <GazetteMasthead content={content} kickerText="OFFICIAL ENTRY FORM" inkColor={pal.ink} mutedColor={pal.mut} />}
        {chrome.header && !chrome.masthead && <ChecklistHeader content={content} s={s} mutedColor={pal.mut} />}
        {chrome.wordmark && <div style={{ fontWeight: 800, fontSize: 17, color: chrome.ink, fontFamily: SANS }}>{content.wordmark}</div>}
        <div style={{ marginTop: chrome.masthead || chrome.header ? 22 : 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {intro}
          {chances}
          {nextSteps}
          {closesLine && <div style={mono(10.5, { color: monoMut })}>{closesLine}</div>}
        </div>
        {footerLine}
      </>
    );
  }

  return (
    <div
      data-draw-success={templateId}
      style={{ minHeight: '100vh', background: chrome.pageBg, color: chrome.ink, fontFamily: SANS, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: 20 }}
    >
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        {body}
      </div>
    </div>
  );
}

// ═══════════════════════════════ CLOSED ═══════════════════════════════

/**
 * The designed draw-closed page for the five draw templates. Returns its
 * per-template chrome; CampaignPageRenderer falls back to the generic
 * BlockedPage for every other template.
 */
export function DrawClosedPage({ templateId, t, content, luckyDraw, campaignName }) {
  const accent = t.accent;
  const s = drawStrings(luckyDraw, campaignName);
  const pal = drawPalette(templateId, t);
  const chrome = {
    postcard: { pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, faint: pal.faint, divider: pal.line, cta: 'fill', wordmark: true },
    gazette: { pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, faint: pal.faint, divider: pal.line, cta: 'outline', masthead: true },
    nightfall: { pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, faint: pal.faint, divider: pal.line, cta: 'fill', wordmark: true },
    stub: { pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, faint: pal.faint, divider: pal.line, cta: 'fill', header: true, card: true },
    checklist: { pageBg: pal.bg, ink: pal.ink, body: pal.body, mut: pal.mut, faint: pal.faint, divider: pal.line, cta: 'fill', header: true },
  }[templateId];
  if (!chrome) return null;

  // Secondary scam line: the frozen light tone on every template, the palette's
  // own muted once the preset flips dark.
  const scamMut = t.dark ? pal.mut : '#6B6558';
  const ctaStyle = chrome.cta === 'outline'
    ? { border: `1.5px solid ${pal.ink}`, color: pal.ink, background: 'transparent' }
    : { background: accent, color: t.onAccent, border: 'none', borderRadius: 9 };
  const cta = (
    <a
      href={WINNERS_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...ctaStyle, textAlign: 'center', padding: 14, fontSize: 15, fontWeight: 700, fontFamily: SANS, textDecoration: 'none', display: 'block' }}
    >
      See the masked results — redeem.sg/winners
    </a>
  );
  const core = (
    <>
      <div style={mono(11, { letterSpacing: 2, color: chrome.mut })}>{s.kicker}</div>
      <div style={serifItalic(42, { color: chrome.ink })}>Entries closed.</div>
      {s.closesMono && <div style={mono(11, { color: chrome.mut })}>{`${s.closesMono} · 23:59 SGT`}</div>}
      <div style={{ fontSize: 14.5, lineHeight: 1.55, color: chrome.body, fontFamily: SANS }}>{s.closedBody}</div>
      <div style={{ fontSize: 13, color: scamMut, fontFamily: SANS }}>{SCAM_LINE}</div>
    </>
  );
  return (
    <div
      data-campaign-page-blocked="draw"
      data-draw-closed={templateId}
      style={{ minHeight: '100vh', background: chrome.pageBg, color: chrome.ink, fontFamily: SANS, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: 20 }}
    >
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        {chrome.masthead && <GazetteMasthead content={content} kickerText="OFFICIAL ENTRY FORM" inkColor={pal.ink} mutedColor={pal.mut} />}
        {chrome.header && <StubHeader content={content} mutedColor={pal.mut} />}
        {chrome.wordmark && <div style={{ fontWeight: 800, fontSize: 17, color: chrome.ink, fontFamily: SANS }}>{content.wordmark}</div>}
        {chrome.card ? (
          <div style={{ background: pal.card, borderRadius: 12, boxShadow: '0 6px 22px rgba(27,26,23,.08)', padding: '22px 18px', display: 'flex', flexDirection: 'column', gap: 12, marginTop: 26 }}>
            {core}
            {cta}
          </div>
        ) : (
          <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {core}
            {cta}
          </div>
        )}
        <div style={{ marginTop: 'auto', fontSize: 11, color: chrome.faint, borderTop: `1px solid ${chrome.divider}`, paddingTop: 12, fontFamily: SANS }}>
          {content.regulatory}
        </div>
      </div>
    </div>
  );
}

export const DRAW_TEMPLATES = {
  postcard: Postcard,
  gazette: Gazette,
  nightfall: Nightfall,
  stub: Stub,
  checklist: Checklist,
};

export const DRAW_TEMPLATE_IDS = Object.keys(DRAW_TEMPLATES);
