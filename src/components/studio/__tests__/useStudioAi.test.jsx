import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));

import { apiClient } from '@/api/client';
import useStudioDoc from '../useStudioDoc';
import useStudioAi from '../useStudioAi';
import { rowDisabledReason, requestCopyDraft } from '../studioAiApi';

/**
 * Studio AI copy-mode state machine (PR 4 CP2 + the full-coverage amendment)
 * — composed with the REAL useStudioDoc so accept/keep-mine/regen semantics
 * run against a live doc, with only the HTTP layer mocked.
 */

function v2Campaign(id = 'c1', overrides = {}) {
  return {
    id,
    name: 'Voucher Blast',
    status: 'draft',
    design_config: {
      version: 2,
      template: { id: 'editorial', params: {} },
      theme: { preset: 'warm-cream', accent: null },
      content: { headline: 'Old headline', media: { kind: 'none', src: '', alt: '' } },
      form: {
        fields: [],
        verification: 'sms',
        gates: { sgPr: false, advisorExclusion: false, dncCheck: false },
        terms: { template: 'default', html: '<p>t</p>' },
      },
      distribution: { host: 'redeem', featuredDrop: { enabled: false }, marketplace: { listed: false } },
      customerHost: 'redeem',
      ...overrides,
    },
  };
}

const LIVE_QUIZ = { enabled: true, steps: [{ id: 's1', questions: [{ id: 'q1', prompt: 'P', options: [] }] }] };

// Row 0 is unconditional; row 1 (quiz intro) is gated while the quiz is off —
// the drop-title row that used to play this part is UNGATED since the
// full-coverage amendment.
const DRAFT = [
  { path: 'content.headline', label: 'Form headline', section: 'Page', value: 'Fresh AI headline', limit: 80 },
  { path: 'quiz.intro.headline', label: 'Quiz intro headline', section: 'Quiz', value: 'AI quiz intro', limit: 80 },
];

const ok = (draft = DRAFT) => ({ success: true, data: { draft } });

function useHarness(campaign, onPickLook, extra = {}) {
  const docApi = useStudioDoc(campaign);
  const ai = useStudioAi({
    campaign,
    doc: docApi.doc,
    setPath: docApi.setPath,
    replaceDoc: docApi.replaceDoc,
    onPickLook,
    ...extra,
  });
  return { docApi, ai };
}

function renderAi(campaign = v2Campaign(), onPickLook, extra) {
  return renderHook(({ c }) => useHarness(c, onPickLook, extra), { initialProps: { c: campaign } });
}

const FULL_BRIEF = { topic: 'FairPrice voucher giveaway', audience: '', objective: '', mustInclude: '', tone: 'Friendly' };

