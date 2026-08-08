import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';
import { makeMetaConnectService, parseSignedRequest, callbackUri } from '../../src/services/metaConnectService.js';
import { GraphError } from '../../src/services/metaGraphClient.js';

process.env.META_PAGE_TOKEN_ENC_KEY = 'a'.repeat(64);
process.env.META_APP_ID = '1957';
process.env.FB_LOGIN_CONFIG_ID = 'cfg-1';
process.env.META_AGENT_ADS_CAMPAIGN_ID = 'camp-agent-ads';
process.env.META_APP_SECRET = 'app-secret-under-test';

const USER = { id: 'user-1', mktrLeadsId: 'mk-uuid-1', isActive: true, role: 'agent', firstName: 'Lee', lastName: 'Yi Heng' };

function fakeTx() {
  const t = { LOCK: { UPDATE: 'UPDATE' }, finished: null };
  t.commit = jest.fn(async () => { t.finished = 'commit'; });
  t.rollback = jest.fn(async () => { t.finished = 'rollback'; });
  return t;
}
function fakeSequelize() {
  return {
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

function makeDeps(overrides = {}) {
  const connections = [];
  const deps = {
    sequelize: fakeSequelize(),
    User: { findOne: jest.fn().mockResolvedValue({ ...USER }), findByPk: jest.fn().mockResolvedValue({ ...USER }) },
    Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'camp-agent-ads', status: 'active' }) },
    QrTag: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(async (f) => ({ id: 'qr-1', ...f })), findByPk: jest.fn() },
    MetaPage: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(async (f) => ({ id: 'mp-1', ...f, update: jest.fn() })), findByPk: jest.fn(), update: jest.fn().mockResolvedValue([1]) },
    MetaFormMapping: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(async (f) => ({ id: 'map-1', ...f })), findByPk: jest.fn(), update: jest.fn().mockResolvedValue([1]) },
    MetaAgentConnection: {
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (f) => { const r = rowify({ id: 'cx-1', attempts: 0, ...f }); connections.push(r); return r; }),
      update: jest.fn().mockResolvedValue([1]),
    },
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

