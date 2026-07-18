import { computeReadiness } from '../services/campaignReadinessService.js';

const codes = (r) => r.issues.map((i) => i.code);

describe('campaignReadinessService.computeReadiness', () => {
  const healthy = {
    type: 'quiz',
    isActive: true,
    isQuiz: true,
    quizEnabled: true,
    assignableAgents: 3,
    agentsMissingPhone: 0,
    webhookEnabled: true,
    // PR 5 OTP facts — alarm-safe defaults mean every healthy fixture must
    // state its send path explicitly (like webhookEnabled).
    verificationChannel: 'sms',
    smsOtpConfigured: true,
  };

  it('is ready with a healthy quiz campaign', () => {
    const r = computeReadiness(healthy);
    expect(r.applicable).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('is NOT applicable for brand_awareness (PHV) campaigns', () => {
    const r = computeReadiness({ ...healthy, type: 'brand_awareness', assignableAgents: 0 });
    expect(r.applicable).toBe(false);
    expect(r.ready).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags an empty agent pool as a WARNING only — activation stays allowed (2026-07-18)', () => {
    const r = computeReadiness({ ...healthy, assignableAgents: 0 });
    expect(r.ready).toBe(true);
    expect(codes(r)).toContain('no_agent_pool');
    expect(r.issues.find((i) => i.code === 'no_agent_pool').level).toBe('warning');
  });

  it('flags a disabled webhook as critical (not ready)', () => {
    const r = computeReadiness({ ...healthy, webhookEnabled: false });
    expect(r.ready).toBe(false);
    expect(codes(r)).toContain('webhook_disabled');
  });

  it('warns (but stays ready) when some pool agents have no phone', () => {
    const r = computeReadiness({ ...healthy, assignableAgents: 2, agentsMissingPhone: 1 });
    expect(r.ready).toBe(true);
    expect(codes(r)).toContain('agents_missing_phone');
    expect(r.issues.find((i) => i.code === 'agents_missing_phone').level).toBe('warning');
  });

  it('warns when a quiz campaign has the quiz disabled', () => {
    const r = computeReadiness({ ...healthy, quizEnabled: false });
    expect(r.ready).toBe(true);
    expect(codes(r)).toContain('quiz_not_enabled');
  });

  it('adds an info note when the campaign is not active', () => {
    const r = computeReadiness({ ...healthy, isActive: false });
    expect(r.ready).toBe(true); // info-only doesn't block
    expect(codes(r)).toContain('not_active');
  });

  it('accumulates multiple criticals (empty pool + webhook off)', () => {
    const r = computeReadiness({ ...healthy, assignableAgents: 0, webhookEnabled: false });
    expect(r.ready).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['no_agent_pool', 'webhook_disabled']));
  });

  it('does not flag missing-phone for a regular lead_generation campaign that is otherwise healthy', () => {
    const r = computeReadiness({
      type: 'lead_generation', isActive: true, isQuiz: false, quizEnabled: false,
      assignableAgents: 1, agentsMissingPhone: 0, webhookEnabled: true,
      smsOtpConfigured: true,
    });
    expect(r.ready).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  // ── PR 5: OTP send-path matrix (server-verifiable env facts) ──
  // The send path: the SELECTED channel is primary; WhatsApp degrades to SMS
  // only when the Meta call throws. Critical = the selected channel cannot
  // deliver AT ALL; partial gaps are warnings.

  it('CRITICAL when the SMS channel is selected and SMS creds are missing (blocks activation)', () => {
    const r = computeReadiness({ ...healthy, smsOtpConfigured: false });
    expect(r.ready).toBe(false); // documents the launch-state 409 coupling
    const issue = r.issues.find((i) => i.code === 'otp_send_unconfigured');
    expect(issue.level).toBe('critical');
    expect(issue.message).toMatch(/AWS_ACCESS_KEY_ID/);
  });

  it('CRITICAL when WhatsApp is selected and NEITHER channel is configured', () => {
    const r = computeReadiness({
      ...healthy,
      verificationChannel: 'whatsapp',
      whatsappOtpConfigured: false,
      smsOtpConfigured: false,
    });
    expect(r.ready).toBe(false);
    expect(r.issues.find((i) => i.code === 'otp_send_unconfigured').message).toMatch(/META_WA_PHONE_NUMBER_ID/);
  });

  it('warns (still ready) when WhatsApp is selected without Meta creds but SMS can carry it', () => {
    const r = computeReadiness({
      ...healthy,
      verificationChannel: 'whatsapp',
      whatsappOtpConfigured: false,
      smsOtpConfigured: true,
    });
    expect(r.ready).toBe(true);
    expect(r.issues.find((i) => i.code === 'otp_whatsapp_unconfigured').level).toBe('warning');
    expect(codes(r)).not.toContain('otp_send_unconfigured');
  });

  it('warns (still ready) when WhatsApp works but the SMS fallback is missing', () => {
    const r = computeReadiness({
      ...healthy,
      verificationChannel: 'whatsapp',
      whatsappOtpConfigured: true,
      smsOtpConfigured: false,
    });
    expect(r.ready).toBe(true);
    expect(codes(r)).toContain('otp_sms_fallback_unconfigured');
    expect(codes(r)).not.toContain('otp_send_unconfigured');
  });

  it('a fully configured WhatsApp campaign raises no OTP issues', () => {
    const r = computeReadiness({
      ...healthy,
      verificationChannel: 'whatsapp',
      whatsappOtpConfigured: true,
      smsOtpConfigured: true,
    });
    expect(r.issues).toHaveLength(0);
  });

  // ── PR 5: lucky-draw coherence (Draw table is server-only truth) ──
  // Warnings by design: leads deliver either way; these must not newly block
  // activation.

  it('warns when the draw is enabled with NO record while intake is still open', () => {
    const r = computeReadiness({ ...healthy, drawEnabled: true, hasDrawRecord: false, drawIntakeOpen: true });
    expect(r.ready).toBe(true);
    expect(r.issues.find((i) => i.code === 'draw_record_missing').level).toBe('warning');
  });

  it('stays SILENT for a completed draw (record exists, no longer live) and after intake closes', () => {
    const completed = computeReadiness({
      ...healthy, drawEnabled: true, hasDrawRecord: true, hasLiveDraw: false, drawIntakeOpen: false,
    });
    expect(codes(completed)).not.toContain('draw_record_missing');

    const intakeClosedNeverCreated = computeReadiness({
      ...healthy, drawEnabled: true, hasDrawRecord: false, drawIntakeOpen: false,
    });
    expect(codes(intakeClosedNeverCreated)).not.toContain('draw_record_missing');
  });

  it('warns with both dates when the live record cutoff disagrees with the doc', () => {
    const r = computeReadiness({
      ...healthy,
      drawEnabled: true,
      hasDrawRecord: true,
      hasLiveDraw: true,
      drawCloseMismatch: true,
      docDrawClosesAt: '2026-10-30',
      drawRecordClosesAt: '2026-11-05',
    });
    expect(r.ready).toBe(true);
    const issue = r.issues.find((i) => i.code === 'draw_close_date_mismatch');
    expect(issue.level).toBe('warning');
    expect(issue.message).toContain('2026-10-30');
    expect(issue.message).toContain('2026-11-05');
  });

  it('a clean live draw raises no draw issues', () => {
    const r = computeReadiness({
      ...healthy, drawEnabled: true, hasDrawRecord: true, hasLiveDraw: true, drawIntakeOpen: true, drawCloseMismatch: false,
    });
    expect(r.issues).toHaveLength(0);
  });

  it('brand_awareness stays not-applicable even with nothing configured (PR 5 facts included)', () => {
    const r = computeReadiness({
      ...healthy, type: 'brand_awareness', smsOtpConfigured: false, drawEnabled: true, drawIntakeOpen: true,
    });
    expect(r.applicable).toBe(false);
    expect(r.issues).toHaveLength(0);
  });

  it('blocks an unsaved Guided Review page', () => {
    const r = computeReadiness({
      ...healthy,
      type: 'guided_review',
      isQuiz: false,
      isGuidedReview: true,
    });
    expect(r.ready).toBe(false);
    expect(codes(r)).toContain('guided_review_not_configured');
  });

  it('blocks Guided Review when qualification is missing', () => {
    const r = computeReadiness({
      ...healthy,
      type: 'guided_review',
      isQuiz: false,
      isGuidedReview: true,
      guidedReviewConfigured: true,
      guidedReviewQuestions: 0,
      guidedReviewQualificationEnabled: false,
      guidedReviewRewardConfigured: true,
    });
    expect(r.ready).toBe(false);
    expect(codes(r)).toContain('guided_review_qualification_missing');
  });

  it('requires a configured reward and accepts a complete Guided Review', () => {
    const base = {
      ...healthy,
      type: 'guided_review',
      isQuiz: false,
      isGuidedReview: true,
      guidedReviewConfigured: true,
      guidedReviewQuestions: 3,
      guidedReviewQualificationEnabled: true,
    };
    const incomplete = computeReadiness({ ...base, guidedReviewRewardConfigured: false });
    expect(incomplete.ready).toBe(false);
    expect(codes(incomplete)).toContain('guided_review_reward_missing');

    const complete = computeReadiness({ ...base, guidedReviewRewardConfigured: true });
    expect(complete.ready).toBe(true);
    expect(complete.issues).toHaveLength(0);
  });
});