async function generateReady(result, payload = ok(DRAFT)) {
  apiClient.post.mockResolvedValueOnce(payload);
  act(() => result.current.ai.setBrief(FULL_BRIEF));
  await act(async () => {
    await result.current.ai.generate();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useStudioAi — generate (copy mode)', () => {
  it('does nothing without a topic (Generate gated on the brief)', async () => {
    const { result } = renderAi();
    await act(async () => {
      await result.current.ai.generate();
    });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(result.current.ai.phase).toBe('brief');
  });

  it('happy path: rows land as open with `old` from the UNSAVED doc + FE gating vs the doc', async () => {
    const { result } = renderAi();
    await generateReady(result);

    expect(result.current.ai.phase).toBe('ready');
    const [headline, quizIntro] = result.current.ai.sugs;
    expect(headline).toMatchObject({ state: 'open', old: 'Old headline', disabledReason: null, kind: 'copy' });
    // the quiz is OFF in the doc → the row arrives visibly gated
    expect(quizIntro.disabledReason).toMatch(/quiz is disabled/i);

    const [, body] = apiClient.post.mock.calls[0];
    expect(body).toMatchObject({ campaignId: 'c1', templateId: 'editorial', mode: 'copy', scope: null, regen: 0 });
    expect(body.brief.topic).toBe(FULL_BRIEF.topic);
  });

  it('accept writes through setPath; keep-mine right after restores the old value', async () => {
    const { result } = renderAi();
    await generateReady(result);

    act(() => result.current.ai.acceptRow(0));
    expect(result.current.docApi.doc.content.headline).toBe('Fresh AI headline');
    expect(result.current.ai.sugs[0].state).toBe('applied');

    act(() => result.current.ai.keepRow(0));
    expect(result.current.docApi.doc.content.headline).toBe('Old headline');
    expect(result.current.ai.sugs[0].state).toBe('kept');
  });

  it('keep-mine after an OPERATOR edit preserves the edit (F8 — never clobbers their typing)', async () => {
    const { result } = renderAi();
    await generateReady(result);

    act(() => result.current.ai.acceptRow(0));
    act(() => result.current.docApi.setPath('content.headline', 'Operator rewrote this'));
    act(() => result.current.ai.keepRow(0));

    expect(result.current.docApi.doc.content.headline).toBe('Operator rewrote this');
    expect(result.current.ai.sugs[0].state).toBe('kept');
  });

  it('accept re-gates at action time — a gated row is never written (F6)', async () => {
    const { result } = renderAi();
    await generateReady(result);

    act(() => result.current.ai.acceptRow(1));
    expect(result.current.docApi.doc.quiz?.intro?.headline).toBeUndefined();
    expect(result.current.ai.sugs[1].state).toBe('open');
    expect(result.current.ai.sugs[1].disabledReason).toBeTruthy();
  });

  it('accept succeeds for a row whose surface the operator just enabled (unsaved doc wins)', async () => {
    const { result } = renderAi();
    await generateReady(result);

    act(() => result.current.docApi.setPath('quiz', LIVE_QUIZ));
    act(() => result.current.ai.acceptRow(1));
    expect(result.current.docApi.doc.quiz.intro.headline).toBe('AI quiz intro');
    expect(result.current.ai.sugs[1].state).toBe('applied');
  });

  it('apply-all applies only OPEN rows and skips gated ones', async () => {
    const { result } = renderAi();
    await generateReady(result);

    act(() => result.current.ai.keepRow(0)); // kept → must not re-apply
    act(() => result.current.ai.applyAll());

    expect(result.current.docApi.doc.content.headline).toBe('Old headline');
    expect(result.current.docApi.doc.quiz?.intro?.headline).toBeUndefined(); // gated
    expect(result.current.ai.sugs[1].disabledReason).toBeTruthy();
  });

  it('per-field regen swaps an untouched APPLIED value in place (stays applied, regen counter grows)', async () => {
    const { result } = renderAi();
    await generateReady(result);
    act(() => result.current.ai.acceptRow(0));

    apiClient.post.mockResolvedValueOnce(ok([{ ...DRAFT[0], value: 'Regenerated v2' }]));
    await act(async () => {
      await result.current.ai.regenRow(0);
    });

    expect(result.current.docApi.doc.content.headline).toBe('Regenerated v2');
    expect(result.current.ai.sugs[0]).toMatchObject({ state: 'applied', value: 'Regenerated v2' });
    const [, body] = apiClient.post.mock.calls[1];
    expect(body).toMatchObject({ scope: 'content.headline', regen: 1 });
  });

  it('regen after an operator edit arrives as OPEN and leaves the doc alone (F8)', async () => {
    const { result } = renderAi();
    await generateReady(result);
    act(() => result.current.ai.acceptRow(0));
    act(() => result.current.docApi.setPath('content.headline', 'Operator edit'));

    apiClient.post.mockResolvedValueOnce(ok([{ ...DRAFT[0], value: 'Regenerated v2' }]));
    await act(async () => {
      await result.current.ai.regenRow(0);
    });

    expect(result.current.docApi.doc.content.headline).toBe('Operator edit');
    expect(result.current.ai.sugs[0]).toMatchObject({ state: 'open', value: 'Regenerated v2' });
  });

  it('regen of an applied row on a NOW-DISABLED surface never writes the doc (Codex diff #1)', async () => {
    const { result } = renderAi();
    await generateReady(result);

    // Enable the quiz, accept its intro, then disable the quiz again — the
    // stored intro value remains, so the applied-untouched branch would have
    // silently overwritten it without the re-gate.
    act(() => result.current.docApi.setPath('quiz', LIVE_QUIZ));
    act(() => result.current.ai.acceptRow(1));
    expect(result.current.docApi.doc.quiz.intro.headline).toBe('AI quiz intro');
    act(() => result.current.docApi.setPath('quiz.enabled', false));

    apiClient.post.mockResolvedValueOnce(ok([{ ...DRAFT[1], value: 'Regenerated intro' }]));
    await act(async () => {
      await result.current.ai.regenRow(1);
    });

    expect(result.current.docApi.doc.quiz.intro.headline).toBe('AI quiz intro'); // untouched
    expect(result.current.ai.sugs[1]).toMatchObject({ state: 'open', value: 'Regenerated intro' });
    expect(result.current.ai.sugs[1].disabledReason).toMatch(/quiz is disabled/i);
  });

  it('newest request wins: a second generate aborts the first, whose late response never lands (Codex diff #2)', async () => {
    const resolvers = [];
    const captured = [];
    apiClient.post.mockImplementation((url, body, options) => {
      captured.push(options);
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    });

    const { result } = renderAi();
    act(() => result.current.ai.setBrief(FULL_BRIEF));
    act(() => {
      result.current.ai.generate();
    });
    act(() => {
      result.current.ai.generate();
    });
    expect(captured[0].signal.aborted).toBe(true); // first flight aborted by the second
    expect(captured[1].signal.aborted).toBe(false);

    // newer resolves first…
    await act(async () => {
      resolvers[1]({ success: true, data: { draft: [{ ...DRAFT[0], value: 'From request 2' }] } });
    });
    expect(result.current.ai.sugs[0].value).toBe('From request 2');
    // …the older, slower response is fenced out
    await act(async () => {
      resolvers[0]({ success: true, data: { draft: [{ ...DRAFT[0], value: 'From request 1' }] } });
    });
    expect(result.current.ai.sugs[0].value).toBe('From request 2');
  });
});

// ─────────────── full-coverage rows + advisory recommendations ───────────────

const FULL_DATA = {
  draft: [
    { path: 'content.headline', label: 'Headline', section: 'Page', value: 'Fresh AI headline' },
    { path: 'distribution.marketplace.title', label: 'Consumer title', section: 'Distribution', value: 'Free Pet Hotel Trial' },
  ],
  picks: [
    { path: 'distribution.marketplace.category', label: 'Category', section: 'Distribution', value: 'family_lifestyle' },
  ],
  inclusions: {
    path: 'distribution.marketplace.inclusions',
    label: 'Inclusions',
    section: 'Distribution',
    values: ['1 night stay', 'Daily photo updates'],
  },
  recommendations: [
    { topic: 'listMarketplace', label: 'Marketplace listing', advice: 'Flip the listing on once the slug is set.', suggestedValue: 'on' },
    { topic: 'slug', label: 'URL slug', advice: 'A short slug helps QR and sharing.', suggestedValue: 'pet-hotel-trial' },
    { topic: 'formGates', label: 'Eligibility gates', advice: 'Consider the SG/PR gate for lead quality.', suggestedValue: null },
  ],
};

const okFull = () => ({ success: true, data: JSON.parse(JSON.stringify(FULL_DATA)) });

describe('useStudioAi — full-coverage rows (picks + inclusions) and recommendations', () => {
  it('merges draft + picks + inclusions into ONE typed review stream; distribution copy is UNGATED with both switches off', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());

    const rows = result.current.ai.sugs;
    expect(rows.map((r) => r.kind)).toEqual(['copy', 'copy', 'pick', 'list']);
    const mkTitle = rows[1];
    expect(mkTitle.disabledReason).toBeNull(); // no publication-switch gate any more
    const pick = rows[2];
    expect(pick).toMatchObject({ path: 'distribution.marketplace.category', value: 'family_lifestyle', state: 'open' });
    const list = rows[3];
    expect(list.value).toEqual(['1 night stay', 'Daily photo updates']);
    expect(list.old).toEqual([]); // array-kind old from the unset doc
    expect(result.current.ai.recs).toHaveLength(3);
    expect(result.current.ai.recs[0].state).toBe('open');
  });

  it('accept writes picks (enum) and lists (array); keep-mine on an ABSENT original restores absence, not \'\'/[] (Codex #198-1)', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());

    act(() => result.current.ai.acceptRow(2));
    expect(result.current.docApi.doc.distribution.marketplace.category).toBe('family_lifestyle');

    act(() => result.current.ai.acceptRow(3));
    expect(result.current.docApi.doc.distribution.marketplace.inclusions).toEqual(['1 night stay', 'Daily photo updates']);

    act(() => result.current.ai.keepRow(3));
    act(() => result.current.ai.keepRow(2));
    // both fields were absent before accept — restore must NOT leave ''/[]
    expect(result.current.docApi.doc.distribution.marketplace.inclusions).toBeUndefined();
    expect(result.current.docApi.doc.distribution.marketplace.category).toBeUndefined();
    expect(result.current.ai.sugs[3].state).toBe('kept');
    // and the dirty flag self-corrects: the JSON doc equals baseline again
    expect(JSON.stringify(result.current.docApi.doc)).not.toContain('"category"');
    expect(result.current.docApi.dirty).toBe(false);
  });

  it('keep-mine still restores a PRESENT original verbatim', async () => {
    const campaign = v2Campaign('c1', {
      distribution: { host: 'redeem', featuredDrop: { enabled: false }, marketplace: { listed: false, category: 'wellness' } },
    });
    const { result } = renderAi(campaign);
    await generateReady(result, okFull());

    act(() => result.current.ai.acceptRow(2));
    expect(result.current.docApi.doc.distribution.marketplace.category).toBe('family_lifestyle');
    act(() => result.current.ai.keepRow(2));
    expect(result.current.docApi.doc.distribution.marketplace.category).toBe('wellness');
    expect(result.current.docApi.dirty).toBe(false);
  });

  it('apply-all applies rows but NEVER recommendations (advisory contract)', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());

    act(() => result.current.ai.applyAll());
    expect(result.current.docApi.doc.distribution.marketplace.category).toBe('family_lifestyle');
    expect(result.current.docApi.doc.distribution.marketplace.listed).toBe(false); // the rec's toggle untouched
    expect(result.current.ai.recs.every((r) => r.state === 'open')).toBe(true);
  });

  it('applySection applies only that section, leaving the rest open', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());

    act(() => result.current.ai.applySection('Distribution'));
    expect(result.current.docApi.doc.content.headline).toBe('Old headline'); // Page row untouched
    expect(result.current.ai.sugs[0].state).toBe('open');
    expect(result.current.docApi.doc.distribution.marketplace.title).toBe('Free Pet Hotel Trial');
    expect(result.current.ai.sugs[2].state).toBe('applied');
  });

  it('applyRec: toggles write the unsaved doc, slug prefills via onSlugPrefill, advice-only no-ops', async () => {
    const onSlugPrefill = vi.fn(() => true);
    const { result } = renderAi(v2Campaign(), undefined, { onSlugPrefill });
    await generateReady(result, okFull());

    act(() => result.current.ai.applyRec(0));
    expect(result.current.docApi.doc.distribution.marketplace.listed).toBe(true);
    expect(result.current.ai.recs[0].state).toBe('applied');

    act(() => result.current.ai.applyRec(1));
    expect(onSlugPrefill).toHaveBeenCalledWith('pet-hotel-trial');
    expect(result.current.ai.recs[1].state).toBe('applied');

    act(() => result.current.ai.applyRec(2)); // advice-only (null suggestedValue)
    expect(result.current.ai.recs[2].state).toBe('open');
  });

  it('a VETOED slug prefill (callback returns false) leaves the card open (Codex #198-3)', async () => {
    const onSlugPrefill = vi.fn(() => false); // page-side re-check: slug exists/locked now
    const { result } = renderAi(v2Campaign(), undefined, { onSlugPrefill });
    await generateReady(result, okFull());

    act(() => result.current.ai.applyRec(1));
    expect(onSlugPrefill).toHaveBeenCalledWith('pet-hotel-trial');
    expect(result.current.ai.recs[1].state).toBe('open'); // not marked applied
  });

  it('entering looks mode invalidates copy-mode recommendation cards (Codex #198-4)', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());
    expect(result.current.ai.recs).toHaveLength(3);

    apiClient.post.mockResolvedValueOnce({ success: true, data: { proposals: [LOOK] } });
    await act(async () => {
      await result.current.ai.generateLooks();
    });
    expect(result.current.ai.recs).toEqual([]);

    // and an adopted look's ready view carries NO stale advisory cards
    act(() => result.current.ai.pickLook(0));
    act(() => result.current.ai.adoptLook());
    expect(result.current.ai.phase).toBe('ready');
    expect(result.current.ai.recs).toEqual([]);
  });

  it('jumpRec deep-links the mapped rail section', async () => {
    const onJumpSection = vi.fn();
    const { result } = renderAi(v2Campaign(), undefined, { onJumpSection });
    await generateReady(result, okFull());

    act(() => result.current.ai.jumpRec(0));
    expect(onJumpSection).toHaveBeenLastCalledWith('dist');
    act(() => result.current.ai.jumpRec(2));
    expect(onJumpSection).toHaveBeenLastCalledWith('form');
  });

  it('pick rows have no regen (no provider call)', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());
    const calls = apiClient.post.mock.calls.length;
    await act(async () => {
      await result.current.ai.regenRow(2);
    });
    expect(apiClient.post.mock.calls.length).toBe(calls);
  });

  it('regen of the inclusions row swaps the untouched applied array in place', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());
    act(() => result.current.ai.acceptRow(3));

    apiClient.post.mockResolvedValueOnce({
      success: true,
      data: {
        draft: [],
        picks: [],
        inclusions: { ...FULL_DATA.inclusions, values: ['Fresh towels', 'Play area access'] },
        recommendations: [],
      },
    });
    await act(async () => {
      await result.current.ai.regenRow(3);
    });

    expect(result.current.docApi.doc.distribution.marketplace.inclusions).toEqual(['Fresh towels', 'Play area access']);
    expect(result.current.ai.sugs[3]).toMatchObject({ state: 'applied' });
    const [, body] = apiClient.post.mock.calls[1];
    expect(body).toMatchObject({ scope: 'distribution.marketplace.inclusions', regen: 1 });
  });

  it('a scoped per-field ✦ clears stale recommendation cards; discard clears both', async () => {
    const { result } = renderAi();
    await generateReady(result, okFull());
    expect(result.current.ai.recs).toHaveLength(3);

    apiClient.post.mockResolvedValueOnce(ok([DRAFT[0]]));
    await act(async () => {
      await result.current.ai.suggestField('content.headline', 'Form headline');
    });
    expect(result.current.ai.recs).toEqual([]);

    await generateReady(result, okFull());
    act(() => result.current.ai.discard());
    expect(result.current.ai.sugs).toEqual([]);
    expect(result.current.ai.recs).toEqual([]);
  });

  it('campaign switch clears recommendations with everything else (F10)', async () => {
    const { result, rerender } = renderAi();
    await generateReady(result, okFull());
    expect(result.current.ai.recs).toHaveLength(3);

    rerender({ c: v2Campaign('c2') });
    expect(result.current.ai.recs).toEqual([]);
    expect(result.current.ai.phase).toBe('brief');
  });
});

