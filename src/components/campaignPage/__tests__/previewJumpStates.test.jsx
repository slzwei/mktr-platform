import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

import { apiClient } from '@/api/client';
import CampaignPageRenderer from '../CampaignPageRenderer';
import { resolveJumpFixtures, HARNESS_JUMPS, RENDERER_BLOCKED_JUMPS, SAMPLE_FORM_DATA } from '../previewJumpFixtures';
import { upgradeDesignConfig } from '@/lib/designConfigV2';
import { JUMP_STATES } from '@/components/studio/studioJumpStates';

/**
 * Every funnel-internal jump state renders its marker through the REAL
 * renderer in previewMode, with ZERO network across the board (Codex F17).
 * Harness states (success/duplicate/error) are covered in the Studio's
 * CanvasPageSubject suite — they never reach the renderer.
 */

const QUIZ = {
  enabled: true,
  quizId: 'pp',
  version: 2,
  intro: { headline: 'What is your money personality?', subhead: 'Sixty seconds.', ctaLabel: 'Start the quiz' },
  steps: [
    {
      id: 's1',
      questions: [
        {
          id: 'q1',
          prompt: 'Pick your ideal weekend',
          type: 'single',
          weight: 1,
          options: [
            { id: 'a', label: 'Cosy and planned', scores: { rock: 1 } },
            { id: 'b', label: 'Spontaneous', scores: { free: 1 } },
          ],
        },
      ],
    },
    {
      id: 's2',
      questions: [
        {
          id: 'q2',
          prompt: 'Payday hits. First move?',
          type: 'single',
          weight: 2,
          options: [
            { id: 'c', label: 'Save it', scores: { rock: 1 } },
            { id: 'd', label: 'Spend it', scores: { free: 1 } },
          ],
        },
      ],
    },
  ],
  resultProfiles: [
    { id: 'rock', title: 'The Rock', description: 'Steady.', themeColor: '#0F9D58', ctaLabel: 'Continue' },
    { id: 'free', title: 'The Free Spirit', description: 'Loose.', themeColor: '#DB4437', ctaLabel: 'Continue' },
  ],
  scoring: {
    method: 'profile-sum',
    tiebreak: 'prepared-first',
    profileOrder: ['rock', 'free'],
    readiness: { enabled: true, label: 'Readiness', rankFactor: { rock: 1, free: 0 } },
    leadScore: { enabled: false, tagPoints: {}, bands: [] },
  },
  reveal: { alwaysShowGap: false, rarityEnabled: false },
};

function v2Campaign({ quiz = null, gates = {}, draw = false } = {}) {
  const v1 = {
    formHeadline: 'Get your voucher',
    storyText: 'A story.',
    customerHost: 'redeem',
    sgPrOnly: gates.sgPr === true,
    excludeAdvisors: gates.advisor === true,
    dncCheckAtSubmit: gates.dnc === true,
    ...(quiz ? { quiz } : {}),
  };
  const doc = upgradeDesignConfig(v1);
  if (draw) doc.luckyDraw = { enabled: true, closesAt: '2099-10-30', prize: 'Tokyo trip' };
  return { id: 'c1', name: 'FairPrice Voucher', status: 'active', design_config: doc };
}

function renderJump(jump, campaignOpts) {
  return render(
    <CampaignPageRenderer campaign={v2Campaign(campaignOpts)} previewMode jump={jump} onSubmit={vi.fn()} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  expect(apiClient.post).not.toHaveBeenCalled(); // zero network across EVERY state
  expect(apiClient.get).not.toHaveBeenCalled();
  vi.useRealTimers();
});

