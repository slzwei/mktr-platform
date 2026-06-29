import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import ActivityTimeline from '../ActivityTimeline';

afterEach(cleanup);

describe('ActivityTimeline (unified web feed)', () => {
  it('renders the merged timeline — MKTR lifecycle + agent engagement — with titles, notes, outcome', () => {
    const details = {
      timeline: [
        { origin: 'app', row: { id: 'a1', type: 'call', description: 'Spoke briefly', metadata: { outcome: 'Interested' }, created_at: '2026-06-28T09:00:00Z' } },
        { origin: 'mktr', row: { id: 'm1', type: 'created', description: 'Signed up via Instagram ad', metadata: {}, createdAt: '2026-06-28T08:00:00Z' } },
      ],
    };
    render(<ActivityTimeline details={details} prospect={{ source: 'Instagram' }} campaign={{ name: 'June' }} />);
    expect(screen.getByText('Signed up via Instagram ad')).toBeTruthy(); // MKTR created
    expect(screen.getByText('Call')).toBeTruthy(); // canonical title for the agent call
    expect(screen.getByText('Spoke briefly')).toBeTruthy(); // its note
    expect(screen.getByText('Interested')).toBeTruthy(); // its outcome
    expect(screen.getByText('Start of History')).toBeTruthy();
  });

  it('shows the empty state when there is no activity', () => {
    render(<ActivityTimeline details={{ timeline: [] }} prospect={{}} campaign={{}} />);
    expect(screen.getByText('No activity recorded yet.')).toBeTruthy();
  });

  it('falls back to ProspectActivity-only when the backend merge is absent', () => {
    const details = { activities: [{ id: 'm1', type: 'created', description: 'Prospect signed up', metadata: {}, createdAt: '2026-06-28T08:00:00Z' }] };
    render(<ActivityTimeline details={details} prospect={{ source: 'QR' }} campaign={{ name: 'X' }} />);
    expect(screen.getByText('Prospect signed up')).toBeTruthy();
  });
});