describe('useStudioAi — per-field ✦ + budget', () => {
  it('suggestField opens the panel scoped, topic defaults to the campaign name', async () => {
    const { result } = renderAi();
    apiClient.post.mockResolvedValueOnce(ok([DRAFT[0]]));
    await act(async () => {
      await result.current.ai.suggestField('content.headline', 'Form headline');
    });

    expect(result.current.ai.open).toBe(true);
    expect(result.current.ai.scope).toEqual({ path: 'content.headline', label: 'Form headline' });
    expect(result.current.ai.phase).toBe('ready');
    const [, body] = apiClient.post.mock.calls[0];
    expect(body.scope).toBe('content.headline');
    expect(body.brief.topic).toBe('Voucher Blast');
  });

  it('counts calls in the sliding-minute budget estimate', async () => {
    const { result } = renderAi();
    await generateReady(result);
    apiClient.post.mockResolvedValueOnce(ok([DRAFT[0]]));
    await act(async () => {
      await result.current.ai.regenRow(0);
    });
    expect(result.current.ai.budget).toEqual({ used: 2, max: 10 });
  });
});

describe('useStudioAi — errors, rate limit, campaign scoping', () => {
  it('429 → rate phase with the server retryAfterSec, countdown returns to brief', async () => {
    vi.useFakeTimers();
    const { result } = renderAi();
    const err = new Error('Too many');
    err.status = 429;
    err.data = { retryAfterSec: 2 };
    apiClient.post.mockRejectedValueOnce(err);

    act(() => result.current.ai.setBrief(FULL_BRIEF));
    await act(async () => {
      await result.current.ai.generate();
    });
    expect(result.current.ai.phase).toBe('rate');
    expect(result.current.ai.retryIn).toBe(2);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ai.phase).toBe('brief');
  });

  it('409 (AI unconfigured) → error phase with the settings hint', async () => {
    const { result } = renderAi();
    const err = new Error('No AI provider configured');
    err.status = 409;
    apiClient.post.mockRejectedValueOnce(err);

    act(() => result.current.ai.setBrief(FULL_BRIEF));
    await act(async () => {
      await result.current.ai.generate();
    });
    expect(result.current.ai.phase).toBe('error');
    expect(result.current.ai.error).toMatch(/AI Settings/i);
  });

  it('campaign switch aborts the in-flight request and a late response never lands (F10)', async () => {
    let resolvePost;
    let captured;
    apiClient.post.mockImplementationOnce((url, body, options) => {
      captured = options;
      return new Promise((resolve) => {
        resolvePost = resolve;
      });
    });

    const { result, rerender } = renderAi();
    act(() => result.current.ai.setBrief(FULL_BRIEF));
    act(() => {
      result.current.ai.generate();
    });
    expect(result.current.ai.phase).toBe('loading');

    rerender({ c: v2Campaign('c2') });
    expect(captured.signal.aborted).toBe(true);

    await act(async () => {
      resolvePost(ok());
    });
    expect(result.current.ai.phase).toBe('brief'); // reset won — stale response ignored
    expect(result.current.ai.sugs).toEqual([]);
  });
});

