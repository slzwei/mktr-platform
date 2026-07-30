/**
 * Duplicate from the campaign detail header — posts the duplicate, refreshes
 * the v2 board cache (the hook only invalidates ['campaigns']), and lands on
 * the new copy's detail page. A server refusal (e.g. the v2 design write gate)
 * surfaces as an error toast and stays put.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});

const CAMPAIGN = {
  id: 'c-1',
  name: 'iPhone Draw',
  status: 'active',
  type: 'lead_generation',
  design_config: {},
  start_date: '2026-07-01',
  end_date: null,
};

// Out of scope here: the scoring card owns its own queries + QueryClient
// needs; its behavior is covered by CampaignScoringCard.test.jsx.
vi.mock('@/components/adminv2/CampaignScoringCard', () => ({
  default: () => <div data-testid="scoring-card-stub" />,
}));

vi.mock('@/hooks/queries/useAdminV2', () => ({
  useCampaignSummary: () => ({
    isLoading: false,
    isError: false,
    data: {
      campaign: CAMPAIGN,
      series: { total: 0, today: 0, days: [] },
      commitments: [],
      committedRemaining: 0,
      committedValueCents: 0,
      recent: [],
      qrTags: [],
    },
  }),
  useAttention: () => ({ isSuccess: true, data: { zeroCommitCampaigns: [] } }),
}));

const mutateAsync = vi.fn();
vi.mock('@/hooks/queries/useCampaignsQuery', () => ({
  useDuplicateCampaign: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminV2CampaignDetail from '../AdminV2CampaignDetail';
import { queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';

beforeEach(() => vi.clearAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/campaigns/c-1']}>
      <Routes>
        <Route path="/admin/campaigns/:id" element={<AdminV2CampaignDetail />} />
      </Routes>
    </MemoryRouter>
  );

describe('AdminV2CampaignDetail — duplicate', () => {
  it('duplicates, refreshes the board cache, and navigates to the copy', async () => {
    mutateAsync.mockResolvedValue({ campaign: { id: 'c-2', name: 'iPhone Draw (Copy)' } });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'c-1' }));
    expect(toast.success).toHaveBeenCalledWith('Duplicated as “iPhone Draw (Copy)” — it starts as a draft');
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['adminV2'] });
    expect(navigateMock).toHaveBeenCalledWith('/admin/campaigns/c-2');
  });

  it('surfaces a server refusal as an error toast and stays put', async () => {
    mutateAsync.mockRejectedValue({ response: { data: { message: 'v2 design writes are disabled' } } });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Duplicate failed: v2 design writes are disabled')
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
