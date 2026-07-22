/**
 * Bulk select → pause/resume/archive/restore/delete on the v2 campaigns board.
 * The board was observe-and-navigate only; these actions were stranded on the
 * classic page after the admin-v2 rebuild.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});

const ROWS = [
  { id: 'c-active', name: 'Active One', status: 'active', type: 'lead_generation', leadsThisPeriod: 5, design_config: {} },
  { id: 'c-paused', name: 'Paused One', status: 'paused', type: 'lead_generation', leadsThisPeriod: 2, design_config: {} },
  { id: 'c-archived', name: 'Archived One', status: 'archived', type: 'lead_generation', leadsThisPeriod: 0, design_config: {} },
];

vi.mock('@/hooks/queries/useAdminV2', () => ({
  useCampaignLeaderboard: () => ({ data: { rows: ROWS, total: 3 }, isLoading: false, isError: false }),
  useAttention: () => ({ data: { zeroCommitCampaigns: [] }, isLoading: false, isError: false, isSuccess: true }),
}));

vi.mock('@/services/campaignService', () => ({
  setCampaignLaunchState: vi.fn().mockResolvedValue({}),
  archiveCampaign: vi.fn().mockResolvedValue({}),
  restoreCampaign: vi.fn().mockResolvedValue({}),
  permanentDeleteCampaign: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminV2Campaigns from '../AdminV2Campaigns';
import * as campaignSvc from '@/services/campaignService';
import { toast } from 'sonner';

beforeEach(() => vi.clearAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminV2Campaigns />
    </MemoryRouter>
  );

describe('AdminV2Campaigns — bulk actions', () => {
  it('checkbox selects without navigating; bulk bar appears with eligibility counts', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select Active One' }));
    expect(navigateMock).not.toHaveBeenCalled();
    const bar = screen.getByTestId('bulk-bar');
    expect(bar).toHaveTextContent('1 selected');
    // Active row: Pause enabled, Resume/Restore/Delete disabled.
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('select-all + pause pauses only the active campaign after confirm', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible campaigns' }));
    expect(screen.getByTestId('bulk-bar')).toHaveTextContent('3 selected');
    await user.click(screen.getByRole('button', { name: /^Pause/ }));
    // Confirm dialog: 1 of 3 eligible, 2 skipped.
    expect(await screen.findByText('Pause 1 campaign?')).toBeInTheDocument();
    expect(screen.getByText(/2 of the selected campaigns are not eligible/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(campaignSvc.setCampaignLaunchState).toHaveBeenCalledTimes(1));
    expect(campaignSvc.setCampaignLaunchState).toHaveBeenCalledWith('c-active', { state: 'paused' });
    expect(toast.success).toHaveBeenCalled();
    // Selection cleared after the run.
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument());
  });

  it('delete targets only archived campaigns and calls the permanent endpoint', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select Archived One' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete 1 campaign?')).toBeInTheDocument();
    expect(screen.getByText(/Permanent deletion cannot be undone/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1));
    await waitFor(() => expect(campaignSvc.permanentDeleteCampaign).toHaveBeenCalledWith('c-archived'));
    expect(campaignSvc.setCampaignLaunchState).not.toHaveBeenCalled();
  });

  it('a per-row failure surfaces as an error toast while others succeed', async () => {
    campaignSvc.archiveCampaign
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select Active One' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Paused One' }));
    await user.click(screen.getByRole('button', { name: /^Archive/ }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(campaignSvc.archiveCampaign).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Archive: 1 campaign done');
  });

  it('resume resumes paused campaigns only', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select Paused One' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(campaignSvc.setCampaignLaunchState).toHaveBeenCalledWith('c-paused', { state: 'active' }));
  });
});
