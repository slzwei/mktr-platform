import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import {
  Consumer, ConsentEvent, ConsumerSuppression, Draw, DrawEntry,
} from '../src/models/index.js';
import {
  previewCohort, listCohortMembers, canMarketToBatch, getCohortFacets, normalizeDefinition,
} from '../src/services/cohortService.js';
import { canMarketTo } from '../src/services/consentService.js';
import { hashPhone } from '../src/utils/piiHashing.js';

/**
 * Cohort builder semantics (tracker "cohortapi",
 * docs/plans/cohort-builder-backend.md) on real Postgres: filter resolution,
 * the binding 18+ age gate (real-calendar dob validation, under-18 claims
 * disqualify outright), destination checks, the reachable/excluded split —
 * and the PARITY suite proving canMarketToBatch === consentService.canMarketTo
 * per person, including forced timestamp ties down to the uuid tie-break.
 * That parity is what licenses the batch SQL to exist; if canMarketTo's
 * semantics change, this file is what breaks.
 */

const RUN = Date.now() % 1000000000;
let seq = 0;
const nextPhone = () => `+658${String(RUN + (seq += 1)).padStart(7, '0').slice(-7)}`;

const T0 = new Date('2026-06-01T00:00:00Z');
const T1 = new Date('2026-06-02T00:00:00Z');
const T2 = new Date('2026-06-03T00:00:00Z');

const ADULT_DOB = '1990-05-12';   // 36 in Jul 2026
const YOUNG_DOB = '2000-01-15';   // 26 in Jul 2026
const MINOR_DOB = '2015-03-01';   // 11 in Jul 2026
const IMPOSSIBLE_DOB = '2000-02-30'; // shape-valid, not a real calendar date

let admin;
let campA; let campB; let campC;
let draw1;
const C = {}; // fixture consumers by key

async function makeConsumer(key, { phone = nextPhone(), erased = false, ...rest } = {}) {
  const consumer = await Consumer.create({
    phone: erased ? null : phone,
    phoneHash: erased ? null : hashPhone(phone),
    firstName: key,
    lastName: 'Cohort',
    firstSeenAt: T0,
    lastSeenAt: T0,
    signupCount: 1,
    erasedAt: erased ? T1 : null,
    ...rest,
  });
  consumer._phone = phone;
  C[key] = consumer;
  return consumer;
}

async function signup(consumer, campaign, { dob = ADULT_DOB, demographics = {}, location = {}, phone } = {}) {
  return createTestProspect(campaign.id, {
    firstName: consumer.firstName,
    phone: phone || consumer._phone,
    consumerId: consumer.id,
    demographics: dob === null ? { ...demographics } : { dateOfBirth: dob, ...demographics },
    location,
  });
}

