import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from '../helpers.js';
import { Consumer, Prospect, ConsentEvent, ConsumerSuppression,
} from '../../src/models/index.js';
import { markPhoneVerified } from '../../src/services/verifiedPhoneStore.js';
import { reconcileConsumerSpine } from '../../src/services/consumerService.js';
import {
  backfillConsentEvents, backfillGlobalGrants, getConsentState, canMarketTo,
  isSendBlocked, ensureUnsubToken, unsubTokenFor, getMarketableGrantMap, getSuppressedPhoneSet,
} from '../../src/services/consentService.js';
import {
  CONTACT_CONSENT_VERSION, CONTACT_CONSENT_VERSIONS, AGREE_ALL_CONSENT_VERSION,
} from '../../src/services/contactConsent.js';
import {
  THIRD_PARTY_CONSENT_VERSION, AGREE_ALL_THIRD_PARTY_VERSION,
} from '../../src/services/externalConsent.js';
import { shapeMetaAudienceRows } from '../../src/services/redeemedAudienceService.js';
import {
  AUDIENCE_POLICIES,
  selectAudiencePopulation,
  filterEligible,
} from '../../src/services/audienceEligibilityService.js';
import { canWhatsAppProspect, makeWhatsappService } from '../../src/services/redeemOps/whatsappService.js';
import { makeLeadOutcomeService } from '../../src/services/leadOutcomeService.js';
import { _buildPayload as buildMetaPayload } from '../../src/services/metaCapiService.js';
import { hashPhone } from '../../src/utils/piiHashing.js';
import { jest } from '@jest/globals';

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

    // Brand-wide wording now mints brand-wide EVIDENCE ("globalev"): the
    // campaign-scoped grant plus an explicit campaignId:null GLOBAL twin.
    const era = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
    const contacts = events.filter((e) => e.kind === 'contact');
    expect(contacts).toHaveLength(2);
    const scoped = contacts.find((e) => e.campaignId === campaign1.id);
    const global = contacts.find((e) => e.campaignId === null);
    for (const row of [scoped, global]) {
      expect(row).toBeDefined();
      expect(row.granted).toBe(true);
      expect(row.verified).toBe(true);
      expect(row.source).toBe('signup');
      expect(row.version).toBe(AGREE_ALL_CONSENT_VERSION);
      expect(row.metadata.copyHash).toBe(era.copyHash);
      expect(row.metadata.scope).toBe('brand');
    }

    const thirdParty = events.find((e) => e.kind === 'third_party');
    expect(thirdParty.version).toBe(AGREE_ALL_THIRD_PARTY_VERSION);

    // The era label also survives on the prospect for backfill/audit.
    const prospect = await Prospect.findByPk(scoped.prospectId);
    expect(prospect.sourceMetadata.consent_copy_version).toBe(AGREE_ALL_CONSENT_VERSION);

    // The global twin unlocks CROSS-campaign marketing for this person…
    expect(await canMarketTo({ phone: `+65${phA}`, campaignId: campaign2.id })).toBe(true);
    expect(await canMarketTo({ phone: `+65${phA}`, campaignId: null })).toBe(true);
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

    // Legacy era mints NO global twin — one scoped row, cross-campaign locked.
    const contacts = await ConsentEvent.findAll({
      where: { consumerId: consumer.id, kind: 'contact' },
    });
    expect(contacts).toHaveLength(1);
    expect(await canMarketTo({ phone: `+65${phL}`, campaignId: campaign1.id })).toBe(false);
    expect(await canMarketTo({ phone: `+65${phL}`, campaignId: null })).toBe(false);
  });
});