const LOOK = {
  name: 'Dusk Poster',
  rationale: 'High-contrast hero.',
  template: { id: 'poster', params: { overlay: 'dusk' } },
  theme: { preset: 'ink-slate', accent: null },
  media: { kind: 'image', note: 'Warm hawker-centre scene' },
  draft: [{ path: 'content.headline', label: 'Form headline', section: 'page', value: 'Look headline' }],
};
const SPOTLIGHT_LOOK = { ...LOOK, name: 'Quiz Tease', template: { id: 'spotlight', params: {} } };

const okLooks = (proposals = [LOOK]) => ({ success: true, data: { proposals } });

async function looksReady(result, proposals = [LOOK]) {
  apiClient.post.mockResolvedValueOnce(okLooks(proposals));
  act(() => result.current.ai.setBrief(FULL_BRIEF));
  await act(async () => {
    await result.current.ai.generateLooks();
  });
}

describe('useStudioAi — full mode (CO-1 looks)', () => {
  it('generateLooks: ONE call with mode full → looks phase', async () => {
    const { result } = renderAi();
    await looksReady(result);
    expect(result.current.ai.phase).toBe('looks');
    expect(result.current.ai.looks).toHaveLength(1);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({ mode: 'full', scope: null, regen: 0 });
  });

  it('pickLook swaps the WHOLE doc, sets the proposal + media hint, fires the F12 side effects', async () => {
    const onPick = vi.fn();
    const { result } = renderAi(v2Campaign(), onPick);
    await looksReady(result);

    act(() => result.current.ai.pickLook(0));

    expect(result.current.docApi.doc.template.id).toBe('poster');
    expect(result.current.docApi.doc.content.headline).toBe('Look headline');
    expect(result.current.docApi.doc.content.media.kind).toBe('none'); // F7 — media untouched
    expect(result.current.docApi.dirty).toBe(true);
    expect(result.current.ai.phase).toBe('proposal');
    expect(result.current.ai.proposal.adopted).toBe(false);
    expect(result.current.ai.proposal.prev.doc.template.id).toBe('editorial');
    expect(result.current.ai.mediaHint).toEqual({ kind: 'image', note: 'Warm hawker-centre scene' });
    expect(onPick).toHaveBeenCalled();
  });

  it('keep toggles rebuild from prev.doc; all-three-kept restores it byte-for-byte (dirty self-corrects)', async () => {
    const { result } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));

    act(() => result.current.ai.toggleKeep('template'));
    expect(result.current.docApi.doc.template.id).toBe('editorial'); // template kept
    expect(result.current.docApi.doc.content.headline).toBe('Look headline'); // copy still on

    act(() => result.current.ai.toggleKeep('theme'));
    act(() => result.current.ai.toggleKeep('copy'));
    expect(result.current.docApi.doc).toEqual(result.current.ai.proposal.prev.doc);
    expect(result.current.docApi.dirty).toBe(false); // derived — F8
  });

  it('adopt with all-three-kept is a no-op discard (F9)', async () => {
    const { result } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));
    act(() => result.current.ai.toggleKeep('template'));
    act(() => result.current.ai.toggleKeep('theme'));
    act(() => result.current.ai.toggleKeep('copy'));

    act(() => result.current.ai.adoptLook());
    expect(result.current.ai.proposal).toBeNull();
    expect(result.current.docApi.doc.template.id).toBe('editorial');
    expect(result.current.ai.phase).toBe('looks');
  });

  it('adopt turns the landed copy into an APPLIED review list (old = pre-look) — keep-mine restores', async () => {
    const { result } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));
    act(() => result.current.ai.adoptLook());

    expect(result.current.ai.proposal.adopted).toBe(true);
    expect(result.current.ai.phase).toBe('ready');
    expect(result.current.ai.sugs).toHaveLength(1);
    expect(result.current.ai.sugs[0]).toMatchObject({ state: 'applied', old: 'Old headline', value: 'Look headline' });

    act(() => result.current.ai.keepRow(0));
    expect(result.current.docApi.doc.content.headline).toBe('Old headline');
    expect(result.current.docApi.doc.template.id).toBe('poster'); // the look itself stays adopted
  });

  it('revertLook restores the pre-proposal doc even AFTER adopt (until save commits)', async () => {
    const { result } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));
    act(() => result.current.ai.adoptLook());

    act(() => result.current.ai.revertLook());
    expect(result.current.docApi.doc).toEqual(result.current.docApi.baseline);
    expect(result.current.docApi.dirty).toBe(false);
    expect(result.current.ai.proposal).toBeNull();
    expect(result.current.ai.mediaHint).toBeNull();
    expect(result.current.ai.sugs).toEqual([]);
  });

  it('notifySaved commits ONLY the proposal the save started with (Codex diff #3)', async () => {
    const { result } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));
    act(() => result.current.ai.adoptLook());

    const committed = result.current.ai.proposal;
    act(() => result.current.ai.notifySaved(committed));
    expect(result.current.ai.proposal).toBeNull();
    expect(result.current.docApi.doc.template.id).toBe('poster');
  });

  it('a save that started BEFORE a pick never clears the newer proposal (Codex diff #3)', async () => {
    const { result } = renderAi();
    await looksReady(result);

    // Save snapshot taken with NO proposal (null), then a look is picked while
    // the PUT is in flight — the late success must not strip its gate.
    const proposalAtSaveStart = result.current.ai.proposal; // null
    act(() => result.current.ai.pickLook(0));
    const picked = result.current.ai.proposal;
    expect(picked).not.toBeNull();

    act(() => result.current.ai.notifySaved(proposalAtSaveStart));
    expect(result.current.ai.proposal).toBe(picked); // survives, still unadopted
  });

  it('picking ANOTHER look mid-proposal retains the ORIGINAL prev (F9)', async () => {
    const second = { ...LOOK, name: 'Second', template: { id: 'split', params: {} } };
    const { result } = renderAi();
    await looksReady(result, [LOOK, second]);

    act(() => result.current.ai.pickLook(0));
    const originalPrev = result.current.ai.proposal.prev.doc;
    act(() => result.current.ai.pickLook(1));

    expect(result.current.docApi.doc.template.id).toBe('split');
    expect(result.current.ai.proposal.prev.doc).toBe(originalPrev); // same object — never rebased
    act(() => result.current.ai.revertLook());
    expect(result.current.docApi.doc.template.id).toBe('editorial');
  });

  it('a spotlight look cannot be picked while the unsaved quiz is off (F6)', async () => {
    const { result } = renderAi();
    await looksReady(result, [SPOTLIGHT_LOOK]);
    act(() => result.current.ai.pickLook(0));
    expect(result.current.ai.proposal).toBeNull();
    expect(result.current.docApi.doc.template.id).toBe('editorial');
  });

  it('per-card regen replaces that look in place and leaves an active proposal prev alone', async () => {
    const { result } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));
    const originalPrev = result.current.ai.proposal.prev.doc;

    const fresh = { ...LOOK, name: 'Fresh Look' };
    apiClient.post.mockResolvedValueOnce(okLooks([fresh]));
    await act(async () => {
      await result.current.ai.regenLook(0);
    });

    expect(result.current.ai.looks[0].name).toBe('Fresh Look');
    expect(apiClient.post.mock.calls[1][1]).toMatchObject({ mode: 'full', regen: 1 });
    expect(result.current.ai.proposal.prev.doc).toBe(originalPrev);
  });

  it('a superseded look-regen clears ITS card spinner (round 2 #1 — Generate looks mid-regen)', async () => {
    const { result } = renderAi();
    await looksReady(result);

    // regenLook(0) hangs; Edit brief → a fresh generateLooks supersedes it
    let hang;
    apiClient.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          hang = resolve;
        })
    );
    act(() => {
      result.current.ai.regenLook(0);
    });
    expect(result.current.ai.regeningLook).toBe(0);

    apiClient.post.mockResolvedValueOnce(okLooks([LOOK]));
    await act(async () => {
      await result.current.ai.generateLooks();
    });
    // the aborted regen settles; its finally must clear card 0's spinner
    await act(async () => {
      hang({ success: true, data: { proposals: [LOOK] } });
    });
    expect(result.current.ai.regeningLook).toBeNull();
    expect(result.current.ai.phase).toBe('looks'); // fresh gallery, card usable
  });

  it('campaign switch clears looks, proposal and hint', async () => {
    const { result, rerender } = renderAi();
    await looksReady(result);
    act(() => result.current.ai.pickLook(0));

    rerender({ c: v2Campaign('c2') });
    expect(result.current.ai.looks).toEqual([]);
    expect(result.current.ai.proposal).toBeNull();
    expect(result.current.ai.mediaHint).toBeNull();
    expect(result.current.ai.phase).toBe('brief');
  });
});

