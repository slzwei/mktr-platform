/**
 * retellScreeningService + screeningSweepService unit tests (plan §15).
 * Covers: dial guards (verified stamp, DNC-resolved, consent, window, budget,
 * concurrency), the token-first attempt lifecycle incl. dispatch_unknown,
 * current-attempt-only outcome application, webhook token binding, and the
 * sweep's terminalize-before-dial ordering.
 */
import { createHash } from 'crypto';
import { jest } from '@jest/globals';
import { Op } from 'sequelize';
import {
  makeRetellScreeningService,
  inCallWindow,
  nextWindowOpen,
  nextRetryAt,
  callbackRetryAt,
  drawExtraChances,
  UNANSWERED_REASONS,
} from '../../src/services/retellScreeningService.js';
import { runScreeningSweep } from '../../src/services/screeningSweepService.js';
import { parseWindow } from '../../src/utils/screeningEnv.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// Screening behaviour is a function of SGT time-of-day (call window, daily
// budget day, retry scheduling), so an unpinned suite changes result by WHEN
// it runs — the 26 Jul 23:59 SGT CI run went red because even the widest
// parseable window excludes its final minute (end-exclusive). Pin Date for
// every test; only Date is faked so real timers keep async plumbing honest.
// Describes that need timer control still call jest.useFakeTimers() locally.
const PINNED_NOW = new Date('2026-07-23T04:30:00Z'); // 12:30 SGT — inside CFG's window and the 10:00-20:00 default
const FAKE_DATE_ONLY = {
  now: PINNED_NOW,
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
    'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  ],
};
beforeEach(() => jest.useFakeTimers(FAKE_DATE_ONLY));
afterEach(() => jest.useRealTimers());

const CFG = {
  enabled: true,
  configured: true,
  agentId: 'agent_58b8bbdfb8920ce49bb2750b86',
  fromNumber: '+6562773210',
  dryRun: false,
  maxAttempts: 3,
  retryMinutes: 120,
  callWindow: '00:00-23:59', // widest parseable window — end-EXCLUSIVE, so 23:59 itself is closed; open at PINNED_NOW (see boundary tests)
  maxConcurrent: 3,
  maxDialsPerDay: 50,
  staleCallMinutes: 30,
  maxHoldHours: 24,
  onUnreachable: 'release',
  sweepIntervalMinutes: 5,
};

function stampFor(phone) {
  return {
    phoneVerifiedAt: new Date().toISOString(),
    phoneVerifiedFor: createHash('sha256').update(phone).digest('hex'),
  };
}

function pendingProspect(over = {}) {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    campaignId: 'c1',
    phone: '+6591234567',
    firstName: 'Jane',
    leadSource: 'qr_code',
    externalAgentId: null,
    quarantineReason: 'screening_pending',
    screeningActiveCallId: null,
    screeningVerdict: null,
    screeningAttemptCount: 0,
    screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: false, attempts: {} },
    sourceMetadata: stampFor('+6591234567'),
    dncStatus: null,
    reload: jest.fn().mockResolvedValue(),
    ...over,
  };
}

const screeningCampaign = (design = {}) => ({
  id: 'c1',
  name: 'Test Campaign',
  status: 'active',
  is_active: true,
  design_config: { screeningCallAtSubmit: true, ...design },
});

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

function dialerDeps(seq, over = {}) {
  return {
    sequelize: seq,
    Prospect: { findByPk: jest.fn(), findOne: jest.fn() },
    Campaign: { findByPk: jest.fn().mockResolvedValue(screeningCampaign()) },
    IdempotencyKey: { create: jest.fn().mockResolvedValue({}), findOne: jest.fn() },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    retellClient: {
      createPhoneCall: jest.fn().mockResolvedValue({ call_id: 'call_new1' }),
      getCall: jest.fn(),
    },
    dncEnforcement: jest.fn(() => 'off'),
    hasValidDncConsent: jest.fn(() => false),
    canMarketTo: jest.fn().mockResolvedValue(true),
    logger: silentLogger,
    gate: {
      applyQualifiedVerdict: jest.fn().mockResolvedValue({ outcome: 'released' }),
      markScreeningFailed: jest.fn().mockResolvedValue({ outcome: 'failed' }),
      applyUnreachablePolicy: jest.fn().mockResolvedValue({ outcome: 'released_unscreened' }),
      releaseScreenedLead: jest.fn().mockResolvedValue({ released: true }),
      transitionDncToScreening: jest.fn(),
    },
    sendDrawCallbackOptin: jest.fn().mockResolvedValue({ sent: true, to: '••••4567' }),
    ...over,
  };
}

/** Flush the fire-and-forget WA-invite microtask chain. */
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

// Happy-path query script for startScreeningAttempt:
// [advisory lock], [budget count], [in-flight count], [claim], (commit), then post-dial swap.
const happyDialQueries = () => [
  [[{}]],                              // pg_advisory_xact_lock
  [[{ dialsToday: 0 }]],               // budget
  [[{ inFlight: 0 }]],                 // concurrency
  [[{ screeningAttemptCount: 1 }]],    // fenced claim
  [[{ id: 'p' }]],                     // sentinel → call_id swap
  [[{ id: 'p' }]],                     // patchAttempt evidence
];

describe('call-window helpers', () => {
  const cfgWin = { ...CFG, callWindow: '10:00-20:00' };
  it('inCallWindow respects SGT bounds', () => {
    // 03:00 UTC = 11:00 SGT (inside); 14:00 UTC = 22:00 SGT (outside)
    expect(inCallWindow(cfgWin, new Date('2026-07-23T03:00:00Z'))).toBe(true);
    expect(inCallWindow(cfgWin, new Date('2026-07-23T14:00:00Z'))).toBe(false);
  });
  it('nextWindowOpen rolls to the next SGT 10:00', () => {
    const open = nextWindowOpen(cfgWin, new Date('2026-07-23T14:00:00Z')); // 22:00 SGT
    expect(open.toISOString()).toBe('2026-07-24T02:00:00.000Z'); // next day 10:00 SGT
  });
  it('nextRetryAt doubles the backoff and clamps into the window', () => {
    const base = new Date('2026-07-23T03:00:00Z'); // 11:00 SGT
    const first = nextRetryAt({ ...cfgWin, retryMinutes: 120 }, 1, base);
    expect(first.toISOString()).toBe('2026-07-23T05:00:00.000Z'); // +2h, in window
    const second = nextRetryAt({ ...cfgWin, retryMinutes: 120 }, 2, base); // +4h → 15:00 SGT ok
    expect(second.toISOString()).toBe('2026-07-23T07:00:00.000Z');
  });
});

