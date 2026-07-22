/**
 * Fail-closed multi-prize activation gate
 * (docs/plans/lucky-draw-multi-prize-plan.md §3.5): until the multi-winner
 * draw engine ships, a campaign whose structured prizes total more than one
 * unit must not BE active — assertDrawActivatable 422s on every service path
 * that can leave it active, and readiness surfaces the reason as a critical.
 * Both under test here are pure (no DB).
 */
import { computeReadiness } from '../src/services/campaignReadinessService.js';
import { assertDrawActivatable } from '../src/services/campaignService.js';

const MULTI = {
  luckyDraw: {
    enabled: true,
    closesAt: '2026-10-30',
    prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }],
  },
};

describe('assertDrawActivatable', () => {
  it('422s with DRAW_MULTI_PRIZE_UNSUPPORTED when Σqty > 1', () => {
    let thrown;
    try { assertDrawActivatable(MULTI); } catch (e) { thrown = e; }
    expect(thrown?.statusCode).toBe(422);
    expect(thrown?.data?.code).toBe('DRAW_MULTI_PRIZE_UNSUPPORTED');
  });

  it('passes for single-structured, legacy, disabled, and absent draws', () => {
    expect(() => assertDrawActivatable({
      luckyDraw: { enabled: true, closesAt: '2026-10-30', prizes: [{ qty: 1, name: 'iPhone 17 Pro' }] },
    })).not.toThrow();
    expect(() => assertDrawActivatable({
      luckyDraw: { enabled: true, closesAt: '2026-10-30', prize: '4D3N Tokyo getaway for two' },
    })).not.toThrow();
    expect(() => assertDrawActivatable({ luckyDraw: { ...MULTI.luckyDraw, enabled: false } })).not.toThrow();
    expect(() => assertDrawActivatable({})).not.toThrow();
    expect(() => assertDrawActivatable(undefined)).not.toThrow();
  });
});

describe('computeReadiness — draw_multi_prize_unsupported', () => {
  const base = { type: 'lead_generation', webhookEnabled: true, smsOtpConfigured: true, assignableAgents: 1 };

  it('emits a CRITICAL (ready:false) for an enabled draw with Σqty > 1', () => {
    const out = computeReadiness({ ...base, drawEnabled: true, drawTotalPrizes: 4 });
    const issue = out.issues.find((i) => i.code === 'draw_multi_prize_unsupported');
    expect(issue?.level).toBe('critical');
    expect(issue?.message).toContain('4 prizes');
    expect(out.ready).toBe(false);
  });

  it('stays silent for single-prize draws and for non-draw campaigns', () => {
    const single = computeReadiness({ ...base, drawEnabled: true, drawTotalPrizes: 1 });
    expect(single.issues.some((i) => i.code === 'draw_multi_prize_unsupported')).toBe(false);
    const nonDraw = computeReadiness({ ...base, drawEnabled: false, drawTotalPrizes: 4 });
    expect(nonDraw.issues.some((i) => i.code === 'draw_multi_prize_unsupported')).toBe(false);
  });
});
