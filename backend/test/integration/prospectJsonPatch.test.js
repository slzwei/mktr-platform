/**
 * prospectJsonPatch — REAL-POSTGRES semantics proof. The whole point of the
 * helper is behavior mocks cannot certify: jsonb_set no-ops on missing
 * parents, NULL-column COALESCE, first-wins merge direction, CAS races,
 * `#-` true key removal, and the erased guard (plan google-ads-signal-levers
 * §4.3).
 */
import crypto from 'crypto';
import {
  getApp, closeDb, createTestUser, createTestCampaign,
} from '../helpers.js';
import { Prospect } from '../../src/models/index.js';
import {
  mergeFirstWins, setPath, removePaths,
} from '../../src/utils/prospectJsonPatch.js';

let campaign;

beforeAll(async () => {
  await getApp();
  const admin = await createTestUser({ role: 'admin' });
  campaign = await createTestCampaign(admin.user.id);
});

afterAll(async () => {
  await closeDb();
});

async function seed(sourceMetadata) {
  return Prospect.create({
    firstName: 'Patch', lastName: 'Case',
    email: `patch-${crypto.randomUUID().slice(0, 8)}@test.com`,
    phone: `+659${String(Math.floor(1000000 + Math.random() * 8999999))}`,
    campaignId: campaign.id, leadSource: 'website',
    ...(sourceMetadata !== undefined ? { sourceMetadata } : {}),
  });
}

async function smOf(id) {
  const row = await Prospect.findByPk(id, { raw: true });
  return row.sourceMetadata;
}

describe('mergeFirstWins', () => {
  test('creates parents on a NULL column and merges multi-key atomically', async () => {
    const p = await seed(null);
    const n = await mergeFirstWins(p.id, ['outcomes'], {
      confirmed_resident: '2026-08-18T01:00:00Z',
      closed_won: '2026-08-18T01:00:00Z',
    });
    expect(n).toBe(1);
    expect((await smOf(p.id)).outcomes).toEqual({
      confirmed_resident: '2026-08-18T01:00:00Z',
      closed_won: '2026-08-18T01:00:00Z',
    });
  });

  test('FIRST WINS: an existing key survives a replay; absent keys still insert', async () => {
    const p = await seed({ outcomes: { confirmed_resident: 'EARLIER' } });
    await mergeFirstWins(p.id, ['outcomes'], {
      confirmed_resident: 'LATER-MUST-LOSE',
      closed_won: 'NEW',
    });
    expect((await smOf(p.id)).outcomes).toEqual({
      confirmed_resident: 'EARLIER',
      closed_won: 'NEW',
    });
  });

  test('deep path preserves siblings at every level (redemption map shape)', async () => {
    const p = await seed({ capi: { confirmedResidentAt: 'K', voucherRedeemed: { e1: 'T1' } }, utm: { utm_source: 'g' } });
    await mergeFirstWins(p.id, ['capi', 'voucherRedeemed'], { e2: 'T2' });
    const sm = await smOf(p.id);
    expect(sm.capi.voucherRedeemed).toEqual({ e1: 'T1', e2: 'T2' });
    expect(sm.capi.confirmedResidentAt).toBe('K'); // sibling intact
    expect(sm.utm).toEqual({ utm_source: 'g' }); // top-level sibling intact
  });

  test('never touches an erased skeleton (returns 0)', async () => {
    const p = await seed({ erased: true });
    expect(await mergeFirstWins(p.id, ['outcomes'], { confirmed_resident: 'X' })).toBe(0);
    expect((await smOf(p.id)).outcomes).toBeUndefined();
  });
});

describe('setPath with CAS', () => {
  test('replace + parent-ensure; absent-CAS blocks a second writer', async () => {
    const p = await seed({});
    const first = await setPath(p.id, ['gads', 'confirmed_resident'], { state: 'pending', requestId: 'r1' }, { cas: { path: ['gads', 'confirmed_resident'], absent: true } });
    expect(first).toBe(1);
    const second = await setPath(p.id, ['gads', 'confirmed_resident'], { state: 'pending', requestId: 'r2' }, { cas: { path: ['gads', 'confirmed_resident'], absent: true } });
    expect(second).toBe(0); // CAS lost — no clobber
    expect((await smOf(p.id)).gads.confirmed_resident.requestId).toBe('r1');
  });

  test('contains-CAS: a stale poll for an old requestId cannot regress delivered', async () => {
    const p = await seed({ gads: { k: { state: 'delivered', requestId: 'new' } } });
    const n = await setPath(p.id, ['gads', 'k'], { state: 'failedPermanent' }, { cas: { path: ['gads', 'k'], contains: { requestId: 'old' } } });
    expect(n).toBe(0);
    expect((await smOf(p.id)).gads.k.state).toBe('delivered');
    const ok = await setPath(p.id, ['gads', 'k'], { state: 'retryWait', requestId: 'new' }, { cas: { path: ['gads', 'k'], contains: { requestId: 'new', state: 'delivered' } } });
    expect(ok).toBe(1);
  });
});

describe('removePaths', () => {
  test('truly removes keys (existence predicates see absence), preserves siblings', async () => {
    const p = await seed({ phoneVerifiedAt: 'T', phoneVerifiedFor: 'H', utm: { utm_source: 'g' } });
    expect(await removePaths(p.id, [['phoneVerifiedAt'], ['phoneVerifiedFor']])).toBe(1);
    const sm = await smOf(p.id);
    expect('phoneVerifiedAt' in sm).toBe(false);
    expect('phoneVerifiedFor' in sm).toBe(false);
    expect(sm.utm).toEqual({ utm_source: 'g' });
  });

  test('erased guard holds for removals too', async () => {
    const p = await seed({ erased: true, phoneVerifiedAt: 'T' });
    expect(await removePaths(p.id, [['phoneVerifiedAt']])).toBe(0);
  });
});

describe('concurrency: atomic single-key writers cannot clobber each other', () => {
  test('interleaved merges to sibling parents both land', async () => {
    const p = await seed(null);
    await Promise.all([
      mergeFirstWins(p.id, ['outcomes'], { confirmed_resident: 'A' }),
      setPath(p.id, ['capi', 'confirmedResidentAt'], 'B'),
      setPath(p.id, ['recordingUrl'], 'https://r.example/x'),
    ]);
    const sm = await smOf(p.id);
    expect(sm.outcomes.confirmed_resident).toBe('A');
    expect(sm.capi.confirmedResidentAt).toBe('B');
    expect(sm.recordingUrl).toBe('https://r.example/x');
  });
});
