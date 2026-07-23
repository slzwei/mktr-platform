import crypto from 'crypto';
import { sequelize, Prospect, Campaign, IdempotencyKey } from '../models/index.js';
import {
  screeningConfig,
  screeningApplies,
  makeScreeningGate,
} from './screeningGate.js';
import * as retellClient from './retellClient.js';
import { dncEnforcement } from './dncService.js';
import { hasValidDncConsent } from './dncConsent.js';
import { canMarketTo } from './consentService.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';
import { logger } from '../utils/logger.js';

/**
 * retellScreeningService — outbound dialer + call-outcome application for the
 * AI screening gate (docs/plans/retell-screening-calls.md §7–§8).
 *
 * Attempt lifecycle is token-first (Codex #3): the fenced dial claim commits a
 * 'pend_<token>' sentinel BEFORE the Retell POST, the token rides the call
 * metadata, and a verified webhook can bind the provider call_id by token even
 * when the create-phone-call response was lost (dispatch-unknown). A transient
 * dispatch failure never clears the sentinel — only the stale sweep may, after
 * SCREENING_STALE_CALL_MINUTES of webhook silence.
 */

const DIAL_LOCK_KEY = 'screening_dial';
const BUDGET_SCOPE = 'screening:dial';
const BUDGET_TTL_MS = 48 * 60 * 60 * 1000;
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Singapore, no DST

/** Retell disconnection reasons meaning "the consumer never conversed". */
export const UNANSWERED_REASONS = new Set([
  'dial_no_answer',
  'dial_busy',
  'dial_failed',
  'voicemail_reached',
  'machine_detected',
]);

const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultDeps = {
  sequelize,
  Prospect,
  Campaign,
  IdempotencyKey,
  retellClient,
  dncEnforcement,
  hasValidDncConsent,
  canMarketTo,
  logger,
  gate: makeScreeningGate(),
};

// ---------------------------------------------------------------------------
// Call-window helpers (SGT, "HH:MM-HH:MM")
// ---------------------------------------------------------------------------

function parseWindow(spec) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim());
  if (!m) return { startMin: 10 * 60, endMin: 20 * 60 };
  const startMin = Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
  const endMin = Math.min(23, Number(m[3])) * 60 + Math.min(59, Number(m[4]));
  return endMin > startMin ? { startMin, endMin } : { startMin: 10 * 60, endMin: 20 * 60 };
}

function sgtMinutesOfDay(date) {
  const sgt = new Date(date.getTime() + SGT_OFFSET_MS);
  return sgt.getUTCHours() * 60 + sgt.getUTCMinutes();
}

export function inCallWindow(cfg, now = new Date()) {
  const { startMin, endMin } = parseWindow(cfg.callWindow);
  const mins = sgtMinutesOfDay(now);
  return mins >= startMin && mins < endMin;
}

/** Next window-open instant at/after `from` (UTC Date). */
export function nextWindowOpen(cfg, from = new Date()) {
  const { startMin } = parseWindow(cfg.callWindow);
  const sgt = new Date(from.getTime() + SGT_OFFSET_MS);
  const dayStartUtc = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - SGT_OFFSET_MS;
  const todayOpen = new Date(dayStartUtc + startMin * 60 * 1000);
  if (todayOpen > from && !inCallWindow(cfg, from)) return todayOpen;
  return new Date(dayStartUtc + 24 * 60 * 60 * 1000 + startMin * 60 * 1000);
}

/** Backoff for the NEXT attempt, clamped into the call window. */
export function nextRetryAt(cfg, attemptCount, now = new Date()) {
  const delayMs = cfg.retryMinutes * Math.pow(2, Math.max(0, attemptCount - 1)) * 60 * 1000;
  const candidate = new Date(now.getTime() + delayMs);
  return inCallWindow(cfg, candidate) ? candidate : nextWindowOpen(cfg, candidate);
}

