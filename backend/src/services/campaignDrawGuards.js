import crypto from 'crypto';
import { DrawTermsVersion, Draw } from '../models/index.js';
import { AppError } from '../middleware/appError.js';
import { logger } from '../utils/logger.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import { normalizeLuckyDraw, assertSingleWinnerDraw } from '../utils/luckyDraw.js';
import { checkDrawConsistency } from '../utils/drawConsistency.js';
import { getStoredTermsHtml, getStoredLuckyDraw } from '../utils/designConfigV2Clamp.js';

/**
 * Draw launch guards + terms versioning (P4-4, split out of campaignService).
 * Everything that decides whether a draw campaign may save/arm/launch lives
 * here: the closesAt/terms requirements, the promise-consistency gate, the
 * multi-prize activation gate, the append-only terms pin, and the boost-rail
 * / draw-record ensure hooks that ride the arming moments. campaignService
 * composes these around its CRUD; it re-exports the public ones so existing
 * importers (tests, controller namespace) keep their path.
 */

/**
 * Boost-rail ensure hook (PR-2, draw-launch-integrity §5.1 / old-plan F2).
 * Lazy dynamic import: campaignService's static graph feeds many unit suites
 * that never touch draws — the redeemOps model surface must not enter it.
 */
export async function ensureRail(args) {
  const mod = await import('./redeemOps/drawBoostProvisioningService.js');
  return mod.ensureDrawBoostRail(args);
}

/**
 * Draw-RECORD ensure hook — the engine row chances/freeze/seal run on, born
 * at the same arming moments as the rail so no operator ever runs the CLI
 * create step by hand. BEST-EFFORT unlike the rail: a missing record loses
 * nothing (evidence accrues independently; the boot reconciler retries), so
 * this never throws and never blocks a save or launch. Same lazy-import +
 * test-seam shape as ensureRail.
 */
let _ensureDrawRecord = null;
export function setEnsureDrawRecord(fn) {
  _ensureDrawRecord = typeof fn === 'function' ? fn : null;
}
export async function ensureRecord(args) {
  try {
    if (_ensureDrawRecord) return await _ensureDrawRecord(args);
    const mod = await import('./luckyDrawService.js');
    return await mod.ensureDrawRecord(args);
  } catch (err) {
    logger.warn('[Campaign] draw-record ensure failed (reconciler will retry)', { error: err?.message });
    return { created: false, reason: 'failed' };
  }
}

/** Write the ensured activationId into the doc's stored luckyDraw (both doc
 * versions keep `luckyDraw` top-level — loss-ledger L5). No-op on null. */
export function stampRailActivationId(designConfig, activationId) {
  if (!activationId || !designConfig || typeof designConfig !== 'object') return designConfig;
  if (!designConfig.luckyDraw || typeof designConfig.luckyDraw !== 'object') return designConfig;
  return { ...designConfig, luckyDraw: { ...designConfig.luckyDraw, activationId } };
}

export const drawEnabledIn = (doc) => normalizeLuckyDraw(getStoredLuckyDraw(doc))?.enabled === true;

/**
 * The two draw REQUIREMENTS, each with its one typed 422 (PR 5: typed codes,
 * write-gate precedent). Deduped here — createCampaign's pre-create block and
 * ensureDrawTermsVersion both enforce them, in their own order (create checks
 * before the row exists; the terms pin checks around its live-draw lock), so
 * the ORDERING stays per-site while the messages/codes live once.
 */
export function assertDrawClosesAt(ld) {
  // An enabled draw without a close date would accept public entries forever
  // while createDraw refuses the config — never persistable (normalization
  // already dropped any malformed date, so absence here means absence/invalid).
  if (!ld?.closesAt) {
    const err = new AppError(
      'Lucky-draw campaigns need a valid luckyDraw.closesAt (YYYY-MM-DD) before they can be enabled.',
      422
    );
    err.data = { code: 'DRAW_CLOSES_AT_REQUIRED' };
    throw err;
  }
}

/** Version-aware terms read (v1 termsContent / v2 form.terms.html); returns
 * the trimmed content the terms pin hashes. */
export function assertDrawTermsContent(designConfig) {
  const content = getStoredTermsHtml(designConfig).trim();
  if (!content) {
    const err = new AppError(
      'Lucky-draw campaigns need Terms & Conditions content (designer → Terms & Conditions) before they can be enabled.',
      422
    );
    err.data = { code: 'DRAW_TERMS_REQUIRED' };
    throw err;
  }
  return content;
}

/**
 * Promise-consistency gate (PR-3, draw-launch-integrity §3 / Codex R1
 * CX15/CX16): HARD contradictions between the campaign's facts and its
 * pinned-at-save T&Cs (prize, age bounds) 422 the ARMING and fact-touching
 * saves — the iPad-vs-iPhone / 21-vs-25 incident becomes unshippable. SOFT
 * findings (unparseable/ambiguous clauses, marketing divergence) surface via
 * readiness only, never block. Remediation is always regeneration through
 * the terms flow (a new pinned version) — `fix: 'regenerate_terms'`.
 */
