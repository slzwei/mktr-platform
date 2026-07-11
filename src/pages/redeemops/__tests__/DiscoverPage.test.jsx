/**
 * DiscoverPage — the three behaviors that guard real money / real data:
 * 1. suggestion cards PREFILL the form and never fire a paid search;
 * 2. a candidate mid-enrichment shows "Enriching…" (not another paid action);
 * 3. dismiss hits the API and the undo toast's action restores.
 * redeemOpsApi is fully mocked — no network, no backend.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listDiscoveryRuns: vi.fn(),
  listCategories: vi.fn(),
  getDiscoveryRun: vi.fn(),
  startDiscovery: vi.fn(),
  enrichDiscoveryCandidates: vi.fn(),
  addDiscoveryCandidates: vi.fn(),
  dismissDiscoveryCandidate: vi.fn(),
  restoreDiscoveryCandidate: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  t.info = vi.fn();
  return t;
});
vi.mock('sonner', () => ({ toast: toastMock }));

// CategorySelect has its own data fetching — swap for a plain input.
vi.mock('@/components/redeemops/CategorySelect', () => ({
  default: ({ value, onChange }) => (
    <input aria-label="Category" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import DiscoverPage from '../DiscoverPage';

const quota = { used: 0, limit: 5, remaining: 5, costPerResultUsd: 0.007 };
const completedRun = {
  id: 'r1', status: 'completed', category: 'Nail Salon', area: 'Tampines',
  requestedLimit: 30, resultCount: 1, createdAt: new Date().toISOString(),
};
const baseCandidate = {
  id: 'c1', name: 'Pending Nails', status: 'pending', dedupeStatus: 'new',
  instagramHandle: 'pend', followersCount: null, enrichmentStatus: 'none',
  rawPayload: { categoryName: 'Discount store' },
};

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DiscoverPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openResults() {
  await userEvent.click(await screen.findByRole('button', { name: /Open results/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listCategories.mockResolvedValue([{ name: 'Nail Salon' }]);
  api.listDiscoveryRuns.mockResolvedValue({ runs: [], quota });
});

describe('DiscoverPage', () => {
  it('suggestion cards prefill the form and never start a paid search', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Nail Salon · Tampines/i });
    await userEvent.click(card);
    expect(api.startDiscovery).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Neighbourhood or district…')).toHaveValue('Tampines');
  });

  it('shows Enriching… while enrichment is pending instead of another paid action', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({
      run: completedRun,
      candidates: [{ ...baseCandidate, enrichmentStatus: 'pending' }],
    });
    renderPage();
    await openResults();
    expect(await screen.findByText('Enriching…')).toBeInTheDocument();
    expect(screen.queryByText('followers?')).not.toBeInTheDocument();
    // Google's own category label is surfaced so weak matches are self-evident.
    expect(screen.getByText(/Discount store/)).toBeInTheDocument();
  });

  it('hidden rows sit behind the Hidden segment with a Restore action', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({
      run: completedRun,
      candidates: [baseCandidate, { ...baseCandidate, id: 'c2', name: 'Hidden Nails', status: 'dismissed' }],
    });
    api.restoreDiscoveryCandidate.mockResolvedValue({});
    renderPage();
    await openResults();
    // hidden by default, surfaced in the count line
    expect(await screen.findByText(/1 hidden/)).toBeInTheDocument();
    expect(screen.queryByText('Hidden Nails')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Hidden 1/ }));
    expect(await screen.findByText('Hidden Nails')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore Hidden Nails' }));
    await waitFor(() => expect(api.restoreDiscoveryCandidate).toHaveBeenCalledWith('c2'));
  });

  it('seen-before rows carry the Seen previously badge', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({
      run: completedRun,
      candidates: [{ ...baseCandidate, previouslySeenAt: new Date().toISOString() }],
    });
    renderPage();
    await openResults();
    expect(await screen.findByText('Seen previously')).toBeInTheDocument();
  });

  it('dismiss calls the API and the undo toast action restores', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({ run: completedRun, candidates: [baseCandidate] });
    api.dismissDiscoveryCandidate.mockResolvedValue({});
    api.restoreDiscoveryCandidate.mockResolvedValue({});
    renderPage();
    await openResults();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Pending Nails' }));
    await waitFor(() => expect(api.dismissDiscoveryCandidate).toHaveBeenCalledWith('c1'));
    const dismissedToast = toastMock.mock.calls.find(([msg]) => msg === 'Dismissed');
    expect(dismissedToast).toBeTruthy();
    dismissedToast[1].action.onClick();
    await waitFor(() => expect(api.restoreDiscoveryCandidate).toHaveBeenCalledWith('c1'));
  });
});