describe('metaConnectService (unit)', () => {
  describe('parseSignedRequest', () => {
    const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const make = (payload, secret = process.env.META_APP_SECRET) => {
      const p = b64url(Buffer.from(JSON.stringify(payload)));
      const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
      return `${sig}.${p}`;
    };
    it('accepts a correctly signed request', () => {
      expect(parseSignedRequest(make({ user_id: '42', algorithm: 'HMAC-SHA256' }))).toMatchObject({ user_id: '42' });
    });
    it('rejects tampering, wrong secret, and unknown algorithms', () => {
      const good = make({ user_id: '42' });
      expect(parseSignedRequest(`${good}x`)).toBeNull();
      expect(parseSignedRequest(make({ user_id: '42' }, 'other'))).toBeNull();
      expect(parseSignedRequest(make({ user_id: '42', algorithm: 'RSA' }))).toBeNull();
    });
  });

  describe('startConnect', () => {
    it('mirror miss → one sync attempt → agent_sync_pending 503', async () => {
      const { deps } = makeDeps();
      deps.User.findOne = jest.fn().mockResolvedValue(null);
      const svc = makeMetaConnectService(deps);
      await expect(svc.startConnect({ agentMktrUserId: 'mk-x' })).rejects.toMatchObject({ code: 'agent_sync_pending' });
      expect(deps.syncAgents).toHaveBeenCalledTimes(1);
    });

    it('creates a row and a dialog URL carrying config_id + opaque state', async () => {
      const { deps, connections } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const { startUrl } = await svc.startConnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(startUrl).toContain('facebook.com/dialog/oauth');
      expect(startUrl).toContain('config_id=cfg-1');
      expect(startUrl).toContain(encodeURIComponent(callbackUri()));
      const nonce = new URL(startUrl).searchParams.get('state');
      expect(nonce).toHaveLength(48);
      expect(connections[0].stateNonce).toBe(nonce);
      // Opaque: the state is the nonce and nothing else.
      expect(nonce).not.toContain(USER.mktrLeadsId);
    });

    it('fresh in-flight provisioning → 409 in_progress; stale one restarts', async () => {
      const { deps } = makeDeps();
      const live = rowify({ id: 'cx-9', status: 'provisioning', nextAttemptAt: new Date(Date.now() + 240000), attempts: 1 });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(live);
      const svc = makeMetaConnectService(deps);
      await expect(svc.startConnect({ agentMktrUserId: USER.mktrLeadsId })).rejects.toMatchObject({ code: 'in_progress' });

      live.nextAttemptAt = new Date(Date.now() - 10 * 60000);
      const r = await svc.startConnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(r.startUrl).toContain('state=');
      expect(live.status).toBe('awaiting_callback');
    });

    it('reauth on a connected row keeps receipts and refreshes the nonce', async () => {
      const { deps } = makeDeps();
      const live = rowify({ id: 'cx-2', status: 'connected', qrTagId: 'qr-1', formId: 'f-1', attempts: 3 });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(live);
      const svc = makeMetaConnectService(deps);
      await svc.startConnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(live.status).toBe('awaiting_callback');
      expect(live.qrTagId).toBe('qr-1');
      expect(live.formId).toBe('f-1');
      expect(live.attempts).toBe(0);
      expect(live.stateNonce).toHaveLength(48);
    });
  });

  describe('handleOAuthCallback', () => {
    it('unknown or replayed state → bad_state', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      expect(await svc.handleOAuthCallback({ code: 'c', state: 'nope' })).toMatchObject({ redirect: 'error', code: 'bad_state' });

      const row = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1' });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      deps.MetaAgentConnection.update = jest.fn().mockResolvedValue([0]); // raced consume
      expect(await svc.handleOAuthCallback({ code: 'c', state: 'N1' })).toMatchObject({ redirect: 'error', code: 'bad_state' });
    });

    it('user denial fails the row without a code stash', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1' });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleOAuthCallback({ state: 'N1', error: 'access_denied' });
      expect(r).toMatchObject({ redirect: 'denied', code: 'user_denied' });
      expect(row.status).toBe('failed');
      expect(row.oauthCodeEnc).toBeNull();
    });

    it('happy path seals the code and enters provisioning', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'awaiting_callback', stateNonce: 'N1' });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleOAuthCallback({ code: 'THE-CODE', state: 'N1' });
      expect(r).toMatchObject({ redirect: 'pending' });
      expect(row.status).toBe('provisioning');
      expect(row.oauthCodeEnc).toBeTruthy();
      expect(row.oauthCodeEnc).not.toContain('THE-CODE');
    });
  });

  describe('processConnection', () => {
    const baseRow = () => rowify({
      id: 'cx-1', userId: USER.id, status: 'provisioning', attempts: 1,
      oauthCodeEnc: null, fbUserIdAppScoped: null, pageId: null, qrTagId: null, formId: null,
    });

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
        if (path === 'me/permissions') return [{ permission: 'leads_retrieval', status: 'granted' }];
        if (path === 'me/accounts') return pages;
        if (String(path).endsWith('/leadgen_forms')) return [];
        throw new Error(`unexpected paged call ${path}`);
      });
    }

    async function sealCodeOnto(svc, deps, row) {
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      row.stateNonce = 'N1'; row.status = 'awaiting_callback';
      await svc.handleOAuthCallback({ code: 'CODE-1', state: 'N1' });
    }

    it('happy path: exchange once, wire everything, wipe secrets, connect', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      await sealCodeOnto(svc, deps, row);
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'Redeem SG', access_token: 'PAGE-TOK', tasks: ['MANAGE'] }] });

      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'connected' });
      expect(deps.graph.exchangeCodeForLongLivedToken).toHaveBeenCalledTimes(1);
      expect(deps.MetaPage.create).toHaveBeenCalledWith(expect.objectContaining({
        pageId: '111', isActive: true, connectedVia: 'oauth', connectionId: 'cx-1',
      }));
      const sealed = deps.MetaPage.create.mock.calls[0][0].accessTokenEnc;
      expect(sealed).toBeTruthy();
      expect(sealed).not.toContain('PAGE-TOK');
      expect(deps.QrTag.create).toHaveBeenCalledWith(expect.objectContaining({
        assignedAgentId: USER.id, ownerUserId: USER.id, type: 'meta_agent', campaignId: 'camp-agent-ads',
      }));
      expect(deps.MetaFormMapping.create).toHaveBeenCalledWith(expect.objectContaining({
        formId: 'form-77', campaignId: 'camp-agent-ads', qrTagId: 'qr-1', isActive: true,
      }));
      expect(row.status).toBe('connected');
      expect(row.oauthCodeEnc).toBeNull();
      expect(row.formId).toBe('form-77');
    });

    it('two pages → needs_page_selection with NO tokens in the candidates', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      await sealCodeOnto(svc, deps, row);
      wireHappyGraph(deps, {
        pages: [
          { id: '111', name: 'Page A', access_token: 'TOK-A' },
          { id: '222', name: 'Page B', access_token: 'TOK-B' },
        ],
      });
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'needs_page_selection' });
      expect(row.candidatePages).toEqual([{ id: '111', name: 'Page A' }, { id: '222', name: 'Page B' }]);
      expect(JSON.stringify(row.candidatePages)).not.toContain('TOK-');
    });

    it('zero pages → failed no_pages, secrets wiped', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      await sealCodeOnto(svc, deps, row);
      wireHappyGraph(deps, { pages: [] });
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'failed' });
      expect(row.statusDetail).toBe('no_pages');
      expect(row.oauthCodeEnc).toBeNull();
    });

    it('leadgen TOS not accepted → failed leadgen_tos_required', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      await sealCodeOnto(svc, deps, row);
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T' }] });
      deps.graph.call.mockImplementation(async (path, opts = {}) => {
        if (path === 'me') return { id: 'fb-user-9' };
        if (String(path).match(/^\d+$/)) return { leadgen_tos_accepted: false };
        return {};
      });
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'failed' });
      expect(row.statusDetail).toBe('leadgen_tos_required');
    });

    it('existing form with the deterministic name is reused, never duplicated', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      await sealCodeOnto(svc, deps, row);
      wireHappyGraph(deps, { pages: [{ id: '111', name: 'P', access_token: 'T' }] });
      deps.graph.callAllPages.mockImplementation(async (path) => {
        if (path === 'me/permissions') return [];
        if (path === 'me/accounts') return [{ id: '111', name: 'P', access_token: 'T' }];
        if (String(path).endsWith('/leadgen_forms')) return [{ id: 'form-EXISTING', name: svc.formNameFor(USER) }];
        return [];
      });
      await svc.processConnection(row);
      expect(row.formId).toBe('form-EXISTING');
      const formCreates = deps.graph.call.mock.calls.filter(([p, o]) => String(p).endsWith('/leadgen_forms') && o?.method === 'POST');
      expect(formCreates).toHaveLength(0);
    });

    it('agent mirror vanished mid-flight → waiting_for_agent', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      deps.User.findOne = jest.fn().mockResolvedValue(null);
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'waiting_for_agent' });
    });

    it('permanent OAuth exchange error → failed with taxonomy, not a retry loop', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      const row = baseRow();
      await sealCodeOnto(svc, deps, row);
      deps.graph.exchangeCodeForLongLivedToken = jest.fn().mockRejectedValue(new GraphError('bad code', { retryable: false, code: 100 }));
      const r = await svc.processConnection(row);
      expect(r).toEqual({ status: 'failed' });
      expect(row.statusDetail).toMatch(/oauth_exchange/);
      expect(row.oauthCodeEnc).toBeNull();
    });
  });

  describe('selectPage / disconnect', () => {
    it('select validates against the stored candidate set', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'needs_page_selection', candidatePages: [{ id: '111', name: 'A' }] });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      const svc = makeMetaConnectService(deps);
      await expect(svc.selectPage({ agentMktrUserId: USER.mktrLeadsId, pageId: '999' })).rejects.toMatchObject({ code: 'invalid_page' });
      await svc.selectPage({ agentMktrUserId: USER.mktrLeadsId, pageId: '111' });
      expect(row.status).toBe('provisioning');
      expect(row.pageId).toBe('111');
    });

    it('disconnect: remote unsubscribe BEFORE token wipe, then tombstone + mapping off', async () => {
      const { deps } = makeDeps();
      const { sealPageToken } = await import('../../src/services/metaPageTokens.js');
      const pageRow = { id: 'mp-1', pageId: '111', accessTokenEnc: sealPageToken('PAGE-TOK', '111') };
      const row = rowify({ id: 'cx-1', userId: USER.id, status: 'connected', metaPageRowId: 'mp-1', mappingId: 'map-1' });
      deps.MetaAgentConnection.findOne = jest.fn().mockResolvedValue(row);
      deps.MetaPage.findByPk = jest.fn().mockResolvedValue(pageRow);
      const calls = [];
      deps.graph.call = jest.fn(async (path, opts) => { calls.push([path, opts?.method]); return {}; });
      const svc = makeMetaConnectService(deps);

      await svc.disconnect({ agentMktrUserId: USER.mktrLeadsId });
      expect(calls).toContainEqual(['111/subscribed_apps', 'DELETE']);
      expect(deps.MetaAgentConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'disconnected', disconnectReason: 'agent_request', oauthCodeEnc: null }),
        expect.objectContaining({ where: { id: 'cx-1' } })
      );
      expect(deps.MetaFormMapping.update).toHaveBeenCalledWith({ isActive: false }, expect.objectContaining({ where: { id: 'map-1' } }));
      expect(deps.MetaPage.update).toHaveBeenCalledWith(
        { isActive: false, accessTokenEnc: null },
        expect.objectContaining({ where: { id: 'mp-1' } })
      );
    });
  });

  describe('platform callbacks', () => {
    const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signedFor = (userId) => {
      const p = b64url(Buffer.from(JSON.stringify({ user_id: userId, algorithm: 'HMAC-SHA256' })));
      const sig = b64url(crypto.createHmac('sha256', process.env.META_APP_SECRET).update(p).digest());
      return `${sig}.${p}`;
    };

    it('deauthorize disconnects every live connection for the fb user WITHOUT a remote call', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-1', status: 'connected', metaPageRowId: 'mp-1', mappingId: null, fbUserIdAppScoped: 'fb-9' });
      deps.MetaAgentConnection.findAll = jest.fn().mockResolvedValue([row]);
      deps.MetaPage.findByPk = jest.fn().mockResolvedValue({ id: 'mp-1', pageId: '111', accessTokenEnc: 'sealed' });
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleDeauthorize(signedFor('fb-9'));
      expect(r).toEqual({ ok: true, disconnected: 1 });
      expect(deps.graph.call).not.toHaveBeenCalled();
    });

    it('data deletion returns the Meta-required {url, confirmation_code} shape', async () => {
      const { deps } = makeDeps();
      const row = rowify({ id: 'cx-77', status: 'disconnected', fbUserIdAppScoped: 'fb-9' });
      deps.MetaAgentConnection.findAll = jest.fn().mockResolvedValue([row]);
      const svc = makeMetaConnectService(deps);
      const r = await svc.handleDataDeletion(signedFor('fb-9'));
      expect(r.confirmation_code).toBe('cx-77');
      expect(r.url).toContain('fb-data-deletion?code=cx-77');
    });

    it('bad signature yields null / not-ok', async () => {
      const { deps } = makeDeps();
      const svc = makeMetaConnectService(deps);
      expect(await svc.handleDeauthorize('garbage.payload')).toEqual({ ok: false });
      expect(await svc.handleDataDeletion('garbage.payload')).toBeNull();
    });
  });
});
