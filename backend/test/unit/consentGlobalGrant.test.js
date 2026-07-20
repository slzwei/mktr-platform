import '../setup.js';
import { Op } from 'sequelize';
import { makeConsentService } from '../../src/services/consentService.js';
import {
  CONTACT_CONSENT_VERSION, CONTACT_CONSENT_VERSIONS, AGREE_ALL_CONSENT_VERSION,
} from '../../src/services/contactConsent.js';

/**
 * globalev (tracker P1) — DB-less proofs of the brand-scope global grant:
 * what one capture writes, and the cross-campaign canMarketTo semantics those
 * rows unlock. The integration suite (consentLedger.test.js) proves the same
 * end-to-end against real Postgres (plus the 082 healing paths); these run
 * everywhere.
 */

const CID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const AGREE_ERA = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
const LEGACY_ERA = CONTACT_CONSENT_VERSIONS[CONTACT_CONSENT_VERSION];

// ── capture-side: what rows one submission writes ──

function captureHarness() {
  const created = [];
  const svc = makeConsentService({
    sequelize: {
      transaction: async (fnOrOpts, maybeFn) => {
        const fn = typeof fnOrOpts === 'function' ? fnOrOpts : maybeFn;
        return fn({});
      },
    },
    ConsentEvent: { bulkCreate: async (rows) => { created.push(...rows); return rows; } },
    logger: { warn: () => {} },
  });
  return { svc, created };
}

describe('recordCaptureConsentEventsTx — brand-scope eras mint scoped + GLOBAL grants', () => {
  test('agree-all marker + granted contact → two contact rows (campaign + campaignId:null), era-stamped', async () => {
    const { svc, created } = captureHarness();
    const n = await svc.recordCaptureConsentEventsTx(null, {
      consumerId: CID, prospectId: 'p1', campaignId: CAMPAIGN_A, verified: true,
      contact: true, terms: true, copyVersion: AGREE_ALL_CONSENT_VERSION,
    });
    expect(n).toBe(3); // scoped contact + global contact + campaign_terms

    const contacts = created.filter((r) => r.kind === 'contact');
    expect(contacts).toHaveLength(2);
    const scoped = contacts.find((r) => r.campaignId === CAMPAIGN_A);
    const global = contacts.find((r) => r.campaignId === null);
    for (const row of [scoped, global]) {
      expect(row).toBeDefined();
      expect(row.granted).toBe(true);
      expect(row.verified).toBe(true);
      expect(row.source).toBe('signup');
      expect(row.version).toBe(AGREE_ALL_CONSENT_VERSION);
      expect(row.channels).toEqual([...AGREE_ERA.channels]);
      expect(row.metadata).toEqual({ copyHash: AGREE_ERA.copyHash, scope: 'brand' });
    }
    expect(scoped.id).not.toBe(global.id);
  });

  test('legacy era (no marker) writes a single scoped row — never a global twin', async () => {
    const { svc, created } = captureHarness();
    await svc.recordCaptureConsentEventsTx(null, {
      consumerId: CID, prospectId: 'p1', campaignId: CAMPAIGN_A, verified: true,
      contact: true, terms: true,
    });
    const contacts = created.filter((r) => r.kind === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].campaignId).toBe(CAMPAIGN_A);
    expect(contacts[0].version).toBe(CONTACT_CONSENT_VERSION);
    expect(contacts[0].metadata).toEqual({ copyHash: LEGACY_ERA.copyHash, scope: 'campaign' });
  });

  test('an unknown marker resolves to legacy — a spoofed label cannot mint a global grant', async () => {
    const { svc, created } = captureHarness();
    await svc.recordCaptureConsentEventsTx(null, {
      consumerId: CID, prospectId: 'p1', campaignId: CAMPAIGN_A,
      contact: true, copyVersion: 'not-a-registered-era',
    });
    const contacts = created.filter((r) => r.kind === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].version).toBe(CONTACT_CONSENT_VERSION);
  });

  test('a brand-era row with contact:false never mints a global row (denials stay scoped)', async () => {
    const { svc, created } = captureHarness();
    await svc.recordCaptureConsentEventsTx(null, {
      consumerId: CID, prospectId: 'p1', campaignId: CAMPAIGN_A,
      contact: false, copyVersion: AGREE_ALL_CONSENT_VERSION,
    });
    const contacts = created.filter((r) => r.kind === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].campaignId).toBe(CAMPAIGN_A);
    expect(contacts[0].granted).toBe(false);
  });

  test('a campaign-less brand-era capture writes exactly one (already-global) row', async () => {
    const { svc, created } = captureHarness();
    await svc.recordCaptureConsentEventsTx(null, {
      consumerId: CID, prospectId: 'p1', campaignId: null,
      contact: true, copyVersion: AGREE_ALL_CONSENT_VERSION,
    });
    const contacts = created.filter((r) => r.kind === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].campaignId).toBeNull();
  });
});

