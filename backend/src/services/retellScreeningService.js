import crypto from 'crypto';
import { sequelize, Prospect, Campaign, IdempotencyKey, ProspectActivity } from '../models/index.js';
import {
  screeningConfig,
  screeningApplies,
  makeScreeningGate,
} from './screeningGate.js';
import * as retellClient from './retellClient.js';
import { dncEnforcement } from './dncService.js';
import { hasValidDncConsent } from './dncConsent.js';
import { canMarketTo } from './consentService.js';
import { readLegacyViewSafe, getStoredLuckyDraw } from '../utils/designConfigV2Clamp.js';
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
// WhatsApp callback opt-in tokens (draw_callback_optin URL button) live in
// idempotency_keys under this scope — key `wacb:<token>` → {prospectId}.
const WA_CB_SCOPE = 'screening:wa_callback';
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
  ProspectActivity,
  retellClient,
  dncEnforcement,
  hasValidDncConsent,
  canMarketTo,
  logger,
  gate: makeScreeningGate(),
  // LAZY dynamic import (house pattern, prospectService.js:174): a top-level
  // import would drag the whole redeemOps WhatsApp graph into every unit
  // suite that mocks this module's deps.
  sendDrawCallbackOptin: async (args) =>
    (await import('./redeemOps/whatsappService.js')).sendDrawCallbackOptinWhatsApp(args),
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

/**
 * `callback_window` (Retell post-call analysis, script v9) → how long to wait
 * before ringing back. "tomorrow" is deliberately +12h rather than +24h: the
 * window clamp then lands it at the NEXT morning's open however late the first
 * call ran, which is what the person meant.
 */
const CALLBACK_DELAY_MINUTES = {
  // 'asap' is never emitted by Retell (not in the analysis enum) — it exists
  // for the WhatsApp tap page, where "call me now" is a live request.
  asap: 10,
  later_today: 3 * 60,
  tomorrow: 12 * 60,
  this_week: 60 * 60,
};

/**
 * The instant we promised to call back, or null when no callback was asked for.
 * Clamped into the call window, and never scheduled past the point the TTL
 * sweep may release the lead unscreened (the same 2× hold the sweep grants a
 * promised callback) — a promise we cannot keep is worse than an earlier call.
 */
export function callbackRetryAt(cfg, rawWindow, { now = new Date(), quarantinedAt = null } = {}) {
  const minutes = CALLBACK_DELAY_MINUTES[String(rawWindow || '').trim().toLowerCase()];
  if (!minutes) return null;
  let at = new Date(now.getTime() + minutes * 60 * 1000);
  if (quarantinedAt) {
    const ceiling = new Date(new Date(quarantinedAt).getTime() + 2 * cfg.maxHoldHours * 60 * 60 * 1000);
    if (at > ceiling) at = ceiling;
  }
  return inCallWindow(cfg, at) ? at : nextWindowOpen(cfg, at);
}

/**
 * Additional draw chances the consultant meet-up earns, from the campaign's
 * stored luckyDraw.multiplier (mirrors normalizeLuckyDraw's default-10 /
 * clamp-2..100 without importing the draw graph). Non-draw campaigns fall
 * back to the default multiplier's 9.
 */
