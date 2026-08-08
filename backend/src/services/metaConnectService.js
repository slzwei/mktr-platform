import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize, User, Campaign, QrTag, MetaPage, MetaFormMapping, MetaAgentConnection, Prospect,
} from '../models/index.js';
import { sealPageToken, openPageToken } from './metaPageTokens.js';
import { makeMetaGraphClient, GraphError, redactGraphError } from './metaGraphClient.js';
import { META_LEADGEN_CONTACT_COPY } from './contactConsent.js';
import { AppError } from '../middleware/appError.js';
import { logger } from '../utils/logger.js';

/**
 * Connect-Facebook state machine
 * (docs/plans/facebook-connect-self-serve.md + fb-connect-review-round1.md).
 *
 * Journey: awaiting_callback → provisioning → (needs_page_selection |
 * waiting_for_agent) → connected → (reauth_required | disconnected | failed).
 *
 * Custody rules (F1/F2): `oauthCodeEnc` holds ONE sealed secret whose phase
 * is `secretKind` — 'oauth_code' until the exchange, then 'long_token'
 * persisted IMMEDIATELY (the code is single-use; any ambiguous exchange
 * failure demands a fresh dialog, never a re-exchange). Wiped at terminals.
 *
 * Fencing (F4): every receipt write is a conditional UPDATE on
 * {id, status='provisioning', attempts=claimed}; disconnect bumps attempts
 * so an in-flight worker loses its next fence and runs asset cleanup.
 *
 * Reauth (F1): a previously-connected row keeps its assets live through the
 * new dialog; denial/expiry RESTORES 'connected' — never orphans assets
 * under 'failed'.
 */

const MAX_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const LIVE = ['awaiting_callback', 'provisioning', 'needs_page_selection', 'waiting_for_agent', 'connected', 'reauth_required'];
const REQUIRED_SCOPES = ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'pages_manage_ads'];
const LEAD_CAPABLE_TASKS = ['MANAGE', 'ADVERTISE'];

const cxAad = (row) => `cx:${row.id}`;

// ── armed latch (F7): the server shell keeps mounted routes serving even
// when bootstrap fails — every mutating surface refuses until armed. ──
let metaOauthArmed = false;
export function armMetaOauth() { metaOauthArmed = true; }
export function isMetaOauthArmed() { return metaOauthArmed; }
export function disarmMetaOauthForTests() { metaOauthArmed = false; }

function requireArmed() {
  if (!metaOauthArmed) {
    const err = new AppError('Facebook connect not armed', 503);
    err.code = 'not_armed';
    throw err;
  }
}

export function callbackUri() {
  const origin = process.env.META_OAUTH_CALLBACK_ORIGIN || 'https://api.mktr.sg';
  return `${origin.replace(/\/$/, '')}/api/meta/oauth/callback`;
}

/** Verify a Meta signed_request (deauthorize / data-deletion callbacks). */
export function parseSignedRequest(signedRequest, secret = process.env.META_APP_SECRET) {
  if (!signedRequest || !secret) return null;
  const [sigB64, payloadB64] = String(signedRequest).split('.', 2);
  if (!sigB64 || !payloadB64) return null;
  const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const given = fromB64url(sigB64);
  try {
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') return null;
    return payload;
  } catch {
    return null;
  }
}

class FenceLost extends Error {
  constructor() { super('claim fence lost'); this.fenceLost = true; }
}