describe('studioAiApi — rowDisabledReason (the conditional whitelist vs the unsaved doc)', () => {
  const base = v2Campaign().design_config;
  const withQuiz = (enabled, questions, scoring = undefined) => ({
    ...base,
    quiz: {
      enabled,
      steps: questions > 0 ? [{ questions: Array.from({ length: questions }, (_, i) => ({ id: `q${i}` })) }] : [],
      ...(scoring ? { scoring } : {}),
    },
  });

  it.each([
    ['content.headline', base, null],
    ['content.heroCtaLabel', base, /no hero media/i],
    ['content.heroCtaLabel', { ...base, content: { ...base.content, media: { kind: 'image', src: 'x.jpg' } } }, null],
    ['content.media.alt', base, /no hero image/i],
    ['content.media.alt', { ...base, content: { ...base.content, media: { kind: 'video', src: 'x.mp4' } } }, /no hero image/i],
    ['content.media.alt', { ...base, content: { ...base.content, media: { kind: 'image', src: 'x.jpg' } } }, null],
    ['quiz.intro.headline', base, /quiz is disabled/i],
    ['quiz.intro.headline', withQuiz(true, 0), /quiz is disabled/i],
    ['quiz.intro.ctaLabel', withQuiz(true, 2), null],
    ['quiz.reveal.gapTemplate', base, /quiz is disabled/i],
    ['quiz.reveal.valueExchange', withQuiz(true, 2), null],
    ['quiz.scoring.readiness.label', withQuiz(true, 2), /readiness meter is off/i],
    ['quiz.scoring.readiness.label', withQuiz(true, 2, { readiness: { enabled: true } }), null],
    // Full-coverage amendment: distribution copy has NO publication-switch gate
    ['distribution.featuredDrop.title', base, null],
    ['distribution.featuredDrop.valueLabel', base, null],
    ['distribution.marketplace.title', base, null],
    ['distribution.marketplace.valueLine', base, null],
    ['distribution.marketplace.inclusions', base, null],
    ['template.params.express.trustLine', base, /express template/i],
    ['template.params.express.trustLine', { ...base, template: { id: 'express', params: {} } }, null],
  ])('%s', (path, doc, expected) => {
    const reason = rowDisabledReason(doc, path);
    if (expected === null) expect(reason).toBeNull();
    else expect(reason).toMatch(expected);
  });
});

describe('studioAiApi — requestCopyDraft error mapping', () => {
  it('reads data off the house envelope (apiClient does NOT unwrap)', async () => {
    apiClient.post.mockResolvedValueOnce({ success: true, data: { draft: DRAFT } });
    await expect(requestCopyDraft({})).resolves.toEqual({ draft: DRAFT });
  });

  it('429 without a server retryAfterSec falls back to 60', async () => {
    const err = new Error('Too many');
    err.status = 429;
    apiClient.post.mockRejectedValueOnce(err);
    await expect(requestCopyDraft({})).rejects.toMatchObject({ kind: 'rate', retryAfterSec: 60 });
  });

  it('maps other failures to a retryable error kind', async () => {
    const err = new Error('AI provider timed out.');
    err.status = 504;
    apiClient.post.mockRejectedValueOnce(err);
    await expect(requestCopyDraft({})).rejects.toMatchObject({ kind: 'error', message: 'AI provider timed out.' });
  });
});
