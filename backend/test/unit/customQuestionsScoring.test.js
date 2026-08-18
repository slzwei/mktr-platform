import { makeScoringStage } from '../../src/services/prospectScoring.js';

/**
 * Custom questions — the SCORE-stage acceptance matrix
 * (studio-custom-questions §6). Pure: no DB, no app. The DB-backed
 * integration legs (persistence, observations-zero, erasure, scrub) live in
 * test/consumerEnrichment.test.js.
 */

const logger = { warn: () => {}, error: () => {} };
const scoreSubmission = makeScoringStage({ d: { logger } });

const CUSTOM = [
  { id: 'c_showrm', type: 'single', prompt: 'Which showroom is closer?', options: [{ id: 'o1', label: 'Jurong' }, { id: 'o2', label: 'Tampines' }] },
  { id: 'c_hobby1', type: 'multi', prompt: 'What do you enjoy?', options: [{ id: 'o1', label: 'Golf' }, { id: 'o2', label: 'Travel' }, { id: 'o3', label: 'Food' }] },
  { id: 'c_notes1', type: 'text', prompt: 'Anything else?' },
];

function campaignWith(pqOverrides = {}, campaignOverrides = {}) {
  return {
    type: 'lead_generation',
    design_config: {
      version: 2,
      template: { id: 'express' },
      profileQuestions: {
        enabled: true,
        questionIds: ['language', 'c_showrm', 'c_hobby1', 'c_notes1'],
        requiredIds: [],
        custom: CUSTOM,
        ...pqOverrides,
      },
    },
    ...campaignOverrides,
  };
}

function run(profileAnswers, sourceCampaign = campaignWith()) {
  return scoreSubmission({
    quizSubmission: null,
    safeBody: { profileAnswers },
    sourceCampaign,
    campaignId: 'test-campaign',
  });
}

describe('custom-question acceptance (scoreSubmission)', () => {
  it('freezes prompt + labels in questionIds/def-option order; text trimmed; library facts ride beside', () => {
    const { sourceMetadataPatch, acceptedProfileFacts } = run({
      language: 'zh',
      c_showrm: 'o2',
      c_hobby1: ['o3', 'o1'],
      c_notes1: '  Call after 6pm  ',
    });
    expect(sourceMetadataPatch.profileAnswers).toEqual({ language: 'zh' });
    expect(sourceMetadataPatch.customAnswers).toEqual([
      { qid: 'c_showrm', prompt: 'Which showroom is closer?', values: ['Tampines'] },
      { qid: 'c_hobby1', prompt: 'What do you enjoy?', values: ['Golf', 'Food'] },
      { qid: 'c_notes1', prompt: 'Anything else?', values: ['Call after 6pm'] },
    ]);
    // Custom answers NEVER mint facts — only the library answer does.
    expect(acceptedProfileFacts.map((f) => f.key)).toEqual(['identity.preferred_language']);
  });

  it('drop-not-fail per answer: unknown option / non-subset multi / dup multi / wrong shapes', () => {
    const { sourceMetadataPatch } = run({
      c_showrm: 'o9', // unknown option id
      c_hobby1: ['o1', 'o1'], // dup
      c_notes1: ['not', 'a', 'string'], // wrong shape for text
    });
    expect(sourceMetadataPatch.customAnswers).toBeUndefined();

    const ok = run({ c_showrm: ['o1'], c_hobby1: 'o1', c_notes1: 'fine' });
    // single given an array + multi given a string are both dropped; text survives
    expect(ok.sourceMetadataPatch.customAnswers).toEqual([
      { qid: 'c_notes1', prompt: 'Anything else?', values: ['fine'] },
    ]);
  });

  it('whitespace-only and control-char-only text answers are skipped, not stored', () => {
    expect(run({ c_notes1: '   ' }).sourceMetadataPatch.customAnswers).toBeUndefined();
    expect(run({ c_notes1: '\u200E\u202E' }).sourceMetadataPatch.customAnswers).toBeUndefined();
  });

  it('text answers are sanitized (control chars stripped, 200-char cap) before freezing', () => {
    const { sourceMetadataPatch } = run({ c_notes1: `AB\u202E\u0007${'x'.repeat(400)}` });
    const [answer] = sourceMetadataPatch.customAnswers;
    expect(answer.values[0].startsWith('ABx')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(answer.values[0]).not.toMatch(/[\u0000-\u001F\u202A-\u202E]/);
    expect(answer.values[0].length).toBeLessThanOrEqual(200);
  });

  it('hostile direct-DB defs: prompts/labels are re-sanitized at freeze; empty-after-sanitize prompt skips the def', () => {
    const campaign = campaignWith({
      questionIds: ['c_evil01', 'c_blank1'],
      custom: [
        { id: 'c_evil01', type: 'single', prompt: '\u202EEvil prompt', options: [{ id: 'o1', label: 'Jurong\u202E' }, { id: 'o2', label: 'B' }] },
        { id: 'c_blank1', type: 'text', prompt: '\u202E' },
      ],
    });
    const { sourceMetadataPatch } = run({ c_evil01: 'o1', c_blank1: 'hello' }, campaign);
    expect(sourceMetadataPatch.customAnswers).toEqual([
      { qid: 'c_evil01', prompt: 'Evil prompt', values: ['Jurong'] },
    ]);
  });

  it('the repaired gate: guided-review TYPE rejects even with a non-guided template id; template.id leg still holds', () => {
    const byType = run({ c_notes1: 'hi' }, campaignWith({}, { type: 'guided_review' }));
    expect(byType.sourceMetadataPatch.customAnswers).toBeUndefined();
    expect(byType.sourceMetadataPatch.profileAnswers).toBeUndefined();

    const byTemplate = run({ c_notes1: 'hi' }, (() => {
      const c = campaignWith();
      c.design_config.template.id = 'guided_review';
      return c;
    })());
    expect(byTemplate.sourceMetadataPatch.customAnswers).toBeUndefined();
  });

  it('answers for ids not in questionIds are ignored even when a def exists (membership is the authority)', () => {
    const campaign = campaignWith({ questionIds: ['c_showrm'] }); // hobby/notes defs exist but unasked
    const { sourceMetadataPatch } = run({ c_showrm: 'o1', c_hobby1: ['o1'], c_notes1: 'hi' }, campaign);
    expect(sourceMetadataPatch.customAnswers).toEqual([
      { qid: 'c_showrm', prompt: 'Which showroom is closer?', values: ['Jurong'] },
    ]);
  });

  it('disabled subtree / legacy config ignores everything (unchanged eligibility)', () => {
    expect(run({ c_notes1: 'hi' }, campaignWith({ enabled: false })).sourceMetadataPatch.customAnswers)
      .toBeUndefined();
    expect(run({ c_notes1: 'hi' }, { type: 'lead_generation', design_config: {} }).sourceMetadataPatch.customAnswers)
      .toBeUndefined();
  });
});