describe('renderer jump states — every fixture renders its marker (previewMode)', () => {
  it('default: resting page (quiz intro when a quiz exists)', () => {
    renderJump(null, { quiz: QUIZ });
    expect(screen.getByText('What is your money personality?')).toBeInTheDocument();
  });

  it('quiz-intro', () => {
    renderJump('quiz-intro', { quiz: QUIZ });
    expect(screen.getByText('What is your money personality?')).toBeInTheDocument();
    expect(screen.getByText('Start the quiz')).toBeInTheDocument();
  });

  it('quiz-question: first question + progress', () => {
    renderJump('quiz-question', { quiz: QUIZ });
    expect(screen.getByText('Pick your ideal weekend')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('quiz-reveal: scored persona reveal WITHOUT firing onReveal (no CompleteRegistration moment)', () => {
    const onReveal = vi.fn();
    render(
      <CampaignPageRenderer
        campaign={v2Campaign({ quiz: QUIZ })}
        previewMode
        jump="quiz-reveal"
        onSubmit={vi.fn()}
        onQuizReveal={onReveal}
      />
    );
    expect(screen.getByText('You are')).toBeInTheDocument();
    expect(screen.getByText('The Rock')).toBeInTheDocument(); // deterministic first-option walkthrough
    expect(onReveal).not.toHaveBeenCalled();
  });

  it('gate-sgpr: the SG/PR question, past the quiz gate', () => {
    renderJump('gate-sgpr', { quiz: QUIZ, gates: { sgPr: true } });
    expect(screen.getByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
    expect(screen.queryByText('What is your money personality?')).not.toBeInTheDocument();
  });

  it('gate-sgpr-no: the ineligible message', () => {
    renderJump('gate-sgpr-no', { gates: { sgPr: true } });
    expect(screen.getByText('This promotion is only open to Singapore Citizens and Permanent Residents.')).toBeInTheDocument();
  });

  it('gate-advisor: the advisor question (SG/PR auto-satisfied)', () => {
    renderJump('gate-advisor', { gates: { sgPr: true, advisor: true } });
    expect(screen.getByText('Are you a financial advisor, consultant, or insurance agent?')).toBeInTheDocument();
  });

  it('gate-advisor-no: the advisor-blocked message', () => {
    renderJump('gate-advisor-no', { gates: { advisor: true } });
    expect(screen.getByText(/not available to\s+financial advisors, consultants, or insurance agents/)).toBeInTheDocument();
  });

  it('otp-open: OTP panel open with sample identity, code EMPTY', () => {
    renderJump('otp-open', {});
    expect(screen.getByText(/Enter the 6-digit code sent via/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sarah Tan')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('6-digit code')).toHaveValue('');
  });

  it('otp-verified: the Verified badge', () => {
    renderJump('otp-verified', {});
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('otp-ratelimit: the production 429 copy + long cooldown', () => {
    renderJump('otp-ratelimit', {});
    expect(screen.getByText(/Too many verification attempts/)).toBeInTheDocument();
  });

  it('dnc-notice: the consent gate with the campaign-name advertiser, fields locked behind it', () => {
    renderJump('dnc-notice', { gates: { dnc: true } });
    expect(screen.getAllByText('FairPrice Voucher').length).toBeGreaterThan(0); // advertiser chip
    expect(screen.queryByText(/You(’|')ve agreed to be contacted by/)).not.toBeInTheDocument();
  });

  it('dnc-consented: the confirmed (sage) state', () => {
    renderJump('dnc-consented', { gates: { dnc: true } });
    expect(screen.getByText(/You(’|')ve agreed to be contacted by/)).toBeInTheDocument();
  });

  it('tnc-dialog: the T&C dialog is open', () => {
    renderJump('tnc-dialog', {});
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('submitting: the CTA shows the in-flight label without any network', () => {
    renderJump('submitting', {});
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeInTheDocument();
  });

  it('inactive / draw-closed: the renderer-owned blocked pages (unchanged from PR 2)', () => {
    const a = renderJump('inactive', {});
    expect(a.container.querySelector('[data-campaign-page-blocked="inactive"]')).toBeTruthy();
    a.unmount();
    const b = renderJump('draw-closed', { draw: true });
    expect(b.container.querySelector('[data-campaign-page-blocked="draw"]')).toBeTruthy();
  });
});

describe('resolveJumpFixtures — the contract itself', () => {
  const doc = upgradeDesignConfig({ quiz: QUIZ });

  it('returns null for resting/referred/renderer-blocked/harness states', () => {
    for (const id of [null, 'default', 'referred', ...RENDERER_BLOCKED_JUMPS, ...HARNESS_JUMPS]) {
      expect(resolveJumpFixtures(id, doc)).toBe(null);
    }
  });

  it('NEVER seeds `otp` (the auto-verify-on-mount hazard) in any state', () => {
    for (const state of JUMP_STATES) {
      const fx = resolveJumpFixtures(state.id, doc);
      if (fx) {
        expect(fx.form).not.toHaveProperty('otp');
        expect(fx.form).not.toHaveProperty('otpValue');
      }
    }
  });

  it('never marks anything submitted — no fixture carries a submitted/outcome flag', () => {
    for (const state of JUMP_STATES) {
      const fx = resolveJumpFixtures(state.id, doc);
      if (fx) {
        expect(fx.form).not.toHaveProperty('submitted');
        expect(fx.form.loading === 'submitting' ? state.id : 'submitting').toBe('submitting');
      }
    }
  });

  it('form-side states force the quiz gate done; quiz states do not', () => {
    expect(resolveJumpFixtures('otp-open', doc).quiz).toEqual({ done: true });
    expect(resolveJumpFixtures('gate-sgpr', doc).quiz).toEqual({ done: true });
    expect(resolveJumpFixtures('quiz-intro', doc).quiz.done).toBe(false);
  });

  it('quiz-reveal computes a deterministic scored result from the doc quiz', () => {
    const fx = resolveJumpFixtures('quiz-reveal', doc);
    expect(fx.quiz.phase).toBe('result');
    expect(fx.quiz.result?.profileId).toBe('rock');
    expect(fx.quiz.answers).toEqual([
      { qid: 'q1', value: 'a' },
      { qid: 'q2', value: 'c' },
    ]);
  });

  it('OTP prerequisites are honest: sample SG identity, pending panel, no code', () => {
    const fx = resolveJumpFixtures('otp-open', doc);
    expect(fx.form.formData).toEqual(SAMPLE_FORM_DATA);
    expect(fx.form.otpState).toBe('pending');
    expect(fx.form.resendCooldown).toBe(30);
  });

  it('DNC states sit AFTER verification, mirroring production order', () => {
    expect(resolveJumpFixtures('dnc-notice', doc).form.otpState).toBe('verified');
    expect(resolveJumpFixtures('dnc-consented', doc).form).toMatchObject({
      otpState: 'verified',
      dncStatus: 'on_dnc',
      dncConsent: true,
    });
  });
});