export function drawExtraChances(campaign) {
  const raw = Number(getStoredLuckyDraw(campaign?.design_config)?.multiplier);
  const multiplier = Number.isFinite(raw) ? Math.min(100, Math.max(2, Math.floor(raw))) : 10;
  return multiplier - 1;
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
  // `now` is injectable for the same reason inCallWindow/nextRetryAt take it:
  // the window gate is time-of-day dependent (SGT), and a clock the tests
  // cannot pin turns every dial-path test into a 23:59-SGT flake — the
  // "always-open" '00:00-23:59' test window has an inexpressible final
  // minute (parseWindow clamps at 23:59, inCallWindow is end-exclusive),
  // which is exactly when the 26 Jul CI run started. Prod callers omit it.
  async function startScreeningAttempt(prospect, { campaign = null, cfg = screeningConfig(), now = new Date() } = {}) {
    try {
      if (!cfg.configured) return { status: 'skipped', reason: 'not_configured' };

      const camp = campaign || (prospect.campaignId ? await d.Campaign.findByPk(prospect.campaignId) : null);
      // Gate re-check every attempt: campaign toggled off / stamp invalidated /
      // phone edited since capture all stop future dials (drain handles held rows).
      if (!screeningApplies({ campaign: camp, prospect }, cfg)) {
        return { status: 'skipped', reason: 'gate_not_applicable' };
      }
      // Either signal alone stops NEW dials (PR-1, Codex R1 CX20 — the old
      // `&&` let an archived campaign that kept is_active=true keep dialing).
      // Delivery of already-QUALIFIED holds is deliberately state-independent
      // (drain philosophy): dialing is new spend + a customer touch on a
      // stopped campaign; releasing a captured, qualified lead is fulfilment.
      if (camp && (String(camp.status || 'active') !== 'active' || camp.is_active === false)) {
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
            // Campaign age gate → the agent's age question ({{age_min}}–{{age_max}}
            // in the Retell prompt). Falls back to the campaign-column defaults so
            // the script never speaks a literal placeholder. Strings per Retell.
            age_min: String(Number.isInteger(camp?.min_age) ? camp.min_age : 18),
            age_max: String(Number.isInteger(camp?.max_age) ? camp.max_age : 65),
            // Draw reward → "{{extra_chances}} more chances" in the script.
            // Driven by the SAME luckyDraw.multiplier the draw engine grants
            // against (normalizeLuckyDraw default 10, clamp 2..100), so what
            // Sarah promises can never diverge from what attendance earns:
            // multiplier N ⇒ N−1 additional chances on top of the base entry.
            extra_chances: String(drawExtraChances(camp)),
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
   *
   * `retryAt` (a callback the person asked for) replaces the blind exponential
   * backoff AND buys ONE bonus attempt per lead: they picked up and asked us to
   * ring back, which is not a failed reach. The grant rides the same fenced
   * statement that clears the active id, so a replayed webhook can never grant
   * twice, and a lead that keeps deferring still runs out at maxAttempts + 1.
   */
  async function resolveAttemptFailure(prospect, activeId, { cfg = screeningConfig(), kind = 'no_answer', retryAt = null } = {}) {
    const granting = !!retryAt && prospect.screeningMetadata?.callbackGranted !== true;
    const [rows] = await d.sequelize.query(
      `UPDATE prospects
          SET "screeningActiveCallId" = NULL,
              "screeningMetadata" = COALESCE("screeningMetadata", '{}'::jsonb) || :metaPatch::jsonb,
              "updatedAt" = NOW()
        WHERE id = :id AND "screeningActiveCallId" = :activeId
        RETURNING "screeningAttemptCount"`,
      {
        replacements: {
          id: prospect.id,
          activeId,
          metaPatch: JSON.stringify(granting ? { callbackGranted: true } : {}),
        },
      }
    );
    if (!Array.isArray(rows) || rows.length === 0) return { outcome: 'stale' };
    const attempts = rows[0].screeningAttemptCount ?? prospect.screeningAttemptCount ?? 0;

    await prospect.reload().catch(() => {});
    const granted = granting || prospect.screeningMetadata?.callbackGranted === true;
    if (attempts >= cfg.maxAttempts + (granted ? 1 : 0)) {
      const policy = await d.gate.applyUnreachablePolicy(prospect, { cfg });
      return { outcome: 'exhausted', kind, policy };
    }
    await deferAttempt(prospect, retryAt || nextRetryAt(cfg, attempts));
    // WhatsApp callback invite (plan §16.6) — fire-and-forget, never on the
    // webhook's critical path. Eligible when the lead is STILL HELD with
    // attempts left (after exhaustion the release policy takes the row away)
    // and either (a) a connected call ended with no verdict and NO voice-booked
    // callback — "call me later" with no time, hung up early — or (b) the 2nd
    // dial went unanswered (one dial before the release policy would fire).
    // A voice-booked callback (retryAt) skips it: the promise is already made,
    // and the template's "sorry we missed you" would misdescribe that call.
    if (!retryAt && (kind === 'no_verdict' || attempts >= 2)) {
      maybeSendWaCallbackInvite(prospect, { cfg }).catch(() => {});
    }
    return { outcome: 'retry_scheduled', kind, attempts, ...(retryAt ? { callbackAt: retryAt.toISOString() } : {}) };
  }

  /**
   * Send the draw_callback_optin WhatsApp AT MOST ONCE per lead. Cheap guards
   * first (draw campaign, active, marketing consent — all no-query or mocked
   * lookups), then a fenced metadata claim so replayed webhooks can't double-
   * send, then token mint + send + receipt patch. Never throws.
   */
  async function maybeSendWaCallbackInvite(prospect, { cfg = screeningConfig() } = {}) {
    try {
      if (!cfg.configured || cfg.dryRun) return { sent: false, reason: 'not_configured' };
      if (prospect.screeningMetadata?.waCallback) return { sent: false, reason: 'already_sent' };

      const camp = prospect.campaignId ? await d.Campaign.findByPk(prospect.campaignId).catch(() => null) : null;
      if (!camp || String(camp.status || 'active') !== 'active' || camp.is_active === false) {
        return { sent: false, reason: 'campaign_inactive' };
      }
      // The approved template speaks draw language ("your lucky draw entry") —
      // a non-draw screening campaign must never send it.
      const ld = getStoredLuckyDraw(camp.design_config);
      if (!ld) return { sent: false, reason: 'not_a_draw' };

      // Same consent posture as the dialer; sendTemplate re-checks with
      // purpose:'marketing' (fail-closed) at send time.
      try {
        const ok = await d.canMarketTo({
          consumerId: prospect.consumerId || null,
          phone: prospect.phone || null,
          channel: 'whatsapp',
          campaignId: prospect.campaignId || null,
        });
        if (ok !== true) return { sent: false, reason: 'no_marketing_consent' };
      } catch {
        return { sent: false, reason: 'consent_lookup_failed' };
      }

      // Fenced once-per-lead claim: the loser of a webhook-replay race no-ops.
      const token = `wcb_${crypto.randomUUID().replace(/-/g, '')}`;
      const now = new Date();
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "screeningMetadata" = jsonb_set(
                  COALESCE("screeningMetadata", '{}'::jsonb),
                  '{waCallback}', :seed::jsonb, true),
                "updatedAt" = NOW()
          WHERE id = :id AND "quarantineReason" = 'screening_pending'
            AND ("screeningMetadata" -> 'waCallback') IS NULL
          RETURNING id`,
        { replacements: { id: prospect.id, seed: JSON.stringify({ token, sentAt: now.toISOString() }) } }
      );
      if (!Array.isArray(rows) || rows.length === 0) return { sent: false, reason: 'lost_claim' };

      // Token row BEFORE the send: the tap must resolve even if our receipt
      // patch later fails. Expiry = the same 2× hold ceiling the TTL sweep
      // grants a promised callback — past that the lead has left the queue.
      await d.IdempotencyKey.create({
        key: `wacb:${token}`,
        scope: WA_CB_SCOPE,
        responseBody: { prospectId: prospect.id },
        responseCode: 200,
        expiresAt: new Date(now.getTime() + 2 * cfg.maxHoldHours * 60 * 60 * 1000),
      });

      const multiplier = drawExtraChances(camp) + 1;
      const result = await d.sendDrawCallbackOptin({
        prospect,
        drawName: camp.name,
        multiplier,
        prize: ld.prize || null,
        token,
      });
      await patchWaCallback(prospect.id, {
        sent: result?.sent === true,
        // wamid keys the wa_message_statuses inbox (wa-delivery-truth) — this
        // send writes no entitlement receipt, so the id here is the ONLY
        // handle for tying a later delivered/failed verdict to the invite.
        ...(result?.messageId ? { messageId: result.messageId } : {}),
        ...(result?.skipped ? { skipped: result.skipped } : {}),
        ...(result?.error ? { error: String(result.error).slice(0, 200) } : {}),
      });
      d.logger.info('[Screening] WA callback invite', { prospectId: prospect.id, sent: result?.sent === true, skipped: result?.skipped || null });
      return { sent: result?.sent === true, token };
    } catch (err) {
      d.logger.warn('[Screening] WA callback invite failed', { prospectId: prospect?.id, error: err?.message || String(err) });
      return { sent: false, reason: 'error' };
    }
  }

  /** Merge keys into screeningMetadata.waCallback (evidence only, non-fenced). */
  async function patchWaCallback(prospectId, patch) {
    await d.sequelize.query(
      `UPDATE prospects
          SET "screeningMetadata" = jsonb_set(
                COALESCE("screeningMetadata", '{}'::jsonb),
                '{waCallback}',
                COALESCE("screeningMetadata" -> 'waCallback', '{}'::jsonb) || :patch::jsonb,
                true),
              "updatedAt" = NOW()
        WHERE id = :id`,
      { replacements: { id: prospectId, patch: JSON.stringify(patch) } }
    ).catch((err) => d.logger.warn('[Screening] waCallback patch failed', { prospectId, error: err?.message }));
  }

  /** Resolve a wa-callback token → its prospect, or null. */
  async function resolveWaCallbackToken(token) {
    if (!/^wcb_[a-f0-9]{32}$/i.test(String(token || ''))) return null;
    const row = await d.IdempotencyKey.findOne({ where: { key: `wacb:${token}`, scope: WA_CB_SCOPE } });
    if (!row || (row.expiresAt && new Date(row.expiresAt) < new Date())) return null;
    const prospectId = row.responseBody?.prospectId;
    if (!UUID_RE.test(prospectId || '')) return null;
    return d.Prospect.findByPk(prospectId);
  }

  function waCallbackStateOf(prospect) {
    if (!prospect) return 'invalid';
    if (prospect.quarantineReason !== 'screening_pending' || prospect.screeningVerdict) return 'done';
    if (prospect.screeningActiveCallId) return 'in_flight';
    return 'ready';
  }

  /**
   * Page context for redeem.sg/callback?t=… — first name only, never full PII
   * (reward-claim posture). `state`: ready | in_flight | done | invalid.
   */
  async function readWaCallbackContext(token) {
    try {
      const prospect = await resolveWaCallbackToken(token);
      const state = waCallbackStateOf(prospect);
      if (state === 'invalid') return { state };
      if (state === 'done') return { state, firstName: prospect.firstName || null };
      const camp = prospect.campaignId ? await d.Campaign.findByPk(prospect.campaignId).catch(() => null) : null;
      const wa = prospect.screeningMetadata?.waCallback || {};
      return {
        state,
        firstName: prospect.firstName || null,
        drawName: camp?.name || 'the lucky draw',
        multiplier: drawExtraChances(camp) + 1,
        ...(wa.window ? { window: wa.window } : {}),
        ...(prospect.screeningNextAttemptAt ? { scheduledFor: new Date(prospect.screeningNextAttemptAt).toISOString() } : {}),
      };
    } catch (err) {
      d.logger.error('[Screening] readWaCallbackContext error', { error: err?.message || String(err) });
      return { state: 'invalid' };
    }
  }

  /**
   * The tap (plan §16.6 step 3): consent to be called + a chosen window →
   * fenced schedule write + the callback grant, then the sweep dials. Re-taps
   * just move the time (the grant flag is already true — no extra attempt).
   */
  async function applyWaCallbackRequest(token, window, { cfg = screeningConfig(), ip = null } = {}) {
    try {
      const w = String(window || '').trim().toLowerCase();
      if (!['asap', 'later_today', 'tomorrow', 'this_week'].includes(w)) {
        return { ok: false, state: 'bad_window' };
      }
      const prospect = await resolveWaCallbackToken(token);
      const state = waCallbackStateOf(prospect);
      if (state !== 'ready') return { ok: false, state };

      const at = callbackRetryAt(cfg, w, { quarantinedAt: prospect.quarantinedAt || null });
      const waPatch = JSON.stringify({
        tappedAt: new Date().toISOString(),
        window: w,
        scheduledFor: at.toISOString(),
        ...(ip ? { ip: String(ip).slice(0, 45) } : {}),
      });
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "screeningNextAttemptAt" = :at,
                "screeningMetadata" = jsonb_set(
                  COALESCE("screeningMetadata", '{}'::jsonb) || '{"callbackGranted":true}'::jsonb,
                  '{waCallback}',
                  COALESCE("screeningMetadata" -> 'waCallback', '{}'::jsonb) || :waPatch::jsonb,
                  true),
                "updatedAt" = NOW()
          WHERE id = :id AND "quarantineReason" = 'screening_pending'
            AND "screeningActiveCallId" IS NULL AND "screeningVerdict" IS NULL
          RETURNING id`,
        { replacements: { id: prospect.id, at, waPatch } }
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        // Fence lost between read and write — report the fresher state.
        await prospect.reload().catch(() => {});
        return { ok: false, state: waCallbackStateOf(prospect) };
      }
      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'updated',
        actorUserId: null,
        description: `Customer requested a screening callback via WhatsApp (${w}) — scheduled for ${at.toISOString()}`,
        metadata: { waCallback: true, window: w, scheduledFor: at.toISOString() },
      }).catch(() => {});
      d.logger.info('[Screening] WA callback scheduled by customer', { prospectId: prospect.id, window: w, at: at.toISOString() });
      return { ok: true, state: 'scheduled', scheduledFor: at.toISOString(), window: w };
    } catch (err) {
      d.logger.error('[Screening] applyWaCallbackRequest error', { error: err?.message || String(err) });
      return { ok: false, state: 'error' };
    }
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
    const checks = analysis?.custom_analysis_data || null;
    const rawQualified = checks?.qualified;
    const hasVerdict = rawQualified === true || rawQualified === 'true'
      || rawQualified === false || rawQualified === 'false';
    const detail = analysis
      ? {
          reason: checks?.qualification_reason || null,
          interestLevel: checks?.interest_level || null,
          summary: analysis.call_summary || null,
          sentiment: analysis.user_sentiment || null,
          recordingUrl: call.recording_url || null,
          // Verbatim turn-by-turn script Retell returns ("Agent: …\nUser: …").
          // Capped so a pathologically long call can't bloat the jsonb row; the
          // recording remains the unabridged source of truth. Admin-only surface.
          transcript: typeof call.transcript === 'string' ? call.transcript.slice(0, 20000) : null,
          // Full per-check evidence (sg_pr / age_in_range / meet_consultant …) —
          // small object; lets the admin drawer show WHICH check failed.
          checks,
        }
      : null;
    const attemptOutcome = unanswered ? 'unanswered'
      : hasVerdict ? (rawQualified === true || rawQualified === 'true' ? 'qualified' : 'not_qualified')
        : analysis ? 'no_verdict' : null;

    if (token) {
      // Per-call economics + provenance, all straight off the Retell call
      // object. costCents = call_cost.combined_cost (Retell bills in US cents);
      // duration falls back to the connect→hangup span when cost is absent
      // (e.g. a call_ended before billing settles). agentVersion attributes the
      // call to a PUBLISHED script version so qualified-rate is comparable
      // across A/B script changes. in_voicemail / call_successful live under
      // call_analysis, so they land on the call_analyzed patch and merge in.
      const cost = call.call_cost || {};
      const durationSeconds = Number.isFinite(cost.total_duration_seconds)
        ? cost.total_duration_seconds
        : (Number.isFinite(call.start_timestamp) && Number.isFinite(call.end_timestamp)
            ? Math.max(0, Math.round((call.end_timestamp - call.start_timestamp) / 1000))
            : null);
      await patchAttempt(prospect.id, token, {
        callId,
        endedAt: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : new Date().toISOString(),
        disconnectionReason: disconnection,
        ...(call.recording_url ? { recordingUrl: call.recording_url } : {}),
        ...(Number.isFinite(cost.combined_cost) ? { costCents: cost.combined_cost } : {}),
        ...(durationSeconds != null ? { durationSeconds } : {}),
        ...(call.agent_id ? { agentId: call.agent_id } : {}),
        ...(Number.isInteger(call.agent_version) ? { agentVersion: call.agent_version } : {}),
        ...(analysis && typeof analysis.in_voicemail === 'boolean' ? { inVoicemail: analysis.in_voicemail } : {}),
        ...(analysis && typeof analysis.call_successful === 'boolean' ? { callSuccessful: analysis.call_successful } : {}),
        ...(attemptOutcome ? { outcome: attemptOutcome } : {}),
        // A connected call that produced NO verdict (hung up early, wrong
        // person, "call me back later") never reaches a verdict transition, so
        // this patch is the only place its evidence can land. Verdict-bearing
        // calls skip it — verdictDetail already carries the same fields, and
        // duplicating a 20k transcript per attempt bloats the row for nothing.
        ...(detail && !hasVerdict
          ? {
              reason: detail.reason,
              summary: detail.summary,
              sentiment: detail.sentiment,
              transcript: detail.transcript,
              checks: detail.checks,
            }
          : {}),
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
      if (rawQualified === true || rawQualified === 'true') {
        return d.gate.applyQualifiedVerdict(prospect, { callId, detail });
      }
      if (rawQualified === false || rawQualified === 'false') {
        return d.gate.markScreeningFailed(prospect, { callId, detail });
      }
      // Connected, but no usable verdict — hung up early, wrong person, or
      // asked us to ring back. Never guessed from sentiment (plan §8.4). When
      // they named a better time, that time replaces the blind backoff.
      return resolveAttemptFailure(prospect, callId, {
        cfg,
        kind: 'no_verdict',
        retryAt: callbackRetryAt(cfg, checks?.callback_window, { quarantinedAt: prospect.quarantinedAt || null }),
      });
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
    maybeSendWaCallbackInvite,
    readWaCallbackContext,
    applyWaCallbackRequest,
  };
}

// --- Backward-compatible default-wired exports (house pattern) ---
const _default = makeRetellScreeningService();
export const startScreeningAttempt = _default.startScreeningAttempt;
export const applyCallOutcome = _default.applyCallOutcome;
export const handleScreeningWebhook = _default.handleScreeningWebhook;
export const readWaCallbackContext = _default.readWaCallbackContext;
export const applyWaCallbackRequest = _default.applyWaCallbackRequest;