describe('call-window boundary minutes (start-inclusive, end-EXCLUSIVE)', () => {
  const cfgWin = { ...CFG, callWindow: '10:00-20:00' };
  // A wall-clock instant for HH:MM SGT on the given day (+08:00, no DST).
  const atSgt = (hhmm, day = '2026-07-23') => new Date(`${day}T${hhmm}:00+08:00`);

  it('the start minute is IN; one minute before start is OUT', () => {
    expect(inCallWindow(cfgWin, atSgt('10:00'))).toBe(true);
    expect(inCallWindow(cfgWin, atSgt('09:59'))).toBe(false);
  });

  it('the end minute is OUT; the last minute before it is IN', () => {
    expect(inCallWindow(cfgWin, atSgt('20:00'))).toBe(false);
    expect(inCallWindow(cfgWin, atSgt('19:59'))).toBe(true);
  });

  it("the widest window '00:00-23:59' closes for its final minute and reopens at midnight — the 26 Jul CI red", () => {
    expect(inCallWindow(CFG, atSgt('23:59'))).toBe(false); // the minute CI happened to run at
    expect(inCallWindow(CFG, atSgt('23:58'))).toBe(true);
    expect(inCallWindow(CFG, atSgt('00:00', '2026-07-24'))).toBe(true);
  });

  it("a 24:00 end clamps its HOUR to 23 (→ ends 23:00) — writing '-24:00' narrows the window, and truly always-open is unrepresentable", () => {
    expect(parseWindow('00:00-24:00')).toEqual({ startMin: 0, endMin: 23 * 60 });
  });

  it('at 23:59 SGT the next open is the coming midnight, not a day later', () => {
    expect(nextWindowOpen(CFG, atSgt('23:59')).toISOString()).toBe(atSgt('00:00', '2026-07-24').toISOString());
  });
});

describe('callbackRetryAt', () => {
  const cfgWin = { ...CFG, callWindow: '10:00-20:00' };
  const noon = new Date('2026-07-23T04:00:00Z'); // 12:00 SGT

  it('maps the stated window onto a real instant, clamped into the call window', () => {
    // later today → +3h → 15:00 SGT, inside the window.
    expect(callbackRetryAt(cfgWin, 'later_today', { now: noon }).toISOString()).toBe('2026-07-23T07:00:00.000Z');
    // tomorrow → +12h lands at 00:00 SGT (shut) → next open, 10:00 SGT.
    expect(callbackRetryAt(cfgWin, 'tomorrow', { now: noon }).toISOString()).toBe('2026-07-24T02:00:00.000Z');
    // this week → +60h → 00:00 SGT on the 26th (shut) → 10:00 SGT that day.
    expect(callbackRetryAt(cfgWin, 'this_week', { now: noon }).toISOString()).toBe('2026-07-26T02:00:00.000Z');
  });

  it('never schedules past the hold ceiling the TTL sweep grants a promise', () => {
    // Captured at 11:00 SGT; 2 × 24h hold ⇒ nothing may be promised beyond the
    // 25th 11:00 SGT, so "this week" collapses onto that day's window.
    const at = callbackRetryAt(cfgWin, 'this_week', { now: noon, quarantinedAt: new Date('2026-07-23T03:00:00Z') });
    expect(at.toISOString()).toBe('2026-07-25T03:00:00.000Z'); // 11:00 SGT, still inside the window
  });

  it('no callback asked for (or an unknown value) → null, so the blind backoff stands', () => {
    for (const v of [undefined, null, '', 'none', 'unspecified', 'next_year']) {
      expect(callbackRetryAt(cfgWin, v, { now: noon })).toBeNull();
    }
  });

  it('is case- and whitespace-tolerant (the analysis model is not a schema)', () => {
    expect(callbackRetryAt(cfgWin, ' Later_Today ', { now: noon }).toISOString()).toBe('2026-07-23T07:00:00.000Z');
  });
});

describe('dncDialClear', () => {
  const svcOf = (over) => makeRetellScreeningService(dialerDeps(fakeSequelize(), over));
  it('campaign without dncCheck → always clear', () => {
    const svc = svcOf({});
    expect(svc.dncDialClear(pendingProspect(), {})).toBe(true);
  });
  it('enforcement off → clear (no data will ever come)', () => {
    const svc = svcOf({ dncEnforcement: jest.fn(() => 'off') });
    expect(svc.dncDialClear(pendingProspect(), { dncCheckAtSubmit: true })).toBe(true);
  });
  it('flag/block mode: pending or missing DNC result blocks the dial (Codex #6)', () => {
    const svc = svcOf({ dncEnforcement: jest.fn(() => 'flag') });
    expect(svc.dncDialClear(pendingProspect({ dncStatus: null }), { dncCheckAtSubmit: true })).toBe(false);
    expect(svc.dncDialClear(pendingProspect({ dncStatus: 'pending' }), { dncCheckAtSubmit: true })).toBe(false);
    expect(svc.dncDialClear(pendingProspect({ dncStatus: 'error' }), { dncCheckAtSubmit: true })).toBe(false);
  });
  it('clear / voice-clear / documented consent are dialable; voice-registered without consent is not', () => {
    const svc = svcOf({ dncEnforcement: jest.fn(() => 'flag') });
    expect(svc.dncDialClear(pendingProspect({ dncStatus: 'clear' }), { dncCheckAtSubmit: true })).toBe(true);
    expect(svc.dncDialClear(pendingProspect({ dncStatus: 'registered', dncNoVoiceCall: false }), { dncCheckAtSubmit: true })).toBe(true);
    expect(svc.dncDialClear(pendingProspect({ dncStatus: 'registered', dncNoVoiceCall: true }), { dncCheckAtSubmit: true })).toBe(false);
    const svcConsent = svcOf({ dncEnforcement: jest.fn(() => 'flag'), hasValidDncConsent: jest.fn(() => true) });
    expect(svcConsent.dncDialClear(pendingProspect({ dncStatus: 'registered', dncNoVoiceCall: true }), { dncCheckAtSubmit: true })).toBe(true);
  });
});

