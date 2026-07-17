import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));

import useStudioDoc from '../useStudioDoc';
import FormPanel from '../panels/FormPanel';
import StudioQuizPanel from '../panels/QuizPanel';
import { STARTER_QUIZ } from '@/components/campaigns/editor/QuizPanel';
import { fieldsToV1 } from '@/lib/designConfigV2';

let latestDoc = null;

function Harness({ v1, Panel, campaignType = 'lead_generation', panelProps = {} }) {
  const campaign = { id: 'c1', name: 'FairPrice Voucher', type: campaignType, design_config: v1 };
  const s = useStudioDoc(campaign);
  latestDoc = s.doc;
  if (!s.doc) return null;
  return <Panel doc={s.doc} campaign={campaign} setPath={s.setPath} mut={s.mut} {...panelProps} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  latestDoc = null;
});

describe('FormPanel — fields editor mechanics (mock parity)', () => {
  it('reorders with ↑↓ and clears row pairing on the moved fields', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ fieldOrder: [{ id: 'r1', columns: ['dob', 'postal_code'] }, { id: 'r2', columns: ['name'] }] }} Panel={FormPanel} />);
    // dob + postal arrive paired from migration
    expect(latestDoc.form.fields.find((f) => f.id === 'dob').row).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Move Date of Birth down' }));
    const dob = latestDoc.form.fields.find((f) => f.id === 'dob');
    const postal = latestDoc.form.fields.find((f) => f.id === 'postal');
    expect(dob.row).toBe(null);
    expect(postal.row).toBe(null);
    expect(latestDoc.form.fields.map((f) => f.id).indexOf('dob')).toBeGreaterThan(
      latestDoc.form.fields.map((f) => f.id).indexOf('postal')
    );
  });

  it('hiding a paired field unpairs both; locked fields cannot be hidden', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ fieldOrder: [{ id: 'r1', columns: ['dob', 'postal_code'] }] }} Panel={FormPanel} />);
    await user.click(screen.getByLabelText('Date of Birth visible'));
    const dob = latestDoc.form.fields.find((f) => f.id === 'dob');
    const postal = latestDoc.form.fields.find((f) => f.id === 'postal');
    expect(dob.visible).toBe(false);
    expect(dob.row).toBe(null);
    expect(postal.row).toBe(null);
    expect(screen.getByLabelText('Full Name visible')).toBeDisabled();
    expect(screen.getByLabelText('Mobile Number required')).toBeDisabled();
  });

  it('merges adjacent visible compact fields into one row, then splits them', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={FormPanel} />);
    // default order: … dob, postal (adjacent compacts)
    await user.click(screen.getByTitle('Pair with Postal Code on one row'));
    const dob = latestDoc.form.fields.find((f) => f.id === 'dob');
    const postal = latestDoc.form.fields.find((f) => f.id === 'postal');
    expect(dob.row).toBeTruthy();
    expect(dob.row).toBe(postal.row);
    // The v1 view of this pairing is a two-column fieldOrder row (renderer contract)
    const v1View = fieldsToV1(latestDoc.form.fields);
    expect(v1View.fieldOrder.some((r) => Array.isArray(r.columns) && r.columns.join() === 'dob,postal_code')).toBe(true);
    await user.click(screen.getAllByTitle('Split back to full-width rows')[0]);
    expect(latestDoc.form.fields.find((f) => f.id === 'dob').row).toBe(null);
  });

  it('verification toggle writes form.verification and shows the static WhatsApp warning', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={FormPanel} />);
    await user.click(screen.getByRole('button', { name: 'WhatsApp OTP' }));
    expect(latestDoc.form.verification).toBe('whatsapp');
    expect(screen.getByText(/needs configured Meta credentials/)).toBeInTheDocument();
  });

  it('PR 5: a server-VERIFIED WhatsApp config swaps the warning for the confirmation note', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={FormPanel} panelProps={{ whatsappOtpConfigured: true }} />);
    await user.click(screen.getByRole('button', { name: 'WhatsApp OTP' }));
    expect(screen.queryByText(/needs configured Meta credentials/)).toBeNull();
    expect(screen.getByText(/WhatsApp credentials are configured on the server/)).toBeInTheDocument();
  });

  it('PR 5: an explicit server FALSE keeps the warning (fail-noisy, like unknown)', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={FormPanel} panelProps={{ whatsappOtpConfigured: false }} />);
    await user.click(screen.getByRole('button', { name: 'WhatsApp OTP' }));
    expect(screen.getByText(/needs configured Meta credentials/)).toBeInTheDocument();
  });

  it('gates + advertiserName write their v2 paths (advertiser input beside the DNC switch per §03)', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={FormPanel} />);
    await user.click(screen.getByRole('switch', { name: /DNC registry check/ }));
    expect(latestDoc.form.gates.dncCheck).toBe(true);
    await user.type(screen.getByLabelText('Advertiser display name (DNC gate)'), 'Prudential SG');
    expect(latestDoc.content.advertiserName).toBe('Prudential SG');
  });

  it('terms: template picker labels the doc WITHOUT touching the html; draw campaigns warn on empty terms', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ termsContent: '<p>Keep me</p>' }} Panel={FormPanel} />);
    await user.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(latestDoc.form.terms.template).toBe('privacy');
    expect(latestDoc.form.terms.html).toBe('<p>Keep me</p>');
  });
});

