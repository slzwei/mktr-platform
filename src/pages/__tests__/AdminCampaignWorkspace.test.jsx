import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mockUseCampaign = vi.fn(() => ({ data: undefined, isLoading: false }));
const mockUseSetLaunchState = vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('@/hooks/queries/useCampaignsQuery', () => ({
  useCampaign: (...a) => mockUseCampaign(...a),
  useSetCampaignLaunchState: (...a) => mockUseSetLaunchState(...a),
}));
vi.mock('@/api/entities', () => ({ Campaign: { create: vi.fn(), update: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => 'tid'),
    dismiss: vi.fn(),
  });
  return { toast };
});
// Create mode only mounts CampaignDetailsTab; stub the tabs it never shows.
vi.mock('@/components/campaigns/DesignEditor', () => ({ default: () => null }));
vi.mock('@/components/studio/OpenInStudioCard', () => ({ default: () => null }));
vi.mock('@/components/campaigns/QuizAnalyticsCard', () => ({ default: () => null }));
vi.mock('@/components/qrcodes/CampaignQRManager', () => ({ default: () => null }));
vi.mock('@/components/campaigns/workspace/CampaignDeliveryPoolTab', () => ({ default: () => null }));
vi.mock('@/components/campaigns/workspace/CampaignLaunchTab', () => ({ default: () => null }));

import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { Campaign } from '@/api/entities';
import { queryClient } from '@/lib/queryClient';
import AdminCampaignWorkspace from '../AdminCampaignWorkspace';

const POSTER_LOOK = {
  name: 'Dusk Poster',
  template: { id: 'poster', params: { overlay: 'dusk' } },
  theme: { preset: 'ink-slate', accent: null },
  media: { kind: 'image', note: 'Warm hawker-centre scene' },
  draft: [{ path: 'content.headline', label: 'Headline', section: 'page', value: 'Look headline' }],
};

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/admin/campaigns/workspace?type=lead_generation']}>
      <Routes>
        <Route path="/admin/campaigns/workspace" element={<AdminCampaignWorkspace />} />
        <Route path="/admin/campaigns/:id/workspace" element={<LocationProbe />} />
        <Route path="/AdminCampaigns" element={<div>CAMPAIGNS-LIST</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// Drive the create form: name is required to enable the button; the brief in
// the "Fill it for me" box is what gets forwarded to the auto-design step.
async function createWith({ name = 'My Campaign', brief } = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Campaign name'), name);
  if (brief) await user.type(screen.getByLabelText('Campaign brief for AI draft'), brief);
  await user.click(screen.getByRole('button', { name: /Create draft/i }));
  return user;
}

const copyDraftResolves = (proposals) =>
  apiClient.post.mockImplementation((url) =>
    url === '/admin/ai/copy-draft' ? Promise.resolve({ data: { proposals } }) : Promise.resolve({ data: {} })
  );

beforeEach(() => {
  vi.clearAllMocks();
  Campaign.create.mockResolvedValue({ id: 'new-1', design_config: {} });
  Campaign.update.mockResolvedValue({});
});

describe('AdminCampaignWorkspace — auto-design on create', () => {
  it('brief present → creates, runs full-mode copy-draft, saves the composed design, then lands on the Design tab', async () => {
    copyDraftResolves([POSTER_LOOK]);
    renderCreate();
    await createWith({ brief: '1 x iphone 17 pro lucky draw for singaporeans or pr. 21 to 65 years old only.' });

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/campaigns/new-1/workspace?tab=design'));

    // Draft created first, then the design pass.
    expect(Campaign.create).toHaveBeenCalledTimes(1);
    const copyCall = apiClient.post.mock.calls.find((c) => c[0] === '/admin/ai/copy-draft');
    expect(copyCall).toBeTruthy();
    expect(copyCall[1]).toMatchObject({ campaignId: 'new-1', mode: 'full', scope: null, regen: 0 });

    // The composed v2 document is persisted with the look's template + copy.
    expect(Campaign.update).toHaveBeenCalledTimes(1);
    const [savedId, savedBody] = Campaign.update.mock.calls[0];
    expect(savedId).toBe('new-1');
    expect(savedBody.design_config.template.id).toBe('poster');
    expect(savedBody.design_config.content.headline).toBe('Look headline');
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['campaigns', 'detail', 'new-1'] });
  });

  it('brief present but the AI step throws → draft survives, still navigates, warns, no design saved', async () => {
    apiClient.post.mockImplementation((url) =>
      url === '/admin/ai/copy-draft'
        ? Promise.reject(Object.assign(new Error('AI off'), { status: 409 }))
        : Promise.resolve({ data: {} })
    );
    renderCreate();
    await createWith({ brief: 'voucher push for verified adults' });

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/campaigns/new-1/workspace?tab=design'));
    expect(Campaign.create).toHaveBeenCalledTimes(1);
    expect(Campaign.update).not.toHaveBeenCalled(); // no design persisted
    expect(toast.warning).toHaveBeenCalled(); // non-blocking fallback notice
    expect(toast.error).not.toHaveBeenCalled(); // create itself did not fail
  });

  it('no usable proposal (empty / all blocked) → same graceful path: navigate, warn, no design saved', async () => {
    copyDraftResolves([]); // provider returned nothing usable
    renderCreate();
    await createWith({ brief: 'voucher push for verified adults' });

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/campaigns/new-1/workspace?tab=design'));
    expect(apiClient.post.mock.calls.some((c) => c[0] === '/admin/ai/copy-draft')).toBe(true);
    expect(Campaign.update).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });

  it('no brief → no AI call at all, still creates and navigates to the Design tab', async () => {
    renderCreate();
    await createWith({}); // name only, brief left empty

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/campaigns/new-1/workspace?tab=design'));
    expect(Campaign.create).toHaveBeenCalledTimes(1);
    expect(apiClient.post).not.toHaveBeenCalled(); // never touched copy-draft or details-draft
    expect(Campaign.update).not.toHaveBeenCalled();
  });
});
