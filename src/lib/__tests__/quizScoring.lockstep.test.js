import { describe, it, expect } from 'vitest';
import { scoreQuiz as clientScore } from '../quizScoring.js';
// Import the SERVER scorer directly (it is pure + dependency-free) and assert it
// produces byte-identical output to the client scorer for EVERY possible answer
// combination. This is the lock-step guarantee referenced in the plan + quiz doc.
import { scoreQuiz as serverScore } from '../../../backend/src/services/quizScoringService.js';
import { quizDef, tiebreakCase } from '../../../test-fixtures/protectionPersonalityQuiz.mjs';

// Enumerate every (option per question) combination.
function enumerateAllAnswers(def) {
  const questions = def.steps.flatMap((s) => s.questions);
  const optionIds = questions.map((q) => q.options.map((o) => o.id));
  const total = optionIds.reduce((acc, opts) => acc * opts.length, 1);
  const out = [];
  for (let n = 0; n < total; n++) {
    let x = n;
    const answers = [];
    for (let i = 0; i < questions.length; i++) {
      const opts = optionIds[i];
      answers.push({ qid: questions[i].id, value: opts[x % opts.length] });
      x = Math.floor(x / opts.length);
    }
    out.push(answers);
  }
  return out;
}

describe('quizScoring client/server lock-step', () => {
  it('produces identical results for all 4,096 answer combinations', () => {
    const all = enumerateAllAnswers(quizDef);
    expect(all.length).toBe(4096); // 4 options ^ 6 questions
    for (const answers of all) {
      expect(clientScore(quizDef, answers)).toEqual(serverScore(quizDef, answers));
    }
  });

  it('agree on the tiebreak case under both tiebreak modes', () => {
    const gapDef = { ...quizDef, scoring: { ...quizDef.scoring, tiebreak: 'gap-first' } };
    expect(clientScore(quizDef, tiebreakCase.answers)).toEqual(serverScore(quizDef, tiebreakCase.answers));
    expect(clientScore(gapDef, tiebreakCase.answers)).toEqual(serverScore(gapDef, tiebreakCase.answers));
  });
});
