/**
 * The SCORE stage of lead capture (P3-1) — what the submission itself says
 * about this person, recomputed on the server.
 *
 * Two jobs that share one rule: never let a bad answer cost a lead.
 *
 *  - Quiz re-scoring. The client sends raw answers plus an advisory result we
 *    ignore, and we recompute the authoritative profile/readiness/leadScore from
 *    the campaign's own quiz definition, so a tampered client cannot fake one.
 *  - Profile questions. Iterate the CAMPAIGN'S configured question ids — never
 *    attacker-supplied keys — resolve and re-validate each server-side, and keep
 *    only canonical accepted ids.
 *
 * Lifted verbatim out of createProspect, with one deliberate change: the stage
 * used to reach out and mutate `incoming.sourceMetadata` twice through the
 * closure. It now returns a patch and the caller merges it, so what this stage
 * writes is visible at the call site instead of being a side effect.
 */
import { scoreQuiz } from './quizScoringService.js';
import { getProfileQuestion, resolveAnswer as resolveProfileAnswer } from '../utils/profileQuestionLibrary.js';
import { validateFact } from '../utils/factTaxonomy.js';
import { isV2 as isV2DesignConfig } from '../utils/designConfigV2.js';

/**
 * @param {object} args
 * @param {object} args.d Injected dependencies (the prospectService `d` object).
 */
export function makeScoringStage({ d }) {
  /**
   * @param {object} ctx
   * @param {object|null} ctx.quizSubmission Raw `quizResult` from the body.
   * @param {object} ctx.safeBody The request body (for `profileAnswers`).
   * @param {object|null} ctx.sourceCampaign Carries the quiz + profileQuestions config.
   * @param {string|null} ctx.campaignId For the drop/ignore log lines.
   * @returns {{ sourceMetadataPatch: object, acceptedProfileFacts: Array<{key: string, value: any}> }}
   */
  return function scoreSubmission({ quizSubmission, safeBody, sourceCampaign, campaignId }) {
    const sourceMetadataPatch = {};

    // --- Quiz funnel: re-score server-side (anti-tamper) and stash on the lead ---
    // The client sends raw answers (+ an advisory result we ignore). We recompute
    // the authoritative profile/readiness/leadScore from the campaign's own quiz
    // definition so a tampered client cannot fake a result. Stored under
    // sourceMetadata.quiz; forwarded verbatim to Lyfe in the lead.created webhook.
    if (quizSubmission && Array.isArray(quizSubmission.answers) && quizSubmission.answers.length > 0) {
      const quizDef = sourceCampaign?.design_config?.quiz;
      let quizMeta;
      if (quizDef && quizDef.enabled) {
        let scored = null;
        try {
          scored = scoreQuiz(quizDef, quizSubmission.answers);
        } catch (err) {
          d.logger.error('[Quiz] scoring failed', { error: err?.message || String(err) });
        }
        quizMeta = {
          quizId: quizDef.quizId || quizSubmission.quizId || null,
          version: quizDef.version ?? quizSubmission.version ?? null,
          answers: quizSubmission.answers,
          result: scored
            ? { profileId: scored.profileId, title: scored.title, readiness: scored.readiness, agentAngle: scored.agentAngle }
            : (quizSubmission.result || null),
          leadScore: scored?.leadScore || null,
          scoredBy: scored ? 'server' : 'client-unverified',
        };
      } else {
        // No quiz definition on the campaign (or disabled): keep the raw answers
        // and the advisory client result, clearly marked unverified.
        quizMeta = {
          quizId: quizSubmission.quizId || null,
          version: quizSubmission.version ?? null,
          answers: quizSubmission.answers,
          result: quizSubmission.result || null,
          scoredBy: 'client-unverified',
        };
      }
      sourceMetadataPatch.quiz = quizMeta;
    }

    // --- Enrichment profile questions (studio-profile-questions §5.4) ---
    // Three-leg eligibility gate, ALL legs or the whole object is ignored
    // (Codex PR0 R2 #3 — backend eligibility must equal rendering
    // eligibility): raw config is v2 AND profileQuestions.enabled AND not
    // guided_review. Then iterate the CAMPAIGN'S configured question ids
    // (never attacker keys), resolve server-side, re-validate, and stash
    // only canonical accepted answer ids (erasure's sourceMetadata rebuild
    // removes them). A bad answer never costs a lead.
    let acceptedProfileFacts = [];
    {
      const rawAnswers = safeBody.profileAnswers;
      const dcRaw = sourceCampaign?.design_config;
      const pq = dcRaw?.profileQuestions;
      const eligible = rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
        && isV2DesignConfig(dcRaw)
        && pq?.enabled === true
        && dcRaw?.template?.id !== 'guided_review'
        && Array.isArray(pq?.questionIds);
      if (eligible) {
        const acceptedIds = {};
        const dropped = [];
        for (const qid of pq.questionIds) {
          const q = getProfileQuestion(qid);
          if (!q) continue;
          const provided = rawAnswers[qid];
          if (provided === undefined || provided === null || provided === '') continue;
          const value = resolveProfileAnswer(qid, provided);
          if (!value || !validateFact(q.factKey, value).ok) {
            dropped.push(qid);
            continue;
          }
          acceptedProfileFacts.push({ key: q.factKey, value });
          acceptedIds[qid] = provided;
        }
        if (dropped.length) {
          d.logger.warn('[enrichment] profile answers dropped (invalid)', {
            campaignId, dropped,
          });
        }
        if (Object.keys(acceptedIds).length) {
          sourceMetadataPatch.profileAnswers = acceptedIds;
        }
      } else if (rawAnswers && typeof rawAnswers === 'object' && Object.keys(rawAnswers).length) {
        d.logger.warn('[enrichment] profile answers ignored (campaign not eligible)', {
          campaignId,
        });
      }
    }

    return { sourceMetadataPatch, acceptedProfileFacts };
  };
}
