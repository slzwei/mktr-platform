import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CampaignQuiz, { QuizGate } from '../CampaignQuiz';

afterEach(cleanup);

// Small self-contained quiz (the shared scoring fixtures intentionally omit
// labels/intro/reveal copy). 2 questions × 2 profiles is enough to exercise
// intro → auto-advance → reveal → onComplete.
const QUIZ = {
  enabled: true,
  quizId: 'test-quiz',
  version: 1,
  intro: { headline: 'What are you?', subhead: 'Quick quiz', ctaLabel: 'Begin' },
  scoring: {
    method: 'profile-sum',
    tiebreak: 'prepared-first',
    profileOrder: ['a', 'b'],
    readiness: { enabled: true, label: 'Readiness', rankFactor: { a: 1, b: 0 } },
  },
  reveal: { alwaysShowGap: true, gapTemplate: 'Still {gap}% to go.', valueExchange: 'Send my result?' },
  steps: [
    { id: 's1', questions: [{ id: 'q1', prompt: 'Pick one', weight: 1, options: [
      { id: 'a1', label: 'Option Ay', scores: { a: 1 } },
      { id: 'b1', label: 'Option Bee', scores: { b: 1 } },
    ] }] },
    { id: 's2', questions: [{ id: 'q2', prompt: 'Pick again', weight: 1, options: [
      { id: 'a2', label: 'Ay two', scores: { a: 1 } },
      { id: 'b2', label: 'Bee two', scores: { b: 1 } },
    ] }] },
  ],
  resultProfiles: [
    { id: 'a', title: 'The Ayyy', description: 'desc a', themeColor: '#0F9D58', ctaLabel: 'Get mine' },
    { id: 'b', title: 'The Beee', description: 'desc b', themeColor: '#DB4437', ctaLabel: 'Get mine' },
  ],
};

describe('CampaignQuiz', () => {
  it('runs intro → questions → reveal and calls onComplete with answers + scored result', async () => {
    const onComplete = vi.fn();
    render(<CampaignQuiz quiz={QUIZ} themeColor="#0F9D58" onComplete={onComplete} />);

    // Intro
    expect(screen.getByText('What are you?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Begin'));

    // Q1 → choose the "a" option (auto-advances after a short delay)
    expect(await screen.findByText('Pick one')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Option Ay'));

    // Q2 → choose the "a" option
    expect(await screen.findByText('Pick again')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ay two'));

    // Reveal: profile A wins (2-0), readiness 100%, gap 0%
    expect(await screen.findByText('The Ayyy')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Still 0% to go.')).toBeInTheDocument();
    expect(screen.getByText('Send my result?')).toBeInTheDocument();

    // CTA → onComplete with raw answers + the client-scored result
    fireEvent.click(screen.getByText('Get mine'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const arg = onComplete.mock.calls[0][0];
    expect(arg.quizId).toBe('test-quiz');
    expect(arg.version).toBe(1);
    expect(arg.answers).toEqual([
      { qid: 'q1', value: 'a1' },
      { qid: 'q2', value: 'a2' },
    ]);
    expect(arg.result.profileId).toBe('a');
    expect(arg.result.readiness).toBe(100);
  });

  it('scores the "b" path to the b profile', async () => {
    const onComplete = vi.fn();
    render(<CampaignQuiz quiz={QUIZ} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(await screen.findByText('Option Bee'));
    fireEvent.click(await screen.findByText('Bee two'));
    expect(await screen.findByText('The Beee')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Get mine'));
    expect(onComplete.mock.calls[0][0].result.profileId).toBe('b');
  });
});

describe('QuizGate', () => {
  it('renders the form directly when there is no enabled quiz', () => {
    render(
      <QuizGate quiz={{ enabled: false }}>
        <div>THE FORM</div>
      </QuizGate>
    );
    expect(screen.getByText('THE FORM')).toBeInTheDocument();
  });

  it('renders the form directly when quiz is undefined', () => {
    render(
      <QuizGate quiz={undefined}>
        <div>THE FORM</div>
      </QuizGate>
    );
    expect(screen.getByText('THE FORM')).toBeInTheDocument();
  });

  it('shows the quiz first, then reveals the form after completion', async () => {
    const onComplete = vi.fn();
    render(
      <QuizGate quiz={QUIZ} onComplete={onComplete}>
        <div>THE FORM</div>
      </QuizGate>
    );
    // Quiz is showing; form is gated.
    expect(screen.getByText('What are you?')).toBeInTheDocument();
    expect(screen.queryByText('THE FORM')).not.toBeInTheDocument();

    // Complete the quiz.
    fireEvent.click(screen.getByText('Begin'));
    fireEvent.click(await screen.findByText('Option Ay'));
    fireEvent.click(await screen.findByText('Ay two'));
    fireEvent.click(await screen.findByText('Get mine'));

    // Form now revealed; onComplete fired.
    expect(screen.getByText('THE FORM')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