async function consent(consumer, {
  campaignId = null, granted = true, verified = true, occurredAt = T1, createdAt, id,
} = {}) {
  return ConsentEvent.create({
    ...(id ? { id } : {}),
    consumerId: consumer.id,
    campaignId,
    kind: 'contact',
    granted,
    channels: ['phone', 'whatsapp', 'email'],
    version: 'cohort-test-v1',
    source: 'signup',
    verified,
    occurredAt,
    ...(createdAt ? { createdAt } : {}),
  });
}

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  campA = await createTestCampaign(admin.user.id, { name: `Cohort A ${RUN}`, tags: ['parenting', 'family'] });
  campB = await createTestCampaign(admin.user.id, { name: `Cohort B ${RUN}`, tags: ['home'] });
  campC = await createTestCampaign(admin.user.id, { name: `Cohort C ${RUN}` });

  // ALICE — adult, campA, verified GLOBAL grant, HAS an email → reachable
  // everywhere including the email channel.
  await makeConsumer('ALICE', { email: `alice-${RUN}@cohort.test` });
  await signup(C.ALICE, campA);
  await consent(C.ALICE, { campaignId: null });

  // BOB — adult, campA, verified grant SCOPED to campA only (legacy era)
  // → reachable only when the gate asks about campA.
  await makeConsumer('BOB');
  await signup(C.BOB, campA);
  await consent(C.BOB, { campaignId: campA.id });

  // CARA — adult, campB, verified global grant + channel-'all' suppression.
  await makeConsumer('CARA');
  await signup(C.CARA, campB);
  await consent(C.CARA, { campaignId: null });
  await ConsumerSuppression.create({ consumerId: C.CARA.id, channel: 'all', reason: 'unsubscribe' });

  // DAN — adult, campA, global grant but UNVERIFIED.
  await makeConsumer('DAN');
  await signup(C.DAN, campA);
  await consent(C.DAN, { campaignId: null, verified: false });

  // ERIN — adult, campA, no consent events at all.
  await makeConsumer('ERIN');
  await signup(C.ERIN, campA);

  // FAY — minor, campA, verified global grant.
  await makeConsumer('FAY');
  await signup(C.FAY, campA, { dob: MINOR_DOB });
  await consent(C.FAY, { campaignId: null });

  // GUS — no dob anywhere, campA, verified global grant.
  await makeConsumer('GUS');
  await signup(C.GUS, campA, { dob: null });
  await consent(C.GUS, { campaignId: null });

  // HANK — adult (26), campB, income + postal attributes, verified global grant.
  await makeConsumer('HANK');
  await signup(C.HANK, campB, {
    dob: YOUNG_DOB,
    demographics: { income: '$3,000 - $4,999', education: 'Degree', gender: 'male' },
    location: { postalCode: '520123' },
  });
  await consent(C.HANK, { campaignId: null });

  // IVY — adult, campA, global grant then LATER global revoke (latest wins).
  await makeConsumer('IVY');
  await signup(C.IVY, campA);
  await consent(C.IVY, { campaignId: null, occurredAt: T1 });
  await consent(C.IVY, { campaignId: null, granted: false, occurredAt: T2 });

  // JOE — adult, campA, draw entry linked via prospectId, verified global grant.
  await makeConsumer('JOE');
  const joeProspect = await signup(C.JOE, campA);
  await consent(C.JOE, { campaignId: null });
  draw1 = await Draw.create({ campaignId: campA.id, closesAt: new Date('2026-10-30T00:00:00Z'), createdBy: admin.user.id });
  await DrawEntry.create({ drawId: draw1.id, prospectId: joeProspect.id, phoneHash: hashPhone(C.JOE._phone), phoneLast4: C.JOE._phone.slice(-4), chances: 1 });

  // KIM — adult (dob via her campB signup), draw entry with prospectId NULL
  // — membership must resolve through the phoneHash fallback branch.
  await makeConsumer('KIM');
  await signup(C.KIM, campB);
  await consent(C.KIM, { campaignId: null });
  await DrawEntry.create({ drawId: draw1.id, prospectId: null, phoneHash: hashPhone(C.KIM._phone), phoneLast4: C.KIM._phone.slice(-4), chances: 1 });

  // An ERASED person's entry: hash rewritten to the all-zeros sentinel
  // (erasureService) — must match nobody, ever.
  await DrawEntry.create({ drawId: draw1.id, prospectId: null, phoneHash: '0'.repeat(64), phoneLast4: null, chances: 1 });

  // LEO — adult, campA, verified global grant, suppressed on EMAIL only —
  // passes a channel-'all' gate (isSuppressed semantics), fails 'email'.
  await makeConsumer('LEO');
  await signup(C.LEO, campA);
  await consent(C.LEO, { campaignId: null });
  await ConsumerSuppression.create({ consumerId: C.LEO.id, channel: 'email', reason: 'unsubscribe' });

  // MAX — ERASED person with a campA signup: must never appear in any cohort.
  await makeConsumer('MAX', { erased: true });
  await signup(C.MAX, campA, { phone: null });

  // NED — CONFLICTING dobs (adult on campA, under-18 on campB) + verified
  // global grant. The under-18 claim disqualifies him outright (§9.5-2
  // fail-closed): reachable NOWHERE, reason age_conflict.
  await makeConsumer('NED');
  await signup(C.NED, campA, { dob: '1980-01-01' });
  await signup(C.NED, campB, { dob: '2012-01-01' });
  await consent(C.NED, { campaignId: null });

  // OTT — two ADULT dobs (a typo'd year, both ≥ 18) on campC: benign
  // multi-dob must NOT be treated as a conflict.
  await makeConsumer('OTT');
  await signup(C.OTT, campC, { dob: '1985-04-01' });
  // Second signup carries a different entered phone (unique (campaignId,
  // phone) index) — the consumerId link is what makes it his.
  await signup(C.OTT, campC, { dob: '1986-04-01', phone: nextPhone() });
  await consent(C.OTT, { campaignId: null });

  // PIA — shape-valid but IMPOSSIBLE calendar dob on campC: fails closed as
  // age_unknown (and must not abort the query).
  await makeConsumer('PIA');
  await signup(C.PIA, campC, { dob: IMPOSSIBLE_DOB });
  await consent(C.PIA, { campaignId: null });

  // TIA — occurredAt TIE, createdAt decides: the later-created grant wins.
  await makeConsumer('TIA');
  await signup(C.TIA, campC);
  await consent(C.TIA, { campaignId: null, granted: false, occurredAt: T2, createdAt: T0 });
  await consent(C.TIA, { campaignId: null, granted: true, occurredAt: T2, createdAt: T1 });

  // UMA — occurredAt AND createdAt tie, uuid decides (id DESC): the high-id
  // DENIAL wins over the low-id grant.
  await makeConsumer('UMA');
  await signup(C.UMA, campC);
  await consent(C.UMA, {
    campaignId: null, granted: true, occurredAt: T2, createdAt: T2,
    id: '00000000-0000-4000-8000-0000000000aa',
  });
  await consent(C.UMA, {
    campaignId: null, granted: false, occurredAt: T2, createdAt: T2,
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  });
});

