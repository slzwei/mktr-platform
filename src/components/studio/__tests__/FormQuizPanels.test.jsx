import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));

import useStudioDoc from '../useStudioDoc';
import FormPanel from '../panels/FormPanel';
import StudioQuizPanel from '../panels/QuizPanel';
import { STARTER_QUIZ } from '@/lib/quizTemplates';
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

describe('FormPanel — profile-question suggestions from the campaign brief (§6.4)', () => {
  const BRIEF = {
    briefVersion: 1,
    objective: 'agent_leads',
    product: 'insurance',
    audience: { language: 'zh', ageBands: ['45-59', '60+'] },
    archetype: 'plain_form',
  };

  it('no brief → no suggestion block', () => {
    render(<Harness v1={{}} Panel={FormPanel} />);
    expect(screen.queryByTestId('brief-question-suggestions')).toBeNull();
  });

  it('renders suggestions with reasons and NEVER auto-enables anything', () => {
    render(<Harness v1={{}} Panel={FormPanel} panelProps={{ campaignBrief: BRIEF }} />);
    const block = screen.getByTestId('brief-question-suggestions');
    expect(block.textContent).toContain('Which language do you prefer?');
    expect(block.textContent).toContain('What is your annual income range?');
    expect(block.textContent).toContain('At what age do you plan to retire?');
    // Rendering suggestions must not touch the doc — asking stays a human act.
    expect(latestDoc.profileQuestions?.enabled).not.toBe(true);
    expect(latestDoc.profileQuestions?.questionIds || []).toEqual([]);
  });

  it('one click adds exactly that question (enabling the section) — the human decision', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{}} Panel={FormPanel} panelProps={{ campaignBrief: BRIEF }} />);
    await user.click(screen.getByTestId('brief-suggest-add-annual_income'));
    expect(latestDoc.profileQuestions.enabled).toBe(true);
    expect(latestDoc.profileQuestions.questionIds).toEqual(['annual_income']);
    // The added question leaves the suggestion list; the others stay.
    expect(screen.queryByTestId('brief-suggest-add-annual_income')).toBeNull();
    expect(screen.getByTestId('brief-suggest-add-language')).toBeTruthy();
  });

  it('already-asked questions are not re-suggested', () => {
    render(
      <Harness
        v1={{ profileQuestions: { enabled: true, questionIds: ['language', 'annual_income'], requiredIds: [] } }}
        Panel={FormPanel}
        panelProps={{ campaignBrief: BRIEF }}
      />
    );
    expect(screen.queryByTestId('brief-suggest-add-language')).toBeNull();
    expect(screen.queryByTestId('brief-suggest-add-annual_income')).toBeNull();
    expect(screen.getByTestId('brief-suggest-add-retirement_age')).toBeTruthy();
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

// ── custom questions (studio-custom-questions §4) ──────────────────────────
import { useState } from 'react';
import { within } from '@testing-library/react';

let latestDraft = null;

function DraftHarness({ v1 }) {
  const campaign = { id: 'c1', name: 'FairPrice Voucher', type: 'lead_generation', design_config: v1 };
  const s = useStudioDoc(campaign);
  const [cqDraft, setCqDraft] = useState(null);
  latestDoc = s.doc;
  latestDraft = cqDraft;
  if (!s.doc) return null;
  return <FormPanel doc={s.doc} setPath={s.setPath} mut={s.mut} cqDraft={cqDraft} onCqDraftChange={setCqDraft} />;
}

describe('FormPanel — custom questions (studio-custom-questions §4)', () => {
  const CUSTOM_PQ = {
    enabled: true,
    questionIds: ['language', 'c_aaa111', 'c_bbb222'],
    requiredIds: ['c_aaa111', 'language'],
    showZh: false,
    custom: [
      { id: 'c_aaa111', type: 'single', prompt: 'Showroom?', options: [{ id: 'o1', label: 'East' }, { id: 'o2', label: 'West' }] },
      { id: 'c_bbb222', type: 'text', prompt: 'Notes?', options: [] },
    ],
  };

  it('the preservation matrix: master toggle, library tick, and required toggle never destroy the rest of the subtree', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ profileQuestions: CUSTOM_PQ }} Panel={FormPanel} />);

    // Master toggle OFF: requiredIds/showZh/custom all survive (the old
    // rebuild dropped requiredIds + showZh and would have deleted custom).
    await user.click(screen.getByRole('switch', { name: /Ask profile questions/ }));
    expect(latestDoc.profileQuestions).toEqual({ ...CUSTOM_PQ, enabled: false });
    await user.click(screen.getByRole('switch', { name: /Ask profile questions/ }));
    expect(latestDoc.profileQuestions).toEqual(CUSTOM_PQ);

    // Library untick: custom block untouched; the library requiredId follows.
    await user.click(screen.getByRole('switch', { name: /Which language do you prefer/ }));
    expect(latestDoc.profileQuestions.questionIds).toEqual(['c_aaa111', 'c_bbb222']);
    expect(latestDoc.profileQuestions.requiredIds).toEqual(['c_aaa111']);
    expect(latestDoc.profileQuestions.custom).toEqual(CUSTOM_PQ.custom);
    expect(latestDoc.profileQuestions.showZh).toBe(false);
  });

  it('authoring: Add opens a page-owned draft; commit is gated on completeness; commit writes def + id atomically', async () => {
    const user = userEvent.setup();
    render(<DraftHarness v1={{ profileQuestions: { enabled: true, questionIds: ['language'], requiredIds: [] } }} />);

    await user.click(screen.getByTestId('custom-question-add'));
    expect(latestDraft).not.toBeNull();
    const draftBox = screen.getByTestId('custom-question-draft');
    expect(screen.getByTestId('custom-question-draft-commit')).toBeDisabled();

    await user.type(within(draftBox).getByLabelText('Question prompt'), 'Which outlet?');
    expect(screen.getByTestId('custom-question-draft-commit')).toBeDisabled(); // options still unlabelled
    await user.click(within(draftBox).getByRole('button', { name: 'Short text' }));
    expect(screen.getByTestId('custom-question-draft-commit')).toBeEnabled();

    await user.click(screen.getByTestId('custom-question-draft-commit'));
    expect(latestDraft).toBeNull();
    expect(screen.queryByTestId('custom-question-draft')).toBeNull();
    const custom = latestDoc.profileQuestions.custom;
    expect(custom).toHaveLength(1);
    expect(custom[0].type).toBe('text');
    expect(custom[0].prompt).toBe('Which outlet?');
    expect(latestDoc.profileQuestions.questionIds).toEqual(['language', custom[0].id]);
  });

  it('Add question is disabled at the 5-question cap — a sixth can never enter the doc', () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ id: `c_q${n}00000`, type: 'text', prompt: `Q${n}`, options: [] }));
    render(<DraftHarness v1={{ profileQuestions: { enabled: true, questionIds: five.map((q) => q.id), requiredIds: [], custom: five } }} />);
    expect(screen.getByTestId('custom-question-add')).toBeDisabled();
    expect(screen.getByText(/Limit of 5 custom questions/)).toBeTruthy();
  });

  it('delete cleans questionIds + requiredIds; reorder moves within the custom segment only', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ profileQuestions: CUSTOM_PQ }} Panel={FormPanel} />);

    await user.click(screen.getByRole('button', { name: 'Move question 1 down' }));
    expect(latestDoc.profileQuestions.questionIds).toEqual(['language', 'c_bbb222', 'c_aaa111']);
    expect(latestDoc.profileQuestions.custom.map((q) => q.id)).toEqual(['c_bbb222', 'c_aaa111']);

    await user.click(screen.getByRole('button', { name: 'Delete question 2' }));
    expect(latestDoc.profileQuestions.questionIds).toEqual(['language', 'c_bbb222']);
    expect(latestDoc.profileQuestions.requiredIds).toEqual(['language']);
    expect(latestDoc.profileQuestions.custom.map((q) => q.id)).toEqual(['c_bbb222']);
  });

  it('an incomplete EDIT of a committed question stays local — the doc keeps the last complete value, with a badge', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ profileQuestions: CUSTOM_PQ }} Panel={FormPanel} />);
    const row = screen.getByTestId('custom-question-c_aaa111');
    const promptInput = within(row).getByLabelText('Question prompt');
    await user.clear(promptInput);
    expect(latestDoc.profileQuestions.custom.find((q) => q.id === 'c_aaa111').prompt).toBe('Showroom?');
    expect(within(row).getByText('incomplete — not saved')).toBeTruthy();
    await user.type(promptInput, 'Which branch?');
    expect(latestDoc.profileQuestions.custom.find((q) => q.id === 'c_aaa111').prompt).toBe('Which branch?');
  });

  it('the Required toggle on a custom question writes the shared requiredIds', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ profileQuestions: { ...CUSTOM_PQ, requiredIds: [] } }} Panel={FormPanel} />);
    const row = screen.getByTestId('custom-question-c_bbb222');
    await user.click(within(row).getByRole('switch', { name: /Required/ }));
    expect(latestDoc.profileQuestions.requiredIds).toEqual(['c_bbb222']);
  });
});
