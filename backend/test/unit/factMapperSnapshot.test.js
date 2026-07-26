import { buildFactSnapshot, canonicalJson, sha256, MAPPER_PIPELINE_VERSION } from '../../src/services/factMapperService.js';

/**
 * The pure half of the fact mapper (consumer-profile-enrichment plan §5):
 * snapshot building (normalized-at-enqueue, minimized) and canonical
 * hashing. DB paths (outbox, drain, activation) live in the integration
 * suite.
 */
describe('factMapperService (pure)', () => {
  test('pipelineVersion is the composite semantic version (R3 #6)', () => {
    expect(MAPPER_PIPELINE_VERSION).toBe('mapper/v1+tax-v1');
  });

  describe('canonicalJson', () => {
    test('is key-order independent at every depth', () => {
      const a = { b: 1, a: { d: [1, 2], c: 'x' } };
      const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(sha256(canonicalJson(a))).toBe(sha256(canonicalJson(b)));
    });

    test('array order still matters (arrays are data, not sets)', () => {
      expect(canonicalJson({ v: [1, 2] })).not.toBe(canonicalJson({ v: [2, 1] }));
    });
  });

  describe('buildFactSnapshot', () => {
    test('demographics.dateOfBirth → identity.birth_year_band as a form fact', () => {
      const { facts } = buildFactSnapshot({ demographics: { dateOfBirth: '1988-06-15', age: 38 } });
      expect(facts).toEqual([
        { key: 'identity.birth_year_band', value: { v: '1985-1989' }, artifact: 'form' },
      ]);
    });

    test('no demographics → empty snapshot (nothing invented)', () => {
      expect(buildFactSnapshot({}).facts).toEqual([]);
      expect(buildFactSnapshot({ demographics: { age: 38 } }).facts).toEqual([]);
      expect(buildFactSnapshot({ demographics: { dateOfBirth: 'not-a-date' } }).facts).toEqual([]);
    });

    const quizDefinition = {
      enabled: true,
      questions: [
        {
          id: 'q1',
          factKey: 'assets.car_owner',
          factValues: { yes: { v: true }, no: { v: false } },
        },
        {
          id: 'q2',
          factKey: 'finance.annual_income_band',
          factValues: { a: { v: '<40k' }, b: { v: '40-80k' } },
        },
        { id: 'q3' }, // no factKey — scoring-only question
      ],
    };

    test('server-scored quiz answers map through factKey/factValues', () => {
      const { facts } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'server', answers: { q1: 'yes', q2: 'b', q3: 'whatever' } } },
        quizDefinition,
      });
      expect(facts).toEqual([
        { key: 'assets.car_owner', value: { v: true }, artifact: 'quiz' },
        { key: 'finance.annual_income_band', value: { v: '40-80k' }, artifact: 'quiz' },
      ]);
    });

    test('client-unverified quiz answers NEVER map (Codex R1 #12)', () => {
      const { facts } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'client-unverified', answers: { q1: 'yes' } } },
        quizDefinition,
      });
      expect(facts).toEqual([]);
    });

    test('invalid factKey mappings are skipped, valid siblings survive', () => {
      const { facts } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'server', answers: { q1: 'yes', qBad: 'x' } } },
        quizDefinition: {
          questions: [
            { id: 'q1', factKey: 'assets.car_owner', factValues: { yes: { v: true } } },
            { id: 'qBad', factKey: 'identity.shoe_size', factValues: { x: { v: 42 } } },
          ],
        },
      });
      expect(facts).toEqual([{ key: 'assets.car_owner', value: { v: true }, artifact: 'quiz' }]);
    });

    test('unanswered factKey questions contribute nothing', () => {
      const { facts } = buildFactSnapshot({
        sourceMetadata: { quiz: { scoredBy: 'server', answers: {} } },
        quizDefinition,
      });
      expect(facts).toEqual([]);
    });

    test('snapshot carries ONLY taxonomy facts — no contact data, ever', () => {
      const snapshot = buildFactSnapshot({
        demographics: { dateOfBirth: '1990-01-01' },
        sourceMetadata: { quiz: { scoredBy: 'server', answers: {} }, referral: { code: 'x' } },
      });
      const json = canonicalJson(snapshot);
      expect(Object.keys(snapshot)).toEqual(['facts']);
      expect(json).not.toMatch(/phone|email|firstName|lastName|referral/i);
    });
  });
});