describe('startScreeningAttempt', () => {
  it('dials on the happy path: claim → create-phone-call → sentinel bound to call id', async () => {
    const seq = fakeSequelize(happyDialQueries());
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const camp = {
      ...screeningCampaign({ luckyDraw: { multiplier: 5 } }),
      min_age: 25,
      max_age: 60,
    };
    const out = await svc.startScreeningAttempt(pendingProspect(), { campaign: camp, cfg: CFG });
    expect(out.status).toBe('dialed');
    expect(deps.retellClient.createPhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      from_number: CFG.fromNumber,
      to_number: '+6591234567',
      override_agent_id: CFG.agentId,
      metadata: { mktr: expect.objectContaining({ kind: 'screening', attemptToken: expect.stringMatching(/^att_/) }) },
      // Campaign age gate → {{age_min}}/{{age_max}}; luckyDraw.multiplier →
      // {{extra_chances}} (N−1). Absent values fall back to 18/65 and 9.
      retell_llm_dynamic_variables: expect.objectContaining({ age_min: '25', age_max: '60', extra_chances: '4' }),
    }));
    const claim = seq.calls[3];
    expect(claim.sql).toContain(`"screeningActiveCallId" IS NULL`);
    expect(claim.sql).toContain(`"screeningAttemptCount" + 1`);
    expect(deps.IdempotencyKey.create).toHaveBeenCalled(); // budget row
  });

  it('never dials without the feature configured / the gate / a verified stamp', async () => {
    const deps = dialerDeps(fakeSequelize());
    const svc = makeRetellScreeningService(deps);
    expect((await svc.startScreeningAttempt(pendingProspect(), { cfg: { ...CFG, configured: false } })).reason).toBe('not_configured');
    expect((await svc.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign({ screeningCallAtSubmit: false }), cfg: CFG })).reason).toBe('gate_not_applicable');
    expect((await svc.startScreeningAttempt(pendingProspect({ sourceMetadata: {} }), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('gate_not_applicable');
    expect(deps.retellClient.createPhoneCall).not.toHaveBeenCalled();
  });

  it('PR-1 (CX20): EITHER inactivity signal alone stops new dials — archived campaign with is_active=true no longer dials', async () => {
    const deps = dialerDeps(fakeSequelize());
    const svc = makeRetellScreeningService(deps);
    const archivedButFlagOn = { ...screeningCampaign(), status: 'archived', is_active: true };
    expect((await svc.startScreeningAttempt(pendingProspect(), { campaign: archivedButFlagOn, cfg: CFG })).reason).toBe('campaign_inactive');
    const activeStatusFlagOff = { ...screeningCampaign(), status: 'active', is_active: false };
    expect((await svc.startScreeningAttempt(pendingProspect(), { campaign: activeStatusFlagOff, cfg: CFG })).reason).toBe('campaign_inactive');
    expect(deps.retellClient.createPhoneCall).not.toHaveBeenCalled();
  });

  it('skips a lead that is not cleanly pending (active call / verdict / other reason)', async () => {
    const svc = makeRetellScreeningService(dialerDeps(fakeSequelize()));
    expect((await svc.startScreeningAttempt(pendingProspect({ screeningActiveCallId: 'call_x' }), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('not_pending');
    expect((await svc.startScreeningAttempt(pendingProspect({ screeningVerdict: 'qualified' }), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('not_pending');
    expect((await svc.startScreeningAttempt(pendingProspect({ quarantineReason: 'no_funded_agent' }), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('not_pending');
  });

  it('unresolved DNC on a dncCheck campaign blocks the dial', async () => {
    const deps = dialerDeps(fakeSequelize(), { dncEnforcement: jest.fn(() => 'flag') });
    const svc = makeRetellScreeningService(deps);
    const out = await svc.startScreeningAttempt(
      pendingProspect({ dncStatus: 'pending' }),
      { campaign: screeningCampaign({ dncCheckAtSubmit: true }), cfg: CFG }
    );
    expect(out.reason).toBe('dnc_not_clear');
    expect(deps.retellClient.createPhoneCall).not.toHaveBeenCalled();
  });

  it('suppression/withdrawal blocks; a consent-lookup ERROR defers (never dials on unknown state)', async () => {
    const noConsent = makeRetellScreeningService(dialerDeps(fakeSequelize(), { canMarketTo: jest.fn().mockResolvedValue(false) }));
    expect((await noConsent.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('no_marketing_consent');

    const seq = fakeSequelize([[[{ id: 'p' }]]]); // deferAttempt update
    const erroring = makeRetellScreeningService(dialerDeps(seq, { canMarketTo: jest.fn().mockRejectedValue(new Error('boom')) }));
    const out = await erroring.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG });
    expect(out).toMatchObject({ status: 'deferred', reason: 'consent_lookup_failed' });
  });

  it('outside the window defers to the next SGT open', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    const out = await svc.startScreeningAttempt(pendingProspect(), {
      campaign: screeningCampaign(),
      cfg: { ...CFG, callWindow: '10:00-10:01' },
    });
    expect(out).toMatchObject({ status: 'deferred', reason: 'outside_window' });
  });

  it('at 23:59 SGT even the widest window defers (the red-CI minute); from midnight it dials again', async () => {
    jest.setSystemTime(new Date('2026-07-26T15:59:00Z')); // 26 Jul 23:59 SGT — the incident instant
    const seq = fakeSequelize([[[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    const out = await svc.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG });
    expect(out).toMatchObject({ status: 'deferred', reason: 'outside_window' });

    jest.setSystemTime(new Date('2026-07-26T16:00:00Z')); // 27 Jul 00:00 SGT — the window reopens
    const deps2 = dialerDeps(fakeSequelize(happyDialQueries()));
    const out2 = await makeRetellScreeningService(deps2).startScreeningAttempt(
      pendingProspect(), { campaign: screeningCampaign(), cfg: CFG }
    );
    expect(out2.status).toBe('dialed');
  });

  it('dials in the start minute itself and defers one minute earlier (10:00-20:00)', async () => {
    const cfg = { ...CFG, callWindow: '10:00-20:00' };
    jest.setSystemTime(new Date('2026-07-23T01:59:00Z')); // 09:59 SGT
    const seq = fakeSequelize([[[{ id: 'p' }]]]);
    const early = await makeRetellScreeningService(dialerDeps(seq)).startScreeningAttempt(
      pendingProspect(), { campaign: screeningCampaign(), cfg }
    );
    expect(early).toMatchObject({ status: 'deferred', reason: 'outside_window' });

    jest.setSystemTime(new Date('2026-07-23T02:00:00Z')); // 10:00 SGT — start minute is IN
    const deps2 = dialerDeps(fakeSequelize(happyDialQueries()));
    const out2 = await makeRetellScreeningService(deps2).startScreeningAttempt(
      pendingProspect(), { campaign: screeningCampaign(), cfg }
    );
    expect(out2.status).toBe('dialed');
  });

  it('daily budget and concurrency caps defer instead of dialing', async () => {
    const seqBudget = fakeSequelize([[[{}]], [[{ dialsToday: 50 }]], [[{ id: 'p' }]]]);
    const svcBudget = makeRetellScreeningService(dialerDeps(seqBudget));
    expect((await svcBudget.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('budget_exhausted');
    expect(seqBudget.tx.rollback).toHaveBeenCalled();

    const seqConc = fakeSequelize([[[{}]], [[{ dialsToday: 0 }]], [[{ inFlight: 3 }]], [[{ id: 'p' }]]]);
    const svcConc = makeRetellScreeningService(dialerDeps(seqConc));
    expect((await svcConc.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG })).reason).toBe('concurrency_full');
  });

  it('dry run logs and never calls Retell', async () => {
    const deps = dialerDeps(fakeSequelize());
    const svc = makeRetellScreeningService(deps);
    const out = await svc.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: { ...CFG, dryRun: true } });
    expect(out.reason).toBe('dry_run');
    expect(deps.retellClient.createPhoneCall).not.toHaveBeenCalled();
  });

  it('TRANSIENT dispatch failure keeps the sentinel (dispatch_unknown — no immediate redial)', async () => {
    const seq = fakeSequelize([
      [[{}]], [[{ dialsToday: 0 }]], [[{ inFlight: 0 }]], [[{ screeningAttemptCount: 1 }]],
      [[{ id: 'p' }]], // patchAttempt(dispatch_unknown)
    ]);
    const err = Object.assign(new Error('timeout'), { transient: true });
    const deps = dialerDeps(seq, { retellClient: { createPhoneCall: jest.fn().mockRejectedValue(err), getCall: jest.fn() } });
    const svc = makeRetellScreeningService(deps);
    const out = await svc.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG });
    expect(out.status).toBe('dispatch_unknown');
    // No sentinel-clearing UPDATE ran after the claim (only evidence patches).
    const clearing = seq.calls.filter((c) => c.sql.includes(`SET "screeningActiveCallId" = NULL`));
    expect(clearing.length).toBe(0);
  });

  it('DEFINITE dispatch failure consumes the attempt and schedules a retry', async () => {
    const seq = fakeSequelize([
      [[{}]], [[{ dialsToday: 0 }]], [[{ inFlight: 0 }]], [[{ screeningAttemptCount: 1 }]],
      [[{ id: 'p' }]],                          // patchAttempt(dispatch_failed)
      [[{ screeningAttemptCount: 1 }]],         // fenced sentinel clear
      [[{ id: 'p' }]],                          // deferAttempt
    ]);
    const err = Object.assign(new Error('bad request'), { transient: false });
    const deps = dialerDeps(seq, { retellClient: { createPhoneCall: jest.fn().mockRejectedValue(err), getCall: jest.fn() } });
    const svc = makeRetellScreeningService(deps);
    const out = await svc.startScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: CFG });
    expect(out.status).toBe('dispatch_failed');
    expect(seq.calls.some((c) => c.sql.includes(`SET "screeningActiveCallId" = NULL`))).toBe(true);
  });
});

describe('scheduleScreeningAttempt (delayed first dial, §7.1a)', () => {
  const delayCfg = { ...CFG, dialDelaySeconds: 60 };
  afterEach(() => jest.useRealTimers());

  it('stamps screeningNextAttemptAt for the sweep and dials only once the delay elapses', async () => {
    jest.useFakeTimers();
    const seq = fakeSequelize([[[{ id: 'p' }]], ...happyDialQueries()]);
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);

    const out = await svc.scheduleScreeningAttempt(pendingProspect(), { campaign: screeningCampaign(), cfg: delayCfg });
    expect(out.status).toBe('scheduled');
    expect(deps.retellClient.createPhoneCall).not.toHaveBeenCalled();

    // The durable half: the stamp the sweep's due-retry job reads, so a crash
    // inside the delay window costs lateness, not the call.
    expect(seq.calls[0].sql).toMatch(/"screeningNextAttemptAt" = :at/);
    expect(seq.calls[0].opts.replacements.at.getTime() - Date.now()).toBe(60_000);

    jest.advanceTimersByTime(60_000);
    // Real timers so flushAsync's setTimeout(0) runs — but re-pin Date
    // immediately: the dial fired by the elapsed delay checks the call window
    // on ITS side of the flush, and must not read the ambient wall clock.
    jest.useRealTimers();
    jest.useFakeTimers(FAKE_DATE_ONLY);
    await flushAsync();
    await flushAsync();
    expect(deps.retellClient.createPhoneCall).toHaveBeenCalledTimes(1);
  });

  it('delay 0 dials inline (pre-delay behaviour is one env var away)', async () => {
    const seq = fakeSequelize(happyDialQueries());
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const out = await svc.scheduleScreeningAttempt(pendingProspect(), {
      campaign: screeningCampaign(),
      cfg: { ...CFG, dialDelaySeconds: 0 },
    });
    expect(out.status).toBe('dialed');
    expect(deps.retellClient.createPhoneCall).toHaveBeenCalledTimes(1);
  });

  it('never stamps a schedule when the feature is not configured', async () => {
    const seq = fakeSequelize([]);
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const out = await svc.scheduleScreeningAttempt(pendingProspect(), {
      campaign: screeningCampaign(),
      cfg: { ...delayCfg, configured: false },
    });
    expect(out).toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(seq.calls).toHaveLength(0);
  });

  it('never stamps a schedule the guards would reject — the sweep would re-select it every pass', async () => {
    const seq = fakeSequelize([]);
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const out = await svc.scheduleScreeningAttempt(pendingProspect({ sourceMetadata: {} }), {
      campaign: screeningCampaign(),
      cfg: delayCfg,
    });
    expect(out).toEqual({ status: 'skipped', reason: 'gate_not_applicable' });
    expect(seq.calls).toHaveLength(0);
  });
});

describe('applyCallOutcome', () => {
  const call = (over = {}) => ({
    call_id: 'call_1',
    metadata: { mktr: { kind: 'screening', prospectId: pendingProspect().id, attemptToken: 'att_abc', attempt: 1 } },
    ...over,
  });

  it('non-current call → evidence only, never a transition (Codex #4)', async () => {
    const deps = dialerDeps(fakeSequelize([[[{ id: 'p' }]]]));
    const svc = makeRetellScreeningService(deps);
    const p = pendingProspect({ screeningActiveCallId: 'call_2' });
    const out = await svc.applyCallOutcome(p, call(), { cfg: CFG });
    expect(out.outcome).toBe('stale_evidence');
    expect(deps.gate.applyQualifiedVerdict).not.toHaveBeenCalled();
    expect(deps.gate.markScreeningFailed).not.toHaveBeenCalled();
  });

  it('unanswered current attempt schedules a retry while attempts remain', async () => {
    const seq = fakeSequelize([
      [[{ id: 'p' }]],                    // attempt evidence patch
      [[{ screeningAttemptCount: 1 }]],   // fenced clear
      [[{ id: 'p' }]],                    // deferAttempt
    ]);
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const p = pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 });
    const out = await svc.applyCallOutcome(p, call({ disconnection_reason: 'dial_no_answer' }), { cfg: CFG });
    expect(out).toMatchObject({ outcome: 'retry_scheduled' });
    expect(deps.gate.applyUnreachablePolicy).not.toHaveBeenCalled();
  });

  it('unanswered final attempt invokes the unreachable policy', async () => {
    const seq = fakeSequelize([
      [[{ id: 'p' }]],
      [[{ screeningAttemptCount: 3 }]],
    ]);
    const deps = dialerDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const p = pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 3 });
    const out = await svc.applyCallOutcome(p, call({ disconnection_reason: 'voicemail_reached' }), { cfg: CFG });
    expect(out.outcome).toBe('exhausted');
    expect(deps.gate.applyUnreachablePolicy).toHaveBeenCalled();
  });

  it('qualified=true routes to applyQualifiedVerdict with the evidence detail', async () => {
    const deps = dialerDeps(fakeSequelize([[[{ id: 'p' }]]]));
    const svc = makeRetellScreeningService(deps);
    const p = pendingProspect({ screeningActiveCallId: 'call_1' });
    await svc.applyCallOutcome(p, call({
      call_analysis: { custom_analysis_data: { qualified: true, qualification_reason: 'keen' }, call_summary: 'S', user_sentiment: 'Positive' },
      recording_url: 'https://r/1.wav',
      transcript: 'Agent: Hi\nUser: Yes',
    }), { cfg: CFG });
    expect(deps.gate.applyQualifiedVerdict).toHaveBeenCalledWith(p, expect.objectContaining({
      callId: 'call_1',
      detail: expect.objectContaining({ reason: 'keen', summary: 'S', recordingUrl: 'https://r/1.wav', transcript: 'Agent: Hi\nUser: Yes' }),
    }));
  });

  it('captures the transcript as verdict evidence, capped, and null when absent', async () => {
    const deps = dialerDeps(fakeSequelize([[[{ id: 'p' }]]]));
    const svc = makeRetellScreeningService(deps);
    const long = 'x'.repeat(25000);
    await svc.applyCallOutcome(pendingProspect({ screeningActiveCallId: 'call_1' }), call({
      call_analysis: { custom_analysis_data: { qualified: true } },
      transcript: long,
    }), { cfg: CFG });
    const capped = deps.gate.applyQualifiedVerdict.mock.calls[0][1].detail.transcript;
    expect(capped).toHaveLength(20000);

    const deps2 = dialerDeps(fakeSequelize([[[{ id: 'p' }]]]));
    const svc2 = makeRetellScreeningService(deps2);
    await svc2.applyCallOutcome(pendingProspect({ screeningActiveCallId: 'call_1' }), call({
      call_analysis: { custom_analysis_data: { qualified: true } },
    }), { cfg: CFG });
    expect(deps2.gate.applyQualifiedVerdict.mock.calls[0][1].detail.transcript).toBeNull();
  });

  it('captures per-call economics + provenance onto the attempt evidence', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    await svc.applyCallOutcome(pendingProspect({ screeningActiveCallId: 'call_1' }), call({
      agent_id: 'agent_x', agent_version: 4,
      call_cost: { combined_cost: 13.02, total_duration_seconds: 63 },
      call_analysis: { custom_analysis_data: { qualified: true }, in_voicemail: false, call_successful: true },
    }), { cfg: CFG });
    // patchAttempt is the first query; its jsonb patch rides replacements.patch.
    const patchCall = seq.calls.find((c) => String(c.sql).includes('{attempts,'));
    const patch = JSON.parse(patchCall.opts.replacements.patch);
    expect(patch).toMatchObject({
      costCents: 13.02, durationSeconds: 63, agentId: 'agent_x', agentVersion: 4,
      inVoicemail: false, callSuccessful: true,
    });
  });

  it('derives duration from timestamps when call_cost is absent', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    await svc.applyCallOutcome(pendingProspect({ screeningActiveCallId: 'call_1' }), call({
      start_timestamp: 1784892582109, end_timestamp: 1784892644817,
      call_analysis: { custom_analysis_data: { qualified: true } },
    }), { cfg: CFG });
    const patch = JSON.parse(seq.calls.find((c) => String(c.sql).includes('{attempts,')).opts.replacements.patch);
    expect(patch.durationSeconds).toBe(63);        // (644817-582109)/1000 ≈ 62.7 → 63
    expect(patch.costCents).toBeUndefined();        // no cost field emitted
  });

  it('qualified=false routes to markScreeningFailed; a missing verdict field retries (never sentiment-guessed)', async () => {
    const depsNo = dialerDeps(fakeSequelize([[[{ id: 'p' }]]]));
    const svcNo = makeRetellScreeningService(depsNo);
    const p = pendingProspect({ screeningActiveCallId: 'call_1' });
    await svcNo.applyCallOutcome(p, call({ call_analysis: { custom_analysis_data: { qualified: 'false' } } }), { cfg: CFG });
    expect(depsNo.gate.markScreeningFailed).toHaveBeenCalled();

    const seq = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 1 }]], [[{ id: 'p' }]]]);
    const depsMissing = dialerDeps(seq);
    const svcMissing = makeRetellScreeningService(depsMissing);
    const out = await svcMissing.applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      call({ call_analysis: { call_summary: 'nice chat', user_sentiment: 'Positive' } }),
      { cfg: CFG }
    );
    expect(out).toMatchObject({ outcome: 'retry_scheduled', kind: 'no_verdict' });
    expect(depsMissing.gate.applyQualifiedVerdict).not.toHaveBeenCalled();
  });

  it('a verdict-less call keeps its evidence on the attempt (the only record it gets)', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 1 }]], [[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    await svc.applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      call({
        call_analysis: {
          custom_analysis_data: { qualified: 'incomplete', qualification_reason: 'Asked to be called back', sg_pr: 'unanswered' },
          call_summary: 'Could not talk',
          user_sentiment: 'Neutral',
        },
        transcript: 'Agent: Is now a good time?\nUser: Call me later',
      }),
      { cfg: CFG }
    );
    const patch = JSON.parse(seq.calls.find((c) => String(c.sql).includes('{attempts,')).opts.replacements.patch);
    expect(patch).toMatchObject({
      outcome: 'no_verdict',
      reason: 'Asked to be called back',
      summary: 'Could not talk',
      sentiment: 'Neutral',
      transcript: 'Agent: Is now a good time?\nUser: Call me later',
      checks: { qualified: 'incomplete', sg_pr: 'unanswered' },
    });
  });

  it('a verdict-bearing call does NOT duplicate the transcript onto the attempt', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    await svc.applyCallOutcome(pendingProspect({ screeningActiveCallId: 'call_1' }), call({
      call_analysis: { custom_analysis_data: { qualified: true, qualification_reason: 'All three yes' } },
      transcript: 'Agent: Hi\nUser: Yes',
    }), { cfg: CFG });
    const patch = JSON.parse(seq.calls.find((c) => String(c.sql).includes('{attempts,')).opts.replacements.patch);
    expect(patch.outcome).toBe('qualified');
    expect(patch.transcript).toBeUndefined();   // verdictDetail carries it
    expect(patch.checks).toBeUndefined();
  });

  it('a stated callback replaces the blind backoff and grants one bonus attempt', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 1 }]], [[{ id: 'p' }]]]);
    const svc = makeRetellScreeningService(dialerDeps(seq));
    const before = Date.now();
    const out = await svc.applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      call({ call_analysis: { custom_analysis_data: { qualified: 'incomplete', callback_window: 'later_today' } } }),
      { cfg: CFG }
    );
    expect(out).toMatchObject({ outcome: 'retry_scheduled', kind: 'no_verdict' });
    // ~3h out, not the 2h first-step backoff.
    const at = new Date(out.callbackAt).getTime();
    expect(at - before).toBeGreaterThan(2.9 * 60 * 60 * 1000);
    expect(at - before).toBeLessThan(3.1 * 60 * 60 * 1000);
    // The grant rides the fenced clear, and the deferral uses the promised time.
    const clear = seq.calls.find((c) => String(c.sql).includes('SET "screeningActiveCallId" = NULL'));
    expect(JSON.parse(clear.opts.replacements.metaPatch)).toEqual({ callbackGranted: true });
    const defer = seq.calls.find((c) => String(c.sql).includes('"screeningNextAttemptAt" = :at'));
    expect(new Date(defer.opts.replacements.at).toISOString()).toBe(out.callbackAt);
  });

  it('the bonus is one per lead: a granted lead survives attempt 3 but not attempt 4', async () => {
    const granted = () => pendingProspect({
      screeningActiveCallId: 'call_1',
      screeningMetadata: { intendedAgentId: 'a1', alreadyCharged: false, attempts: {}, callbackGranted: true },
    });
    const cb = call({ call_analysis: { custom_analysis_data: { qualified: 'incomplete', callback_window: 'tomorrow' } } });

    const seqThird = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 3 }]], [[{ id: 'p' }]]]);
    const depsThird = dialerDeps(seqThird);
    const third = await makeRetellScreeningService(depsThird)
      .applyCallOutcome(granted(), cb, { cfg: CFG }); // maxAttempts 3 + granted bonus
    expect(third.outcome).toBe('retry_scheduled');
    expect(depsThird.gate.applyUnreachablePolicy).not.toHaveBeenCalled();
    // Already granted ⇒ the fenced clear must not re-write the grant.
    expect(JSON.parse(seqThird.calls.find((c) => String(c.sql).includes('SET "screeningActiveCallId" = NULL')).opts.replacements.metaPatch)).toEqual({});

    const seqFourth = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 4 }]]]);
    const depsFourth = dialerDeps(seqFourth);
    const fourth = await makeRetellScreeningService(depsFourth)
      .applyCallOutcome(granted(), cb, { cfg: CFG });
    expect(fourth.outcome).toBe('exhausted');
    expect(depsFourth.gate.applyUnreachablePolicy).toHaveBeenCalled();
  });

  it('connected call_ended without analysis waits for call_analyzed (unless final)', async () => {
    const deps = dialerDeps(fakeSequelize([[[{ id: 'p' }]]]));
    const svc = makeRetellScreeningService(deps);
    const p = pendingProspect({ screeningActiveCallId: 'call_1' });
    const out = await svc.applyCallOutcome(p, call({ disconnection_reason: 'user_hangup' }), { cfg: CFG });
    expect(out.outcome).toBe('await_analysis');

    const seq = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 1 }]], [[{ id: 'p' }]]]);
    const svcFinal = makeRetellScreeningService(dialerDeps(seq));
    const outFinal = await svcFinal.applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      call({ disconnection_reason: 'user_hangup' }),
      { cfg: CFG, finalIfNoAnalysis: true }
    );
    expect(outFinal).toMatchObject({ outcome: 'retry_scheduled', kind: 'no_verdict' });
  });
});

