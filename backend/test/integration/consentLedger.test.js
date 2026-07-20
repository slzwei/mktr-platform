import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from '../helpers.js';
import { Consumer, Prospect, ConsentEvent, ConsumerSuppression,
} from '../../src/models/index.js';
import { markPhoneVerified } from '../../src/services/verifiedPhoneStore.js';
import { reconcileConsumerSpine } from '../../src/services/consumerService.js';
import {
  backfillConsentEvents, getConsentState, canMarketTo, isSendBlocked,
  ensureUnsubToken, unsubTokenFor,
} from '../../src/services/consentService.js';
import {
  CONTACT_CONSENT_VERSION, CONTACT_CONSENT_VERSIONS, AGREE_ALL_CONSENT_VERSION,
} from '../../src/services/contactConsent.js';
import {
  THIRD_PARTY_CONSENT_VERSION, AGREE_ALL_THIRD_PARTY_VERSION,
} from '../../src/services/externalConsent.js';

/**
 * Consent ledger — integration (PR B, plan §3). Real Postgres: the ledger's
 * latest-wins scope resolution, the backfill's idempotency anchor, and the
 * fail-closed phone joins are all DB semantics.
 */

const RUN = Date.now();
const p8 = (offset) => `9${String(RUN + offset).slice(-7)}`;

let app;
let adminToken;
let campaign1;
let campaign2;

