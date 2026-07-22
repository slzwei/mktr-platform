/**
 * "+ New campaign" must open the campaign-type chooser and thread the chosen
 * type to the workspace as ?type= — the admin-v2 rebuild had linked straight
 * to the workspace, silently creating every campaign as lead_generation.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/hooks/queries/useAdminV2', () => ({
  useCampaignLeaderboard: () => ({ data: { rows: [], total: 0 }, isLoading: false, isError: false }),
  useAttention: () => ({ data: { zeroCommitCampaigns: [] }, isLoading: false, isError: false }),
}));

import AdminV2Campaigns, { newCampaignHref } from '../AdminV2Campaigns';

beforeEach(() => navigateMock.mockClear());

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminV2Campaigns />
    </MemoryRouter>
  );

describe('AdminV2Campaigns — new-campaign type chooser', () => {
  it('opens the type dialog instead of navigating directly', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByText('Create New Campaign')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ New campaign' }));
    expect(screen.getByText('Create New Campaign')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('selecting a type navigates to the workspace with ?type=', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '+ New campaign' }));
    await user.click(screen.getByText('Guided Review Campaign'));
    expect(navigateMock).toHaveBeenCalledWith(`${newCampaignHref()}?type=guided_review`);
  });

  it('offers Lucky Draw and navigates with ?type=lucky_draw', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '+ New campaign' }));
    await user.click(screen.getByText('Lucky Draw Campaign'));
    expect(navigateMock).toHaveBeenCalledWith(`${newCampaignHref()}?type=lucky_draw`);
  });

  it('the retired PHV (brand_awareness) option is gone', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '+ New campaign' }));
    expect(screen.queryByText('PHV Campaign')).not.toBeInTheDocument();
    expect(screen.getByText('Regular Campaign')).toBeInTheDocument();
    expect(screen.getByText('Quiz Campaign')).toBeInTheDocument();
  });
});
