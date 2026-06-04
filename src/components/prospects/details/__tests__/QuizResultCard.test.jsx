import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import QuizResultCard from '../QuizResultCard';

afterEach(cleanup);

const summary = {
  quizId: 'protection-personality',
  version: 2,
  profileId: 'the-rock',
  title: 'The Rock',
  readiness: 67,
  agentAngle: 'optimise / legacy',
  leadScore: { points: 8, band: 'Hot', badge: '🔥' },
  answers: [{ qid: 'q3_circle', value: 'family', tag: 'family-dependents' }],
  scoredBy: 'server',
  verified: true,
};

describe('QuizResultCard', () => {
  it('renders nothing without a summary', () => {
    const { container } = render(<QuizResultCard summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows profile, lead-score band, readiness and angle, and toggles answers', () => {
    render(<QuizResultCard summary={summary} />);
    expect(screen.getByText('The Rock')).toBeInTheDocument();
    expect(screen.getByText(/Hot/)).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText(/optimise/)).toBeInTheDocument();

    // Answers are collapsed by default, revealed on toggle.
    expect(screen.getByText(/Show answers/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show answers/));
    expect(screen.getByText(/Hide answers/)).toBeInTheDocument();
  });

  it('flags a client-unverified result', () => {
    render(<QuizResultCard summary={{ ...summary, verified: false }} />);
    expect(screen.getByText(/not server-verified/i)).toBeInTheDocument();
  });
});
