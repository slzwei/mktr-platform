/**
 * Cohort detail (tracker "cohortui") — the WHY screen: fresh-resolution
 * tiles, per-reason exclusion breakdown with hints, member rows carrying
 * their actual reasons, status/channel switches re-querying.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2CohortDetail from '../AdminV2CohortDetail';

vi.mock('@/api/adminV2', () => ({
  fetchCohort: vi.fn(async () => ({
    id: 'co1',
    name: 'Tokyo draw entrants',
    description: 'Everyone from the Tokyo draw',
    definition: {
      filters: { campaignIds: ['c1'], drawIds: [], anyDraw: false, campaignTags: [], attributes: { postalPrefixes: [], incomes: [], educations: [], genders: [] } },
      ageGate: { minAge: 18, maxAge: null },
      marketingContext: { campaignId: null },
    },
    lastPreviewAt: new Date().toISOString(),
    preview: {
      total: 212, reachable: 180, excluded: 32,
      byReason: { age_unknown: 1, age_conflict: 0, age_ineligible: 2, missing_email: 0, missing_phone: 0, suppressed: 6, not_consented: 15, not_verified: 9 },
      gate: { channel: 'all', campaignId: null, minAge: 18, maxAge: null },
    },
  })),
  fetchCohortFacets: vi.fn(async () => ({
    attributes: { incomes: [], educations: [], genders: [] },
    campaignTags: [],
    campaigns: [{ id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active' }],
    draws: [],
  })),
  fetchCohortMembers: vi.fn(async (id, { status }) => (status === 'reachable'
    ? { total: 1, limit: 50, offset: 0, members: [{ consumerId: 'u2', firstName: 'Ready', lastName: 'Person', phone: '+6591112222', email: 'ready@x.com', lastSeenAt: new Date().toISOString(), reachable: true, reasons: [] }] }
    : { total: 2, limit: 50, offset: 0, members: [
        { consumerId: 'u1', firstName: 'Blocked', lastName: 'Person', phone: '+6590001111', email: null, lastSeenAt: new Date().toISOString(), reachable: false, reasons: ['not_consented'] },
        { consumerId: 'u3', firstName: 'Silent', lastName: 'Minor', phone: '+6590002222', email: null, lastSeenAt: new Date().toISOString(), reachable: false, reasons: ['age_ineligible', 'not_verified'] },
      ] })),
  archiveCohort: vi.fn(async () => ({ success: true })),
  previewCohortDefinition: vi.fn(async () => ({ total: 212, reachable: 180, excluded: 32, byReason: {}, gate: { channel: 'all', campaignId: null, minAge: 18, maxAge: null } })),
  createCohort: vi.fn(),
  updateCohort: vi.fn(),
  fetchCohorts: vi.fn(),
}));

import { fetchCohort, fetchCohortMembers } from '@/api/adminV2';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/cohorts/co1']}>
        <Routes>
          <Route path="/admin/cohorts/:id" element={<AdminV2CohortDetail />} />
          <Route path="/AdminCohorts" element={<div>LIST</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminV2CohortDetail', () => {
  it('opens with a fresh resolution and shows the split tiles', async () => {
    setup();
    expect(await screen.findByText('Tokyo draw entrants')).toBeInTheDocument();
    expect(fetchCohort).toHaveBeenCalledWith('co1', { refresh: true });
    expect(screen.getByText('212')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
  });

  it('explains WHY people are excluded, with counts per reason', async () => {
    setup();
    await screen.findByText('Why people are excluded');
    expect(screen.getAllByText('No consent').length).toBeGreaterThan(0);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getAllByText('Unsubscribed').length).toBeGreaterThan(0);
    expect(screen.getByText(/counts overlap/i)).toBeInTheDocument();
  });

  it('lands on excluded members with their reason chips', async () => {
    setup();
    expect(await screen.findByText('Blocked Person')).toBeInTheDocument();
    const reasons = screen.getAllByText('No consent');
    expect(reasons.length).toBeGreaterThan(1); // breakdown row + member chip
    expect(screen.getAllByText('Outside age range').length).toBeGreaterThan(1); // breakdown + chip
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(1);

  });

  it('status switch re-queries members', async () => {
    setup();
    await screen.findByText('Blocked Person');
    fireEvent.click(screen.getByRole('button', { name: 'reachable' }));
    expect(await screen.findByText('Ready Person')).toBeInTheDocument();
    await waitFor(() => expect(fetchCohortMembers).toHaveBeenLastCalledWith('co1', expect.objectContaining({ status: 'reachable' })));
  });
});
