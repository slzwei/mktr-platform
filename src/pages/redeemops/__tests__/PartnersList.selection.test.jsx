/**
 * PartnersList — multi-select and the four bulk actions.
 *
 * The behaviours worth pinning:
 * - selection mode turns the whole row into the checkbox, so a stray click
 *   can't navigate away and silently discard the selection;
 * - every live row is selectable, because release and reassign apply precisely
 *   to rows that ARE owned — but each button counts only the rows IT can touch,
 *   so the UI still never promises what the server would refuse;
 * - a partially-successful batch reports what actually happened, and only the
 *   ids that landed are deselected;
 * - each action is behind its own capability.
 *
 * The api mocks resolve the SHAPE THE REAL CLIENT RETURNS — the inner data
 * object, `{ claimed }` not `{ data: { claimed } }`. Mocking the envelope is how
 * a blank toast and a selection that never cleared went unnoticed.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  t.warning = vi.fn();
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

import PartnersList from '../PartnersList';

const free = (id, name) => ({
  id, tradingName: name, ownerUserId: null, availability: 'available',
  archivedAt: null, mergedIntoId: null, pipelineStage: 'NEW', owner: null,
  category: null, lastActivityAt: null,
});
const owned = (id, name) => ({
  ...free(id, name), ownerUserId: 'u-other', availability: 'owned',
  owner: { id: 'u-other', fullName: 'Someone Else' },
});
const mine = (id, name) => ({
  ...free(id, name), ownerUserId: 'u-me', availability: 'owned',
  owner: { id: 'u-me', fullName: 'Me Myself' },
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PartnersList /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // outreach_exec: claims, releases and moves stages — never reassigns.
  authState.user = { id: 'u-me', role: 'redeem_ops', redeemOpsRole: 'outreach_exec' };
  api.getConstants.mockResolvedValue({
    pipelineStages: ['NEW', 'CONTACTED', 'LOST'],
    lostReasons: ['not_interested', 'no_response'],
  });
  api.listCategories.mockResolvedValue([]);
  api.getTeam.mockResolvedValue([{ id: 'u-mate', fullName: 'Rachel Ho', isActive: true }]);
  api.listPartners.mockResolvedValue({
    partners: [free('p1', 'Free One'), free('p2', 'Free Two'), owned('p3', 'Taken Co')],
    pagination: { page: 1, limit: 25, total: 3, totalPages: 1 },
  });
});

// The page renders a mobile card list AND the desktop table, so the name
// matches twice — scope to the row that lives inside the table.
const rowFor = async (name) => {
  const hits = await screen.findAllByText(name);
  const row = hits.map((el) => el.closest('tr')).find(Boolean);
  if (!row) throw new Error(`No table row for ${name}`);
  return row;
};
const bar = () => screen.getByRole('status');
const tickAll = async () => userEvent.click(await screen.findByLabelText(/Select all on this page/i));

it('every live row is selectable, but Claim counts only the unowned ones', async () => {
  renderPage();
  // An owned row can be ticked — releasing and reassigning are what you'd tick
  // it FOR — while Claim's own count leaves it out.
  const takenRow = await rowFor('Taken Co');
  expect(within(takenRow).getByRole('checkbox')).toBeEnabled();

  await tickAll();
  expect(within(bar()).getByText('3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Claim 2' })).toBeEnabled();
});

it('with nothing selected, clicking a row opens the business', async () => {
  renderPage();
  await userEvent.click(await rowFor('Free One'));
  expect(navigateMock).toHaveBeenCalledWith('/redeem-ops/partners/p1');
});

it('once something is selected, clicking rows selects instead of navigating', async () => {
  renderPage();
  const first = await rowFor('Free One');
  await userEvent.click(within(first).getByRole('checkbox'));
  navigateMock.mockClear();

  // Selection mode: the whole row is now the checkbox. Navigating here would
  // throw the selection away, which is the bug this pins.
  await userEvent.click(await rowFor('Free Two'));
  expect(navigateMock).not.toHaveBeenCalled();
  expect(within(await rowFor('Free Two')).getByRole('checkbox')).toBeChecked();
  expect(within(bar()).getByText('2')).toBeInTheDocument();

  // Clearing hands normal navigation back.
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await userEvent.click(await rowFor('Free One'));
  expect(navigateMock).toHaveBeenCalledWith('/redeem-ops/partners/p1');
});

it('claims the selection and reports a partial result honestly', async () => {
  api.claimPartnersBulk.mockResolvedValue({
    claimed: ['p1'],
    failed: [{ id: 'p2', reason: 'already_claimed', claimedBy: { id: 'u9', fullName: 'Rival Rep' } }],
  });
  renderPage();
  await userEvent.click(within(await rowFor('Free One')).getByRole('checkbox'));
  await userEvent.click(within(await rowFor('Free Two')).getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Claim 2' }));

  await waitFor(() => expect(api.claimPartnersBulk).toHaveBeenCalledWith(['p1', 'p2']));
  // Partial success is a warning that names the loss, not a success toast — and
  // the headline is real text, not `undefined`.
  await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith('1 of 2 claimed', expect.objectContaining({
    description: expect.stringContaining('Rival Rep'),
  })));
  // Only what landed is deselected, so a retry keeps the one that didn't.
  await waitFor(() => expect(within(bar()).getByText('1')).toBeInTheDocument());
  expect(within(await rowFor('Free Two')).getByRole('checkbox')).toBeChecked();
});

it('a clean claim says so and empties the selection', async () => {
  api.claimPartnersBulk.mockResolvedValue({ claimed: ['p1'], failed: [] });
  renderPage();
  await userEvent.click(within(await rowFor('Free One')).getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Claim 1' }));

  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('1 business claimed'));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

it('Release counts only the rows the operator owns, and sends the reason', async () => {
  api.listPartners.mockResolvedValue({
    partners: [mine('p1', 'My Studio'), owned('p3', 'Taken Co')],
    pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
  });
  api.releasePartnersBulk.mockResolvedValue({
    released: ['p1'],
    failed: [{ id: 'p3', reason: 'owned_by_other', claimedBy: { id: 'u-other', fullName: 'Someone Else' } }],
  });
  renderPage();
  await tickAll();

  // Two selected, one releasable — the teammate's row is not offered.
  expect(within(bar()).getByText('2')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Release 1' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByPlaceholderText(/handing the estate/i), 'left the team');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Release' }));

  await waitFor(() => expect(api.releasePartnersBulk).toHaveBeenCalledWith(['p1', 'p3'], 'left the team'));
  await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith('1 of 2 released', expect.objectContaining({
    description: expect.stringContaining('not yours to release'),
  })));
});

it('Release is unavailable when nothing selected is the operator’s', async () => {
  renderPage();
  await tickAll(); // p1/p2 unowned, p3 someone else's — none are mine
  expect(screen.getByRole('button', { name: /^Release/ })).toBeDisabled();
});

it('an outreach exec is not offered Assign to…', async () => {
  renderPage();
  await tickAll();
  expect(screen.queryByRole('button', { name: 'Assign to…' })).not.toBeInTheDocument();
  expect(api.getTeam).not.toHaveBeenCalled(); // no roster fetch it can't use
});

it('a BDM assigns the whole selection to one teammate', async () => {
  authState.user = { id: 'u-me', role: 'redeem_ops', redeemOpsRole: 'bdm' };
  api.assignPartnersBulk.mockResolvedValue({ assigned: ['p1', 'p2', 'p3'], failed: [] });
  renderPage();
  await tickAll();
  await userEvent.click(screen.getByRole('button', { name: 'Assign to…' }));

  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByPlaceholderText(/territory swap/i), 'her patch now');
  await userEvent.click(within(dialog).getByRole('button', { name: /Rachel Ho/ }));

  await waitFor(() => expect(api.assignPartnersBulk)
    .toHaveBeenCalledWith(['p1', 'p2', 'p3'], 'u-mate', 'her patch now'));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('3 businesses assigned'));
});

it('a bulk move needs a stage, and LOST needs a reason before it will send', async () => {
  api.changeStageBulk.mockResolvedValue({ moved: ['p1'], failed: [] });
  renderPage();
  await userEvent.click(within(await rowFor('Free One')).getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Move stage' }));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Move 1' })).toBeDisabled();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Lost' }));
  expect(within(dialog).getByRole('button', { name: 'Move 1' })).toBeDisabled(); // no reason yet

  await userEvent.click(within(dialog).getByRole('button', { name: 'Not interested' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Move 1' }));

  await waitFor(() => expect(api.changeStageBulk).toHaveBeenCalledWith(['p1'], 'LOST', {
    reason: null, lostReason: 'not_interested',
  }));
});

it('a move that some rows refuse quotes the machine’s reason', async () => {
  api.changeStageBulk.mockResolvedValue({
    moved: ['p1'],
    failed: [{ id: 'p3', reason: 'not_owner', message: 'You can only move businesses you own' }],
  });
  renderPage();
  await tickAll();
  await userEvent.click(screen.getByRole('button', { name: 'Move stage' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Contacted' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Move 3' }));

  await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith('1 of 2 moved', expect.objectContaining({
    description: expect.stringContaining('only move businesses you own'),
  })));
});

it('hides the whole affordance from someone who can do none of it', async () => {
  authState.user = { id: 'u-me', role: 'redeem_ops', redeemOpsRole: 'analyst' };
  renderPage();
  await screen.findAllByText('Free One');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
