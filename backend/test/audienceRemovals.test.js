/**
 * DB-backed coverage for the durable audience-removal outbox + settlement
 * watermark (ads-centralisation §5.1/§5.5/§5.6): the R2 interleave (watermark
 * holds every claim — stale reclaims included — until zero unsettled
 * ingests), hold-extension + stuck-ingest escalation, the full §5.5
 * transition table (reservation cap in-CAS, accepted-poll FAILED ⇒ requestId
 * cleared ⇒ resubmit, polls don't burn submitAttempts, blanking, CHECKs),
 * the three writers (unsubscribe txn, identifier-edit txn with locked-row
 * old values + changed-only identifiers, sourceKey idempotence, hash-only
 * content), the edit-suppression convergence, and the destination-lock
 * sharing between drainer and sync.
 */
import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { sequelize, AudienceRemoval, AudienceDestinationState, Consumer } from '../src/models/index.js';
import {
  enqueueRemovalsTx,
  submitRemoval,
  settleAcceptedRemoval,
  escalateAgedRemovals,
  runRemovalDrainer,
  markIngestAccepted,
  markIngestsSettled,
} from '../src/services/audienceRemovalService.js';
import { loadEligibilityContext } from '../src/services/audienceEligibilityService.js';
import { makeConsentService } from '../src/services/consentService.js';
import { makeProspectService } from '../src/services/prospectService.js';
import { hashPhone, hashEmail } from '../src/utils/piiHashing.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const META_AUD = 'meta-aud-t';
const GOOGLE_LIST = 'google-list-t';
const CM_CAMPAIGN = () => campaign.id;

let admin;
let campaign;
let phoneSeq = 0;
const freshPhone = () => `+65${String(10000000 + Math.floor(Math.random() * 89999999))}`;

function envOn() {
  process.env.META_ADS_MANAGEMENT_TOKEN = 'tok';
  process.env.META_REDEEMED_AUDIENCE_ID = META_AUD;
  process.env.GOOGLE_DM_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET = 'sec';
  process.env.GOOGLE_DM_REFRESH_TOKEN = 'ref';
  process.env.GOOGLE_ADS_CUSTOMER_ID = 'cust';
  process.env.GOOGLE_CM_USER_LIST_ID = GOOGLE_LIST;
  process.env.GOOGLE_CM_CAMPAIGN_ID = CM_CAMPAIGN();
}

beforeAll(async () => {
  await getApp();
  ({ user: admin } = await createTestUser({ role: 'admin' }));
  campaign = await createTestCampaign(admin.id);
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  envOn();
  await sequelize.query(`DELETE FROM audience_removals`);
  await sequelize.query(`DELETE FROM audience_destination_state`);
});

afterEach(() => {
  for (const k of [
    'META_ADS_MANAGEMENT_TOKEN', 'META_REDEEMED_AUDIENCE_ID',
    'GOOGLE_DM_OAUTH_CLIENT_ID', 'GOOGLE_DM_OAUTH_CLIENT_SECRET', 'GOOGLE_DM_REFRESH_TOKEN',
    'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_CM_USER_LIST_ID', 'GOOGLE_CM_CAMPAIGN_ID',
    'AUDIENCE_REMOVAL_WRITERS_ENABLED', 'AUDIENCE_REMOVAL_MAX_ATTEMPTS', 'AUDIENCE_REMOVAL_MAX_DAYS',
  ]) delete process.env[k];
  jest.restoreAllMocks();
});

async function enqueueOne({ sourceKey = `t:${Date.now()}:${phoneSeq += 1}`, email = 'a@b.co', phone = freshPhone(), subjectProspectId = null } = {}) {
  let rows;
  await sequelize.transaction(async (t) => {
    rows = await enqueueRemovalsTx(t, {
      sourceKey,
      pairs: [{ email, phone, campaignId: campaign.id }],
      subjectProspectId,
    });
  });
  return rows;
}

