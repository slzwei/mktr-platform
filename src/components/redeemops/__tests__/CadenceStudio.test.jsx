/**
 * CadenceStudio row-action scoping — the UI mirror of the service's
 * canAuthorRow: the settings.manage tier manages every row; everyone else
 * (BDMs, outreach execs) only the cadences they created. The API enforces
 * this regardless — the UI must never offer a button that would 403.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => {
  vi.stubEnv('VITE_REDEEM_OPS_CADENCES_ENABLED', 'true');
});

const api = vi.hoisted(() => ({
  listCadences: vi.fn(),
  retireCadence: vi.fn(),
  publishCadence: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

vi.mock('sonner', () => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  return { toast: t };
});

import CadenceStudio from '../CadenceStudio';
import { useAuthStore } from '@/stores/authStore';

const myDraft = {
  id: 'c-mine', name: 'My private chase', version: 1,
  publishedAt: null, createdBy: 'u-bd', steps: [],
};
const teamCadence = {
  id: 'c-team', name: 'Team chase', version: 2,
  publishedAt: '2026-07-01T00:00:00.000Z', createdBy: 'u-other', steps: [],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CadenceStudio /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listCadences.mockResolvedValue({ cadences: [myDraft, teamCadence] });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('CadenceStudio — row-action scoping', () => {
  it('a BD rep gets Edit/Retire/Publish only on cadences they created', async () => {
    useAuthStore.setState({ user: { id: 'u-bd', role: 'user', redeemOpsRole: 'bdm' } });
    wrap();

    expect(await screen.findByText('My private chase')).toBeInTheDocument();
    // own draft: publish + edit + retire
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit my private chase/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^retire$/i })).toHaveLength(1);
    // someone else's published cadence: no actions at all
    expect(screen.getByText('Team chase')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit team chase/i })).not.toBeInTheDocument();
  });

  it('outreach execs are scoped the same way as BDMs', async () => {
    useAuthStore.setState({ user: { id: 'u-oe', role: 'user', redeemOpsRole: 'outreach_exec' } });
    wrap();

    expect(await screen.findByText('Team chase')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument();
    // the New cadence entry stays — creating is always allowed here
    expect(screen.getByRole('link', { name: /new cadence/i })).toBeInTheDocument();
  });

  it('a settings.manage admin keeps actions on every row', async () => {
    useAuthStore.setState({ user: { id: 'u-admin', role: 'user', redeemOpsRole: 'ops_admin' } });
    wrap();

    expect(await screen.findByText('My private chase')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit my private chase/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit team chase/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^retire$/i })).toHaveLength(2);
  });
});
