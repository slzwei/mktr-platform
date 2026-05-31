/**
 * quizScoring — client-side quiz scorer (instant result reveal).
 *
 * This is the TWIN of `backend/src/services/quizScoringService.js`. The two MUST
 * stay identical in logic; a lock-step test (src/lib/__tests__/quizScoring.lockstep.test.js)
 * imports both and asserts byte-identical output across every answer combination.
 * The server re-scores authoritatively on submit; this exists only for the reveal UI.
 *
 * Canonical algorithm: docs/quiz-protection-personality.md §3.
 * Rounding is Math.round (round-half-up for non-negative readiness) so client and
 * server agree exactly. Do not switch to banker's rounding.
 */

/** Persona with the highest score in an option; ties broken by `order`. */
function argmaxPersona(scores, order) {
  let best = -Infinity;
  let chosen = null;
  for (const pid of order) {
    const v = scores[pid];
    if (typeof v === 'number' && v > best) { best = v; chosen = pid; }
  }
  // Defensive: personas present in scores but absent from `order`.
  for (const pid of Object.keys(scores)) {
    if (!order.includes(pid)) {
      const v = scores[pid];
      if (typeof v === 'number' && v > best) { best = v; chosen = pid; }
    }
  }
  return chosen;
}

/** First band whose threshold matches `points`; a band with no gte/lte is the default. */
function pickBand(bands, points) {
  for (const b of bands) {
    if (b.gte == null && b.lte == null) return b;
    if (b.gte != null && points >= b.gte) return b;
    if (b.lte != null && points <= b.lte) return b;
  }
  return null;
}

/**
 * Score a completed quiz.
 * @param {object} quizDef - campaign.design_config.quiz
 * @param {Array<{qid:string,value:string}>} answers
 * @returns {null | {profileId, title, agentAngle, score, totals, readiness, leadScore}}
 */
export function scoreQuiz(quizDef, answers) {
  if (!quizDef || !Array.isArray(quizDef.steps)) return null;
  if (!Array.isArray(answers) || answers.length === 0) return null;

  const scoring = quizDef.scoring || {};
  const method = scoring.method || 'profile-sum';
  if (method !== 'profile-sum') {
    throw new Error(`quizScoring: scoring.method "${method}" is not implemented (only "profile-sum")`);
  }

  const questions = [];
  for (const step of quizDef.steps) {
    for (const q of (step.questions || [])) questions.push(q);
  }
  const qById = new Map(questions.map((q) => [q.id, q]));

  const profiles = Array.isArray(quizDef.resultProfiles) ? quizDef.resultProfiles : [];
  const baseOrder = (Array.isArray(scoring.profileOrder) && scoring.profileOrder.length)
    ? scoring.profileOrder.slice()
    : profiles.map((p) => p.id);
  const winnerOrder = scoring.tiebreak === 'gap-first' ? baseOrder.slice().reverse() : baseOrder.slice();

  const totals = {};
  for (const pid of baseOrder) totals[pid] = 0;

  const readinessCfg = scoring.readiness;
  const rankFactor = (readinessCfg && readinessCfg.rankFactor) || {};
  let readinessNum = 0;
  let weightSum = 0;

  const leadCfg = scoring.leadScore;
  const tagPoints = (leadCfg && leadCfg.tagPoints) || {};
  let leadPoints = 0;
  let sawTag = false;

  for (const ans of answers) {
    if (!ans || typeof ans.qid !== 'string') continue;
    const q = qById.get(ans.qid);
    if (!q) continue;
    const weight = typeof q.weight === 'number' ? q.weight : 1;
    const opts = Array.isArray(q.options) ? q.options : [];
    const opt = opts.find((o) => o.id === ans.value);
    if (!opt) continue;
    const scores = opt.scores || {};

    for (const pid of Object.keys(scores)) {
      const n = scores[pid];
      if (typeof n !== 'number') continue;
      if (!(pid in totals)) totals[pid] = 0;
      totals[pid] += weight * n;
    }

    if (readinessCfg && readinessCfg.enabled) {
      const chosen = argmaxPersona(scores, baseOrder);
      if (chosen != null && typeof rankFactor[chosen] === 'number') {
        readinessNum += weight * rankFactor[chosen];
      }
      weightSum += weight;
    }

    if (leadCfg && leadCfg.enabled && opt.tag) {
      sawTag = true;
      const pts = tagPoints[opt.tag];
      if (typeof pts === 'number') leadPoints += pts;
    }
  }

  let best = -Infinity;
  let winner = null;
  for (const pid of winnerOrder) {
    if (totals[pid] > best) { best = totals[pid]; winner = pid; }
  }

  let readiness = null;
  if (readinessCfg && readinessCfg.enabled && weightSum > 0) {
    readiness = Math.round((100 * readinessNum) / weightSum);
  }

  let leadScore = null;
  if (leadCfg && leadCfg.enabled && sawTag) {
    const band = pickBand(Array.isArray(leadCfg.bands) ? leadCfg.bands : [], leadPoints);
    leadScore = { points: leadPoints, band: band ? band.label : null, badge: band ? band.badge : null };
  }

  const profile = profiles.find((p) => p.id === winner) || null;
  return {
    profileId: winner,
    title: profile ? (profile.title || null) : null,
    agentAngle: profile ? (profile.agentAngle || null) : null,
    score: best === -Infinity ? 0 : best,
    totals,
    readiness,
    leadScore,
  };
}

export default scoreQuiz;
