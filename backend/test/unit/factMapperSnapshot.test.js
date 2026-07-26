import {
  buildFactSnapshot, canonicalJson, sha256, MAPPER_PIPELINE_VERSION,
  flattenQuizQuestions, indexQuizAnswers,
} from '../../src/services/factMapperService.js';

/**
 * The pure half of fact mapper v1.1 (studio-profile-questions §5.1–§5.2):
 * SECTION-KEYED snapshots (present = re-observed, absent = leave alone),
 * the REAL quiz wire shapes (steps[].questions[] + [{qid,value}] — the flat
 * shapes v1 read never occur in production), and canonical hashing. DB
 * paths live in the integration suite.
 */
describe('factMapperService v1.1 (pure)', () => {
  test('pipelineVersion is the composite semantic version (mapper v1.1 + taxonomy v2)', () => {
    expect(MAPPER_PIPELINE_VERSION).toBe('mapper/v1.1+tax-v2');
  });

  describe('canonicalJson', () => {
    test('key-order independent at every depth; array order still data', () => {
      const a = { b: 1, a: { d: [1, 2], c: 'x' } };
      const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(sha256(canonicalJson(a))).toBe(sha256(canonicalJson(b)));
      expect(canonicalJson({ v: [1, 2] })).not.toBe(canonicalJson({ v: [2, 1] }));
    });
  });

  const REAL_QUIZ_DEF = {
    enabled: true,
    steps: [
      {
        id: 's1',
        questions: [
          { qid: 'q1', factKey: 'assets.car_owner', factValues: { yes: { v: true }, no: { v: false } } },
          { qid: 'q2' }, // scoring-only
        ],
      },
      {
        id: 's2',
        questions: [
          { qid: 'q3', factKey: 'finance.annual_income_band', factValues: { a: { v: '<40k' }, b: { v: '40-80k' } } },
        ],
      },
    ],
  };
  const REAL_ANSWERS = [{ qid: 'q1', value: 'yes' }, { qid: 'q2', value: 'x' }, { qid: 'q3', value: 'b' }];

  test('flattenQuizQuestions reads steps[].questions[] (real) and flat questions[] (legacy)', () => {
    expect(flattenQuizQuestions(REAL_QUIZ_DEF).map((q) => q.qid)).toEqual(['q1', 'q2', 'q3']);
    expect(flattenQuizQuestions({ questions: [{ id: 'a' }] })).toHaveLength(1);
    expect(flattenQuizQuestions(null)).toEqual([]);
  });

  test('indexQuizAnswers reads [{qid,value}] (real) and object maps (legacy)', () => {
    expect(indexQuizAnswers(REAL_ANSWERS).get('q3')).toBe('b');
    expect(indexQuizAnswers({ q1: 'yes' }).get('q1')).toBe('yes');
    expect(indexQuizAnswers(undefined).size).toBe(0);
  });

  describe('buildFactSnapshot — section semantics', () => {
    test('form section present whenever demographics observed; facts normalized', () => {
      const { sections } = buildFactSnapshot({ demographics: { dateOfBirth: '1988-06-15', income: '4500' } });
      expect(sections.form.facts).toEqual([
        { key: 'identity.birth_year_band', value: { v: '1985-1989' } },
        { key: 'finance.income_band', value: { v: '3-6k' } },
      ]);
      expect(sections.quiz).toBeUndefined();
      expect(sections.profile).toBeUndefined();
    });

    test('empty demographics still re-observes the form artifact (cleared DOB must supersede)', () => {
      const { sections } = buildFactSnapshot({ demographics: {} });
      expect(sections.form).toEqual({ facts: [] });
    });

    test('no demographics object ⇒ form section ABSENT (edit choke: leave alone)', () => {
      expect(buildFactSnapshot({}).sections.form).toBeUndefined();
    });

    test('income bands map at the boundaries; garbage never mints', () => {
      const band = (income) => buildFactSnapshot({ demographics: { income } }).sections.form.facts
        .find((f) => f.key === 'finance.income_band')?.value?.v;
      expect(band('2999')).toBe('<3k');
      expect(band('3000')).toBe('3-6k');
      expect(band('$12,000')).toBe('10-15k');
      expect(band('15000')).toBe('>15k');
      expect(band('a lot')).toBeUndefined();
      expect(band('-5')).toBeUndefined();
    });

    test('server-scored REAL quiz submissions map through steps + qid answers', () => {
      const { sections } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'server', answers: REAL_ANSWERS } },
        quizDefinition: REAL_QUIZ_DEF,
      });
      expect(sections.quiz.facts).toEqual([
        { key: 'assets.car_owner', value: { v: true } },
        { key: 'finance.annual_income_band', value: { v: '40-80k' } },
      ]);
    });

    test('client-unverified quiz answers NEVER map (Codex R1 #12)', () => {
      const { sections } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'client-unverified', answers: REAL_ANSWERS } },
        quizDefinition: REAL_QUIZ_DEF,
      });
      expect(sections.quiz).toBeUndefined();
    });

    test('invalid factKey mappings are skipped; valid siblings survive', () => {
      const { sections } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'server', answers: [{ qid: 'q1', value: 'yes' }, { qid: 'qBad', value: 'x' }] } },
        quizDefinition: {
          enabled: true,
          steps: [{
            questions: [
              { qid: 'q1', factKey: 'assets.car_owner', factValues: { yes: { v: true } } },
              { qid: 'qBad', factKey: 'identity.shoe_size', factValues: { x: { v: 42 } } },
            ],
          }],
        },
      });
      expect(sections.quiz.facts).toEqual([{ key: 'assets.car_owner', value: { v: true } }]);
    });

    test('profile section from pre-resolved capture facts; invalid dropped', () => {
      const { sections } = buildFactSnapshot({
        profileFacts: [
          { key: 'identity.preferred_language', value: { v: 'zh' } },
          { key: 'identity.shoe_size', value: { v: 42 } },
        ],
      });
      expect(sections.profile.facts).toEqual([
        { key: 'identity.preferred_language', value: { v: 'zh' } },
      ]);
    });

    test('snapshot carries ONLY taxonomy facts — no contact data, ever', () => {
      const snapshot = buildFactSnapshot({
        demographics: { dateOfBirth: '1990-01-01' },
        sourceMetadata: { quiz: { scoredBy: 'server', answers: [] }, referral: { code: 'x' } },
        quizDefinition: REAL_QUIZ_DEF,
      });
      const json = canonicalJson(snapshot);
      expect(Object.keys(snapshot)).toEqual(['sections']);
      expect(json).not.toMatch(/phone|email|firstName|lastName|referral/i);
    });
  });
});
