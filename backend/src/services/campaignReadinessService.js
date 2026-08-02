/**
 * campaignReadinessService — pre-launch "will this campaign actually deliver
 * leads?" check for the admin (Phase 3 of the quiz campaign work).
 *
 * The #1 go-live risk: a lead-capture / quiz campaign launched with NO agent
 * lead-package pool routes every lead to the phone-less System Agent — leads
 * are captured but undelivered (recoverable via admin reassign). This surfaces
 * that (and a disabled webhook / phone-less agents) BEFORE ad spend starts.
 * Since 2026-07-18 the empty pool is a WARNING, not a blocker — reward-only
 * and test campaigns launch without a funded pool by design; the hard blocks
 * are the states where capture itself breaks (webhook off, OTP unconfigured).
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
 * @param {string}  facts.verificationChannel    effective OTP channel ('sms'|'whatsapp') — mirrors the send path
 * @param {boolean} facts.smsOtpConfigured       AWS SNS creds present (the SMS send path)
 * @param {boolean} facts.whatsappOtpConfigured  Meta WA creds present (the WhatsApp send path)
 * @param {boolean} facts.drawEnabled            stored doc luckyDraw.enabled (version-aware)
 * @param {boolean} facts.hasDrawRecord          ANY draw record exists (live or completed)
 * @param {boolean} facts.hasLiveDraw            a LIVE (open|frozen|sealed|drawn) record exists
 * @param {boolean} facts.drawIntakeOpen         doc closesAt is today-or-future (entries still accepted)
 * @param {boolean} facts.drawCloseMismatch      LIVE record cutoff ≠ doc closesAt (instant-exact)
 * @param {string}  facts.docDrawClosesAt        display YMD (doc)
 * @param {string}  facts.drawRecordClosesAt     display YMD (record, SGT)
 * @param {number}  facts.drawTotalPrizes        Σqty of structured luckyDraw.prizes (0 = unstructured)
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
    // OTP facts default ALARM-SAFE (like webhookEnabled): absent facts read as
    // "cannot send", never as "fine".
    verificationChannel = 'sms',
    smsOtpConfigured = false,
    whatsappOtpConfigured = false,
    // Draw facts default SILENT — they only mean anything for draw campaigns.
    drawEnabled = false,
    hasDrawRecord = false,
    hasLiveDraw = false,
    drawIntakeOpen = false,
    drawClosesPastDue = false,
    drawCloseMismatch = false,
    docDrawClosesAt = null,
    drawRecordClosesAt = null,
    drawTotalPrizes = 0,
    // Screening facts (PR-1, draw-launch-integrity §2.3) default SILENT — the
    // row only means anything when the feature is configured AND the campaign
    // opted in.
    screeningConfigured = false,
    screeningGateOn = false,
    // Boost-rail fact (PR-2): an ACTIVE agent_unlock activation is linked.
    railActive = false,
    // Promise-consistency results (PR-3) — computed by the loader with the
    // pure drawConsistency util; arrays of {code,message}. Default silent.
    drawHardIssues = [],
    drawSoftIssues = [],
    drawDriftIssues = [],
    // 'critical' | 'warning' | null — DOB-required invariant for age-gated
    // draws (D8/CX14: the age gate only enforces when a DOB was submitted).
    drawDobGate = null,
    // Funded-pool credit facts (PR-1): sums over the same assignments that
    // produce assignableAgents. Default 0/0 = row silent.
    poolCreditsRemaining = 0,
    poolCreditsTotal = 0,
  } = facts || {};

  // Brand-awareness (PHV tablet) campaigns don't capture leads → readiness N/A.
  if (type === 'brand_awareness') {
    return { applicable: false, ready: true, issues: [] };
  }

  const issues = [];

  // WARNING — empty pool → leads dead-end on the System Agent (undelivered but
  // retained in MKTR, admin-recoverable via reassign/held dispatch). Downgraded
  // from critical 2026-07-18 (Shawn): reward-only and test campaigns legitimately
  // launch with no funded pool, so this warns loudly but never blocks activation.
  if (assignableAgents === 0) {
    issues.push({
      level: 'warning',
      code: 'no_agent_pool',
      message:
        'No agent has an active lead package for this campaign — leads will sit with the System Agent, undelivered, until a package is assigned (they stay in MKTR and can be reassigned later). Fine for reward-only or test campaigns; assign a package before real ad spend.',
    });
  }

  // Screening × funding (PR-1, Codex R1 CX3+/CX19 — specializes no_agent_pool,
  // never duplicates it silently): with the screening gate on and NO funded
  // agent, every entrant is dialed and qualified into a hold nobody can
  // receive. Since PR-1's provenance-aware bake the hold SELF-HEALS once a
  // package is funded, so pre-launch this is a warning; on a LIVE campaign it
  // is the top go-live risk and shows critical. Deliberately NOT a launch
  // 422 (decision D7): the pre-launch level is warning, so activation is never
  // newly blocked.
  if (screeningConfigured && screeningGateOn && assignableAgents === 0) {
    issues.push({
      level: isActive ? 'critical' : 'warning',
      code: 'screening_no_funded_route',
      message: isActive
        ? 'AI screening is ON but no agent has a funded lead package — entrants are being called and qualified into a held queue nobody can receive. Fund a package now; held leads auto-deliver within ~5 minutes once funded.'
        : 'AI screening is ON but no agent has a funded lead package yet — qualified leads will wait held (they auto-deliver once a package is funded). Fund one before real traffic.',
    });
  }

  // WARNING — funded pool is nearly dry on a screening/draw campaign. At zero
  // the rows above take over; this is the tripwire BEFORE the dead-end re-arms
  // (Codex R1 G26: the 07-24 fix wears off silently at 0 credits).
  if ((screeningGateOn || drawEnabled) && poolCreditsTotal > 0 && poolCreditsRemaining > 0
      && poolCreditsRemaining * 5 < poolCreditsTotal) {
    issues.push({
      level: 'warning',
      code: 'lead_credits_low',
      message: `The funded lead pool is nearly exhausted (${poolCreditsRemaining} of ${poolCreditsTotal} credits left). At zero, new screened/draw leads hold undelivered until a package is topped up.`,
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

  // OTP send-path checks (PR 5 — server env facts the Studio literally labels
  // "not client-verifiable"). The send path: the SELECTED channel is primary;
  // WhatsApp degrades to SMS only when the Meta call throws
  // (verificationService). So the CRITICAL case is "the selected channel
  // cannot deliver at all"; partial gaps are warnings.
  const whatsappSelected = verificationChannel === 'whatsapp';
  const otpDeliverable = whatsappSelected ? whatsappOtpConfigured || smsOtpConfigured : smsOtpConfigured;
  if (!otpDeliverable) {
    issues.push({
      level: 'critical',
      code: 'otp_send_unconfigured',
      message: whatsappSelected
        ? 'No OTP channel is configured on this server — WhatsApp (META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN) and the SMS fallback (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are both missing. Phone verification will fail and no leads can be submitted.'
        : 'SMS OTP cannot be sent — AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are not set on this server. Phone verification will fail and no leads can be submitted.',
    });
  } else if (whatsappSelected && !whatsappOtpConfigured) {
    issues.push({
      level: 'warning',
      code: 'otp_whatsapp_unconfigured',
      message:
        'This campaign verifies by WhatsApp but the server has no Meta WhatsApp credentials (META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN). Every code will fall back to SMS.',
    });
  } else if (whatsappSelected && !smsOtpConfigured) {
    issues.push({
      level: 'warning',
      code: 'otp_sms_fallback_unconfigured',
      message:
        'WhatsApp OTP is configured, but the SMS fallback is not (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing) — a WhatsApp outage or template rejection would block verification.',
    });
  }

  // Lucky-draw coherence (PR 5 — the Draw table is server-only truth).
  // WARNINGS by design: leads still deliver either way; these are fairness/ops
  // risks, and they must not newly block launch-state activation.
  if (drawEnabled && !hasDrawRecord && drawIntakeOpen) {
    issues.push({
      level: 'warning',
      code: 'draw_record_missing',
      message:
        'The lucky draw is enabled but no draw record exists. Entries are being accepted, but ops cannot freeze the pool or pick a winner until a draw is created (Redeem Ops → Draws).',
    });
  }
  // Boost rail (PR-2, old-plan Phase 1): a LIVE draw with no active
  // agent_unlock activation cannot issue entry passes and every field scan
  // would earn nothing — today's silent-detached state becomes visible.
  // Pre-launch it is informational: launch auto-provisions the rail.
  if (drawEnabled && !railActive) {
    issues.push({
      level: isActive ? 'critical' : 'warning',
      code: 'draw_boost_rail_missing',
      message: isActive
        ? 'The draw has NO active reward rail (agent_unlock activation) — entry passes cannot issue and consultant sessions cannot earn the ×N boost. Relaunch the campaign (auto-provisions) or fix the activation in Redeem Ops.'
        : 'The ×N boost rail will be armed automatically when this campaign launches.',
    });
  }

  // Promise-consistency rows (PR-3). HARD contradictions on a LIVE campaign
  // are critical — entrants are accepting terms that contradict the page/
  // enforcement RIGHT NOW (the save gate blocks new drift; this row surfaces
  // pre-existing drift without waiting for a save).
  if (drawEnabled && drawHardIssues.length > 0) {
    issues.push({
      level: isActive ? 'critical' : 'warning',
      code: 'draw_promise_inconsistent',
      message: `${drawHardIssues[0].message}${drawHardIssues.length > 1 ? ` (+${drawHardIssues.length - 1} more contradiction${drawHardIssues.length > 2 ? 's' : ''})` : ''} Fix by regenerating the T&Cs from the campaign facts.`,
    });
  }
  if (drawEnabled && drawSoftIssues.length > 0) {
    issues.push({
      level: 'warning',
      code: 'draw_promise_review',
      message: `T&C cross-checks need a human eye: ${drawSoftIssues.map((i) => i.code).join(', ')}. ${drawSoftIssues[0].message}`,
    });
  }
  // CX17: the live draw RECORD is the engine's truth; config drift against it
  // is always critical — what the operator sees is not what will run.
  if (drawEnabled && drawDriftIssues.length > 0) {
    issues.push({
      level: 'critical',
      code: 'draw_live_record_drift',
      message: drawDriftIssues.map((i) => i.message).join(' '),
    });
  }
  // D8/CX14: age bounds are only enforced when a DOB is collected — an
  // age-gated draw with an optional DOB field promises a gate it cannot apply.
  if (drawEnabled && drawDobGate) {
    issues.push({
      level: drawDobGate,
      code: 'draw_age_gate_unenforceable',
      message: drawDobGate === 'critical'
        ? 'This draw enforces a maximum age but the Date of Birth field is not required — over-age entrants can enter, win, and be disqualified only at claim time. Make DOB required (Studio → Form).'
        : 'This draw has an age gate but the Date of Birth field is not required — entrants who leave it blank bypass the gate entirely. Make DOB required (Studio → Form).',
    });
  }

  // ESCALATION (PR-1, CX19): past the close date with still no (non-void) draw
  // record, the T&C's promised witnessed draw cannot run — entries have closed
  // into nothing. Critical so it cannot be missed; hasDrawRecord already
  // excludes void records (a voided draw does not satisfy the promise).
  if (drawEnabled && !hasDrawRecord && drawClosesPastDue) {
    issues.push({
      level: 'critical',
      code: 'draw_record_missing',
      message: `Entries closed${docDrawClosesAt ? ` on ${docDrawClosesAt}` : ''} but NO draw record exists — the witnessed draw promised in the T&C cannot run. Create and freeze it now (backend/scripts/run-lucky-draw.js).`,
    });
  }
  if (drawEnabled && hasLiveDraw && drawCloseMismatch) {
    issues.push({
      level: 'warning',
      code: 'draw_close_date_mismatch',
      message: `The design's draw close date (${docDrawClosesAt || 'unset'}) disagrees with the live draw record's entry cutoff (${drawRecordClosesAt || 'unknown'}). Entry acceptance follows the design date; the pool freeze follows the record — align them before launch.`,
    });
  }

  // CRITICAL — the draw engine resolves exactly one claimed winner today, so a
  // multi-prize draw would collect entries under T&Cs the platform cannot
  // honour. The service layer 422s activation regardless
  // (DRAW_MULTI_PRIZE_UNSUPPORTED, non-forceable) — this row is the visible
  // reason in the Launch tab. Phase 3 (multi-winner engine) removes both.
  if (drawEnabled && drawTotalPrizes > 1) {
    issues.push({
      level: 'critical',
      code: 'draw_multi_prize_unsupported',
      message: `This draw lists ${drawTotalPrizes} prizes, but multi-winner draw execution isn't live yet — the campaign can be saved and reviewed as a draft, not activated.`,
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

// Model-free static imports — the pure export above must stay import-light
// (utils only, no model graph).
import { readLegacyViewSafe, getStoredLuckyDraw, getStoredTermsHtml } from '../utils/designConfigV2Clamp.js';
import { normalizeLuckyDraw, promisedWinnerCount } from '../utils/luckyDraw.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import { checkDrawConsistency, checkDrawRecordDrift } from '../utils/drawConsistency.js';

/** Display YMD (SGT) for a draw record's exclusive cutoff instant — minus 1ms
 * lands on the inclusive last entry day. */
