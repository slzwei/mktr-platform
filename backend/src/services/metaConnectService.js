import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize, User, Campaign, QrTag, MetaPage, MetaFormMapping, MetaAgentConnection,
} from '../models/index.js';
import { sealPageToken, openPageToken } from './metaPageTokens.js';
import { makeMetaGraphClient, GraphError, redactGraphError } from './metaGraphClient.js';
import { META_LEADGEN_CONTACT_COPY } from './contactConsent.js';
import { AppError } from '../middleware/appError.js';
import { logger } from '../utils/logger.js';

/**
 * Connect-Facebook state machine (docs/plans/facebook-connect-self-serve.md).
 *
 * Journey: awaiting_callback → provisioning → (needs_page_selection |
 * waiting_for_agent) → connected → (reauth_required | disconnected | failed).
 * The public OAuth callback does the MINIMUM (consume nonce, stash sealed
 * code, kick); ALL Graph work happens here in the claim-fenced worker —
 * the leadgen-inbox pattern, reused.
 *
 * Secrets custody: the OAuth code, then (during provisioning only) the
 * long-lived USER token, live sealed in `oauthCodeEnc` (AAD = `cx:<row id>`)
 * and are WIPED at every terminal state. Steady state stores PAGE tokens
 * only, in meta_pages (existing envelope, AAD = pageId).
 */

const MAX_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const LIVE = ['awaiting_callback', 'provisioning', 'needs_page_selection', 'waiting_for_agent', 'connected', 'reauth_required'];

const cxAad = (row) => `cx:${row.id}`;

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

