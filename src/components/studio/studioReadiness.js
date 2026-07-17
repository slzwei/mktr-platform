import { resolveTheme } from '@/lib/designConfigV2';
import { colorContrastRatio } from '@/lib/contrast';
import { isValidYmd } from './useStudioDoc';

/**
 * Studio readiness (PR 3, extended PR 5) — the merged pill: the server
 * readiness endpoint (delivery truth: agent pool, webhook, phone gaps, and —
 * since PR 5 — the server-verifiable OTP send-path + lucky-draw coherence
 * checks) plus the Studio's client-side DESIGN checks over the unsaved doc.
 * A green "READY ✓" means both delivery and design are clean.
 *
 * PR 5 notes: server issues with a section mapping deep-link into the rail
 * like design items; the old client draw-date "mismatch" check compared a doc
 * YMD against the record's ISO instant (always unequal → permanent false
 * warning) and is replaced by the server's authoritative
 * `draw_close_date_mismatch` — the canvas banner uses
 * `drawCloseMismatchWithLive` for a CORRECT local comparison. The
 * marketplace.endsAt schema inconsistency is resolved (key removed from the
 * public whitelist; expiry is ops-derived).
 */

const todayYmdSgt = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

const DAY_MS = 24 * 60 * 60 * 1000;

/** CORRECT doc-vs-record comparison: the doc holds an inclusive SGT calendar
 * day (YYYY-MM-DD); the record holds the EXCLUSIVE next-day-start instant
 * (created from the same day via the backend's sgtDayEndExclusiveMs). SGT has
 * no DST, so the day boundary is a fixed offset. Returns true only on a REAL
 * mismatch — unparseable inputs never warn. */
export function drawCloseMismatchWithLive(docYmd, liveInstant) {
  if (typeof docYmd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(docYmd)) return false;
  const docEnd = Date.parse(`${docYmd}T00:00:00+08:00`) + DAY_MS;
  const live = Date.parse(liveInstant || '');
  return Number.isFinite(docEnd) && Number.isFinite(live) && docEnd !== live;
}

/** Display an exclusive cutoff instant as its inclusive SGT day (minus 1ms). */
export function sgtYmdFromInstant(instant) {
  const t = Date.parse(instant || '');
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(t - 1));
}

/** Server readiness codes that ARE doc/Studio-adjacent enough to deep-link.
 * Draw codes stay unmapped — the Distribution panel has no draw controls
 * (draw records are ops-owned). Pool/webhook codes are not doc-fixable. */
export const SERVER_CODE_TO_SECTION = {
  otp_send_unconfigured: 'form',
  otp_whatsapp_unconfigured: 'form',
  otp_sms_fallback_unconfigured: 'form',
  quiz_not_enabled: 'quiz',
};

export const GATE_LABELS = {
  slug: 'Slug set',
  active: 'Campaign is active',
  marketplaceListed: 'Listing switch on',
  redeemHost: 'Hosted on redeem.sg',
  supportedType: 'Supported campaign type',
  opsResolvable: 'Live ops activation',
  listed: 'Publishes to the marketplace',
};

/** Client-side DESIGN checks over the unsaved doc. */
export function computeDesignChecks({ campaign, doc, marketplacePreview }) {
  if (!doc) return [];
  const out = [];
  const quiz = doc.quiz;
  const questionCount = (quiz?.steps || []).flatMap((s) => s.questions || []).length;

  if (campaign?.type === 'quiz' && quiz?.enabled !== true) {
    out.push({ sev: 'block', sec: 'quiz', msg: 'Quiz campaign but the quiz is disabled.' });
  }
  if (quiz?.enabled === true && questionCount === 0) {
    out.push({ sev: 'block', sec: 'quiz', msg: 'Quiz is enabled with zero questions.' });
  }
  if (doc.luckyDraw?.enabled === true) {
    const terms = typeof doc.form?.terms?.html === 'string' ? doc.form.terms.html.trim() : '';
    if (!terms) out.push({ sev: 'block', sec: 'form', msg: 'Lucky draw requires non-empty campaign T&Cs (server invariant).' });
    if (!isValidYmd(doc.luckyDraw?.closesAt)) {
      out.push({ sev: 'block', sec: 'form', msg: 'Lucky draw needs a valid close date on the draw record (server invariant).' });
    }
  }
  if ((doc.content?.heroCtaLabel || '').trim() && (doc.content?.media?.kind || 'none') === 'none') {
    out.push({ sev: 'warn', sec: 'page', msg: 'Hero button label is set but there is no media — it will not render.' });
  }
  if (doc.form?.verification === 'whatsapp') {
    // Speculative (env is server-side) — computeStudioReadiness retires this
    // when the server readiness payload answers authoritatively (PR 5).
    out.push({ key: 'whatsapp-creds', sev: 'warn', sec: 'form', msg: 'WhatsApp verification needs configured credentials; sends fall back to SMS without them.' });
  }
  const t = resolveTheme(doc.theme || {});
  const ratio = colorContrastRatio(t.accent, t.card);
  if (ratio !== null && ratio < 2) {
    out.push({ sev: 'warn', sec: 'theme', msg: `Accent is hard to see on the card background — contrast ${ratio.toFixed(1)}:1.` });
  }
  // (The old client draw-date mismatch check lived here — removed in PR 5:
  // it compared a YMD against an ISO instant, warning on every open draw.
  // The server's draw_close_date_mismatch is the authoritative replacement.)
  const fd = doc.distribution?.featuredDrop;
  if (fd?.enabled === true && isValidYmd(fd.endsAt) && fd.endsAt < todayYmdSgt()) {
    out.push({ sev: 'info', sec: 'dist', msg: 'Featured-drop homepage end date is in the past — the tile shows as gone.' });
  }
  const gate = marketplacePreview?.gate;
  if (doc.distribution?.marketplace?.listed === true && gate && Object.values(gate).some((ok) => !ok)) {
    out.push({ sev: 'info', sec: 'dist', msg: 'Marketplace switch is on but the publication checklist is incomplete.' });
  }
  return out;
}

