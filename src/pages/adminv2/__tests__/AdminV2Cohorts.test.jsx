/**
 * Cohorts list (tracker "cohortui") — snapshot rows, empty state, archive
 * confirm flow, and the builder opening with a live preview. API layer
 * mocked; navigation asserted through a MemoryRouter location probe.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2Cohorts from '../AdminV2Cohorts';

const cohortRow = {
  id: 'co1',
  name: 'Tokyo draw entrants',
  description: null,
  definition: {
    filters: { campaignIds: ['c1'], drawIds: [], anyDraw: false, campaignTags: [], attributes: { postalPrefixes: [], incomes: [], educations: [], genders: [] } },
    ageGate: { minAge: 18, maxAge: null },
    marketingContext: { campaignId: null },
  },
  lastTotalCount: 212,
  lastReachableCount: 180,
  lastPreviewAt: new Date().toISOString(),
};

vi.mock('@/api/adminV2', () => ({
  fetchCohorts: vi.fn(async () => ({ rows: [], total: 0 })),
  fetchCohortFacets: vi.fn(async () => ({
    attributes: { incomes: ['$3,000 - $4,999'], educations: ['Degree'], genders: [] },
    campaignTags: ['parenting'],
    campaigns: [{ id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active' }],
    draws: [{ id: 'd1', campaignId: 'c1', campaignName: 'Tokyo Getaway Lucky Draw', status: 'open', closesAt: '2026-10-30T00:00:00Z' }],
  })),
  previewCohortDefinition: vi.fn(async () => ({
    total: 212, reachable: 180, excluded: 32,
    byReason: { age_unknown: 0, age_conflict: 0, age_ineligible: 2, missing_email: 0, missing_phone: 0, suppressed: 6, not_consented: 15, not_verified: 9 },
    gate: { channel: 'all', campaignId: null, minAge: 18, maxAge: null },
  })),
  archiveCohort: vi.fn(async () => ({ success: true })),
  createCohort: vi.fn(async () => ({ data: { id: 'co-new' } })),
  updateCohort: vi.fn(async () => ({ data: { id: 'co1' } })),
  fetchCohort: vi.fn(),
  fetchCohortMembers: vi.fn(),
}));

import { fetchCohorts, archiveCohort } from '@/api/adminV2';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/AdminCohorts']}>
        <Routes>
          <Route path="/AdminCohorts" element={<AdminV2Cohorts />} />
          <Route path="/admin/cohorts/:id" element={<div>DETAIL</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminV2Cohorts', () => {
  it('shows the empty state with a build CTA', async () => {
    setup();
    expect(await screen.findByText('No cohorts yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build the first one' })).toBeInTheDocument();
  });

  it('renders snapshot counts and opens the detail on row click', async () => {
    fetchCohorts.mockResolvedValueOnce({ rows: [cohortRow], total: 1 });
    setup();
    expect(await screen.findByText('Tokyo draw entrants')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('/ 212')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tokyo draw entrants'));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/cohorts/co1'));
  });

  it('archive asks for confirmation and calls the API', async () => {
    fetchCohorts.mockResolvedValueOnce({ rows: [cohortRow], total: 1 });
    setup();
    await screen.findByText('Tokyo draw entrants');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/Archive “Tokyo draw entrants”\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }));
    await waitFor(() => expect(archiveCohort).toHaveBeenCalledWith('co1'));
  });

  it('+ New cohort opens the builder with a live preview strip', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '+ New cohort' }));
    expect(await screen.findByText('New cohort')).toBeInTheDocument();
    // Debounced preview lands with the mocked counts.
    expect(await screen.findByText('people match', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText('212')).toBeInTheDocument();
  });
});