/** SGT midnight (UTC instant) for the daily dial budget. */
function sgtDayStart(now = new Date()) {
  const sgt = new Date(now.getTime() + SGT_OFFSET_MS);
  return new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - SGT_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeRetellScreeningService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /** jsonb evidence patch for one attempt, keyed by (sanitized) token. */
  async function patchAttempt(prospectId, token, patch, { transaction = null } = {}) {
    if (!TOKEN_RE.test(token)) return;
    await d.sequelize.query(
      `UPDATE prospects
          SET "screeningMetadata" = jsonb_set(
                COALESCE("screeningMetadata", '{}'::jsonb),
                '{attempts,${token}}',
                COALESCE("screeningMetadata" #> '{attempts,${token}}', '{}'::jsonb) || :patch::jsonb,
                true),
              "updatedAt" = NOW()
        WHERE id = :id`,
      { replacements: { id: prospectId, patch: JSON.stringify(patch) }, transaction }
    ).catch((err) => d.logger.warn('[Screening] attempt evidence patch failed', { prospectId, error: err?.message }));
  }

  /**
   * DNC dial-clear (plan §6): when the campaign checks DNC (any enforcement
   * mode), only a resolved, voice-deliverable result may be dialed.
   */
  function dncDialClear(prospect, campaignDesign) {
    if (campaignDesign.dncCheckAtSubmit !== true) return true;
    if (d.dncEnforcement() === 'off') return true; // check never runs — no data will ever come
    if (prospect.dncStatus === 'clear') return true;
    if (prospect.dncStatus === 'registered' && prospect.dncNoVoiceCall !== true) return true;
    if (prospect.dncStatus === 'registered' && d.hasValidDncConsent(prospect)) return true;
    return false; // pending / error / null / registered-on-voice without consent
  }

  /** Defer the next attempt without consuming one (window/budget/concurrency). */
  async function deferAttempt(prospect, at) {
    await d.sequelize.query(
      `UPDATE prospects SET "screeningNextAttemptAt" = :at, "updatedAt" = NOW()
        WHERE id = :id AND "quarantineReason" = 'screening_pending' AND "screeningActiveCallId" IS NULL`,
      { replacements: { id: prospect.id, at } }
    ).catch(() => {});
  }

  /**
   * Start one screening dial (plan §7.1–§7.2). Fire-and-forget safe: every
   * failure path leaves a consistent row for the sweep. Returns a status
   * object for logs/tests; never throws.
   */
  async function startScreeningAttempt(prospect, { campaign = null, cfg = screeningConfig() } = {}) {
    try {
      if (!cfg.configured) return { status: 'skipped', reason: 'not_configured' };

      const camp = campaign || (prospect.campaignId ? await d.Campaign.findByPk(prospect.campaignId) : null);
      // Gate re-check every attempt: campaign toggled off / stamp invalidated /
      // phone edited since capture all stop future dials (drain handles held rows).
      if (!screeningApplies({ campaign: camp, prospect }, cfg)) {
        return { status: 'skipped', reason: 'gate_not_applicable' };
      }
      if (camp && !['active'].includes(String(camp.status || 'active')) && camp.is_active === false) {
        return { status: 'skipped', reason: 'campaign_inactive' };
      }
      if (prospect.quarantineReason !== 'screening_pending' || prospect.screeningActiveCallId || prospect.screeningVerdict) {
        return { status: 'skipped', reason: 'not_pending' };
      }
      if (!/^\+[1-9]\d{9,14}$/.test(String(prospect.phone || ''))) {
        return { status: 'skipped', reason: 'bad_phone' };
      }

      const campaignDesign = readLegacyViewSafe(camp?.design_config, {});
      if (!dncDialClear(prospect, campaignDesign)) {
        // DNC pending/error → wait (backfill resolves, sweep re-tries);
        // registered-no-consent → never dials, TTL policies it out.
        return { status: 'skipped', reason: 'dnc_not_clear' };
      }

      // Suppression / erasure / consent withdrawal between capture and retry.
      // Errors defer (conservative): never dial on an unknown consent state.
      try {
        const ok = await d.canMarketTo({
          consumerId: prospect.consumerId || null,
          phone: prospect.phone || null,
          channel: 'all',
          campaignId: prospect.campaignId || null,
        });
        if (ok !== true) return { status: 'skipped', reason: 'no_marketing_consent' };
      } catch {
        await deferAttempt(prospect, new Date(Date.now() + 15 * 60 * 1000));
        return { status: 'deferred', reason: 'consent_lookup_failed' };
      }

      const now = new Date();
      if (!inCallWindow(cfg, now)) {
        await deferAttempt(prospect, nextWindowOpen(cfg, now));
        return { status: 'deferred', reason: 'outside_window' };
      }

      if (cfg.dryRun) {
        d.logger.info('[Screening] DRY RUN — would dial', { prospectId: prospect.id, phone: String(prospect.phone).slice(0, 6) + '****' });
        return { status: 'skipped', reason: 'dry_run' };
      }

      // ── Serialized claim: budget + concurrency + fenced sentinel in ONE
      //    advisory-locked tx, so parallel captures can't blow either cap.
      const token = `att_${crypto.randomUUID().replace(/-/g, '')}`;
      let claimed = false;
      const t = await d.sequelize.transaction();
      try {
        await d.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:k))`, {
          replacements: { k: DIAL_LOCK_KEY }, transaction: t,
        });

        const [[{ dialsToday }]] = await d.sequelize.query(
          `SELECT COUNT(*)::int AS "dialsToday" FROM idempotency_keys
            WHERE scope = :scope AND "createdAt" >= :dayStart`,
          { replacements: { scope: BUDGET_SCOPE, dayStart: sgtDayStart(now) }, transaction: t }
        );
        if (dialsToday >= cfg.maxDialsPerDay) {
          await t.rollback();
          await deferAttempt(prospect, new Date(now.getTime() + 30 * 60 * 1000));
          d.logger.warn('[Screening] daily dial budget exhausted', { dialsToday, max: cfg.maxDialsPerDay });
          return { status: 'deferred', reason: 'budget_exhausted' };
        }

        const [[{ inFlight }]] = await d.sequelize.query(
          `SELECT COUNT(*)::int AS "inFlight" FROM prospects WHERE "screeningActiveCallId" IS NOT NULL`,
          { transaction: t }
        );
        if (inFlight >= cfg.maxConcurrent) {
          await t.rollback();
          await deferAttempt(prospect, new Date(now.getTime() + 2 * 60 * 1000));
          return { status: 'deferred', reason: 'concurrency_full' };
        }

        const [rows] = await d.sequelize.query(
          `UPDATE prospects
              SET "screeningActiveCallId" = :sentinel,
                  "screeningAttemptCount" = "screeningAttemptCount" + 1,
                  "screeningNextAttemptAt" = NULL,
                  "screeningMetadata" = jsonb_set(
                    COALESCE("screeningMetadata", '{}'::jsonb),
                    '{attempts,${token}}',
                    :attemptJson::jsonb,
                    true),
                  "updatedAt" = NOW()
            WHERE id = :id AND "quarantineReason" = 'screening_pending'
              AND "screeningActiveCallId" IS NULL AND "screeningVerdict" IS NULL
            RETURNING "screeningAttemptCount"`,
          {
            replacements: {
              id: prospect.id,
              sentinel: `pend_${token}`,
              attemptJson: JSON.stringify({ token, startedAt: now.toISOString() }),
            },
            transaction: t,
          }
        );
        claimed = Array.isArray(rows) && rows.length > 0;
        if (!claimed) {
          await t.rollback();
          return { status: 'skipped', reason: 'lost_claim' };
        }

        await d.IdempotencyKey.create({
          key: `dial:${token}`,
          scope: BUDGET_SCOPE,
          responseBody: { prospectId: prospect.id },
          responseCode: 200,
          expiresAt: new Date(now.getTime() + BUDGET_TTL_MS),
        }, { transaction: t });

        await t.commit();
      } catch (err) {
        await t.rollback().catch(() => {});
        d.logger.error('[Screening] dial claim failed', { prospectId: prospect.id, error: err?.message || String(err) });
        return { status: 'error', reason: 'claim_failed' };
      }

      // ── The external POST, outside the tx. Sentinel is committed: a crash
      //    here is recovered by webhook token-binding or the stale sweep.
      const attemptNumber = (prospect.screeningAttemptCount || 0) + 1;
      try {
        const call = await d.retellClient.createPhoneCall({
          from_number: cfg.fromNumber,
          to_number: prospect.phone,
          override_agent_id: cfg.agentId,
          metadata: {
            mktr: { kind: 'screening', prospectId: prospect.id, attemptToken: token, attempt: attemptNumber },
          },
          retell_llm_dynamic_variables: {
            name: String(prospect.firstName || '').slice(0, 60) || 'there',
            campaign_name: String(camp?.name || '').slice(0, 120),
          },
        });

        await d.sequelize.query(
          `UPDATE prospects SET "screeningActiveCallId" = :callId, "updatedAt" = NOW()
            WHERE id = :id AND "screeningActiveCallId" = :sentinel`,
          { replacements: { id: prospect.id, callId: call.call_id, sentinel: `pend_${token}` } }
        );
        await patchAttempt(prospect.id, token, { callId: call.call_id, outcome: 'dialing' });
        d.logger.info('[Screening] dial started', { prospectId: prospect.id, callId: call.call_id, attempt: attemptNumber });
        return { status: 'dialed', callId: call.call_id, token };
      } catch (err) {
        const transient = err?.transient === true;
        if (transient) {
          // Retell MAY have the call. Keep the sentinel — webhook binds by
          // token, stale sweep resolves after silence. NEVER redial now.
          await patchAttempt(prospect.id, token, { outcome: 'dispatch_unknown', error: String(err?.message || err).slice(0, 200) });
          d.logger.warn('[Screening] dial dispatch unknown — awaiting webhook/stale sweep', { prospectId: prospect.id, token });
          return { status: 'dispatch_unknown', token };
        }
        // Definite rejection: consume the attempt, clear the sentinel, backoff.
        await patchAttempt(prospect.id, token, { outcome: 'dispatch_failed', error: String(err?.message || err).slice(0, 200) });
        await resolveAttemptFailure(prospect, `pend_${token}`, { cfg, kind: 'dispatch_failed' });
        return { status: 'dispatch_failed', token };
      }
    } catch (err) {
      d.logger.error('[Screening] startScreeningAttempt error', { prospectId: prospect?.id, error: err?.message || String(err) });
      return { status: 'error' };
    }
  }

  /**
   * Resolve a failed/unanswered attempt: fenced clear of the active id, then
   * retry-or-policy. `activeId` is the CURRENT sentinel or bound call id.
   */
  async function resolveAttemptFailure(prospect, activeId, { cfg = screeningConfig(), kind = 'no_answer' } = {}) {
    const [rows] = await d.sequelize.query(
      `UPDATE prospects
          SET "screeningActiveCallId" = NULL, "updatedAt" = NOW()
        WHERE id = :id AND "screeningActiveCallId" = :activeId
        RETURNING "screeningAttemptCount"`,
      { replacements: { id: prospect.id, activeId } }
    );
    if (!Array.isArray(rows) || rows.length === 0) return { outcome: 'stale' };
    const attempts = rows[0].screeningAttemptCount ?? prospect.screeningAttemptCount ?? 0;

    await prospect.reload().catch(() => {});
    if (attempts >= cfg.maxAttempts) {
      const policy = await d.gate.applyUnreachablePolicy(prospect, { cfg });
      return { outcome: 'exhausted', kind, policy };
    }
    await deferAttempt(prospect, nextRetryAt(cfg, attempts));
    return { outcome: 'retry_scheduled', kind, attempts };
  }

  /**
   * Apply a call's outcome (webhook or sweep poll). Only the CURRENT attempt
   * (matching screeningActiveCallId) may transition state — anything else is
   * evidence only (Codex #4). `finalIfNoAnalysis` lets the stale sweep close a
   * connected-but-never-analyzed call as no_verdict.
   */
  async function applyCallOutcome(prospect, call, { cfg = screeningConfig(), finalIfNoAnalysis = false } = {}) {
    const callId = call?.call_id;
    if (!callId) return { outcome: 'ignored' };
    const token = TOKEN_RE.test(call?.metadata?.mktr?.attemptToken || '') ? call.metadata.mktr.attemptToken : null;

    const isCurrent = prospect.screeningActiveCallId === callId;
    const disconnection = call.disconnection_reason || null;
    const unanswered = UNANSWERED_REASONS.has(disconnection) || call.in_voicemail === true;
    const analysis = call.call_analysis || null;

    if (token) {
      await patchAttempt(prospect.id, token, {
        callId,
        endedAt: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : new Date().toISOString(),
        disconnectionReason: disconnection,
        ...(call.recording_url ? { recordingUrl: call.recording_url } : {}),
      });
    }

    if (!isCurrent) {
      d.logger.info('[Screening] non-current call event — evidence only', { prospectId: prospect.id, callId });
      return { outcome: 'stale_evidence' };
    }

    if (unanswered) {
      return resolveAttemptFailure(prospect, callId, { cfg, kind: disconnection || 'unanswered' });
    }

    if (analysis) {
      const rawQualified = analysis.custom_analysis_data?.qualified;
      const detail = {
        reason: analysis.custom_analysis_data?.qualification_reason || null,
        interestLevel: analysis.custom_analysis_data?.interest_level || null,
        summary: analysis.call_summary || null,
        sentiment: analysis.user_sentiment || null,
        recordingUrl: call.recording_url || null,
      };
      if (rawQualified === true || rawQualified === 'true') {
        return d.gate.applyQualifiedVerdict(prospect, { callId, detail });
      }
      if (rawQualified === false || rawQualified === 'false') {
        return d.gate.markScreeningFailed(prospect, { callId, detail });
      }
      // Analysis arrived without our schema field — a connected call with no
      // usable verdict. Never guessed from sentiment (plan §8.4).
      return resolveAttemptFailure(prospect, callId, { cfg, kind: 'no_verdict' });
    }

    if (finalIfNoAnalysis) {
      return resolveAttemptFailure(prospect, callId, { cfg, kind: 'no_verdict' });
    }
    // call_ended for a connected call — verdict comes on call_analyzed.
    return { outcome: 'await_analysis' };
  }

  /**
   * Webhook entry for screening calls (plan §8.3). Never throws; never
   * creates prospects; always safe to 200.
   */
  async function handleScreeningWebhook(callData, event) {
    try {
      if (event === 'call_started') return { status: 'screening_started' };

      const mktr = callData?.metadata?.mktr || {};
      const prospectId = UUID_RE.test(mktr.prospectId || '') ? mktr.prospectId : null;
      const token = TOKEN_RE.test(mktr.attemptToken || '') ? mktr.attemptToken : null;

      let prospect = prospectId ? await d.Prospect.findByPk(prospectId) : null;
      if (!prospect && callData?.call_id) {
        prospect = await d.Prospect.findOne({ where: { screeningActiveCallId: callData.call_id } });
      }
      if (!prospect) {
        d.logger.warn('[Screening] webhook for unknown prospect — dropped', { callId: callData?.call_id || null });
        return { status: 'screening_orphan' };
      }

      // Dispatch-unknown recovery: bind the provider call id by attempt token.
      if (token && callData.call_id && prospect.screeningActiveCallId === `pend_${token}`) {
        await d.sequelize.query(
          `UPDATE prospects SET "screeningActiveCallId" = :callId, "updatedAt" = NOW()
            WHERE id = :id AND "screeningActiveCallId" = :sentinel`,
          { replacements: { id: prospect.id, callId: callData.call_id, sentinel: `pend_${token}` } }
        );
        await prospect.reload().catch(() => {});
        d.logger.info('[Screening] bound call id via attempt token', { prospectId: prospect.id, callId: callData.call_id });
      }

      const result = await applyCallOutcome(prospect, callData, {});
      return { status: `screening_${result.outcome || 'processed'}`, prospectId: prospect.id };
    } catch (err) {
      d.logger.error('[Screening] webhook handling error', { error: err?.message || String(err) });
      return { status: 'screening_error' };
    }
  }

  return {
    startScreeningAttempt,
    applyCallOutcome,
    resolveAttemptFailure,
    handleScreeningWebhook,
    dncDialClear,
  };
}

// --- Backward-compatible default-wired exports (house pattern) ---
const _default = makeRetellScreeningService();
export const startScreeningAttempt = _default.startScreeningAttempt;
export const applyCallOutcome = _default.applyCallOutcome;
export const handleScreeningWebhook = _default.handleScreeningWebhook;
