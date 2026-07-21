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
import { destinationForAgent, externalIdForDestination, buildLeadHeldPayload, normalizePhone } from './prospectHelpers.js';
import { resolveConsumerForCaptureTx } from './consumerService.js';

const IDEMPOTENCY_SCOPE = 'meta:lead';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const GRAPH_API_VERSION = 'v21.0';

/** Default injectable dependencies — override in tests via makeMetaLeadService(). */
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
  fetch: globalThis.fetch,
  resolveConsumerForCaptureTx,
  normalizePhone,
};

/**
 * Verify Meta webhook signature (X-Hub-Signature-256).
 * HMAC-SHA256 of raw body using META_APP_SECRET.
 *
 * @param {Buffer} rawBody - raw request body
 * @param {string} signatureHeader - value of x-hub-signature-256 header
 * @returns {boolean}
 */
export function verifyMetaSignature(rawBody, signatureHeader) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader) return false;

  // Format: "sha256=<hex>"
  const [algo, signature] = signatureHeader.split('=');
  if (algo !== 'sha256' || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Factory that creates metaLeadService functions with injectable dependencies.
 *
 * @param {object} overrides - partial map of deps to replace
 * @returns {{ processMetaLead: Function }}
 */
export function makeMetaLeadService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /**
   * Resolve MKTR campaign for Meta leads.
   * Looks up by naming convention: "[Meta] {formName}" or falls back to any active [Meta] campaign.
   */
  async function resolveMetaCampaign(formName) {
    // DB lookup: find campaign by naming convention [Meta] {formName}
    if (formName) {
      const campaign = await d.Campaign.findOne({
        where: { name: `[Meta] ${formName}`, is_active: true }
      });
      if (campaign) return campaign;
    }

    // Fallback: any active [Meta] campaign
    const { Op } = await import('sequelize');
    const fallback = await d.Campaign.findOne({
      where: { name: { [Op.like]: '[Meta]%' }, is_active: true }
    });
    if (fallback) return fallback;

    d.logger.warn({ formName }, 'No campaign found for Meta lead — lead will be created without campaign');
    return null;
  }

  /**
   * Fetch lead fields from Meta Graph API.
   *
   * @param {string} leadgenId - Meta leadgen ID
   * @returns {object|null} - { field_data, form_id, page_id, ... } or null on failure
   */
  async function fetchLeadFromGraphAPI(leadgenId) {
    const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
    if (!accessToken) {
      d.logger.error('[Meta] META_PAGE_ACCESS_TOKEN not configured');
      return null;
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}`;
    try {
      const response = await d.fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.text();
        d.logger.error('[Meta] Graph API error', {
          leadgenId,
          status: response.status,
          body: body.slice(0, 500)
        });
        return null;
      }
      return await response.json();
    } catch (err) {
      d.logger.error('[Meta] Graph API fetch failed', { leadgenId, error: err.message });
      return null;
    }
  }

  /**
   * Parse Meta lead field_data into normalized fields.
   * field_data is an array of { name, values } objects.
   */
  function parseFieldData(fieldData) {
    const fields = {};
    for (const { name, values } of (fieldData || [])) {
      fields[name.toLowerCase()] = values?.[0] || '';
    }

    // Parse name — Meta typically provides full_name, first_name, last_name
    let firstName = fields.first_name || '';
    let lastName = fields.last_name || '';
    if (!firstName && fields.full_name) {
      const parts = fields.full_name.trim().split(/\s+/);
      firstName = parts[0] || 'Meta Lead';
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    }
    if (!firstName) firstName = 'Meta Lead';

    return {
      firstName,
      lastName: lastName || null,
      email: fields.email || null,
      phone: fields.phone_number || fields.phone || null,
      company: fields.company_name || fields.company || null,
      jobTitle: fields.job_title || null,
      city: fields.city || null,
      // Preserve all raw fields for sourceMetadata
      rawFields: fields,
    };
  }

  /**
   * Process a single Meta leadgen event.
   * Fetches lead data from Graph API, creates Prospect with idempotency.
   *
   * @param {string} leadgenId - Meta leadgen ID
   * @param {string} pageId - Meta page ID
   * @param {string} formId - Meta form ID (optional)
   * @param {number} createdTime - Unix timestamp of lead creation
   * @returns {{ status: string, prospectId?: string }}
   */
  async function processMetaLead(leadgenId, pageId, formId, createdTime) {
    d.logger.info('[Meta] Processing lead', { leadgenId, pageId, formId });

    // ── Idempotency check ──
    const existingKey = await d.IdempotencyKey.findOne({
      where: { key: leadgenId, scope: IDEMPOTENCY_SCOPE }
    });

    if (existingKey) {
      d.logger.info('[Meta] Duplicate lead ignored', { leadgenId });
      return {
        status: 'duplicate',
        prospectId: existingKey.responseBody?.prospectId
      };
    }

    // ── Fetch lead data from Graph API ──
    const leadData = await fetchLeadFromGraphAPI(leadgenId);
    if (!leadData) {
      d.logger.error('[Meta] Could not fetch lead data, skipping', { leadgenId });
      return { status: 'skipped', reason: 'graph_api_error' };
    }

    // ── Parse fields ──
    const parsed = parseFieldData(leadData.field_data);

    // ── Build notes ──
    const noteLines = [
      `[Meta Lead Ad — ${new Date(createdTime * 1000).toISOString()}]`,
      `Page ID: ${pageId}`,
      `Form ID: ${formId || 'N/A'}`,
      '',
      '--- Lead Fields ---',
      ...Object.entries(parsed.rawFields).map(([k, v]) => `${k}: ${v}`),
    ];

    // ── Resolve campaign and agent assignment ──
    const campaign = await resolveMetaCampaign(leadData.form_name || null);
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
    // route, or quarantines (held) when no funded agent. Meta never best-effort
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

      // Consumer spine (plan §2.3): link by NORMALIZED phone as the matching
      // key. Storage is untouched — and in practice already E.164: the
      // Prospect model VALIDATES E.164 at create, so a loosely-formatted Meta
      // phone fails the whole create (pre-existing behavior); normalizePhone
      // here just guards spaced/local variants for the link. Meta identities
      // are UNVERIFIED (no OTP): they link for visibility but can never mint
      // marketing authority. Savepoint-isolated; any failure ⇒ null (the
      // reconciler heals).
      const consumerId = parsed.phone
        ? await d.resolveConsumerForCaptureTx(t, {
            phone: d.normalizePhone(parsed.phone),
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            email: parsed.email,
            verified: false,
          })
        : null;

      const prospect = await d.Prospect.create({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        email: parsed.email,
        phone: parsed.phone,
        consumerId,
        company: parsed.company,
        jobTitle: parsed.jobTitle,
        leadSource: 'social_media',
        leadStatus: 'new',
        priority: 'medium',
        notes: noteLines.join('\n'),
        tags: ['meta', 'lead-ad'],
        campaignId,
        assignedAgentId,
        quarantinedAt: quarantined ? new Date() : null,
        quarantineReason: quarantined ? decision.quarantineReason : null,
        preferences: {
          contactMethod: parsed.email ? 'email' : 'phone',
          contactTime: '',
          language: 'en',
          timezone: 'Asia/Singapore'
        },
        demographics: {},
        location: parsed.city ? { city: parsed.city } : {},
        sourceMetadata: {
          metaLeadgenId: leadgenId,
          metaPageId: pageId,
          metaFormId: formId || null,
          metaFormName: leadData.form_name || null,
          metaCreatedTime: createdTime,
          metaPlatform: leadData.platform || null,
          rawFields: parsed.rawFields,
        }
      }, { transaction: t });

      // Audit trail
      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'created',
        description: `Lead created from Meta Lead Ad (form: ${leadData.form_name || formId || 'unknown'})`,
        metadata: {
          source: 'meta_webhook',
          leadgenId,
          pageId,
          formId,
          campaignName: campaign?.name || null
        }
      }, { transaction: t });

      // Idempotency key (inside same transaction)
      await d.IdempotencyKey.create({
        key: leadgenId,
        scope: IDEMPOTENCY_SCOPE,
        responseBody: { prospectId: prospect.id },
        responseCode: 200,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS)
      }, { transaction: t });

      await t.commit();

      // ── Fire outgoing webhooks (post-commit, fire-and-forget) ──
      let agentForWebhook = null;
      let metaDestination = null;
      if (assignedAgentId) {
        const agentRecord = await d.User.findByPk(assignedAgentId, {
          attributes: ['id', 'lyfeId', 'mktrLeadsId', 'phone', 'email', 'firstName', 'lastName'],
        });
        if (agentRecord) {
          metaDestination = destinationForAgent(agentRecord);
          agentForWebhook = {
            phone: agentRecord.phone || null,
            email: agentRecord.email || null,
            name: `${agentRecord.firstName || ''} ${agentRecord.lastName || ''}`.trim(),
            id: externalIdForDestination(agentRecord, metaDestination),
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
            leadSource: 'social_media',
            tags: ['meta', 'lead-ad'],
            notes: prospect.notes,
            sourceMetadata: prospect.sourceMetadata,
            createdAt: prospect.createdAt
          },
          routing: {
            mode: 'meta_round_robin',
            agentPhone: agentForWebhook?.phone || null,
            agentEmail: agentForWebhook?.email || null,
            agentName: agentForWebhook?.name || null,
            agentExternalId: agentForWebhook?.id || assignedAgentId || null,
          },
          source: 'meta_webhook',
          campaign: campaign ? { externalId: campaign.id, name: campaign.name } : null
        }
      }), { destination: metaDestination });
      // Suppressed-person new-lead propagation rides the webhookService
      // flush-time catchup (tracker "propagate").

      // Held → ping the mktr-leads admin held queue so a pending lead is never silent.
      // Explicitly require no_funded_agent (the only reason that lands in that queue) so
      // a future decideAssignment reason can never leak the wrong hold. Gated by
      // HELD_LEAD_PING_ENABLED; the sweep is the completeness net.
      if (quarantined && decision.quarantineReason === 'no_funded_agent' && String(process.env.HELD_LEAD_PING_ENABLED || 'false').toLowerCase() === 'true') {
        d.dispatchEvent('lead.held', () => buildLeadHeldPayload(prospect, campaign, decision.quarantineReason), {
          destination: 'mktr_leads',
        }).catch((err) => d.logger.error('[Webhook] lead.held dispatch error', { error: err?.message || String(err) }));
      }

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
          d.logger.warn('[Meta] Failed to send lead assignment email', { error: err.message })
        );
      }

      d.logger.info('[Meta] Prospect created from lead ad', {
        leadgenId,
        prospectId: prospect.id,
        campaignId,
        assignedAgentId,
      });

      return { status: quarantined ? 'quarantined' : 'created', prospectId: prospect.id };
    } catch (err) {
      await t.rollback();

      // Unique constraint → treat as duplicate
      if (err.name === 'SequelizeUniqueConstraintError') {
        d.logger.info('[Meta] Duplicate leadgen_id caught by DB constraint', { leadgenId });
        return { status: 'duplicate', reason: 'db_constraint' };
      }

      throw err;
    }
  }

  return { processMetaLead, fetchLeadFromGraphAPI, parseFieldData, resolveMetaCampaign };
}

// ── Backward-compatible default-wired exports ──
const _default = makeMetaLeadService();
export const processMetaLead = _default.processMetaLead;
