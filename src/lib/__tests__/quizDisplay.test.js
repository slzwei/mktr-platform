import { describe, it, expect } from 'vitest';
import { extractQuizSummary, prettyQid } from '../quizDisplay';

describe('extractQuizSummary', () => {
  it('returns null when there is no quiz blob', () => {
    expect(extractQuizSummary(null)).toBeNull();
    expect(extractQuizSummary(undefined)).toBeNull();
    expect(extractQuizSummary({})).toBeNull();
    expect(extractQuizSummary({ quiz: null })).toBeNull();
  });

  it('flattens a server-scored quiz blob', () => {
    const sm = {
      quiz: {
        quizId: 'protection-personality',
        version: 2,
        scoredBy: 'server',
        result: { profileId: 'the-rock', title: 'The Rock', readiness: 67, agentAngle: 'optimise / legacy' },
        leadScore: { points: 8, band: 'Hot', badge: '🔥' },
        answers: [{ qid: 'q3_circle', value: 'family', tag: 'family-dependents' }],
      },
    };
    const s = extractQuizSummary(sm);
    expect(s.quizId).toBe('protection-personality');
    expect(s.version).toBe(2);
    expect(s.profileId).toBe('the-rock');
    expect(s.title).toBe('The Rock');
    expect(s.readiness).toBe(67);
    expect(s.agentAngle).toBe('optimise / legacy');
    expect(s.leadScore).toEqual({ points: 8, band: 'Hot', badge: '🔥' });
    expect(s.answers).toHaveLength(1);
    expect(s.verified).toBe(true);
  });

  it('marks client-unverified results and tolerates a missing leadScore', () => {
    const s = extractQuizSummary({ quiz: { scoredBy: 'client-unverified', result: { profileId: 'x' }, answers: [] } });
    expect(s.verified).toBe(false);
    expect(s.leadScore).toBeNull();
    expect(s.readiness).toBeNull();
    expect(s.title).toBeNull();
  });
});

describe('prettyQid', () => {
  it('strips the q#_ prefix and tidies separators', () => {
    expect(prettyQid('q3_circle')).toBe('circle');
    expect(prettyQid('q5_protected')).toBe('protected');
    expect(prettyQid('q1_weekend')).toBe('weekend');
  });
  it('falls back gracefully', () => {
    expect(prettyQid('')).toBe('Answer');
    expect(prettyQid(null)).toBe('Answer');
  });
});