describe('WhatsApp callback invite', () => {
  const drawCampaign = () => ({
    ...screeningCampaign({ luckyDraw: { multiplier: 10, prize: 'iPhone 17 Pro' } }),
  });

  it('verdict-less connected call (no voice booking) triggers the invite exactly once', async () => {
    // resolveAttemptFailure: clear + defer; then the invite's claim + receipt patch.
    const seq = fakeSequelize([
      [[{ id: 'p' }]],                    // attempt evidence patch
      [[{ screeningAttemptCount: 1 }]],   // fenced clear
      [[{ id: 'p' }]],                    // deferAttempt
      [[{ id: 'p' }]],                    // waCallback claim
      [[{ id: 'p' }]],                    // receipt patch
    ]);
    const deps = dialerDeps(seq, { Campaign: { findByPk: jest.fn().mockResolvedValue(drawCampaign()) } });
    const svc = makeRetellScreeningService(deps);
    await svc.applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      { call_id: 'call_1', metadata: { mktr: { kind: 'screening', attemptToken: 'att_abc' } },
        call_analysis: { custom_analysis_data: { qualified: 'incomplete' } } },
      { cfg: CFG }
    );
    await flushAsync();
    expect(deps.sendDrawCallbackOptin).toHaveBeenCalledWith(expect.objectContaining({
      drawName: 'Test Campaign',
      multiplier: 10,
      prize: 'iPhone 17 Pro',
      token: expect.stringMatching(/^wcb_[a-f0-9]{32}$/),
    }));
    // Token row minted under the wa-callback scope, expiring with the 2× hold.
    const tokenRow = deps.IdempotencyKey.create.mock.calls.find(([r]) => r.scope === 'screening:wa_callback');
    expect(tokenRow[0].key).toMatch(/^wacb:wcb_/);
    // The once-per-lead claim fences on the key's absence.
    const claim = seq.calls.find((c) => String(c.sql).includes(`("screeningMetadata" -> 'waCallback') IS NULL`));
    expect(claim).toBeTruthy();
  });

  it('a voice-booked callback suppresses the invite (the promise is already made)', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]], [[{ screeningAttemptCount: 1 }]], [[{ id: 'p' }]]]);
    const deps = dialerDeps(seq, { Campaign: { findByPk: jest.fn().mockResolvedValue(drawCampaign()) } });
    const svc = makeRetellScreeningService(deps);
    await svc.applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      { call_id: 'call_1', metadata: { mktr: { kind: 'screening', attemptToken: 'att_abc' } },
        call_analysis: { custom_analysis_data: { qualified: 'incomplete', callback_window: 'tomorrow' } } },
      { cfg: CFG }
    );
    await flushAsync();
    expect(deps.sendDrawCallbackOptin).not.toHaveBeenCalled();
  });

  it('unanswered dials: no invite on the 1st miss, invite on the 2nd', async () => {
    const mkDeps = (results) => dialerDeps(fakeSequelize(results), { Campaign: { findByPk: jest.fn().mockResolvedValue(drawCampaign()) } });

    const first = mkDeps([[[{ id: 'p' }]], [[{ screeningAttemptCount: 1 }]], [[{ id: 'p' }]]]);
    await makeRetellScreeningService(first).applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 1 }),
      { call_id: 'call_1', disconnection_reason: 'dial_no_answer', metadata: { mktr: { attemptToken: 'att_a' } } },
      { cfg: CFG }
    );
    await flushAsync();
    expect(first.sendDrawCallbackOptin).not.toHaveBeenCalled();

    const second = mkDeps([
      [[{ id: 'p' }]], [[{ screeningAttemptCount: 2 }]], [[{ id: 'p' }]],
      [[{ id: 'p' }]], [[{ id: 'p' }]], // claim + receipt
    ]);
    await makeRetellScreeningService(second).applyCallOutcome(
      pendingProspect({ screeningActiveCallId: 'call_1', screeningAttemptCount: 2 }),
      { call_id: 'call_1', disconnection_reason: 'dial_no_answer', metadata: { mktr: { attemptToken: 'att_b' } } },
      { cfg: CFG }
    );
    await flushAsync();
    expect(second.sendDrawCallbackOptin).toHaveBeenCalled();
  });

  it('never sends for a non-draw campaign, a lead already invited, or without marketing consent', async () => {
    // Non-draw: default screeningCampaign has no luckyDraw — zero queries run.
    const nonDraw = dialerDeps(fakeSequelize([]));
    const r1 = await makeRetellScreeningService(nonDraw).maybeSendWaCallbackInvite(pendingProspect(), { cfg: CFG });
    expect(r1).toMatchObject({ sent: false, reason: 'not_a_draw' });

    // Already invited: metadata short-circuit before any lookup.
    const invited = dialerDeps(fakeSequelize([]));
    const p = pendingProspect({ screeningMetadata: { attempts: {}, waCallback: { sentAt: 'x' } } });
    const r2 = await makeRetellScreeningService(invited).maybeSendWaCallbackInvite(p, { cfg: CFG });
    expect(r2).toMatchObject({ sent: false, reason: 'already_sent' });

    // Consent refused.
    const noConsent = dialerDeps(fakeSequelize([]), {
      Campaign: { findByPk: jest.fn().mockResolvedValue(drawCampaign()) },
      canMarketTo: jest.fn().mockResolvedValue(false),
    });
    const r3 = await makeRetellScreeningService(noConsent).maybeSendWaCallbackInvite(pendingProspect(), { cfg: CFG });
    expect(r3).toMatchObject({ sent: false, reason: 'no_marketing_consent' });
    expect(noConsent.sendDrawCallbackOptin).not.toHaveBeenCalled();
  });

  it('claim race: the loser never mints a token or sends', async () => {
    const seq = fakeSequelize([[[]]]); // claim returns no rows
    const deps = dialerDeps(seq, { Campaign: { findByPk: jest.fn().mockResolvedValue(drawCampaign()) } });
    const out = await makeRetellScreeningService(deps).maybeSendWaCallbackInvite(pendingProspect(), { cfg: CFG });
    expect(out).toMatchObject({ sent: false, reason: 'lost_claim' });
    expect(deps.IdempotencyKey.create).not.toHaveBeenCalled();
    expect(deps.sendDrawCallbackOptin).not.toHaveBeenCalled();
  });
});

