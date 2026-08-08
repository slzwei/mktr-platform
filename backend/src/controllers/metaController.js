import {
  MetaPage, MetaFormMapping, MetaLeadgenEvent, Campaign, QrTag, User,
} from '../models/index.js';
import { verifyMetaSignature, enqueueLeadgenChanges, drainMetaInbox, isMetaLeadAdsArmed } from '../services/metaLeadService.js';
import { handleOAuthCallback, handleDeauthorize, handleDataDeletion } from '../services/metaConnectService.js';
import { sealPageToken } from '../services/metaPageTokens.js';
import { logger } from '../utils/logger.js';

/**
 * Meta Lead Ads webhook + admin surface
 * (docs/plans/meta-lead-ads-native-pipe.md §2.1, §3).
 *
 * The POST handler does NOTHING but verify the signature and durably upsert
 * inbox rows — Graph fetches and prospect creation live in the worker
 * (metaLeadService.drainMetaInbox), kicked post-ack for sub-second delivery.
 */

/** GET /api/meta/webhook — Meta's hub.challenge verification handshake. */
export const verifyWebhook = (req, res) => {
  const expected = process.env.META_VERIFY_TOKEN;
  if (
    req.query['hub.mode'] === 'subscribe'
    && expected
    && req.query['hub.verify_token'] === expected
  ) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  logger.warn('[Meta] webhook verification failed');
  return res.sendStatus(403);
};

/** POST /api/meta/webhook — signature check + inbox upsert + fast 200. */
export const handleWebhook = async (req, res) => {
  const secret = process.env.META_APP_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProd) {
      // envValidation makes this unreachable when the flag is on — if it is
      // ever reached, 503 (Meta redelivers) rather than acknowledge a
      // lead-bearing payload we cannot verify or process (plan §2.1).
      logger.error('[Meta] META_APP_SECRET unset in production — refusing webhook');
      return res.sendStatus(503);
    }
    // Non-prod without a secret: process unverified (local pipeline testing).
  } else if (!verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'))) {
    logger.warn('[Meta] webhook bad signature', { ip: req.ip });
    return res.sendStatus(401);
  }

  // Boot latch: the server shell keeps routes serving even when init fails
  // partway — never ACK lead-bearing intake unless the worker subsystem was
  // actually armed by bootstrap. 503 = Meta redelivers, nothing is lost.
  if (!isMetaLeadAdsArmed()) {
    logger.error('[Meta] webhook received before subsystem armed — refusing intake');
    return res.sendStatus(503);
  }

  const payload = req.body;
  if (payload?.object !== 'page') {
    return res.status(200).json({ success: true, status: 'ignored' });
  }

  const changes = [];
  for (const entry of (payload.entry || [])) {
    for (const change of (entry.changes || [])) {
      if (change?.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      changes.push({
        leadgen_id: change.value.leadgen_id,
        page_id: change.value.page_id || entry.id,
        form_id: change.value.form_id || null,
        created_time: change.value.created_time || entry.time || null,
      });
    }
  }

  try {
    const accepted = await enqueueLeadgenChanges(changes);
    res.status(200).json({ success: true, received: changes.length, accepted });
  } catch (err) {
    // Inbox upsert failed — 500 so Meta redelivers (upsert is idempotent).
    logger.error('[Meta] inbox upsert failed', { error: err?.message });
    return res.sendStatus(500);
  }

  // Post-ack kick: the interval in bootstrap is the recovery net; this keeps
  // the happy path (form submit → agent push) sub-second.
  setImmediate(() => drainMetaInbox().catch((err) =>
    logger.error('[Meta] drain kick failed', { error: err?.message })));
};

// ── Connect Facebook: OAuth + platform callbacks ─────────────────────────

const oauthEnabled = () => String(process.env.META_OAUTH_ENABLED || 'false').toLowerCase() === 'true';
const completionUrl = () => process.env.META_OAUTH_COMPLETION_URL || 'https://redeem.sg/fb-connected';

/**
 * GET /api/meta/oauth/callback — the browser lands here from Facebook's
 * dialog. MINIMUM work (nonce consume + sealed-code stash + worker kick in
 * the service), then a 302 to the HTTPS completion page carrying nothing
 * but a coarse status token (URLs leak via history/referrers).
 */
