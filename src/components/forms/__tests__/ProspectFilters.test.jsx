import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProspectFilters from '@/components/prospects/ProspectFilters';

describe('ProspectFilters', () => {
  const defaultProps = {
    filters: { status: 'all', campaign: 'all', source: 'all' },
    onFilterChange: vi.fn(),
    campaigns: [
      { id: 'c1', name: 'Summer Campaign' },
      { id: 'c2', name: 'Winter Campaign' },
    ],
  };

  it('renders status filter', () => {
    render(<ProspectFilters {...defaultProps} />);
    expect(screen.getByText('All Status')).toBeInTheDocument();
  });

  it('renders campaign filter', () => {
    render(<ProspectFilters {...defaultProps} />);
    expect(screen.getByText('All Campaigns')).toBeInTheDocument();
  });

  it('renders source filter', () => {
    render(<ProspectFilters {...defaultProps} />);
    expect(screen.getByText('All Sources')).toBeInTheDocument();
  });

  it('renders with empty campaigns array', () => {
    render(<ProspectFilters {...defaultProps} campaigns={[]} />);
    expect(screen.getByText('All Campaigns')).toBeInTheDocument();
  });

  it('shows current status filter value', () => {
    render(<ProspectFilters {...defaultProps} filters={{ ...defaultProps.filters, status: 'new' }} />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders filter icon', () => {
    const { container } = render(<ProspectFilters {...defaultProps} />);
    // lucide Filter icon renders as SVG
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
