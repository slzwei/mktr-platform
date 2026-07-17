/**
 * ActivationDetail — PR C surfaces:
 * 1. LIVE activations hide Unlink and explain the server's linkage guard;
 * 2. non-live activations keep the Unlink action;
 * 3. the last-24h skipped-issuance breakdown renders when present.
 * redeemOpsApi is fully mocked — no network.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getActivation: vi.fn(),
  getActivationMetrics: vi.fn(),
  searchCampaigns: vi.fn(),
  linkActivationCampaign: vi.fn(),
  setActivationStatus: vi.fn(),
  changeActivationAllocation: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  return t;
});
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel) => sel({ user: { id: 'u1', role: 'admin' } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'act-1' }) };
});

import ActivationDetail from '../ActivationDetail';

const baseActivation = {
  id: 'act-1', status: 'active', campaignId: 'camp-1', campaignNameSnapshot: 'July Campaign',
  allocatedQuantity: 10, issuedCount: 2, redeemedCount: 0, unlockPolicy: 'agent_unlock',
  rewardOffer: { id: 'o1', title: 'Free Trial Session' },
  partner: { tradingName: 'Gates Studio' },
};
const campaignRef = {
  id: 'camp-1', name: 'July Campaign', status: 'active', customerHost: 'redeem',
  publicUrl: 'https://redeem.sg/c/x', mktrAdminUrl: 'https://mktr.sg/admin/x',
};

function renderPage(detail) {
  api.getActivation.mockResolvedValue(detail);
  api.getActivationMetrics.mockResolvedValue({ acquisition: { totalLeads: 5 } });
  api.searchCampaigns.mockResolvedValue([]);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ActivationDetail /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActivationDetail PR C surfaces', () => {
  it('hides Unlink on a LIVE activation and explains the guard', async () => {
    renderPage({ activation: baseActivation, campaign: campaignRef, issuanceSkips24h: [] });
    expect(await screen.findByText('July Campaign')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(screen.getByText(/Complete or cancel the activation to change its campaign link/)).toBeInTheDocument();
  });

  it('keeps Unlink on a non-live activation', async () => {
    renderPage({
      activation: { ...baseActivation, status: 'draft' },
      campaign: campaignRef,
      issuanceSkips24h: [],
    });
    expect(await screen.findByRole('button', { name: 'Unlink' })).toBeInTheDocument();
    expect(screen.queryByText(/Complete or cancel the activation to change/)).toBeNull();
  });

  it('renders the 24h skipped-issuance breakdown when present', async () => {
    renderPage({
      activation: baseActivation,
      campaign: campaignRef,
      issuanceSkips24h: [
        { reason: 'allocation_exhausted', count: 4 },
        { reason: 'no_active_activation', count: 2 },
      ],
    });
    expect(await screen.findByText(/Skipped issuance — last 24h/)).toBeInTheDocument();
    expect(screen.getByText(/Allocation exhausted/)).toBeInTheDocument();
    expect(screen.getByText('×4')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('shows no skip card when the window is clean', async () => {
    renderPage({ activation: baseActivation, campaign: campaignRef, issuanceSkips24h: [] });
    await screen.findByText('July Campaign');
    expect(screen.queryByText(/Skipped issuance/)).toBeNull();
  });
});
