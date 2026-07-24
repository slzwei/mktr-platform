/**
 * screeningAlerts unit tests (PR-1, draw-launch-integrity §2.2) — the
 * loud-failure surfacing for undeliverable qualified holds. Pure DI, no live
 * Postgres, no module mocks. Covers the 30-min freshness fence, the
 * once-per-lead activity guard, and the per-campaign 24h email throttle
 * (including the expired-PK-row refresh — idempotency_keys.key is a PRIMARY
 * KEY with no cleanup job, so a stale row must be UPDATEd back to life, never
 * insert-raced into a permanent PK collision).
 */
import { jest } from '@jest/globals';
import { notifyUndeliverableHold } from '../../src/services/screeningAlerts.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const T0 = Date.parse('2026-07-24T12:00:00Z');
const HELD_45M_AGO = new Date(T0 - 45 * 60 * 1000).toISOString();

function prospectRow(over = {}) {
  return {
    id: 'p1',
    campaignId: 'c1',
    quarantinedAt: HELD_45M_AGO,
    ...over,
  };
}

function deps(over = {}) {
  return {
    sequelize: { query: jest.fn().mockResolvedValue([[]]) }, // no prior alert activity
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    IdempotencyKey: {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    sendEmail: jest.fn().mockResolvedValue({}),
    logger: silentLogger,
    now: () => T0,
    ...over,
  };
}

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

  it('stale hold → writes the activity ONCE and emails with campaign context', async () => {
    const d = deps();
    const out = await notifyUndeliverableHold(
      { prospect: prospectRow(), reason: 'no_intended_agent', campaign: { name: 'iPhone Draw' } },
      d
    );
    expect(out).toMatchObject({ alerted: true, email: 'sent' });
    expect(d.ProspectActivity.create).toHaveBeenCalledTimes(1);
    expect(d.ProspectActivity.create.mock.calls[0][0].metadata).toMatchObject({ alert: 'screening_undeliverable' });
    expect(d.IdempotencyKey.create).toHaveBeenCalledTimes(1);
    const mail = d.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('ops@test.local');
    expect(mail.subject).toContain('iPhone Draw');
    expect(mail.text).toContain('p1');
  });

  it('activity already written for this lead → not duplicated (email logic still runs)', async () => {
    const d = deps({ sequelize: { query: jest.fn().mockResolvedValue([[{ 1: 1 }]]) } });
    await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_subscriber' }, d);
    expect(d.ProspectActivity.create).not.toHaveBeenCalled();
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('live throttle row for the campaign → email suppressed', async () => {
    const d = deps({
      IdempotencyKey: {
        findOne: jest.fn().mockResolvedValue({ expiresAt: new Date(T0 + 60 * 60 * 1000) }),
        create: jest.fn(),
      },
    });
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_subscriber' }, d);
    expect(out.email).toBe('throttled');
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.IdempotencyKey.create).not.toHaveBeenCalled();
  });

  it('EXPIRED throttle row → refreshed in place (PK has no cleanup job) and the email re-sends', async () => {
    const update = jest.fn().mockResolvedValue({});
    const d = deps({
      IdempotencyKey: {
        findOne: jest.fn().mockResolvedValue({ expiresAt: new Date(T0 - 1000), update }),
        create: jest.fn(),
      },
    });
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_subscriber' }, d);
    expect(out.email).toBe('sent');
    expect(update).toHaveBeenCalledTimes(1); // UPDATEd, never re-created
    expect(d.IdempotencyKey.create).not.toHaveBeenCalled();
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('no recipient configured → activity still lands, email marked unconfigured', async () => {
    delete process.env.SCREENING_ALERT_EMAIL;
    const d = deps();
    const out = await notifyUndeliverableHold({ prospect: prospectRow(), reason: 'no_intended_agent' }, d);
    expect(out.email).toBe('unconfigured');
    expect(d.ProspectActivity.create).toHaveBeenCalledTimes(1);
    expect(d.sendEmail).not.toHaveBeenCalled();
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
