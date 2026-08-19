import * as Sentry from '@sentry/node';
import { hashEmail, hashPhone, hashExternalId, hashName, hashCountry } from '../utils/piiHashing.js';
import { logger } from '../utils/logger.js';

const META_GRAPH_VERSION = 'v21.0';

/**
 * Guard: which prospects are eligible for CAPI dispatch?
 *
 * Excludes:
 *   - Master switch off
 *   - Missing access token (the pixel id is resolved LATE in
 *     sendConversionEvent — ctx.pixelIdOverride || META_PIXEL_ID — so a
 *     per-campaign pixel can fire even when the env id is unset, mirroring
 *     tiktokEventsService)
 *   - Retell-source prospects (no ad-attribution chain)
 *   - Meta Lead Ads-source prospects (originated inside Meta; CAPI here would double-count)
 *
 * The leadSource check + retellCallId + metaLeadgenId combo is defence-in-depth:
 * the wiring only happens at the web-form code path, but the guard runs anyway
 * in case future code paths route Retell or Meta prospects through prospectService.
 *
 * Identical eligibility for every event_name we send (Lead, CompleteRegistration):
 * the prospect's origin is what gates dispatch, not which funnel event fired.
 */
export function shouldFireCapi(prospect) {
  if (process.env.META_CAPI_ENABLED !== 'true') return false;
  if (!process.env.META_CAPI_ACCESS_TOKEN) return false;
  if (!prospect) return false;
  if (prospect.leadSource === 'call_bot') return false;
  if (prospect.retellCallId) return false;
  if (prospect.sourceMetadata?.metaLeadgenId) return false;
  return true;
}

/**
 * Builds the CAPI events payload. Exported for testing.
 *
 * The event_name defaults to 'Lead' (the original behaviour) and is overridable
 * via options.eventName so the quiz funnel can dispatch a 'CompleteRegistration'
 * at the result reveal. The event_id always comes from ctx.eventId — callers pass
 * the SAME id the browser Pixel fired with so Meta deduplicates Pixel↔CAPI.
 *
 * PII consent rule (3sites — ledger-based):
 *   - hashed em/ph/fn/ln/country are included only when ctx.marketingConsent
 *     === true. The CALLER derives that flag from the consent ledger
 *     (canMarketTo with the prospect's campaignId) at dispatch time; this
 *     builder no longer reads the frozen sourceMetadata.consent_contact
 *     boolean. Absent flag → none of them — FAIL CLOSED.
 *   - fbp/fbc/ip/ua/external_id are always included regardless of marketing consent
 *     (they identify the browser/session, not the person's contact info)
 */
export function _buildPayload(prospect, ctx, options) {
  const meta = prospect.sourceMetadata || {};
  const marketingConsent = ctx?.marketingConsent === true;
  const eventName = options?.eventName || 'Lead';
  // Where the conversion action happened. Submit-time and down-funnel events
  // are 'website'; voucher redemption at a partner counter is 'physical_store'.
  const actionSource = ctx.actionSource || 'website';

  const userData = {
    fbp: ctx.fbp || meta.fbp,
    fbc: ctx.fbc || meta.fbc,
    client_ip_address: ctx.clientIp || meta.clientIp,
    client_user_agent: ctx.clientUserAgent || meta.clientUserAgent,
    external_id: hashExternalId(prospect.id),
  };

  if (marketingConsent) {
    userData.em = hashEmail(prospect.email);
    userData.ph = hashPhone(prospect.phone);
    // EMQ enrichment — same consent gate as em/ph (they identify the person).
    // Country is constant: the funnel is Singapore-only.
    userData.fn = hashName(prospect.firstName);
    userData.ln = hashName(prospect.lastName);
    userData.country = hashCountry('sg');
  }

  // Strip undefined/null/empty so we don't send placeholder hashes
  const cleanUserData = Object.fromEntries(
    Object.entries(userData).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );

  const event = {
    event_name: eventName,
    // Delayed down-funnel events (QualifiedLead/ClosedWon, fired when a Lyfe
    // agent advances the lead days later) back-date event_time to when the
    // status changed. Meta accepts event_time up to 7 days old. Submit-time
    // events (Lead/CompleteRegistration) omit ctx.eventTime → now.
    event_time: ctx.eventTime || Math.floor(Date.now() / 1000),
    event_id: ctx.eventId,
    action_source: actionSource,
    // A non-website event (physical_store redemption) must not carry the
    // months-old landing URL captured at signup — omit it entirely.
    event_source_url:
      actionSource === 'website' ? ctx.eventSourceUrl || meta.eventSourceUrl || undefined : undefined,
    user_data: cleanUserData,
    custom_data: {
      // Redemption events scope to the ACTIVATION's campaign, which manual
      // issuance allows to differ from the prospect's signup campaign.
      campaign_id: ctx.campaignIdOverride || prospect.campaignId,
      lead_source: prospect.leadSource,
    },
  };

  // Strip top-level undefined fields too
  Object.keys(event).forEach((k) => {
    if (event[k] === undefined) delete event[k];
  });

  return {
    data: [event],
    ...(options?.testEventCode ? { test_event_code: options.testEventCode } : {}),
  };
}