export function assertDrawPromiseConsistency({ minAge, maxAge, designConfig }) {
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(designConfig));
  if (ld?.enabled !== true) return;
  const content = designConfig?.content || {};
  const { hard } = checkDrawConsistency({
    minAge: Number.isInteger(minAge) ? minAge : null,
    maxAge: Number.isInteger(maxAge) ? maxAge : null,
    luckyDraw: ld,
    termsHtml: getStoredTermsHtml(designConfig),
    contentHeadline: content.headline ?? designConfig?.formHeadline ?? '',
    contentStory: content.story ?? designConfig?.storyText ?? '',
  });
  if (hard.length > 0) {
    const err = new AppError(hard[0].message, 422);
    err.data = { code: hard[0].code, fix: 'regenerate_terms', issues: hard };
    throw err;
  }
}

/** Material draw facts for the fact-touching-save detector (PR-3/CX16). */
export const drawFactsOf = (doc) => {
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(doc)) || {};
  return JSON.stringify([ld.enabled, ld.prize, ld.prizes, ld.closesAt, ld.boostClosesAt, ld.multiplier]);
};

/**
 * Fail-closed activation gate (docs/plans/lucky-draw-multi-prize-plan.md §3.5):
 * the draw engine resolves exactly ONE claimed winner per campaign
 * (luckyDrawService — a claimed attempt is terminal), so a campaign whose
 * structured prizes total more than one unit must not BE active: it would
 * collect entries under T&Cs the platform cannot honour. Enforced at the
 * service layer on every path that can leave a campaign active (create /
 * update / setCampaignLaunchState) plus createDraw — the launch `force` flag
 * only skips READINESS, never this. Phase 3 (multi-winner engine) removes it.
 */
export function assertDrawActivatable(designConfig) {
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(designConfig));
  if (!ld || ld.enabled !== true) return;
  assertSingleWinnerDraw(ld, { suffix: ' — the campaign can stay a draft (or paused) but cannot be active.' });
}

/**
 * Draw-terms versioning (docs/plans/lucky-draw-10x.md §4.6). For an enabled
 * lucky draw, pin the CURRENT designer T&C content as an append-only
 * draw_terms_versions row and stamp its id + hash into luckyDraw, so each
 * entrant's acceptance (consentMetadata.drawTerms) references immutable
 * content — editing termsContent later mints a NEW version instead of
 * rewriting what earlier entrants agreed to.
 *
 * Canonical bytes = the TRIMMED raw designer HTML (design_config.termsContent).
 * Idempotent: unchanged content re-resolves to the existing version row.
 * Exported for tests; `d` is a DI seam (defaults to the real model).
 */
export async function ensureDrawTermsVersion(designConfig, campaignId, userId, d = { DrawTermsVersion, Draw }) {
  const ld = designConfig?.luckyDraw;
  if (!ld || ld.enabled !== true) return designConfig;
  assertDrawClosesAt(ld);
  // PR 5 (Codex plan F3): while a LIVE draw record exists, the doc close date
  // is LOCKED to the record's cutoff. Entry acceptance follows the DOC while
  // the pool freeze follows the RECORD — letting the doc drift would accept
  // entrants the frozen pool silently excludes. Intentional changes go
  // through ops (void + recreate the draw), never a designer save.
  const DrawModel = d.Draw ?? Draw;
  const liveDraw = await DrawModel.findOne({
    where: { campaignId, status: ['open', 'frozen', 'sealed', 'drawn'] },
    attributes: ['id', 'closesAt'],
  });
  if (liveDraw) {
    const docEndMs = sgtDayEndExclusiveMs(ld.closesAt);
    const recordMs = new Date(liveDraw.closesAt).getTime();
    if (docEndMs !== null && Number.isFinite(recordMs) && docEndMs !== recordMs) {
      const err = new AppError(
        'The draw close date is locked while a live draw record exists — void and recreate the draw (Redeem Ops → Draws) to change it.',
        422
      );
      err.data = { code: 'DRAW_CLOSES_AT_LOCKED' };
      throw err;
    }
  }
  const content = assertDrawTermsContent(designConfig);
  const contentSha256 = crypto.createHash('sha256').update(content).digest('hex');
  let row = await d.DrawTermsVersion.findOne({
    where: { campaignId, contentSha256 },
    order: [['version', 'DESC']],
  });
  if (!row) {
    const latest = await d.DrawTermsVersion.max('version', { where: { campaignId } });
    try {
      row = await d.DrawTermsVersion.create({
        campaignId,
        version: (Number.isInteger(latest) ? latest : 0) + 1,
        content,
        contentSha256,
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent save minted the same version number — the content row we
      // need either exists now (same hash) or the retry below surfaces the error.
      row = await d.DrawTermsVersion.findOne({ where: { campaignId, contentSha256 } });
      if (!row) throw err;
    }
  }
  return { ...designConfig, luckyDraw: { ...ld, termsVersionId: row.id, termsHash: contentSha256 } };
}