describe('WA callback tap (readWaCallbackContext / applyWaCallbackRequest)', () => {
  const TOKEN = `wcb_${'a'.repeat(32)}`;
  const tokenRow = (over = {}) => ({
    key: `wacb:${TOKEN}`,
    scope: 'screening:wa_callback',
    responseBody: { prospectId: pendingProspect().id },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...over,
  });

  function tapDeps(seq, { prospect = pendingProspect(), row = tokenRow(), campaign } = {}) {
    return dialerDeps(seq, {
      IdempotencyKey: { create: jest.fn(), findOne: jest.fn().mockResolvedValue(row) },
      Prospect: { findByPk: jest.fn().mockResolvedValue(prospect), findOne: jest.fn() },
      Campaign: { findByPk: jest.fn().mockResolvedValue(campaign ?? screeningCampaign({ luckyDraw: { multiplier: 10, prize: 'iPhone 17 Pro' } })) },
    });
  }

  it('context: ready state carries first name, draw name, multiplier — nothing more', async () => {
    const svc = makeRetellScreeningService(tapDeps(fakeSequelize([])));
    const ctx = await svc.readWaCallbackContext(TOKEN);
    expect(ctx).toEqual(expect.objectContaining({ state: 'ready', firstName: 'Jane', drawName: 'Test Campaign', multiplier: 10 }));
    expect(ctx.phone).toBeUndefined();
    expect(ctx.email).toBeUndefined();
  });

  it('context: bad/expired/unknown tokens are invalid; released leads read done; active call reads in_flight', async () => {
    const svcBad = makeRetellScreeningService(tapDeps(fakeSequelize([])));
    expect((await svcBad.readWaCallbackContext('nope')).state).toBe('invalid');

    const svcExpired = makeRetellScreeningService(tapDeps(fakeSequelize([]), { row: tokenRow({ expiresAt: new Date(0) }) }));
    expect((await svcExpired.readWaCallbackContext(TOKEN)).state).toBe('invalid');

    const svcDone = makeRetellScreeningService(tapDeps(fakeSequelize([]), { prospect: pendingProspect({ quarantineReason: null }) }));
    expect((await svcDone.readWaCallbackContext(TOKEN)).state).toBe('done');

    const svcFlight = makeRetellScreeningService(tapDeps(fakeSequelize([]), { prospect: pendingProspect({ screeningActiveCallId: 'call_9' }) }));
    expect((await svcFlight.readWaCallbackContext(TOKEN)).state).toBe('in_flight');
  });

  it('tap: schedules the chosen window, grants the callback bonus, logs an activity', async () => {
    const seq = fakeSequelize([[[{ id: 'p' }]]]); // fenced schedule write
    const deps = tapDeps(seq);
    const svc = makeRetellScreeningService(deps);
    const before = Date.now();
    const out = await svc.applyWaCallbackRequest(TOKEN, 'asap', { cfg: CFG });
    expect(out).toMatchObject({ ok: true, state: 'scheduled', window: 'asap' });
    // asap ≈ +10 minutes (always-open test window, no clamping).
    const at = new Date(out.scheduledFor).getTime();
    expect(at - before).toBeGreaterThan(9 * 60 * 1000);
    expect(at - before).toBeLessThan(11 * 60 * 1000);
    const write = seq.calls[0];
    expect(write.sql).toContain(`"screeningNextAttemptAt" = :at`);
    expect(write.sql).toContain('"callbackGranted":true');
    expect(write.sql).toContain(`"quarantineReason" = 'screening_pending'`);
    expect(deps.ProspectActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('requested a screening callback via WhatsApp (asap)'),
    }));
  });

  it('tap: rejects unknown windows and reports the fresher state when the fence is lost', async () => {
    const svc = makeRetellScreeningService(tapDeps(fakeSequelize([])));
    expect((await svc.applyWaCallbackRequest(TOKEN, 'next_year', { cfg: CFG })).state).toBe('bad_window');

    const lost = pendingProspect();
    lost.reload = jest.fn().mockImplementation(() => { lost.screeningActiveCallId = 'call_5'; return Promise.resolve(); });
    const svcLost = makeRetellScreeningService(tapDeps(fakeSequelize([[[]]]), { prospect: lost }));
    const out = await svcLost.applyWaCallbackRequest(TOKEN, 'tomorrow', { cfg: CFG });
    expect(out).toMatchObject({ ok: false, state: 'in_flight' });
  });
});

