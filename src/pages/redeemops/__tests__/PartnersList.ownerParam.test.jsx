/**
 * PartnersList — ?owner= deep link.
 *
 * The Pipeline's Unowned button lands on /redeem-ops/partners?owner=none; the
 * param must pre-select the Owner filter (and reach the API), while a missing
 * or bogus value keeps the "my book" default.
 */
import { render, waitFor } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listPartners: vi.fn(),
  getConstants: vi.fn(),
  listCategories: vi.fn(),
  getTeam: vi.fn(),
  claimPartnersBulk: vi.fn(),
  releasePartnersBulk: vi.fn(),
  assignPartnersBulk: vi.fn(),
  changeStageBulk: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

const authState = vi.hoisted(() => ({ user: null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (sel) => sel(authState) }));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => vi.fn(),
}));

import PartnersList from '../PartnersList';

function renderAt(url) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><PartnersList /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 'u-me', role: 'redeem_ops', redeemOpsRole: 'outreach_exec' };
  api.getConstants.mockResolvedValue({ pipelineStages: ['NEW'], lostReasons: [] });
  api.listCategories.mockResolvedValue([]);
  api.getTeam.mockResolvedValue([]);
  api.listPartners.mockResolvedValue({ partners: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 1 } });
});

it('?owner=none pre-filters to unowned businesses', async () => {
  renderAt('/redeem-ops/partners?owner=none');
  await waitFor(() => expect(api.listPartners).toHaveBeenCalledWith(expect.objectContaining({ owner: 'none' })));
});

it('no param keeps the "my book" default', async () => {
  renderAt('/redeem-ops/partners');
  await waitFor(() => expect(api.listPartners).toHaveBeenCalledWith(expect.objectContaining({ owner: 'me' })));
});

it('a bogus value falls back to the default instead of leaking into the API', async () => {
  renderAt('/redeem-ops/partners?owner=DROP%20TABLE');
  await waitFor(() => expect(api.listPartners).toHaveBeenCalledWith(expect.objectContaining({ owner: 'me' })));
});
