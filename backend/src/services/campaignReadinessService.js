/**
 * campaignReadinessService — pre-launch "will this campaign actually deliver
 * leads?" check for the admin (Phase 3 of the quiz campaign work).
 *
 * The #1 go-live risk: a lead-capture / quiz campaign launched with NO agent
 * lead-package pool routes every lead to the phone-less System Agent, which the
 * Lyfe edge function rejects (422) — leads are silently lost. This surfaces that
 * (and a disabled webhook / phone-less agents) BEFORE ad spend starts.
 *
 * `computeReadiness` is pure + dependency-free (no model imports) so it unit-tests
 * without a DB and stays decoupled from the (currently in-flux) models layer.
 * `loadCampaignReadiness` is the thin IO wrapper; it lazy-imports models so that
 * importing this module for the pure function never loads the model graph.
 *
 * NOTE: readiness mirrors the LIVE assignment path
 * (systemAgent.resolveAssignedAgentId step 4 — internal lead-package pool). The
 * cross-pool external-buyer resolver (resolveLeadAssignment) is additive and not
 * yet wired into the live capture path; when it is, extend the pool query here.
 */

/**
 * Pure readiness evaluation.
 * @param {object} facts
 * @param {string}  facts.type            campaign.type
 * @param {boolean} facts.isActive
 * @param {boolean} facts.isQuiz
 * @param {boolean} facts.quizEnabled     design_config.quiz.enabled
 * @param {boolean} facts.isGuidedReview
 * @param {boolean} facts.guidedReviewConfigured
 * @param {number}  facts.guidedReviewQuestions
 * @param {boolean} facts.guidedReviewQualificationEnabled
 * @param {boolean} facts.guidedReviewRewardConfigured
 * @param {number}  facts.assignableAgents      active agents with credits for this campaign
 * @param {number}  facts.agentsMissingPhone    of those, how many lack a phone
 * @param {boolean} facts.webhookEnabled         WEBHOOK_ENABLED === 'true'
 * @returns {{ applicable: boolean, ready: boolean, issues: Array<{level,code,message}> }}
 */
export function computeReadiness(facts) {
  const {
    type,
    isActive = false,
    isQuiz = false,
    quizEnabled = false,
    isGuidedReview = false,
    guidedReviewConfigured = false,
    guidedReviewQuestions = 0,
    guidedReviewQualificationEnabled = false,
    guidedReviewRewardConfigured = false,
    assignableAgents = 0,
    agentsMissingPhone = 0,
    webhookEnabled = false,
  } = facts || {};

  // Brand-awareness (PHV tablet) campaigns don't capture leads → readiness N/A.
  if (type === 'brand_awareness') {
    return { applicable: false, ready: true, issues: [] };
  }

  const issues = [];

  // CRITICAL — empty pool → System Agent → lost at Lyfe (422). The whole point.
  if (assignableAgents === 0) {
    issues.push({
      level: 'critical',
      code: 'no_agent_pool',
      message:
        'No agent has an active lead package for this campaign. Leads will route to the System Agent and will NOT be delivered. Assign a lead package to at least one active agent before launching.',
    });
  }

  // CRITICAL — webhook off → nothing reaches the Lyfe app at all.
  if (!webhookEnabled) {
    issues.push({
      level: 'critical',
      code: 'webhook_disabled',
      message:
        'Lead delivery is turned off on the server (WEBHOOK_ENABLED is not "true"). Leads will be created but not pushed to the Lyfe app.',
    });
  }

  // WARNING — lead.created matches the agent by phone; a phone-less pool agent
  // can still fail delivery even though they "exist".
  if (assignableAgents > 0 && agentsMissingPhone > 0) {
    issues.push({
      level: 'warning',
      code: 'agents_missing_phone',
      message: `${agentsMissingPhone} of ${assignableAgents} assignable agent(s) have no phone number — leads routed to them may not be delivered (matched by phone). Re-sync agents to fill phones.`,
    });
  }

  // WARNING — quiz campaign whose quiz isn't enabled: the funnel falls back to a
  // bare form (no quiz), which is probably not what the operator intended.
  if (isQuiz && !quizEnabled) {
    issues.push({
      level: 'warning',
      code: 'quiz_not_enabled',
      message:
        'This is a quiz campaign but the quiz is not enabled (Designer → Quiz tab). The page will show the lead form without the quiz.',
    });
  }

  // Guided Review is an intent-led funnel, not simply a longer landing page.
  // Its qualification step and reward contract are mandatory launch inputs.
  if (isGuidedReview && !guidedReviewConfigured) {
    issues.push({
      level: 'critical',
      code: 'guided_review_not_configured',
      message: 'The Guided Review page has not been saved yet. Open the Designer, choose a template, confirm the page details and save before launching.',
    });
  }

  if (isGuidedReview && guidedReviewConfigured && (guidedReviewQuestions < 1 || !guidedReviewQualificationEnabled)) {
    issues.push({
      level: 'critical',
      code: 'guided_review_qualification_missing',
      message: 'Guided Review needs at least one valid qualification question and its generated qualification flow before it can launch.',
    });
  }

  if (isGuidedReview && guidedReviewConfigured && !guidedReviewRewardConfigured) {
    issues.push({
      level: 'critical',
      code: 'guided_review_reward_missing',
      message: 'Guided Review needs at least one reward with a name, eligibility event and positive allocation before it can launch.',
    });
  }

  // INFO — not yet live.
  if (!isActive) {
    issues.push({
      level: 'info',
      code: 'not_active',
      message: 'Campaign is not active yet — activate it when you are ready to receive leads.',
    });
  }

  const ready = !issues.some((i) => i.level === 'critical');
  return { applicable: true, ready, issues };
}