export const oauthCallback = async (req, res) => {
  if (!oauthEnabled()) return res.sendStatus(404);
  try {
    const r = await handleOAuthCallback({
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      errorDescription: req.query.error_description,
    });
    const suffix = r.redirect === 'pending' ? 's=pending' : `s=${r.redirect}${r.code ? `&c=${encodeURIComponent(r.code)}` : ''}`;
    return res.redirect(302, `${completionUrl()}?${suffix}`);
  } catch (err) {
    logger.error('[Meta] oauth callback failed', { error: err?.message });
    return res.redirect(302, `${completionUrl()}?s=error&c=internal`);
  }
};

/** POST /api/meta/oauth/deauthorize — Meta's user-revoked-access callback (signed_request). */
export const oauthDeauthorize = async (req, res) => {
  if (!oauthEnabled()) return res.sendStatus(404);
  const r = await handleDeauthorize(req.body?.signed_request);
  if (!r.ok) return res.sendStatus(400);
  return res.json({ success: true });
};

/** POST /api/meta/oauth/data-deletion — Meta's data-deletion request callback (signed_request). */
export const oauthDataDeletion = async (req, res) => {
  if (!oauthEnabled()) return res.sendStatus(404);
  const r = await handleDataDeletion(req.body?.signed_request);
  if (!r) return res.sendStatus(400);
  return res.json(r);
};

// ── Admin: pages ──────────────────────────────────────────────────────────

const pageDto = (row) => ({
  id: row.id, pageId: row.pageId, name: row.name, isActive: row.isActive,
  createdAt: row.createdAt, updatedAt: row.updatedAt,
  // accessTokenEnc deliberately absent — tokens are write-only (plan §3.1).
});

/** POST /api/meta/pages — register/replace a page + sealed token. */
export const upsertPage = async (req, res) => {
  const { pageId, name, accessToken } = req.body || {};
  if (!pageId || typeof pageId !== 'string' || !/^\d{5,20}$/.test(pageId)) {
    return res.status(400).json({ error: 'pageId must be the numeric Meta page id' });
  }
  const existing = await MetaPage.findOne({ where: { pageId } });
  if (!existing && !accessToken) {
    return res.status(400).json({ error: 'accessToken is required for a new page' });
  }
  let accessTokenEnc;
  if (accessToken) {
    try {
      accessTokenEnc = sealPageToken(String(accessToken), pageId);
    } catch (err) {
      return res.status(400).json({ error: `Cannot seal token: ${err.message}` });
    }
  }
  const row = existing
    ? await existing.update({
        ...(name !== undefined ? { name: String(name).slice(0, 120) } : {}),
        ...(accessTokenEnc ? { accessTokenEnc } : {}),
        isActive: req.body.isActive !== undefined ? req.body.isActive === true : existing.isActive,
      })
    : await MetaPage.create({
        pageId,
        name: name ? String(name).slice(0, 120) : null,
        accessTokenEnc,
        isActive: req.body.isActive !== undefined ? req.body.isActive === true : true,
      });
  logger.info('[Meta] page registered/updated', { pageId, isActive: row.isActive });
  return res.status(existing ? 200 : 201).json({ page: pageDto(row) });
};

/** GET /api/meta/pages */
export const listPages = async (_req, res) => {
  const rows = await MetaPage.findAll({ order: [['createdAt', 'ASC']] });
  return res.json({ pages: rows.map(pageDto) });
};

// ── Admin: form mappings ─────────────────────────────────────────────────

async function validateMappingRefs({ campaignId, qrTagId }) {
  const campaign = await Campaign.findByPk(campaignId);
  if (!campaign) return { error: 'campaignId not found' };
  if (campaign.status != null && campaign.status !== 'active') {
    return { error: 'campaign is not active' };
  }
  if (qrTagId) {
    const qr = await QrTag.findByPk(qrTagId);
    if (!qr) return { error: 'qrTagId not found' };
    if (qr.active !== true) {
      return { error: 'qrTag is not active (archived/inactive QRs cannot route Meta leads)' };
    }
    if (String(qr.campaignId) !== String(campaignId)) {
      return { error: 'qrTag belongs to a different campaign' };
    }
    const candidateId = qr.assignedAgentId || qr.ownerUserId;
    if (!candidateId) {
      return { error: 'qrTag has no direct agent (group/phone QR variants are not supported for Meta mappings)' };
    }
    const agent = await User.findOne({ where: { id: candidateId, role: 'agent', isActive: true } });
    if (!agent) return { error: 'qrTag agent is not an active agent' };
  }
  return { campaign };
}

