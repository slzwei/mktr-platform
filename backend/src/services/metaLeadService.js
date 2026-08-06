import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize, Prospect, ProspectActivity, Campaign, QrTag, User,
  MetaPage, MetaFormMapping, MetaLeadgenEvent,
} from '../models/index.js';
import { resolveLeadRouting } from './systemAgent.js';
import { chargeLeadCredit } from './leadCredits.js';
import { decideAssignment } from './leadQuota.js';
import { dncCaptureGate, gateHeldDncLead, bakeHoldTargetAgentId } from './dncGate.js';
import { dncEnforcement, formatDncNumber, checkAndRecord as dncCheckAndRecord } from './dncService.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';
import { resolveConsumerForCaptureTx } from './consumerService.js';
import { recordCaptureConsentEventsTx } from './consentService.js';
import { persistEventDeliveries, flushDeliveries } from './webhookService.js';
import {
  normalizePhone, destinationForAgent, externalIdForDestination,
  buildLeadCreatedPayload, buildLeadHeldPayload,
} from './prospectHelpers.js';
import { sendLeadAssignmentEmail } from './mailer.js';
import { resolvePageAccessToken } from './metaPageTokens.js';
import { META_LEADGEN_CONSENT_VERSION } from './contactConsent.js';
import { logger } from '../utils/logger.js';

/**
 * Meta Lead Ads native ingestion (docs/plans/meta-lead-ads-native-pipe.md).
 *
 * retellService twin: a server-side source composing the shared primitives
 * directly — the web funnel's createProspect gates (410/409/draw/OTP) would
 * throw away webhook leads. Flow: durable inbox row (webhook) → worker
 * (this file) → Graph fetch → sanitize → mapping/deliverability → single
 * transaction (prospect + activity + consent ledger + outbound delivery
 * intent + inbox completion) → post-commit flush/DNC/email.
 */