const sgtYmdFromExclusiveInstant = (instant) => {
  const t = new Date(instant).getTime();
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(t - 1));
};

/**
 * Load the facts for a campaign and evaluate readiness.
 * Read-only. Lazy-imports models so the pure export above stays import-light.
 */
export async function loadCampaignReadiness(campaignId) {
  const { Campaign, LeadPackage, LeadPackageAssignment, User, Draw, Activation } = await import('../models/index.js');
  const { Op } = await import('sequelize');

  const campaign = await Campaign.findByPk(campaignId, {
    attributes: ['id', 'name', 'type', 'is_active', 'status', 'design_config', 'min_age', 'max_age'],
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
    attributes: ['agentId', 'leadsRemaining', 'leadsTotal'],
  });
  const candidateIds = [...new Set(assignments.map((a) => a.agentId))];

  let assignableAgents = 0;
  let agentsMissingPhone = 0;
  let poolCreditsRemaining = 0;
  let poolCreditsTotal = 0;
  if (candidateIds.length > 0) {
    const agents = await User.findAll({
      where: { id: candidateIds, role: 'agent', isActive: true },
      attributes: ['id', 'phone'],
    });
    assignableAgents = agents.length;
    agentsMissingPhone = agents.filter((a) => !a.phone || String(a.phone).trim() === '').length;
    // Credit sums over the SAME pool the router draws from (active-agent
    // assignments only) — the lead_credits_low tripwire (PR-1).
    const activeIds = new Set(agents.map((a) => a.id));
    for (const a of assignments) {
      if (!activeIds.has(a.agentId)) continue;
      poolCreditsRemaining += Number(a.leadsRemaining) || 0;
      poolCreditsTotal += Number(a.leadsTotal) || 0;
    }
  }

  // v2-safe as-is: quiz + guidedReview are top-level verbatim-passthrough keys
  // in BOTH doc versions (loss-ledger L5), so these raw reads need no adapter.
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
  // BOTH signals (PR-1, Codex R1 CX19): archive flips `status` but not always
  // `is_active` — reading the flag alone showed archived campaigns as live.
  const isActive = campaign.is_active !== false
    && (campaign.status == null || String(campaign.status) === 'active');

  // Screening facts (PR-1): feature-configured (env) × campaign gate (design).
  // Lazy import keeps the pure export's import graph model-free.
  const { screeningConfig } = await import('./screeningGate.js');
  const screeningConfigured = screeningConfig().configured === true;
  const screeningGateOn = readLegacyViewSafe(design, {}).screeningCallAtSubmit === true;

  // OTP send-path facts (PR 5). Channel byte-mirrors verificationService's
  // resolution; cred booleans are explicitly coerced — raw env strings must
  // never enter the facts/payload.
  const verificationChannel =
    readLegacyViewSafe(design, { otpChannel: 'sms' }).otpChannel === 'whatsapp' ? 'whatsapp' : 'sms';
  const smsOtpConfigured = Boolean(process.env.AWS_ACCESS_KEY_ID) && Boolean(process.env.AWS_SECRET_ACCESS_KEY);
  const whatsappOtpConfigured =
    Boolean(process.env.META_WA_PHONE_NUMBER_ID) && Boolean(process.env.META_WA_ACCESS_TOKEN);

  // Lucky-draw facts (PR 5) — one indexed query, draw campaigns only. If a
  // LIVE record exists it is necessarily the newest (new records start 'open'
  // and the partial-unique index forbids a second live one), so newest-first
  // findOne answers both "any record?" and "live record?".
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(design));
  const drawEnabled = ld?.enabled === true;
  let hasDrawRecord = false;
  let hasLiveDraw = false;
  let drawIntakeOpen = false;
  let drawCloseMismatch = false;
  let docDrawClosesAt = null;
  let drawRecordClosesAt = null;
  let drawClosesPastDue = false;
  let railActive = false;
  let drawHardIssues = [];
  let drawSoftIssues = [];
  let drawDriftIssues = [];
  let drawDobGate = null;
  if (drawEnabled) {
    // Boost-rail fact (PR-2): one live activation per campaign (partial
    // unique), so a single active-status probe answers it.
    const rail = await Activation.findOne({
      where: { campaignId, status: 'active' },
      attributes: ['id', 'unlockPolicy'],
    });
    railActive = !!rail && rail.unlockPolicy === 'agent_unlock';
  }
  if (drawEnabled) {
    // Void records don't count (PR-1, CX19): a voided draw does not satisfy the
    // "witnessed draw" promise, so it must not suppress draw_record_missing.
    const record = await Draw.findOne({
      where: { campaignId, status: { [Op.ne]: 'void' } },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'status', 'closesAt', 'boostClosesAt', 'multiplier', 'activationId', 'termsVersionId'],
    });
    hasDrawRecord = !!record;
    hasLiveDraw = !!record && ['open', 'frozen', 'sealed', 'drawn'].includes(record.status);
    const docEndMs = ld?.closesAt ? sgtDayEndExclusiveMs(ld.closesAt) : null;
    docDrawClosesAt = ld?.closesAt || null;
    drawIntakeOpen = docEndMs !== null && docEndMs > Date.now();
    drawClosesPastDue = docEndMs !== null && docEndMs <= Date.now();
    if (hasLiveDraw && docEndMs !== null) {
      const recordMs = new Date(record.closesAt).getTime();
      drawCloseMismatch = Number.isFinite(recordMs) && recordMs !== docEndMs;
      drawRecordClosesAt = sgtYmdFromExclusiveInstant(record.closesAt);
    }

    // Promise-consistency facts (PR-3) — the same pure lint the save gate
    // runs, so pre-existing drift on a live campaign is visible WITHOUT a
    // save; plus the CX17 live-record drift compare and the D8 DOB invariant.
    const view = readLegacyViewSafe(design, {});
    const lint = checkDrawConsistency({
      minAge: Number.isInteger(campaign.min_age) ? campaign.min_age : null,
      maxAge: Number.isInteger(campaign.max_age) ? campaign.max_age : null,
      luckyDraw: ld,
      termsHtml: getStoredTermsHtml(design),
      contentHeadline: design?.content?.headline ?? view.formHeadline ?? '',
      contentStory: design?.content?.story ?? view.storyText ?? '',
    });
    drawHardIssues = lint.hard;
    drawSoftIssues = lint.soft;
    if (hasLiveDraw) drawDriftIssues = checkDrawRecordDrift({ luckyDraw: ld, drawRow: record });
    const dobRequired = view.requiredFields?.dob === true;
    if (!dobRequired) {
      if (Number.isInteger(campaign.max_age)) drawDobGate = isActive ? 'critical' : 'warning';
      else if (Number.isInteger(campaign.min_age) && campaign.min_age > 18) drawDobGate = 'warning';
    }
  }

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
    verificationChannel,
    smsOtpConfigured,
    whatsappOtpConfigured,
    drawEnabled,
    hasDrawRecord,
    hasLiveDraw,
    drawIntakeOpen,
    drawClosesPastDue,
    drawCloseMismatch,
    docDrawClosesAt,
    drawRecordClosesAt,
    // The PROMISE, not just the structured rows (P2-9) — a legacy winners:N
    // config must raise the same critical a prizes[] one does.
    drawTotalPrizes: promisedWinnerCount(ld),
    screeningConfigured,
    screeningGateOn,
    railActive,
    drawHardIssues,
    drawSoftIssues,
    drawDriftIssues,
    drawDobGate,
    poolCreditsRemaining,
    poolCreditsTotal,
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
    // PR 5 booleans (never raw env values) — whatsappOtpConfigured lets the
    // Studio retire its speculative "creds are server env" static warning.
    verificationChannel,
    smsOtpConfigured,
    whatsappOtpConfigured,
    hasLiveDraw,
    ...evaluation,
  };
}
