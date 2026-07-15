import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mocks ---
const mockUser = { id: 'u-1', role: 'admin', firstName: 'Admin' };
vi.mock('@/stores/authStore', () => ({
 useAuthStore: (selector) => {
 if (typeof selector === 'function') return selector({ user: mockUser });
 return { user: mockUser };
 },
}));

const mockDashboardData = {
 prospects: [],
 campaigns: [],
 overview: null,
 isLoading: false,
 error: null,
};
vi.mock('@/hooks/queries/useDashboardQuery', () => ({
 useDashboardData: () => mockDashboardData,
}));

// Mock child components to keep tests focused on the page logic
vi.mock('@/components/dashboard/DashboardShell', () => ({
 default: ({ loading, error, onRetry, children }) => {
 if (loading) return <div data-testid="loading-shell">Loading...</div>;
 if (error)
 return (
 <div data-testid="error-shell">
 <span>{error}</span>
 <button onClick={onRetry}>Try Again</button>
 </div>
 );
 return <div data-testid="dashboard-shell">{children}</div>;
 },
}));

vi.mock('@/components/dashboard/DashboardHeader', () => ({
 default: ({ title, period, onPeriodChange, onRefresh, actions }) => (
 <div data-testid="dashboard-header">
 <h1>{title}</h1>
 <span data-testid="period">{period}</span>
 <button data-testid="period-7d" onClick={() => onPeriodChange('7d')}>
 7d
 </button>
 <button data-testid="period-30d" onClick={() => onPeriodChange('30d')}>
 30d
 </button>
 <button data-testid="refresh-btn" onClick={onRefresh}>
 Refresh
 </button>
 {actions}
 </div>
 ),
}));

vi.mock('@/components/dashboard/ResponsiveStatsGrid', () => ({
 default: ({ cards, loading }) => (
 <div data-testid="stats-grid">
 {!loading &&
 cards.map((c, i) => (
 <div key={i} data-testid={`stat-card-${i}`}>
 <span data-testid={`stat-title-${i}`}>{c.title}</span>
 <span data-testid={`stat-value-${i}`}>{c.value}</span>
 </div>
 ))}
 </div>
 ),
}));

vi.mock('@/components/dashboard/DashboardCharts', () => ({
 default: () => <div data-testid="dashboard-charts">Charts</div>,
}));

vi.mock('@/components/dashboard/RecentActivity', () => ({
 default: ({ prospects }) => <div data-testid="recent-activity">{prospects.length} recent prospects</div>,
}));

vi.mock('@/components/dashboard/TopPerformers', () => ({
 default: ({ prospects: _prospects }) => <div data-testid="top-performers">TopPerformers</div>,
}));

vi.mock('@/components/dashboard/AttentionNeeded', () => ({
 default: () => <div data-testid="attention-needed">AttentionNeeded</div>,
}));

import AdminDashboard from '../AdminDashboard';

function createQueryClient() {
 return new QueryClient({
 defaultOptions: { queries: { retry: false } },
 });
}

function renderDashboard() {
 const qc = createQueryClient();
 return render(
 <QueryClientProvider client={qc}>
 <MemoryRouter>
 <AdminDashboard />
 </MemoryRouter>
 </QueryClientProvider>
 );
}

describe('AdminDashboard', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 // Reset to defaults
 Object.assign(mockDashboardData, {
 prospects: [],
 campaigns: [],
 overview: {
 stats: {
 prospects: { total: 150, new: 12 },
 campaigns: { total: 10, active: 7 },
 },
 },
 isLoading: false,
 error: null,
 });
 });

 // --- Loading state ---
 it('shows loading shell when data is loading', () => {
 mockDashboardData.isLoading = true;
 renderDashboard();
 expect(screen.getByTestId('loading-shell')).toBeInTheDocument();
 });

 // --- Error state ---
 it('shows error shell when there is an error', () => {
 mockDashboardData.error = { message: 'Server error' };
 renderDashboard();
 expect(screen.getByTestId('error-shell')).toBeInTheDocument();
 expect(screen.getByText('Server error')).toBeInTheDocument();
 });

 it('shows Try Again button in error state', () => {
 mockDashboardData.error = { message: 'Failed' };
 renderDashboard();
 expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
 });

 // --- Main content ---
 it('renders dashboard header with title', () => {
 renderDashboard();
 expect(screen.getByText('Dashboard')).toBeInTheDocument();
 });

 it('renders stats grid with 2 stat cards (fleet-era cards removed)', () => {
 renderDashboard();
 expect(screen.getByTestId('stats-grid')).toBeInTheDocument();
 // buildAdminCards returns 2 cards since the Phase D teardown
 expect(screen.getByTestId('stat-card-0')).toBeInTheDocument();
 expect(screen.getByTestId('stat-card-1')).toBeInTheDocument();
 expect(screen.queryByTestId('stat-card-2')).not.toBeInTheDocument();
 });

 it('shows Active Campaigns card', () => {
 renderDashboard();
 expect(screen.getByTestId('stat-title-0')).toHaveTextContent('Active Campaigns');
 expect(screen.getByTestId('stat-value-0')).toHaveTextContent('7');
 });

 it('shows Total Prospects card', () => {
 renderDashboard();
 expect(screen.getByTestId('stat-title-1')).toHaveTextContent('Total Prospects');
 expect(screen.getByTestId('stat-value-1')).toHaveTextContent('150');
 });

 it('does not render retired Revenue / Fleet / Impressions cards', () => {
 renderDashboard();
 expect(screen.queryByText('Total Revenue')).not.toBeInTheDocument();
 expect(screen.queryByText('Fleet Size')).not.toBeInTheDocument();
 expect(screen.queryByText('Ad Impressions')).not.toBeInTheDocument();
 });

 // --- Sub-components rendered ---
 it('renders dashboard charts', () => {
 renderDashboard();
 expect(screen.getByTestId('dashboard-charts')).toBeInTheDocument();
 });

 it('renders recent activity section', () => {
 renderDashboard();
 expect(screen.getByTestId('recent-activity')).toBeInTheDocument();
 });

 it('renders top performers section', () => {
 renderDashboard();
 expect(screen.getByTestId('top-performers')).toBeInTheDocument();
 });

 // --- Period selector ---
 it('renders with default 30d period', () => {
 renderDashboard();
 expect(screen.getByTestId('period')).toHaveTextContent('30d');
 });

 it('changes period when period button clicked', () => {
 renderDashboard();
 fireEvent.click(screen.getByTestId('period-7d'));
 expect(screen.getByTestId('period')).toHaveTextContent('7d');
 });

 // --- Actions ---
 it('renders Export Report button', () => {
 renderDashboard();
 expect(screen.getByRole('button', { name: /export report/i })).toBeInTheDocument();
 });

 it('renders New Campaign link', () => {
 renderDashboard();
 expect(screen.getByRole('button', { name: /new campaign/i })).toBeInTheDocument();
 });
});
