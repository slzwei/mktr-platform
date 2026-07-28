/**
 * PartnersList — multi-select and bulk claim.
 *
 * The behaviours worth pinning: only claimable rows are selectable (the UI must
 * never offer what the server's conditional UPDATE would refuse), selection
 * mode turns the whole row into the checkbox so a stray click can't navigate
 * away and silently discard the selection, and a partially-successful claim
 * reports what actually happened instead of a flat "done".
 * redeemOpsApi is fully mocked — no network.
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
  claimPartnersBulk: vi.fn(),
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
  authState.user = { role: 'redeem_ops', redeemOpsRole: 'outreach_exec' };
  api.getConstants.mockResolvedValue({ pipelineStages: ['NEW'] });
  api.listCategories.mockResolvedValue([]);
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

it('only unowned rows are selectable — an owned one cannot be ticked', async () => {
  renderPage();
  const takenRow = await rowFor('Taken Co');
  expect(within(takenRow).getByRole('checkbox')).toBeDisabled();
  const freeRow = await rowFor('Free One');
  expect(within(freeRow).getByRole('checkbox')).toBeEnabled();
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
  expect(screen.getByText('2')).toBeInTheDocument(); // "2 selected"

  // Clicking an UNCLAIMABLE row in selection mode is inert — it can neither be
  // ticked nor yank the operator off the list.
  await userEvent.click(await rowFor('Taken Co'));
  expect(navigateMock).not.toHaveBeenCalled();

  // Clearing hands normal navigation back.
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await userEvent.click(await rowFor('Free One'));
  expect(navigateMock).toHaveBeenCalledWith('/redeem-ops/partners/p1');
});

it('select-all covers only the claimable rows on the page', async () => {
  renderPage();
  await userEvent.click(await screen.findByLabelText(/Select all claimable/i));
  expect(screen.getByText('2')).toBeInTheDocument(); // the owned row is excluded
});

it('claims the selection and reports a partial result honestly', async () => {
  api.claimPartnersBulk.mockResolvedValue({
    message: '1 of 2 claimed',
    data: { claimed: ['p1'], failed: [{ id: 'p2', reason: 'already_claimed', claimedBy: { id: 'u9', fullName: 'Rival Rep' } }] },
  });
  renderPage();
  await userEvent.click(await screen.findByLabelText(/Select all claimable/i));
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  await waitFor(() => expect(api.claimPartnersBulk).toHaveBeenCalledWith(['p1', 'p2']));
  // Partial success is a warning that names the loss, not a success toast.
  expect(toastMock.warning).toHaveBeenCalledWith('1 of 2 claimed', expect.objectContaining({
    description: expect.stringContaining('Rival Rep'),
  }));
  // Only what landed is deselected, so a retry keeps the one that didn't.
  await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
});

it('hides the whole affordance from someone who cannot claim', async () => {
  authState.user = { role: 'redeem_ops', redeemOpsRole: 'viewer' };
  renderPage();
  await screen.findAllByText('Free One');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