afterAll(async () => {
  await closeDb();
});

const ids = (members) => members.map((m) => m.consumerId).sort();
const idOf = (...keys) => keys.map((k) => C[k].id).sort();

async function memberIds(definition, opts = {}) {
  const { members } = await listCohortMembers(definition, { limit: 200, ...opts });
  return ids(members);
}

describe('filter resolution', () => {
  test('campaignIds: OR within the list, restricted to those signups', async () => {
    const got = await memberIds({ filters: { campaignIds: [campA.id] } });
    expect(got).toEqual(idOf('ALICE', 'BOB', 'DAN', 'ERIN', 'FAY', 'GUS', 'IVY', 'JOE', 'LEO', 'NED'));
    const both = await memberIds({ filters: { campaignIds: [campA.id, campB.id] } });
    expect(both).toEqual(idOf('ALICE', 'BOB', 'CARA', 'DAN', 'ERIN', 'FAY', 'GUS', 'HANK', 'IVY', 'JOE', 'KIM', 'LEO', 'NED'));
  });

  test('erased consumers never appear, even with a matching signup', async () => {
    const got = await memberIds({ filters: { campaignIds: [campA.id] } });
    expect(got).not.toContain(C.MAX.id);
    const batch = await canMarketToBatch([C.MAX.id]);
    expect(batch.get(C.MAX.id)).toEqual({ ok: false, reasons: ['erased', 'not_consented'] });
  });

  test('drawIds: via prospect link AND via phoneHash fallback; zero-sentinel matches nobody', async () => {
    const got = await memberIds({ filters: { drawIds: [draw1.id] } });
    expect(got).toEqual(idOf('JOE', 'KIM'));
  });

  test('anyDraw behaves like draw membership without the id restriction', async () => {
    const got = await memberIds({ filters: { anyDraw: true } });
    expect(got).toEqual(idOf('JOE', 'KIM'));
  });

  test('campaignTags: matches signups whose campaign carries ANY listed tag', async () => {
    const parenting = await memberIds({ filters: { campaignTags: ['parenting'] } });
    expect(parenting).toEqual(idOf('ALICE', 'BOB', 'DAN', 'ERIN', 'FAY', 'GUS', 'IVY', 'JOE', 'LEO', 'NED'));
    const home = await memberIds({ filters: { campaignTags: ['home', 'nope'] } });
    expect(home).toEqual(idOf('CARA', 'HANK', 'KIM', 'NED'));
    const none = await memberIds({ filters: { campaignTags: ['nonexistent'] } });
    expect(none).toEqual([]);
  });

  test('attributes: postal prefix and income, independent EXISTS per list, AND across', async () => {
    expect(await memberIds({ filters: { attributes: { postalPrefixes: ['52'] } } })).toEqual(idOf('HANK'));
    expect(await memberIds({ filters: { attributes: { incomes: ['$3,000 - $4,999'] } } })).toEqual(idOf('HANK'));
    expect(await memberIds({ filters: { attributes: { postalPrefixes: ['99'] } } })).toEqual([]);
    expect(await memberIds({
      filters: { campaignIds: [campB.id], attributes: { incomes: ['$3,000 - $4,999'] } },
    })).toEqual(idOf('HANK'));
    expect(await memberIds({
      filters: { campaignIds: [campA.id], attributes: { incomes: ['$3,000 - $4,999'] } },
    })).toEqual([]);
  });
});

