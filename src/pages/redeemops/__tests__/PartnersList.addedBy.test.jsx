/**
 * PartnersList — the "Added by" column.
 *
 * The column exists because "Owner: —" was being read as "nobody has touched
 * this", when in fact somebody typed the business in. Owner moves every time a
 * row is claimed, assigned or released; the creator never does. So the two
 * columns are expected to DISAGREE, and the header carries its own explanation
 * (dotted underline → hover/focus bubble) rather than relying on the reader.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listPartners: vi.fn(),
  getConstants: vi.fn(),
  listCategories: vi.fn(),
  getTeam: vi.fn(),
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

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => vi.fn(),
}));

import PartnersList from '../PartnersList';

const base = (id, name) => ({
  id, tradingName: name, ownerUserId: null, availability: 'available',
  archivedAt: null, mergedIntoId: null, pipelineStage: 'NEW', owner: null,
  category: null, lastActivityAt: null,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PartnersList /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// The page renders a mobile card list AND the desktop table, so a name matches
// twice — scope to the row that lives inside the table.
const rowFor = async (name) => {
  const hits = await screen.findAllByText(name);
  const row = hits.map((el) => el.closest('tr')).find(Boolean);
  if (!row) throw new Error(`No table row for ${name}`);
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 'u-me', role: 'redeem_ops', redeemOpsRole: 'outreach_exec' };
  api.getConstants.mockResolvedValue({ pipelineStages: ['NEW'], lostReasons: [] });
  api.listCategories.mockResolvedValue([]);
  api.getTeam.mockResolvedValue([]);
  api.listPartners.mockResolvedValue({
    partners: [
      // Added by one person, now owned by another — the whole point.
      {
        ...base('p1', 'Handed Over Studio'),
        ownerUserId: 'u-other', availability: 'owned',
        owner: { id: 'u-other', fullName: 'Rachel Ho' },
        creator: { id: 'u-me', fullName: 'Shawn Lee' },
      },
      // Nobody owns it, but somebody still put it on the books.
      { ...base('p2', 'Unclaimed Gym'), creator: { id: 'u-mate', fullName: 'Vincent Chung' } },
    ],
    pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
  });
});

it('shows the creator alongside the owner, and they can disagree', async () => {
  renderPage();
  const row = await rowFor('Handed Over Studio');
  // Owner chip says Rachel; Added by says Shawn. Both first names, both present.
  expect(row).toHaveTextContent('Rachel');
  expect(row).toHaveTextContent('Shawn');
});

it('an unowned row still names who added it', async () => {
  renderPage();
  const row = await rowFor('Unclaimed Gym');
  expect(row).toHaveTextContent('Vincent');
});

it('the header explains itself — hovering the dotted label says it is not the owner', async () => {
  renderPage();
  const label = await screen.findByRole('button', { name: 'Added by' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await userEvent.hover(label);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/not who owns it/i);
});

it('the hint is reachable without a mouse', async () => {
  renderPage();
  const label = await screen.findByRole('button', { name: 'Added by' });
  label.focus();
  expect(await screen.findByRole('tooltip')).toBeInTheDocument();
});
