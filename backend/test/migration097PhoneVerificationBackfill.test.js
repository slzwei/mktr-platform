import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { createHash } from 'crypto';
import { sequelize, Prospect } from '../src/models/index.js';
import { up, down } from '../src/database/migrations/097-backfill-pre-epoch-phone-verification.js';
import { phoneVerificationIsCurrent, phoneVerificationEvidence } from '../src/services/consumerService.js';

/**
 * 097 on real Postgres. The migration asserts something it cannot prove from a
 * surviving record — that these leads passed OTP — so the tests here are less
 * about "did it write" and more about "did it write ONLY where the inference
 * holds". Every exclusion below is a row that would be a false claim.
 */

const EPOCH = Date.parse('2026-07-10T00:00:00Z');
const BEFORE = new Date(EPOCH - 9 * 24 * 3600_000); // 2026-07-01, the real wave
const AFTER = new Date(EPOCH + 24 * 3600_000);
const sha = (v) => createHash('sha256').update(v).digest('hex');

// The browser-session evidence every genuine form submission carries.
const browserMeta = (extra = {}) => ({
  clientIp: '1.2.3.4',
  clientUserAgent: 'Mozilla/5.0 (iPhone)',
  eventSourceUrl: 'https://redeem.sg/c/abc',
  consent_contact: true,
  ...extra,
});

let admin; let campaignId;

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  const campaign = await createTestCampaign(admin.user.id, { name: 'Backfill 097' });
  campaignId = campaign.id;
});

afterAll(async () => {
  await closeDb();
});

/** Backdate via raw SQL — Sequelize silently drops createdAt on instance
 *  updates, and this migration keys entirely on createdAt. */
async function mkProspect({ createdAt, phone, leadSource = 'website', sourceMetadata }) {
  const p = await createTestProspect(campaignId, { phone, leadSource, sourceMetadata });
  await sequelize.query(
    'UPDATE prospects SET "createdAt" = :createdAt WHERE id = :id',
    { replacements: { createdAt, id: p.id } }
  );
  const reread = await Prospect.findByPk(p.id);
  expect(new Date(reread.createdAt).getTime()).toBe(createdAt.getTime()); // backdate landed
  return reread;
}

const reload = async (id) => (await Prospect.findByPk(id)).sourceMetadata;

test('stamps pre-epoch browser signups, and ONLY those', async () => {
  const inScope = await mkProspect({
    createdAt: BEFORE, phone: '+6594652996', sourceMetadata: browserMeta({ fbp: 'fb.1.2.3' }),
  });
  const referral = await mkProspect({
    createdAt: BEFORE, phone: '+6594652997', leadSource: 'referral', sourceMetadata: browserMeta(),
  });
  // Retell: no form, and for inbound calls the phone is MKTR's own DDI — a
  // stamp here would assert control of our own number.
  const voice = await mkProspect({
    createdAt: BEFORE, phone: '+6562773210', leadSource: 'call_bot',
    sourceMetadata: { retellCallId: 'c1', fromNumber: '+6591112222' },
  });
  // Raw API POST: captured as a lead, never saw the OTP-gated form.
  const rawPost = await mkProspect({
    createdAt: BEFORE, phone: '+6594652998', sourceMetadata: { utm: { utm_source: 'api' } },
  });
  // Post-epoch and unstamped: it genuinely failed to earn one. Not ours to launder.
  const postEpoch = await mkProspect({
    createdAt: AFTER, phone: '+6594652999', sourceMetadata: browserMeta(),
  });

  await up({ sequelize });

  const stamped = await reload(inScope.id);
  expect(stamped.phoneVerifiedAt).toBe('2026-07-01T00:00:00.000Z'); // the row's OWN createdAt
  expect(stamped.phoneVerifiedFor).toBe(sha('+6594652996'));
  expect(stamped.phoneVerifiedSource).toBe('backfill_gate_inference');
  expect(stamped.clientUserAgent).toBe('Mozilla/5.0 (iPhone)'); // pre-existing keys survive
  expect(stamped.fbp).toBe('fb.1.2.3');

  expect((await reload(referral.id)).phoneVerifiedAt).toBeDefined();

  for (const excluded of [voice, rawPost, postEpoch]) {
    expect((await reload(excluded.id)).phoneVerifiedAt).toBeUndefined();
  }
});

test('the stamp it writes is one the live readers accept', async () => {
  const p = await mkProspect({
    createdAt: BEFORE, phone: '+6594651001', sourceMetadata: browserMeta(),
  });
  await up({ sequelize });
  const row = await Prospect.findByPk(p.id);

  // The whole point: these three used to say "unverified" for this lead.
  expect(phoneVerificationIsCurrent(row)).toBe(true);
  expect(phoneVerificationEvidence(row)).toBe('verified');
  // And the binding still bites — a later phone edit must not inherit it.
  expect(phoneVerificationIsCurrent({ ...row.toJSON(), phone: '+6598887777' })).toBe(false);
});

test('never overwrites a real stamp, and re-running changes nothing', async () => {
  const real = { ...browserMeta(), phoneVerifiedAt: '2026-07-02T09:00:00.000Z' };
  const genuine = await mkProspect({
    createdAt: BEFORE, phone: '+6594651002', sourceMetadata: real,
  });

  await up({ sequelize });
  const first = await reload(genuine.id);
  expect(first.phoneVerifiedAt).toBe('2026-07-02T09:00:00.000Z');
  expect(first.phoneVerifiedSource).toBeUndefined(); // untouched, so unmarked

  const target = await mkProspect({
    createdAt: BEFORE, phone: '+6594651003', sourceMetadata: browserMeta(),
  });
  await up({ sequelize });
  const once = await reload(target.id);
  await up({ sequelize });
  expect(await reload(target.id)).toEqual(once); // idempotent
});

test('down() reverses exactly what it wrote and nothing else', async () => {
  const inferred = await mkProspect({
    createdAt: BEFORE, phone: '+6594651004', sourceMetadata: browserMeta(),
  });
  const genuine = await mkProspect({
    createdAt: BEFORE, phone: '+6594651005',
    sourceMetadata: { ...browserMeta(), phoneVerifiedAt: '2026-07-02T09:00:00.000Z' },
  });

  await up({ sequelize });
  await down({ sequelize });

  const rolled = await reload(inferred.id);
  expect(rolled.phoneVerifiedAt).toBeUndefined();
  expect(rolled.phoneVerifiedFor).toBeUndefined();
  expect(rolled.phoneVerifiedSource).toBeUndefined();
  expect(rolled.clientUserAgent).toBe('Mozilla/5.0 (iPhone)'); // only the 3 keys go

  // A genuinely-earned stamp survives a rollback — it never carried the marker.
  expect((await reload(genuine.id)).phoneVerifiedAt).toBe('2026-07-02T09:00:00.000Z');
});
