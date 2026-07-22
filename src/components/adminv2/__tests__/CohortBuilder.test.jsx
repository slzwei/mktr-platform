/**
 * Cohort builder dialog (tracker "cohortui") — facet pills drive the
 * definition, the preview re-resolves debounced with the edited definition,
 * the §9.5-2 age floor blocks save, and save sends the canonical payload.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CohortBuilder from '../CohortBuilder';

vi.mock('@/api/adminV2', () => ({
  fetchCohortFacets: vi.fn(async () => ({
    attributes: { incomes: ['$3,000 - $4,999'], educations: ['Degree'], genders: ['female'] },
    campaignTags: ['parenting'],
    campaignCategories: [
      { id: 'dining', label: 'Dining', count: 1 },
      { id: 'wellness', label: 'Wellness', count: 0 },
    ],
    campaigns: [
      { id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active', category: 'dining' },
      { id: 'c2', name: 'NTUC $20', status: 'active', category: null },
    ],
    draws: [{ id: 'd1', campaignId: 'c1', campaignName: 'Tokyo Getaway Lucky Draw', status: 'open', closesAt: '2026-10-30T00:00:00Z' }],
  })),
  previewCohortDefinition: vi.fn(async () => ({
    total: 10, reachable: 4, excluded: 6,
    byReason: { age_unknown: 1, age_conflict: 0, age_ineligible: 1, missing_email: 0, missing_phone: 0, suppressed: 0, not_consented: 3, not_verified: 1 },
    gate: { channel: 'all', campaignId: null, minAge: 18, maxAge: null },
  })),
  createCohort: vi.fn(async () => ({ data: { id: 'co-new' } })),
  updateCohort: vi.fn(async () => ({ data: { id: 'co1' } })),
}));

import { previewCohortDefinition, createCohort } from '@/api/adminV2';

function setup(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CohortBuilder onClose={() => {}} {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('CohortBuilder', () => {
  it('toggling a campaign pill re-previews with that campaign in the definition', async () => {
    setup();
    const pill = await screen.findByRole('button', { name: 'Tokyo Getaway Lucky Draw' });
    fireEvent.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      const defs = previewCohortDefinition.mock.calls.map(([def]) => def);
      expect(defs.some((d) => d.filters.campaignIds.includes('c1'))).toBe(true);
    }, { timeout: 3000 });
  });

  it('shows the live counts and non-zero reason chips', async () => {
    setup();
    expect(await screen.findByText('people match', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('No consent 3')).toBeInTheDocument();
    expect(screen.queryByText(/Unsubscribed/)).not.toBeInTheDocument(); // zero count → no chip
  });

  it('enforces the 18+ floor: value below 18 blocks save with the policy note', async () => {
    setup();
    await screen.findByRole('button', { name: 'Tokyo Getaway Lucky Draw' });
    fireEvent.change(screen.getByLabelText('Minimum age'), { target: { value: '16' } });
    expect(await screen.findByText('Minimum age cannot go below 18.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g. Tokyo draw entrants'), { target: { value: 'Teens' } });
    expect(screen.getByRole('button', { name: 'Save cohort' })).toBeDisabled();
  });

  it('save posts name + canonical definition', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'NTUC $20' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Tokyo draw entrants'), { target: { value: 'NTUC people' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save cohort' }));
    await waitFor(() => expect(createCohort).toHaveBeenCalledWith(expect.objectContaining({
      name: 'NTUC people',
      definition: expect.objectContaining({
        filters: expect.objectContaining({ campaignIds: ['c2'] }),
        ageGate: { minAge: 18, maxAge: null },
      }),
    })));
  });

  it('toggling a category pill re-previews with that category in the definition', async () => {
    setup();
    // In-use categories show their live campaign count; empty ones just the label.
    const pill = await screen.findByRole('button', { name: 'Dining · 1' });
    fireEvent.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wellness' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      const defs = previewCohortDefinition.mock.calls.map(([def]) => def);
      expect(defs.some((d) => d.filters.campaignCategories.includes('dining'))).toBe(true);
    }, { timeout: 3000 });
  });

  it('postal input keeps only valid digit prefixes', async () => {
    setup();
    await screen.findByRole('button', { name: 'NTUC $20' });
    fireEvent.change(screen.getByLabelText('Postal prefixes'), { target: { value: '52, 5x, 530' } });
    await waitFor(() => {
      const defs = previewCohortDefinition.mock.calls.map(([def]) => def);
      expect(defs.some((d) => JSON.stringify(d.filters.attributes.postalPrefixes) === JSON.stringify(['52', '530']))).toBe(true);
    }, { timeout: 3000 });
  });
});
