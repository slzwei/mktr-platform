import { describe, it, expect } from 'vitest';
import { buildLookDoc, adoptedCopyRows, lookBlockedReason, rowDisabledReason } from '../studioLooks';

/**
 * The CO-1 look composer (PR 4) — the keep matrix, params-bag preservation,
 * theme merge semantics, copy re-gating against the doc AS BUILT, and the
 * media-honesty rule (F7: a look NEVER touches content.media).
 */

const base = () => ({
  version: 2,
  template: { id: 'editorial', params: { editorial: { formWidth: 520 }, poster: { overlay: 'plain' } } },
  theme: { preset: 'warm-cream', font: 'schibsted', accent: '#AA3344' },
  content: { headline: 'Old headline', story: 'Old story', media: { kind: 'none', src: '', alt: '' } },
  distribution: { featuredDrop: { enabled: false }, marketplace: { listed: false } },
});

const LOOK = {
  name: 'Dusk Poster',
  rationale: 'High-contrast hero.',
  template: { id: 'poster', params: { overlay: 'dusk' } },
  theme: { preset: 'ink-slate', accent: null },
  media: { kind: 'image', note: 'Warm hawker-centre scene' },
  draft: [
    { path: 'content.headline', label: 'Form headline', section: 'page', value: 'New headline' },
    { path: 'distribution.featuredDrop.title', label: 'Drop title', section: 'distribution', value: 'Drop!' },
  ],
};

describe('buildLookDoc', () => {
  it('switches template, merges params into THAT bag, preserves every other bag', () => {
    const doc = buildLookDoc(base(), LOOK, {});
    expect(doc.template.id).toBe('poster');
    expect(doc.template.params.poster).toEqual({ overlay: 'dusk' }); // look wins over the stored poster bag
    expect(doc.template.params.editorial).toEqual({ formWidth: 520 }); // untouched sibling bag
  });

  it('merges only the theme keys the look carries; accent:null clears the custom accent', () => {
    const doc = buildLookDoc(base(), LOOK, {});
    expect(doc.theme.preset).toBe('ink-slate');
    expect(doc.theme.accent).toBeNull();
    expect(doc.theme.font).toBe('schibsted'); // look omitted font → base survives
  });

  it('applies copy rows re-gated against the doc AS BUILT (drop row skipped while the drop is off)', () => {
    const doc = buildLookDoc(base(), LOOK, {});
    expect(doc.content.headline).toBe('New headline');
    expect(doc.distribution.featuredDrop.title).toBeUndefined();
  });

  it('express trust line lands only when the look makes express the EFFECTIVE template (F4)', () => {
    const trustRow = { path: 'template.params.express.trustLine', label: 'Trust line', section: 'page', value: 'Trusted by 12k' };
    const expressLook = { ...LOOK, template: { id: 'express', params: {} }, draft: [trustRow] };
    expect(buildLookDoc(base(), expressLook, {}).template.params.express.trustLine).toBe('Trusted by 12k');
    // keep my template → effective template stays editorial → row skipped
    const kept = buildLookDoc(base(), expressLook, { template: true });
    expect(kept.template.id).toBe('editorial');
    expect(kept.template.params.express?.trustLine).toBeUndefined();
  });

  it('keep matrix: template/theme/copy each hold their part of the base', () => {
    const b = base();
    const keepTemplate = buildLookDoc(b, LOOK, { template: true });
    expect(keepTemplate.template).toEqual(b.template);
    expect(keepTemplate.theme.preset).toBe('ink-slate');

    const keepTheme = buildLookDoc(b, LOOK, { theme: true });
    expect(keepTheme.theme).toEqual(b.theme);
    expect(keepTheme.template.id).toBe('poster');

    const keepCopy = buildLookDoc(b, LOOK, { copy: true });
    expect(keepCopy.content.headline).toBe('Old headline');

    // all three kept → the base doc, byte for byte
    expect(buildLookDoc(b, LOOK, { template: true, theme: true, copy: true })).toEqual(b);
  });

  it('NEVER touches content.media (F7 — art direction is a hint chip, not a write)', () => {
    const doc = buildLookDoc(base(), LOOK, {});
    expect(doc.content.media).toEqual({ kind: 'none', src: '', alt: '' });
  });

  it('does not mutate the base document', () => {
    const b = base();
    const snapshot = JSON.parse(JSON.stringify(b));
    buildLookDoc(b, LOOK, {});
    expect(b).toEqual(snapshot);
  });
});

describe('adoptedCopyRows', () => {
  it('yields applied rows (old = pre-look values) only for rows that actually landed', () => {
    const prev = base();
    const lookDoc = buildLookDoc(prev, LOOK, {});
    const rows = adoptedCopyRows(LOOK, prev, lookDoc);
    expect(rows).toHaveLength(1); // the gated drop-title row never landed
    expect(rows[0]).toMatchObject({
      path: 'content.headline',
      value: 'New headline',
      old: 'Old headline',
      state: 'applied',
      disabledReason: null,
    });
  });
});

describe('lookBlockedReason', () => {
  it('blocks spotlight while the quiz is off; allows it with a live quiz', () => {
    const spotlight = { template: { id: 'spotlight' } };
    expect(lookBlockedReason(base(), spotlight)).toMatch(/Spotlight needs the quiz/);
    const quizDoc = { ...base(), quiz: { enabled: true, steps: [{ questions: [{ id: 'q1' }] }] } };
    expect(lookBlockedReason(quizDoc, spotlight)).toBeNull();
    expect(lookBlockedReason(base(), { template: { id: 'poster' } })).toBeNull();
  });
});

describe('rowDisabledReason — moved home (re-exported via studioAiApi)', () => {
  it('still gates the five conditional paths', () => {
    expect(rowDisabledReason(base(), 'content.headline')).toBeNull();
    expect(rowDisabledReason(base(), 'content.heroCtaLabel')).toMatch(/no hero media/i);
    expect(rowDisabledReason(base(), 'distribution.featuredDrop.title')).toMatch(/featured drop/i);
  });
});