describe('globalev — pre-082 healing (backfillGlobalGrants)', () => {
  test('mints ONE global twin per consumer+era from scoped agree-all grants; idempotent', async () => {
    // Pre-globalev shape, built directly: two campaign-scoped agree-all
    // grants (the #213/#214 → 082 window wrote these) and no global row.
    const ph = p8(41);
    const prospect = await Prospect.create({
      firstName: 'Window', email: `window-${RUN}@test.com`, phone: `+65${ph}`,
      leadSource: 'website', campaignId: campaign1.id,
      sourceMetadata: { consent_contact: true, consent_copy_version: AGREE_ALL_CONSENT_VERSION },
    });
    await reconcileConsumerSpine();
    const consumer = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    const era = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
    const scopedRow = (campaignId) => ({
      consumerId: consumer.id, prospectId: prospect.id, campaignId,
      kind: 'contact', granted: true, verified: true, source: 'signup',
      channels: [...era.channels], version: AGREE_ALL_CONSENT_VERSION,
      metadata: { copyHash: era.copyHash, scope: era.scope },
      occurredAt: new Date('2026-07-21T05:00:00Z'),
    });
    await ConsentEvent.create(scopedRow(campaign1.id));
    await ConsentEvent.create(scopedRow(campaign2.id));

    // Before healing: brand wording on record, but cross-campaign still locked.
    expect(await canMarketTo({ phone: `+65${ph}`, campaignId: null })).toBe(false);

    const first = await backfillGlobalGrants();
    expect(first.written).toBe(1); // one twin per (consumer, era), not per grant

    const globals = await ConsentEvent.findAll({
      where: { consumerId: consumer.id, kind: 'contact', campaignId: null },
    });
    expect(globals).toHaveLength(1);
    expect(globals[0].granted).toBe(true);
    expect(globals[0].verified).toBe(true);
    expect(globals[0].source).toBe('backfill'); // derived row, not a fresh act
    expect(globals[0].version).toBe(AGREE_ALL_CONSENT_VERSION);
    expect(globals[0].metadata.copyHash).toBe(era.copyHash);

    // …and the gate opens cross-campaign.
    expect(await canMarketTo({ phone: `+65${ph}`, campaignId: campaign2.id })).toBe(true);
    expect(await canMarketTo({ phone: `+65${ph}`, campaignId: null })).toBe(true);

    // Idempotent rerun: nothing new.
    const second = await backfillGlobalGrants();
    expect(second.written).toBe(0);
    expect(await ConsentEvent.count({
      where: { consumerId: consumer.id, kind: 'contact', campaignId: null },
    })).toBe(1);
  });

  test('legacy grants are never lifted to global', async () => {
    const ph = p8(42);
    const prospect = await Prospect.create({
      firstName: 'Legacy', email: `legacy-g-${RUN}@test.com`, phone: `+65${ph}`,
      leadSource: 'website', campaignId: campaign1.id,
      sourceMetadata: { consent_contact: true },
    });
    await reconcileConsumerSpine();
    const consumer = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    const legacy = CONTACT_CONSENT_VERSIONS[CONTACT_CONSENT_VERSION];
    await ConsentEvent.create({
      consumerId: consumer.id, prospectId: prospect.id, campaignId: campaign1.id,
      kind: 'contact', granted: true, verified: true, source: 'signup',
      channels: [...legacy.channels], version: CONTACT_CONSENT_VERSION,
      metadata: { copyHash: legacy.copyHash, scope: legacy.scope },
      occurredAt: new Date('2026-07-20T05:00:00Z'),
    });

    await backfillGlobalGrants();
    expect(await ConsentEvent.count({
      where: { consumerId: consumer.id, kind: 'contact', campaignId: null },
    })).toBe(0);
    expect(await canMarketTo({ phone: `+65${ph}`, campaignId: campaign2.id })).toBe(false);
  });
});