const mappingDto = (row) => ({
  id: row.id, formId: row.formId, formName: row.formName,
  campaignId: row.campaignId, qrTagId: row.qrTagId, isActive: row.isActive,
  createdAt: row.createdAt, updatedAt: row.updatedAt,
});

/** POST /api/meta/form-mappings */
export const createFormMapping = async (req, res) => {
  const { formId, formName, campaignId, qrTagId } = req.body || {};
  if (!formId || !/^\d{5,20}$/.test(String(formId))) {
    return res.status(400).json({ error: 'formId must be the numeric Meta form id' });
  }
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });
  const check = await validateMappingRefs({ campaignId, qrTagId: qrTagId || null });
  if (check.error) return res.status(422).json({ error: check.error });
  const [row, created] = await MetaFormMapping.findOrCreate({
    where: { formId: String(formId) },
    defaults: {
      formName: formName ? String(formName).slice(0, 160) : null,
      campaignId,
      qrTagId: qrTagId || null,
      isActive: true,
    },
  });
  if (!created) return res.status(409).json({ error: 'formId already mapped — PATCH it instead', mapping: mappingDto(row) });
  logger.info('[Meta] form mapping created', { formId: row.formId, campaignId });
  return res.status(201).json({ mapping: mappingDto(row) });
};

/** GET /api/meta/form-mappings */
export const listFormMappings = async (_req, res) => {
  const rows = await MetaFormMapping.findAll({ order: [['createdAt', 'ASC']] });
  return res.json({ mappings: rows.map(mappingDto) });
};

/** PATCH /api/meta/form-mappings/:formId */
export const updateFormMapping = async (req, res) => {
  const row = await MetaFormMapping.findOne({ where: { formId: String(req.params.formId) } });
  if (!row) return res.status(404).json({ error: 'mapping not found' });
  const next = {
    campaignId: req.body?.campaignId ?? row.campaignId,
    qrTagId: req.body?.qrTagId === undefined ? row.qrTagId : (req.body.qrTagId || null),
  };
  const check = await validateMappingRefs(next);
  if (check.error) return res.status(422).json({ error: check.error });
  await row.update({
    ...next,
    ...(req.body?.formName !== undefined ? { formName: req.body.formName ? String(req.body.formName).slice(0, 160) : null } : {}),
    ...(req.body?.isActive !== undefined ? { isActive: req.body.isActive === true } : {}),
  });
  return res.json({ mapping: mappingDto(row) });
};

// ── Admin: inbox ops ─────────────────────────────────────────────────────

/** GET /api/meta/inbox?status=dead|pending|completed|duplicate */
export const listInbox = async (req, res) => {
  const status = ['pending', 'completed', 'duplicate', 'dead'].includes(req.query.status)
    ? req.query.status : 'dead';
  const rows = await MetaLeadgenEvent.findAll({
    where: { status },
    order: [['createdAt', 'DESC']],
    limit: 100,
  });
  return res.json({ status, events: rows });
};

/** POST /api/meta/inbox/:leadgenId/retry — revive a DEAD row (only). */
export const retryInboxRow = async (req, res) => {
  const row = await MetaLeadgenEvent.findOne({ where: { leadgenId: String(req.params.leadgenId) } });
  if (!row) return res.status(404).json({ error: 'inbox row not found' });
  // Conditional on status='dead': resetting a PENDING row would clear an
  // active worker's lease and re-open the double-processing race.
  const [n] = await MetaLeadgenEvent.update(
    { status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null },
    { where: { id: row.id, status: 'dead' } }
  );
  if (n === 0) {
    return res.status(409).json({ error: `row is not dead (${row.status}) — only dead rows can be retried` });
  }
  setImmediate(() => drainMetaInbox().catch((err) =>
    logger.error('[Meta] retry drain kick failed', { error: err?.message })));
  return res.json({ ok: true });
};