export function makeMetaConnectService(overrides = {}) {
  const graph = overrides.graph || makeMetaGraphClient(overrides.graphDeps || {});
  const d = {
    sequelize, User, Campaign, QrTag, MetaPage, MetaFormMapping, MetaAgentConnection, Prospect,
    sealPageToken, openPageToken,
    syncAgents: async () => (await import('./agentSyncService.js')).syncAgentsFromMktrLeads(),
    logger,
    ...overrides,
  };

  const agentAdsCampaignId = () => process.env.META_AGENT_ADS_CAMPAIGN_ID || null;
  const wasConnected = (row) => Boolean(row.connectedAt);

  async function resolveLocalAgent(agentMktrUserId, { allowSync = true } = {}) {
    const where = { mktrLeadsId: String(agentMktrUserId), isActive: true, role: 'agent' };
    let user = await d.User.findOne({ where });
    if (!user && allowSync) {
      try { await d.syncAgents(); } catch (err) {
        d.logger.warn('[MetaConnect] mirror sync attempt failed', { error: err?.message });
      }
      user = await d.User.findOne({ where });
    }
    return user;
  }

  // ── start (F8: serialized per user, expiring state) ──────────────────────

  async function startConnect({ agentMktrUserId }) {
    requireArmed();
    const user = await resolveLocalAgent(agentMktrUserId);
    if (!user) {
      const err = new AppError('Agent mirror row not available yet', 503);
      err.code = 'agent_sync_pending';
      throw err;
    }
    const appId = process.env.META_APP_ID;
    const configId = process.env.FB_LOGIN_CONFIG_ID;
    if (!appId || !configId) {
      const err = new AppError('Facebook connect not configured', 503);
      err.code = 'not_configured';
      throw err;
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + STATE_TTL_MS);
    let row;
    try {
      row = await d.sequelize.transaction(async (t) => {
        const live = await d.MetaAgentConnection.findOne({
          where: { userId: user.id, status: { [Op.in]: LIVE } },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (live && live.status === 'provisioning') {
          const fresh = live.nextAttemptAt && new Date(live.nextAttemptAt).getTime() > Date.now() - CLAIM_LEASE_MS;
          if (fresh) {
            const err = new AppError('A connection attempt is already in progress', 409);
            err.code = 'in_progress';
            throw err;
          }
        }
        if (live) {
          // Reauth / restart: receipts + pageId survive so a previously-
          // connected agent's assets stay wired through the new dialog.
          await live.update({
            status: 'awaiting_callback', stateNonce: nonce, stateExpiresAt: expires,
            oauthCodeEnc: null, secretKind: null,
            attempts: 0, nextAttemptAt: null, lastError: null, statusDetail: null,
            agentMktrUserId: String(agentMktrUserId),
          }, { transaction: t });
          return live;
        }
        return d.MetaAgentConnection.create({
          userId: user.id, agentMktrUserId: String(agentMktrUserId),
          status: 'awaiting_callback', stateNonce: nonce, stateExpiresAt: expires,
        }, { transaction: t });
      });
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        const e = new AppError('A connection attempt is already in progress', 409);
        e.code = 'in_progress';
        throw e;
      }
      throw err;
    }

    const params = new URLSearchParams({
      client_id: appId,
      config_id: configId,
      redirect_uri: callbackUri(),
      state: nonce,
      response_type: 'code',
    });
    return { startUrl: `https://www.facebook.com/dialog/oauth?${params}`, connectionId: row.id };
  }

  // ── callback (public GET — one conditional transition, no Graph work) ────

  /** Terminal for a failed dialog: restore 'connected' when assets exist. */
  function dialogFailurePatch(row, detail) {
    return wasConnected(row)
      ? { status: 'connected', statusDetail: detail, stateNonce: null, stateExpiresAt: null, oauthCodeEnc: null, secretKind: null }
      : { status: 'failed', statusDetail: detail, stateNonce: null, stateExpiresAt: null, oauthCodeEnc: null, secretKind: null };
  }

  async function handleOAuthCallback({ code, state, error, errorDescription }) {
    if (!isMetaOauthArmed()) return { redirect: 'error', code: 'not_armed' };
    if (!state) return { redirect: 'error', code: 'bad_state' };
    const row = await d.MetaAgentConnection.findOne({
      where: { stateNonce: String(state), status: 'awaiting_callback' },
    });
    if (!row) return { redirect: 'error', code: 'bad_state' };

    const expired = !row.stateExpiresAt || new Date(row.stateExpiresAt).getTime() < Date.now();
    if (expired) {
      await d.MetaAgentConnection.update(dialogFailurePatch(row, 'state_expired'), {
        where: { id: row.id, stateNonce: String(state) },
      });
      return { redirect: 'error', code: 'state_expired' };
    }

    if (error || !code) {
      const detail = error === 'access_denied' ? 'user_denied' : `dialog_error:${redactGraphError(errorDescription || error || 'no_code')}`;
      await d.MetaAgentConnection.update(dialogFailurePatch(row, detail), {
        where: { id: row.id, stateNonce: String(state) },
      });
      return { redirect: 'denied', code: error === 'access_denied' ? 'user_denied' : 'dialog_error' };
    }

    // ONE conditional transition (F8): nonce consume + phase-tagged secret
    // stash + provisioning flip, atomically — a raced duplicate loses.
    const [n] = await d.MetaAgentConnection.update({
      stateNonce: null, stateExpiresAt: null,
      status: 'provisioning',
      oauthCodeEnc: d.sealPageToken(String(code), cxAad(row)),
      secretKind: 'oauth_code',
      attempts: 0, nextAttemptAt: null, lastError: null,
    }, {
      where: { id: row.id, stateNonce: String(state), status: 'awaiting_callback' },
    });
    if (n === 0) return { redirect: 'error', code: 'bad_state' };

    setImmediate(() => drainMetaConnections().catch((err2) =>
      d.logger.error('[MetaConnect] drain kick failed', { error: err2?.message })));
    return { redirect: 'pending' };
  }

  // ── worker plumbing (claim, fences, retry, cleanup) ──────────────────────

  async function fencedPatch(row, patch) {
    const [n] = await d.MetaAgentConnection.update(patch, {
      where: { id: row.id, status: 'provisioning', attempts: row.attempts },
    });
    if (n === 0) throw new FenceLost();
    Object.assign(row, patch);
  }

  /** After a lost fence: if the row was disconnected under us, deactivate
   *  anything this run just wired so intake can't outlive the disconnect. */
  async function cleanupAfterFenceLoss(row, receipts) {
    const current = await d.MetaAgentConnection.findByPk(row.id).catch(() => null);
    if (!current || current.status !== 'disconnected') return;
    if (receipts.mappingId) {
      await d.MetaFormMapping.update({ isActive: false }, { where: { id: receipts.mappingId } }).catch(() => {});
    }
    if (receipts.metaPageRowId) {
      await d.MetaPage.update({ isActive: false, accessTokenEnc: null }, { where: { id: receipts.metaPageRowId } }).catch(() => {});
    }
    d.logger.warn('[MetaConnect] fence lost to disconnect — cleaned freshly wired assets', { connectionId: row.id });
  }

  async function claimDue(limit) {
    return d.sequelize.transaction(async (t) => {
      const now = new Date();
      const rows = await d.MetaAgentConnection.findAll({
        where: {
          status: { [Op.in]: ['provisioning', 'waiting_for_agent'] },
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
          await row.update({
            status: 'failed', statusDetail: 'max_attempts', oauthCodeEnc: null, secretKind: null,
          }, { transaction: t });
          d.logger.error('[MetaConnect] provisioning failed after max attempts', { connectionId: row.id });
          continue;
        }
        // waiting_for_agent re-enters the run here (F13) — never a sink.
        await row.update({
          status: 'provisioning',
          attempts: row.attempts + 1,
          nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        }, { transaction: t });
        claimed.push(row);
      }
      return claimed;
    });
  }

  async function markRetry(row, err, { waiting = false } = {}) {
    const redacted = redactGraphError(err?.message);
    if (row.attempts >= MAX_ATTEMPTS) {
      await d.MetaAgentConnection.update(
        { status: 'failed', statusDetail: 'max_attempts', lastError: redacted, oauthCodeEnc: null, secretKind: null },
        { where: { id: row.id, status: 'provisioning', attempts: row.attempts } }
      ).catch(() => {});
      return;
    }
    const backoffMin = waiting ? 30 : Math.min(2 ** row.attempts, 32);
    await d.MetaAgentConnection.update(
      {
        ...(waiting ? { status: 'waiting_for_agent' } : {}),
        nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
        lastError: redacted,
      },
      { where: { id: row.id, status: 'provisioning', attempts: row.attempts } }
    ).catch(() => {});
    d.logger.warn('[MetaConnect] provisioning retry scheduled', {
      connectionId: row.id, attempts: row.attempts, backoffMin, waiting, error: redacted,
    });
  }

  /** Map a permanent GraphError to the right terminal (F16). */
  async function graphTerminal(row, err, phase) {
    const detail = `${phase}:graph_${err.code ?? err.kind ?? 'permanent'}`;
    if (err.code === 190) {
      await fencedPatch(row, {
        status: wasConnected(row) ? 'reauth_required' : 'failed',
        statusDetail: detail, oauthCodeEnc: null, secretKind: null,
      });
    } else {
      await fencedPatch(row, { status: 'failed', statusDetail: detail, oauthCodeEnc: null, secretKind: null });
    }
    return { status: row.status };
  }

  /** Deterministic per-agent form name — the duplicate-create guard key. */
  function formNameFor(user) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || 'Agent';
    return `MKTR Leads — ${name}`.slice(0, 90);
  }

  /** Receipt QR must still be OURS and live (F14) — else a fresh one. */
  async function ensureMetaAgentQr({ userId, campaignId, receiptQrId }) {
    if (receiptQrId) {
      const qr = await d.QrTag.findByPk(receiptQrId);
      if (qr && qr.type === 'meta_agent' && qr.active === true
        && String(qr.assignedAgentId) === String(userId)
        && String(qr.campaignId) === String(campaignId)) return qr;
    }
    const existing = await d.QrTag.findOne({
      where: { campaignId, assignedAgentId: userId, type: 'meta_agent', active: true },
    });
    if (existing) return existing;
    return d.QrTag.create({
      slug: `meta-${crypto.randomBytes(4).toString('hex')}`,
      label: 'Meta ads — agent routing',
      type: 'meta_agent',
      campaignId,
      ownerUserId: userId,
      assignedAgentId: userId,
      active: true,
      agentAssignmentMode: 'direct',
    });
  }

  // ── the provisioning run ─────────────────────────────────────────────────

  async function processConnection(row) {
    const receipts = {};
    try {
      return await runProvisioning(row, receipts);
    } catch (err) {
      if (err instanceof FenceLost) {
        await cleanupAfterFenceLoss(row, receipts);
        return { status: 'fence_lost' };
      }
      throw err;
    }
  }

  async function runProvisioning(row, receipts) {
    const campaignId = agentAdsCampaignId();
    if (!campaignId) throw new GraphError('META_AGENT_ADS_CAMPAIGN_ID unset', { retryable: true });

    const user = await d.User.findOne({ where: { id: row.userId, isActive: true, role: 'agent' } });
    if (!user) {
      // Mirror lag / deactivation (F13): waiting re-enters the claim query on
      // a slower cadence; markRetry's cap eventually fails + wipes.
      await markRetry(row, new Error('agent_mirror_missing'), { waiting: true });
      return { status: 'waiting_for_agent' };
    }

    if (!row.oauthCodeEnc || !row.secretKind) {
      await fencedPatch(row, { status: 'failed', statusDetail: 'missing_oauth_secret', oauthCodeEnc: null, secretKind: null });
      return { status: 'failed' };
    }

    // ── credential phase (F1/F2) ──
    let userToken;
    if (row.secretKind === 'oauth_code') {
      const code = d.openPageToken(row.oauthCodeEnc, cxAad(row));
      let exchanged;
      try {
        exchanged = await graph.exchangeCodeForLongLivedToken(code, callbackUri());
      } catch (err) {
        // The code is single-use: ANY failure here (including an ambiguous
        // timeout that may have consumed it) demands a fresh dialog.
        await fencedPatch(row, {
          status: wasConnected(row) ? 'reauth_required' : 'failed',
          statusDetail: 'oauth_exchange_failed',
          oauthCodeEnc: null, secretKind: null,
        });
        return { status: row.status };
      }
      userToken = exchanged.token;
      // Persist the token IMMEDIATELY (F2) — before any further Graph call.
      await fencedPatch(row, {
        oauthCodeEnc: d.sealPageToken(userToken, cxAad(row)),
        secretKind: 'long_token',
        tokenExpiresAt: exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null,
      });
    } else {
      userToken = d.openPageToken(row.oauthCodeEnc, cxAad(row));
    }

    // ── identity + scopes (F10: enforced, not just stored) ──
    let me, granted;
    try {
      me = await graph.call('me', { token: userToken, params: { fields: 'id' } });
      const perms = await graph.callAllPages('me/permissions', { token: userToken });
      granted = perms.filter((p) => p.status === 'granted').map((p) => p.permission);
    } catch (err) {
      if (err instanceof GraphError && !err.retryable) return graphTerminal(row, err, 'identity');
      throw err;
    }
    const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      await fencedPatch(row, {
        status: 'failed', statusDetail: `missing_permissions:${missing.join('+')}`,
        grantedScopes: granted, oauthCodeEnc: null, secretKind: null,
      });
      return { status: 'failed' };
    }
    await fencedPatch(row, { fbUserIdAppScoped: String(me.id), grantedScopes: granted });

    // ── pages ──
    let pages;
    try {
      pages = await graph.callAllPages('me/accounts', {
        token: userToken, params: { fields: 'id,name,access_token,tasks' },
      });
    } catch (err) {
      if (err instanceof GraphError && !err.retryable) return graphTerminal(row, err, 'pages');
      throw err;
    }
    if (pages.length === 0) {
      await fencedPatch(row, { status: 'failed', statusDetail: 'no_pages', oauthCodeEnc: null, secretKind: null });
      return { status: 'failed' };
    }

    let page = row.pageId ? pages.find((p) => String(p.id) === String(row.pageId)) : null;
    if (!page && pages.length === 1) page = pages[0];
    if (!page && !row.pageId) {
      await fencedPatch(row, {
        status: 'needs_page_selection',
        candidatePages: pages.map((p) => ({ id: String(p.id), name: p.name })),
      });
      return { status: 'needs_page_selection' };
    }
    if (!page) {
      await fencedPatch(row, { status: 'failed', statusDetail: 'page_not_granted', oauthCodeEnc: null, secretKind: null });
      return { status: 'failed' };
    }

    // ── RESERVE the page before ANY side effect (F3) ──
    if (String(row.pageId || '') !== String(page.id)) {
      try {
        await fencedPatch(row, { pageId: String(page.id) });
      } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError') {
          await fencedPatch(row, { status: 'failed', statusDetail: 'page_in_use', oauthCodeEnc: null, secretKind: null });
          return { status: 'failed' };
        }
        throw err;
      }
    }

    // ── usability validation (F10) ──
    if (Array.isArray(page.tasks) && page.tasks.length > 0
      && !page.tasks.some((task) => LEAD_CAPABLE_TASKS.includes(String(task).toUpperCase()))) {
      await fencedPatch(row, {
        status: 'failed', statusDetail: 'page_task_missing', pageTasks: page.tasks,
        oauthCodeEnc: null, secretKind: null,
      });
      return { status: 'failed' };
    }
    let leadsAccessOk = null;
    try {
      const pageInfo = await graph.call(String(page.id), {
        token: page.access_token, params: { fields: 'leadgen_tos_accepted' },
      });
      if (pageInfo.leadgen_tos_accepted === false) {
        await fencedPatch(row, {
          status: 'failed', statusDetail: 'leadgen_tos_required',
          pageTasks: page.tasks || null, leadsAccessOk: false, oauthCodeEnc: null, secretKind: null,
        });
        return { status: 'failed' };
      }
      leadsAccessOk = pageInfo.leadgen_tos_accepted === true ? true : null;
    } catch (err) {
      if (err instanceof GraphError && !err.retryable) return graphTerminal(row, err, 'tos');
      throw err; // transport errors retry — drift must not bypass the gate silently
    }

    // ── meta_pages provenance (F3): never take over someone else's page ──
    let metaPageRow = await d.MetaPage.findOne({ where: { pageId: String(page.id) } });
    if (metaPageRow) {
      if (metaPageRow.connectionId && metaPageRow.connectionId !== row.id) {
        const owner = await d.MetaAgentConnection.findByPk(metaPageRow.connectionId);
        if (owner && LIVE.includes(owner.status)) {
          await fencedPatch(row, { status: 'failed', statusDetail: 'page_in_use', oauthCodeEnc: null, secretKind: null });
          return { status: 'failed' };
        }
      }
      if (!metaPageRow.connectionId && !metaPageRow.connectedVia) {
        // Admin-registered page: explicit policy — self-serve never silently
        // takes it over (the admin can hand it off by deleting the row).
        await fencedPatch(row, { status: 'failed', statusDetail: 'page_admin_managed', oauthCodeEnc: null, secretKind: null });
        return { status: 'failed' };
      }
    }
    const sealedPageToken = d.sealPageToken(page.access_token, String(page.id));
    if (metaPageRow) {
      await metaPageRow.update({
        accessTokenEnc: sealedPageToken, isActive: true, name: page.name,
        connectionId: row.id, connectedVia: 'oauth',
      });
    } else {
      metaPageRow = await d.MetaPage.create({
        pageId: String(page.id), name: page.name, accessTokenEnc: sealedPageToken,
        isActive: true, connectionId: row.id, connectedVia: 'oauth',
      });
    }
    receipts.metaPageRowId = metaPageRow.id;
    await fencedPatch(row, { metaPageRowId: metaPageRow.id });

    // ── subscribe + read-back ──
    try {
      await graph.call(`${page.id}/subscribed_apps`, {
        method: 'POST', token: page.access_token, params: { subscribed_fields: 'leadgen' },
      });
      const subs = await graph.call(`${page.id}/subscribed_apps`, { token: page.access_token });
      const subscribed = (subs?.data || []).some((a) => String(a.id) === String(process.env.META_APP_ID));
      if (!subscribed) throw new GraphError('subscription read-back missing our app', { retryable: true });
    } catch (err) {
      if (err instanceof GraphError && !err.retryable) return graphTerminal(row, err, 'subscribe');
      throw err;
    }

    // ── QR (F14 re-validated) + form + mapping ──
    const qr = await ensureMetaAgentQr({ userId: user.id, campaignId, receiptQrId: row.qrTagId });
    await fencedPatch(row, { qrTagId: qr.id });

    let formId = row.formId;
    if (!formId) {
      const wantedName = formNameFor(user);
      let forms;
      try {
        forms = await graph.callAllPages(`${page.id}/leadgen_forms`, {
          token: page.access_token, params: { fields: 'id,name,status' },
        });
      } catch (err) {
        if (err instanceof GraphError && !err.retryable) return graphTerminal(row, err, 'forms');
        throw err;
      }
      const existingForm = forms.find((f) => f.name === wantedName);
      if (existingForm) {
        formId = String(existingForm.id);
      } else {
        try {
          const created = await graph.call(`${page.id}/leadgen_forms`, {
            method: 'POST',
            token: page.access_token,
            params: {
              name: wantedName,
              questions: JSON.stringify([{ type: 'FULL_NAME' }, { type: 'PHONE' }, { type: 'EMAIL' }]),
              privacy_policy: JSON.stringify({ url: 'https://redeem.sg/personal-data-policy', link_text: 'Redeem Personal Data Policy' }),
              custom_disclaimer: JSON.stringify({
                title: 'Your consent',
                body: { text: 'Before you submit:' },
                checkboxes: [{ key: 'mktr_pdpa_consent', is_required: false, text: META_LEADGEN_CONTACT_COPY }],
              }),
              follow_up_action_url: 'https://redeem.sg',
            },
          });
          formId = String(created.id);
        } catch (err) {
          if (err instanceof GraphError && !err.retryable) return graphTerminal(row, err, 'form_create');
          throw err;
        }
      }
      await fencedPatch(row, { formId: String(formId) });
    }

    let mapping = await d.MetaFormMapping.findOne({ where: { formId: String(formId) } });
    if (mapping && mapping.isActive && mapping.qrTagId && mapping.qrTagId !== qr.id) {
      const otherQr = await d.QrTag.findByPk(mapping.qrTagId);
      if (otherQr && otherQr.assignedAgentId && String(otherQr.assignedAgentId) !== String(user.id)) {
        await fencedPatch(row, { status: 'failed', statusDetail: 'mapping_conflict', oauthCodeEnc: null, secretKind: null });
        return { status: 'failed' };
      }
    }
    if (mapping) {
      await mapping.update({ campaignId, qrTagId: qr.id, isActive: true, formName: formNameFor(user) });
    } else {
      mapping = await d.MetaFormMapping.create({
        formId: String(formId), formName: formNameFor(user), campaignId, qrTagId: qr.id, isActive: true,
      });
    }
    receipts.mappingId = mapping.id;

    await fencedPatch(row, {
      status: 'connected',
      connectedAt: new Date(),
      mappingId: mapping.id,
      pageTasks: page.tasks || null,
      leadsAccessOk,
      candidatePages: null,
      oauthCodeEnc: null,
      secretKind: null,
      lastError: null,
      statusDetail: null,
    });
    d.logger.info('[MetaConnect] agent connected', {
      connectionId: row.id, userId: user.id, pageId: String(page.id), formId,
    });
    return { status: 'connected' };
  }

  let draining = false;
  async function drainMetaConnections({ batchSize = 5, maxBatches = 4 } = {}) {
    if (draining) return { drained: 0, note: 'already draining' };
    draining = true;
    let drained = 0;
    try {
      for (let i = 0; i < maxBatches; i += 1) {
        const rows = await claimDue(batchSize);
        if (rows.length === 0) break;
        for (const row of rows) {
          try {
            await processConnection(row);
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

  // ── broker-facing actions ────────────────────────────────────────────────

  async function selectPage({ agentMktrUserId, pageId }) {
    requireArmed();
    const user = await resolveLocalAgent(agentMktrUserId, { allowSync: false });
    if (!user) { const e = new AppError('agent not found', 503); e.code = 'agent_sync_pending'; throw e; }
    const row = await d.MetaAgentConnection.findOne({ where: { userId: user.id, status: 'needs_page_selection' } });
    if (!row) { const e = new AppError('no selection pending', 409); e.code = 'no_selection_pending'; throw e; }
    const candidates = Array.isArray(row.candidatePages) ? row.candidatePages : [];
    if (!candidates.some((p) => String(p.id) === String(pageId))) {
      const e = new AppError('page not in the granted set', 422); e.code = 'invalid_page'; throw e;
    }
    try {
      const [n] = await d.MetaAgentConnection.update(
        { status: 'provisioning', pageId: String(pageId), attempts: 0, nextAttemptAt: null },
        { where: { id: row.id, status: 'needs_page_selection' } }
      );
      if (n === 0) { const e = new AppError('no selection pending', 409); e.code = 'no_selection_pending'; throw e; }
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        await d.MetaAgentConnection.update(
          { status: 'failed', statusDetail: 'page_in_use', oauthCodeEnc: null, secretKind: null },
          { where: { id: row.id } }
        );
        const e = new AppError('page already connected by another agent', 409); e.code = 'page_in_use'; throw e;
      }
      throw err;
    }
    setImmediate(() => drainMetaConnections().catch(() => {}));
    return { ok: true };
  }

  async function getConnectionStatus({ agentMktrUserId }) {
    const user = await d.User.findOne({ where: { mktrLeadsId: String(agentMktrUserId) } });
    if (!user) return { enabled: true, status: 'none' };
    const row = await d.MetaAgentConnection.findOne({
      where: { userId: user.id },
      order: [['updatedAt', 'DESC']],
    });
    if (!row) return { enabled: true, status: 'none' };
    const dto = {
      enabled: true,
      status: row.status,
      statusDetail: row.statusDetail || null,
      pageId: row.pageId || null,
      pageName: null,
      formName: null,
      connectedAt: row.connectedAt || null,
      lastLeadAt: null,
      needsSelection: row.status === 'needs_page_selection' ? (row.candidatePages || []) : null,
    };
    if (row.metaPageRowId) {
      const pageRow = await d.MetaPage.findByPk(row.metaPageRowId);
      dto.pageName = pageRow?.name || null;
    }
    if (row.mappingId) {
      const mapping = await d.MetaFormMapping.findByPk(row.mappingId);
      dto.formName = mapping?.formName || null;
    }
    const campaignId = agentAdsCampaignId();
    if (campaignId && row.status === 'connected') {
      const last = await d.Prospect.findOne({
        where: { assignedAgentId: user.id, campaignId },
        order: [['createdAt', 'DESC']],
        attributes: ['createdAt'],
      }).catch(() => null);
      dto.lastLeadAt = last?.createdAt || null;
    }
    return dto;
  }

  /**
   * Disconnect ordering (F11): (1) ONE txn disables local intake — status,
   * mapping, page-inactive — while KEEPING the token; (2) best-effort remote
   * unsubscribe with that token; (3) wipe the token. A crash mid-sequence
   * leaves intake locally DEAD (the tombstone DENY) — never a silent
   * Meta-side black hole. The attempts bump invalidates in-flight claims (F4).
   */
  async function disconnectConnection(row, { reason, remote = true } = {}) {
    const disconnected = await d.sequelize.transaction(async (t) => {
      const [n] = await d.MetaAgentConnection.update(
        {
          status: 'disconnected', disconnectedAt: new Date(), disconnectReason: reason,
          oauthCodeEnc: null, secretKind: null, candidatePages: null,
          attempts: d.sequelize.literal('attempts + 1'),
        },
        { where: { id: row.id, status: { [Op.in]: LIVE } }, transaction: t }
      );
      if (n === 0) return false;
      if (row.mappingId) {
        await d.MetaFormMapping.update({ isActive: false }, { where: { id: row.mappingId }, transaction: t });
      }
      if (row.metaPageRowId) {
        await d.MetaPage.update({ isActive: false }, { where: { id: row.metaPageRowId }, transaction: t });
      }
      return true;
    });
    if (!disconnected) return false;

    if (remote && row.metaPageRowId) {
      try {
        const pageRow = await d.MetaPage.findByPk(row.metaPageRowId);
        if (pageRow?.accessTokenEnc) {
          const token = d.openPageToken(pageRow.accessTokenEnc, pageRow.pageId);
          await graph.call(`${pageRow.pageId}/subscribed_apps`, { method: 'DELETE', token });
        }
      } catch (err) {
        d.logger.warn('[MetaConnect] remote unsubscribe failed (continuing)', { error: redactGraphError(err?.message) });
      }
    }
    if (row.metaPageRowId) {
      await d.MetaPage.update({ accessTokenEnc: null }, { where: { id: row.metaPageRowId } }).catch(() => {});
    }
    return true;
  }

  async function disconnect({ agentMktrUserId }) {
    requireArmed();
    const user = await d.User.findOne({ where: { mktrLeadsId: String(agentMktrUserId) } });
    if (!user) { const e = new AppError('agent not found', 404); e.code = 'not_found'; throw e; }
    const row = await d.MetaAgentConnection.findOne({ where: { userId: user.id, status: { [Op.in]: LIVE } } });
    if (!row) { const e = new AppError('no live connection', 404); e.code = 'not_connected'; throw e; }
    await disconnectConnection(row, { reason: 'agent_request' });
    return { ok: true };
  }

  /** Agent-sync hook (F9): deactivated/removed agents lose live connections. */
  async function disconnectForUsers(userIds, { reason = 'agent_deactivated' } = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) return 0;
    const rows = await d.MetaAgentConnection.findAll({
      where: { userId: { [Op.in]: userIds }, status: { [Op.in]: LIVE } },
    });
    let done = 0;
    for (const row of rows) {
      if (await disconnectConnection(row, { reason, remote: true })) done += 1;
    }
    return done;
  }

  // ── Meta platform callbacks ──────────────────────────────────────────────

  async function handleDeauthorize(signedRequest) {
    const payload = parseSignedRequest(signedRequest);
    if (!payload?.user_id) return { ok: false };
    const rows = await d.MetaAgentConnection.findAll({
      where: { fbUserIdAppScoped: String(payload.user_id), status: { [Op.in]: LIVE } },
    });
    for (const row of rows) {
      await disconnectConnection(row, { reason: 'fb_deauthorized', remote: false });
    }
    return { ok: true, disconnected: rows.length };
  }

  /**
   * Data deletion (F12): scrub EVERY Facebook identifier and secret across
   * ALL statuses, deactivate any still-active assets terminal rows point at,
   * and answer with an OPAQUE stored confirmation code — never the row PK.
   */
  async function handleDataDeletion(signedRequest) {
    const payload = parseSignedRequest(signedRequest);
    if (!payload?.user_id) return null;
    const rows = await d.MetaAgentConnection.findAll({
      where: { fbUserIdAppScoped: String(payload.user_id) },
    });
    const code = crypto.randomBytes(16).toString('hex');
    for (const row of rows) {
      if (LIVE.includes(row.status)) {
        await disconnectConnection(row, { reason: 'fb_data_deletion', remote: false });
      } else {
        // Terminal rows can still point at active assets — kill those too.
        if (row.mappingId) await d.MetaFormMapping.update({ isActive: false }, { where: { id: row.mappingId } }).catch(() => {});
        if (row.metaPageRowId) {
          await d.MetaPage.update({ isActive: false, accessTokenEnc: null }, { where: { id: row.metaPageRowId } }).catch(() => {});
        }
      }
      await row.update({
        fbUserIdAppScoped: null, agentMktrUserId: null,
        pageId: null, formId: null, mappingId: null, qrTagId: null, metaPageRowId: null,
        oauthCodeEnc: null, secretKind: null, candidatePages: null,
        grantedScopes: null, pageTasks: null, lastError: null,
        statusDetail: 'data_deletion', deletionCode: code,
      }).catch(() => {});
    }
    return { url: `https://redeem.sg/fb-data-deletion?code=${code}`, confirmation_code: code };
  }

  // ── daily health probe + janitor (F17) ───────────────────────────────────

  async function probeConnectionsHealth({ batch = 20 } = {}) {
    const appId = process.env.META_APP_ID;
    const secret = process.env.META_APP_SECRET;
    if (!appId || !secret) return { probed: 0 };
    const appToken = `${appId}|${secret}`;
    const stale = new Date(Date.now() - 24 * 3600 * 1000);
    const rows = await d.MetaAgentConnection.findAll({
      where: {
        status: 'connected',
        [Op.or]: [{ lastTokenCheckAt: null }, { lastTokenCheckAt: { [Op.lte]: stale } }],
      },
      limit: batch,
    });
    let probed = 0;
    for (const row of rows) {
      try {
        const pageRow = row.metaPageRowId ? await d.MetaPage.findByPk(row.metaPageRowId) : null;
        if (!pageRow?.accessTokenEnc) {
          await row.update({ status: 'reauth_required', statusDetail: 'token_missing', lastTokenCheckAt: new Date() });
          continue;
        }
        const token = d.openPageToken(pageRow.accessTokenEnc, pageRow.pageId);
        const dbg = await graph.call('debug_token', { token: appToken, params: { input_token: token }, proof: false });
        const info = dbg?.data || {};
        const patch = {
          lastTokenCheckAt: new Date(),
          dataAccessExpiresAt: info.data_access_expires_at ? new Date(info.data_access_expires_at * 1000) : row.dataAccessExpiresAt,
          tokenExpiresAt: info.expires_at ? (info.expires_at === 0 ? null : new Date(info.expires_at * 1000)) : row.tokenExpiresAt,
        };
        if (info.is_valid === false) {
          patch.status = 'reauth_required';
          patch.statusDetail = 'token_invalid';
        } else {
          // Subscription drift check (F17): a page whose subscription vanished
          // silently delivers nothing — surface it as reauth_required.
          const subs = await graph.call(`${pageRow.pageId}/subscribed_apps`, { token }).catch(() => null);
          if (subs && !(subs.data || []).some((a) => String(a.id) === String(appId))) {
            patch.status = 'reauth_required';
            patch.statusDetail = 'subscription_lost';
          }
        }
        await row.update(patch);
        probed += 1;
      } catch (err) {
        d.logger.warn('[MetaConnect] health probe failed for connection', { connectionId: row.id, error: redactGraphError(err?.message) });
        await row.update({ lastTokenCheckAt: new Date() }).catch(() => {});
      }
    }
    // Janitor (F11): inactive pages must not retain tokens.
    await d.MetaPage.update(
      { accessTokenEnc: null },
      { where: { isActive: false, accessTokenEnc: { [Op.ne]: null }, connectedVia: 'oauth' } }
    ).catch(() => {});
    return { probed };
  }

  return {
    startConnect, handleOAuthCallback, drainMetaConnections, processConnection,
    selectPage, getConnectionStatus, disconnect, disconnectForUsers,
    handleDeauthorize, handleDataDeletion, probeConnectionsHealth,
    ensureMetaAgentQr, formNameFor,
  };
}

// ── default-wired exports ──
const _default = makeMetaConnectService();
export const startConnect = _default.startConnect;
export const handleOAuthCallback = _default.handleOAuthCallback;
export const drainMetaConnections = _default.drainMetaConnections;
export const selectPage = _default.selectPage;
export const getConnectionStatus = _default.getConnectionStatus;
export const disconnect = _default.disconnect;
export const disconnectForUsers = _default.disconnectForUsers;
export const handleDeauthorize = _default.handleDeauthorize;
export const handleDataDeletion = _default.handleDataDeletion;
export const probeConnectionsHealth = _default.probeConnectionsHealth;
