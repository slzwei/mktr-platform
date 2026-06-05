import crypto from 'crypto';
import { sequelize, Prospect, IdempotencyKey, User, Campaign } from '../models/index.js';
import ProspectActivity from '../models/ProspectActivity.js';
import { resolveAssignedAgentId, resolveLeadRouting } from './systemAgent.js';
import { chargeLeadCredit } from './leadCredits.js';
import { decideAssignment } from './leadQuota.js';
import { dispatchEvent } from './webhookService.js';
import { sendLeadAssignmentEmail } from './mailer.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';

const IDEMPOTENCY_SCOPE = 'retell:call';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Circuit breaker for Retell API calls (recording fetches)
const retellApiBreaker = new CircuitBreaker(
  async (url, headers) => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Retell API error: ${response.status}`);
    }
    return response.json();
  },
  { name: 'retell-api', failureThreshold: 5, resetTimeoutMs: 30_000 }
);

/** Default injectable dependencies — override in tests via makeRetellService(). */
const defaultDeps = {
  Prospect,
  IdempotencyKey,
  User,
  Campaign,
  ProspectActivity,
  sequelize,
  resolveAssignedAgentId,
  resolveLeadRouting,
  chargeLeadCredit,
  decideAssignment,
  dispatchEvent,
  sendLeadAssignmentEmail,
  AppError,
  logger,
};

/**
 * Verify the Retell webhook signature (HMAC-SHA256).
 * Retell sends: x-retell-signature: v=<timestamp>,d=<hmac_hex>
 * The HMAC is computed over: "<timestamp>.<raw_body>"
 *
 * @param {Buffer} rawBody - raw request body
 * @param {string} signatureHeader - value of x-retell-signature header
 * @returns {boolean}
 */
export function verifyRetellSignature(rawBody, signatureHeader) {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  // Parse "v=<timestamp>,d=<hex>" format
  const parts = {};
  for (const part of signatureHeader.split(',')) {
    const [key, ...rest] = part.split('=');
    parts[key.trim()] = rest.join('=').trim();
  }

  const timestamp = parts.v;
  const signature = parts.d;

  // Require v=<timestamp>,d=<hex> format — reject malformed signatures
  if (!signature || !timestamp) {
    return false;
  }

  // Reject replays older than 5 minutes
  const ts = Number(timestamp);
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return false;
  }

  // Retell docs: HMAC-SHA256 over "<timestamp>.<raw_body>" using API key
  const bodyStr = rawBody.toString();
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Factory that creates retellService functions with injectable dependencies.
 * Use overrides in tests to stub models, services, and the logger.
 *
 * @param {object} overrides - partial map of deps to replace
 * @returns {{ processRetellCall: Function, getRecordingUrl: Function }}
 */
export function makeRetellService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /**
   * Resolve MKTR campaign for a Retell agent.
   * Looks up by naming convention: "[Retell] {agent_name}" (auto-created at startup).
   * Falls back to env-based RETELL_CAMPAIGN_MAP override.
   */
  async function resolveRetellCampaign(retellAgentId, retellAgentName) {
    if (!retellAgentId) return null;

    // Check env-based mapping first (override)
    const campaignMap = process.env.RETELL_CAMPAIGN_MAP;
    if (campaignMap) {
      for (const pair of campaignMap.split(',').map(p => p.trim())) {
        const [rid, cid] = pair.split(':');
        if (rid === retellAgentId) {
          return await d.Campaign.findByPk(cid);
        }
      }
    }

    // DB lookup: find campaign by naming convention [Retell] {agent_name}
    if (retellAgentName) {
      const campaign = await d.Campaign.findOne({
        where: { name: `[Retell] ${retellAgentName}`, is_active: true }
      });
      if (campaign) return campaign;
    }

    // No match — log warning and return null rather than picking an arbitrary
    // [Retell] campaign, which could misattribute leads when multiple agents exist.
    logger.warn(
      { retellAgentId, retellAgentName },
      'No campaign found for Retell agent — lead will be created without campaign'
    );
    return null;
  }

  /**
   * Process a Retell post-call webhook payload.
   * Creates a Prospect if the call was successful and not already processed.
   *
   * @param {object} payload - parsed Retell webhook JSON
   * @returns {{ status: string, prospectId?: string }}
   */
  async function processRetellCall(payload) {
    const {
      call_id,
      call_status,
      call_analysis,
      retell_llm_dynamic_variables,
      to_number,
      from_number,
      transcript,
      duration_ms,
      disconnection_reason,
      agent_id,
      agent_name,
      recording_url
    } = payload;

    // ── Log incoming payload shape for debugging ──
    d.logger.info('[Retell] Processing call', {
      call_id,
      call_status,
      has_call_analysis: !!call_analysis,
      call_successful: call_analysis?.call_successful,
      call_successful_type: typeof call_analysis?.call_successful,
      agent_id,
      agent_name,
      to_number: to_number ? to_number.slice(0, 6) + '****' : 'N/A'
    });

    // ── Guard: only process ended calls ──
    // Accept 'ended' or missing status (some Retell versions omit it in post-call hooks)
    if (call_status && call_status !== 'ended') {
      d.logger.info('[Retell] Skipping non-ended call', { call_id, call_status });
      return { status: 'skipped', reason: 'call_not_ended' };
    }

    // ── Guard: skip calls explicitly marked unsuccessful ──
    // Treat missing call_analysis as successful (Retell may omit it).
    // Accept both boolean true and string "true" for call_successful.
    const callSuccessful = call_analysis?.call_successful;
    if (callSuccessful === false || callSuccessful === 'false') {
      d.logger.info('[Retell] Skipping unsuccessful call', { call_id, callSuccessful });
      return { status: 'skipped', reason: 'call_not_successful' };
    }

    // ── Idempotency check ──
    const existingKey = await d.IdempotencyKey.findOne({
      where: { key: call_id, scope: IDEMPOTENCY_SCOPE }
    });

    if (existingKey) {
      d.logger.info('[Retell] Duplicate webhook ignored', { call_id });
      return {
        status: 'duplicate',
        prospectId: existingKey.responseBody?.prospectId
      };
    }

    // ── Parse name from dynamic variables ──
    const rawName = retell_llm_dynamic_variables?.name || '';
    const nameParts = rawName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Retell Lead';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // ── Map Retell sentiment → lead priority ──
    const sentimentMap = {
      Positive: 'high',
      Neutral: 'medium',
      Negative: 'low'
    };
    const priority = sentimentMap[call_analysis?.user_sentiment] || 'medium';

    // ── Build notes from transcript + call metadata ──
    const noteLines = [
      `[Retell AI Call — ${new Date().toISOString()}]`,
      `Agent: ${agent_name || agent_id}`,
      `Duration: ${Math.round((duration_ms || 0) / 1000)}s`,
      `Sentiment: ${call_analysis?.user_sentiment || 'Unknown'}`,
      `Disconnect: ${disconnection_reason || 'Unknown'}`,
      '',
      '--- Call Summary ---',
      call_analysis?.call_summary || '(no summary)',
      '',
      '--- Transcript ---',
      transcript || '(no transcript)'
    ];

    // ── Resolve campaign and agent assignment ──
    const campaign = await resolveRetellCampaign(agent_id, agent_name);
    const campaignId = campaign?.id || null;

    let assignedAgentId = null;
    let routeVia = 'fallback';
    if (campaignId) {
      const routing = await d.resolveLeadRouting({
        reqUser: null,
        requestedAgentId: null,
        campaignId,
        qrTagId: null
      });
      assignedAgentId = routing.agentId;
      routeVia = routing.via;
    }

    // ── Create prospect in a transaction (with idempotency key) ──
    // Lead-quota gate: decideAssignment charges authoritatively for a funded gated
    // route, or quarantines (held) when no funded agent. Retell never best-effort
    // deducted, so soft campaigns stay deduct-free here.
    const t = await d.sequelize.transaction();
    let quarantined = false;

    try {
      const decision = await d.decideAssignment({
        campaign,
        routing: { agentId: assignedAgentId, via: routeVia },
        campaignId,
        transaction: t,
        charge: d.chargeLeadCredit,
      });
      quarantined = decision.action === 'quarantine';
      assignedAgentId = quarantined ? null : (decision.assignedAgentId ?? null);

      const prospect = await d.Prospect.create({
        firstName,
        lastName: lastName || null,
        email: null,
        phone: to_number || null,
        leadSource: 'call_bot',
        leadStatus: 'new',
        priority,
        notes: noteLines.join('\n'),
        tags: ['retell', 'phone-call'],
        campaignId,
        assignedAgentId,
        quarantinedAt: quarantined ? new Date() : null,
        quarantineReason: quarantined ? decision.quarantineReason : null,
        preferences: {
          contactMethod: 'phone',
          contactTime: '',
          language: 'en',
          timezone: 'Asia/Singapore'
        },
        demographics: call_analysis?.custom_analysis_data || {},
        sourceMetadata: {
          retellCallId: call_id,
          retellAgentId: agent_id,
          retellAgentName: agent_name,
          fromNumber: from_number,
          durationMs: duration_ms,
          disconnectionReason: disconnection_reason,
          sentiment: call_analysis?.user_sentiment,
          callSuccessful: call_analysis?.call_successful,
          recordingUrl: recording_url || null
        },
        retellCallId: call_id
      }, { transaction: t });

      // Audit trail
      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'created',
        description: `Lead created from Retell AI call (${agent_name || agent_id})`,
        metadata: {
          source: 'retell_webhook',
          callId: call_id,
          sentiment: call_analysis?.user_sentiment,
          campaignName: campaign?.name || null
        }
      }, { transaction: t });

      // Idempotency key (inside same transaction)
      await d.IdempotencyKey.create({
        key: call_id,
        scope: IDEMPOTENCY_SCOPE,
        responseBody: { prospectId: prospect.id },
        responseCode: 200,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS)
      }, { transaction: t });

      await t.commit();

      // ── Fire outgoing webhooks (post-commit, fire-and-forget) ──
      // Look up assigned agent for routing info
      let agentForWebhook = null;
      if (assignedAgentId) {
        const agentRecord = await d.User.findByPk(assignedAgentId, {
          attributes: ['id', 'lyfeId', 'phone', 'email', 'firstName', 'lastName'],
        });
        if (agentRecord) {
          agentForWebhook = {
            phone: agentRecord.phone || null,
            email: agentRecord.email || null,
            name: `${agentRecord.firstName || ''} ${agentRecord.lastName || ''}`.trim(),
            id: agentRecord.lyfeId || agentRecord.id,
          };
        }
      }

      // Suppress the Lyfe delivery webhook for quarantined (held) leads.
      if (!quarantined) d.dispatchEvent('lead.created', () => ({
        event: 'lead.created',
        timestamp: new Date().toISOString(),
        data: {
          lead: {
            externalId: prospect.id,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            phone: prospect.phone,
            email: prospect.email,
            leadSource: 'call_bot',
            tags: ['retell', 'phone-call'],
            notes: prospect.notes,
            sourceMetadata: prospect.sourceMetadata,
            recordingUrl: recording_url || null,
            transcript: prospect.notes,
            createdAt: prospect.createdAt
          },
          routing: {
            mode: 'retell_round_robin',
            agentPhone: agentForWebhook?.phone || null,
            agentEmail: agentForWebhook?.email || null,
            agentName: agentForWebhook?.name || null,
            agentExternalId: agentForWebhook?.id || assignedAgentId || null,
          },
          source: 'retell_webhook',
          campaign: campaign ? { externalId: campaign.id, name: campaign.name } : null
        }
      }));

      // ── Email notification (fire-and-forget) ──
      const notifyAgent = quarantined
        ? null
        : assignedAgentId
          ? await d.User.findByPk(assignedAgentId)
          : await d.User.findOne({ where: { email: 'system@mktr.sg' } });

      if (notifyAgent) {
        const prospectWithCampaign = campaign
          ? Object.assign(prospect.toJSON(), { campaign: { id: campaign.id, name: campaign.name } })
          : prospect;
        d.sendLeadAssignmentEmail(notifyAgent, prospectWithCampaign).catch(err =>
          d.logger.warn('[Retell] Failed to send lead assignment email', { error: err.message })
        );
      }

      d.logger.info('[Retell] Prospect created from call', {
        call_id,
        prospectId: prospect.id,
        campaignId,
        assignedAgentId,
        phone: to_number ? to_number.slice(0, 6) + '****' : 'N/A'
      });

      return { status: quarantined ? 'quarantined' : 'created', prospectId: prospect.id };
    } catch (err) {
      await t.rollback();

      // If it's a unique constraint on retellCallId, treat as duplicate
      if (err.name === 'SequelizeUniqueConstraintError' && err.fields?.retellCallId) {
        d.logger.info('[Retell] Duplicate call_id caught by DB constraint', { call_id });
        return { status: 'duplicate', reason: 'db_constraint' };
      }

      throw err;
    }
  }

  /**
   * Get the Retell call recording URL for a prospect.
   * Checks sourceMetadata first, then fetches from Retell API and caches the result.
   *
   * @param {string} prospectId
   * @returns {{ recordingUrl: string|null }}
   */
  async function getRecordingUrl(prospectId) {
    const prospect = await d.Prospect.findByPk(prospectId);
    if (!prospect) {
      throw new d.AppError('Prospect not found', 404);
    }

    const meta = prospect.sourceMetadata || {};
    if (!meta.retellCallId) {
      throw new d.AppError('Not a Retell prospect', 404);
    }

    // Return stored URL if available
    if (meta.recordingUrl) {
      return { recordingUrl: meta.recordingUrl };
    }

    // Fetch from Retell API (via circuit breaker)
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      throw new d.AppError('Retell API not configured', 503);
    }

    let call;
    try {
      call = await retellApiBreaker.fire(
        `https://api.retellai.com/v2/get-call/${meta.retellCallId}`,
        { Authorization: `Bearer ${apiKey}` }
      );
    } catch (err) {
      if (err.message.includes('Circuit breaker')) {
        throw new d.AppError('Retell API temporarily unavailable', 503);
      }
      throw new d.AppError('Call not found in Retell', 404);
    }

    const recordingUrl = call.recording_url || null;

    // Cache it in sourceMetadata for next time
    if (recordingUrl) {
      await prospect.update({
        sourceMetadata: { ...meta, recordingUrl }
      });
    }

    return { recordingUrl };
  }

  return { processRetellCall, getRecordingUrl };
}

// ── Backward-compatible default-wired exports ──
const _default = makeRetellService();
export const processRetellCall = _default.processRetellCall;
export const getRecordingUrl = _default.getRecordingUrl;