// ── read-side: what those rows unlock in canMarketTo ──

function readHarness(events, { suppressions = [], erasedAt = null } = {}) {
  const consumer = { id: CID, erasedAt, phone: '+6591234567' };
  const matches = (e, where) => {
    if (where.consumerId && e.consumerId !== where.consumerId) return false;
    if (Object.prototype.hasOwnProperty.call(where, 'campaignId')) {
      return e.campaignId === where.campaignId;
    }
    const or = where[Op.or];
    if (or) return or.some((c) => e.campaignId === c.campaignId);
    return true;
  };
  return makeConsentService({
    Consumer: {
      findByPk: async (id) => (id === CID ? consumer : null),
      findOne: async () => consumer,
    },
    ConsumerSuppression: { findAll: async () => suppressions },
    ConsentEvent: {
      findAll: async ({ where }) =>
        events
          .filter((e) => matches(e, where))
          .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)),
    },
    sequelize: {},
    logger: { warn: () => {} },
  });
}

const grant = (campaignId, at, extra = {}) => ({
  consumerId: CID, kind: 'contact', granted: true, verified: true,
  campaignId, occurredAt: at, version: AGREE_ALL_CONSENT_VERSION, ...extra,
});

describe('canMarketTo — global grants unlock cross-campaign checks', () => {
  test('agree-all capture (scoped A + global) passes for campaign B AND the pure global question', async () => {
    const svc = readHarness([
      grant(CAMPAIGN_A, '2026-07-21T04:00:00Z'),
      grant(null, '2026-07-21T04:00:00Z'),
    ]);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_A })).toBe(true);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_B })).toBe(true);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: null })).toBe(true);
  });

  test('legacy capture (scoped only) stays campaign-locked — cross-campaign has NO basis', async () => {
    const svc = readHarness([
      grant(CAMPAIGN_A, '2026-07-20T04:00:00Z', { version: CONTACT_CONSENT_VERSION }),
    ]);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_A })).toBe(true);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_B })).toBe(false);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: null })).toBe(false);
  });

  test('a later GLOBAL withdrawal beats the agree-all grant everywhere (recency)', async () => {
    const svc = readHarness([
      grant(CAMPAIGN_A, '2026-07-21T04:00:00Z'),
      grant(null, '2026-07-21T04:00:00Z'),
      {
        consumerId: CID, kind: 'contact', granted: false, verified: false,
        campaignId: null, occurredAt: '2026-07-22T04:00:00Z',
        version: CONTACT_CONSENT_VERSION,
      },
    ]);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_A })).toBe(false);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_B })).toBe(false);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: null })).toBe(false);
  });

  test('an UNVERIFIED global grant never mints marketing authority', async () => {
    const svc = readHarness([grant(null, '2026-07-21T04:00:00Z', { verified: false })]);
    expect(await svc.canMarketTo({ consumerId: CID, campaignId: CAMPAIGN_B })).toBe(false);
  });
});