export function makeMetaConnectService(overrides = {}) {
  const graph = overrides.graph || makeMetaGraphClient(overrides.graphDeps || {});
  const d = {
    sequelize, User, Campaign, QrTag, MetaPage, MetaFormMapping, MetaAgentConnection,
    sealPageToken, openPageToken,
    syncAgents: async () => (await import('./agentSyncService.js')).syncAgentsFromMktrLeads(),
    logger,
    ...overrides,
  };

  const agentAdsCampaignId = () => process.env.META_AGENT_ADS_CAMPAIGN_ID || null;

  async function resolveLocalAgent(agentMktrUserId, { allowSync = true } = {}) {
    const where = { mktrLeadsId: String(agentMktrUserId), isActive: true, role: 'agent' };
    let user = await d.User.findOne({ where });
    if (!user && allowSync) {
      // Mirror lag: one targeted sync attempt, then re-look. Still missing is
      // NOT "not linked" — the app-side gate already proved linkage.
      try { await d.syncAgents(); } catch (err) {
        d.logger.warn('[MetaConnect] mirror sync attempt failed', { error: err?.message });
      }
      user = await d.User.findOne({ where });
    }
    return user;
  }

  // ── start ────────────────────────────────────────────────────────────────

  async function startConnect({ agentMktrUserId }) {
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

    let row = await d.MetaAgentConnection.findOne({ where: { userId: user.id, status: { [Op.in]: LIVE } } });
    if (row && row.status === 'provisioning') {
      const fresh = row.nextAttemptAt && new Date(row.nextAttemptAt).getTime() > Date.now() - CLAIM_LEASE_MS;
      if (fresh) {
        const err = new AppError('A connection attempt is already in progress', 409);
        err.code = 'in_progress';
        throw err;
      }
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    if (row) {
      // Restart / reauth: same row, fresh journey. Receipts (qr/form/mapping)
      // survive so re-provisioning is idempotent.
      await row.update({
        status: 'awaiting_callback', stateNonce: nonce, oauthCodeEnc: null,
        attempts: 0, nextAttemptAt: null, lastError: null, statusDetail: null,
        agentMktrUserId: String(agentMktrUserId),
      });
    } else {
      row = await d.MetaAgentConnection.create({
        userId: user.id, agentMktrUserId: String(agentMktrUserId),
        status: 'awaiting_callback', stateNonce: nonce,
      });
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

  // ── callback (public GET — MINIMUM work, no Graph calls) ─────────────────

  async function handleOAuthCallback({ code, state, error, errorDescription }) {
    if (!state) return { redirect: 'error', code: 'bad_state' };
    // Locate by nonce, then consume ATOMICALLY by id+nonce — a concurrent
    // duplicate callback loses the conditional update and gets bad_state.
    const row = await d.MetaAgentConnection.findOne({
      where: { stateNonce: String(state), status: 'awaiting_callback' },
    });
    if (!row) return { redirect: 'error', code: 'bad_state' };
    const [n] = await d.MetaAgentConnection.update(
      { stateNonce: null },
      { where: { id: row.id, stateNonce: String(state) } }
    );
    if (n === 0) return { redirect: 'error', code: 'bad_state' };
    row.stateNonce = null;

    if (error || !code) {
      await row.update({
        status: 'failed',
        statusDetail: error === 'access_denied' ? 'user_denied' : `dialog_error:${redactGraphError(errorDescription || error || 'no_code')}`,
        oauthCodeEnc: null,
      });
      return { redirect: 'denied', code: error === 'access_denied' ? 'user_denied' : 'dialog_error' };
    }

    await row.update({
      status: 'provisioning',
      oauthCodeEnc: d.sealPageToken(String(code), cxAad(row)),
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    setImmediate(() => drainMetaConnections().catch((err2) =>
      d.logger.error('[MetaConnect] drain kick failed', { error: err2?.message })));
    return { redirect: 'pending' };
  }

  // ── worker (claim-fenced, backoff — the inbox pattern) ───────────────────

  async function terminalize(row, patch, { transaction = null } = {}) {
    const [n] = await d.MetaAgentConnection.update(patch, {
      where: { id: row.id, status: 'provisioning', attempts: row.attempts },
      transaction,
    });
    if (n === 0) throw new GraphError('claim fence lost', { retryable: true });
    Object.assign(row, patch);
  }

  async function claimDue(limit) {
    return d.sequelize.transaction(async (t) => {
      const now = new Date();
      const rows = await d.MetaAgentConnection.findAll({
        where: {
          status: 'provisioning',
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
          await row.update({ status: 'failed', statusDetail: 'max_attempts', oauthCodeEnc: null }, { transaction: t });
          d.logger.error('[MetaConnect] provisioning failed after max attempts', { connectionId: row.id });
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
    const redacted = redactGraphError(err?.message);
    if (row.attempts >= MAX_ATTEMPTS) {
      await d.MetaAgentConnection.update(
        { status: 'failed', statusDetail: 'max_attempts', lastError: redacted, oauthCodeEnc: null },
        { where: { id: row.id, status: 'provisioning', attempts: row.attempts } }
      ).catch(() => {});
      return;
    }
    const backoffMin = Math.min(2 ** row.attempts, 32);
    await d.MetaAgentConnection.update(
      { nextAttemptAt: new Date(Date.now() + backoffMin * 60_000), lastError: redacted },
      { where: { id: row.id, status: 'provisioning', attempts: row.attempts } }
    ).catch(() => {});
    d.logger.warn('[MetaConnect] provisioning retry scheduled', { connectionId: row.id, attempts: row.attempts, backoffMin, error: redacted });
  }

  /** Deterministic per-agent form name — the duplicate-create guard key. */
  function formNameFor(user) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || 'Agent';
    return `MKTR Leads — ${name}`.slice(0, 90);
  }

  async function ensureMetaAgentQr({ userId, campaignId }) {
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

  async function processConnection(row) {
    const campaignId = agentAdsCampaignId();
    if (!campaignId) throw new GraphError('META_AGENT_ADS_CAMPAIGN_ID unset', { retryable: true });

    const user = await d.User.findOne({ where: { id: row.userId, isActive: true, role: 'agent' } });
    if (!user) {
      await terminalize(row, { status: 'waiting_for_agent', statusDetail: 'agent_mirror_missing' });
      return { status: 'waiting_for_agent' };
    }

    if (!row.oauthCodeEnc) {
      await terminalize(row, { status: 'failed', statusDetail: 'missing_oauth_secret' });
      return { status: 'failed' };
    }

    // Exchange exactly once: the code is single-use at Meta, so the sealed
    // slot is REPLACED by the sealed long-lived user token on first success
    // (marked by fbUserIdAppScoped being set).
    let userToken;
    if (!row.fbUserIdAppScoped) {
      const code = d.openPageToken(row.oauthCodeEnc, cxAad(row));
      let exchanged;
      try {
        exchanged = await graph.exchangeCodeForLongLivedToken(code, callbackUri());
      } catch (err) {
        if (err instanceof GraphError && !err.retryable) {
          await terminalize(row, { status: 'failed', statusDetail: `oauth_exchange:${err.code ?? 'permanent'}`, oauthCodeEnc: null });
          return { status: 'failed' };
        }
        throw err;
      }
      userToken = exchanged.token;
      const me = await graph.call('me', { token: userToken, params: { fields: 'id' } });
      const perms = await graph.callAllPages('me/permissions', { token: userToken });
      const granted = perms.filter((p) => p.status === 'granted').map((p) => p.permission);
      await terminalize(row, {
        fbUserIdAppScoped: String(me.id),
        grantedScopes: granted,
        oauthCodeEnc: d.sealPageToken(userToken, cxAad(row)),
        tokenExpiresAt: exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null,
      });
    } else {
      userToken = d.openPageToken(row.oauthCodeEnc, cxAad(row));
    }

    // Pages the agent granted — full pagination, tokens NEVER stored in JSONB.
    const pages = await graph.callAllPages('me/accounts', {
      token: userToken, params: { fields: 'id,name,access_token,tasks' },
    });
    if (pages.length === 0) {
      await terminalize(row, { status: 'failed', statusDetail: 'no_pages', oauthCodeEnc: null });
      return { status: 'failed' };
    }

    let page = row.pageId ? pages.find((p) => String(p.id) === String(row.pageId)) : null;
    if (!page && pages.length === 1) page = pages[0];
    if (!page && !row.pageId) {
      await terminalize(row, {
        status: 'needs_page_selection',
        candidatePages: pages.map((p) => ({ id: String(p.id), name: p.name })),
      });
      return { status: 'needs_page_selection' };
    }
    if (!page) {
      await terminalize(row, { status: 'failed', statusDetail: 'page_not_granted', oauthCodeEnc: null });
      return { status: 'failed' };
    }

    // Usability validation (permission ≠ usable): page TOS for leadgen.
    let leadsAccessOk = null;
    try {
      const pageInfo = await graph.call(String(page.id), {
        token: page.access_token, params: { fields: 'leadgen_tos_accepted' },
      });
      leadsAccessOk = pageInfo.leadgen_tos_accepted !== false;
      if (pageInfo.leadgen_tos_accepted === false) {
        await terminalize(row, {
          status: 'failed', statusDetail: 'leadgen_tos_required',
          pageId: String(page.id), pageTasks: page.tasks || null, leadsAccessOk: false, oauthCodeEnc: null,
        });
        return { status: 'failed' };
      }
    } catch (err) {
      // Field drift must not brick connects — log and continue.
      d.logger.warn('[MetaConnect] leadgen TOS check skipped', { error: redactGraphError(err?.message) });
    }

    // ── idempotent wiring, receipts on the row ──
    let metaPageRow = await d.MetaPage.findOne({ where: { pageId: String(page.id) } });
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

    await graph.call(`${page.id}/subscribed_apps`, {
      method: 'POST', token: page.access_token, params: { subscribed_fields: 'leadgen' },
    });
    const subs = await graph.call(`${page.id}/subscribed_apps`, { token: page.access_token });
    const appId = process.env.META_APP_ID;
    const subscribed = (subs?.data || []).some((a) => String(a.id) === String(appId));
    if (!subscribed) throw new GraphError('subscription read-back missing our app', { retryable: true });

    const qr = row.qrTagId
      ? await d.QrTag.findByPk(row.qrTagId)
      : await ensureMetaAgentQr({ userId: user.id, campaignId });

    let formId = row.formId;
    if (!formId) {
      const wantedName = formNameFor(user);
      const forms = await graph.callAllPages(`${page.id}/leadgen_forms`, {
        token: page.access_token, params: { fields: 'id,name,status' },
      });
      const existingForm = forms.find((f) => f.name === wantedName);
      if (existingForm) {
        formId = String(existingForm.id);
      } else {
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
      }
    }

    let mapping = await d.MetaFormMapping.findOne({ where: { formId: String(formId) } });
    if (mapping) {
      await mapping.update({ campaignId, qrTagId: qr?.id || null, isActive: true, formName: formNameFor(user) });
    } else {
      mapping = await d.MetaFormMapping.create({
        formId: String(formId), formName: formNameFor(user), campaignId, qrTagId: qr?.id || null, isActive: true,
      });
    }

    await terminalize(row, {
      status: 'connected',
      connectedAt: new Date(),
      pageId: String(page.id),
      metaPageRowId: metaPageRow.id,
      qrTagId: qr?.id || null,
      formId: String(formId),
      mappingId: mapping.id,
      pageTasks: page.tasks || null,
      leadsAccessOk,
      candidatePages: null,
      oauthCodeEnc: null,
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
    const user = await resolveLocalAgent(agentMktrUserId, { allowSync: false });
    if (!user) { const e = new AppError('agent not found', 503); e.code = 'agent_sync_pending'; throw e; }
    const row = await d.MetaAgentConnection.findOne({ where: { userId: user.id, status: 'needs_page_selection' } });
    if (!row) { const e = new AppError('no selection pending', 409); e.code = 'no_selection_pending'; throw e; }
    const candidates = Array.isArray(row.candidatePages) ? row.candidatePages : [];
    if (!candidates.some((p) => String(p.id) === String(pageId))) {
      const e = new AppError('page not in the granted set', 422); e.code = 'invalid_page'; throw e;
    }
    await row.update({ status: 'provisioning', pageId: String(pageId), attempts: 0, nextAttemptAt: null });
    setImmediate(() => drainMetaConnections().catch(() => {}));
    return { ok: true };
  }

  async function getConnectionStatus({ agentMktrUserId }) {
    const user = await d.User.findOne({ where: { mktrLeadsId: String(agentMktrUserId) } });
    if (!user) return { status: 'none' };
    const row = await d.MetaAgentConnection.findOne({
      where: { userId: user.id },
      order: [['updatedAt', 'DESC']],
    });
    if (!row) return { status: 'none' };
    const dto = {
      status: LIVE.includes(row.status) || ['disconnected', 'failed'].includes(row.status) ? row.status : 'none',
      statusDetail: row.statusDetail || null,
      pageId: row.pageId || null,
      pageName: null,
      formName: null,
      connectedAt: row.connectedAt || null,
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
    return dto;
  }

  async function disconnectConnection(row, { reason, remote = true } = {}) {
    // Remote unsubscribe BEFORE the token wipe (we need the token to do it);
    // best-effort — access may already be revoked.
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
    await d.sequelize.transaction(async (t) => {
      await d.MetaAgentConnection.update(
        { status: 'disconnected', disconnectedAt: new Date(), disconnectReason: reason, oauthCodeEnc: null, candidatePages: null },
        { where: { id: row.id }, transaction: t }
      );
      if (row.mappingId) {
        await d.MetaFormMapping.update({ isActive: false }, { where: { id: row.mappingId }, transaction: t });
      }
      if (row.metaPageRowId) {
        // Tombstone DENY: inactive + token wiped; the row must SURVIVE so the
        // env fallback can never silently revive intake for this pageId.
        await d.MetaPage.update(
          { isActive: false, accessTokenEnc: null },
          { where: { id: row.metaPageRowId }, transaction: t }
        );
      }
    });
  }

  async function disconnect({ agentMktrUserId }) {
    const user = await d.User.findOne({ where: { mktrLeadsId: String(agentMktrUserId) } });
    if (!user) { const e = new AppError('agent not found', 404); e.code = 'not_found'; throw e; }
    const row = await d.MetaAgentConnection.findOne({ where: { userId: user.id, status: { [Op.in]: LIVE } } });
    if (!row) { const e = new AppError('no live connection', 404); e.code = 'not_connected'; throw e; }
    await disconnectConnection(row, { reason: 'agent_request' });
    return { ok: true };
  }

  // ── Meta platform callbacks ──────────────────────────────────────────────

  async function handleDeauthorize(signedRequest) {
    const payload = parseSignedRequest(signedRequest);
    if (!payload?.user_id) return { ok: false };
    const rows = await d.MetaAgentConnection.findAll({
      where: { fbUserIdAppScoped: String(payload.user_id), status: { [Op.in]: LIVE } },
    });
    for (const row of rows) {
      // Access is already revoked at Meta — skip the remote unsubscribe.
      await disconnectConnection(row, { reason: 'fb_deauthorized', remote: false });
    }
    return { ok: true, disconnected: rows.length };
  }

  async function handleDataDeletion(signedRequest) {
    const payload = parseSignedRequest(signedRequest);
    if (!payload?.user_id) return null;
    const rows = await d.MetaAgentConnection.findAll({
      where: { fbUserIdAppScoped: String(payload.user_id) },
    });
    for (const row of rows) {
      if (LIVE.includes(row.status)) await disconnectConnection(row, { reason: 'fb_data_deletion', remote: false });
      await row.update({ statusDetail: 'data_deletion', candidatePages: null, grantedScopes: null, pageTasks: null, lastError: null });
    }
    const code = rows[0]?.id || crypto.randomBytes(8).toString('hex');
    return { url: `https://redeem.sg/fb-data-deletion?code=${code}`, confirmation_code: String(code) };
  }

  // ── daily token health probe ─────────────────────────────────────────────

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
        }
        await row.update(patch);
        probed += 1;
      } catch (err) {
        d.logger.warn('[MetaConnect] health probe failed for connection', { connectionId: row.id, error: redactGraphError(err?.message) });
        await row.update({ lastTokenCheckAt: new Date() }).catch(() => {});
      }
    }
    return { probed };
  }

  return {
    startConnect, handleOAuthCallback, drainMetaConnections, processConnection,
    selectPage, getConnectionStatus, disconnect, handleDeauthorize,
    handleDataDeletion, probeConnectionsHealth, ensureMetaAgentQr, formNameFor,
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
export const handleDeauthorize = _default.handleDeauthorize;
export const handleDataDeletion = _default.handleDataDeletion;
export const probeConnectionsHealth = _default.probeConnectionsHealth;
