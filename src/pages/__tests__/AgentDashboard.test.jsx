import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector) => {
    const mockUser = { id: 'u1', role: 'agent', full_name: 'Agent Smith' };
    if (typeof selector === 'function') return selector({ user: mockUser });
    return { user: mockUser };
  },
}));

vi.mock('@/api/entities', () => ({
  Prospect: {
    filter: vi.fn().mockResolvedValue([
      { id: 'p1', firstName: 'Alice', lastName: 'Chen', leadStatus: 'new', created_date: new Date().toISOString() },
      { id: 'p2', firstName: 'Bob', lastName: 'Tan', leadStatus: 'contacted', created_date: new Date().toISOString() },
      {
        id: 'p3',
        firstName: 'Carol',
        lastName: 'Lee',
        leadStatus: 'close_won',
        created_date: new Date().toISOString(),
      },
    ]),
  },
}));

vi.mock('@/hooks/queries/useProspectsQuery', () => ({
  useUpdateProspect: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('date-fns', async () => {
  const actual = await vi.importActual('date-fns');
  return {
    ...actual,
    formatDistanceToNow: () => '2 days',
    format: (date, fmt) => actual.format(date, fmt),
  };
});

// Mock child components to isolate page tests
vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ loading, error, children }) => {
    if (loading) return <div data-testid="loading">Loading...</div>;
    if (error) return <div data-testid="error">{error}</div>;
    return <div data-testid="dashboard-shell">{children}</div>;
  },
}));
vi.mock('@/components/dashboard/DashboardHeader', () => ({
  default: ({ user, roleBadge }) => (
    <div data-testid="dashboard-header">
      <span>{user?.full_name}</span>
      <span>{roleBadge}</span>
    </div>
  ),
}));
vi.mock('@/components/dashboard/ResponsiveStatsGrid', () => ({
  default: ({ cards }) => (
    <div data-testid="stats-grid">
      {cards?.map((c) => (
        <div key={c.title}>
          {c.title}: {c.value}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/RecentActivity', () => ({
  default: () => <div data-testid="recent-activity">Recent Activity</div>,
}));
vi.mock('@/components/dashboard/ProspectKanban', () => ({
  default: ({ prospects }) => <div data-testid="kanban">Kanban: {prospects.length}</div>,
}));
vi.mock('@/components/agents/MyLeadPackages', () => ({
  default: () => <div data-testid="lead-packages">Lead Packages</div>,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args) => args.filter(Boolean).join(' '),
}));

import AgentDashboard from '../AgentDashboard';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AgentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dashboard shell', async () => {
    renderPage();
    expect(await screen.findByTestId('dashboard-shell')).toBeInTheDocument();
  });

  it('renders DashboardHeader with user name', async () => {
    renderPage();
    expect(await screen.findByText('Agent Smith')).toBeInTheDocument();
  });

  it('shows Sales Agent role badge', async () => {
    renderPage();
    expect(await screen.findByText('Sales Agent')).toBeInTheDocument();
  });

  it('renders stats grid', async () => {
    renderPage();
    expect(await screen.findByTestId('stats-grid')).toBeInTheDocument();
  });

  it('renders My Prospects stat card', async () => {
    renderPage();
    expect(await screen.findByText(/My Prospects/)).toBeInTheDocument();
  });

  it('renders Closed Won stat card', async () => {
    renderPage();
    expect(await screen.findByText(/Closed Won/)).toBeInTheDocument();
  });

  it('renders Active Prospects stat card', async () => {
    renderPage();
    expect(await screen.findByText(/Active Prospects/)).toBeInTheDocument();
  });

  it('renders Pipeline tab', async () => {
    renderPage();
    expect(await screen.findByText('Pipeline')).toBeInTheDocument();
  });

  it('renders List tab', async () => {
    renderPage();
    expect(await screen.findByText('List')).toBeInTheDocument();
  });

  it('renders ProspectKanban in pipeline view by default', async () => {
    renderPage();
    expect(await screen.findByTestId('kanban')).toBeInTheDocument();
  });

  it('renders Overdue Follow-ups section', async () => {
    renderPage();
    expect(await screen.findByText('Overdue Follow-ups')).toBeInTheDocument();
  });

  it('shows "All caught up!" when no overdue prospects', async () => {
    renderPage();
    expect(await screen.findByText('All caught up!')).toBeInTheDocument();
  });

  it('renders MyLeadPackages component', async () => {
    renderPage();
    expect(await screen.findByTestId('lead-packages')).toBeInTheDocument();
  });

  it('renders kanban with correct prospect count', async () => {
    renderPage();
    expect(await screen.findByText('Kanban: 3')).toBeInTheDocument();
  });

  it('calculates correct total prospects count', async () => {
    renderPage();
    expect(await screen.findByText('My Prospects: 3')).toBeInTheDocument();
  });
});