/**
 * Load the facts for a campaign and evaluate readiness.
 * Read-only. Lazy-imports models so the pure export above stays import-light.
 */
export async function loadCampaignReadiness(campaignId) {
  const { Campaign, LeadPackage, LeadPackageAssignment, User } = await import('../models/index.js');
  const { Op } = await import('sequelize');

  const campaign = await Campaign.findByPk(campaignId, {
    attributes: ['id', 'name', 'type', 'is_active', 'design_config'],
  });
  if (!campaign) {
    return {
      found: false,
      applicable: false,
      ready: false,
      issues: [{ level: 'critical', code: 'not_found', message: 'Campaign not found.' }],
    };
  }

  // Internal lead-package pool — same shape as systemAgent.resolveAssignedAgentId
  // step 4: active assignment + leadsRemaining > 0 + package.campaignId, then
  // restricted to active role:'agent' users.
  const assignments = await LeadPackageAssignment.findAll({
    where: { status: 'active', leadsRemaining: { [Op.gt]: 0 } },
    include: [{ model: LeadPackage, as: 'package', where: { campaignId }, required: true, attributes: [] }],
    attributes: ['agentId'],
  });
  const candidateIds = [...new Set(assignments.map((a) => a.agentId))];

  let assignableAgents = 0;
  let agentsMissingPhone = 0;
  if (candidateIds.length > 0) {
    const agents = await User.findAll({
      where: { id: candidateIds, role: 'agent', isActive: true },
      attributes: ['id', 'phone'],
    });
    assignableAgents = agents.length;
    agentsMissingPhone = agents.filter((a) => !a.phone || String(a.phone).trim() === '').length;
  }

  const design = campaign.design_config || {};
  const guidedReview = design.guidedReview;
  const guidedReviewQuestions = Array.isArray(guidedReview?.questions?.items)
    ? guidedReview.questions.items.filter((question) => (
      question?.prompt
      && Array.isArray(question.options)
      && question.options.filter(Boolean).length > 0
    )).length
    : 0;
  const guidedReviewRewardConfigured = ['grand', 'attendance'].some((key) => {
    const reward = guidedReview?.rewards?.[key];
    return !!(
      reward?.title
      && (reward.conditionKey || reward.condition)
      && Number(reward.quantity) > 0
    );
  });
  const webhookEnabled = process.env.WEBHOOK_ENABLED === 'true';
  const isActive = campaign.is_active !== false;

  const evaluation = computeReadiness({
    type: campaign.type,
    isActive,
    isQuiz: campaign.type === 'quiz',
    quizEnabled: !!(design.quiz && design.quiz.enabled),
    isGuidedReview: campaign.type === 'guided_review',
    guidedReviewConfigured: !!(guidedReview && typeof guidedReview === 'object'),
    guidedReviewQuestions,
    guidedReviewQualificationEnabled: !!(
      design.quiz?.enabled
      && design.quiz?.mode === 'qualification'
    ),
    guidedReviewRewardConfigured,
    assignableAgents,
    agentsMissingPhone,
    webhookEnabled,
  });

  return {
    found: true,
    campaignId: campaign.id,
    name: campaign.name,
    type: campaign.type,
    isActive,
    assignableAgents,
    agentsMissingPhone,
    webhookEnabled,
    ...evaluation,
  };
}