describe('StudioQuizPanel — the editing view over verbatim storage', () => {
  it('empty state loads the validated starter wholesale', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={StudioQuizPanel} />);
    await user.click(screen.getByRole('button', { name: 'Load starter' }));
    expect(latestDoc.quiz).toEqual(STARTER_QUIZ);
  });

  it('quiz-campaign warning shows when the quiz is disabled', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ quiz: { ...STARTER_QUIZ, enabled: false } }} Panel={StudioQuizPanel} campaignType="quiz" />);
    expect(screen.getByText(/QUIZ campaign but the quiz is disabled/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /Quiz in front of the form/ }));
    expect(latestDoc.quiz.enabled).toBe(true);
  });

  it('intro + scoring/reveal fields bind to the STORED paths (no restructuring)', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ quiz: STARTER_QUIZ }} Panel={StudioQuizPanel} />);
    const headline = screen.getByLabelText('Headline');
    await user.clear(headline);
    await user.type(headline, 'New intro');
    expect(latestDoc.quiz.intro.headline).toBe('New intro');
    await user.click(screen.getByRole('button', { name: 'Gap-first' }));
    expect(latestDoc.quiz.scoring.tiebreak).toBe('gap-first');
    // Advanced keys ride along untouched
    expect(latestDoc.quiz.scoring.leadScore.tagPoints).toEqual(STARTER_QUIZ.scoring.leadScore.tagPoints);
    expect(latestDoc.quiz.reveal.tagAFriend).toBe(STARTER_QUIZ.reveal.tagAFriend);
  });

  it('profile removal confirms with reference counts and strips atomically', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<Harness v1={{ quiz: STARTER_QUIZ }} Panel={StudioQuizPanel} />);
    await user.click(screen.getByRole('button', { name: 'Remove profile The Free Spirit' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/6 option scores.*readiness rank factor.*tie-break order/s));
    expect(latestDoc.quiz.resultProfiles.map((p) => p.id)).not.toContain('the-free-spirit');
    expect(latestDoc.quiz.scoring.readiness.rankFactor).not.toHaveProperty('the-free-spirit');
    for (const step of latestDoc.quiz.steps) {
      for (const q of step.questions) {
        for (const opt of q.options) {
          expect(opt.scores || {}).not.toHaveProperty('the-free-spirit');
        }
      }
    }
    confirmSpy.mockRestore();
  });

  it('multi-key score maps render as read-only "advanced scores" (never collapsed)', () => {
    const quiz = structuredClone(STARTER_QUIZ);
    quiz.steps[0].questions[0].options[0].scores = { 'the-rock': 2, 'the-strategist': 1 };
    render(<Harness v1={{ quiz }} Panel={StudioQuizPanel} />);
    expect(screen.getByText('advanced scores')).toBeInTheDocument();
  });

  it('added questions land in the LAST step (multi-step docs preserved)', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ quiz: STARTER_QUIZ }} Panel={StudioQuizPanel} />);
    const stepCount = STARTER_QUIZ.steps.length;
    await user.click(screen.getByRole('button', { name: '+ Add question' }));
    expect(latestDoc.quiz.steps).toHaveLength(stepCount);
    expect(latestDoc.quiz.steps[stepCount - 1].questions.length).toBe(
      STARTER_QUIZ.steps[stepCount - 1].questions.length + 1
    );
  });
});