const META_UNMAPPED_SLUG = 'meta-unmapped';
const GRAPH_FIELDS = 'field_data,form_id,ad_id,adset_id,campaign_id,platform,is_organic,created_time,custom_disclaimer_responses';
const CONSENT_FIELD_KEY = 'mktr_pdpa_consent';
const MAX_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const AFFIRMATIVE = new Set(['yes', 'true', 'agree', 'agreed', 'checked', 'accept', 'accepted', '1', 'on']);
const E164_RE = /^\+[1-9]\d{9,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function graphVersion() {
  return process.env.META_GRAPH_API_VERSION || 'v23.0';
}

/** Strip anything token-shaped before an error message is persisted/logged. */
export function redactMetaError(message) {
  return String(message || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer REDACTED')
    .slice(0, 500);
}

/** X-Hub-Signature-256: HMAC-SHA256 of the raw body with META_APP_SECRET. */
export function verifyMetaSignature(rawBody, signatureHeader) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader || !rawBody) return false;
  const [algo, signature] = String(signatureHeader).split('=');
  if (algo !== 'sha256' || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

const clamp = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

// Boot latch (codex round-2 F1): the server shell deliberately keeps already-
// mounted routes serving when init fails partway ("listening to allow log
// access"), so a failed bootstrap could otherwise leave the webhook 200-ing
// intake with no worker ever started. The controller refuses intake (503 —
// Meta redelivers) until bootstrap arms the subsystem.
let metaLeadAdsArmed = false;
export function armMetaLeadAds() { metaLeadAdsArmed = true; }
export function isMetaLeadAdsArmed() { return metaLeadAdsArmed; }
/** Test-only: module state must be resettable across controller test cases. */
export function disarmMetaLeadAdsForTests() { metaLeadAdsArmed = false; }

class RetryableMetaError extends Error {
  constructor(message) {
    super(message);
    this.retryable = true;
  }
}

export function makeMetaLeadService(overrides = {}) {
  const d = {
    sequelize, Prospect, ProspectActivity, Campaign, QrTag, User,
    MetaPage, MetaFormMapping, MetaLeadgenEvent,
    resolveLeadRouting, chargeLeadCredit, decideAssignment,
    dncCaptureGate, gateHeldDncLead, bakeHoldTargetAgentId,
    dncEnforcement, formatDncNumber, dncCheckAndRecord,
    readLegacyViewSafe, resolveConsumerForCaptureTx, recordCaptureConsentEventsTx,
    persistEventDeliveries, flushDeliveries,
    normalizePhone, destinationForAgent, externalIdForDestination,
    buildLeadCreatedPayload, buildLeadHeldPayload,
    sendLeadAssignmentEmail, resolvePageAccessToken,
    fetch: (...args) => globalThis.fetch(...args),
    logger,
    ...overrides,
  };

  /** Webhook side: upsert inbox rows, nothing else. Returns accepted count. */
  async function enqueueLeadgenChanges(changes) {
    let accepted = 0;
    for (const change of changes) {
      const { leadgen_id, page_id, form_id, created_time } = change || {};
      if (!leadgen_id) continue;
      try {
        const [, created] = await d.MetaLeadgenEvent.findOrCreate({
          where: { leadgenId: String(leadgen_id) },
          defaults: {
            pageId: page_id ? String(page_id) : null,
            formId: form_id ? String(form_id) : null,
            createdTime: created_time || null,
          },
        });
        if (created) accepted += 1;
      } catch (err) {
        // findOrCreate race on the unique index = a concurrent redelivery won.
        if (err?.name !== 'SequelizeUniqueConstraintError') throw err;
      }
    }
    return accepted;
  }

  async function fetchLeadFromGraph(leadgenId, accessToken) {
    const url = `https://graph.facebook.com/${graphVersion()}/${leadgenId}?fields=${GRAPH_FIELDS}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // Body consumption stays INSIDE the abort window — Meta can send headers
    // in time and then stall the body forever, which would wedge the whole
    // drain loop behind an unresolvable json() (codex round-2 F3).
    try {
      let response;
      try {
        response = await d.fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
      } catch (err) {
        throw new RetryableMetaError(`Graph fetch failed: ${err.message}`);
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch (err) {
          throw new RetryableMetaError(`Graph body read failed: ${err.message}`);
        }
      }
      const bodyText = await response.text().catch(() => '');
      // ONLY a hard 404 is permanently gone. 400/code-100 also covers
      // permission and field errors (operator-fixable) — those must keep
      // retrying, not dead-letter (codex round-2 F2).
      if (response.status === 404) {
        return { __permanent: 'lead_not_found' };
      }
      throw new RetryableMetaError(`Graph ${response.status}: ${bodyText.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** field_data → normalized standard fields + leftover custom Q&A. */
  function parseFieldData(fieldData) {
    const fields = {};
    for (const { name, values } of (fieldData || [])) {
      if (!name) continue;
      fields[String(name).toLowerCase()] = values?.[0] !== undefined && values?.[0] !== null
        ? String(values[0]) : '';
    }
    let firstName = clamp(fields.first_name, 50);
    let lastName = clamp(fields.last_name, 50);
    if (!firstName && fields.full_name) {
      const parts = fields.full_name.trim().split(/\s+/);
      firstName = clamp(parts[0], 50);
      lastName = parts.length > 1 ? clamp(parts.slice(1).join(' '), 50) : null;
    }
    if (!firstName) firstName = 'Meta Lead';

    const rawPhone = fields.phone_number || fields.phone || '';
    let phone = null;
    if (rawPhone) {
      const candidate = d.normalizePhone(rawPhone.replace(/[\s\-()]/g, ''));
      if (candidate && E164_RE.test(candidate)) phone = candidate;
    }
    const rawEmail = (fields.email || '').trim();
    const email = rawEmail && EMAIL_RE.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;

    const consumed = new Set([
      'first_name', 'last_name', 'full_name', 'email', 'phone', 'phone_number',
      'company', 'company_name', 'job_title', 'city', 'date_of_birth', 'dob',
      CONSENT_FIELD_KEY,
    ]);
    const qa = Object.entries(fields)
      .filter(([k, v]) => !consumed.has(k) && v)
      .slice(0, 20)
      .map(([k, v]) => ({ label: clamp(k, 80), value: clamp(v, 300) }));

    return {
      firstName,
      lastName,
      email,
      phone,
      rawPhone: phone ? null : clamp(rawPhone, 40),
      company: clamp(fields.company_name || fields.company, 100),
      jobTitle: clamp(fields.job_title, 100),
      city: clamp(fields.city, 80),
      dobRaw: clamp(fields.date_of_birth || fields.dob, 20),
      consentFieldValue: fields[CONSENT_FIELD_KEY],
      qa,
    };
  }

  /**
   * PDPA consent proof (plan §5): the custom disclaimer checkbox keyed
   * `mktr_pdpa_consent`, falling back to a custom question of the same name.
   * Returns true or undefined — NEVER false: an unticked optional checkbox is
   * the absence of an act, and recording an explicit denial could supersede an
   * older genuine grant for the same person (latest-wins consent state).
   */
  function consentFromLead(leadData, parsed) {
    const responses = leadData?.custom_disclaimer_responses;
    if (Array.isArray(responses)) {
      const hit = responses.find((r) => r?.checkbox_key === CONSENT_FIELD_KEY);
      if (hit) {
        const checked = hit.is_checked === true || String(hit.is_checked).toLowerCase() === 'true' || hit.is_checked === 1;
        return checked ? true : undefined;
      }
    }
    if (parsed.consentFieldValue !== undefined && parsed.consentFieldValue !== '') {
      return AFFIRMATIVE.has(String(parsed.consentFieldValue).trim().toLowerCase()) ? true : undefined;
    }
    return undefined;
  }

  function platformToUtmSource(platform) {
    const p = String(platform || '').toLowerCase();
    if (p === 'fb' || p === 'facebook') return 'fb';
    if (p === 'ig' || p === 'instagram') return 'ig';
    return 'meta';
  }

  async function unmappedCampaign() {
    const fallback = await d.Campaign.findOne({ where: { slug: META_UNMAPPED_SLUG } });
    if (!fallback) {
      // Bootstrap ensures this when META_LEAD_ADS_ENABLED — absence is a boot
      // gap being fixed, so hold the lead in the inbox rather than dropping it.
      throw new RetryableMetaError('[Meta] Unmapped fallback campaign missing (bootstrap incomplete)');
    }
    return fallback;
  }

  /** form → { campaign, qrTag, mapping } with every guard from plan §3.2/§3.3. */
  async function resolveFormRouting(formId) {
    const mapping = formId
      ? await d.MetaFormMapping.findOne({ where: { formId: String(formId), isActive: true } })
      : null;
    if (!mapping) return { campaign: await unmappedCampaign(), qrTag: null, mapping: null };

    const campaign = await d.Campaign.findByPk(mapping.campaignId);
    if (!campaign || (campaign.status != null && campaign.status !== 'active')) {
      d.logger.warn('[Meta] mapped campaign missing/inactive — using unmapped pool', {
        formId: mapping.formId, campaignId: mapping.campaignId,
      });
      return { campaign: await unmappedCampaign(), qrTag: null, mapping };
    }

    let qrTag = null;
    if (mapping.qrTagId) {
      const qr = await d.QrTag.findByPk(mapping.qrTagId);
      // Full liveness, re-checked at every ingest (codex round-2 F11): the QR
      // itself must be active (not archived/inactive) AND its direct agent
      // must still be an active agent — otherwise demote to the campaign ring
      // and drop the qrTagId so the lead is never mislabeled as a QR capture.
      const candidateId = qr ? (qr.assignedAgentId || qr.ownerUserId) : null;
      const qrLive = qr
        && qr.active === true
        && String(qr.campaignId) === String(campaign.id)
        && candidateId;
      const liveAgent = qrLive
        ? await d.User.findOne({ where: { id: candidateId, role: 'agent', isActive: true } })
        : null;
      if (qrLive && liveAgent) {
        qrTag = qr;
      } else {
        d.logger.warn('[Meta] mapping qrTag not live for campaign — demoting to campaign ring', {
          formId: mapping.formId, qrTagId: mapping.qrTagId,
        });
      }
    }
    return { campaign, qrTag, mapping };
  }

  async function loadAgentRecord(agentId, transaction = null) {
    if (!agentId) return null;
    return d.User.findByPk(agentId, {
      attributes: ['id', 'lyfeId', 'mktrLeadsId', 'phone', 'email', 'firstName', 'lastName'],
      transaction,
    });
  }

  function buildNotes({ row, parsed, mapping, platform, isOrganic }) {
    const lines = [
      `[Meta Lead Ad — ${row.createdTime ? new Date(Number(row.createdTime) * 1000).toISOString() : new Date().toISOString()}]`,
      `Form: ${mapping?.formName || row.formId || 'unknown'} | Page: ${row.pageId || 'unknown'}`,
      `Platform: ${platform || 'unknown'}${isOrganic ? ' | Organic' : ''}`,
    ];
    if (parsed.rawPhone) lines.push(`Unparseable phone (as provided): ${parsed.rawPhone}`);
    if (parsed.dobRaw) lines.push(`Date of birth (as provided): ${parsed.dobRaw}`);
    if (parsed.qa.length > 0) {
      lines.push('', '--- Form answers ---');
      for (const { label, value } of parsed.qa) lines.push(`${label}: ${value}`);
    }
    return lines.join('\n');
  }

  /**
   * Claim-fenced terminal transition (codex round-2 F4): the row leaves
   * 'pending' only if WE still own the claim — status still pending AND the
   * exact attempts value we claimed with. A worker that overran its 5-minute
   * lease loses the fence and must abort its transaction; otherwise two
   * workers could each commit a prospect for the same leadgen id (phone-less
   * leads have no unique-index backstop).
   */
  async function terminalize(row, patch, { transaction = null } = {}) {
    const [n] = await d.MetaLeadgenEvent.update(patch, {
      where: { id: row.id, status: 'pending', attempts: row.attempts },
      transaction,
    });
    if (n === 0) {
      throw new RetryableMetaError('claim fence lost — another worker owns this row');
    }
    Object.assign(row, patch);
  }

  /** Terminalize a duplicate-phone lead: one activity on the winner + inbox row done. */
  async function completeAsDuplicate(row, winner, note) {
    await d.sequelize.transaction(async (t) => {
      await d.ProspectActivity.create({
        prospectId: winner.id,
        // 'updated' — the DB enum has no 'note' member (created/assigned/updated/viewed).
        type: 'updated',
        description: note,
        metadata: { source: 'meta_webhook', leadgenId: row.leadgenId, formId: row.formId },
      }, { transaction: t });
      await terminalize(row, { status: 'duplicate', prospectId: winner.id, lastError: null }, { transaction: t });
    });
    return { status: 'duplicate', prospectId: winner.id };
  }

  /** Process ONE claimed inbox row end-to-end. Throws RetryableMetaError to retry. */
  async function processInboxRow(row) {
    const tokenRes = await d.resolvePageAccessToken(row.pageId);
    if (!tokenRes.token) {
      if (tokenRes.retryable) throw new RetryableMetaError(`page token unavailable: ${tokenRes.reason}`);
      await terminalize(row, { status: 'dead', lastError: tokenRes.reason });
      d.logger.warn('[Meta] inbox row dead', { leadgenId: row.leadgenId, reason: tokenRes.reason });
      return { status: 'dead', reason: tokenRes.reason };
    }

    const leadData = await fetchLeadFromGraph(row.leadgenId, tokenRes.token);
    if (leadData.__permanent) {
      await terminalize(row, { status: 'dead', lastError: leadData.__permanent });
      return { status: 'dead', reason: leadData.__permanent };
    }

    const parsed = parseFieldData(leadData.field_data);
    const consent = consentFromLead(leadData, parsed);
    const platform = leadData.platform || null;

    // Final campaign settles BEFORE duplicate/quota/DNC (plan §3.3/§3.4):
    // mapping → deliverability guard may still remap to the unmapped pool.
    let { campaign, qrTag, mapping } = await resolveFormRouting(leadData.form_id || row.formId);
    let routing = await d.resolveLeadRouting({
      reqUser: null, requestedAgentId: null, campaignId: campaign.id, qrTagId: qrTag?.id || null,
    });
    let agentRecord = await loadAgentRecord(routing.agentId);
    let destination = d.destinationForAgent(agentRecord);
    if (routing.agentId && !destination && campaign.slug !== META_UNMAPPED_SLUG) {
      // Provenance-less assignee (System Agent) = undeliverable black hole.
      // Re-route to the quota-enforced unmapped pool so it quarantines into
      // the held queue instead (codex F8: provenance is the test, not `via`).
      campaign = await unmappedCampaign();
      qrTag = null;
      routing = await d.resolveLeadRouting({
        reqUser: null, requestedAgentId: null, campaignId: campaign.id, qrTagId: null,
      });
      agentRecord = await loadAgentRecord(routing.agentId);
      destination = d.destinationForAgent(agentRecord);
    }

    // Duplicate phone-in-campaign precheck (the unique index is the arbiter;
    // the constraint catch below handles the race loser identically).
    if (parsed.phone) {
      const existing = await d.Prospect.findOne({
        where: { campaignId: campaign.id, phone: parsed.phone },
      });
      if (existing) {
        return completeAsDuplicate(row, existing,
          `Duplicate Meta form submission (form: ${mapping?.formName || row.formId || 'unknown'})`);
      }
    }

    const design = d.readLegacyViewSafe(campaign?.design_config, { dncCheckAtSubmit: true });
    const { dncBlockApplies, dncFlagApplies, dncWillCheck } = d.dncCaptureGate(
      design, parsed.phone, { dncEnforcement: d.dncEnforcement, formatDncNumber: d.formatDncNumber }
    );

    // Form-submission instant (Meta unix seconds) — consent evidence and the
    // ledger's occurredAt are pinned to it, never to worker wall-clock.
    const capturedAt = row.createdTime ? new Date(Number(row.createdTime) * 1000) : new Date();
    const utmSource = platformToUtmSource(platform);
    const sourceMetadata = {
      metaLeadgenId: row.leadgenId,
      metaPageId: row.pageId || null,
      metaFormId: leadData.form_id || row.formId || null,
      metaAdId: leadData.ad_id || null,
      metaAdsetId: leadData.adset_id || null,
      metaCampaignId: leadData.campaign_id || null,
      metaCreatedTime: row.createdTime ? Number(row.createdTime) : null,
      metaPlatform: platform,
      metaIsOrganic: leadData.is_organic === true,
      utm: {
        utm_source: utmSource,
        utm_medium: 'lead_ads',
        utm_campaign: mapping?.formName || leadData.form_id || row.formId || 'meta_lead_ads',
      },
      ...(consent !== undefined ? {
        consent_contact: consent,
        consent_copy_version: META_LEADGEN_CONSENT_VERSION,
        consentSource: {
          channel: 'meta_lead_ad',
          formId: leadData.form_id || row.formId || null,
          pageId: row.pageId || null,
          // The SUBMISSION instant, not processing time — a token outage must
          // not shift legal evidence chronology (codex round-2 F7).
          capturedAt: capturedAt.toISOString(),
        },
      } : {}),
    };

    const t = await d.sequelize.transaction();
    let quarantined = false;
    let deliveryPairs = [];
    let dncHeld = false;
    let decision;
    try {
      decision = await d.decideAssignment({
        campaign,
        routing: { agentId: routing.agentId, via: routing.via },
        campaignId: campaign.id,
        transaction: t,
        charge: d.chargeLeadCredit,
      });
      quarantined = decision.action === 'quarantine';
      let heldReason = quarantined ? decision.quarantineReason : null;
      let assignedAgentId = quarantined ? null : (decision.assignedAgentId ?? null);

      let dncIntendedAgentId = null;
      let dncAlreadyCharged = false;
      if (dncBlockApplies && !quarantined) {
        dncIntendedAgentId = await d.bakeHoldTargetAgentId(assignedAgentId, {
          routeVia: routing.via, User: d.User, transaction: t,
        });
        dncAlreadyCharged = decision.charged === true;
        dncHeld = true;
        quarantined = true;
        heldReason = 'dnc_pending';
        assignedAgentId = null;
      }

      const consumerId = parsed.phone
        ? await d.resolveConsumerForCaptureTx(t, {
            phone: parsed.phone,
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
        notes: buildNotes({ row, parsed, mapping, platform, isOrganic: leadData.is_organic === true }),
        tags: ['meta', 'lead-ad'],
        campaignId: campaign.id,
        qrTagId: qrTag?.id || null,
        assignedAgentId,
        quarantinedAt: quarantined ? new Date() : null,
        quarantineReason: quarantined ? heldReason : null,
        ...(dncWillCheck ? { dncStatus: 'pending' } : {}),
        ...(dncHeld ? { dncMetadata: { intendedAgentId: dncIntendedAgentId, alreadyCharged: dncAlreadyCharged } } : {}),
        preferences: {
          contactMethod: parsed.phone ? 'phone' : 'email',
          contactTime: '',
          language: 'en',
          timezone: 'Asia/Singapore',
        },
        demographics: {},
        location: parsed.city ? { city: parsed.city } : {},
        sourceMetadata,
      }, { transaction: t });

      await d.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'created',
        description: `Lead created from Meta Lead Ad (form: ${mapping?.formName || leadData.form_id || row.formId || 'unknown'})`,
        metadata: {
          source: 'meta_webhook',
          leadgenId: row.leadgenId,
          pageId: row.pageId,
          formId: leadData.form_id || row.formId || null,
          campaignName: campaign.name,
        },
      }, { transaction: t });

      // Consent ledger (savepoint-isolated inside; no-op without a consumer).
      await d.recordCaptureConsentEventsTx(t, {
        consumerId,
        prospectId: prospect.id,
        campaignId: campaign.id,
        sourceUrl: null,
        verified: false,
        contact: consent,
        copyVersion: META_LEADGEN_CONSENT_VERSION,
        source: 'meta_lead_ad',
        occurredAt: capturedAt,
      });

      // Outbound delivery intent INSIDE the tx (codex F2). Fail closed for an
      // ASSIGNED lead: no subscriber ⇒ rollback (refunds the charge) ⇒ retry.
      if (!quarantined && assignedAgentId) {
        const agentForWebhook = agentRecord ? {
          phone: agentRecord.phone || null,
          email: agentRecord.email || null,
          name: `${agentRecord.firstName || ''} ${agentRecord.lastName || ''}`.trim(),
          id: d.externalIdForDestination(agentRecord, destination),
        } : null;
        deliveryPairs = await d.persistEventDeliveries(
          'lead.created',
          () => d.buildLeadCreatedPayload(prospect, 'meta_lead_ad', agentForWebhook, assignedAgentId, campaign, qrTag || null, null),
          { destination },
          t
        );
        if (!deliveryPairs || deliveryPairs.length === 0) {
          await t.rollback();
          throw new RetryableMetaError(`no delivery subscriber for destination '${destination}'`);
        }
      }

      // Held ping is best-effort by design (flag-gated; held queue UI is the
      // durable surface) — empty pairs must NOT fail the capture.
      if (quarantined && heldReason === 'no_funded_agent'
        && String(process.env.HELD_LEAD_PING_ENABLED || 'false').toLowerCase() === 'true') {
        const heldPairs = await d.persistEventDeliveries(
          'lead.held',
          () => d.buildLeadHeldPayload(prospect, campaign, heldReason),
          { destination: 'mktr_leads' },
          t
        );
        deliveryPairs = deliveryPairs.concat(heldPairs || []);
      }

      await terminalize(
        row,
        { status: 'completed', prospectId: prospect.id, lastError: null },
        { transaction: t }
      );
      await t.commit();

      d.flushDeliveries(deliveryPairs);
      if (dncHeld) {
        await d.gateHeldDncLead(prospect).catch((err) =>
          d.logger.error('[DNC] meta gate error', { error: err?.message || String(err) }));
      } else if (dncFlagApplies) {
        await d.dncCheckAndRecord(prospect).catch((err) =>
          d.logger.error('[DNC] meta check error', { error: err?.message || String(err) }));
      }
      if (!quarantined && assignedAgentId && agentRecord) {
        const prospectWithCampaign = Object.assign(prospect.toJSON(), {
          campaign: { id: campaign.id, name: campaign.name },
        });
        d.sendLeadAssignmentEmail(agentRecord, prospectWithCampaign).catch((err) =>
          d.logger.warn('[Meta] assignment email failed', { error: err.message }));
      }

      d.logger.info('[Meta] prospect created from lead ad', {
        leadgenId: row.leadgenId,
        prospectId: prospect.id,
        campaignId: campaign.id,
        assignedAgentId,
        quarantined,
        destination: destination || null,
      });
      return { status: quarantined ? 'quarantined' : 'created', prospectId: prospect.id };
    } catch (err) {
      if (!t.finished) await t.rollback().catch(() => {});
      const constraint = err?.original?.constraint || err?.parent?.constraint;
      if (err?.name === 'SequelizeUniqueConstraintError' && constraint === 'prospects_campaign_id_phone') {
        const winner = await d.Prospect.findOne({
          where: { campaignId: campaign.id, phone: parsed.phone },
        });
        if (winner) {
          return completeAsDuplicate(row, winner,
            `Duplicate Meta form submission (form: ${mapping?.formName || row.formId || 'unknown'})`);
        }
      }
      throw err;
    }
  }

  /**
   * Claim due pending rows (FOR UPDATE SKIP LOCKED) and lease them 5 minutes
   * ahead — a crash mid-processing self-heals as an ordinary retry, no
   * 'processing' state to strand. attempts increments AT CLAIM so a poison
   * row that kills the worker still marches to dead.
   */
  async function claimDueRows(limit) {
    return d.sequelize.transaction(async (t) => {
      const now = new Date();
      const rows = await d.MetaLeadgenEvent.findAll({
        where: {
          status: 'pending',
          [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }],
        },
        order: [['createdAt', 'ASC']],
        limit,
        lock: t.LOCK.UPDATE,
        skipLocked: true,
        transaction: t,
      });
      const claimed = [];
      for (const row of rows) {
        if (row.attempts >= MAX_ATTEMPTS) {
          await row.update({ status: 'dead', lastError: row.lastError || 'max attempts exhausted' }, { transaction: t });
          d.logger.error('[Meta] inbox row dead after max attempts', { leadgenId: row.leadgenId });
          continue;
        }
        await row.update(
          { attempts: row.attempts + 1, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
          { transaction: t }
        );
        claimed.push(row);
      }
      return claimed;
    });
  }

  async function markRetry(row, err) {
    const redacted = redactMetaError(err?.message);
    // The FINAL attempt dies immediately — waiting one more 64-minute backoff
    // just to be declared dead at the next claim delays alerting for nothing
    // (codex round-2 F14).
    if (row.attempts >= MAX_ATTEMPTS) {
      await terminalize(row, { status: 'dead', lastError: redacted }).catch(() => {});
      d.logger.error('[Meta] inbox row dead after max attempts', {
        leadgenId: row.leadgenId, attempts: row.attempts, error: redacted,
      });
      return;
    }
    const backoffMin = Math.min(2 ** row.attempts, 64);
    // Claim-fenced like every other transition: if another worker owns the
    // row now, our stale backoff must not clobber its schedule.
    const [n] = await d.MetaLeadgenEvent.update(
      { nextAttemptAt: new Date(Date.now() + backoffMin * 60_000), lastError: redacted },
      { where: { id: row.id, status: 'pending', attempts: row.attempts } }
    ).catch(() => [0]);
    if (n === 0) return;
    d.logger.warn('[Meta] inbox row retry scheduled', {
      leadgenId: row.leadgenId, attempts: row.attempts, backoffMin, error: redacted,
    });
  }

  let draining = false;
  async function drainMetaInbox({ batchSize = 10, maxBatches = 5 } = {}) {
    if (draining) return { drained: 0, note: 'already draining' };
    draining = true;
    let drained = 0;
    try {
      for (let i = 0; i < maxBatches; i += 1) {
        const rows = await claimDueRows(batchSize);
        if (rows.length === 0) break;
        for (const row of rows) {
          try {
            await processInboxRow(row);
            drained += 1;
          } catch (err) {
            await markRetry(row, err);
          }
        }
      }
    } finally {
      draining = false;
    }
    return { drained };
  }

  return {
    enqueueLeadgenChanges,
    drainMetaInbox,
    processInboxRow,
    parseFieldData,
    consentFromLead,
    platformToUtmSource,
    resolveFormRouting,
    fetchLeadFromGraph,
  };
}

// ── Backward-compatible default-wired exports ──
const _default = makeMetaLeadService();
export const enqueueLeadgenChanges = _default.enqueueLeadgenChanges;
export const drainMetaInbox = _default.drainMetaInbox;
