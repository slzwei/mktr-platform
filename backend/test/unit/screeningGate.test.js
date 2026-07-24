/**
 * screeningGate unit tests (docs/plans/retell-screening-calls.md §15) — the
 * state machine's fences, refund invariants, and release fail-closed paths.
 * Pure DI via makeScreeningGate: no live Postgres, no module mocks — the fake
 * sequelize records every fenced statement so tests can assert the WHERE
 * fences that make duplicate webhooks / admin races safe.
 */
import { createHash } from 'crypto';
import { jest } from '@jest/globals';
import {
  makeScreeningGate,
  screeningConfig,
  screeningApplies,
  SCREENING_REASONS,
} from '../../src/services/screeningGate.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function fakeSequelize(queryResults = []) {
  let i = 0;
  const calls = [];
  const tx = { commit: jest.fn(), rollback: jest.fn(), LOCK: { UPDATE: 'U' } };
  return {
    tx,
    calls,
    QueryTypes: { SELECT: 'SELECT' },
    transaction: jest.fn(async (cb) => (typeof cb === 'function' ? cb(tx) : tx)),
    query: jest.fn(async (sql, opts) => {
      calls.push({ sql, opts });
      const r = queryResults[i++];
      return r === undefined ? [[]] : r;
    }),
  };
}

function stampFor(phone) {
  return {
    phoneVerifiedAt: new Date().toISOString(),
    phoneVerifiedFor: createHash('sha256').update(phone).digest('hex'),
  };
}

function prospectRow(over = {}) {
  return {
    id: 'p1',
    campaignId: 'c1',
    phone: '+6591234567',
    leadSource: 'qr_code',
    externalAgentId: null,
    screeningAttemptCount: 1,
    screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: false, attempts: {} },
    reload: jest.fn().mockResolvedValue(),
    ...over,
  };
}

function releaseDeps(seq, over = {}) {
  return {
    sequelize: seq,
    Prospect: { findByPk: jest.fn().mockResolvedValue({ id: 'p1', campaign: { id: 'c1', name: 'Camp' } }) },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    User: {
      // role/isActive serve the PR-1 stale-route revalidation; the rest serves
      // the webhook agent load. One mock, both reads.
      findByPk: jest.fn().mockResolvedValue({ id: 'a1', role: 'agent', isActive: true, lyfeId: 'L1', phone: '+6super', email: 'a@x.co', firstName: 'A', lastName: 'G' }),
    },
    notifyUndeliverableHold: jest.fn().mockResolvedValue({ alerted: false }),
    Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', enforceLeadQuota: true, leadPriceCents: null }) },
    chargeLeadCredit: jest.fn().mockResolvedValue(true),
    refundLeadCredit: jest.fn().mockResolvedValue(true),
    deductLeadCredit: jest.fn().mockResolvedValue(true),
    persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: 1 }]),
    flushDeliveries: jest.fn(),
    buildLeadCreatedPayload: jest.fn(() => ({ event: 'lead.created' })),
    destinationForAgent: jest.fn(() => 'lyfe'),
    externalIdForDestination: jest.fn(() => 'L1'),
    resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: null, via: 'fallback' }),
    logger: silentLogger,
    ...over,
  };
}

const ENV_KEYS = [
  'RETELL_SCREENING_ENABLED', 'RETELL_SCREENING_AGENT_ID', 'RETELL_SCREENING_FROM_NUMBER',
  'RETELL_API_KEY', 'SCREENING_ON_UNREACHABLE',
];
const envBackup = {};
beforeEach(() => { ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; }); });
afterEach(() => { ENV_KEYS.forEach((k) => { if (envBackup[k] === undefined) delete process.env[k]; else process.env[k] = envBackup[k]; }); });

describe('screeningConfig', () => {
  it('is unconfigured by default (dark)', () => {
    const cfg = screeningConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.configured).toBe(false);
  });

  it('requires enabled + valid agent id + E.164 number + api key', () => {
    process.env.RETELL_SCREENING_ENABLED = 'true';
    process.env.RETELL_SCREENING_AGENT_ID = 'agent_58b8bbdfb8920ce49bb2750b86';
    process.env.RETELL_SCREENING_FROM_NUMBER = '+6562773210';
    expect(screeningConfig().configured).toBe(false); // no api key yet
    process.env.RETELL_API_KEY = 'key';
    expect(screeningConfig().configured).toBe(true);
  });

  it('clamps a malformed agent id (never reaches an API body)', () => {
    process.env.RETELL_SCREENING_ENABLED = 'true';
    process.env.RETELL_SCREENING_AGENT_ID = 'agent_x; DROP TABLE';
    process.env.RETELL_SCREENING_FROM_NUMBER = '+6562773210';
    process.env.RETELL_API_KEY = 'key';
    const cfg = screeningConfig();
    expect(cfg.agentId).toBeNull();
    expect(cfg.configured).toBe(false);
  });
});

