import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TopPerformers from '../TopPerformers';

describe('TopPerformers', () => {
  it('shows "No conversion data yet" when prospects is empty', () => {
    render(<TopPerformers prospects={[]} />);
    expect(screen.getByText('No conversion data yet')).toBeInTheDocument();
  });

  it('shows "No conversion data yet" when prospects have no assigned agents', () => {
    const prospects = [
      { id: '1', leadStatus: 'new' },
      { id: '2', leadStatus: 'contacted' },
    ];
    render(<TopPerformers prospects={prospects} />);
    expect(screen.getByText('No conversion data yet')).toBeInTheDocument();
  });

  it('renders ranked agents with conversion rates', () => {
    const prospects = [
      { id: '1', assignedAgentId: 'agent-1234-abcd', leadStatus: 'close_won' },
      { id: '2', assignedAgentId: 'agent-1234-abcd', leadStatus: 'contacted' },
      { id: '3', assignedAgentId: 'agent-1234-abcd', leadStatus: 'close_won' },
      { id: '4', assignedAgentId: 'agent-5678-efgh', leadStatus: 'new' },
    ];
    render(<TopPerformers prospects={prospects} />);

    // Agent 1: id.slice(0,8) = "agent-12", 3 prospects, 2 won => 67% rate
    expect(screen.getByText('Agent agent-12')).toBeInTheDocument();
    expect(screen.getByText('2 won')).toBeInTheDocument();
    expect(screen.getByText('67% rate')).toBeInTheDocument();
    expect(screen.getByText('3 prospects')).toBeInTheDocument();

    // Agent 2: id.slice(0,8) = "agent-56", 1 prospect, 0 won => 0% rate
    expect(screen.getByText('Agent agent-56')).toBeInTheDocument();
    expect(screen.getByText('0 won')).toBeInTheDocument();
    expect(screen.getByText('0% rate')).toBeInTheDocument();
  });
});
