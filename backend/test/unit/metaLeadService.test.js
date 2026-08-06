import { jest } from '@jest/globals';
import '../setup.js';
import { makeMetaLeadService, verifyMetaSignature, redactMetaError } from '../../src/services/metaLeadService.js';
import { isKnownConsentCopyVersion, META_LEADGEN_CONSENT_VERSION } from '../../src/services/contactConsent.js';
import crypto from 'crypto';

const UNMAPPED = { id: 'camp-unmapped', slug: 'meta-unmapped', name: '[Meta] Unmapped', status: 'active', enforceLeadQuota: true, design_config: null };
const MAPPED = { id: 'camp-1', slug: 'real-campaign', name: 'Real Campaign', status: 'active', enforceLeadQuota: false, design_config: null };

function fakeTx() {
  const t = {
    LOCK: { UPDATE: 'UPDATE' },
    finished: null,
  };
  t.commit = jest.fn(async () => { t.finished = 'commit'; });
  t.rollback = jest.fn(async () => { t.finished = 'rollback'; });
  return t;
}

/** sequelize stub supporting both managed (callback) and unmanaged transactions. */
function fakeSequelize() {
  const txs = [];
  return {
    txs,
    transaction: jest.fn(async (fn) => {
      const t = fakeTx();
      txs.push(t);
      if (typeof fn === 'function') {
        const result = await fn(t);
        t.finished = 'commit';
        return result;
      }
      return t;
    }),
  };
}

function fakeRow(overrides = {}) {
  const row = {
    leadgenId: 'lg-1', pageId: 'page-1', formId: 'form-1', createdTime: 1754400000,
    status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null,
    ...overrides,
  };
  row.update = jest.fn(async (patch) => { Object.assign(row, patch); return row; });
  return row;
}

const graphLead = (over = {}) => ({
  field_data: [
    { name: 'full_name', values: ['Tan Ah Kow'] },
    { name: 'phone_number', values: ['+65 9123 4567'] },
    { name: 'email', values: ['ahkow@example.com'] },
    { name: 'which_plan_interests_you', values: ['CareShield upgrade'] },
  ],
  form_id: 'form-1',
  ad_id: 'ad-9', adset_id: 'as-9', campaign_id: 'mc-9',
  platform: 'ig', is_organic: false, created_time: 1754400000,
  custom_disclaimer_responses: [{ checkbox_key: 'mktr_pdpa_consent', is_checked: true }],
  ...over,
});

function makeDeps(overrides = {}) {
  const seq = fakeSequelize();
  const prospectCreated = { id: 'prospect-1', toJSON: () => ({ id: 'prospect-1' }) };
  const deps = {
    sequelize: seq,
    Prospect: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(prospectCreated) },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    Campaign: {
      findOne: jest.fn(async ({ where }) => (where?.slug === 'meta-unmapped' ? { ...UNMAPPED } : null)),
      findByPk: jest.fn(async (id) => (id === MAPPED.id ? { ...MAPPED } : null)),
    },
    QrTag: { findByPk: jest.fn().mockResolvedValue(null) },
    User: { findByPk: jest.fn().mockResolvedValue({ id: 'agent-1', mktrLeadsId: 'mk-uuid', lyfeId: null, phone: '+6588888888', email: 'a@x.com', firstName: 'A', lastName: 'G' }) },
    MetaPage: {},
    MetaLeadgenEvent: {
      findOrCreate: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      // The claim fence: [1] = we still own the row (tests override to [0]
      // to simulate a lost lease).
      update: jest.fn().mockResolvedValue([1]),
    },
    MetaFormMapping: { findOne: jest.fn().mockResolvedValue({ formId: 'form-1', formName: 'CareShield Aug', campaignId: MAPPED.id, qrTagId: null, isActive: true }) },
    resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'agent-1', via: 'package' }),
    decideAssignment: jest.fn().mockResolvedValue({ action: 'assign', assignedAgentId: 'agent-1', charged: false, via: 'package' }),
    chargeLeadCredit: jest.fn(),
    dncCaptureGate: jest.fn().mockReturnValue({ dncBlockApplies: false, dncFlagApplies: false, dncWillCheck: false }),
    gateHeldDncLead: jest.fn().mockResolvedValue({}),
    bakeHoldTargetAgentId: jest.fn(async (id) => id),
    dncEnforcement: jest.fn().mockReturnValue('off'),
    formatDncNumber: jest.fn((p) => p),
    dncCheckAndRecord: jest.fn().mockResolvedValue({}),
    readLegacyViewSafe: jest.fn().mockReturnValue({}),
    resolveConsumerForCaptureTx: jest.fn().mockResolvedValue('consumer-1'),
    recordCaptureConsentEventsTx: jest.fn().mockResolvedValue(1),
    persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: {}, subscriber: {} }]),
    flushDeliveries: jest.fn(),
    sendLeadAssignmentEmail: jest.fn().mockResolvedValue({}),
    resolvePageAccessToken: jest.fn().mockResolvedValue({ token: 'tok' }),
    fetch: jest.fn().mockResolvedValue({ ok: true, json: async () => graphLead() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    ...overrides,
  };
  return { deps, seq, prospectCreated };
}

