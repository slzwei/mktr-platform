import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';
import {
  makeMetaConnectService, parseSignedRequest, callbackUri,
  armMetaOauth, disarmMetaOauthForTests,
} from '../../src/services/metaConnectService.js';
import { sealPageToken } from '../../src/services/metaPageTokens.js';
import { GraphError } from '../../src/services/metaGraphClient.js';

process.env.META_PAGE_TOKEN_ENC_KEY = 'a'.repeat(64);
process.env.META_APP_ID = '1957';
process.env.FB_LOGIN_CONFIG_ID = 'cfg-1';
process.env.META_AGENT_ADS_CAMPAIGN_ID = 'camp-agent-ads';
process.env.META_APP_SECRET = 'app-secret-under-test';

const ALL_SCOPES = ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'pages_manage_ads'];
const USER = { id: 'user-1', mktrLeadsId: 'mk-uuid-1', isActive: true, role: 'agent', firstName: 'Lee', lastName: 'Yi Heng' };

function fakeTx() {
  const t = { LOCK: { UPDATE: 'UPDATE' }, finished: null };
  t.commit = jest.fn(async () => { t.finished = 'commit'; });
  t.rollback = jest.fn(async () => { t.finished = 'rollback'; });
  return t;
}
function fakeSequelize() {
  return {
    literal: jest.fn((s) => s),
    transaction: jest.fn(async (fn) => {
      const t = fakeTx();
      if (typeof fn === 'function') { const r = await fn(t); t.finished = 'commit'; return r; }
      return t;
    }),
  };
}
function rowify(fields) {
  const row = { ...fields };
  row.update = jest.fn(async (patch) => { Object.assign(row, patch); return row; });
  return row;
}
const sealFor = (row, value) => sealPageToken(value, `cx:${row.id}`);

function makeDeps(overrides = {}) {
  const connections = [];
  const deps = {
    sequelize: fakeSequelize(),
    User: { findOne: jest.fn().mockResolvedValue({ ...USER }), findByPk: jest.fn().mockResolvedValue({ ...USER }) },
    Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'camp-agent-ads', status: 'active' }) },
    QrTag: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(async (f) => ({ id: 'qr-1', ...f })), findByPk: jest.fn().mockResolvedValue(null) },
    MetaPage: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(async (f) => ({ id: 'mp-1', ...f, update: jest.fn() })), findByPk: jest.fn(), update: jest.fn().mockResolvedValue([1]) },
    MetaFormMapping: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(async (f) => ({ id: 'map-1', ...f })), findByPk: jest.fn(), update: jest.fn().mockResolvedValue([1]) },
    MetaAgentConnection: {
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      findByPk: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (f) => { const r = rowify({ id: 'cx-1', attempts: 0, ...f }); connections.push(r); return r; }),
      update: jest.fn().mockResolvedValue([1]),
    },
    Prospect: { findOne: jest.fn().mockResolvedValue(null) },
    syncAgents: jest.fn().mockResolvedValue({}),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    graph: {
      call: jest.fn(),
      callAllPages: jest.fn(),
      exchangeCodeForLongLivedToken: jest.fn().mockResolvedValue({ token: 'LL-USER-TOKEN', expiresIn: 5184000 }),
    },
    ...overrides,
  };
  return { deps, connections };
}

/**
 * The service fences via MODEL update + Object.assign — the stub returning
 * [1] keeps rows mutating exactly like the real conditional update would on
 * an owned claim. Fence-loss cases override the stub to [0].
 */