describe('age gate (§9.5-2, binding)', () => {
  test('defaults to 18+; separates under-age, unknown, conflict', async () => {
    const preview = await previewCohort({ filters: { campaignIds: [campA.id] } });
    expect(preview.gate.minAge).toBe(18);
    const { members } = await listCohortMembers({ filters: { campaignIds: [campA.id] } }, { status: 'excluded', limit: 200 });
    const by = Object.fromEntries(members.map((m) => [m.consumerId, m.reasons]));
    expect(by[C.FAY.id]).toContain('age_ineligible');
    expect(by[C.GUS.id]).toContain('age_unknown');
    expect(by[C.NED.id]).toContain('age_conflict'); // adult dob + under-18 dob → disqualified outright
  });

  test('an impossible calendar dob fails closed as age_unknown', async () => {
    const { members } = await listCohortMembers(
      { filters: { campaignIds: [campC.id] } }, { status: 'excluded', limit: 200 },
    );
    const pia = members.find((m) => m.consumerId === C.PIA.id);
    expect(pia.reasons).toEqual(['age_unknown']);
  });

  test('benign multi-dob (both adult) is NOT a conflict', async () => {
    const { members } = await listCohortMembers(
      { filters: { campaignIds: [campC.id] } }, { status: 'reachable', limit: 200 },
    );
    expect(ids(members)).toContain(C.OTT.id);
  });

  test('minAge below 18 is rejected outright', () => {
    expect(() => normalizeDefinition({ ageGate: { minAge: 16 } }))
      .toThrow(/§9.5-2|not permitted/);
  });

  test('maxAge window: min AND max must hold on the SAME dob', async () => {
    // [18,30]: HANK (26) passes; ALICE (36) out; NED's two dobs (46 & 14)
    // must NOT combine to fake a pass.
    const got = await memberIds({ filters: {}, ageGate: { minAge: 18, maxAge: 30 } });
    expect(got).toContain(C.HANK.id);
    const { members } = await listCohortMembers(
      { filters: {}, ageGate: { minAge: 18, maxAge: 30 } }, { status: 'excluded', limit: 200 },
    );
    const by = Object.fromEntries(members.map((m) => [m.consumerId, m.reasons]));
    expect(by[C.NED.id]).toContain('age_ineligible');
    expect(by[C.ALICE.id]).toContain('age_ineligible');
  });
});

