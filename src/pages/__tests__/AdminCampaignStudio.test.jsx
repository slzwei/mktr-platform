import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseCampaign = vi.fn();
const mockUseCampaignLookup = vi.fn();

vi.mock('@/hooks/queries/useCampaignsQuery', () => ({
  useCampaign: (...args) => mockUseCampaign(...args),
  useCampaignLookup: (...args) => mockUseCampaignLookup(...args),
}));
vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock('@/api/integrations', () => ({ UploadFile: vi.fn() })); // PagePanel's upload seam
vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import AdminCampaignStudio from '../AdminCampaignStudio';

const LEAD_CAMPAIGN = {
  id: 'c1',
  name: 'FairPrice Voucher',
  status: 'active',
  type: 'lead_generation',
  design_config: { formHeadline: 'Hi', customerHost: 'redeem' },
};

function renderStudio(campaign = LEAD_CAMPAIGN) {
  mockUseCampaign.mockReturnValue({ data: campaign, isLoading: false });
  mockUseCampaignLookup.mockReturnValue({ data: [campaign] });
  // The Studio's advisory data hooks (readiness / marketplace preview) use
  // react-query directly — give them a real client with silent failures.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/campaigns/${campaign.id}/studio`]}>
        <Routes>
          <Route path="/admin/campaigns/:id/studio" element={<AdminCampaignStudio />} />
          <Route path="/admin/campaigns/:id/workspace" element={<div>WORKSPACE-PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminCampaignStudio', () => {
  it('renders the Studio chrome for a lead_generation campaign (rail sections + save cluster + canvas stage)', () => {
    renderStudio();
    expect(screen.getByRole('navigation', { name: 'Studio sections' })).toBeInTheDocument();
    for (const label of ['Page', 'Form', 'Quiz', 'Theme', 'Distribution']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('studio-save-status')).toHaveTextContent(
      'first save upgrades this campaign to the Studio format'
    );
    expect(screen.getByLabelText('Canvas')).toBeInTheDocument();
  });

  it('redirects guided_review campaigns to the workspace design tab (out of Studio scope)', () => {
    renderStudio({ ...LEAD_CAMPAIGN, id: 'g1', type: 'guided_review' });
    expect(screen.getByText('WORKSPACE-PAGE')).toBeInTheDocument();
  });

  it('copies the SAVED-host lead-capture link immediately when clean (no guard)', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderStudio();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('/LeadCapture?campaign_id=c1');
    expect(toast.success).toHaveBeenCalledWith('Lead capture link copied');
    // No guard modal — the doc is clean.
    expect(screen.queryByRole('dialog', { name: 'Save first?' })).not.toBeInTheDocument();
  });

  it('opens the read-only JSON view from the rail', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole('button', { name: /JSON/ }));
    const dialog = screen.getByRole('dialog', { name: 'Design document (read-only)' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain('"version": 2');
  });
});