describe('screeningApplies', () => {
  const cfg = { configured: true };
  const campaign = { design_config: { screeningCallAtSubmit: true } };
  const verified = prospectRow({ sourceMetadata: stampFor('+6591234567') });

  it('true only for a verified, phoned, internal, non-call_bot lead on an opted-in campaign', () => {
    expect(screeningApplies({ campaign, prospect: verified }, cfg)).toBe(true);
  });

  it('false when the feature is not configured', () => {
    expect(screeningApplies({ campaign, prospect: verified }, { configured: false })).toBe(false);
  });

  it('false when the campaign gate is off or the config is unreadable (fail-OFF)', () => {
    expect(screeningApplies({ campaign: { design_config: {} }, prospect: verified }, cfg)).toBe(false);
    expect(screeningApplies({ campaign: { design_config: 'garbage' }, prospect: verified }, cfg)).toBe(false);
  });

  it('false without the OTP verified stamp (spoofed public POST can never dial)', () => {
    expect(screeningApplies({ campaign, prospect: prospectRow({ sourceMetadata: {} }) }, cfg)).toBe(false);
  });

  it('false when the stamp is bound to a DIFFERENT number (post-edit self-invalidation)', () => {
    const edited = prospectRow({ sourceMetadata: stampFor('+6599999999') });
    expect(screeningApplies({ campaign, prospect: edited }, cfg)).toBe(false);
  });

  it('false for call_bot, external-buyer, and phoneless leads', () => {
    expect(screeningApplies({ campaign, prospect: prospectRow({ leadSource: 'call_bot', sourceMetadata: stampFor('+6591234567') }) }, cfg)).toBe(false);
    expect(screeningApplies({ campaign, prospect: prospectRow({ externalAgentId: 'x1', sourceMetadata: stampFor('+6591234567') }) }, cfg)).toBe(false);
    expect(screeningApplies({ campaign, prospect: prospectRow({ phone: null, sourceMetadata: stampFor('+6591234567') }) }, cfg)).toBe(false);
  });
});