describe('handleScreeningWebhook', () => {
  it('unknown prospect → orphan drop, never creates anything', async () => {
    const deps = dialerDeps(fakeSequelize(), {
      Prospect: { findByPk: jest.fn().mockResolvedValue(null), findOne: jest.fn().mockResolvedValue(null) },
    });
    const svc = makeRetellScreeningService(deps);
    const out = await svc.handleScreeningWebhook(
      { call_id: 'call_1', metadata: { mktr: { kind: 'screening', prospectId: pendingProspect().id, attemptToken: 'att_abc' } } },
      'call_analyzed'
    );
    expect(out.status).toBe('screening_orphan');
  });

  it('binds a pend_ sentinel by attempt token (dispatch-unknown recovery, Codex #3)', async () => {
    const p = pendingProspect({ screeningActiveCallId: 'pend_att_abc' });
    p.reload = jest.fn().mockImplementation(() => { p.screeningActiveCallId = 'call_1'; return Promise.resolve(); });
    const seq = fakeSequelize([
      [[{ id: 'p' }]], // bind swap
      [[{ id: 'p' }]], // attempt evidence patch
    ]);
    const deps = dialerDeps(seq, { Prospect: { findByPk: jest.fn().mockResolvedValue(p), findOne: jest.fn() } });
    const svc = makeRetellScreeningService(deps);
    const out = await svc.handleScreeningWebhook(
      {
        call_id: 'call_1',
        metadata: { mktr: { kind: 'screening', prospectId: p.id, attemptToken: 'att_abc' } },
        call_analysis: { custom_analysis_data: { qualified: true } },
      },
      'call_analyzed'
    );
    expect(seq.calls[0].opts.replacements.sentinel).toBe('pend_att_abc');
    expect(seq.calls[0].opts.replacements.callId).toBe('call_1');
    expect(deps.gate.applyQualifiedVerdict).toHaveBeenCalled();
    expect(out.status).toBe('screening_released');
  });

  it('call_started events are ignored', async () => {
    const svc = makeRetellScreeningService(dialerDeps(fakeSequelize()));
    expect((await svc.handleScreeningWebhook({ call_id: 'c' }, 'call_started')).status).toBe('screening_started');
  });
});

