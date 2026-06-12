import { schemas } from '../middleware/validation.js';

// The generic validate() middleware does NOT stripUnknown, so any key not in the
// schema 400s. These tests lock in that the quiz funnel fields are accepted while
// true-unknown keys are still rejected and the core required fields stay required.
describe('prospectCreate validation — quiz funnel + UTM', () => {
  const base = { firstName: 'A', email: 'a@b.com', leadSource: 'website' };

  it('accepts quizResult (answers) + utm_* fields', () => {
    const { error } = schemas.prospectCreate.validate({
      ...base,
      quizResult: { quizId: 'protection-personality', version: 2, answers: [{ qid: 'q1_weekend', value: 'cosy' }] },
      utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'q2-quiz', utm_content: 'ad1', utm_term: 'x',
    });
    expect(error).toBeUndefined();
  });

  it('accepts a numeric answer value (future numeric-gap questions)', () => {
    const { error } = schemas.prospectCreate.validate({
      ...base, quizResult: { answers: [{ qid: 'coverage', value: 250000 }] },
    });
    expect(error).toBeUndefined();
  });

  it('rejects unknown keys (no stripUnknown)', () => {
    const { error } = schemas.prospectCreate.validate({ ...base, bogusField: 'x' });
    expect(error).toBeDefined();
  });

  it('still requires firstName, email, leadSource', () => {
    expect(schemas.prospectCreate.validate({ email: 'a@b.com', leadSource: 'website' }).error).toBeDefined();
    expect(schemas.prospectCreate.validate({ firstName: 'A', leadSource: 'website' }).error).toBeDefined();
    expect(schemas.prospectCreate.validate({ firstName: 'A', email: 'a@b.com' }).error).toBeDefined();
  });

  it('caps quiz answers at 50 and requires qid+value on each', () => {
    const answers = Array.from({ length: 51 }, (_, i) => ({ qid: `q${i}`, value: 'v' }));
    expect(schemas.prospectCreate.validate({ ...base, quizResult: { answers } }).error).toBeDefined();
    expect(schemas.prospectCreate.validate({ ...base, quizResult: { answers: [{ value: 'v' }] } }).error).toBeDefined();
  });

  it('campaignCreate + campaignUpdate accept type "quiz"', () => {
    expect(schemas.campaignCreate.validate({ name: 'Q', type: 'quiz' }).error).toBeUndefined();
    expect(schemas.campaignUpdate.validate({ type: 'quiz' }).error).toBeUndefined();
  });

  it('accepts referralRef up to 64 chars, rejects longer', () => {
    expect(
      schemas.prospectCreate.validate({ ...base, referralRef: '5f1e9c1a-2222-4444-8888-aaaaaaaaaaaa' }).error
    ).toBeUndefined();
    expect(schemas.prospectCreate.validate({ ...base, referralRef: 'x'.repeat(64) }).error).toBeUndefined();
    expect(schemas.prospectCreate.validate({ ...base, referralRef: 'x'.repeat(65) }).error).toBeDefined();
  });
});
