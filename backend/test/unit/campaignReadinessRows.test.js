/**
 * computeReadiness — PR-1 rows (draw-launch-integrity §2.3, Codex R1 CX19).
 * Pure-function tests, no DB: screening_no_funded_route (level follows live
 * state), lead_credits_low (tripwire before the dead-end re-arms at zero),
 * and the draw_record_missing past-due escalation.
 */
import { computeReadiness } from '../../src/services/campaignReadinessService.js';

const codes = (r) => r.issues.map((i) => `${i.level}:${i.code}`);

const BASE = {
  type: 'lead_generation',
  isActive: true,
  webhookEnabled: true,
  smsOtpConfigured: true,
  assignableAgents: 1,
  poolCreditsRemaining: 10,
  poolCreditsTotal: 10,
};

describe('screening_no_funded_route', () => {
  it('LIVE campaign + gate on + configured + zero funded agents → CRITICAL', () => {
    const r = computeReadiness({ ...BASE, assignableAgents: 0, poolCreditsRemaining: 0, poolCreditsTotal: 0, screeningConfigured: true, screeningGateOn: true });
    expect(codes(r)).toContain('critical:screening_no_funded_route');
    expect(r.ready).toBe(false);
    // The generic pool row still fires alongside — specialization, not replacement.
    expect(codes(r)).toContain('warning:no_agent_pool');
  });

  it('pre-launch (inactive) → WARNING only, never blocks activation (D7)', () => {
    const r = computeReadiness({ ...BASE, isActive: false, assignableAgents: 0, poolCreditsRemaining: 0, poolCreditsTotal: 0, screeningConfigured: true, screeningGateOn: true });
    expect(codes(r)).toContain('warning:screening_no_funded_route');
    expect(codes(r)).not.toContain('critical:screening_no_funded_route');
    expect(r.ready).toBe(true);
  });

  it('silent when the feature is dark, the gate is off, or a funded agent exists', () => {
    const dark = computeReadiness({ ...BASE, assignableAgents: 0, screeningConfigured: false, screeningGateOn: true });
    const gateOff = computeReadiness({ ...BASE, assignableAgents: 0, screeningConfigured: true, screeningGateOn: false });
    const funded = computeReadiness({ ...BASE, screeningConfigured: true, screeningGateOn: true });
    for (const r of [dark, gateOff, funded]) {
      expect(codes(r).join()).not.toContain('screening_no_funded_route');
    }
  });
});

describe('lead_credits_low', () => {
  it('fires under 20% on a screening campaign', () => {
    const r = computeReadiness({ ...BASE, screeningGateOn: true, screeningConfigured: true, poolCreditsRemaining: 1, poolCreditsTotal: 10 });
    expect(codes(r)).toContain('warning:lead_credits_low');
  });

  it('fires for draw campaigns too, and stays quiet at exactly 20%', () => {
    const low = computeReadiness({ ...BASE, drawEnabled: true, poolCreditsRemaining: 19, poolCreditsTotal: 100 });
    const at20 = computeReadiness({ ...BASE, drawEnabled: true, poolCreditsRemaining: 20, poolCreditsTotal: 100 });
    expect(codes(low)).toContain('warning:lead_credits_low');
    expect(codes(at20).join()).not.toContain('lead_credits_low');
  });

  it('silent at ZERO remaining (the zero-state rows own that) and on plain campaigns', () => {
    const zero = computeReadiness({ ...BASE, screeningGateOn: true, poolCreditsRemaining: 0, poolCreditsTotal: 10 });
    const plain = computeReadiness({ ...BASE, poolCreditsRemaining: 1, poolCreditsTotal: 10 });
    expect(codes(zero).join()).not.toContain('lead_credits_low');
    expect(codes(plain).join()).not.toContain('lead_credits_low');
  });
});