describe('screeningSweepService', () => {
  function sweepDeps({ qualified = [], stale = [], expired = [], pending = [], due = [], cfg = CFG } = {}) {
    const findAll = jest.fn()
      .mockResolvedValueOnce(qualified)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(due);
    const seq = {
      QueryTypes: { SELECT: 'SELECT' },
      transaction: jest.fn(async (cb) => cb({})),
      query: jest.fn(async (sql, opts) => (opts?.type ? [{ locked: true }] : [[]])),
    };
    return {
      cfg,
      sequelize: seq,
      Prospect: { findAll, count: jest.fn().mockResolvedValue(0) },
      Campaign: { findByPk: jest.fn().mockResolvedValue(screeningCampaign()) },
      retellClient: { getCall: jest.fn() },
      logger: silentLogger,
      gate: {
        releaseScreenedLead: jest.fn().mockResolvedValue({ released: true }),
        applyUnreachablePolicy: jest.fn().mockResolvedValue({ outcome: 'released_unscreened' }),
      },
      dialer: {
        resolveAttemptFailure: jest.fn().mockResolvedValue({ outcome: 'retry_scheduled' }),
        applyCallOutcome: jest.fn().mockResolvedValue({ outcome: 'released' }),
        startScreeningAttempt: jest.fn().mockResolvedValue({ status: 'dialed' }),
      },
    };
  }

  it('disabled with no backlog → skips without work', async () => {
    const deps = sweepDeps({ cfg: { ...CFG, configured: false } });
    const out = await runScreeningSweep(deps);
    expect(out).toMatchObject({ ran: false, reason: 'disabled_no_backlog' });
  });

  it('job 1 retries qualified-pending delivery before anything dials', async () => {
    const q = pendingProspect({ screeningVerdict: 'qualified' });
    const due = pendingProspect({ id: '22222222-2222-4333-8444-555555555555', screeningNextAttemptAt: new Date(0) });
    const deps = sweepDeps({ qualified: [q], due: [due] });
    const out = await runScreeningSweep(deps);
    expect(out.releasedQualified).toBe(1);
    expect(deps.gate.releaseScreenedLead.mock.invocationCallOrder[0])
      .toBeLessThan(deps.dialer.startScreeningAttempt.mock.invocationCallOrder[0]);
  });

  it('stale pend_ sentinel expires as a failed attempt; bound ids poll get-call and only 404 clears', async () => {
    const pend = pendingProspect({ screeningActiveCallId: 'pend_att_x', updatedAt: new Date(0) });
    const bound = pendingProspect({ id: '33333333-2222-4333-8444-555555555555', screeningActiveCallId: 'call_b', updatedAt: new Date(0) });
    const deps = sweepDeps({ stale: [pend, bound] });
    deps.retellClient.getCall.mockResolvedValueOnce(null); // 404 → definitively unknown
    const out = await runScreeningSweep(deps);
    expect(out.staleResolved).toBe(2);
    expect(deps.dialer.resolveAttemptFailure).toHaveBeenCalledWith(pend, 'pend_att_x', expect.objectContaining({ kind: 'dispatch_expired' }));
    expect(deps.dialer.resolveAttemptFailure).toHaveBeenCalledWith(bound, 'call_b', expect.objectContaining({ kind: 'call_unknown' }));
  });

  it('transient get-call errors leave the attempt for the next pass', async () => {
    const bound = pendingProspect({ screeningActiveCallId: 'call_b', updatedAt: new Date(0) });
    const deps = sweepDeps({ stale: [bound] });
    deps.retellClient.getCall.mockRejectedValueOnce(Object.assign(new Error('503'), { transient: true }));
    const out = await runScreeningSweep(deps);
    expect(out.errors).toBe(1);
    expect(deps.dialer.resolveAttemptFailure).not.toHaveBeenCalled();
  });

  it('TTL applies the unreachable policy to verdict-less overdue rows', async () => {
    const old = pendingProspect({ quarantinedAt: new Date(0) });
    const deps = sweepDeps({ expired: [old] });
    const out = await runScreeningSweep(deps);
    expect(out.ttl).toBe(1);
    expect(deps.gate.applyUnreachablePolicy).toHaveBeenCalledWith(old, expect.objectContaining({ via: 'screening_ttl' }));
  });

  it('spares a promised callback from the TTL and lets it take its bonus dial', async () => {
    const deps = sweepDeps({});
    await runScreeningSweep(deps);
    const [ttlQuery, dueQuery] = [deps.Prospect.findAll.mock.calls[2][0], deps.Prospect.findAll.mock.calls[4][0]];
    // TTL skips a granted lead whose promised time has not arrived, bounded by
    // a hard 2× hold ceiling.
    const ttlSql = String(ttlQuery.where[Op.and][0].val);
    // COALESCE is not cosmetic: a bare `->>' = 'true'` is NULL when the key is
    // absent, which makes NOT(…) NULL and spares ordinary leads from the TTL.
    expect(ttlSql).toContain(`COALESCE("screeningMetadata"->>'callbackGranted', 'false') = 'true'`);
    expect(ttlSql).toContain('"screeningNextAttemptAt" > NOW()');
    expect(ttlSql).toContain(`INTERVAL '48 hours'`); // 2 × maxHoldHours
    // The due-retry cap mirrors resolveAttemptFailure: 3, or 4 once granted.
    const dueSql = String(dueQuery.where[Op.and][0].val);
    expect(dueSql).toContain('"screeningAttemptCount" < 3');
    expect(dueSql).toContain('"screeningAttemptCount" < 4');
    expect(dueQuery.where.screeningAttemptCount).toBeUndefined(); // superseded by the literal
  });

  it('drain mode (feature off, backlog present) releases pending rows unscreened', async () => {
    const held = pendingProspect();
    const deps = sweepDeps({ pending: [held], cfg: { ...CFG, configured: false } });
    deps.Prospect.count = jest.fn().mockResolvedValue(1); // backlog exists → sweep runs
    const out = await runScreeningSweep(deps);
    expect(out.drained).toBe(1);
    expect(deps.gate.releaseScreenedLead).toHaveBeenCalledWith(expect.objectContaining({ unscreened: true, via: 'screening_drain' }));
    expect(deps.dialer.startScreeningAttempt).not.toHaveBeenCalled(); // never dials while off
  });
});

