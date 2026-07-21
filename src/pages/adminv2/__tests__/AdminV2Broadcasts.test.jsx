/**
 * Email Pushes list + composer (tracker "emailpush") — rows, empty state,
 * the composer create flow (active-campaign options only, cohort-scope
 * campaign default), and the ?cohort= prefill that the cohort detail's
 * "Push email" button deep-links to. API layer mocked.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2Broadcasts from '../AdminV2Broadcasts';

const broadcastRow = {
  id: 'eb1',
  cohortId: 'co1',
  campaignId: 'c1',
  subject: 'Tokyo draw closes this week',
  bodyText: 'Reminder.',
  ctaLabel: 'Enter now',
  status: 'completed',
  totalRecipients: 120,
  sentCount: 100,
  skippedCount: 18,
  failedCount: 2,
  createdAt: new Date().toISOString(),
  cohort: { id: 'co1', name: 'Tokyo entrants' },
  campaign: { id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active', is_active: true },
};

vi.mock('@/api/adminV2', () => ({
  fetchEmailBroadcasts: vi.fn(async () => ({ rows: [], total: 0 })),
  createEmailBroadcast: vi.fn(async () => ({ data: { id: 'eb-new' } })),
  updateEmailBroadcast: vi.fn(async () => ({ data: { id: 'eb1' } })),
  fetchCohorts: vi.fn(async () => ({
    rows: [
      {
        id: 'co1',
        name: 'Tokyo entrants',
        lastReachableCount: 180,
        definition: {
          filters: { campaignIds: ['c1'], drawIds: [], anyDraw: false, campaignTags: [], attributes: { postalPrefixes: [], incomes: [], educations: [], genders: [] } },
          ageGate: { minAge: 18, maxAge: null },
          marketingContext: { campaignId: 'c1' },
        },
      },
    ],
    total: 1,
  })),
  fetchCohortFacets: vi.fn(async () => ({
    attributes: { incomes: [], educations: [], genders: [] },
    campaignTags: [],
    campaigns: [
      { id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active' },
      { id: 'c2', name: 'Old Thing', status: 'archived' },
    ],
    draws: [],
  })),
}));

import { fetchEmailBroadcasts, createEmailBroadcast } from '@/api/adminV2';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function setup(initialEntry = '/AdminBroadcasts') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/AdminBroadcasts" element={<><AdminV2Broadcasts /><LocationProbe /></>} />
          <Route path="/admin/broadcasts/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminV2Broadcasts', () => {
  it('renders the empty state with a compose action', async () => {
    setup();
    expect(await screen.findByText('No email pushes yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compose the first one' })).toBeTruthy();
  });

  it('renders rows with cohort, campaign, status and counts', async () => {
    fetchEmailBroadcasts.mockResolvedValueOnce({ rows: [broadcastRow], total: 1 });
    setup();
    expect(await screen.findByText('Tokyo draw closes this week')).toBeTruthy();
    expect(screen.getByText('Tokyo entrants')).toBeTruthy();
    expect(screen.getByText('Tokyo Getaway Lucky Draw')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('creates a draft: active campaigns only, campaign defaulted from the cohort scope', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '+ New push' }));

    const cohortSelect = await screen.findByLabelText('Cohort');
    fireEvent.change(cohortSelect, { target: { value: 'co1' } });

    // Campaign defaults from the cohort's stored gate scope…
    const campaignSelect = screen.getByLabelText('Campaign');
    await waitFor(() => expect(campaignSelect.value).toBe('c1'));
    // …and archived campaigns are not offered at all.
    expect(screen.queryByText('Old Thing')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Your Tokyo draw closes/i), { target: { value: 'My subject' } });
    fireEvent.change(screen.getByPlaceholderText(/quick reminder/i), { target: { value: 'Body copy here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(createEmailBroadcast).toHaveBeenCalledWith({
      cohortId: 'co1',
      campaignId: 'c1',
      subject: 'My subject',
      bodyText: 'Body copy here.',
      ctaLabel: 'Learn more',
    }));
    // Created → navigates to the new draft's detail screen.
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/admin/broadcasts/eb-new'));
  });

  it('?cohort= deep link (the cohort "Push email" button) opens the composer preselected', async () => {
    setup('/AdminBroadcasts?cohort=co1');
    const cohortSelect = await screen.findByLabelText('Cohort');
    await waitFor(() => expect(cohortSelect.value).toBe('co1'));
  });
});
