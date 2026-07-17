import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

import { apiClient } from '@/api/client';
import CampaignSignupForm from '../CampaignSignupForm';
import CampaignQuiz, { QuizGate } from '../CampaignQuiz';
import { SAMPLE_FORM_DATA } from '@/components/campaignPage/previewJumpFixtures';

/**
 * LIVE-FUNNEL INERTNESS (Codex F1/F2) — the non-negotiable proof that the
 * Studio's previewFixture contract cannot touch a live capture. Every state
 * initializer gates on previewMode === true; these tests hand the FULLEST,
 * most dangerous fixture to LIVE mounts and require byte-identical DOM and
 * zero network.
 */

// The most dangerous fixture: gates passed, verified phone, DNC consented,
// T&C ticked, submitting. If ANY field leaked into a live mount it would skip
// a regulated step.
const DANGER_FIXTURE = {
  eligibility: 'eligible',
  advisorAck: 'public',
  formData: SAMPLE_FORM_DATA,
  otpState: 'verified',
  resendCooldown: 600,
  error: 'leaked-error',
  dncStatus: 'on_dnc',
  dncConsent: true,
  consentContact: false,
  consentTerms: true,
  consentThirdParty: true,
  consentOpen: true,
  loading: 'submitting',
};

const GATED_CAMPAIGN = {
  id: 'c1',
  name: 'FairPrice Voucher',
  design_config: {
    sgPrOnly: true,
    excludeAdvisors: true,
    dncCheckAtSubmit: true,
    visibleFields: {},
    requiredFields: {},
  },
};

const QUIZ = {
  enabled: true,
  quizId: 'q',
  version: 1,
  intro: { headline: 'Take the quiz', subhead: '', ctaLabel: 'Start' },
  steps: [
    {
      id: 's1',
      questions: [
        { id: 'q1', prompt: 'Pick one', type: 'single', weight: 1, options: [{ id: 'a', label: 'A', scores: { p1: 1 } }] },
      ],
    },
  ],
  resultProfiles: [{ id: 'p1', title: 'Profile One' }],
  scoring: { method: 'profile-sum', tiebreak: 'prepared-first', profileOrder: ['p1'], readiness: { enabled: false, rankFactor: {} }, leadScore: { enabled: false, tagPoints: {}, bands: [] } },
  reveal: {},
};

function renderLiveForm(extraProps = {}) {
  return render(
    <CampaignSignupForm
      themeColor="#D17029"
      formHeadline="Get Started"
      campaignId="c1"
      campaign={GATED_CAMPAIGN}
      onSubmit={vi.fn()}
      ctaLabel="Submit Now"
      {...extraProps}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CampaignSignupForm — previewFixture is INERT in live mode', () => {
  it('renders byte-identical DOM with and without the danger fixture (previewMode off)', () => {
    const a = renderLiveForm();
    const htmlWithout = a.container.innerHTML;
    a.unmount();
    const b = renderLiveForm({ previewFixture: DANGER_FIXTURE });
    const htmlWith = b.container.innerHTML;
    expect(htmlWith).toBe(htmlWithout);
    // And the live mount still shows the FIRST regulated step, not a skipped funnel.
    expect(screen.getByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
  });

  it('makes zero network calls at mount with the danger fixture in live mode (timers flushed)', () => {
    renderLiveForm({ previewFixture: DANGER_FIXTURE });
    vi.runOnlyPendingTimers();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('explicit previewMode={false} is just as inert', () => {
    renderLiveForm({ previewMode: false, previewFixture: DANGER_FIXTURE });
    expect(screen.getByText('Are you a Singapore Citizen or Permanent Resident?')).toBeInTheDocument();
  });

  it.each([
    ['otpState', { otpState: 'verified' }],
    ['dncStatus', { dncStatus: 'on_dnc', dncConsent: true }],
    ['eligibility', { eligibility: 'eligible' }],
    ['advisorAck', { advisorAck: 'public' }],
    ['consents', { consentTerms: true, consentContact: false, consentThirdParty: true }],
    ['loading', { loading: 'submitting' }],
    ['formData', { formData: SAMPLE_FORM_DATA }],
    ['error+cooldown', { error: 'x', resendCooldown: 600 }],
    ['consentOpen', { consentOpen: true }],
  ])('field-level leak check: %s alone changes nothing in live mode', (_name, fixture) => {
    const a = renderLiveForm();
    const htmlWithout = a.container.innerHTML;
    a.unmount();
    const b = renderLiveForm({ previewFixture: fixture });
    expect(b.container.innerHTML).toBe(htmlWithout);
  });

  it('CONSUMES the fixture when previewMode is on (sanity inverse — gates skipped, verified state shown)', () => {
    renderLiveForm({
      previewMode: true,
      previewFixture: { eligibility: 'eligible', advisorAck: 'public', formData: SAMPLE_FORM_DATA, otpState: 'verified' },
    });
    expect(screen.queryByText('Are you a Singapore Citizen or Permanent Resident?')).not.toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sarah Tan')).toBeInTheDocument();
  });
});

describe('QuizGate / CampaignQuiz — previewFixture is INERT in live mode', () => {
  it('QuizGate ignores done:true in live mode (quiz still gates the form)', () => {
    render(
      <QuizGate quiz={QUIZ} themeColor="#D17029" previewFixture={{ done: true }}>
        <div data-testid="the-form" />
      </QuizGate>
    );
    expect(screen.queryByTestId('the-form')).not.toBeInTheDocument();
    expect(screen.getByText('Take the quiz')).toBeInTheDocument();
  });

  it('CampaignQuiz ignores phase/result fixtures in live mode (stays on intro)', () => {
    render(
      <CampaignQuiz
        quiz={QUIZ}
        themeColor="#D17029"
        previewFixture={{ phase: 'result', result: { profileId: 'p1' }, stepIdx: 0, answers: [] }}
      />
    );
    expect(screen.getByText('Take the quiz')).toBeInTheDocument();
    expect(screen.queryByText('Profile One')).not.toBeInTheDocument();
  });

  it('QuizGate consumes done:true under previewMode (sanity inverse)', () => {
    render(
      <QuizGate quiz={QUIZ} themeColor="#D17029" previewMode previewFixture={{ done: true }}>
        <div data-testid="the-form" />
      </QuizGate>
    );
    expect(screen.getByTestId('the-form')).toBeInTheDocument();
  });
});