describe('draw_record_missing escalation', () => {
  const DRAW = { ...BASE, railActive: true }; // isolate from the PR-2 rail row

  it('intake open + no record → the existing WARNING (unchanged)', () => {
    const r = computeReadiness({ ...DRAW, drawEnabled: true, hasDrawRecord: false, drawIntakeOpen: true });
    expect(codes(r)).toContain('warning:draw_record_missing');
    expect(r.ready).toBe(true);
  });

  it('PAST DUE + still no record → CRITICAL (the witnessed-draw promise cannot run)', () => {
    const r = computeReadiness({ ...DRAW, drawEnabled: true, hasDrawRecord: false, drawIntakeOpen: false, drawClosesPastDue: true, docDrawClosesAt: '2026-09-30' });
    const row = r.issues.find((i) => i.code === 'draw_record_missing');
    expect(row.level).toBe('critical');
    expect(row.message).toContain('2026-09-30');
    expect(r.ready).toBe(false);
  });

  it('a record existing silences both levels', () => {
    const r = computeReadiness({ ...DRAW, drawEnabled: true, hasDrawRecord: true, drawClosesPastDue: true });
    expect(codes(r).join()).not.toContain('draw_record_missing');
  });
});

describe('promise-consistency rows (PR-3)', () => {
  const DRAW = { ...BASE, drawEnabled: true, railActive: true, hasDrawRecord: true };
  const HARD = [{ code: 'DRAW_PRIZE_MISMATCH', message: 'Prize clause disagrees.' }];
  const SOFT = [{ code: 'DRAW_TERMS_AGE_UNPARSEABLE', message: 'No age clause found.' }];
  const DRIFT = [{ code: 'DRAW_LIVE_RECORD_DRIFT', field: 'multiplier', message: 'multiplier drifted.' }];

  it('hard contradictions: CRITICAL live, warning as a draft', () => {
    const live = computeReadiness({ ...DRAW, drawHardIssues: HARD });
    expect(codes(live)).toContain('critical:draw_promise_inconsistent');
    expect(live.ready).toBe(false);
    const draft = computeReadiness({ ...DRAW, isActive: false, drawHardIssues: HARD });
    expect(codes(draft)).toContain('warning:draw_promise_inconsistent');
  });

  it('soft findings: always a review warning; drift against a live record: always critical', () => {
    const soft = computeReadiness({ ...DRAW, drawSoftIssues: SOFT });
    expect(codes(soft)).toContain('warning:draw_promise_review');
    const drift = computeReadiness({ ...DRAW, isActive: false, drawDriftIssues: DRIFT });
    expect(codes(drift)).toContain('critical:draw_live_record_drift');
  });

  it('D8 DOB invariant passes through; silent when null / non-draw', () => {
    const crit = computeReadiness({ ...DRAW, drawDobGate: 'critical' });
    expect(codes(crit)).toContain('critical:draw_age_gate_unenforceable');
    const warn = computeReadiness({ ...DRAW, drawDobGate: 'warning' });
    expect(codes(warn)).toContain('warning:draw_age_gate_unenforceable');
    const silent = computeReadiness({ ...DRAW });
    expect(codes(silent).join()).not.toContain('draw_age_gate_unenforceable');
    const nonDraw = computeReadiness({ ...BASE, drawDobGate: 'critical' });
    expect(codes(nonDraw).join()).not.toContain('draw_age_gate_unenforceable');
  });
});

describe('draw_boost_rail_missing (PR-2)', () => {
  it('LIVE draw with no active agent_unlock rail → CRITICAL', () => {
    const r = computeReadiness({ ...BASE, drawEnabled: true, railActive: false, hasDrawRecord: true });
    expect(codes(r)).toContain('critical:draw_boost_rail_missing');
    expect(r.ready).toBe(false);
  });

  it('pre-launch → informational WARNING ("armed automatically at launch")', () => {
    const r = computeReadiness({ ...BASE, isActive: false, drawEnabled: true, railActive: false, hasDrawRecord: true });
    const row = r.issues.find((i) => i.code === 'draw_boost_rail_missing');
    expect(row.level).toBe('warning');
    expect(row.message).toContain('automatically');
  });

  it('silent with an active rail, and for non-draw campaigns', () => {
    const withRail = computeReadiness({ ...BASE, drawEnabled: true, railActive: true, hasDrawRecord: true });
    const nonDraw = computeReadiness({ ...BASE, railActive: false });
    expect(codes(withRail).join()).not.toContain('draw_boost_rail_missing');
    expect(codes(nonDraw).join()).not.toContain('draw_boost_rail_missing');
  });
});
