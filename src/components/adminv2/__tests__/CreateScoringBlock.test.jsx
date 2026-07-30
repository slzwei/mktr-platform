/**
 * The creation-time scoring block (campaign-scoring-editor §3.3): the always-
 * on resolve line, brief-pick prefill, the untouched-block no-op, the
 * draft(+approve) submit contract, and the flag-off neutral state.
 */
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateScoringBlock from '../CreateScoringBlock';
import { buildAgeCurveFromBands } from '@/lib/adminV2/scoringLabels';

vi.mock('@/api/adminV2', () => ({
  fetchScoringSheetForProduct: vi.fn(),
  createScoringDraft: vi.fn(),
  approveScoringDraft: vi.fn(),
}));

import { fetchScoringSheetForProduct, createScoringDraft, approveScoringDraft } from '@/api/adminV2';

const HOUSE = {
  components: {
    engagement: { maxPoints: 15 }, contactability: { maxPoints: 10 }, market_fit: { maxPoints: 15 },
    life_events: { maxPoints: 25 }, family_gap: { maxPoints: 20 }, capacity: { maxPoints: 15 },
    age: { maxPoints: 10 }, coverage_headroom: { maxPoints: -10 },
  },
  leadComponents: { response: { maxPoints: 15 }, screening: { maxPoints: 20 } },
  ageCurve: [{ upTo: 44, value: 1 }, { upTo: null, value: 0.3 }],
  targetSegments: [],
};
const PRODUCT_SHEET = {
  version: 6, scope: 'product', config: HOUSE, raw: {}, activatedAt: '2026-07-30T00:00:00Z',
  actorName: 'Shawn Lee', houseDefault: HOUSE,
};

// createRef objects are sealed by React — the rerender handle rides beside
// the ref, not on it.
let lastRerender = null;
function setup(props = {}, ref = createRef()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <CreateScoringBlock ref={ref} product="insurance" ageBands={['30-44']} language="zh" {...props} />
    </QueryClientProvider>
  );
  lastRerender = (nextProps = {}) => view.rerender(
    <QueryClientProvider client={qc}>
      <CreateScoringBlock ref={ref} product="insurance" ageBands={['30-44']} language="zh" {...props} {...nextProps} />
    </QueryClientProvider>
  );
  return ref;
}

beforeEach(() => vi.clearAllMocks());

describe('the resolve line', () => {
  it('says which sheet a new campaign with these picks would inherit', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    setup();
    expect(await screen.findByText('product sheet')).toBeInTheDocument();
    expect(screen.getByText(/edition #6/)).toBeInTheDocument();
    expect(fetchScoringSheetForProduct).toHaveBeenCalledWith('insurance');
  });

  it('a 404 backend degrades to one neutral line and a no-op submit', async () => {
    fetchScoringSheetForProduct.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    const ref = setup();
    expect(await screen.findByText(/controls are unavailable on this backend/)).toBeInTheDocument();
    expect(await ref.current.submit('camp-9')).toBeNull();
    expect(createScoringDraft).not.toHaveBeenCalled();
  });
});

describe('tailoring', () => {
  it('prefills from the brief picks: bands → the slope-legal curve, language → a segment', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    // The band chip the brief picked is already pressed…
    expect(screen.getByRole('button', { name: '30-44' })).toHaveAttribute('aria-pressed', 'true');
    // …and the language pick became the target segment.
    expect(screen.getByLabelText('segment 1 language')).toHaveValue('zh');
  });

  it('an untouched block mints NOTHING on submit', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    const ref = setup();
    await screen.findByText('product sheet');
    expect(await ref.current.submit('camp-9')).toBeNull();
    expect(createScoringDraft).not.toHaveBeenCalled();
    expect(approveScoringDraft).not.toHaveBeenCalled();
  });

  it('a tailored block drafts AND approves on submit, carrying the pre-create baseline', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    createScoringDraft.mockResolvedValue({ version: 12, status: 'draft' });
    approveScoringDraft.mockResolvedValue({ version: 12, status: 'approved' });
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));

    const draft = await ref.current.submit('camp-9');
    expect(draft.version).toBe(12);
    const [cid, patch] = createScoringDraft.mock.calls[0];
    expect(cid).toBe('camp-9');
    // The full exposed set + the brief-derived curve and segment.
    expect(Object.keys(patch.components)).toHaveLength(8);
    expect(patch.ageCurve).toEqual(buildAgeCurveFromBands(['30-44']));
    expect(patch.targetSegments).toEqual([{ language: 'zh', weight: 1 }]);
    // The §4.5 guard rides along: the version the admin SAW pre-create.
    expect(approveScoringDraft).toHaveBeenCalledWith(12, 6);
  });

  it('unticking "apply immediately" leaves it a draft', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    createScoringDraft.mockResolvedValue({ version: 12, status: 'draft' });
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    await ref.current.submit('camp-9');
    expect(createScoringDraft).toHaveBeenCalled();
    expect(approveScoringDraft).not.toHaveBeenCalled();
  });

  it('"Skip tailoring" collapses back to inherit-only — submit mints nothing again', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip tailoring' }));
    expect(await ref.current.submit('camp-9')).toBeNull();
    expect(createScoringDraft).not.toHaveBeenCalled();
  });

  it('a failing save THROWS to the caller — creation flows toast and navigate anyway', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    createScoringDraft.mockRejectedValue(new Error('422 something'));
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    await expect(ref.current.submit('camp-9')).rejects.toThrow('422 something');
  });
});