describe('globalev — era-aware per-prospect healing (backfillConsentEvents)', () => {
  test('an agree-all capture healed from sourceMetadata carries its true era, scoped-only, then 082 lifts it', async () => {
    // A lost-savepoint shape: the prospect row has everything, the ledger
    // has nothing (no signup-source events).
    const ph = p8(43);
    const healed = await Prospect.create({
      firstName: 'Healed', email: `healed-${RUN}@test.com`, phone: `+65${ph}`,
      leadSource: 'website', campaignId: campaign1.id,
      sourceMetadata: {
        consent_contact: true, consent_terms: true,
        consent_copy_version: AGREE_ALL_CONSENT_VERSION,
      },
    });
    await reconcileConsumerSpine();
    await backfillConsentEvents();

    const era = CONTACT_CONSENT_VERSIONS[AGREE_ALL_CONSENT_VERSION];
    const rows = await ConsentEvent.findAll({ where: { prospectId: healed.id } });
    const contact = rows.find((r) => r.kind === 'contact');
    expect(contact.version).toBe(AGREE_ALL_CONSENT_VERSION);
    expect(contact.metadata.copyHash).toBe(era.copyHash);
    expect(contact.metadata.scope).toBe('brand');
    expect(contact.channels).toContain('whatsapp');

    // Per-prospect healing stays scoped-only (uq_ce_backfill is
    // (prospectId, kind)) — the global twin comes from backfillGlobalGrants.
    expect(rows.filter((r) => r.kind === 'contact')).toHaveLength(1);
    await backfillGlobalGrants();
    const consumer = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    const globals = await ConsentEvent.findAll({
      where: { consumerId: consumer.id, kind: 'contact', campaignId: null },
    });
    // The healed prospect already owns the per-prospect backfill contact row,
    // so its twin collides on uq_ce_backfill and is skipped — fail-closed.
    expect(globals).toHaveLength(0);
    expect(await canMarketTo({ phone: `+65${ph}`, campaignId: campaign2.id })).toBe(false);
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

// ————— 3sites migration: the three legacy gates, end-to-end on the ledger —————

describe('3sites — redeemed-audience upload set (grant map + suppression set)', () => {
  const phVerified = p8(21); // verified + granted → the ONLY survivor
  const phUnverified = p8(22); // granted but no OTP marker
  const phUnticked = p8(23); // explicit untick
  const phUnsubbed = p8(24); // verified grant, then global unsubscribe
  const e164 = (p) => `+65${p}`;

  beforeAll(async () => {
    markPhoneVerified(e164(phVerified));
    markPhoneVerified(e164(phUnticked));
    markPhoneVerified(e164(phUnsubbed));
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: phVerified, consent_contact: true, consent_terms: true }))
      .expect(201);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: phUnverified, consent_contact: true, consent_terms: true }))
      .expect(201);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: phUnticked, consent_contact: false, consent_terms: true }))
      .expect(201);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: phUnsubbed, consent_contact: true, consent_terms: true }))
      .expect(201);
    const unsubbed = await Consumer.findOne({ where: { phone: e164(phUnsubbed) } });
    const token = await ensureUnsubToken(unsubbed.id);
    await request(app).post(`/api/unsubscribe?t=${token}`).type('form').send('').expect(200);
  });

  test('getMarketableGrantMap encodes verified-only grants with cross-scope recency', async () => {
    const map = await getMarketableGrantMap();
    expect(map.get(e164(phVerified)).get(campaign1.id)).toBe(true);
    expect(map.get(e164(phUnverified)).get(campaign1.id)).toBe(false); // unverified never authorizes
    expect(map.get(e164(phUnticked)).get(campaign1.id)).toBe(false); // explicit untick
    // The LATER global withdrawal shadows the earlier verified scoped grant.
    expect(map.get(e164(phUnsubbed)).get(campaign1.id)).toBe(false);
    expect(map.get(e164(phUnsubbed)).get('*')).toBe(false);
  });

  test('engine selection → filter → Meta shaping keeps ONLY the verified-granted, unsuppressed person', async () => {
    const mine = new Set([e164(phVerified), e164(phUnverified), e164(phUnticked), e164(phUnsubbed)]);
    const prospects = (await selectAudiencePopulation({ scope: 'global' })).filter((p) => mine.has(p.phone));
    expect(prospects).toHaveLength(4);

    const eligible = filterEligible(
      prospects,
      {
        suppressedPhones: await getSuppressedPhoneSet(),
        grantMap: await getMarketableGrantMap(),
        editSuppressedProspectIds: new Set(),
      },
      AUDIENCE_POLICIES.meta
    );
    const rows = shapeMetaAudienceRows(eligible);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe(hashPhone(e164(phVerified)));
    // …and the unsubscribed phone is ALSO caught by the suppression set alone.
    expect((await getSuppressedPhoneSet()).has(e164(phUnsubbed))).toBe(true);
  });
});

