import crypto from 'crypto';
import { sequelize, Prospect, IdempotencyKey } from '../models/index.js';
import ProspectActivity from '../models/ProspectActivity.js';
import { dispatchEvent } from './webhookService.js';
import { logger } from '../utils/logger.js';

const IDEMPOTENCY_SCOPE = 'retell:call';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verify the Retell webhook signature (HMAC-SHA256).
 * @param {Buffer} rawBody - raw request body
 * @param {string} signature - value of x-retell-signature header
 * @returns {boolean}
 */
export function verifyRetellSignature(rawBody, signature) {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Process a Retell post-call webhook payload.
 * Creates a Prospect if the call was successful and not already processed.
 *
 * @param {object} payload - parsed Retell webhook JSON
 * @returns {{ status: string, prospectId?: string }}
 */
export async function processRetellCall(payload) {
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
    agent_name
  } = payload;

  // ── Guard: only process successful, ended calls ──
  if (call_status !== 'ended') {
    return { status: 'skipped', reason: 'call_not_ended' };
  }

  if (!call_analysis?.call_successful) {
    return { status: 'skipped', reason: 'call_not_successful' };
  }

  // ── Idempotency check ──
  const existingKey = await IdempotencyKey.findOne({
    where: { key: call_id, scope: IDEMPOTENCY_SCOPE }
  });

  if (existingKey) {
    logger.info('[Retell] Duplicate webhook ignored', { call_id });
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
  const priority = sentimentMap[call_analysis.user_sentiment] || 'medium';

  // ── Build notes from transcript + call metadata ──
  const noteLines = [
    `[Retell AI Call — ${new Date().toISOString()}]`,
    `Agent: ${agent_name || agent_id}`,
    `Duration: ${Math.round((duration_ms || 0) / 1000)}s`,
    `Sentiment: ${call_analysis.user_sentiment || 'Unknown'}`,
    `Disconnect: ${disconnection_reason || 'Unknown'}`,
    '',
    '--- Call Summary ---',
    call_analysis.call_summary || '(no summary)',
    '',
    '--- Transcript ---',
    transcript || '(no transcript)'
  ];

  // ── Campaign mapping (from env: RETELL_CAMPAIGN_MAP=agentId:campaignUUID,…) ──
  let campaignId = null;
  const campaignMap = process.env.RETELL_CAMPAIGN_MAP;
  if (campaignMap && agent_id) {
    const pairs = campaignMap.split(',').map(p => p.trim());
    for (const pair of pairs) {
      const [retellAgentId, mktrCampaignId] = pair.split(':');
      if (retellAgentId === agent_id) {
        campaignId = mktrCampaignId;
        break;
      }
    }
  }

  // ── Create prospect in a transaction (with idempotency key) ──
  const t = await sequelize.transaction();

  try {
    const prospect = await Prospect.create({
      firstName,
      lastName: lastName || null,
      email: `retell-${call_id}@calls.mktr.sg`,
      phone: to_number || null,
      leadSource: 'direct',
      leadStatus: 'contacted',
      priority,
      notes: noteLines.join('\n'),
      tags: ['retell', 'phone-call'],
      campaignId,
      preferences: {
        contactMethod: 'phone',
        contactTime: '',
        language: 'en',
        timezone: 'Asia/Singapore'
      },
      demographics: call_analysis.custom_analysis_data || {},
      sourceMetadata: {
        retellCallId: call_id,
        retellAgentId: agent_id,
        retellAgentName: agent_name,
        fromNumber: from_number,
        durationMs: duration_ms,
        disconnectionReason: disconnection_reason,
        sentiment: call_analysis.user_sentiment,
        callSuccessful: call_analysis.call_successful
      },
      retellCallId: call_id
    }, { transaction: t });

    // Audit trail
    await ProspectActivity.create({
      prospectId: prospect.id,
      type: 'created',
      description: `Lead created from Retell AI call (${agent_name || agent_id})`,
      metadata: {
        source: 'retell_webhook',
        callId: call_id,
        sentiment: call_analysis.user_sentiment
      }
    }, { transaction: t });

    // Idempotency key (inside same transaction)
    await IdempotencyKey.create({
      key: call_id,
      scope: IDEMPOTENCY_SCOPE,
      responseBody: { prospectId: prospect.id },
      responseCode: 200,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS)
    }, { transaction: t });

    await t.commit();

    // ── Fire outgoing webhooks (post-commit, fire-and-forget) ──
    dispatchEvent('lead.created', () => ({
      event: 'lead.created',
      timestamp: new Date().toISOString(),
      data: {
        lead: {
          externalId: prospect.id,
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          phone: prospect.phone,
          email: prospect.email,
          leadSource: 'direct',
          tags: ['retell', 'phone-call'],
          notes: prospect.notes,
          sourceMetadata: prospect.sourceMetadata,
          createdAt: prospect.createdAt
        },
        source: 'retell_webhook',
        campaign: campaignId ? { externalId: campaignId } : null
      }
    }));

    logger.info('[Retell] Prospect created from call', {
      call_id,
      prospectId: prospect.id,
      phone: to_number ? to_number.slice(0, 6) + '****' : 'N/A'
    });

    return { status: 'created', prospectId: prospect.id };
  } catch (err) {
    await t.rollback();

    // If it's a unique constraint on retellCallId, treat as duplicate
    if (err.name === 'SequelizeUniqueConstraintError' && err.fields?.retellCallId) {
      logger.info('[Retell] Duplicate call_id caught by DB constraint', { call_id });
      return { status: 'duplicate', reason: 'db_constraint' };
    }

    throw err;
  }
}
