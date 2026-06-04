import { aggregateQuizResults } from '../services/quizAnalyticsService.js';

const mk = (profileId, band, scoredBy) => ({
  sourceMetadata: { quiz: { result: { profileId }, leadScore: band ? { band } : undefined, scoredBy } },
});

describe('quizAnalyticsService.aggregateQuizResults', () => {
  it('returns zeros for empty / nullish input', () => {
    const empty = { total: 0, byProfile: {}, byBand: {}, byScoredBy: {} };
    expect(aggregateQuizResults([])).toEqual(empty);
    expect(aggregateQuizResults(null)).toEqual(empty);
  });

  it('ignores prospects without a quiz blob', () => {
    const r = aggregateQuizResults([{ sourceMetadata: {} }, { sourceMetadata: null }, {}, { sourceMetadata: { quiz: null } }]);
    expect(r.total).toBe(0);
  });

  it('counts profiles, lead-score bands and scoredBy', () => {
    const r = aggregateQuizResults([
      mk('the-rock', 'Hot', 'server'),
      mk('the-rock', 'Warm', 'server'),
      mk('the-free-spirit', 'Cool', 'server'),
      // missing profileId + missing leadScore (e.g. client-unverified, no quiz def)
      { sourceMetadata: { quiz: { result: {}, scoredBy: 'client-unverified' } } },
    ]);
    expect(r.total).toBe(4);
    expect(r.byProfile).toEqual({ 'the-rock': 2, 'the-free-spirit': 1, unknown: 1 });
    expect(r.byBand).toEqual({ Hot: 1, Warm: 1, Cool: 1, unscored: 1 });
    expect(r.byScoredBy).toEqual({ server: 3, 'client-unverified': 1 });
  });
});