function wireHappyGraph(deps, { pages }) {
  deps.graph.call.mockImplementation(async (path, opts = {}) => {
    if (path === 'me') return { id: 'fb-user-9' };
    if (String(path).endsWith('/subscribed_apps') && opts.method === 'POST') return { success: true };
    if (String(path).endsWith('/subscribed_apps')) return { data: [{ id: process.env.META_APP_ID }] };
    if (String(path).match(/^\d+$/)) return { leadgen_tos_accepted: true };
    if (String(path).endsWith('/leadgen_forms') && opts.method === 'POST') return { id: 'form-77' };
    throw new Error(`unexpected graph call ${path}`);
  });
  deps.graph.callAllPages.mockImplementation(async (path) => {
    if (path === 'me/permissions') return ALL_SCOPES.map((p) => ({ permission: p, status: 'granted' }));
    if (path === 'me/accounts') return pages;
    if (String(path).endsWith('/leadgen_forms')) return [];
    throw new Error(`unexpected paged call ${path}`);
  });
}

const provisioningRow = (over = {}) => {
  const row = rowify({
    id: 'cx-1', userId: USER.id, status: 'provisioning', attempts: 1,
    fbUserIdAppScoped: null, pageId: null, qrTagId: null, formId: null,
    connectedAt: null, ...over,
  });
  if (!('oauthCodeEnc' in over)) {
    row.oauthCodeEnc = sealFor(row, 'CODE-1');
    row.secretKind = 'oauth_code';
  }
  return row;
};

beforeEach(() => { armMetaOauth(); });

