/**
 * TeamPipeline — Mine/Team views and the Unowned door.
 *
 * The board opens on the rep's OWN book (their claimed businesses); Team is an
 * explicit switch. Unowned businesses are on neither view by default — the
 * Unowned button deep-links to the Partners list pre-filtered to them, where
 * claiming (incl. bulk) lives.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getTeamPipeline: vi.fn(),
  getConstants: vi.fn(),
  changeStage: vi.fn(),
  undoStage: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  return t;
});
vi.mock('sonner', () => ({ toast: toastMock }));

const authState = vi.hoisted(() => ({ user: null }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (sel) => sel(authState) }));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigateMock,
}));

import TeamPipeline from '../TeamPipeline';

const partner = (id, name, overrides = {}) => ({
  id, tradingName: name, pipelineStage: 'NEW', category: 'Nails',
  ownerUserId: null, owner: null, availability: 'available',
  atRiskFlag: false, staleFlag: false, lostReason: null,
  stageSince: new Date().toISOString(),
  ...overrides,
});
const mine = (id, name, stage = 'NEW') => partner(id, name, {
  pipelineStage: stage, ownerUserId: 'u-me', availability: 'owned',
  owner: { id: 'u-me', fullName: 'Me Myself' },
});
const theirs = (id, name, stage = 'NEW') => partner(id, name, {
  pipelineStage: stage, ownerUserId: 'u-other', availability: 'owned',
  owner: { id: 'u-other', fullName: 'Someone Else' },
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><TeamPipeline /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 'u-me', role: 'redeem_ops', redeemOpsRole: 'outreach_exec' };
  api.getConstants.mockResolvedValue({
    stageTransitions: { NEW: ['CONTACTED'], CONTACTED: ['MEETING', 'LOST'] },
    lostReasons: ['not_interested'],
  });
  api.getTeamPipeline.mockResolvedValue({
    counts: [],
    partners: [
      mine('p-mine', 'My Nail Bar', 'CONTACTED'),
      theirs('p-theirs', 'Their Cafe'),
      partner('p-free', 'Free Gym'),
    ],
  });
});

it('opens on My pipeline: my businesses only, colleagues and unowned hidden', async () => {
  renderPage();
  expect(await screen.findByText('My Nail Bar')).toBeInTheDocument();
  expect(screen.queryByText('Their Cafe')).not.toBeInTheDocument();
  expect(screen.queryByText('Free Gym')).not.toBeInTheDocument();
});

it('Team shows everyone, including unowned cards', async () => {
  renderPage();
  await screen.findByText('My Nail Bar');
  await userEvent.click(screen.getByRole('button', { name: 'Team' }));
  expect(screen.getByText('Their Cafe')).toBeInTheDocument();
  expect(screen.getByText('Free Gym')).toBeInTheDocument();
});

it('the Unowned button counts unclaimed businesses and opens the pre-filtered Partners list', async () => {
  renderPage();
  const btn = await screen.findByRole('button', { name: 'Unowned (1)' });
  await userEvent.click(btn);
  expect(navigateMock).toHaveBeenCalledWith('/redeem-ops/partners?owner=none');
});

it('an empty book points at Unowned instead of showing a bare board', async () => {
  api.getTeamPipeline.mockResolvedValue({
    counts: [],
    partners: [theirs('p-theirs', 'Their Cafe'), partner('p-free', 'Free Gym')],
  });
  renderPage();
  await waitFor(() => expect(api.getTeamPipeline).toHaveBeenCalled());
  expect(await screen.findByText(/No businesses in your book yet/)).toBeInTheDocument();
});

it('"+N more" is a real button: expands the lane to every card, then collapses back', async () => {
  api.getTeamPipeline.mockResolvedValue({
    counts: [],
    partners: Array.from({ length: 35 }, (_, i) => mine(`p-${i + 1}`, `Biz ${i + 1}`, 'CONTACTED')),
  });
  renderPage();
  await screen.findByText('Biz 1');

  // perf guard: 30 cards render, the 31st waits behind the expander
  expect(screen.queryByText('Biz 31')).not.toBeInTheDocument();
  const expander = screen.getByRole('button', { name: '+ 5 more' });
  await userEvent.click(expander);
  expect(screen.getByText('Biz 31')).toBeInTheDocument();
  expect(screen.getByText('Biz 35')).toBeInTheDocument();

  // and back — the same button now collapses the lane
  await userEvent.click(screen.getByRole('button', { name: 'Show first 30' }));
  expect(screen.queryByText('Biz 35')).not.toBeInTheDocument();
  expect(screen.getByText('Biz 30')).toBeInTheDocument();
});
