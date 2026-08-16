/**
 * Activation gate after Phase 3 (was drawMultiPrizeGate.test.js).
 *
 * The blanket multi-prize block is gone — the engine expands `prizes[]` into
 * that many prize units and awards each one, so a structured multi-prize
 * campaign activates freely.
 *
 * What still fails closed is the promise the engine CANNOT deliver: `winners: N`
 * with no `prizes[]`. There is no unit list to expand, so the engine would award
 * one prize while publicLuckyDraw advertises N. That is the P2-9 hole, and it
 * stays shut. Both subjects under test are pure (no DB).
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
  it('now PASSES a structured multi-prize campaign — the engine can award every unit', () => {
    expect(() => assertDrawActivatable(MULTI)).not.toThrow();
  });

  it('passes the 5× AirPods shape that Phase 3 was built for', () => {
    expect(() => assertDrawActivatable({
      luckyDraw: { enabled: true, closesAt: '2026-09-30', prizes: [{ qty: 5, name: 'AirPods Pro 3' }] },
    })).not.toThrow();
  });

  /**
   * P2-9. The guard keyed ONLY on prizes[], so a legacy config carrying
   * `winners: 5` with no prizes[] scored 0, activated, and published "5
   * winners" through publicLuckyDraw — while the engine had nothing to expand.
   */
  it('422s (DRAW_UNSTRUCTURED_MULTI_WINNER) for a LEGACY winners:N config with no prizes[]', () => {
    let thrown;
    try {
      assertDrawActivatable({
        luckyDraw: {
          enabled: true, closesAt: '2026-10-30',
          prize: '4D3N Tokyo getaway for two', winners: 5,
        },
      });
    } catch (e) { thrown = e; }
    expect(thrown?.statusCode).toBe(422);
    expect(thrown?.data?.code).toBe('DRAW_UNSTRUCTURED_MULTI_WINNER');
  });

  it('still passes a legacy config that promises exactly one winner', () => {
    expect(() => assertDrawActivatable({
      luckyDraw: {
        enabled: true, closesAt: '2026-10-30',
        prize: '4D3N Tokyo getaway for two', winners: 1,
      },
    })).not.toThrow();
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

describe('computeReadiness — draw_unstructured_multi_winner', () => {
  const base = { type: 'lead_generation', webhookEnabled: true, smsOtpConfigured: true, assignableAgents: 1 };

  it('stays SILENT for a structured multi-prize draw — it is launchable now', () => {
    const out = computeReadiness({
      ...base, drawEnabled: true, drawTotalPrizes: 4, drawStructuredPrizes: 4,
    });
    expect(out.issues.some((i) => i.code === 'draw_unstructured_multi_winner')).toBe(false);
    expect(out.issues.some((i) => i.code === 'draw_multi_prize_unsupported')).toBe(false);
  });

  it('emits a CRITICAL for a legacy winners:N campaign with no structured rows (P2-9)', () => {
    const out = computeReadiness({
      ...base, drawEnabled: true, drawTotalPrizes: 5, drawStructuredPrizes: 0,
    });
    const issue = out.issues.find((i) => i.code === 'draw_unstructured_multi_winner');
    expect(issue?.level).toBe('critical');
    expect(issue?.message).toContain('5 winners');
    expect(out.ready).toBe(false);
  });

  it('stays silent for single-prize draws and for non-draw campaigns', () => {
    const single = computeReadiness({ ...base, drawEnabled: true, drawTotalPrizes: 1, drawStructuredPrizes: 1 });
    expect(single.issues.some((i) => i.code === 'draw_unstructured_multi_winner')).toBe(false);
    const nonDraw = computeReadiness({ ...base, drawEnabled: false, drawTotalPrizes: 4, drawStructuredPrizes: 0 });
    expect(nonDraw.issues.some((i) => i.code === 'draw_unstructured_multi_winner')).toBe(false);
  });
});