describe('metaConnectService (unit)', () => {
  describe('armed latch (F7)', () => {
    it('startConnect and callback refuse until bootstrap arms the subsystem', async () => {
      disarmMetaOauthForTests();
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      await expect(svc.startConnect({ agentMktrUserId: 'x' })).rejects.toMatchObject({ code: 'not_armed' });
      expect(await svc.handleOAuthCallback({ code: 'c', state: 's' })).toMatchObject({ code: 'not_armed' });
    });
  });

  describe('parseSignedRequest', () => {
    const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const make = (payload, secret = process.env.META_APP_SECRET) => {
      const p = b64url(Buffer.from(JSON.stringify(payload)));
      const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
      return `${sig}.${p}`;
    };
    it('accepts correct signatures, rejects tamper/wrong-secret/foreign algos', () => {
      expect(parseSignedRequest(make({ user_id: '42', algorithm: 'HMAC-SHA256' }))).toMatchObject({ user_id: '42' });
      expect(parseSignedRequest(`${make({ user_id: '42' })}x`)).toBeNull();
      expect(parseSignedRequest(make({ user_id: '42' }, 'other'))).toBeNull();
      expect(parseSignedRequest(make({ user_id: '42', algorithm: 'RSA' }))).toBeNull();
    });
  });

  describe('startConnect (F8: serialized, expiring state)', () => {
    it('mirror miss → one sync attempt → agent_sync_pending', async () => {
      const { deps } = makeDeps();
      deps.User.findOne = jest.fn().mockResolvedValue(null);
      const svc = makeMetaConnectService(deps);
      await expect(svc.startConnect({ agentMktrUserId: 'mk-x' })).rejects.toMatchObject({ code: 'agent_sync_pending' });
      expect(deps.syncAgents).toHaveBeenCalledTimes(1);
    });

    it('creates a row with an opaque expiring state and a config_id dialog URL', async () => {
      const { deps, connections } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const { startUrl } = await svc.startConnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(startUrl).toContain('facebook.com/dialog/oauth');
      expect(startUrl).toContain('config_id=cfg-1');
      expect(startUrl).toContain(encodeURIComponent(callbackUri()));
      const nonce = new URL(startUrl).searchParams.get('state');
      expect(nonce).toHaveLength(48);
      expect(connections[0].stateNonce).toBe(nonce);
      expect(new Date(connections[0].stateExpiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(nonce).not.toContain(USER.mktrLeadsId);
    });

    it('unique-create race maps to 409 in_progress', async () => {
      const { deps } = makeDeps();
      deps.MetaAgentConnection.create = jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));
      const svc = makeMetaConnectService(deps);
      await expect(svc.startConnect({ agentMktrUserId: USER.mktrLeadsId })).rejects.toMatchObject({ code: 'in_progress' });
    });

    it('reauth on a connected row keeps receipts + pageId and clears the secret phase', async () => {
      const { deps } = makeDeps();
      const live = rowify({ id: 'cx-2', status: 'connected', connectedAt: new Date(), pageId: '111', qrTagId: 'qr-1', formId: 'f-1', attempts: 3, secretKind: 'long_token', oauthCodeEnc: 'sealed' });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(live);
      const svc = makeMetaConnectService(deps);
      await svc.startConnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(live.status).toBe('awaiting_callback');
      expect(live.pageId).toBe('111');
      expect(live.qrTagId).toBe('qr-1');
      expect(live.secretKind).toBeNull();
      expect(live.oauthCodeEnc).toBeNull();
    });
  });

  describe('handleOAuthCallback (F1/F8)', () => {
    it('unknown state → bad_state; expired state on a previously-connected row RESTORES connected', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      expect(await svc.handleOAuthCallback({ code: 'c', state: 'nope' })).toMatchObject({ code: 'bad_state' });

      const row = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1', stateExpiresAt: new Date(Date.now() - 1000), connectedAt: new Date() });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      const r = await svc.handleOAuthCallback({ code: 'c', state: 'N1' });
      expect(r).toMatchObject({ code: 'state_expired' });
      expect(deps.MetaAgentConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected', statusDetail: 'state_expired' }),
        expect.objectContaining({ where: expect.objectContaining({ id: 'cx-1' }) })
      );
    });

    it('denial on a FIRST connect fails; denial on reauth restores connected (assets never orphaned)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const fresh = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1', stateExpiresAt: new Date(Date.now() + 60000), connectedAt: null });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(fresh);
      await svc.handleOAuthCallback({ state: 'N1', error: 'access_denied' });
      expect(deps.MetaAgentConnection.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'failed', statusDetail: 'user_denied' }),
        expect.anything()
      );

      const reauth = rowify({ id: 'cx-2', status: 'awaiting_callback', stateNonce: 'N2', stateExpiresAt: new Date(Date.now() + 60000), connectedAt: new Date() });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(reauth);
      await svc.handleOAuthCallback({ state: 'N2', error: 'access_denied' });
      expect(deps.MetaAgentConnection.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'connected', statusDetail: 'user_denied' }),
        expect.anything()
      );
    });

    it('happy path: ONE conditional transition seals the code with secretKind oauth_code', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1', stateExpiresAt: new Date(Date.now() + 60000) });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleOAuthCallback({ code: 'THE-CODE', state: 'N1' });
      expect(r).toMatchObject({ redirect: 'pending' });
      const [patch, where] = deps.MetaAgentConnection.update.mock.calls.at(-1);
      expect(patch).toMatchObject({ status: 'provisioning', secretKind: 'oauth_code', stateNonce: null });
      expect(patch.oauthCodeEnc).not.toContain('THE-CODE');
      expect(where.where).toMatchObject({ id: 'cx-1', stateNonce: 'N1', status: 'awaiting_callback' });
    });

    it('a raced duplicate loses the conditional update → bad_state', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1', stateExpiresAt: new Date(Date.now() + 60000) });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      deps.MetaAgentConnection.update = jest.fn().mockResolvedValue([0]);
      const svc = makeMetaConnectService(deps);
      expect(await svc.handleOAuthCallback({ code: 'c', state: 'N1' })).toMatchObject({ code: 'bad_state' });
    });
  });

  describe('processConnection', () => {
    it('happy path: exchange → token persisted IMMEDIATELY (F2) → scopes enforced → page reserved → wired → connected, secrets wiped', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'Redeem SG', access_token: 'PAGE-TOK', tasks: ['MANAGE'] }] });

      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'connected' });
      // F2: the very first fenced patch after the exchange carries the token phase.
      const patches = deps.MetaAgentConnection.update.mock.calls.map(([p]) => p);
      const tokenPatchIdx = patches.findIndex((p) => p.secretKind === 'long_token');
      const identityPatchIdx = patches.findIndex((p) => p.fbUserIdAppScoped);
      expect(tokenPatchIdx).toBeGreaterThanOrEqual(0);
      expect(tokenPatchIdx).toBeLessThan(identityPatchIdx);
      // Reservation happened before wiring; final state on the row:
      expect(row.pageId).toBe('111');
      expect(row.status).toBe('connected');
      expect(row.oauthCodeEnc).toBeNull();
      expect(row.secretKind).toBeNull();
      expect(deps.MetaPage.create).toHaveBeenCalledWith(expect.objectContaining({ pageId: '111', connectedVia: 'oauth' }));
      expect(deps.MetaPage.create.mock.calls[0][0].accessTokenEnc).not.toContain('PAGE-TOK');
      expect(deps.QrTag.create).toHaveBeenCalledWith(expect.objectContaining({ assignedAgentId: USER.id, type: 'meta_agent' }));
      expect(deps.MetaFormMapping.create).toHaveBeenCalledWith(expect.objectContaining({ formId: 'form-77', qrTagId: 'qr-1' }));
    });

    it('resume after crash-post-exchange does NOT re-exchange (secretKind long_token)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow({ oauthCodeEnc: null });
      row.oauthCodeEnc = sealFor(row, 'LL-USER-TOKEN');
      row.secretKind = 'long_token';
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T', tasks: ['MANAGE'] }] });
      await svc.processConnection(row);
      expect(deps.graph.exchangeCodeForLongLivedToken).not.toHaveBeenCalled();
      expect(row.status).toBe('connected');
    });

    it('ANY exchange failure demands a fresh dialog — reauth_required when previously connected, failed otherwise (F1/F2)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      deps.graph.exchangeCodeForLongLivedToken = jest.fn().mockRejectedValue(new GraphError('timeout', { retryable: true }));

      const fresh = provisioningRow();
      expect(await svc.processConnection(fresh)).toEqual({ status: 'failed' });
      expect(fresh.statusDetail).toBe('oauth_exchange_failed');
      expect(fresh.oauthCodeEnc).toBeNull();

      const reauth = provisioningRow({ id: 'cx-9', connectedAt: new Date() });
      expect(await svc.processConnection(reauth)).toEqual({ status: 'reauth_required' });
    });

    it('a row stranded mid-exchange resumes as code_ambiguous — the code is never replayed (round-2 #2)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow({ oauthCodeEnc: null });
      row.oauthCodeEnc = sealFor(row, 'MAYBE-SPENT-CODE');
      row.secretKind = 'exchanging';
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'failed' });
      expect(row.statusDetail).toBe('code_ambiguous');
      expect(deps.graph.exchangeCodeForLongLivedToken).not.toHaveBeenCalled();
    });

    it('a page with MISSING or empty tasks is terminal page_task_missing (round-2 #10)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T' }] }); // no tasks at all
      await svc.processConnection(row);
      expect(row.status).toBe('failed');
      expect(row.statusDetail).toBe('page_task_missing');
    });

    it('missing required scopes → terminal missing_permissions (F10)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [] });
      deps.graph.callAllPages.mockImplementation(async (path) => {
        if (path === 'me/permissions') return [{ permission: 'leads_retrieval', status: 'granted' }];
        return [];
      });
      await svc.processConnection(row);
      expect(row.status).toBe('failed');
      expect(row.statusDetail).toMatch(/^missing_permissions:/);
    });

    it('two pages → needs_page_selection (no tokens in candidates); zero pages → no_pages', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [{ id: '1', name: 'A', access_token: 'TA' }, { id: '2', name: 'B', access_token: 'TB' }] });
      expect(await svc.processConnection(row)).toEqual({ status: 'needs_page_selection' });
      expect(JSON.stringify(row.candidatePages)).not.toContain('T');

      const row2 = provisioningRow({ id: 'cx-2' });
      wireHappyGraph(deps, { pages: [] });
      await svc.processConnection(row2);
      expect(row2.statusDetail).toBe('no_pages');
    });

    it('page reservation unique-conflict → terminal page_in_use, never a retry loop (F3)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T', tasks: ['MANAGE'] }] });
      let call = 0;
      deps.MetaAgentConnection.update = jest.fn(async (patch) => {
        call += 1;
        if (patch.pageId && !patch.status) {
          const err = new Error('dup'); err.name = 'SequelizeUniqueConstraintError'; throw err;
        }
        return [1];
      });
      await svc.processConnection(row);
      expect(row.status).toBe('failed');
      expect(row.statusDetail).toBe('page_in_use');
      expect(call).toBeGreaterThan(0);
    });

    it('admin-managed meta_pages row is never taken over (F3)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T', tasks: ['MANAGE'] }] });
      deps.MetaPage.findOne = jest.fn().mockResolvedValue({ id: 'mp-adm', pageId: '111', connectionId: null, connectedVia: null });
      await svc.processConnection(row);
      expect(row.status).toBe('failed');
      expect(row.statusDetail).toBe('page_admin_managed');
    });

    it('token-dead Graph error (190) on a reauth journey → reauth_required (F16)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow({ connectedAt: new Date(), oauthCodeEnc: null });
      row.oauthCodeEnc = sealFor(row, 'LL'); row.secretKind = 'long_token';
      deps.graph.call.mockRejectedValue(new GraphError('expired', { retryable: false, code: 190 }));
      deps.graph.callAllPages.mockRejectedValue(new GraphError('expired', { retryable: false, code: 190 }));
      await svc.processConnection(row);
      expect(row.status).toBe('reauth_required');
    });

    it('agent mirror missing → waiting_for_agent via markRetry (requeued, F13)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      deps.User.findOne = jest.fn().mockResolvedValue(null);
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'waiting_for_agent' });
      expect(deps.MetaAgentConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'waiting_for_agent' }),
        expect.objectContaining({ where: expect.objectContaining({ id: row.id }) })
      );
    });

    it('fence lost to a disconnect mid-run → freshly wired assets cleaned (F4)', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = provisioningRow();
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T', tasks: ['MANAGE'] }] });
      // Lose the fence at the metaPageRowId receipt (after MetaPage.create).
      deps.MetaAgentConnection.update = jest.fn(async (patch) => (patch.metaPageRowId ? [0] : [1]));
      deps.MetaAgentConnection.findByPk = jest.fn().mockResolvedValue({ id: row.id, status: 'disconnected' });
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'fence_lost' });
      expect(deps.MetaPage.update).toHaveBeenCalledWith(
        { isActive: false, accessTokenEnc: null },
        expect.objectContaining({ where: { id: 'mp-1' } })
      );
    });
  });

  describe('disconnect ordering (F11) + platform callbacks (F12)', () => {
    it('disconnect: local intake dies in one txn (token KEPT), then remote unsubscribe, then token wipe', async () => {
      const { deps } = makeDeps();
      const pageRow = { id: 'mp-1', pageId: '111', connectionId: 'cx-1', accessTokenEnc: sealPageToken('PAGE-TOK', '111') };
      const row = rowify({ id: 'cx-1', userId: USER.id, status: 'connected', metaPageRowId: 'mp-1', mappingId: 'map-1' });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      // The teardown read is ownership-conditioned (round-2 NEW-1): findOne
      // with {id, connectionId} — still OUR page here, so it resolves.
      deps.MetaPage.findOne = jest.fn().mockResolvedValue(pageRow);
      const order = [];
      deps.MetaPage.update = jest.fn(async (patch) => { order.push(patch.accessTokenEnc === null && !('isActive' in patch) ? 'wipe' : 'deactivate'); return [1]; });
      deps.graph.call = jest.fn(async (path, opts) => { order.push(`remote:${opts?.method}`); return {}; });
      const svc = makeMetaConnectService(deps);

      await svc.disconnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(order).toEqual(['deactivate', 'remote:DELETE', 'wipe']);
      expect(deps.MetaAgentConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'disconnected', disconnectReason: 'agent_request' }),
        expect.objectContaining({ where: expect.objectContaining({ id: 'cx-1' }) })
      );
    });

    it('a takeover by a reconnect makes the old disconnect a NO-OP on the page (round-2 NEW-1)', async () => {
      const { deps } = makeDeps();
      // The page row is now owned by a DIFFERENT connection — teardown reads
      // are conditioned on ownership and must find nothing.
      const row = rowify({ id: 'cx-OLD', userId: USER.id, status: 'connected', metaPageRowId: 'mp-1', mappingId: null });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      deps.MetaPage.findOne = jest.fn().mockResolvedValue(null); // ownership predicate misses
      const svc = makeMetaConnectService(deps);
      await svc.disconnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(deps.graph.call).not.toHaveBeenCalled(); // no unsubscribe of the new owner
      // The token wipe carried the ownership predicate.
      const wipe = deps.MetaPage.update.mock.calls.find(([p]) => p.accessTokenEnc === null && !('isActive' in p));
      expect(wipe[1].where).toMatchObject({ id: 'mp-1', connectionId: 'cx-OLD' });
    });

    const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signedFor = (userId) => {
      const p = b64url(Buffer.from(JSON.stringify({ user_id: userId, algorithm: 'HMAC-SHA256' })));
      const sig = b64url(crypto.createHmac('sha256', process.env.META_APP_SECRET).update(p).digest());
      return `${sig}.${p}`;
    };

    it('deauthorize disconnects live connections WITHOUT a remote call', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'connected', metaPageRowId: 'mp-1', mappingId: null, fbUserIdAppScoped: 'fb-9' });
      deps.MetaAgentConnection.findAll = jest.fn().mockResolvedValue([row]);
      deps.MetaPage.findByPk = jest.fn().mockResolvedValue({ id: 'mp-1', pageId: '111', accessTokenEnc: 'sealed' });
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleDeauthorize(signedFor('fb-9'));
      expect(r).toEqual({ ok: true, disconnected: 1 });
      expect(deps.graph.call).not.toHaveBeenCalled();
    });

    it('data deletion scrubs EVERY identifier across all statuses and answers an opaque code (F12)', async () => {
      const { deps } = makeDeps();
      const terminal = rowify({
        id: 'cx-77', status: 'failed', fbUserIdAppScoped: 'fb-9', agentMktrUserId: 'mk-1',
        pageId: '111', formId: 'f-1', mappingId: 'map-1', metaPageRowId: 'mp-1', qrTagId: 'qr-1',
      });
      deps.MetaAgentConnection.findAll = jest.fn().mockResolvedValue([terminal]);
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleDataDeletion(signedFor('fb-9'));
      expect(r.confirmation_code).toHaveLength(32);
      expect(r.confirmation_code).not.toBe('cx-77');
      expect(terminal).toMatchObject({
        fbUserIdAppScoped: null, agentMktrUserId: null, pageId: null, formId: null,
        mappingId: null, qrTagId: null, metaPageRowId: null, statusDetail: 'data_deletion',
      });
      // Terminal rows' still-active assets are killed too.
      expect(deps.MetaFormMapping.update).toHaveBeenCalledWith({ isActive: false }, expect.objectContaining({ where: { id: 'map-1' } }));
      expect(deps.MetaPage.update).toHaveBeenCalledWith({ isActive: false, accessTokenEnc: null }, expect.objectContaining({ where: { id: 'mp-1' } }));
    });
  });

  describe('selectPage', () => {
    it('validates against the stored candidates and maps a page-unique race to page_in_use', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'needs_page_selection', candidatePages: [{ id: '111', name: 'A' }] });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      const svc = makeMetaConnectService(deps);
      await expect(svc.selectPage({ agentMktrUserId: USER.mktrLeadsId, pageId: '999' })).rejects.toMatchObject({ code: 'invalid_page' });

      deps.MetaAgentConnection.update = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }))
        .mockResolvedValue([1]);
      await expect(svc.selectPage({ agentMktrUserId: USER.mktrLeadsId, pageId: '111' })).rejects.toMatchObject({ code: 'page_in_use' });
    });
  });
});
