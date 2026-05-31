/**
 * quizAnalyticsService — campaign-level quiz results, aggregated from the quiz
 * blobs already stored on submitted prospects (Prospect.sourceMetadata.quiz).
 *
 * No new table / migration: this is the SUBMITTED-leads view (profile mix,
 * Hot/Warm/Cool lead-score mix, server-vs-client scoring). The upper-funnel
 * drop-off view (starts / per-step abandonment) needs a funnel-event log and is
 * a deferred follow-up.
 *
 * `aggregateQuizResults` is pure (unit-tested without a DB). `loadQuizAnalytics`
 * is the thin IO wrapper; it lazy-imports models so importing the pure function
 * never loads the (in-flux) model graph.
 */

/**
 * Aggregate quiz outcomes over a set of prospects.
 * @param {Array<{ sourceMetadata?: object }>} prospects
 * @returns {{ total: number, byProfile: Record<string,number>, byBand: Record<string,number>, byScoredBy: Record<string,number> }}
 *          total = prospects that carry a quiz result.
 */
export function aggregateQuizResults(prospects) {
  let total = 0;
  const byProfile = {};
  const byBand = {};
  const byScoredBy = {};

  for (const p of prospects || []) {
    const quiz = p && p.sourceMetadata && p.sourceMetadata.quiz;
    if (!quiz || typeof quiz !== 'object') continue;
    total += 1;

    const profileId = (quiz.result && quiz.result.profileId) || 'unknown';
    byProfile[profileId] = (byProfile[profileId] || 0) + 1;

    const band = (quiz.leadScore && quiz.leadScore.band) || 'unscored';
    byBand[band] = (byBand[band] || 0) + 1;

    const scoredBy = quiz.scoredBy || 'unknown';
    byScoredBy[scoredBy] = (byScoredBy[scoredBy] || 0) + 1;
  }

  return { total, byProfile, byBand, byScoredBy };
}

/**
 * Load + aggregate quiz analytics for a campaign. Read-only over existing
 * prospects. Returns { found:false } for an unknown campaign.
 */
export async function loadQuizAnalytics(campaignId) {
  const { Campaign, Prospect } = await import('../models/index.js');

  const campaign = await Campaign.findByPk(campaignId, { attributes: ['id', 'name', 'type'] });
  if (!campaign) {
    return { found: false, total: 0, byProfile: {}, byBand: {}, byScoredBy: {} };
  }

  const prospects = await Prospect.findAll({
    where: { campaignId },
    attributes: ['sourceMetadata'],
  });

  const agg = aggregateQuizResults(prospects);
  return { found: true, campaignId: campaign.id, name: campaign.name, type: campaign.type, ...agg };
}
