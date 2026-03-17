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

  it('renders ranked agents with names and conversion rates', () => {
    const prospects = [
      {
        id: '1',
        assignedAgentId: 'agent-1234-abcd',
        assignedAgent: { firstName: 'Alice', lastName: 'Tan' },
        leadStatus: 'close_won',
      },
      {
        id: '2',
        assignedAgentId: 'agent-1234-abcd',
        assignedAgent: { firstName: 'Alice', lastName: 'Tan' },
        leadStatus: 'contacted',
      },
      {
        id: '3',
        assignedAgentId: 'agent-1234-abcd',
        assignedAgent: { firstName: 'Alice', lastName: 'Tan' },
        leadStatus: 'close_won',
      },
      {
        id: '4',
        assignedAgentId: 'agent-5678-efgh',
        assignedAgent: { firstName: 'Bob', lastName: 'Lim' },
        leadStatus: 'new',
      },
    ];
    render(<TopPerformers prospects={prospects} />);

    // Agent 1: Alice Tan, 3 prospects, 2 won => 67% rate
    expect(screen.getByText('Alice Tan')).toBeInTheDocument();
    expect(screen.getByText('2 won')).toBeInTheDocument();
    expect(screen.getByText('67% rate')).toBeInTheDocument();
    expect(screen.getByText('3 prospects')).toBeInTheDocument();

    // Agent 2: Bob Lim, 1 prospect, 0 won => 0% rate
    expect(screen.getByText('Bob Lim')).toBeInTheDocument();
    expect(screen.getByText('0 won')).toBeInTheDocument();
    expect(screen.getByText('0% rate')).toBeInTheDocument();
  });

  it('excludes prospects with no agent record (orphaned/deleted agents)', () => {
    const prospects = [
      { id: '1', assignedAgentId: 'orphan-99-xxxx', leadStatus: 'won' },
      {
        id: '2',
        assignedAgentId: 'real-agent-id',
        assignedAgent: { firstName: 'Alice', lastName: 'Tan' },
        leadStatus: 'new',
      },
    ];
    render(<TopPerformers prospects={prospects} />);
    expect(screen.queryByText(/orphan/i)).not.toBeInTheDocument();
    expect(screen.getByText('Alice Tan')).toBeInTheDocument();
  });

  it('excludes the system agent from rankings', () => {
    const prospects = [
      {
        id: '1',
        assignedAgentId: 'sys-agent-id',
        assignedAgent: { email: 'system@mktr.local', firstName: 'System', lastName: 'Agent' },
        leadStatus: 'won',
      },
      {
        id: '2',
        assignedAgentId: 'real-agent-id',
        assignedAgent: { firstName: 'Alice', lastName: 'Tan' },
        leadStatus: 'new',
      },
    ];
    render(<TopPerformers prospects={prospects} />);

    expect(screen.queryByText('System Agent')).not.toBeInTheDocument();
    expect(screen.getByText('Alice Tan')).toBeInTheDocument();
  });
});
