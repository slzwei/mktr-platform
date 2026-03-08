import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RecentActivity from '../RecentActivity';

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('RecentActivity', () => {
  it('shows empty state when no prospects', () => {
    renderWithRouter(<RecentActivity prospects={[]} />);
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
    expect(screen.getByText('View All Prospects')).toBeInTheDocument();
  });

  it('renders prospect rows with name and status', () => {
    const prospects = [
      { id: '1', name: 'Alice Johnson', status: 'new', createdAt: '2025-01-15T10:00:00Z' },
      { id: '2', name: 'Bob Smith', status: 'contacted', createdAt: '2025-01-14T09:00:00Z' },
    ];
    renderWithRouter(<RecentActivity prospects={prospects} />);
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Contacted')).toBeInTheDocument();
  });

  it('limits display to 8 prospects', () => {
    const prospects = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Prospect ${i}`,
      status: 'new',
      createdAt: '2025-01-15T10:00:00Z',
    }));
    renderWithRouter(<RecentActivity prospects={prospects} />);
    // Should show first 8, not Prospect 8-11
    expect(screen.getByText('Prospect 0')).toBeInTheDocument();
    expect(screen.getByText('Prospect 7')).toBeInTheDocument();
    expect(screen.queryByText('Prospect 8')).not.toBeInTheDocument();
  });
});
