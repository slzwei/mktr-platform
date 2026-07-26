import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { randomUUID } from 'crypto';
import { sequelize, Consumer, ConsentEvent } from '../src/models/index.js';
import { up, down } from '../src/database/migrations/098-correct-backfilled-consent-verified.js';
import { makeConsentService } from '../src/services/consentService.js';

/**
 * 098 on real Postgres. The migration touches a compliance ledger, so the
 * tests that matter are the ones about what it must NOT do: never flip a
 * denial, never resurrect consent past an unsubscribe, never modify an
 * original row, never touch a prospect 097 did not stamp.
 */

const BEFORE = new Date('2026-07-01T15:35:19Z');
const STAMPED = {
  clientUserAgent: 'Mozilla/5.0', eventSourceUrl: 'https://redeem.sg/c/a', consent_contact: true,
  phoneVerifiedAt: '2026-07-01T15:35:19.000Z',
  phoneVerifiedFor: 'deadbeef',
  phoneVerifiedSource: 'backfill_gate_inference',
};
const UNSTAMPED = { clientUserAgent: 'Mozilla/5.0', eventSourceUrl: 'https://redeem.sg/c/a' };

let admin; let campaignId; let svc; let seq = 0;

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  const campaign = await createTestCampaign(admin.user.id, { name: 'Consent 098' });
  campaignId = campaign.id;
  svc = makeConsentService();
});

afterAll(async () => {
  await closeDb();
});

/** A linked prospect + consumer with one backfilled contact grant. */
async function seed({ sourceMetadata, granted = true, verified = false }) {
  seq += 1;
  const phone = `+6597${String(100000 + seq).slice(-6)}`;
  const consumer = await Consumer.create({ phone, firstSeenAt: BEFORE, lastSeenAt: BEFORE });
  const p = await createTestProspect(campaignId, {
    phone, leadSource: 'website', sourceMetadata, consumerId: consumer.id,
  });
  await sequelize.query('UPDATE prospects SET "createdAt" = :c WHERE id = :id', {
    replacements: { c: BEFORE, id: p.id },
  });
  const ev = await ConsentEvent.create({
    id: randomUUID(), consumerId: consumer.id, prospectId: p.id, campaignId,
    kind: 'contact', granted, channels: ['phone', 'email'], version: 'legacy-backfill',
    source: 'backfill', sourceUrl: 'https://redeem.sg/c/a', verified,
    occurredAt: BEFORE, metadata: null,
  });
  return { consumer, prospect: p, event: ev };
}

const latestContact = async (consumerId) => {
  const rows = await ConsentEvent.findAll({
    where: { consumerId, kind: 'contact' },
    order: [['occurredAt', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
  });
  return rows[0];
};

test('corrects a stamped grant by APPENDING, leaving the original untouched', async () => {
  const { consumer, event } = await seed({ sourceMetadata: STAMPED });

  await up({ sequelize });

  const original = await ConsentEvent.findByPk(event.id);
  expect(original.verified).toBe(false); // never mutated
  expect(original.source).toBe('backfill');

  const latest = await latestContact(consumer.id);
  expect(latest.id).not.toBe(event.id);
  expect(latest.verified).toBe(true);
  expect(latest.granted).toBe(true);
  expect(latest.source).toBe('admin');
  expect(latest.metadata.correctionOf).toBe(event.id);
  expect(latest.metadata.reason).toBe('phone_verification_backfill');
  // The load-bearing detail: the act is NOT redated.
  expect(new Date(latest.occurredAt).getTime()).toBe(BEFORE.getTime());
  expect(latest.channels).toEqual(['phone', 'email']); // evidence copied verbatim
  expect(latest.version).toBe('legacy-backfill');
});

test('does NOT resurrect consent for someone who unsubscribed afterwards', async () => {
  const { consumer, prospect } = await seed({ sourceMetadata: STAMPED });
  // A genuine later withdrawal, global scope, as unsubscribe writes it.
  const unsubAt = new Date('2026-07-15T00:00:00Z');
  await ConsentEvent.create({
    id: randomUUID(), consumerId: consumer.id, prospectId: prospect.id, campaignId: null,
    kind: 'contact', granted: false, channels: null, version: 'unsub-v1',
    source: 'unsubscribe', verified: true, occurredAt: unsubAt, metadata: null,
  });

  await up({ sequelize });

  const latest = await latestContact(consumer.id);
  expect(latest.source).toBe('unsubscribe');
  expect(latest.granted).toBe(false); // withdrawal still wins on occurredAt
});

test('never flips a denial, and never touches an unstamped prospect', async () => {
  const denial = await seed({ sourceMetadata: STAMPED, granted: false });
  const unstamped = await seed({ sourceMetadata: UNSTAMPED });

  await up({ sequelize });

  for (const s of [denial, unstamped]) {
    const rows = await ConsentEvent.findAll({ where: { consumerId: s.consumer.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(false);
  }
});

test('idempotent, and down() removes only what it wrote', async () => {
  const { consumer, event } = await seed({ sourceMetadata: STAMPED });

  await up({ sequelize });
  const afterFirst = await ConsentEvent.count({ where: { consumerId: consumer.id } });
  await up({ sequelize });
  expect(await ConsentEvent.count({ where: { consumerId: consumer.id } })).toBe(afterFirst);

  await down({ sequelize });
  const rows = await ConsentEvent.findAll({ where: { consumerId: consumer.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(event.id);
  expect(rows[0].verified).toBe(false); // original survived the round trip intact
});

test('the marketing gate opens for the corrected person, in their campaign scope only', async () => {
  const { consumer } = await seed({ sourceMetadata: STAMPED });
  const consent = svc;

  expect(await consent.canMarketTo({ consumerId: consumer.id, campaignId })).toBe(false);

  await up({ sequelize });

  expect(await consent.canMarketTo({ consumerId: consumer.id, campaignId })).toBe(true);
  // Legacy-era rows stay campaign-locked — the correction must not widen scope.
  expect(await consent.canMarketTo({ consumerId: consumer.id, campaignId: null })).toBe(false);
});