describe('reachability split (the batch canMarketTo + practical checks)', () => {
  test('reachable = consented ∧ verified ∧ ¬suppressed ∧ adult ∧ has destination', async () => {
    const { members } = await listCohortMembers(
      { filters: { campaignIds: [campA.id] } }, { status: 'reachable', limit: 200 },
    );
    expect(ids(members)).toEqual(idOf('ALICE', 'JOE', 'LEO'));
    for (const m of members) expect(m.reasons).toEqual([]);
  });

  test('exclusion reasons name each failing condition', async () => {
    const { members } = await listCohortMembers(
      { filters: { campaignIds: [campA.id] } }, { status: 'excluded', limit: 200 },
    );
    const by = Object.fromEntries(members.map((m) => [m.consumerId, m.reasons]));
    expect(by[C.BOB.id]).toEqual(['not_consented']);      // scoped grant ≠ global basis
    expect(by[C.DAN.id]).toEqual(['not_verified']);
    expect(by[C.ERIN.id]).toEqual(['not_consented']);
    expect(by[C.IVY.id]).toEqual(['not_consented']);      // later global revoke wins
    expect(by[C.FAY.id]).toEqual(['age_ineligible']);
    expect(by[C.GUS.id]).toEqual(['age_unknown']);
    expect(by[C.NED.id]).toEqual(['age_conflict']);
  });

  test('marketingContext.campaignId re-scopes the gate: legacy scoped grants count for THAT campaign', async () => {
    const scoped = await listCohortMembers(
      { filters: { campaignIds: [campA.id] }, marketingContext: { campaignId: campA.id } },
      { status: 'reachable', limit: 200 },
    );
    expect(ids(scoped.members)).toEqual(idOf('ALICE', 'BOB', 'JOE', 'LEO'));
  });

  test('gate scope must reference a real campaign', async () => {
    await expect(previewCohort({
      filters: {}, marketingContext: { campaignId: '00000000-0000-4000-8000-000000000000' },
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('channel email: destination required AND email suppression bites', async () => {
    const email = await listCohortMembers(
      { filters: { campaignIds: [campA.id] } }, { status: 'reachable', channel: 'email', limit: 200 },
    );
    expect(ids(email.members)).toEqual(idOf('ALICE')); // only ALICE has an email
    const excluded = await listCohortMembers(
      { filters: { campaignIds: [campA.id] } }, { status: 'excluded', channel: 'email', limit: 200 },
    );
    const by = Object.fromEntries(excluded.members.map((m) => [m.consumerId, m.reasons]));
    expect(by[C.JOE.id]).toEqual(['missing_email']);
    expect(by[C.LEO.id]).toEqual(expect.arrayContaining(['missing_email', 'suppressed']));
  });

  test('channel whatsapp: phone destination, email-only suppression does not bite', async () => {
    const wa = await listCohortMembers(
      { filters: { campaignIds: [campA.id] } }, { status: 'reachable', channel: 'whatsapp', limit: 200 },
    );
    expect(ids(wa.members)).toEqual(idOf('ALICE', 'JOE', 'LEO'));
  });

  test('CARA (all-channel suppression) excluded with reason suppressed', async () => {
    const { members } = await listCohortMembers(
      { filters: { campaignIds: [campB.id] } }, { status: 'excluded', limit: 200 },
    );
    const cara = members.find((m) => m.consumerId === C.CARA.id);
    expect(cara.reasons).toEqual(['suppressed']);
  });
});

describe('preview aggregates', () => {
  test('counts line up with the member split', async () => {
    const def = { filters: { campaignIds: [campA.id] } };
    const preview = await previewCohort(def);
    expect(preview.total).toBe(10);
    expect(preview.reachable).toBe(3);           // ALICE, JOE, LEO
    expect(preview.excluded).toBe(7);
    expect(preview.byReason).toEqual({
      age_unknown: 1,        // GUS
      age_conflict: 1,       // NED
      age_ineligible: 1,     // FAY
      missing_email: 0,
      missing_phone: 0,
      suppressed: 0,
      not_consented: 3,      // BOB, ERIN, IVY
      not_verified: 1,       // DAN
    });
  });

  test('email-channel preview reports missing_email', async () => {
    const preview = await previewCohort({ filters: { campaignIds: [campA.id] } }, { channel: 'email' });
    expect(preview.reachable).toBe(1);            // ALICE
    expect(preview.byReason.missing_email).toBe(9); // everyone else has no email
  });
});

describe('canMarketToBatch — the exported consent gate', () => {
  test('unknown ids are fail-closed not_found; empty input is an empty map', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const map = await canMarketToBatch([ghost, C.ALICE.id]);
    expect(map.get(ghost)).toEqual({ ok: false, reasons: ['not_found'] });
    expect(map.get(C.ALICE.id)).toEqual({ ok: true, reasons: [] });
    expect((await canMarketToBatch([])).size).toBe(0);
  });

  test('forced ties: createdAt breaks an occurredAt tie; uuid breaks a full tie', async () => {
    const map = await canMarketToBatch([C.TIA.id, C.UMA.id]);
    expect(map.get(C.TIA.id).ok).toBe(true);   // later-created grant wins
    expect(map.get(C.UMA.id)).toEqual({ ok: false, reasons: ['not_consented'] }); // high-id denial wins
  });

  test('PARITY: batch verdict === consentService.canMarketTo for every fixture × every scope × every channel', async () => {
    const keys = Object.keys(C);
    const consumerIds = keys.map((k) => C[k].id);
    for (const campaignId of [null, campA.id, campB.id]) {
      for (const channel of ['all', 'email', 'whatsapp', 'sms', 'voice']) {
        const batch = await canMarketToBatch(consumerIds, { channel, campaignId });
        for (const key of keys) {
          const single = await canMarketTo({ consumerId: C[key].id, channel, campaignId });
          expect({ key, campaignId, channel, ok: batch.get(C[key].id).ok })
            .toEqual({ key, campaignId, channel, ok: single });
        }
      }
    }
  });
});

describe('members paging', () => {
  test('limit/offset walk the same ordered set', async () => {
    const def = { filters: { campaignIds: [campA.id, campB.id] } };
    const all = await listCohortMembers(def, { limit: 200 });
    expect(all.total).toBe(13);
    const page1 = await listCohortMembers(def, { limit: 5, offset: 0 });
    const page2 = await listCohortMembers(def, { limit: 5, offset: 5 });
    const page3 = await listCohortMembers(def, { limit: 5, offset: 10 });
    const walked = [...page1.members, ...page2.members, ...page3.members].map((m) => m.consumerId);
    expect(walked).toEqual(all.members.map((m) => m.consumerId));
    expect(page1.total).toBe(13);
  });
});

describe('facets', () => {
  test('exposes the live vocabulary (attribute values, tags, draws)', async () => {
    const facets = await getCohortFacets();
    expect(facets.attributes.incomes).toContain('$3,000 - $4,999');
    expect(facets.attributes.educations).toContain('Degree');
    expect(facets.campaignTags).toEqual(expect.arrayContaining(['parenting', 'family', 'home']));
    expect(facets.draws.map((d) => d.id)).toContain(draw1.id);
    expect(facets.campaigns.map((c) => c.id)).toEqual(expect.arrayContaining([campA.id, campB.id, campC.id]));
  });
});

describe('definition hygiene', () => {
  test('normalize dedupes, trims and canonicalizes', () => {
    const def = normalizeDefinition({
      filters: { campaignIds: [campA.id, campA.id], campaignTags: [' parenting ', 'parenting'] },
    });
    expect(def.filters.campaignIds).toEqual([campA.id]);
    expect(def.filters.campaignTags).toEqual(['parenting']);
    expect(def.ageGate).toEqual({ minAge: 18, maxAge: null });
    expect(def.marketingContext).toEqual({ campaignId: null });
  });

  test('garbage shapes are rejected, not coerced', () => {
    expect(() => normalizeDefinition({ filters: { campaignIds: ['not-a-uuid'] } })).toThrow(/invalid/);
    expect(() => normalizeDefinition({ filters: 'nope' })).toThrow(/filters/);
    expect(() => normalizeDefinition({ ageGate: { minAge: 21.5 } })).toThrow(/integer/);
    expect(() => normalizeDefinition({ marketingContext: { campaignId: 'x' } })).toThrow(/UUID/);
    expect(() => normalizeDefinition({ filters: { attributes: { postalPrefixes: ['52%'] } } })).toThrow(/invalid/);
  });
});