describe('transitionDncToScreening', () => {
  it('fenced dnc_pending → screening_pending, seeds bookkeeping, writes activity', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const p = prospectRow();
    const out = await gate.transitionDncToScreening(p, { intendedAgentId: 'a1', alreadyCharged: true });
    expect(out.transitioned).toBe(true);
    expect(seq.calls[0].sql).toContain(`"quarantineReason" = 'dnc_pending'`);
    expect(seq.calls[0].sql).toContain(`SET "quarantineReason" = 'screening_pending'`);
    expect(deps.ProspectActivity.create).toHaveBeenCalled();
  });

  it('lost fence (admin released concurrently) → no-op, no activity', async () => {
    const seq = fakeSequelize([[[]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const out = await gate.transitionDncToScreening(prospectRow(), { intendedAgentId: 'a1' });
    expect(out.transitioned).toBe(false);
    expect(deps.ProspectActivity.create).not.toHaveBeenCalled();
  });
});

describe('releaseScreenedLead', () => {
  it('happy path: claim → authoritative charge (quota campaign) → outbox → commit → flush', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningVerdict: 'qualified' });
    const out = await gate.releaseScreenedLead({ prospect: p });
    expect(out.released).toBe(true);
    expect(seq.calls[0].sql).toContain(`"screeningVerdict" = 'qualified'`);
    expect(seq.calls[0].sql).toContain(`"screeningActiveCallId" IS NULL`);
    expect(deps.chargeLeadCredit).toHaveBeenCalledWith('a1', 'c1', seq.tx);
    expect(deps.persistEventDeliveries).toHaveBeenCalled();
    expect(seq.tx.commit).toHaveBeenCalled();
    expect(deps.flushDeliveries).toHaveBeenCalled();
  });

  it('no_credit on a quota campaign → rollback, stays held', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, { chargeLeadCredit: jest.fn().mockResolvedValue(false) });
    const gate = makeScreeningGate(deps);
    const out = await gate.releaseScreenedLead({ prospect: prospectRow() });
    expect(out).toMatchObject({ released: false, reason: 'no_credit' });
    expect(seq.tx.rollback).toHaveBeenCalled();
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });

  it('SOFT campaign → best-effort deduct, never the authoritative charge (deliberate DNC divergence)', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, {
      Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', enforceLeadQuota: false, leadPriceCents: null }) },
    });
    const gate = makeScreeningGate(deps);
    const out = await gate.releaseScreenedLead({ prospect: prospectRow() });
    expect(out.released).toBe(true);
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.deductLeadCredit).toHaveBeenCalled();
  });

  it('no delivery subscriber → fail closed: rollback, stays held', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, { persistEventDeliveries: jest.fn().mockResolvedValue([]) });
    const gate = makeScreeningGate(deps);
    const out = await gate.releaseScreenedLead({ prospect: prospectRow() });
    expect(out).toMatchObject({ released: false, reason: 'no_subscriber' });
    expect(seq.tx.rollback).toHaveBeenCalled();
  });

  it('capture-charged lead skips the release charge (no double-spend)', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: true } });
    const out = await gate.releaseScreenedLead({ prospect: p });
    expect(out.released).toBe(true);
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.deductLeadCredit).not.toHaveBeenCalled();
  });

  it('intended agent gone → re-resolves routing; System-Agent fallback is refused', async () => {
    const seq = fakeSequelize([]);
    const deps = releaseDeps(seq, {
      resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'sys', via: 'fallback' }),
    });
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: null } });
    const out = await gate.releaseScreenedLead({ prospect: p });
    expect(out).toMatchObject({ released: false, reason: 'no_intended_agent' });
    expect(seq.calls.length).toBe(0); // never even claimed
  });

  it('re-resolved PACKAGE route is accepted', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, {
      resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'a2', via: 'package' }),
    });
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: null } });
    const out = await gate.releaseScreenedLead({ prospect: p });
    expect(out).toMatchObject({ released: true, agentId: 'a2' });
  });

  it('PR-1: null-baked lead AUTO-HEALS the moment a funded package appears (the 07-24 prod heal, as a test)', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, {
      resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'funded-1', via: 'package' }),
      Campaign: { findByPk: jest.fn().mockResolvedValue({ id: 'c1', enforceLeadQuota: false, leadPriceCents: null }) },
    });
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: null, alreadyCharged: false } });
    const out = await gate.releaseScreenedLead({ prospect: p });
    expect(out).toMatchObject({ released: true, agentId: 'funded-1' });
    expect(deps.deductLeadCredit).toHaveBeenCalledTimes(1); // soft campaign: best-effort deduct
    expect(deps.notifyUndeliverableHold).not.toHaveBeenCalled();
  });

  it('PR-1 (CX4): STALE stored agent (deactivated) on an UNCHARGED lead re-resolves instead of delivering blind', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, {
      User: {
        findByPk: jest.fn()
          // 1st call = revalidation of stored a1 → deactivated
          .mockResolvedValueOnce({ id: 'a1', role: 'agent', isActive: false })
          // 2nd call = webhook load of the re-resolved agent
          .mockResolvedValue({ id: 'a2', role: 'agent', isActive: true, lyfeId: 'L2', phone: '+65x', email: 'b@x.co', firstName: 'B', lastName: 'H' }),
      },
      resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'a2', via: 'package' }),
    });
    const gate = makeScreeningGate(deps);
    const out = await gate.releaseScreenedLead({ prospect: prospectRow() }); // intendedAgentId 'a1', uncharged
    expect(out).toMatchObject({ released: true, agentId: 'a2' });
    expect(seq.calls[0].opts.replacements.agentId).toBe('a2');
  });

  it('PR-1 (CX4): a CHARGED lead keeps its stored agent — revalidation is skipped (refund bookkeeping stays keyed)', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq, {
      // Role-less mock: if revalidation RAN it would null the agent and this
      // release would fail — success proves the skip.
      User: { findByPk: jest.fn().mockResolvedValue({ id: 'a1', lyfeId: 'L1', phone: '+65x', email: 'a@x.co', firstName: 'A', lastName: 'G' }) },
    });
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: true } });
    const out = await gate.releaseScreenedLead({ prospect: p });
    expect(out).toMatchObject({ released: true, agentId: 'a1' });
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.deductLeadCredit).not.toHaveBeenCalled();
  });

  it('PR-1 (§2.2): undeliverable outcomes fire the loud-failure notifier (both reasons), release path unchanged', async () => {
    // no_intended_agent
    const seq1 = fakeSequelize([]);
    const deps1 = releaseDeps(seq1, {
      resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'sys', via: 'fallback' }),
    });
    const gate1 = makeScreeningGate(deps1);
    const p1 = prospectRow({ screeningMetadata: { intendedAgentId: null } });
    await gate1.releaseScreenedLead({ prospect: p1 });
    expect(deps1.notifyUndeliverableHold).toHaveBeenCalledWith(
      expect.objectContaining({ prospect: p1, reason: 'no_intended_agent' })
    );

    // no_subscriber (destination default-denied) → rollback + notify
    const seq2 = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps2 = releaseDeps(seq2, { persistEventDeliveries: jest.fn().mockResolvedValue([]) });
    const gate2 = makeScreeningGate(deps2);
    const p2 = prospectRow();
    const out2 = await gate2.releaseScreenedLead({ prospect: p2 });
    expect(out2).toMatchObject({ released: false, reason: 'no_subscriber' });
    expect(deps2.notifyUndeliverableHold).toHaveBeenCalledWith(
      expect.objectContaining({ prospect: p2, reason: 'no_subscriber' })
    );
  });

  it('unscreened release fences on verdict IS NULL and stamps unreachable', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const gate = makeScreeningGate(releaseDeps(seq));
    const out = await gate.releaseScreenedLead({ prospect: prospectRow(), unscreened: true, via: 'screening_drain' });
    expect(out.released).toBe(true);
    expect(seq.calls[0].sql).toContain('"screeningVerdict" IS NULL');
    expect(seq.calls[0].opts.replacements.metaPatch).toContain('"unreachable":true');
  });
});