const rowById = (id) => AudienceRemoval.findByPk(id, { raw: true });

const okMeta = () => jest.fn(async () => ({ ok: true, num_received: 1, num_invalid_entries: 0 }));
const okGoogle = () => jest.fn(async () => ({ ok: true, requestId: `req-${Date.now()}` }));

describe('the settlement watermark gates EVERY claim (§5.1, incl. stale reclaims)', () => {
  it('holds a removal while any ingest is unsettled; a later ingest extends the hold; dispatch lands in the settlement gap', async () => {
    const [g] = (await enqueueOne()).filter((r) => r.platform === 'google');
    await markIngestAccepted('google', GOOGLE_LIST);
    const held = await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    expect(held.outcome).toBe('claim_miss'); // watermark open ⇒ no claim
    expect((await rowById(g.id)).state).toBe('pending');

    // A LATER ingest legitimately extends the hold (COALESCE keeps the oldest).
    await markIngestAccepted('google', GOOGLE_LIST);
    expect((await submitRemoval(g.id, { googleRemoveHashed: okGoogle() })).outcome).toBe('claim_miss');

    // Every ingest settles ⇒ the gap opens ⇒ the removal dispatches.
    await markIngestsSettled('google', GOOGLE_LIST);
    const sent = await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    expect(sent.outcome).toBe('accepted');
  });

  it('a STALE sending row must not reclaim into a new unsettled-ingest window (§13 R7–R11)', async () => {
    const [g] = (await enqueueOne()).filter((r) => r.platform === 'google');
    await sequelize.query(
      `UPDATE audience_removals SET state='sending', "claimedAt"=now() - interval '11 minutes',
              "claimToken"='00000000-0000-4000-8000-0000000000c1', "updatedAt"=now() WHERE id=:id`,
      { replacements: { id: g.id } }
    );
    await markIngestAccepted('google', GOOGLE_LIST);
    const held = await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    expect(held.outcome).toBe('claim_miss'); // stale reclaim gated identically
    await markIngestsSettled('google', GOOGLE_LIST);
    const ok = await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    expect(ok.outcome).toBe('accepted');
  });

  it('a permanently stuck ingest ESCALATES the removal at MAX_DAYS — never dispatch-and-hope, never silent', async () => {
    process.env.AUDIENCE_REMOVAL_MAX_DAYS = '7';
    const [g] = (await enqueueOne()).filter((r) => r.platform === 'google');
    await markIngestAccepted('google', GOOGLE_LIST); // never settles
    await sequelize.query(
      `UPDATE audience_removals SET "createdAt" = now() - interval '8 days' WHERE id = :id`,
      { replacements: { id: g.id } }
    );
    const sendEmail = jest.fn(async () => {});
    const escalated = await escalateAgedRemovals({ sendEmail });
    expect(escalated).toBe(1);
    const after = await rowById(g.id);
    expect(after.state).toBe('needs_manual_action');
    expect(after.errorCode).toBe('max_days');
  });
});