describe('metaLeadService (unit)', () => {
  const envBackup = {};
  beforeEach(() => {
    for (const k of ['META_APP_SECRET', 'HELD_LEAD_PING_ENABLED']) envBackup[k] = process.env[k];
    delete process.env.HELD_LEAD_PING_ENABLED;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('registers a real consent-copy era for Meta leadgen', () => {
    expect(isKnownConsentCopyVersion(META_LEADGEN_CONSENT_VERSION)).toBe(true);
  });

  describe('verifyMetaSignature', () => {
    it('accepts a correct sha256 signature and rejects everything else', () => {
      process.env.META_APP_SECRET = 's3cret';
      const raw = Buffer.from('{"a":1}');
      const good = `sha256=${crypto.createHmac('sha256', 's3cret').update(raw).digest('hex')}`;
      expect(verifyMetaSignature(raw, good)).toBe(true);
      expect(verifyMetaSignature(raw, good.replace('sha256=', 'sha1='))).toBe(false);
      expect(verifyMetaSignature(raw, 'sha256=deadbeef')).toBe(false);
      expect(verifyMetaSignature(raw, undefined)).toBe(false);
      expect(verifyMetaSignature(undefined, good)).toBe(false);
    });
  });

  it('redactMetaError strips tokens from persisted errors', () => {
    expect(redactMetaError('Graph 400 access_token=EAAB123&x Bearer EAAB.99')).not.toMatch(/EAAB/);
  });

  describe('parseFieldData', () => {
    const { deps } = makeDeps();
    const svc = makeMetaLeadService(deps);

    it('splits full_name, normalizes the phone to E.164, keeps custom Q&A', () => {
      const parsed = svc.parseFieldData(graphLead().field_data);
      expect(parsed).toMatchObject({
        firstName: 'Tan', lastName: 'Ah Kow',
        phone: '+6591234567', email: 'ahkow@example.com',
      });
      expect(parsed.qa).toEqual([{ label: 'which_plan_interests_you', value: 'CareShield upgrade' }]);
    });

    it('keeps the lead when the phone is unparseable — phone null, raw kept for the note', () => {
      const parsed = svc.parseFieldData([
        { name: 'full_name', values: ['X'] },
        { name: 'phone_number', values: ['call me maybe'] },
      ]);
      expect(parsed.phone).toBeNull();
      expect(parsed.rawPhone).toBe('call me maybe');
    });

    it('nulls an invalid email instead of failing the create', () => {
      const parsed = svc.parseFieldData([{ name: 'email', values: ['not-an-email'] }]);
      expect(parsed.email).toBeNull();
      expect(parsed.firstName).toBe('Meta Lead');
    });

    it('local 8-digit SG numbers normalize to +65', () => {
      const parsed = svc.parseFieldData([{ name: 'phone', values: ['9123-4567'] }]);
      expect(parsed.phone).toBe('+6591234567');
    });
  });

  describe('consentFromLead', () => {
    const { deps } = makeDeps();
    const svc = makeMetaLeadService(deps);

    it('reads the custom disclaimer checkbox: checked ⇒ true; unchecked/absent ⇒ undefined (never an explicit denial)', () => {
      const parsed = { consentFieldValue: undefined };
      expect(svc.consentFromLead(graphLead(), parsed)).toBe(true);
      expect(svc.consentFromLead(graphLead({ custom_disclaimer_responses: [{ checkbox_key: 'mktr_pdpa_consent', is_checked: false }] }), parsed)).toBeUndefined();
      expect(svc.consentFromLead(graphLead({ custom_disclaimer_responses: [] }), parsed)).toBeUndefined();
    });

    it('falls back to an affirmative custom field of the same name — non-affirmative is NO act, not a denial', () => {
      expect(svc.consentFromLead({}, { consentFieldValue: 'Yes' })).toBe(true);
      expect(svc.consentFromLead({}, { consentFieldValue: 'nope' })).toBeUndefined();
      expect(svc.consentFromLead({}, { consentFieldValue: undefined })).toBeUndefined();
    });
  });

  it('platformToUtmSource maps fb/ig and defaults to meta', () => {
    const { deps } = makeDeps();
    const svc = makeMetaLeadService(deps);
    expect(svc.platformToUtmSource('fb')).toBe('fb');
    expect(svc.platformToUtmSource('facebook')).toBe('fb');
    expect(svc.platformToUtmSource('ig')).toBe('ig');
    expect(svc.platformToUtmSource('instagram')).toBe('ig');
    expect(svc.platformToUtmSource('audience_network')).toBe('meta');
    expect(svc.platformToUtmSource(null)).toBe('meta');
  });

  describe('resolveFormRouting', () => {
    it('no active mapping → the unmapped pool', async () => {
      const { deps } = makeDeps({ MetaFormMapping: { findOne: jest.fn().mockResolvedValue(null) } });
      const svc = makeMetaLeadService(deps);
      const { campaign, qrTag } = await svc.resolveFormRouting('form-x');
      expect(campaign.slug).toBe('meta-unmapped');
      expect(qrTag).toBeNull();
    });

    it('mapping to a paused campaign → the unmapped pool', async () => {
      const { deps } = makeDeps();
      deps.Campaign.findByPk = jest.fn().mockResolvedValue({ ...MAPPED, status: 'paused' });
      const svc = makeMetaLeadService(deps);
      const { campaign } = await svc.resolveFormRouting('form-1');
      expect(campaign.slug).toBe('meta-unmapped');
    });

    it('a qrTag from another campaign is demoted to campaign-ring routing', async () => {
      const { deps } = makeDeps();
      deps.MetaFormMapping.findOne = jest.fn().mockResolvedValue({ formId: 'form-1', campaignId: MAPPED.id, qrTagId: 'qr-1', isActive: true });
      deps.QrTag.findByPk = jest.fn().mockResolvedValue({ id: 'qr-1', campaignId: 'other-campaign', assignedAgentId: 'agent-2' });
      const svc = makeMetaLeadService(deps);
      const { campaign, qrTag } = await svc.resolveFormRouting('form-1');
      expect(campaign.id).toBe(MAPPED.id);
      expect(qrTag).toBeNull();
    });

    it('a live direct-agent qrTag on the same campaign is honored', async () => {
      const { deps } = makeDeps();
      deps.MetaFormMapping.findOne = jest.fn().mockResolvedValue({ formId: 'form-1', campaignId: MAPPED.id, qrTagId: 'qr-1', isActive: true });
      deps.QrTag.findByPk = jest.fn().mockResolvedValue({ id: 'qr-1', campaignId: MAPPED.id, ownerUserId: 'agent-2', active: true });
      deps.User.findOne = jest.fn().mockResolvedValue({ id: 'agent-2', role: 'agent', isActive: true });
      const svc = makeMetaLeadService(deps);
      const { qrTag } = await svc.resolveFormRouting('form-1');
      expect(qrTag.id).toBe('qr-1');
    });

    it('an ARCHIVED qrTag or a deactivated agent demotes to campaign-ring routing', async () => {
      const { deps } = makeDeps();
      deps.MetaFormMapping.findOne = jest.fn().mockResolvedValue({ formId: 'form-1', campaignId: MAPPED.id, qrTagId: 'qr-1', isActive: true });
      deps.QrTag.findByPk = jest.fn().mockResolvedValue({ id: 'qr-1', campaignId: MAPPED.id, ownerUserId: 'agent-2', active: false });
      const svc = makeMetaLeadService(deps);
      expect((await svc.resolveFormRouting('form-1')).qrTag).toBeNull();

      deps.QrTag.findByPk = jest.fn().mockResolvedValue({ id: 'qr-1', campaignId: MAPPED.id, ownerUserId: 'agent-2', active: true });
      deps.User.findOne = jest.fn().mockResolvedValue(null); // agent deactivated
      expect((await svc.resolveFormRouting('form-1')).qrTag).toBeNull();
    });
  });

  describe('processInboxRow', () => {
    it('happy path: prospect + activity + consent + delivery in one tx, inbox completed, flush after commit', async () => {
      const { deps, seq } = makeDeps();
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();

      const result = await svc.processInboxRow(row);
      expect(result).toEqual({ status: 'created', prospectId: 'prospect-1' });

      const createArgs = deps.Prospect.create.mock.calls[0][0];
      expect(createArgs).toMatchObject({
        leadSource: 'social_media',
        phone: '+6591234567',
        campaignId: MAPPED.id,
        assignedAgentId: 'agent-1',
      });
      expect(createArgs.tags).toEqual(['meta', 'lead-ad']);
      expect(createArgs.sourceMetadata).toMatchObject({
        metaLeadgenId: 'lg-1',
        metaFormId: 'form-1',
        metaPlatform: 'ig',
        utm: { utm_source: 'ig', utm_medium: 'lead_ads', utm_campaign: 'CareShield Aug' },
        consent_contact: true,
        consent_copy_version: META_LEADGEN_CONSENT_VERSION,
      });
      expect(deps.recordCaptureConsentEventsTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        consumerId: 'consumer-1', contact: true, source: 'meta_lead_ad', verified: false,
        copyVersion: META_LEADGEN_CONSENT_VERSION,
      }));
      expect(deps.persistEventDeliveries).toHaveBeenCalledWith(
        'lead.created', expect.any(Function), { destination: 'mktr_leads' }, expect.anything()
      );
      expect(row.status).toBe('completed');
      expect(seq.txs[0].commit).toHaveBeenCalled();
      expect(deps.flushDeliveries).toHaveBeenCalled();
    });

    it('undeliverable fallback assignee (no provenance) re-routes to the unmapped pool and quarantines', async () => {
      const { deps } = makeDeps();
      // First resolution: system agent (no provenance). After remap: same, but
      // the unmapped campaign is quota-enforced so decideAssignment quarantines.
      deps.User.findByPk = jest.fn().mockResolvedValue({ id: 'sys', lyfeId: null, mktrLeadsId: null });
      deps.resolveLeadRouting = jest.fn().mockResolvedValue({ agentId: 'sys', via: 'fallback' });
      deps.decideAssignment = jest.fn().mockResolvedValue({ action: 'quarantine', quarantineReason: 'no_funded_agent', via: 'fallback' });
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();

      const result = await svc.processInboxRow(row);
      expect(result.status).toBe('quarantined');
      // The prospect must land on the unmapped pool, not the mapped campaign.
      expect(deps.Prospect.create.mock.calls[0][0]).toMatchObject({
        campaignId: UNMAPPED.id, assignedAgentId: null, quarantineReason: 'no_funded_agent',
      });
      // No lead.created for a held lead; held ping is flag-gated (off here).
      expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
      expect(row.status).toBe('completed');
    });

    it('held ping persists a lead.held delivery when HELD_LEAD_PING_ENABLED', async () => {
      process.env.HELD_LEAD_PING_ENABLED = 'true';
      const { deps } = makeDeps();
      deps.MetaFormMapping.findOne = jest.fn().mockResolvedValue(null); // unmapped
      deps.resolveLeadRouting = jest.fn().mockResolvedValue({ agentId: 'sys', via: 'fallback' });
      deps.User.findByPk = jest.fn().mockResolvedValue({ id: 'sys', lyfeId: null, mktrLeadsId: null });
      deps.decideAssignment = jest.fn().mockResolvedValue({ action: 'quarantine', quarantineReason: 'no_funded_agent', via: 'fallback' });
      const svc = makeMetaLeadService(deps);

      await svc.processInboxRow(fakeRow());
      expect(deps.persistEventDeliveries).toHaveBeenCalledWith(
        'lead.held', expect.any(Function), { destination: 'mktr_leads' }, expect.anything()
      );
    });

    it('a lost claim fence aborts the transaction — a lease-overrunning worker can never double-commit', async () => {
      const { deps, seq } = makeDeps();
      deps.MetaLeadgenEvent.update = jest.fn().mockResolvedValue([0]); // another worker owns the row
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();
      await expect(svc.processInboxRow(row)).rejects.toThrow(/claim fence lost/);
      expect(seq.txs[0].rollback).toHaveBeenCalled();
      expect(deps.flushDeliveries).not.toHaveBeenCalled();
    });

    it('assigned lead with NO delivery subscriber rolls back and retries (fail closed)', async () => {
      const { deps, seq } = makeDeps({ persistEventDeliveries: jest.fn().mockResolvedValue([]) });
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();
      await expect(svc.processInboxRow(row)).rejects.toThrow(/no delivery subscriber/);
      expect(seq.txs[0].rollback).toHaveBeenCalled();
      expect(row.status).toBe('pending');
    });

    it('duplicate phone-in-campaign completes as duplicate with one activity on the winner', async () => {
      const { deps } = makeDeps();
      deps.Prospect.findOne = jest.fn().mockResolvedValue({ id: 'winner-1' });
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();

      const result = await svc.processInboxRow(row);
      expect(result).toEqual({ status: 'duplicate', prospectId: 'winner-1' });
      expect(deps.Prospect.create).not.toHaveBeenCalled();
      expect(deps.ProspectActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ prospectId: 'winner-1', type: 'updated' }),
        expect.anything()
      );
      expect(row.status).toBe('duplicate');
    });

    it('constraint race loser lands on the same duplicate path', async () => {
      const { deps } = makeDeps();
      const err = Object.assign(new Error('dup'), {
        name: 'SequelizeUniqueConstraintError',
        original: { constraint: 'prospects_campaign_id_phone' },
      });
      deps.Prospect.create = jest.fn().mockRejectedValue(err);
      deps.Prospect.findOne = jest.fn()
        .mockResolvedValueOnce(null)            // precheck misses
        .mockResolvedValueOnce({ id: 'winner-2' }); // reload after constraint
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();

      const result = await svc.processInboxRow(row);
      expect(result).toEqual({ status: 'duplicate', prospectId: 'winner-2' });
      expect(row.status).toBe('duplicate');
    });

    it('unknown page is a permanent dead, not a retry loop', async () => {
      const { deps } = makeDeps({ resolvePageAccessToken: jest.fn().mockResolvedValue({ token: null, reason: 'unknown_page', retryable: false }) });
      const svc = makeMetaLeadService(deps);
      const row = fakeRow();
      const result = await svc.processInboxRow(row);
      expect(result).toEqual({ status: 'dead', reason: 'unknown_page' });
      expect(row.status).toBe('dead');
    });

    it('Graph 404 (lead deleted at Meta) is permanent; Graph 500 retries', async () => {
      const dead = makeDeps({ fetch: jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'gone' }) });
      const svcDead = makeMetaLeadService(dead.deps);
      const rowDead = fakeRow();
      await expect(svcDead.processInboxRow(rowDead)).resolves.toEqual({ status: 'dead', reason: 'lead_not_found' });

      const retry = makeDeps({ fetch: jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) });
      const svcRetry = makeMetaLeadService(retry.deps);
      await expect(svcRetry.processInboxRow(fakeRow())).rejects.toMatchObject({ retryable: true });
    });
  });

  describe('inbox claim/backoff', () => {
    it('claim leases rows 5 minutes ahead and increments attempts; exhausted rows go dead', async () => {
      const { deps } = makeDeps();
      const fresh = fakeRow({ attempts: 0 });
      const poison = fakeRow({ leadgenId: 'lg-poison', attempts: 8 });
      deps.MetaLeadgenEvent.findAll = jest.fn().mockResolvedValueOnce([fresh, poison]).mockResolvedValue([]);
      // Make processing of the fresh row fail fast so drain exercises markRetry.
      deps.resolvePageAccessToken = jest.fn().mockResolvedValue({ token: null, reason: 'token_unreadable', retryable: true });
      const svc = makeMetaLeadService(deps);

      await svc.drainMetaInbox({ batchSize: 10, maxBatches: 1 });
      expect(fresh.attempts).toBe(1);
      expect(fresh.status).toBe('pending');
      expect(fresh.nextAttemptAt).toBeInstanceOf(Date);
      expect(poison.status).toBe('dead');
    });

    it('enqueue dedupes by leadgenId and skips changes without one', async () => {
      const { deps } = makeDeps();
      deps.MetaLeadgenEvent.findOrCreate = jest.fn()
        .mockResolvedValueOnce([{}, true])
        .mockResolvedValueOnce([{}, false]);
      const svc = makeMetaLeadService(deps);
      const accepted = await svc.enqueueLeadgenChanges([
        { leadgen_id: 'a', page_id: 'p' },
        { leadgen_id: 'a', page_id: 'p' },
        { page_id: 'no-id' },
      ]);
      expect(accepted).toBe(1);
      expect(deps.MetaLeadgenEvent.findOrCreate).toHaveBeenCalledTimes(2);
    });
  });
});
