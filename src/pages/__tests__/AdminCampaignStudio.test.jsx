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
import { apiClient } from '@/api/client';
import { Campaign } from '@/api/entities';
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
    // PR 5 (F6): a clean STORED-V1 doc keeps Save enabled — that no-edit save
    // is the migration moment the status line advertises.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
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

  // Heaviest test in the suite (full Studio render x several interactions);
  // the 11-template picker put it over vitest's 5s default on the slower
  // CI runner under coverage — explicit headroom, not a behavior change.
  it('F9: an unadopted AI look blocks the save; adopting unblocks it and saving commits (banner gone)', { timeout: 15000 }, async () => {
    const LOOK = {
      name: 'Dusk Poster',
      rationale: 'High-contrast hero.',
      template: { id: 'poster', params: { overlay: 'dusk' } },
      theme: { preset: 'ink-slate', accent: null },
      media: { kind: 'image', note: 'Warm hawker-centre scene' },
      draft: [{ path: 'content.headline', label: 'Form headline', section: 'page', value: 'Look headline' }],
    };
    const user = userEvent.setup();
    apiClient.post.mockImplementation((url) =>
      url === '/admin/ai/copy-draft'
        ? Promise.resolve({ success: true, data: { proposals: [LOOK] } })
        : Promise.resolve({ data: {} })
    );
    Campaign.update.mockImplementation(async (id, body) => ({ ...LEAD_CAMPAIGN, ...body }));
    renderStudio();

    // Full-mode generate → pick the look (whole-doc swap, banner + revert appear)
    await user.click(screen.getByRole('button', { name: '✦ Write it for me' }));
    await user.click(screen.getByRole('button', { name: 'Design the whole page' }));
    await user.type(screen.getByPlaceholderText(/FairPrice voucher giveaway/), 'Voucher blast');
    await user.click(screen.getByRole('button', { name: 'Generate looks' }));
    await user.click(await screen.findByRole('button', { name: 'Use this look' }));

    expect(screen.getByTestId('studio-proposal-banner')).toHaveTextContent('AI PROPOSAL — UNCOMMITTED · Dusk Poster');
    expect(screen.getByRole('button', { name: '↩ Revert look' })).toBeInTheDocument();

    // Unadopted → the toolbar save is blocked (⌘S and guard saves converge on the same handler)
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(toast.error).toHaveBeenCalledWith('Adopt or discard the AI look before saving.');
    expect(Campaign.update).not.toHaveBeenCalled();

    // Adopt → save persists the look doc and commits (banner + revert gone)
    await user.click(screen.getByRole('button', { name: 'Adopt this look' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Campaign.update).toHaveBeenCalledTimes(1));
    expect(Campaign.update.mock.calls[0][1].design_config.template.id).toBe('poster');
    expect(Campaign.update.mock.calls[0][1].design_config.content.headline).toBe('Look headline');
    await waitFor(() => expect(screen.queryByTestId('studio-proposal-banner')).toBeNull());
    expect(screen.queryByRole('button', { name: '↩ Revert look' })).toBeNull();
  });
});

describe('create-flow auto-run (?ai=full)', () => {
  function renderStudioWithAiParam(campaign = LEAD_CAMPAIGN) {
    mockUseCampaign.mockReturnValue({ data: campaign, isLoading: false });
    mockUseCampaignLookup.mockReturnValue({ data: [campaign] });
    apiClient.post.mockResolvedValue({ success: true, data: { proposals: [], fields: null, terms: null, drawTerms: null } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/admin/campaigns/${campaign.id}/studio?ai=full&tab=x`]}>
          <Routes>
            <Route path="/admin/campaigns/:id/studio" element={<AdminCampaignStudio />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('fires exactly ONE full-mode generation from campaign facts once the doc is ready', async () => {
    renderStudioWithAiParam();
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    const [, body] = apiClient.post.mock.calls[0];
    expect(body).toMatchObject({ mode: 'full', campaignId: 'c1' });
    expect(body.brief.topic).toContain('FairPrice Voucher');
    // settle: no second call on subsequent renders/effects
    await new Promise((r) => setTimeout(r, 50));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('draw campaigns prefill the brief with prize + close facts', async () => {
    renderStudioWithAiParam({
      ...LEAD_CAMPAIGN,
      id: 'c-draw',
      name: 'iPhone 17 Pro Lucky Draw',
      design_config: {
        formHeadline: 'Hi',
        customerHost: 'redeem',
        luckyDraw: { enabled: true, closesAt: '2026-08-31', prize: 'iPhone 17 Pro + 3× $100 Voucher', multiplier: 10 },
      },
    });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    const [, body] = apiClient.post.mock.calls[0];
    expect(body.brief.topic).toContain('iPhone 17 Pro Lucky Draw');
    expect(body.brief.topic).toContain('prize: iPhone 17 Pro + 3× $100 Voucher');
    expect(body.brief.topic).toContain('entries close 2026-08-31');
    expect(body.brief.objective).toMatch(/draw entries/);
  });
});
