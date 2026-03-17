import crypto from 'crypto';
import { sequelize, Prospect, IdempotencyKey, User, Campaign } from '../models/index.js';
import ProspectActivity from '../models/ProspectActivity.js';
import { resolveAssignedAgentId } from './systemAgent.js';
import { dispatchEvent } from './webhookService.js';
import { sendLeadAssignmentEmail } from './mailer.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const IDEMPOTENCY_SCOPE = 'retell:call';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Default injectable dependencies — override in tests via makeRetellService(). */
const defaultDeps = {
  Prospect,
  IdempotencyKey,
  User,
  Campaign,
  ProspectActivity,
  sequelize,
  resolveAssignedAgentId,
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

    // Fallback: any [Retell] campaign matching this agent
    const allRetell = await d.Campaign.findAll({
      where: { is_active: true },
    });
    return allRetell.find(c => c.name?.startsWith('[Retell]')) || null;
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
    if (campaignId) {
      assignedAgentId = await d.resolveAssignedAgentId({
        reqUser: null,
        requestedAgentId: null,
        campaignId,
        qrTagId: null
      });
    }

    // ── Create prospect in a transaction (with idempotency key) ──
    const t = await d.sequelize.transaction();

    try {
      const prospect = await d.Prospect.create({
        firstName,
        lastName: lastName || null,
        email: `retell-${call_id}@calls.mktr.sg`,
        phone: to_number || null,
        leadSource: 'call_bot',
        leadStatus: 'new',
        priority,
        notes: noteLines.join('\n'),
        tags: ['retell', 'phone-call'],
        campaignId,
        assignedAgentId,
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
      d.dispatchEvent('lead.created', () => ({
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
          source: 'retell_webhook',
          campaign: campaign ? { externalId: campaign.id, name: campaign.name } : null
        }
      }));

      // ── Email notification (fire-and-forget) ──
      const notifyAgent = assignedAgentId
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

      return { status: 'created', prospectId: prospect.id };
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

    // Fetch from Retell API
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      throw new d.AppError('Retell API not configured', 503);
    }

    const response = await fetch(`https://api.retellai.com/v2/get-call/${meta.retellCallId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new d.AppError('Call not found in Retell', 404);
    }

    const call = await response.json();
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