const SERVER_LEVEL_TO_SEV = { critical: 'block', warning: 'warn', info: 'info' };

/**
 * Merge server delivery readiness + client design checks into the pill model.
 * `serverStatus` is the readiness QUERY status — READY ✓ requires an actual
 * successful server response (Codex diff-review #5): while it is loading the
 * pill says CHECKING…, and on failure a delivery-unknown warning item keeps
 * the pill off green.
 */
export function computeStudioReadiness({ campaign, doc, serverReadiness, serverStatus = 'success', marketplacePreview }) {
  let design = computeDesignChecks({ campaign, doc, marketplacePreview });
  const delivery = [];
  if (serverStatus === 'error') {
    delivery.push({
      sev: 'warn',
      sec: null,
      msg: 'Delivery readiness unavailable — the server check failed. Reload before trusting a green light.',
      source: 'delivery',
    });
  }
  if (serverReadiness && serverReadiness.applicable !== false) {
    for (const issue of serverReadiness.issues || []) {
      delivery.push({
        sev: SERVER_LEVEL_TO_SEV[issue.level] || 'info',
        // PR 5: doc-adjacent server codes deep-link into the rail; anything
        // unmapped (pool, webhook, draw records) stays link-less.
        sec: SERVER_CODE_TO_SECTION[issue.code] || null,
        code: issue.code,
        msg: issue.message,
        source: 'delivery',
      });
    }
  }
  // PR 5: retire the speculative WhatsApp-creds design warning once the
  // server answers — either the env is verified fine (boolean in the
  // payload), or the server's own authoritative warning is already listed.
  // GATED on a SUCCESSFUL current response (Codex diff #6): TanStack Query
  // keeps stale data through a failed refetch, and a cached true must not
  // keep clearing the warning while the server is unreachable. Server
  // unavailable → the static warning stays (fail-noisy).
  const serverAnsweredWhatsapp =
    serverStatus === 'success' &&
    (serverReadiness?.whatsappOtpConfigured === true ||
      delivery.some((d) => d.code === 'otp_whatsapp_unconfigured'));
  if (serverAnsweredWhatsapp) {
    design = design.filter((d) => d.key !== 'whatsapp-creds');
  }
  const items = [...delivery, ...design.map((d) => ({ ...d, source: 'design' }))];
  const blocks = items.filter((i) => i.sev === 'block').length;
  const notApplicable = serverReadiness?.applicable === false;
  const pending = serverStatus === 'pending';

  let label;
  let tone;
  if (blocks > 0) {
    label = `▲ ${items.length} TO REVIEW`;
    tone = 'bad';
  } else if (pending) {
    label = items.length > 0 ? `▲ ${items.length} · CHECKING…` : 'CHECKING…';
    tone = 'warn';
  } else if (items.length > 0) {
    label = `▲ ${items.length}`;
    tone = 'warn';
  } else {
    label = notApplicable ? 'READY · N/A' : 'READY ✓';
    tone = 'ok';
  }

  const sectionFlags = {};
  for (const item of items) {
    if (item.sec) sectionFlags[item.sec] = true;
  }
  return { items, blocks, label, tone, sectionFlags };
}
