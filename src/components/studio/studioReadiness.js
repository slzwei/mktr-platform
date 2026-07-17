import { resolveTheme } from '@/lib/designConfigV2';
import { colorContrastRatio } from '@/lib/contrast';
import { isValidYmd } from './useStudioDoc';

/**
 * Studio readiness (PR 3) — the merged pill (Codex F8): the EXISTING server
 * readiness endpoint (delivery truth: agent pool, webhook, phone gaps —
 * exactly what CampaignReadinessBanner surfaces in the legacy designer) plus
 * the Studio's client-side DESIGN checks over the unsaved doc. A green
 * "READY ✓" therefore means both delivery and design are clean — never just
 * the document. Server-verifiable EXTENSIONS of the endpoint stay PR 5.
 *
 * Design checks mirror server invariants where they exist
 * (ensureDrawTermsVersion) and renderer behavior where they don't; the
 * draw-date mismatch compares the doc against the LIVE draw record from the
 * marketplace preview DTO (`ops.draw`), never against in-doc marketplace
 * endsAt (the clamp drops that key — a known schema inconsistency noted for
 * PR 5).
 */

const todayYmdSgt = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

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
    out.push({ sev: 'warn', sec: 'form', msg: 'WhatsApp verification needs configured credentials; sends fall back to SMS without them.' });
  }
  const t = resolveTheme(doc.theme || {});
  const ratio = colorContrastRatio(t.accent, t.card);
  if (ratio !== null && ratio < 2) {
    out.push({ sev: 'warn', sec: 'theme', msg: `Accent is hard to see on the card background — contrast ${ratio.toFixed(1)}:1.` });
  }
  const liveDrawCloses = marketplacePreview?.ops?.draw?.closesAt;
  if (doc.luckyDraw?.enabled === true && liveDrawCloses && doc.luckyDraw?.closesAt && liveDrawCloses !== doc.luckyDraw.closesAt) {
    out.push({ sev: 'warn', sec: 'dist', msg: 'The doc draw close date disagrees with the live draw record.' });
  }
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
  const design = computeDesignChecks({ campaign, doc, marketplacePreview });
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
        sec: null, // delivery items live outside the doc — no rail deep-link
        msg: issue.message,
        source: 'delivery',
      });
    }
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
