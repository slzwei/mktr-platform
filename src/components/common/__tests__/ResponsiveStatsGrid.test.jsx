import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResponsiveStatsGrid from '@/components/dashboard/ResponsiveStatsGrid';
import { Users, Target } from 'lucide-react';

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
}));

function renderGrid(props = {}) {
  return render(
    <MemoryRouter>
      <ResponsiveStatsGrid {...props} />
    </MemoryRouter>
  );
}

const sampleCards = [
  {
    title: 'Total Users',
    value: 42,
    icon: Users,
    trend: '+5%',
    trendUp: true,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-50',
  },
  {
    title: 'Conversions',
    value: 10,
    icon: Target,
    trend: '-2%',
    trendUp: false,
    iconColor: 'text-red-600',
    iconBg: 'bg-red-50',
  },
];

describe('ResponsiveStatsGrid', () => {
  it('renders loading skeletons when loading is true', () => {
    const { container } = renderGrid({ loading: true, cards: [] });
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders nothing when cards array is empty and not loading', () => {
    const { container } = renderGrid({ cards: [], loading: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when cards is null', () => {
    const { container } = renderGrid({ cards: null, loading: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders card titles', () => {
    renderGrid({ cards: sampleCards, loading: false });
    // Cards render twice (desktop grid + mobile scroll)
    expect(screen.getAllByText('Total Users').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Conversions').length).toBeGreaterThanOrEqual(1);
  });

  it('renders card values', () => {
    renderGrid({ cards: sampleCards, loading: false });
    expect(screen.getAllByText('42').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1);
  });

  it('renders trend indicators', () => {
    renderGrid({ cards: sampleCards, loading: false });
    expect(screen.getAllByText('+5%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('-2%').length).toBeGreaterThanOrEqual(1);
  });

  it('renders card with linkTo as a link', () => {
    const cards = [
      {
        title: 'Linked Card',
        value: 99,
        icon: Users,
        linkTo: '/some-page',
        iconColor: 'text-blue-600',
        iconBg: 'bg-blue-50',
      },
    ];
    const { container } = renderGrid({ cards, loading: false });
    const link = container.querySelector('a[href="/some-page"]');
    expect(link).not.toBeNull();
  });

  it('renders spark data chart when provided', () => {
    const cards = [
      { title: 'Spark', value: 5, icon: Users, sparkData: [1, 2, 3], iconColor: 'text-blue-600', iconBg: 'bg-blue-50' },
    ];
    renderGrid({ cards, loading: false });
    expect(screen.getAllByTestId('responsive-container').length).toBeGreaterThan(0);
  });

  it('renders description when provided', () => {
    const cards = [
      {
        title: 'Info',
        value: 1,
        icon: Users,
        description: 'Extra detail',
        iconColor: 'text-blue-600',
        iconBg: 'bg-blue-50',
      },
    ];
    renderGrid({ cards, loading: false });
    expect(screen.getAllByText('Extra detail').length).toBeGreaterThanOrEqual(1);
  });

  it('uses custom columns count for loading placeholders', () => {
    const { container } = renderGrid({ loading: true, cards: [], columns: 5 });
    // Should render 5 loading placeholders per grid (desktop + mobile = 10)
    const placeholders = container.querySelectorAll('.animate-pulse');
    expect(placeholders.length).toBeGreaterThanOrEqual(5);
  });
});
