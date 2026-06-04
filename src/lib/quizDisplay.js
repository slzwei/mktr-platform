/**
 * quizDisplay — pure helpers for surfacing a lead's quiz result in the UI.
 *
 * Reads the `quiz` blob the backend stores on Prospect.sourceMetadata
 * (see prospectService.createProspect + quizScoringService). Pure + dependency-
 * free so it unit-tests trivially and is reused by the prospect detail card and
 * any future list badge.
 */

/**
 * Flatten sourceMetadata.quiz into a display-ready summary.
 * @param {object|null|undefined} sourceMetadata - Prospect.sourceMetadata
 * @returns {null | {
 *   quizId: string|null, version: number|null,
 *   profileId: string|null, title: string|null,
 *   readiness: number|null, agentAngle: string|null,
 *   leadScore: { points: number|null, band: string|null, badge: string|null } | null,
 *   answers: Array<{ qid: string, value: any, tag?: string }>,
 *   scoredBy: string|null, verified: boolean
 * }}
 */
export function extractQuizSummary(sourceMetadata) {
  const quiz = sourceMetadata && sourceMetadata.quiz;
  if (!quiz || typeof quiz !== 'object') return null;

  const result = quiz.result || {};
  const ls = quiz.leadScore || null;

  return {
    quizId: quiz.quizId || null,
    version: typeof quiz.version === 'number' ? quiz.version : null,
    profileId: result.profileId || null,
    title: result.title || null,
    readiness: typeof result.readiness === 'number' ? result.readiness : null,
    agentAngle: result.agentAngle || null,
    leadScore: ls
      ? {
          points: typeof ls.points === 'number' ? ls.points : null,
          band: ls.band || null,
          badge: ls.badge || null,
        }
      : null,
    answers: Array.isArray(quiz.answers) ? quiz.answers : [],
    scoredBy: quiz.scoredBy || null,
    verified: quiz.scoredBy === 'server',
  };
}

/** Human-ish label for a question id, e.g. "q3_circle" → "circle". */
export function prettyQid(qid) {
  if (!qid || typeof qid !== 'string') return 'Answer';
  return qid.replace(/^q\d+[_-]?/, '').replace(/[_-]+/g, ' ').trim() || qid;
}