describe('drawExtraChances', () => {
  it('multiplier N → N−1 extra chances; default 10 → 9; clamped to 2..100', () => {
    expect(drawExtraChances({ design_config: { luckyDraw: { multiplier: 5 } } })).toBe(4);
    expect(drawExtraChances({ design_config: {} })).toBe(9);             // no draw config
    expect(drawExtraChances(null)).toBe(9);                              // no campaign
    expect(drawExtraChances({ design_config: { luckyDraw: { multiplier: 1 } } })).toBe(1);   // clamp floor 2
    expect(drawExtraChances({ design_config: { luckyDraw: { multiplier: 999 } } })).toBe(99); // clamp ceil 100
    expect(drawExtraChances({ design_config: { luckyDraw: { multiplier: 'junk' } } })).toBe(9);
  });

  it('reads top-level luckyDraw on v2 docs too (admin-API-managed, editor-invisible)', () => {
    const v2 = {
      version: 2,
      template: 't',
      theme: {},
      content: {},
      form: {},
      distribution: {},
      luckyDraw: { multiplier: 3 },
    };
    expect(drawExtraChances({ design_config: v2 })).toBe(2);
  });
});

describe('constants', () => {
  it('unanswered reasons cover the no-conversation disconnections', () => {
    for (const r of ['dial_no_answer', 'dial_busy', 'dial_failed', 'voicemail_reached', 'machine_detected']) {
      expect(UNANSWERED_REASONS.has(r)).toBe(true);
    }
    expect(UNANSWERED_REASONS.has('user_hangup')).toBe(false);
  });
});