function capturePayload(overrides = {}) {
  return {
    firstName: 'Ledger',
    lastName: 'Tester',
    email: `ledger-${RUN}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    leadSource: 'website',
    ...overrides,
  };
}

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminToken = admin.token;
  campaign1 = await createTestCampaign(admin.user.id, { name: `Ledger C1 ${RUN}` });
  campaign2 = await createTestCampaign(admin.user.id, { name: `Ledger C2 ${RUN}` });
});

afterAll(async () => {
  await closeDb();
});

describe('capture → ledger events', () => {
  const ph = p8(11);
  const phE164 = `+65${ph}`;

  test('verified signup writes contact + terms + third_party events with real versions', async () => {
    markPhoneVerified(phE164);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign1.id, phone: ph,
        consent_contact: true, consent_terms: true, consent_third_party: true,
      }))
      .expect(201);

    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    const events = await ConsentEvent.findAll({ where: { consumerId: consumer.id } });
    const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));

    expect(byKind.contact.granted).toBe(true);
    expect(byKind.contact.verified).toBe(true);
    expect(byKind.contact.version).toBe(CONTACT_CONSENT_VERSION);
    expect(byKind.contact.campaignId).toBe(campaign1.id);
    expect(byKind.contact.source).toBe('signup');

    expect(byKind.campaign_terms.granted).toBe(true);
    expect(byKind.third_party.granted).toBe(true);
    expect(byKind.third_party.version).toBe(THIRD_PARTY_CONSENT_VERSION);
    expect(Array.isArray(byKind.third_party.channels)).toBe(true);
  });

  test('explicit contact UNTICK is recorded as granted:false; absent keys write nothing', async () => {
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign2.id, phone: ph,
        consent_contact: false, consent_terms: true,
      }))
      .expect(201);

    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    const c2Contact = await ConsentEvent.findOne({
      where: { consumerId: consumer.id, kind: 'contact', campaignId: campaign2.id },
    });
    expect(c2Contact.granted).toBe(false);

    // A capture with NO consent keys at all writes no contact/terms events.
    const phNone = p8(12);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: phNone }))
      .expect(201);
    const cNone = await Consumer.findOne({ where: { phone: `+65${phNone}` } });
    expect(await ConsentEvent.count({ where: { consumerId: cNone.id } })).toBe(0);
  });

  test('canMarketTo: campaign-scoped, verified-only, fail-closed', async () => {
    // campaign1: verified grant → true.
    expect(await canMarketTo({ phone: phE164, campaignId: campaign1.id })).toBe(true);
    // campaign2: explicit false → false (scope isolation both directions).
    expect(await canMarketTo({ phone: phE164, campaignId: campaign2.id })).toBe(false);
    // No GLOBAL grant exists — cross-campaign marketing has no basis.
    expect(await canMarketTo({ phone: phE164, campaignId: null })).toBe(false);
    // Unknown person → fail closed.
    expect(await canMarketTo({ phone: '+6590000001', campaignId: campaign1.id })).toBe(false);
  });

  test('an UNVERIFIED grant never mints marketing authority', async () => {
    const phU = p8(13);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign1.id, phone: phU,
        consent_contact: true, consent_terms: true,
      }))
      .expect(201); // no OTP marker → verified:false on the event
    expect(await canMarketTo({ phone: `+65${phU}`, campaignId: campaign1.id })).toBe(false);
  });

  test('agree-all capture (consent_copy_version) stamps the new era on contact + third_party', async () => {
    const phA = p8(31);
    markPhoneVerified(`+65${phA}`);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign1.id, phone: phA,
        consent_contact: true, consent_terms: true, consent_third_party: true,
        consent_copy_version: AGREE_ALL_CONSENT_VERSION,
      }))
      .expect(201);

    const consumer = await Consumer.findOne({ where: { phone: `+65${phA}` } });
    const events = await ConsentEvent.findAll({ where: { consumerId: consumer.id } });
    const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));

    const era = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
    expect(byKind.contact.granted).toBe(true);
    expect(byKind.contact.version).toBe(AGREE_ALL_CONSENT_VERSION);
    expect(byKind.contact.metadata.copyHash).toBe(era.copyHash);
    expect(byKind.contact.metadata.scope).toBe('brand');
    // Brand-wide WORDING, still campaign-scoped EVENT (globalev is separate).
    expect(byKind.contact.campaignId).toBe(campaign1.id);
    expect(byKind.third_party.version).toBe(AGREE_ALL_THIRD_PARTY_VERSION);

    // The era label also survives on the prospect for backfill/audit.
    const prospect = await Prospect.findByPk(byKind.contact.prospectId);
    expect(prospect.sourceMetadata.consent_copy_version).toBe(AGREE_ALL_CONSENT_VERSION);
  });

  test('a capture WITHOUT consent_copy_version still stamps the legacy era (marketplace path)', async () => {
    const phL = p8(32);
    markPhoneVerified(`+65${phL}`);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign2.id, phone: phL,
        consent_contact: true, consent_terms: true, consent_third_party: true,
      }))
      .expect(201);

    const consumer = await Consumer.findOne({ where: { phone: `+65${phL}` } });
    const contact = await ConsentEvent.findOne({
      where: { consumerId: consumer.id, kind: 'contact' },
    });
    const legacy = CONTACT_CONSENT_VERSIONS[CONTACT_CONSENT_VERSION];
    expect(contact.version).toBe(CONTACT_CONSENT_VERSION);
    expect(contact.metadata.copyHash).toBe(legacy.copyHash);
    const third = await ConsentEvent.findOne({
      where: { consumerId: consumer.id, kind: 'third_party' },
    });
    expect(third.version).toBe(THIRD_PARTY_CONSENT_VERSION);
  });
});

describe('unsubscribe endpoint', () => {
  const ph = p8(14);
  const phE164 = `+65${ph}`;
  let token;

  beforeAll(async () => {
    markPhoneVerified(phE164);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign1.id, phone: ph,
        consent_contact: true, consent_terms: true,
      }))
      .expect(201);
    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    token = await ensureUnsubToken(consumer.id);
    expect(token).toBe(unsubTokenFor(consumer.id)); // deterministic
  });

  test('GET renders the confirm form and MUTATES NOTHING (scanner safety)', async () => {
    const r = await request(app).get(`/api/unsubscribe?t=${token}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Unsubscribe from marketing messages?');
    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    expect(await ConsumerSuppression.count({ where: { consumerId: consumer.id } })).toBe(0);
    expect(await canMarketTo({ phone: phE164, campaignId: campaign1.id })).toBe(true);
  });

  test('POST suppresses globally + writes the withdrawal event; idempotent; bad token 404s', async () => {
    await request(app)
      .post(`/api/unsubscribe?t=${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click')
      .expect(200);

    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    const supp = await ConsumerSuppression.findAll({ where: { consumerId: consumer.id } });
    expect(supp).toHaveLength(1);
    expect(supp[0].channel).toBe('all');
    expect(supp[0].reason).toBe('unsubscribe');

    const withdrawal = await ConsentEvent.findOne({
      where: { consumerId: consumer.id, source: 'unsubscribe' },
    });
    expect(withdrawal.kind).toBe('contact');
    expect(withdrawal.granted).toBe(false);
    expect(withdrawal.campaignId).toBeNull(); // explicit GLOBAL act

    // The verified scoped grant is now overridden by recency + suppression.
    expect(await canMarketTo({ phone: phE164, campaignId: campaign1.id })).toBe(false);

    // Idempotent: second POST adds nothing.
    await request(app).post(`/api/unsubscribe?t=${token}`).type('form').send('').expect(200);
    expect(await ConsumerSuppression.count({ where: { consumerId: consumer.id } })).toBe(1);
    expect(await ConsentEvent.count({ where: { consumerId: consumer.id, source: 'unsubscribe' } })).toBe(1);

    await request(app).get('/api/unsubscribe?t=deadbeef').expect(404);
  });

  test('suppression semantics: transactional passes on unsubscribe, blocks on erasure', async () => {
    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    const prospect = await Prospect.findOne({ where: { phone: phE164 } });

    // Marketing unsubscribe does NOT block transactional delivery…
    expect(await isSendBlocked(prospect, { channel: 'whatsapp', purpose: 'transactional' })).toBe(false);
    // …but marketing sends are blocked.
    expect(await isSendBlocked(prospect, { channel: 'whatsapp', purpose: 'marketing' })).toBe(true);

    // An erasure-reason suppression blocks everything (PR C writes these).
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'email', reason: 'erasure' });
    expect(await isSendBlocked(prospect, { channel: 'email', purpose: 'transactional' })).toBe(true);
  });
});

describe('backfill (081 semantics)', () => {
  test('re-derives events for pre-ledger rows, skips live-captured rows, and is idempotent', async () => {
    // A "legacy" prospect: created directly (no capture hook), then linked by
    // the reconciler — exactly the 081 deploy shape.
    const ph = p8(15);
    const legacy = await Prospect.create({
      firstName: 'Legacy', email: `legacy-${RUN}@test.com`, phone: `+65${ph}`,
      leadSource: 'website', campaignId: campaign1.id,
      sourceMetadata: { consent_contact: true, consent_terms: true },
      consentMetadata: { external: { version: '2026-06-26', consentedAt: '2026-07-01T00:00:00Z', channels: ['phone'] } },
    });
    await reconcileConsumerSpine();

    const first = await backfillConsentEvents();
    expect(first.written).toBeGreaterThanOrEqual(3);

    const rows = await ConsentEvent.findAll({ where: { prospectId: legacy.id } });
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toEqual(['campaign_terms', 'contact', 'third_party']);
    for (const r of rows) {
      expect(r.source).toBe('backfill');
    }
    const contact = rows.find((r) => r.kind === 'contact');
    expect(contact.version).toBe('legacy-backfill');
    expect(new Date(contact.occurredAt).getTime()).toBe(new Date(legacy.createdAt).getTime());

    // Idempotent rerun: nothing new (uq_ce_backfill + signup-skip clause) —
    // asserted on the RETURN COUNT and on the actual DB rows.
    const second = await backfillConsentEvents();
    expect(second.written).toBe(0);
    expect(await ConsentEvent.count({ where: { prospectId: legacy.id } })).toBe(3);

    // Live-captured prospects (signup-source events) are never double-written.
    const captured = await ConsentEvent.findOne({ where: { source: 'signup' } });
    if (captured) {
      const dupes = await ConsentEvent.count({
        where: { prospectId: captured.prospectId, kind: captured.kind, source: 'backfill' },
      });
      expect(dupes).toBe(0);
    }
  });
});

describe('consent state reads', () => {
  test('getConsentState resolves latest-wins within scope and surfaces suppressions', async () => {
    const ph = p8(14);
    const consumer = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    const state = await getConsentState(consumer.id, { campaignId: campaign1.id });
    // The GLOBAL unsubscribe (later) beats the earlier scoped grant.
    expect(state.contact.granted).toBe(false);
    expect(state.contact.scope).toBe('global');
    expect(state.suppressions.length).toBeGreaterThanOrEqual(1);
  });
});
