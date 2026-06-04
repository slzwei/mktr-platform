import * as Sentry from '@sentry/node';
import { hashEmail, hashPhone, hashExternalId } from '../utils/piiHashing.js';
import { logger } from '../utils/logger.js';

// TikTok Events API ("Events API 2.0"). Mirror of metaCapiService.js — the
// server-side counterpart of the browser ttq pixel, for match-quality + ttclid
// resilience (iOS / ad-blockers / cookie loss).
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

/**
 * Guard: which prospects are eligible for TikTok Events API dispatch?
 *
 * Mirrors shouldFireCapi exactly — origin gates dispatch, not the funnel event:
 *   - Master switch off / missing credentials (token, pixel id)
 *   - Retell-source prospects (no ad-attribution chain)
 *   - Meta Lead Ads-source prospects (originated inside Meta, not TikTok)
 *
 * A per-campaign tiktokPixelId override (ctx.pixelIdOverride) can satisfy the
 * pixel-id requirement even when the env TIKTOK_PIXEL_ID is unset, so the env
 * check is intentionally NOT in the guard (the sender resolves the id and bails
 * if neither is present) — kept identical in spirit to metaCapiService.
 */
export function shouldFireTikTok(prospect) {
  if (process.env.TIKTOK_EVENTS_API_ENABLED !== 'true') return false;
  if (!process.env.TIKTOK_ACCESS_TOKEN) return false;
  if (!process.env.TIKTOK_PIXEL_ID) return false;
  if (!prospect) return false;
  if (prospect.leadSource === 'call_bot') return false;
  if (prospect.retellCallId) return false;
  if (prospect.sourceMetadata?.metaLeadgenId) return false;
  return true;
}

/**
 * Builds the TikTok Events API payload. Exported for testing.
 *
 * The event name defaults to 'Lead' (form submit) and is overridable via
 * options.eventName so the quiz funnel can dispatch 'CompleteRegistration'. The
 * event_id always comes from ctx.eventId — the same id the browser ttq pixel
 * fired with — so TikTok deduplicates Pixel↔Events-API.
 *
 * PII consent rule (identical to Meta CAPI):
 *   - hashed email/phone included only with marketing consent
 *     (sourceMetadata.consent_contact === true)
 *   - ttclid/ttp/ip/user_agent/external_id always included (browser/session ids,
 *     not the person's contact info)
 */
export function _buildPayload(prospect, ctx, options) {
  const meta = prospect.sourceMetadata || {};
  const marketingConsent = meta.consent_contact === true;
  const eventName = options?.eventName || 'Lead';
  const pixelId = ctx.pixelIdOverride || process.env.TIKTOK_PIXEL_ID;

  const user = {
    ttclid: ctx.ttclid || meta.ttclid,
    ttp: ctx.ttp || meta.ttp,
    ip: ctx.clientIp || meta.clientIp,
    user_agent: ctx.clientUserAgent || meta.clientUserAgent,
    external_id: hashExternalId(prospect.id),
  };

  if (marketingConsent) {
    user.email = hashEmail(prospect.email);
    user.phone = hashPhone(prospect.phone);
  }

  // Strip undefined/null/empty so we don't send placeholder hashes / empty ids
  const cleanUser = Object.fromEntries(
    Object.entries(user).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );

  const url = ctx.eventSourceUrl || meta.eventSourceUrl || undefined;

  const eventData = {
    event: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: ctx.eventId,
    user: cleanUser,
    properties: {
      content_type: 'lead',
      campaign_id: prospect.campaignId,
      lead_source: prospect.leadSource,
    },
    ...(url ? { page: { url } } : {}),
  };

  Object.keys(eventData).forEach((k) => {
    if (eventData[k] === undefined) delete eventData[k];
  });

  return {
    event_source: 'web',
    event_source_id: pixelId,
    data: [eventData],
    ...(options?.testEventCode ? { test_event_code: options.testEventCode } : {}),
  };
}

/**
 * Fire-and-forget TikTok Events API dispatch (generic over event name).
 *
 * Never throws to the caller. Errors land in Sentry + structured logs. Note:
 * TikTok returns HTTP 200 with a non-zero `code` for logical failures, so
 * success requires res.ok AND body.code === 0.
 *
 * @param {object} prospect   Sequelize prospect instance (or plain object)
 * @param {object} ctx        { eventId, ttclid, ttp, clientIp, clientUserAgent, eventSourceUrl, pixelIdOverride }
 * @param {object} [options]  { eventName } — defaults to 'Lead'
 * @param {object} [deps]     Injected deps for testing: { fetch }
 * @returns {Promise<object>} { sent: boolean, ...details }
 */
export async function sendConversionEvent(prospect, ctx = {}, options = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const eventName = options.eventName || 'Lead';
  const logLabel = eventName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

  if (!shouldFireTikTok(prospect)) {
    return { sent: false, reason: 'guarded' };
  }

  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const testEventCode = process.env.TIKTOK_TEST_EVENT_CODE || undefined;
  const payload = _buildPayload(prospect, ctx, { testEventCode, eventName });

  try {
    const res = await fetchImpl(TIKTOK_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    // TikTok signals logical errors via a non-zero `code` even on HTTP 200.
    const ok = res.ok && (body.code === 0 || body.code === undefined);

    if (!ok) {
      Sentry.captureException(new Error(`TikTok Events API failed: HTTP ${res.status} code ${body.code}`), {
        tags: { source: 'tiktok_events', event_name: eventName },
        extra: { status: res.status, body, prospect_id: prospect.id },
      });
      logger.warn(
        { status: res.status, code: body.code, message: body.message, prospect_id: prospect.id, event_id: ctx.eventId },
        `tiktok.${logLabel}.failed`
      );
      return { sent: false, status: res.status, body };
    }

    logger.info(
      { event_id: ctx.eventId, request_id: body.request_id, prospect_id: prospect.id },
      `tiktok.${logLabel}.sent`
    );
    return { sent: true, status: res.status, body };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: 'tiktok_events', event_name: eventName },
      extra: { prospect_id: prospect.id, event_id: ctx.eventId },
    });
    logger.error({ err: err.message, prospect_id: prospect.id }, `tiktok.${logLabel}.error`);
    return { sent: false, error: err.message };
  }
}

/**
 * Fire-and-forget TikTok Lead dispatch (form submit). Mirrors metaSendLeadEvent.
 */
export async function sendTikTokLeadEvent(prospect, ctx = {}, deps = {}) {
  return sendConversionEvent(prospect, ctx, { eventName: 'Lead' }, deps);
}

/**
 * Fire-and-forget TikTok CompleteRegistration dispatch (quiz result reveal),
 * deduped against the browser ttq CompleteRegistration via the registration id.
 */
export async function sendTikTokCompleteRegistrationEvent(prospect, ctx = {}, deps = {}) {
  return sendConversionEvent(prospect, ctx, { eventName: 'CompleteRegistration' }, deps);
}