/**
 * Fire-and-forget CAPI conversion dispatch (generic over event_name).
 *
 * Never throws to the caller. Errors land in Sentry + structured logs.
 *
 * @param {object} prospect           Sequelize prospect instance (or plain object with same shape)
 * @param {object} ctx                Request context: { eventId, fbp, fbc, clientIp, clientUserAgent, eventSourceUrl, pixelIdOverride, eventTime, marketingConsent, actionSource, campaignIdOverride }
 * @param {object} [options]          { eventName }  — defaults to 'Lead'
 * @param {object} [deps]             Injected dependencies for testing: { fetch }
 * @returns {Promise<object>}         { sent: boolean, ...details }
 */
export async function sendConversionEvent(prospect, ctx = {}, options = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const eventName = options.eventName || 'Lead';
  // Stable log label per event (e.g. capi.lead.sent, capi.complete_registration.sent)
  const logLabel = eventName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

  if (!shouldFireCapi(prospect)) {
    return { sent: false, reason: 'guarded' };
  }

  // Late pixel-id resolution (mirrors tiktokEventsService): a per-campaign
  // override can fire even when the env id is unset; bail only if neither.
  const pixelId = ctx.pixelIdOverride || process.env.META_PIXEL_ID;
  if (!pixelId) {
    return { sent: false, reason: 'no_pixel_id' };
  }
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const testEventCode = process.env.META_TEST_EVENT_CODE || undefined;

  const payload = _buildPayload(prospect, ctx, { testEventCode, eventName });
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      // suppressSentry: the platform-delivery ledger classifies failures and
      // alerts once per row itself — its retries must not multiply captures.
      // Default off: every legacy caller keeps per-attempt captures.
      if (!options.suppressSentry) {
        Sentry.captureException(new Error(`CAPI dispatch failed: HTTP ${res.status}`), {
          tags: { source: 'capi', event_name: eventName },
          extra: { status: res.status, body, prospect_id: prospect.id },
        });
      }
      logger.warn(
        { status: res.status, body, prospect_id: prospect.id, event_id: ctx.eventId },
        `capi.${logLabel}.failed`
      );
      return { sent: false, status: res.status, body };
    }

    logger.info(
      {
        event_id: ctx.eventId,
        events_received: body.events_received,
        fbtrace_id: body.fbtrace_id,
        prospect_id: prospect.id,
      },
      `capi.${logLabel}.sent`
    );
    return { sent: true, status: res.status, body };
  } catch (err) {
    if (!options.suppressSentry) {
      Sentry.captureException(err, {
        tags: { source: 'capi', event_name: eventName },
        extra: { prospect_id: prospect.id, event_id: ctx.eventId },
      });
    }
    logger.error({ err: err.message, prospect_id: prospect.id }, `capi.${logLabel}.error`);
    return { sent: false, error: err.message };
  }
}

/**
 * Fire-and-forget CAPI Lead dispatch (form submit / conversion).
 * Thin wrapper over sendConversionEvent preserving the original signature.
 */
export async function sendLeadEvent(prospect, ctx = {}, deps = {}) {
  return sendConversionEvent(prospect, ctx, { eventName: 'Lead' }, deps);
}

/**
 * Fire-and-forget CAPI CompleteRegistration dispatch (quiz result reveal).
 *
 * Fired server-side at submit time using the registrationEventId the browser
 * Pixel fired with at the reveal, so Meta deduplicates the Pixel↔CAPI pair. The
 * strongest mid-funnel optimisation signal for paid social.
 */
export async function sendCompleteRegistrationEvent(prospect, ctx = {}, deps = {}) {
  return sendConversionEvent(prospect, ctx, { eventName: 'CompleteRegistration' }, deps);
}
