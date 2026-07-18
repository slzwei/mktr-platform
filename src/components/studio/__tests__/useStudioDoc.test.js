import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/entities', () => ({
  Campaign: { update: vi.fn() },
}));

import { Campaign } from '@/api/entities';
import useStudioDoc, { drawInvariantProblem, getPath } from '../useStudioDoc';
import { isV2, DESIGN_CONFIG_VERSION } from '@/lib/designConfigV2';

const V1_CAMPAIGN = {
  id: 'c1',
  status: 'draft',
  design_config: {
    formHeadline: 'Redeem your voucher',
    themeColor: '#D17029',
    sgPrOnly: true,
    customerHost: 'redeem',
    termsContent: '<p>Terms</p>',
  },
};

function v2Campaign(overrides = {}) {
  return {
    id: 'c2',
    status: 'active',
    design_config: {
      version: 2,
      template: { id: 'editorial', params: {} },
      theme: { preset: 'warm-cream', accent: null },
      content: { headline: 'Hello', media: { kind: 'none', src: '', alt: '' } },
      form: {
        fields: [],
        verification: 'sms',
        gates: { sgPr: false, advisorExclusion: false, dncCheck: false },
        terms: { template: 'default', html: '<p>t</p>' },
      },
      distribution: { host: 'redeem' },
      customerHost: 'redeem',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useStudioDoc — load & upgrade', () => {
  it('upgrades a v1 doc to canonical v2 in memory (nothing persisted)', () => {
    const { result } = renderHook(() => useStudioDoc(V1_CAMPAIGN));
    expect(result.current.doc.version).toBe(DESIGN_CONFIG_VERSION);
    expect(result.current.doc.content.headline).toBe('Redeem your voucher');
    expect(result.current.doc.form.gates.sgPr).toBe(true);
    expect(result.current.doc.form.terms.html).toBe('<p>Terms</p>');
    expect(result.current.isStoredV1).toBe(true);
    expect(result.current.dirty).toBe(false);
    expect(Campaign.update).not.toHaveBeenCalled();
  });

  it('loads a v2 doc unchanged and reports isStoredV1=false', () => {
    const campaign = v2Campaign();
    const { result } = renderHook(() => useStudioDoc(campaign));
    expect(result.current.doc).toEqual(campaign.design_config);
    expect(result.current.isStoredV1).toBe(false);
  });

  it('does NOT reseed on a same-id refetch (unsaved edits survive), but reseeds on campaign switch', () => {
    const { result, rerender } = renderHook(({ campaign }) => useStudioDoc(campaign), {
      initialProps: { campaign: V1_CAMPAIGN },
    });
    act(() => result.current.setPath('content.headline', 'Edited'));
    expect(result.current.doc.content.headline).toBe('Edited');

    // Same id, new object identity (react-query refetch)
    rerender({ campaign: { ...V1_CAMPAIGN, design_config: { ...V1_CAMPAIGN.design_config } } });
    expect(result.current.doc.content.headline).toBe('Edited');

    // Different campaign id — full reseed
    rerender({ campaign: v2Campaign() });
    expect(result.current.doc.content.headline).toBe('Hello');
    expect(result.current.dirty).toBe(false);
  });
});

describe('useStudioDoc — dirty tracking', () => {
  it('setPath marks dirty; restoring the original value returns to clean', () => {
    const { result } = renderHook(() => useStudioDoc(v2Campaign()));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setPath('content.headline', 'Changed'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setPath('content.headline', 'Hello'));
    expect(result.current.dirty).toBe(false);
  });
});

describe('useStudioDoc — save', () => {
  it('PUTs the whole doc and adopts the server-clamped response as doc + baseline', async () => {
    const campaign = v2Campaign();
    // Server clamp normalizes: e.g. headline truncated + params bag seeded.
    Campaign.update.mockImplementation(async (id, body) => ({
      id,
      design_config: { ...body.design_config, content: { ...body.design_config.content, headline: 'CLAMPED' } },
    }));
    const { result } = renderHook(() => useStudioDoc(campaign));
    act(() => result.current.setPath('content.headline', 'A very long headline'));
    let res;
    await act(async () => {
      res = await result.current.save();
    });
    expect(res.ok).toBe(true);
    expect(Campaign.update).toHaveBeenCalledWith('c2', {
      design_config: expect.objectContaining({ version: 2 }),
    });
    // Adopted the RESPONSE (what actually persisted), not the sent snapshot.
    expect(result.current.doc.content.headline).toBe('CLAMPED');
    expect(result.current.dirty).toBe(false);
    expect(result.current.savedAt).toBeTruthy();
  });

  it('keeps in-flight edits and stays dirty when the operator typed during the PUT (F6)', async () => {
    const campaign = v2Campaign();
    let resolveUpdate;
    Campaign.update.mockImplementation(
      (id, body) =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({ id, design_config: body.design_config });
        })
    );
    const { result } = renderHook(() => useStudioDoc(campaign));
    act(() => result.current.setPath('content.headline', 'First'));
    let savePromise;
    act(() => {
      savePromise = result.current.save();
    });
    // Edit while the PUT is in flight
    act(() => result.current.setPath('content.headline', 'Second'));
    await act(async () => {
      resolveUpdate();
      await savePromise;
    });
    expect(result.current.doc.content.headline).toBe('Second'); // edit survived
    expect(result.current.baseline.content.headline).toBe('First'); // server truth adopted
    expect(result.current.dirty).toBe(true);
  });

  it('blocks the save client-side when an enabled draw has empty terms (server-invariant mirror)', async () => {
    const campaign = v2Campaign({
      luckyDraw: { enabled: true, closesAt: '2026-10-30' },
      form: { fields: [], verification: 'sms', gates: {}, terms: { template: 'default', html: '   ' } },
    });
    const { result } = renderHook(() => useStudioDoc(campaign));
    act(() => result.current.setPath('content.headline', 'x'));
    let res;
    await act(async () => {
      res = await result.current.save();
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('draw-invariant');
    expect(res.problem.field).toBe('terms');
    expect(Campaign.update).not.toHaveBeenCalled();
    expect(result.current.saveError?.kind).toBe('draw-invariant');
  });

  it('blocks the save client-side when an enabled draw has an invalid closesAt', async () => {
    const campaign = v2Campaign({ luckyDraw: { enabled: true, closesAt: 'not-a-date' } });
    const { result } = renderHook(() => useStudioDoc(campaign));
    act(() => result.current.setPath('content.headline', 'x'));
    let res;
    await act(async () => {
      res = await result.current.save();
    });
    expect(res.ok).toBe(false);
    expect(res.problem.field).toBe('closesAt');
    expect(Campaign.update).not.toHaveBeenCalled();
  });

  it('surfaces the 422 write gate as a typed, expected-while-dark error and stays dirty', async () => {
    const err = new Error('This design_config version is not accepted yet.');
    err.status = 422;
    err.data = { code: 'DESIGN_CONFIG_VERSION_UNSUPPORTED' };
    Campaign.update.mockRejectedValue(err);
    const { result } = renderHook(() => useStudioDoc(v2Campaign()));
    act(() => result.current.setPath('content.headline', 'x'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveError?.kind).toBe('writes-gated');
    expect(result.current.dirty).toBe(true);
  });

  it.each([
    ['DRAW_TERMS_REQUIRED', 'terms'],
    ['DRAW_CLOSES_AT_REQUIRED', 'closesAt'],
    ['DRAW_CLOSES_AT_LOCKED', 'closesAt'],
  ])('PR 5: classifies a TYPED server draw 422 (%s) with its field', async (code, field) => {
    const err = new Error('server draw message');
    err.status = 422;
    err.data = { code };
    Campaign.update.mockRejectedValue(err);
    const { result } = renderHook(() => useStudioDoc(v2Campaign()));
    act(() => result.current.setPath('content.headline', 'x'));
    let res;
    await act(async () => {
      res = await result.current.save();
    });
    expect(res.classified).toMatchObject({ kind: 'draw-invariant', section: 'form', field });
  });

  it('an untyped 422 falls through to the generic error kind (teardown PR — the message-regex fallback is gone)', async () => {
    const err = new Error('Lucky-draw campaigns need Terms & Conditions content before they can be enabled.');
    err.status = 422;
    Campaign.update.mockRejectedValue(err);
    const { result } = renderHook(() => useStudioDoc(v2Campaign()));
    act(() => result.current.setPath('content.headline', 'x'));
    let res;
    await act(async () => {
      res = await result.current.save();
    });
    expect(res.classified?.kind).toBe('error');
    expect(res.classified?.message).toMatch(/Terms & Conditions/);
  });

  it('keeps the doc dirty on a network failure', async () => {
    Campaign.update.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStudioDoc(v2Campaign()));
    act(() => result.current.setPath('content.headline', 'x'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveError?.kind).toBe('error');
    expect(result.current.dirty).toBe(true);
    expect(result.current.doc.content.headline).toBe('x');
  });
});

describe('helpers', () => {
  it('getPath walks dotted paths safely', () => {
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(getPath({ a: null }, 'a.b')).toBe(null);
    expect(getPath({}, 'x.y.z')).toBe(undefined);
  });

  it('drawInvariantProblem is null for non-draw docs and enabled draws with valid terms + date', () => {
    expect(drawInvariantProblem({ luckyDraw: { enabled: false } })).toBe(null);
    expect(
      drawInvariantProblem({
        luckyDraw: { enabled: true, closesAt: '2026-10-30' },
        form: { terms: { html: '<p>t</p>' } },
      })
    ).toBe(null);
  });
});

describe('sanity — twins agreement', () => {
  it('the upgraded doc passes the twin isV2 check', () => {
    const { result } = renderHook(() => useStudioDoc(V1_CAMPAIGN));
    expect(isV2(result.current.doc)).toBe(true);
  });
});