describe('the §5.5 transition table', () => {
  it('meta: synchronous confirm blanks identifiers in the settle transaction', async () => {
    await markIngestsSettled('meta', META_AUD);
    const [m] = (await enqueueOne()).filter((r) => r.platform === 'meta');
    expect(m).toBeTruthy();
    const res = await submitRemoval(m.id, { metaAudienceRemove: okMeta() });
    expect(res.outcome).toBe('confirmed');
    const after = await rowById(m.id);
    expect(after.state).toBe('confirmed');
    expect(after.confirmedAt).not.toBeNull();
    expect(after.identifiers).toEqual([]);
  });

  it('google: accepted → poll FAILED clears providerRequestId back to retry_wait (resubmission safe) → SUCCESS confirms + blanks; polls never burn submitAttempts', async () => {
    await markIngestsSettled('google', GOOGLE_LIST);
    const [g] = (await enqueueOne()).filter((r) => r.platform === 'google');
    const accepted = await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    expect(accepted.outcome).toBe('accepted');
    let row = await rowById(g.id);
    expect(row.state).toBe('accepted');
    expect(row.providerRequestId).toBeTruthy();
    expect(row.submitAttempts).toBe(1);

    const failedPoll = await settleAcceptedRemoval(row, { dmRequestGet: async () => ({ requestStatus: 'FAILED' }) });
    expect(failedPoll.outcome).toBe('resubmit');
    row = await rowById(g.id);
    expect(row.state).toBe('retry_wait');
    expect(row.providerRequestId).toBeNull();
    expect(row.submitAttempts).toBe(1); // the poll consumed nothing

    await sequelize.query(`UPDATE audience_removals SET "nextAttemptAt" = now() - interval '1 second' WHERE id = :id`, { replacements: { id: g.id } });
    const resub = await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    expect(resub.outcome).toBe('accepted');
    row = await rowById(g.id);
    expect(row.submitAttempts).toBe(2);

    const success = await settleAcceptedRemoval(row, { dmRequestGet: async () => ({ requestStatus: 'SUCCESS' }) });
    expect(success.outcome).toBe('confirmed');
    row = await rowById(g.id);
    expect(row.state).toBe('confirmed');
    expect(row.identifiers).toEqual([]);
    expect(row.confirmedAt).not.toBeNull();
  });

  it('still-processing keeps the row accepted with the next poll scheduled', async () => {
    await markIngestsSettled('google', GOOGLE_LIST);
    const [g] = (await enqueueOne()).filter((r) => r.platform === 'google');
    await submitRemoval(g.id, { googleRemoveHashed: okGoogle() });
    const row = await rowById(g.id);
    const res = await settleAcceptedRemoval(row, { dmRequestGet: async () => ({ requestStatus: 'PROCESSING' }) });
    expect(res.outcome).toBe('still_processing');
    const after = await rowById(g.id);
    expect(after.state).toBe('accepted');
    expect(new Date(after.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('the reservation cap lands IN the CAS: a capped row goes needs_manual_action/retry_cap without a wire', async () => {
    process.env.AUDIENCE_REMOVAL_MAX_ATTEMPTS = '2';
    await markIngestsSettled('meta', META_AUD);
    const [m] = (await enqueueOne()).filter((r) => r.platform === 'meta');
    await sequelize.query(`UPDATE audience_removals SET "submitAttempts" = 2 WHERE id = :id`, { replacements: { id: m.id } });
    const transport = okMeta();
    const sendEmail = jest.fn(async () => {});
    const res = await submitRemoval(m.id, { metaAudienceRemove: transport, sendEmail });
    expect(res).toMatchObject({ outcome: 'needs_manual_action', errorCode: 'retry_cap' });
    expect(transport).not.toHaveBeenCalled();
    expect((await rowById(m.id)).state).toBe('needs_manual_action');
  });

  it('a hard reject escalates to needs_manual_action with the ops alert', async () => {
    await markIngestsSettled('meta', META_AUD);
    process.env.REDEEMED_AUDIENCE_ALERT_EMAIL = 'ops@test.local';
    const [m] = (await enqueueOne()).filter((r) => r.platform === 'meta');
    const sendEmail = jest.fn(async () => {});
    const res = await submitRemoval(m.id, {
      metaAudienceRemove: async () => ({ ok: false, permanent: true, errorCode: 'meta_100' }),
      sendEmail,
    });
    expect(res.outcome).toBe('needs_manual_action');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    delete process.env.REDEEMED_AUDIENCE_ALERT_EMAIL;
  });

  it('transient failures back off to retry_wait; auth-class uses the long ladder', async () => {
    await markIngestsSettled('meta', META_AUD);
    const [m] = (await enqueueOne()).filter((r) => r.platform === 'meta');
    const res = await submitRemoval(m.id, {
      metaAudienceRemove: async () => ({ ok: false, transient: true, errorCode: 'http_503' }),
    });
    expect(res.outcome).toBe('retry_wait');
    const after = await rowById(m.id);
    expect(after.state).toBe('retry_wait');
    expect(new Date(after.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('the CHECK constraints hold: unknown state, premature blanking, and unresolved manual rows all refuse', async () => {
    const [m] = (await enqueueOne()).filter((r) => r.platform === 'meta');
    await expect(
      sequelize.query(`UPDATE audience_removals SET state = 'vanished' WHERE id = :id`, { replacements: { id: m.id } })
    ).rejects.toThrow();
    await expect(
      sequelize.query(`UPDATE audience_removals SET identifiers = '[]'::jsonb WHERE id = :id`, { replacements: { id: m.id } })
    ).rejects.toThrow(); // blank allowed only in confirmed/manually_resolved
    await expect(
      sequelize.query(`UPDATE audience_removals SET state = 'manually_resolved' WHERE id = :id`, { replacements: { id: m.id } })
    ).rejects.toThrow(); // resolvedBy/At/note required
  });
});

describe('writers (§5.5) — in-txn, hashes only, idempotent', () => {
  it('enqueueRemovalsTx writes one row per configured destination, campaign-scopes Google, and stores HASHES only', async () => {
    const email = 'writer@example.com';
    const phone = freshPhone();
    const rows = await enqueueOne({ email, phone, sourceKey: `hash-check:${phone}` });
    expect(rows.map((r) => r.platform).sort()).toEqual(['google', 'meta']);
    for (const r of rows) {
      const stored = await rowById(r.id);
      const raw = JSON.stringify(stored.identifiers);
      expect(raw).not.toContain(email);
      expect(raw).not.toContain(phone);
      expect(raw).not.toContain('@');
    }
    const meta = await rowById(rows.find((r) => r.platform === 'meta').id);
    expect(meta.identifiers).toEqual([[hashEmail(email), hashPhone(phone)]]);

    // Google scoping: a pair OUTSIDE the CM campaign yields NO google row.
    const other = await createTestCampaign(admin.id);
    let outside;
    await sequelize.transaction(async (t) => {
      outside = await enqueueRemovalsTx(t, {
        sourceKey: `outside:${phone}`,
        pairs: [{ email, phone, campaignId: other.id }],
      });
    });
    expect(outside.map((r) => r.platform)).toEqual(['meta']);
  });

  it('sourceKey is idempotent per destination', async () => {
    const key = `idem:${Date.now()}`;
    const first = await enqueueOne({ sourceKey: key });
    const second = await enqueueOne({ sourceKey: key });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(0);
  });

  it('applyUnsubscribe (writer flag ON) writes the person-level rows INSIDE its transaction; legacy Google call stays off', async () => {
    process.env.AUDIENCE_REMOVAL_WRITERS_ENABLED = 'true';
    const phone = freshPhone();
    const consumer = await Consumer.create({ phone, firstSeenAt: new Date(), lastSeenAt: new Date() });
    await createTestProspect(campaign.id, { leadSource: 'website', phone, email: 'unsub@example.com', consumerId: consumer.id });
    const googleCmRemoveByConsumerId = jest.fn(async () => ({}));
    const svc = makeConsentService({ googleCmRemoveByConsumerId, logger: silentLogger, reconcileSuppressionPropagation: null });
    await svc.applyUnsubscribe(consumer, { source: 'test' });
    const rows = await AudienceRemoval.findAll({ where: { sourceKey: `unsubscribe:${consumer.id}` }, raw: true });
    expect(rows.map((r) => r.platform).sort()).toEqual(['google', 'meta']);
    expect(googleCmRemoveByConsumerId).not.toHaveBeenCalled(); // the flag-on branch never dual-fires

    // Re-unsubscribe: idempotent, still no legacy call.
    await svc.applyUnsubscribe(consumer, { source: 'test' });
    expect(await AudienceRemoval.count({ where: { sourceKey: `unsubscribe:${consumer.id}` } })).toBe(2);
  });

  it('applyUnsubscribe (flag OFF) keeps the legacy direct Google call and writes NO rows', async () => {
    const phone = freshPhone();
    const consumer = await Consumer.create({ phone, firstSeenAt: new Date(), lastSeenAt: new Date() });
    const googleCmRemoveByConsumerId = jest.fn(async () => ({}));
    const svc = makeConsentService({ googleCmRemoveByConsumerId, logger: silentLogger, reconcileSuppressionPropagation: null });
    await svc.applyUnsubscribe(consumer, { source: 'test' });
    await new Promise((r) => setTimeout(r, 50)); // legacy call is post-commit fire-and-forget
    expect(googleCmRemoveByConsumerId).toHaveBeenCalledWith(consumer.id);
    expect(await AudienceRemoval.count({ where: { sourceKey: `unsubscribe:${consumer.id}` } })).toBe(0);
  });

  it('staff identifier edit writes CHANGED-only identifiers from the LOCKED row with subjectProspectId (flag ON)', async () => {
    process.env.AUDIENCE_REMOVAL_WRITERS_ENABLED = 'true';
    const phoneA = freshPhone();
    const p = await createTestProspect(campaign.id, {
      leadSource: 'website', phone: phoneA, email: 'stay@example.com',
    });
    const svc = makeProspectService({
      buildProspectWhere: async () => ({}),
      processLeadOutcome: jest.fn(async () => ({})),
      logger: silentLogger,
    });
    const phoneB = freshPhone();
    await svc.updateProspect(p.id, { phone: phoneB }, { id: admin.id, role: 'admin' });

    const rows = await AudienceRemoval.findAll({ where: { subjectProspectId: p.id }, raw: true });
    expect(rows.length).toBeGreaterThan(0);
    const meta = rows.find((r) => r.platform === 'meta');
    // CHANGED only: the phone hash of the OLD number rides; the unchanged
    // email must NOT (removing it would delete the re-added member).
    expect(meta.identifiers).toEqual([['', hashPhone(phoneA)]]);
    expect(meta.sourceKey).toMatch(new RegExp(`^edit:${p.id}:`));

    // §5.1 convergence: the subject is OUT of additive selection while the
    // edit-removal is unsettled…
    const ctx = await loadEligibilityContext({ requireConsent: false });
    expect(ctx.editSuppressedProspectIds.has(p.id)).toBe(true);
    // …and back IN once it confirms.
    await sequelize.query(
      `UPDATE audience_removals SET state='confirmed', "confirmedAt"=now(), identifiers='[]'::jsonb WHERE "subjectProspectId" = :pid`,
      { replacements: { pid: p.id } }
    );
    const after = await loadEligibilityContext({ requireConsent: false });
    expect(after.editSuppressedProspectIds.has(p.id)).toBe(false);

    // Sequential second edit sources OLD values from the CURRENT locked row:
    // B → C removes hash(B), never hash(A) twice.
    const phoneC = freshPhone();
    await svc.updateProspect(p.id, { phone: phoneC }, { id: admin.id, role: 'admin' });
    const second = await AudienceRemoval.findAll({
      where: { subjectProspectId: p.id, state: 'pending' },
      raw: true,
    });
    const secondMeta = second.find((r) => r.platform === 'meta');
    expect(secondMeta.identifiers).toEqual([['', hashPhone(phoneB)]]);
  });

  it('an identifier edit with the flag OFF writes nothing (legacy world unchanged)', async () => {
    const p = await createTestProspect(campaign.id, { leadSource: 'website', phone: freshPhone() });
    const svc = makeProspectService({
      buildProspectWhere: async () => ({}),
      processLeadOutcome: jest.fn(async () => ({})),
      logger: silentLogger,
    });
    await svc.updateProspect(p.id, { phone: freshPhone() }, { id: admin.id, role: 'admin' });
    expect(await AudienceRemoval.count({ where: { subjectProspectId: p.id } })).toBe(0);
  });
});

describe('drainer + destination lock sharing (§5.1 layer 1)', () => {
  it('the drainer skips a destination whose lock is held (sync in progress) and drains it once free', async () => {
    await markIngestsSettled('meta', META_AUD);
    await markIngestsSettled('google', GOOGLE_LIST);
    const [m] = (await enqueueOne()).filter((r) => r.platform === 'meta');
    let heldSummary;
    await sequelize.transaction(async (t) => {
      // Simulate the Meta sync holding its destination lock.
      await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:k))`, { replacements: { k: `aud:meta:${META_AUD}` }, transaction: t });
      heldSummary = await runRemovalDrainer({ metaAudienceRemove: okMeta(), googleRemoveHashed: okGoogle() });
    });
    expect((await rowById(m.id)).state).toBe('pending'); // meta destination skipped under the held lock
    const free = await runRemovalDrainer({ metaAudienceRemove: okMeta(), googleRemoveHashed: okGoogle() });
    expect(free.submitted.confirmed).toBeGreaterThanOrEqual(1);
    expect((await rowById(m.id)).state).toBe('confirmed');
    expect(heldSummary.destinations).toBeLessThan(free.destinations);
  });
});

describe('watermark bookkeeping', () => {
  it('markIngestAccepted opens once (COALESCE keeps the oldest); markIngestsSettled closes', async () => {
    await markIngestAccepted('google', GOOGLE_LIST);
    const first = await AudienceDestinationState.findOne({ where: { platform: 'google', destinationId: GOOGLE_LIST }, raw: true });
    await new Promise((r) => setTimeout(r, 25));
    await markIngestAccepted('google', GOOGLE_LIST);
    const second = await AudienceDestinationState.findOne({ where: { platform: 'google', destinationId: GOOGLE_LIST }, raw: true });
    expect(new Date(second.oldestUnsettledAcceptAt).getTime()).toBe(new Date(first.oldestUnsettledAcceptAt).getTime());
    expect(new Date(second.lastIngestAcceptedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.lastIngestAcceptedAt).getTime());
    await markIngestsSettled('google', GOOGLE_LIST);
    const closed = await AudienceDestinationState.findOne({ where: { platform: 'google', destinationId: GOOGLE_LIST }, raw: true });
    expect(closed.oldestUnsettledAcceptAt).toBeNull();
    expect(closed.lastIngestAcceptedAt).not.toBeNull();
  });
});

describe('erasure writer (flag ON) — the third §5.5 transaction', () => {
  it('writes per-destination rows IN the erasure txn, hashes only, ids recorded in the report', async () => {
    process.env.AUDIENCE_REMOVAL_WRITERS_ENABLED = 'true';
    const { ensureRetiredTables } = await import('./helpers.js');
    await ensureRetiredTables();
    const phone = freshPhone();
    const email = 'erase-me@example.com';
    const consumer = await Consumer.create({ phone, firstSeenAt: new Date(), lastSeenAt: new Date() });
    await createTestProspect(campaign.id, { leadSource: 'website', phone, email, consumerId: consumer.id });
    const { eraseConsumer } = await import('../src/services/erasureService.js');
    const report = await eraseConsumer(consumer.id, { actorUser: admin, reason: 'p4 writer test' });
    expect(report.audienceRemovalIds?.length).toBeGreaterThanOrEqual(2);
    const rows = await AudienceRemoval.findAll({ where: { sourceKey: `erasure:${consumer.id}` }, raw: true });
    expect(rows.map((r) => r.platform).sort()).toEqual(['google', 'meta']);
    // Hash-only content: the pre-scrub raw identifiers never persist here.
    const raw = JSON.stringify(rows.map((r) => r.identifiers));
    expect(raw).not.toContain(email);
    expect(raw).not.toContain(phone);
    expect(raw).not.toContain('@');
  });
});