describe('the review folds (M2/M3/B2/B3)', () => {
  it("language 'any' CLEARS inherited targeting; unanswered inherits (B2)", async () => {
    const inherited = { ...PRODUCT_SHEET, config: { ...HOUSE, targetSegments: [{ language: 'zh', weight: 1 }] } };
    fetchScoringSheetForProduct.mockResolvedValue(inherited);
    createScoringDraft.mockResolvedValue({ version: 12, status: 'draft' });
    approveScoringDraft.mockResolvedValue({ version: 12 });
    const ref = setup({ language: 'any' });
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    await ref.current.submit('camp-9');
    expect(createScoringDraft.mock.calls[0][1].targetSegments).toEqual([]);
  });

  it('the approve baseline is CAPTURED at open — a product switch after opening cannot advance it (M3)', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET); // v6
    createScoringDraft.mockResolvedValue({ version: 12, status: 'draft' });
    approveScoringDraft.mockResolvedValue({ version: 12 });
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));

    // The pick changes AFTER tailoring opened: a NEW resolve (v9) loads…
    fetchScoringSheetForProduct.mockResolvedValue({ ...PRODUCT_SHEET, version: 9 });
    lastRerender({ product: 'property' });
    await screen.findByText(/edition #9/);

    // …but submit still carries the version the admin actually saw: 6.
    await ref.current.submit('camp-9');
    expect(approveScoringDraft).toHaveBeenCalledWith(12, 6);
  });

  it('an approve failure after a saved draft throws WITH the draft version — partial success is nameable (B3)', async () => {
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    createScoringDraft.mockResolvedValue({ version: 12, status: 'draft' });
    approveScoringDraft.mockRejectedValue(Object.assign(new Error('changed while you were editing'), { status: 409 }));
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    await expect(ref.current.submit('camp-9')).rejects.toMatchObject({ draftVersion: 12 });
  });

  it('a stalled call rejects at the 30s bound instead of holding navigation hostage (M2)', async () => {
    // Render + open under REAL timers (RTL's polling needs them), then fake
    // the clock ONLY for the submit whose setTimeout we mean to fast-forward.
    fetchScoringSheetForProduct.mockResolvedValue(PRODUCT_SHEET);
    createScoringDraft.mockReturnValue(new Promise(() => {})); // never settles
    const ref = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Tailor scoring for this campaign/ }));
    vi.useFakeTimers();
    try {
      const pending = ref.current.submit('camp-9');
      const assertion = expect(pending).rejects.toThrow(/did not confirm within 30s — check the campaign page/);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('no Tailor button while the resolve is still loading — nothing to seed from yet', async () => {
    fetchScoringSheetForProduct.mockReturnValue(new Promise(() => {}));
    setup();
    expect(await screen.findByText(/checking which rules apply/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tailor scoring/ })).not.toBeInTheDocument();
  });
});
