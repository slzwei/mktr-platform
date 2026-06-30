import crypto from 'crypto';
import { Campaign } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { formatDncNumber, checkNumbers as dncCheckNumbers, dncReady, dncConfig } from './dncService.js';
import { isPhoneRecentlyVerified } from './verifiedPhoneStore.js';

/**
 * dncCheckService — the backend behind the lead-capture form's DNC consent gate
 * (POST /api/dnc/check). It answers ONE question, minimally: is this OTP-verified Singapore
 * number on the Do Not Call register? Returns only `{ registered: boolean }`.
 *
 * Cost + abuse model (docs/plans/dnc-consent-gate.md §2): every check costs a real prepaid
 * DNC credit, so this fails CLOSED on spend (any gate miss → no API call) and fails OPEN on
 * UX (any error/over-budget → registered:false → no gate → the create-path scrub backstops).
 *
 * Gates, in order — ALL must pass before a credit is spent:
 *   1. DNC ready (configured + DNC_API_ENABLED) — inert when DNC is off.
 *   2. Campaign opted in (design_config.dncCheckAtSubmit === true) — scopes spend to opted-in
 *      campaigns AND stops the endpoint being a DNC oracle via some other campaign.
 *   3. SG number (formatDncNumber) — non-SG is out of DNC scope.
 *   4. The number was OTP-verified recently (verifiedPhoneStore) — proves control of the
 *      number, so the endpoint can't be used to look up arbitrary numbers' DNC status.
 * Then: a per-number server cache (so repeat checks don't re-bill) → dncService.checkNumbers
 * (the hourly budget guard, the serialising advisory lock, and the egress proxy all live
 * INSIDE checkNumbers, so every caller shares one budget + one outbound channel).
 */

// Per-number DNC result cache. Single-instance backend → in-memory is sufficient (same
// assumption as dncService's budget guard). Keyed by a SHA-256 of the 8-digit number — never
// the raw number — so a heap dump doesn't leak which numbers were checked. value =
// { registered, expiresAt }. A repeat check for the same number within the TTL reuses the
// cached answer and never re-bills a prepaid credit.
const resultCache = new Map();

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — short enough that DNC status can't go stale for long

function cacheTtlMs() {
  const v = Number(process.env.DNC_CHECK_CACHE_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CACHE_TTL_MS;
}

function cacheKey(number) {
  return crypto.createHash('sha256').update(String(number)).digest('hex');
}

function getCached(number, now = Date.now()) {
  const hit = resultCache.get(cacheKey(number));
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    resultCache.delete(cacheKey(number));
    return undefined;
  }
  return hit.registered;
}

function setCached(number, registered, now = Date.now()) {
  resultCache.set(cacheKey(number), { registered, expiresAt: now + cacheTtlMs() });
}

/** Test helper — clear the per-number result cache. */
export function _resetDncCheckCache() {
  resultCache.clear();
}

/**
 * Form-time DNC lookup for the consent gate. NEVER throws and ALWAYS resolves to
 * `{ registered: boolean }`; every gate miss / error / over-budget yields
 * `{ registered: false }` (fail-open) so an errored check can never block a non-registered
 * user.
 *
 * @param {{ phone?: string, countryCode?: string, campaignId?: string }} input
 *   phone: the local digits (the SPA sends `formData.phone`, 8 digits); countryCode: '+65'.
 * @param {object} [deps] - injectable for tests (Campaign, dncReady, formatDncNumber,
 *   checkNumbers, isPhoneRecentlyVerified, cfg, logger).
 * @returns {Promise<{registered: boolean}>}
 */
export async function checkDncForForm({ phone, countryCode = '+65', campaignId } = {}, deps = {}) {
  const log = deps.logger || logger;
  const cfg = deps.cfg || dncConfig();
  const CampaignModel = deps.Campaign || Campaign;
  const ready = deps.dncReady || dncReady;
  const fmt = deps.formatDncNumber || formatDncNumber;
  const checkNums = deps.checkNumbers || dncCheckNumbers;
  const isVerified = deps.isPhoneRecentlyVerified || isPhoneRecentlyVerified;

  try {
    // Gate 1: DNC must be configured + enabled. When off, there's nothing to check and no
    // credit to spend — the whole feature is inert.
    if (!ready(cfg)) return { registered: false };

    // Gate 2: the campaign must have opted into the submit-time DNC check.
    if (!campaignId) return { registered: false };
    const campaign = await CampaignModel.findByPk(campaignId, { attributes: ['id', 'design_config'] });
    if (campaign?.design_config?.dncCheckAtSubmit !== true) return { registered: false };

    // Gate 3: Singapore number only (the DNC register covers SG numbers).
    const fullPhone = `${countryCode || '+65'}${phone || ''}`;
    const number = fmt(fullPhone);
    if (!number) return { registered: false };

    // Gate 4: the number must have passed OTP verification recently. This is the oracle
    // fix — without it the endpoint leaks "is X on DNC?" for any number.
    if (!isVerified(fullPhone)) return { registered: false };

    // Per-number cache — a repeat check (e.g. the user re-sent OTP) within the TTL reuses
    // the prior answer and does not re-bill.
    const cached = getCached(number);
    if (cached !== undefined) return { registered: cached };

    // Live check — budget guard + advisory lock + egress proxy all live inside checkNumbers.
    const result = await checkNums([number], { cfg }, deps);

    if (result?.budgetExceeded) {
      log.warn({ campaign_id: campaignId }, 'dnc.form_check.budget_exceeded');
      return { registered: false };
    }
    // Only S000 carries an authoritative per-number answer. Any other status (auth /
    // bad-request / insufficient-credits / transport hiccup that still returned JSON) means
    // we don't truly know → fail-open and don't cache a guess.
    if (result?.statusCode !== 'S000') {
      log.warn({ campaign_id: campaignId, status_code: result?.statusCode || null }, 'dnc.form_check.no_result');
      return { registered: false };
    }

    const r = (Array.isArray(result.results) && result.results[0]) || {};
    const registered = !!(r.noVoiceCall || r.noTextMessage || r.noFax);
    setCached(number, registered);
    log.info({ campaign_id: campaignId, dnc_registered: registered }, 'dnc.form_check.recorded');
    return { registered };
  } catch (err) {
    log.error({ err: err?.message || String(err) }, 'dnc.form_check.error');
    return { registered: false };
  }
}

export default { checkDncForForm, _resetDncCheckCache };
