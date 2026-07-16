/**
 * RedemptionsPage — delivery-truth UI (trial-reward-funnel PR A):
 * 1. rows show the delivery receipt + a No-email badge, and hide "Resend"
 *    where an email send is a guaranteed failure;
 * 2. rotating a credential is confirm-gated — opening the dialog fires nothing;
 * 3. the link channel surfaces the one-time bundle incl. the wa.me deep link;
 * 4. the unlock toast never claims "email sent" when none was queued;
 * 5. staff without entitlements.issue_manual get no resend/share actions.
 * redeemOpsApi is fully mocked — no network.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listRedemptions: vi.fn(),
  listEntitlements: vi.fn(),
  unlockEntitlement: vi.fn(),
  resendEntitlementPass: vi.fn(),
  verifyVoucher: vi.fn(),
  completeRedemption: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  return t;
});
vi.mock('sonner', () => ({ toast: toastMock }));

const authState = vi.hoisted(() => ({ user: { id: 'u1', role: 'admin' } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel) => sel({ user: authState.user }),
}));

import RedemptionsPage from '../RedemptionsPage';

const rowBase = {
  rewardOffer: { title: 'Free Trial Session' },
  activation: { campaignNameSnapshot: 'Camp A' },
};
const deliverableRow = {
  id: 'e1', status: 'eligible', tokenHint: null,
  prospect: { id: 'p1', firstName: 'Sarah', lastName: 'Tan', phone: '••••1234' },
  emailDeliverable: true,
  delivery: { email: { kind: 'pass', at: '2026-07-16T06:03:00.000Z', ok: true } },
  ...rowBase,
};
const noEmailRow = {
  id: 'e2', status: 'eligible', tokenHint: null,
  prospect: { id: 'p2', firstName: 'Retell', lastName: 'Lead', phone: '••••8800' },
  emailDeliverable: false,
  delivery: { email: null },
  ...rowBase,
};

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><RedemptionsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 'u1', role: 'admin' };
  api.listRedemptions.mockResolvedValue({ redemptions: [] });
  api.listEntitlements.mockResolvedValue({
    entitlements: [deliverableRow, noEmailRow],
    pagination: { page: 1, limit: 15, total: 2, totalPages: 1 },
  });
});

describe('RedemptionsPage delivery truth', () => {
  it('shows receipts + No-email badge, and hides Resend where email cannot work', async () => {
    renderPage();
    expect(await screen.findByText(/Pass emailed ·/)).toBeInTheDocument();
    expect(screen.getByText('No email')).toBeInTheDocument();
    expect(screen.getByText(/Never emailed — share a link instead/)).toBeInTheDocument();
    // Only Sarah's row offers an email resend; both rows offer Copy link.
    expect(screen.getAllByRole('button', { name: 'Resend pass' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy link' })).toHaveLength(2);
  });

  it('rotation is confirm-gated: opening the dialog fires nothing until confirmed', async () => {
    api.resendEntitlementPass.mockResolvedValue({
      message: 'New reservation pass emailed — the previous pass QR/link no longer works.',
      data: { kind: 'pass', channel: 'email', emailQueued: true, entitlement: {} },
    });
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Resend pass' }))[0]);
    expect(api.resendEntitlementPass).not.toHaveBeenCalled();
    expect(screen.getByText(/stops working immediately/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    await waitFor(() => expect(api.resendEntitlementPass).toHaveBeenCalledWith('e1', { channel: 'email' }));
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('no longer works'));
  });

  it('link channel shows the one-time bundle with the WhatsApp deep link', async () => {
    api.resendEntitlementPass.mockResolvedValue({
      message: 'New reservation pass link created…',
      data: {
        kind: 'pass', channel: 'link', emailQueued: false, entitlement: {},
        link: 'https://redeem.sg/r/new-token-abc',
        waMessage: 'Hi Sarah! 🎁 Your Free Trial Session…',
        waUrl: 'https://wa.me/6591234567?text=Hi%20Sarah',
      },
    });
    renderPage();
    // The no-email row still gets Copy link — use it (index 1).
    await userEvent.click((await screen.findAllByRole('button', { name: 'Copy link' }))[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Create new link' }));
    expect(await screen.findByText('https://redeem.sg/r/new-token-abc')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in WhatsApp' }))
      .toHaveAttribute('href', expect.stringContaining('wa.me/6591234567'));
    expect(api.resendEntitlementPass).toHaveBeenCalledWith('e2', { channel: 'link' });
  });

  it('unlock toast is truthful when no email was queued', async () => {
    api.unlockEntitlement.mockResolvedValue({ already: false, emailQueued: false, entitlement: {} });
    renderPage();
    const unlocks = await screen.findAllByRole('button', { name: 'Unlock' });
    await userEvent.click(unlocks[0]);
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('no email on file')));
  });

  it('staff without entitlements.issue_manual see no resend/share actions', async () => {
    authState.user = { id: 'u2', role: 'redeem_ops', redeemOpsRole: 'bdm' };
    renderPage();
    expect(await screen.findAllByText(/Free Trial Session/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull(); // not admin either
  });
});
