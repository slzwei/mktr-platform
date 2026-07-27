/**
 * PartnerDetail row-level gating: a business is worked by whoever owns it.
 * A BDM manages the board (assign, tasks, visibility) but does NOT get to move,
 * rename or restructure a colleague's business — the UI must not offer what
 * partnerService.canActOnRow would refuse with a 403.
 * redeemOpsApi is fully mocked — no network.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getPartner: vi.fn(),
  getTimeline: vi.fn(),
  getConstants: vi.fn(),
  getTeam: vi.fn(),
  listPartners: vi.fn(),
  getPartnerCadence: vi.fn(),
  listTasks: vi.fn(),
  listCadences: vi.fn(),
  getOnboarding: vi.fn(),
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
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel) => sel(authState),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'p-1' }) };
});

import PartnerDetail from '../PartnerDetail';

const OWNER_ID = 'u-tyler';

const basePartner = {
  id: 'p-1',
  tradingName: 'Secret Garden Nail Boutique',
  pipelineStage: 'CONTACTED',
  availability: 'owned',
  ownerUserId: OWNER_ID,
  owner: { id: OWNER_ID, fullName: 'Tyler Lim' },
  contacts: [{ id: 'c-1', name: 'Shop Owner', mobile: '+6591230000' }],
  locations: [],
};

function renderDetail(user, partner = basePartner) {
  authState.user = user;
  api.getPartner.mockResolvedValue(partner);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PartnerDetail /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTimeline.mockResolvedValue([]);
  api.getConstants.mockResolvedValue({
    stageTransitions: { CONTACTED: ['MEETING', 'LOST'] },
    lostReasons: ['not_interested'],
    activityTypes: ['call_attempt'],
  });
  api.getTeam.mockResolvedValue([]);
  api.listPartners.mockResolvedValue({ partners: [] });
  api.getPartnerCadence.mockResolvedValue(null);
  api.listTasks.mockResolvedValue([]);
  api.listCadences.mockResolvedValue([]);
  api.getOnboarding.mockResolvedValue([]);
});

/** Contacts/locations forms live in tabs that only mount when selected. */
async function openTab(label) {
  await userEvent.click(screen.getByRole('tab', { name: new RegExp(label, 'i') }));
  return waitFor(() => expect(screen.getByRole('tabpanel')).toBeTruthy());
}

describe('PartnerDetail — only the owner works the business', () => {
  it('hides move/edit/snooze from a non-owner BDM', async () => {
    renderDetail({ id: 'u-jeremy', role: 'redeem_ops', redeemOpsRole: 'bdm' });
    await screen.findByText('Secret Garden Nail Boutique');

    expect(screen.queryByText('Move stage…')).toBeNull();
    expect(screen.queryByRole('button', { name: /edit business details/i })).toBeNull();
    expect(screen.queryByText('Snooze')).toBeNull();
  });

  it('hides contact + location editing from a non-owner BDM', async () => {
    renderDetail({ id: 'u-jeremy', role: 'redeem_ops', redeemOpsRole: 'bdm' });
    await screen.findByText('Secret Garden Nail Boutique');

    await openTab('contacts');
    // The contact is visible — it's editing it that's off limits.
    expect(screen.getByText('Shop Owner')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit shop owner/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove shop owner/i })).toBeNull();
    expect(screen.queryByPlaceholderText('Name *')).toBeNull();

    await openTab('locations');
    expect(screen.queryByPlaceholderText('Outlet name')).toBeNull();
  });

  it('gives the owner contact + location editing', async () => {
    renderDetail({ id: OWNER_ID, role: 'redeem_ops', redeemOpsRole: 'bdm' });
    await screen.findByText('Secret Garden Nail Boutique');

    await openTab('contacts');
    expect(screen.getByRole('button', { name: /edit shop owner/i })).toBeTruthy();
    expect(screen.getByPlaceholderText('Name *')).toBeTruthy();

    await openTab('locations');
    expect(screen.getByPlaceholderText('Outlet name')).toBeTruthy();
  });

  it('still lets that BDM log activity — restricting writes is not hiding the deal', async () => {
    renderDetail({ id: 'u-jeremy', role: 'redeem_ops', redeemOpsRole: 'bdm' });
    await screen.findByText('Secret Garden Nail Boutique');

    expect(screen.getAllByText('Log activity').length).toBeGreaterThan(0);
  });

  it('gives the owner the full set', async () => {
    renderDetail({ id: OWNER_ID, role: 'redeem_ops', redeemOpsRole: 'bdm' });
    await screen.findByText('Secret Garden Nail Boutique');

    await waitFor(() => expect(screen.getAllByText('Move stage…').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /edit business details/i })).toBeTruthy();
    expect(screen.getAllByText('Snooze').length).toBeGreaterThan(0);
  });

  it('gives an admin the full set on someone else’s business', async () => {
    renderDetail({ id: 'u-shawn', role: 'admin' });
    await screen.findByText('Secret Garden Nail Boutique');

    await waitFor(() => expect(screen.getAllByText('Move stage…').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /edit business details/i })).toBeTruthy();
  });

  it('an unowned business offers Claim, not the working controls', async () => {
    renderDetail(
      { id: 'u-jeremy', role: 'redeem_ops', redeemOpsRole: 'bdm' },
      { ...basePartner, ownerUserId: null, owner: null }
    );
    await screen.findByText('Secret Garden Nail Boutique');

    expect(screen.getAllByText('Claim business').length).toBeGreaterThan(0);
    expect(screen.queryByText('Move stage…')).toBeNull();

    await openTab('contacts');
    expect(screen.queryByPlaceholderText('Name *')).toBeNull();
  });
});
