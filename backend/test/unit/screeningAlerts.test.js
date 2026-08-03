/**
 * screeningAlerts unit tests (PR-1, draw-launch-integrity §2.2) — the
 * loud-failure surfacing for undeliverable qualified holds. Pure DI, no live
 * Postgres, no module mocks. Covers the 30-min freshness fence, the
 * once-per-lead activity guard, and the per-campaign 24h email throttle.
 *
 * M6: both guards are now ONE atomic idempotency claim
 * (INSERT … ON CONFLICT (scope,key) DO UPDATE … WHERE expired … RETURNING) —
 * a caller acts only when the claim returns a row. These tests pin that
 * contract at the query boundary; the real-Postgres race (two sweeps, one
 * email) is proven in test/screeningAlertThrottle.test.js.
 */
import { jest } from '@jest/globals';
import { notifyUndeliverableHold } from '../../src/services/screeningAlerts.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const T0 = Date.parse('2026-07-24T12:00:00Z');
const HELD_45M_AGO = new Date(T0 - 45 * 60 * 1000).toISOString();

const ACTIVITY_KEY_PREFIX = 'screening_undeliverable:';

function prospectRow(over = {}) {
  return {
    id: 'p1',
    campaignId: 'c1',
    quarantinedAt: HELD_45M_AGO,
    ...over,
  };
}

/**
 * Routes the service's three query shapes:
 *  - claim INSERT for the once-per-lead activity (key 'screening_undeliverable:<id>')
 *  - probe SELECT on prospect_activities
 *  - claim INSERT for the per-campaign email throttle
 */
function deps({ activityClaim = true, emailClaim = true, priorActivity = false, ...over } = {}) {
  const query = jest.fn(async (sql, options) => {
    if (/INSERT INTO idempotency_keys/.test(sql)) {
      const key = options?.replacements?.key || '';
      const wins = key.startsWith(ACTIVITY_KEY_PREFIX) ? activityClaim : emailClaim;
      return [wins ? [{ key }] : []];
    }
    return [priorActivity ? [{ 1: 1 }] : []];
  });
  return {
    sequelize: { query },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    sendEmail: jest.fn().mockResolvedValue({}),
    logger: silentLogger,
    now: () => T0,
    ...over,
  };
}

const claimCalls = (d) =>
  d.sequelize.query.mock.calls.filter(([sql]) => /INSERT INTO idempotency_keys/.test(sql));

const ENV_KEYS = ['SCREENING_ALERT_EMAIL', 'SMS_ALERT_EMAIL'];
const envBackup = {};
beforeEach(() => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
  process.env.SCREENING_ALERT_EMAIL = 'ops@test.local';
});
afterEach(() => {
  ENV_KEYS.forEach((k) => { if (envBackup[k] === undefined) delete process.env[k]; else process.env[k] = envBackup[k]; });
});

describe('notifyUndeliverableHold', () => {
  it('fresh hold (<30 min) → silent: capture-time transients never page anyone', async () => {
    const d = deps();
    const out = await notifyUndeliverableHold(
      { prospect: prospectRow({ quarantinedAt: new Date(T0 - 5 * 60 * 1000).toISOString() }), reason: 'no_intended_agent' },
      d
    );
    expect(out).toMatchObject({ alerted: false, reason: 'too_fresh' });
    expect(d.ProspectActivity.create).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('stale hold → claims both windows atomically, writes the activity ONCE and emails', async () => {
    const d = deps();
    const out = await notifyUndeliverableHold(
      { prospect: prospectRow(), reason: 'no_intended_agent', campaign: { name: 'iPhone Draw' } },
      d
    );
    expect(out).toMatchObject({ alerted: true, email: 'sent' });
    expect(d.ProspectActivity.create).toHaveBeenCalledTimes(1);
    expect(d.ProspectActivity.create.mock.calls[0][0].metadata).toMatchObject({ alert: 'screening_undeliverable' });

    // The M6 contract: the send is gated by the atomic claim, and the claim
    // statement carries the conditional-revive shape (never a blind upsert).
    const claims = claimCalls(d);
    expect(claims).toHaveLength(2); // once-per-lead activity + email throttle
    for (const [sql] of claims) {
      expect(sql).toMatch(/ON CONFLICT \(scope, key\) DO UPDATE/);
      expect(sql).toMatch(/WHERE idempotency_keys\."expiresAt" <= now\(\)/);
      expect(sql).toMatch(/RETURNING key/);
    }
    const mail = d.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('ops@test.local');
    expect(mail.subject).toContain('iPhone Draw');
    expect(mail.text).toContain('p1');
  });

  it('activity already written for this lead → not duplicated (email logic still runs)', async () => {
    const d = deps({ priorActivity: true });
    await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_subscriber' }, d);
    expect(d.ProspectActivity.create).not.toHaveBeenCalled();
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('LOST activity claim (a concurrent sweep is writing) → no duplicate activity', async () => {
    const d = deps({ activityClaim: false });
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_subscriber' }, d);
    expect(d.ProspectActivity.create).not.toHaveBeenCalled();
    expect(out.email).toBe('sent'); // the email window is claimed independently
  });

  it('live/lost email claim → throttled, NOTHING sent (the loser no longer falls through)', async () => {
    const d = deps({ emailClaim: false });
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_subscriber' }, d);
    expect(out.email).toBe('throttled');
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('no recipient configured → activity still lands, email marked unconfigured', async () => {
    delete process.env.SCREENING_ALERT_EMAIL;
    const d = deps();
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_intended_agent' }, d);
    expect(out.email).toBe('unconfigured');
    expect(d.ProspectActivity.create).toHaveBeenCalledTimes(1);
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(claimCalls(d)).toHaveLength(1); // no email claim without a recipient
  });

  it('SMS_ALERT_EMAIL is the fallback recipient', async () => {
    delete process.env.SCREENING_ALERT_EMAIL;
    process.env.SMS_ALERT_EMAIL = 'fallback@test.local';
    const d = deps();
    await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_intended_agent' }, d);
    expect(d.sendEmail.mock.calls[0][0].to).toBe('fallback@test.local');
  });

  it('never throws — a broken activity write degrades to a logged skip', async () => {
    const d = deps({
      ProspectActivity: { create: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_intended_agent' }, d);
    expect(out.alerted).toBe(false);
    expect(out.error).toBe('db down');
  });
});