describe('verdict application', () => {
  it('applyQualifiedVerdict pins the verdict fenced on the CURRENT call id, then releases', async () => {
    const seq = fakeSequelize([
      [[{ id: 'p1' }]], // verdict pin
      [[{ id: 'p1' }]], // release claim
    ]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const p = prospectRow();
    const out = await gate.applyQualifiedVerdict(p, { callId: 'call_9', detail: { reason: 'wants CareShield' } });
    expect(out.outcome).toBe('released');
    expect(seq.calls[0].sql).toContain('"screeningActiveCallId" = :callId');
    expect(seq.calls[0].opts.replacements.callId).toBe('call_9');
  });

  it('stale call id loses the fence → verdict recorded as evidence only, no release', async () => {
    const seq = fakeSequelize([[[]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const out = await gate.applyQualifiedVerdict(prospectRow(), { callId: 'call_OLD' });
    expect(out).toMatchObject({ outcome: 'stale', applied: false });
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
  });

  it('qualified verdict whose release fails leaves the lead pending+qualified (delivery-retry state)', async () => {
    const seq = fakeSequelize([
      [[{ id: 'p1' }]], // verdict pin wins
      [[]],             // release claim loses (e.g. concurrent admin)
    ]);
    const gate = makeScreeningGate(releaseDeps(seq));
    const out = await gate.applyQualifiedVerdict(prospectRow(), { callId: 'call_9' });
    expect(out.outcome).toBe('qualified_pending_delivery');
  });

  it('markScreeningFailed transitions + REFUNDS a capture-charged lead in one tx', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: true } });
    const out = await gate.markScreeningFailed(p, { callId: 'call_9', detail: { reason: 'not interested' } });
    expect(out.outcome).toBe('failed');
    expect(seq.calls[0].sql).toContain(`SET "quarantineReason" = 'screening_failed'`);
    expect(deps.refundLeadCredit).toHaveBeenCalledWith('a1', 'c1', seq.tx);
    expect(seq.calls[0].opts.replacements.metaPatch).toContain('"chargeRefunded":true');
    expect(seq.tx.commit).toHaveBeenCalled();
  });

  it('markScreeningFailed never refunds an uncharged (or already-refunded) lead', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    await gate.markScreeningFailed(prospectRow(), { callId: 'call_9' });
    expect(deps.refundLeadCredit).not.toHaveBeenCalled();

    const deps2 = releaseDeps(fakeSequelize([[[{ id: 'p1' }]]]));
    const gate2 = makeScreeningGate(deps2);
    await gate2.markScreeningFailed(
      prospectRow({ screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: true, chargeRefunded: true } }),
      { callId: 'call_9' }
    );
    expect(deps2.refundLeadCredit).not.toHaveBeenCalled();
  });
});

describe('applyUnreachablePolicy', () => {
  it('release policy → releases unscreened', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const gate = makeScreeningGate(releaseDeps(seq));
    const out = await gate.applyUnreachablePolicy(prospectRow(), { cfg: { onUnreachable: 'release' } });
    expect(out.outcome).toBe('released_unscreened');
  });

  it('hold policy → screening_unreachable + refund when capture-charged', async () => {
    const seq = fakeSequelize([[[{ id: 'p1' }]]]);
    const deps = releaseDeps(seq);
    const gate = makeScreeningGate(deps);
    const p = prospectRow({ screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: true } });
    const out = await gate.applyUnreachablePolicy(p, { cfg: { onUnreachable: 'hold' } });
    expect(out.outcome).toBe('held_unreachable');
    expect(seq.calls[0].sql).toContain(`'screening_unreachable'`);
    expect(deps.refundLeadCredit).toHaveBeenCalled();
  });
});

describe('constants', () => {
  it('exposes the three screening reasons (lockstep with frontend maps + fences)', () => {
    expect(SCREENING_REASONS).toEqual(['screening_pending', 'screening_failed', 'screening_unreachable']);
  });
});
