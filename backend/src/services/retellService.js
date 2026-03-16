import crypto from 'crypto';
import { sequelize, Prospect, IdempotencyKey, User, Campaign } from '../models/index.js';
import ProspectActivity from '../models/ProspectActivity.js';
import { resolveAssignedAgentId } from './systemAgent.js';
import { dispatchEvent } from './webhookService.js';
import { sendLeadAssignmentEmail } from './mailer.js';
import { logger } from '../utils/logger.js';

const IDEMPOTENCY_SCOPE = 'retell:call';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  // Fallback: if no v/d format, treat entire header as plain hex (for manual/test webhooks)
  if (!signature) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signatureHeader, 'hex')
      );
    } catch {
      return false;
    }
  }

  // Try multiple signing approaches to find what Retell uses
  const bodyStr = rawBody.toString();
  const candidates = [
    crypto.createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`).digest('hex'),
    crypto.createHmac('sha256', secret).update(bodyStr).digest('hex'),
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
    crypto.createHmac('sha256', secret).update(`${timestamp}${bodyStr}`).digest('hex'),
  ];

  for (const expected of candidates) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
        return true;
      }
    } catch { /* length mismatch */ }
  }

  logger.warn('[Retell] Signature mismatch debug', {
    receivedSig: signature?.substring(0, 20) + '...',
    candidates: candidates.map(c => c.substring(0, 20) + '...'),
    timestamp,
    bodyLen: rawBody.length,
    secretPrefix: secret.substring(0, 8) + '...'
  });

  return false;
}

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
        return await Campaign.findByPk(cid);
      }
    }
  }

  // DB lookup: find campaign by naming convention [Retell] {agent_name}
  if (retellAgentName) {
    const campaign = await Campaign.findOne({
      where: { name: `[Retell] ${retellAgentName}`, is_active: true }
    });
    if (campaign) return campaign;
  }

  // Fallback: any [Retell] campaign matching this agent
  const allRetell = await Campaign.findAll({
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
    agent_name,
    recording_url
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

  // ── Resolve campaign and agent assignment ──
  const campaign = await resolveRetellCampaign(agent_id, agent_name);
  const campaignId = campaign?.id || null;

  let assignedAgentId = null;
  if (campaignId) {
    assignedAgentId = await resolveAssignedAgentId({
      reqUser: null,
      requestedAgentId: null,
      campaignId,
      qrTagId: null
    });
  }

  // ── Create prospect in a transaction (with idempotency key) ──
  const t = await sequelize.transaction();

  try {
    const prospect = await Prospect.create({
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
      demographics: call_analysis.custom_analysis_data || {},
      sourceMetadata: {
        retellCallId: call_id,
        retellAgentId: agent_id,
        retellAgentName: agent_name,
        fromNumber: from_number,
        durationMs: duration_ms,
        disconnectionReason: disconnection_reason,
        sentiment: call_analysis.user_sentiment,
        callSuccessful: call_analysis.call_successful,
        recordingUrl: recording_url || null
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
        sentiment: call_analysis.user_sentiment,
        campaignName: campaign?.name || null
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
          leadSource: 'call_bot',
          tags: ['retell', 'phone-call'],
          notes: prospect.notes,
          sourceMetadata: prospect.sourceMetadata,
          createdAt: prospect.createdAt
        },
        source: 'retell_webhook',
        campaign: campaign ? { externalId: campaign.id, name: campaign.name } : null
      }
    }));

    // ── Email notification (fire-and-forget) ──
    const notifyAgent = assignedAgentId
      ? await User.findByPk(assignedAgentId)
      : await User.findOne({ where: { email: 'system@mktr.sg' } });

    if (notifyAgent) {
      const prospectWithCampaign = campaign
        ? Object.assign(prospect.toJSON(), { campaign: { id: campaign.id, name: campaign.name } })
        : prospect;
      sendLeadAssignmentEmail(notifyAgent, prospectWithCampaign).catch(err =>
        logger.warn('[Retell] Failed to send lead assignment email', { error: err.message })
      );
    }

    logger.info('[Retell] Prospect created from call', {
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
      logger.info('[Retell] Duplicate call_id caught by DB constraint', { call_id });
      return { status: 'duplicate', reason: 'db_constraint' };
    }

    throw err;
  }
}
