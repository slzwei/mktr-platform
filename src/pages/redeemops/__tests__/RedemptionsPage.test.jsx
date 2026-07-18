/**
 * RedemptionsPage — campaign stacks + delivery-truth UI (trial-reward-funnel
 * PR A, restyled per the "Redemptions - Campaign Stacks" design):
 * 1. rows group into campaign stacks whose header carries counts + warn chips
 *    (the old per-row No-email badge became the stack's "no email" chip);
 * 2. rows show the delivery receipt and hide "Resend" where an email send is
 *    a guaranteed failure;
 * 3. cancelled/expired rows collapse behind a per-stack "Show closed" link —
 *    but a closed-status FILTER shows them without an extra click;
 * 4. rotating a credential is confirm-gated — opening the dialog fires nothing;
 * 5. the link channel surfaces the one-time bundle incl. the wa.me deep link;
 * 6. the unlock toast never claims "email sent" when none was queued;
 * 7. cancelling a reward is reason-gated (PR #199 contract, kept through the
 *    redesign);
 * 8. staff without entitlements.issue_manual get no resend/share/cancel actions.
 * redeemOpsApi is fully mocked — no network.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listRedemptions: vi.fn(),
  listEntitlements: vi.fn(),
  unlockEntitlement: vi.fn(),
  resendEntitlementPass: vi.fn(),
  cancelEntitlement: vi.fn(),
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

// jsdom lacks the pointer-capture + scroll APIs Radix Select touches.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const rowBase = {
  rewardOffer: { title: 'Free Trial Session' },
  activation: { id: 'a1', campaignNameSnapshot: 'Camp A', partner: { tradingName: 'Mutts & Mittens' } },
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
const closedRow = {
  id: 'e3', status: 'cancelled', tokenHint: null,
  prospect: { id: 'p3', firstName: 'Gone', lastName: 'Lead', phone: '••••0000' },
  emailDeliverable: true,
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
    pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
  });
});

describe('RedemptionsPage campaign stacks + delivery truth', () => {
  it('groups rows under a campaign stack header with counts and a no-email chip', async () => {
    renderPage();
    // Header: campaign + partner + counts as one accessible button (collapsible).
    const header = await screen.findByRole('button', { name: /Camp A.*Mutts & Mittens.*2 reserved/ });
    expect(header).toBeInTheDocument();
    // The old per-row badge is now the stack-level chip.
    expect(screen.getByText('⚠ 1 no email')).toBeInTheDocument();
    expect(screen.getAllByText('Reserved')).toHaveLength(2);
  });

  it('shows receipts and hides Resend where email cannot work', async () => {
    renderPage();
    expect(await screen.findByText(/Pass emailed ·/)).toBeInTheDocument();
    expect(screen.getByText(/Never emailed — share a link instead/)).toBeInTheDocument();
    // Only Sarah's row offers an email resend; both rows offer Copy link.
    expect(screen.getAllByRole('button', { name: /^Resend pass/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Copy link — / })).toHaveLength(2);
  });

  it('collapses cancelled/expired rows behind the per-stack closed link', async () => {
    api.listEntitlements.mockResolvedValue({
      entitlements: [deliverableRow, noEmailRow, closedRow],
      pagination: { page: 1, limit: 100, total: 3, totalPages: 1 },
    });
    renderPage();
    expect(await screen.findByText('Sarah Tan')).toBeInTheDocument();
    expect(screen.queryByText('Gone Lead')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Show 1 closed/ }));
    expect(screen.getByText('Gone Lead')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    // Closed rows carry no actions — still exactly one Resend (Sarah's).
    expect(screen.getAllByRole('button', { name: /^Resend pass/ })).toHaveLength(1);
  });

  it('a closed-status filter shows the matching rows without an extra click', async () => {
    api.listEntitlements.mockImplementation(async (params = {}) => (
      params.status === 'cancelled'
        ? { entitlements: [closedRow], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } }
        : { entitlements: [deliverableRow, noEmailRow, closedRow], pagination: { page: 1, limit: 100, total: 3, totalPages: 1 } }
    ));
    renderPage();
    expect(await screen.findByText('Sarah Tan')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Cancelled' }));
    // The only matching rows are closed — they must be visible immediately.
    expect(await screen.findByText('Gone Lead')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show 1 closed/ })).toBeNull();
    await waitFor(() =>
      expect(api.listEntitlements).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' })));
  });

  it('rotation is confirm-gated: opening the dialog fires nothing until confirmed', async () => {
    api.resendEntitlementPass.mockResolvedValue({
      message: 'New reservation pass emailed — the previous pass QR/link no longer works.',
      data: { kind: 'pass', channel: 'email', emailQueued: true, entitlement: {} },
    });
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /^Resend pass/ }))[0]);
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
    await userEvent.click((await screen.findAllByRole('button', { name: /^Copy link — / }))[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Create new link' }));
    expect(await screen.findByText('https://redeem.sg/r/new-token-abc')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in WhatsApp' }))
      .toHaveAttribute('href', expect.stringContaining('wa.me/6591234567'));
    expect(api.resendEntitlementPass).toHaveBeenCalledWith('e2', { channel: 'link' });
  });

  it('unlock toast is truthful when no email was queued', async () => {
    api.unlockEntitlement.mockResolvedValue({ already: false, emailQueued: false, entitlement: {} });
    renderPage();
    const unlocks = await screen.findAllByRole('button', { name: /^Unlock — / });
    await userEvent.click(unlocks[0]);
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('no email on file')));
    expect(api.unlockEntitlement).toHaveBeenCalledWith({ prospectId: 'p1' });
  });

  it('cancel stays reason-gated through the redesign (PR #199 contract)', async () => {
    api.cancelEntitlement.mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /^Cancel reward — / }))[0]);
    expect(api.cancelEntitlement).not.toHaveBeenCalled();
    // Confirm is disabled until a reason is typed.
    expect(screen.getByRole('button', { name: 'Cancel reward' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for cancelling this reward'), 'duplicate');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reward' }));
    await waitFor(() =>
      expect(api.cancelEntitlement).toHaveBeenCalledWith('e1', { reason: 'duplicate' }));
  });

  it('staff without entitlements.issue_manual see no resend/share/cancel actions', async () => {
    authState.user = { id: 'u2', role: 'redeem_ops', redeemOpsRole: 'bdm' };
    renderPage();
    expect(await screen.findAllByText(/Free Trial Session/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel reward/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Unlock/ })).toBeNull(); // not admin either
  });
});
