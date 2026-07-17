import { scoreQuiz } from '@/lib/quizScoring';

/**
 * Funnel-state jump fixtures (Studio PR 3) — the PREVIEW-ONLY controlled
 * contract for the regulated funnel.
 *
 * A jump never drives the live components through their transitions; instead
 * the Studio remounts the funnel (keyed on jump + resetKey) and the components
 * INITIALIZE from a fixture — consumed exclusively when `previewMode === true`
 * (every initializer gates itself; a fixture passed to a live mount is inert
 * by construction, and the suite proves it byte-identical).
 *
 * Prerequisites are satisfied honestly, mirroring the real funnel order
 * (quiz → SG/PR → advisor → fields → OTP → DNC → consents → submit):
 *  - form-side states force the quiz gate done (when a quiz exists);
 *  - OTP states seed valid sample field values and a pending/verified panel;
 *  - DNC states sit AFTER verification (otpState 'verified'), exactly like
 *    production (the check only ever runs post-OTP);
 *  - `submitting` is the visual state only — previewMode means no timer,
 *    no network, no onSubmit can ever run.
 *
 * HARD RULES:
 *  - fixtures NEVER seed `otp`: OTPVerification auto-verifies a 6-digit code
 *    on mount, which in a live mount would call /verify/check;
 *  - fixtures never mark anything submitted — success/duplicate/error are
 *    PARENT-page states and render in the Studio harness (CanvasPageSubject),
 *    never inside the funnel.
 *
 * Form fixture fields (all optional): eligibility, advisorAck, formData
 * (partial merge), otpState, resendCooldown, error, dncStatus, dncConsent,
 * consentContact, consentTerms, consentThirdParty, consentOpen, loading.
 * Quiz fixture fields: done (QuizGate) · phase, stepIdx, answers, result
 * (CampaignQuiz).
 */

/** Renderer-owned blocked states (pre-existing since PR 2). */
export const RENDERER_BLOCKED_JUMPS = ['inactive', 'draw-closed'];
/** Parent-page outcome states — rendered by the Studio harness, never the funnel. */
export const HARNESS_JUMPS = ['success', 'duplicate', 'error'];

/** SG-valid sample identity for prerequisite fields (fixture-only). */
export const SAMPLE_FORM_DATA = {
  name: 'Sarah Tan',
  email: 'sarah.tan@example.com',
  phone: '91234567',
  postal_code: '520123',
};

const GATES_PASSED = { eligibility: 'eligible', advisorAck: 'public' };
const OTP_READY = { ...GATES_PASSED, formData: SAMPLE_FORM_DATA };

/** The production 429 copy (CampaignSignupForm handleSendOtp/handleVerifyOtp). */
const RATE_LIMIT_MESSAGE = 'Too many verification attempts. Please wait 10 minutes before trying again.';

const FORM_FIXTURES = {
  'gate-sgpr': {},
  'gate-sgpr-no': { eligibility: 'no' },
  'gate-advisor': { eligibility: 'eligible' },
  'gate-advisor-no': { eligibility: 'eligible', advisorAck: 'advisor' },
  'otp-open': { ...OTP_READY, otpState: 'pending', resendCooldown: 30 },
  'otp-verified': { ...OTP_READY, otpState: 'verified' },
  'otp-ratelimit': { ...OTP_READY, otpState: 'pending', resendCooldown: 600, error: RATE_LIMIT_MESSAGE },
  'dnc-notice': { ...OTP_READY, otpState: 'verified', dncStatus: 'on_dnc', dncConsent: false },
  'dnc-consented': { ...OTP_READY, otpState: 'verified', dncStatus: 'on_dnc', dncConsent: true },
  'tnc-dialog': { ...OTP_READY, consentOpen: true },
  // dncStatus 'clear' mirrors the real pre-submit state: on a DNC-enabled
  // campaign the verified transition runs the check BEFORE submit is possible
  // (Codex diff-review #9); harmless when the gate is off.
  submitting: { ...OTP_READY, otpState: 'verified', dncStatus: 'clear', consentTerms: true, loading: 'submitting' },
};

/** Deterministic quiz walkthrough: first option of every question. */
function autoAnswers(quiz) {
  const questions = (quiz?.steps || []).flatMap((s) => s.questions || []);
  return questions
    .filter((q) => q?.id && q.options?.[0]?.id)
    .map((q) => ({ qid: q.id, value: q.options[0].id }));
}

function quizFixtureFor(jump, quiz) {
  switch (jump) {
    case 'quiz-intro':
      return { done: false, phase: 'intro' };
    case 'quiz-question':
      return { done: false, phase: 'question', stepIdx: 0 };
    case 'quiz-reveal': {
      const answers = autoAnswers(quiz);
      let result = null;
      try {
        result = scoreQuiz(quiz, answers);
      } catch {
        result = null; // malformed quiz — the reveal renders its safe fallback
      }
      return { done: false, phase: 'result', answers, result };
    }
    default:
      // Any form-side state: the quiz gate must be behind us.
      return { done: true };
  }
}

/**
 * Resolve a jump id to `{ form, quiz }` fixtures against the CURRENT doc.
 * Returns null for the resting page, renderer-owned blocked states, and
 * harness-owned outcome states.
 */
export function resolveJumpFixtures(jump, doc) {
  if (!jump || jump === 'default' || jump === 'referred') return null;
  if (RENDERER_BLOCKED_JUMPS.includes(jump) || HARNESS_JUMPS.includes(jump)) return null;
  const quiz = doc?.quiz;
  const form = FORM_FIXTURES[jump] || {};
  return { form, quiz: quizFixtureFor(jump, quiz) };
}
