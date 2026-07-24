/**
 * retellScreeningService + screeningSweepService unit tests (plan §15).
 * Covers: dial guards (verified stamp, DNC-resolved, consent, window, budget,
 * concurrency), the token-first attempt lifecycle incl. dispatch_unknown,
 * current-attempt-only outcome application, webhook token binding, and the
 * sweep's terminalize-before-dial ordering.
 */
import { createHash } from 'crypto';
import { jest } from '@jest/globals';
import {
  makeRetellScreeningService,
  inCallWindow,
  nextWindowOpen,
  nextRetryAt,
  drawExtraChances,
  UNANSWERED_REASONS,
} from '../../src/services/retellScreeningService.js';
import { runScreeningSweep } from '../../src/services/screeningSweepService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const CFG = {
  enabled: true,
  configured: true,
  agentId: 'agent_58b8bbdfb8920ce49bb2750b86',
  fromNumber: '+6562773210',
  dryRun: false,
  maxAttempts: 3,
  retryMinutes: 120,
  callWindow: '00:00-23:59', // always-open for tests
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
    IdempotencyKey: { create: jest.fn().mockResolvedValue({}) },
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
    ...over,
  };
}

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
    }), { cfg: CFG });
    expect(deps.gate.applyQualifiedVerdict).toHaveBeenCalledWith(p, expect.objectContaining({
      callId: 'call_1',
      detail: expect.objectContaining({ reason: 'keen', summary: 'S', recordingUrl: 'https://r/1.wav' }),
    }));
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