describe('3sites — delayed down-funnel CAPI re-checks the ledger at send time', () => {
  const ph = p8(25);
  const phE164 = `+65${ph}`;
  let prospect;

  beforeAll(async () => {
    markPhoneVerified(phE164);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: ph, consent_contact: true, consent_terms: true }))
      .expect(201);
    prospect = await Prospect.findOne({ where: { phone: phE164, campaignId: campaign1.id } });
  });

  test('grant present → em/ph flag true; after unsubscribe → false (real canMarketTo)', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: true });
    const svc = makeLeadOutcomeService({ sendConversionEvent });
    const outcome = (status) => ({
      external_id: prospect.id, lead_id: 'lyfe-1', new_status: status,
      old_status: 'contacted', agent_id: 'a1', occurred_at: new Date().toISOString(),
    });

    // Before withdrawal: the verified campaign grant licenses em/ph.
    await svc.processLeadOutcome(outcome('qualified'));
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sendConversionEvent.mock.calls[0][1].marketingConsent).toBe(true);

    // Withdraw (global unsubscribe), then drive the next transition.
    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    const token = await ensureUnsubToken(consumer.id);
    await request(app).post(`/api/unsubscribe?t=${token}`).type('form').send('').expect(200);

    await svc.processLeadOutcome(outcome('won')); // ConfirmedResident dedupes; ClosedWon dispatches
    const last = sendConversionEvent.mock.calls.at(-1);
    expect(last[2].eventName).toBe('ClosedWon');
    expect(last[1].marketingConsent).toBe(false);

    // And the flag is what actually strips ALL five contact-PII fields from
    // the wire payload (em/ph plus the EMQ trio fn/ln/country).
    const withConsent = buildMetaPayload(prospect, { eventId: 'e1', marketingConsent: true }, {});
    expect(withConsent.data[0].user_data.ph).toMatch(/^[a-f0-9]{64}$/);
    expect(withConsent.data[0].user_data.fn).toMatch(/^[a-f0-9]{64}$/);
    expect(withConsent.data[0].user_data.ln).toMatch(/^[a-f0-9]{64}$/);
    expect(withConsent.data[0].user_data.country).toMatch(/^[a-f0-9]{64}$/);
    const withoutConsent = buildMetaPayload(prospect, { eventId: 'e1', marketingConsent: false }, {});
    expect(withoutConsent.data[0].user_data.ph).toBeUndefined();
    expect(withoutConsent.data[0].user_data.em).toBeUndefined();
    expect(withoutConsent.data[0].user_data.fn).toBeUndefined();
    expect(withoutConsent.data[0].user_data.ln).toBeUndefined();
    expect(withoutConsent.data[0].user_data.country).toBeUndefined();
  });
});

describe('3sites — WhatsApp purpose matrix on the real ledger', () => {
  const ph = p8(26);
  const phE164 = `+65${ph}`;
  let prospect;

  beforeAll(async () => {
    markPhoneVerified(phE164);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: ph, consent_contact: true, consent_terms: true }))
      .expect(201);
    prospect = await Prospect.findOne({ where: { phone: phE164, campaignId: campaign1.id } });
  });

  test('transactional survives unsubscribe; marketing needs the verified grant; erasure blocks all', async () => {
    // Verified scoped grant, no suppression: both purposes pass.
    expect(await canWhatsAppProspect(prospect)).toBe(true);
    expect(await canWhatsAppProspect(prospect, { purpose: 'marketing' })).toBe(true);

    // Global unsubscribe: fulfilment keeps flowing, marketing stops.
    const consumer = await Consumer.findOne({ where: { phone: phE164 } });
    const token = await ensureUnsubToken(consumer.id);
    await request(app).post(`/api/unsubscribe?t=${token}`).type('form').send('').expect(200);
    expect(await canWhatsAppProspect(prospect)).toBe(true);
    expect(await canWhatsAppProspect(prospect, { purpose: 'marketing' })).toBe(false);

    // Erasure blocks even transactional — and the sender receipts 'suppressed'
    // via its real default isSendBlocked before any credential/network work.
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'whatsapp', reason: 'erasure' });
    expect(await canWhatsAppProspect(prospect)).toBe(false);

    const prevFlag = process.env.REDEEM_OPS_WHATSAPP_ENABLED;
    process.env.REDEEM_OPS_WHATSAPP_ENABLED = 'true';
    try {
      const svc = makeWhatsappService({
        RewardOffer: { findByPk: async () => ({ publicTitle: 'Test Reward' }) },
        fetch: async () => { throw new Error('must not reach the network'); },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      const r = await svc.sendReservationWhatsApp({
        entitlement: { id: 'e-int-1', rewardOfferId: 'ro-1', expiresAt: new Date() },
        prospect,
        presentationToken: 'ptok',
      });
      expect(r).toEqual({ sent: false, skipped: 'suppressed' });
    } finally {
      if (prevFlag === undefined) delete process.env.REDEEM_OPS_WHATSAPP_ENABLED;
      else process.env.REDEEM_OPS_WHATSAPP_ENABLED = prevFlag;
    }
  });
});
