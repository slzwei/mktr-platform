import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardHeader from '@/components/dashboard/DashboardHeader';

vi.mock('date-fns', async () => {
  const actual = await vi.importActual('date-fns');
  return {
    ...actual,
    format: (date, fmt) => {
      if (fmt === "EEEE, d MMMM yyyy") return 'Wednesday, 18 March 2026';
      return actual.format(date, fmt);
    },
  };
});

function renderHeader(props = {}) {
  return render(
    <MemoryRouter>
      <DashboardHeader {...props} />
    </MemoryRouter>
  );
}

describe('DashboardHeader', () => {
  it('renders default "Dashboard" title when no title or greeting', () => {
    renderHeader({});
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    renderHeader({ title: 'Fleet Overview' });
    expect(screen.getByText('Fleet Overview')).toBeInTheDocument();
  });

  it('renders greeting with user name', () => {
    renderHeader({ greeting: true, user: { full_name: 'Shawn', role: 'admin' } });
    expect(screen.getByText('Welcome back, Shawn!')).toBeInTheDocument();
  });

  it('falls back to title when greeting is true but user has no full_name', () => {
    renderHeader({ greeting: true, user: { role: 'admin' }, title: 'Admin Panel' });
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('renders role badge when provided', () => {
    renderHeader({ roleBadge: 'Sales Agent' });
    expect(screen.getByText('Sales Agent')).toBeInTheDocument();
  });

  it('does not render role badge when not provided', () => {
    renderHeader({});
    expect(screen.queryByText('Sales Agent')).not.toBeInTheDocument();
  });

  it('renders the current date', () => {
    renderHeader({});
    expect(screen.getByText(/March 2026/)).toBeInTheDocument();
  });

  it('renders period selector when period and onPeriodChange provided', () => {
    const onPeriodChange = vi.fn();
    renderHeader({
      period: '30d',
      onPeriodChange,
      periodOptions: { '7d': 'Last 7 days', '30d': 'Last 30 days' },
    });
    // The select trigger should show the current period
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('does not render period selector when period is not provided', () => {
    renderHeader({});
    expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument();
  });

  it('renders custom actions', () => {
    renderHeader({ actions: <button>Custom Action</button> });
    expect(screen.getByText('Custom Action')).toBeInTheDocument();
  });
});
