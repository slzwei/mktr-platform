/**
 * Outreach personas card (email auto-send Phase A): connect account, import
 * from the LIVE Workspace directory (no typed addresses), tie who-is-who,
 * test send. redeemOpsApi fully mocked — no network.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getOutreachAccount: vi.fn(),
  setupOutreachAccount: vi.fn(),
  refreshOutreachHealth: vi.fn(),
  listWorkspaceAddresses: vi.fn(),
  listOutreachPersonas: vi.fn(),
  importOutreachPersonas: vi.fn(),
  updateOutreachPersona: vi.fn(),
  testSendOutreachPersona: vi.fn(),
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

import OutreachPersonasCard from '../OutreachPersonasCard';

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const configuredAccount = {
  configured: true,
  hasCredentials: true,
  encryptionReady: true,
  accountEmail: 'business@mktr.sg',
  lastHealthCheckAt: '2026-08-11T04:00:00Z',
  lastError: null,
};

const emily = {
  id: 'op-1',
  address: 'emily@redeem.sg',
  displayName: 'Emily Wong',
  assignedUserId: 'u-emily',
  isAccountAlias: true,
  sendAsVerified: true,
  dailySendCap: 30,
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getTeam.mockResolvedValue([
    { id: 'u-emily', fullName: 'Emily Wong' },
    { id: 'u-jeremy', fullName: 'Jeremy Ho Wei Kang' },
  ]);
  api.listOutreachPersonas.mockResolvedValue([]);
});

describe('OutreachPersonasCard', () => {
  it('unconfigured: offers Connect and posts the pasted key with the account email', async () => {
    api.getOutreachAccount.mockResolvedValue({ configured: false });
    api.setupOutreachAccount.mockResolvedValue({ health: { aliasCount: 4 } });
    const user = userEvent.setup();
    wrap(<OutreachPersonasCard />);

    await user.click(await screen.findByRole('button', { name: /connect account/i }));
    await user.type(screen.getByLabelText(/service account key json/i), '{{"type": "service_account"}');
    await user.click(screen.getByRole('button', { name: /connect & check/i }));
    await waitFor(() => expect(api.setupOutreachAccount).toHaveBeenCalledWith({
      accountEmail: 'business@mktr.sg',
      serviceAccountJson: '{"type": "service_account"}',
    }));
  });

  it('renders persona rows with status and reassigns via the rep select (server enforces 1:1)', async () => {
    api.getOutreachAccount.mockResolvedValue(configuredAccount);
    api.listOutreachPersonas.mockResolvedValue([
      emily,
      { ...emily, id: 'op-2', address: 'jeremy@redeem.sg', displayName: 'Jeremy', assignedUserId: null, sendAsVerified: false },
    ]);
    api.updateOutreachPersona.mockResolvedValue({});
    const user = userEvent.setup();
    wrap(<OutreachPersonasCard />);

    expect(await screen.findByText('emily@redeem.sg')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('send-as pending')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Rep for jeremy@redeem.sg'), 'u-jeremy');
    await waitFor(() => expect(api.updateOutreachPersona).toHaveBeenCalledWith('op-2', { assignedUserId: 'u-jeremy' }));
    // Emily already holds u-emily — that option is disabled for Jeremy's row.
    expect(screen.getByLabelText('Rep for jeremy@redeem.sg').querySelector('option[value="u-emily"]').disabled).toBe(true);
  });

  it('import dialog lists ONLY the account aliases, disables taken ones, and imports the picked set', async () => {
    api.getOutreachAccount.mockResolvedValue(configuredAccount);
    api.listWorkspaceAddresses.mockResolvedValue({
      accountEmail: 'business@mktr.sg',
      users: [],
      accountAliases: [
        { address: 'dara@redeem.sg', importable: true },
        { address: 'emily@redeem.sg', importable: false },
      ],
    });
    api.importOutreachPersonas.mockResolvedValue({ created: [{ address: 'dara@redeem.sg' }], rejected: [] });
    const user = userEvent.setup();
    wrap(<OutreachPersonasCard />);

    await user.click(await screen.findByRole('button', { name: /import from workspace/i }));
    expect(await screen.findByText(/dara@redeem.sg/)).toBeInTheDocument();
    expect(screen.getByText(/emily@redeem.sg — already imported/)).toBeInTheDocument();

    await user.click(screen.getByText(/dara@redeem.sg/));
    await user.click(screen.getByRole('button', { name: /import selected/i }));
    await waitFor(() => expect(api.importOutreachPersonas).toHaveBeenCalledWith(['dara@redeem.sg']));
  });

  it('test send reports the Message-ID probe result honestly', async () => {
    api.getOutreachAccount.mockResolvedValue(configuredAccount);
    api.listOutreachPersonas.mockResolvedValue([emily]);
    api.testSendOutreachPersona.mockResolvedValue({ gmailId: 'gm-1', mintedPreserved: false });
    const user = userEvent.setup();
    wrap(<OutreachPersonasCard />);

    await user.click(await screen.findByRole('button', { name: /test send/i }));
    await waitFor(() => expect(api.testSendOutreachPersona).toHaveBeenCalledWith('op-1'));
    const [, opts] = toastMock.success.mock.calls.at(-1);
    expect(opts.description).toMatch(/rewrote our Message-ID/i);
  });

  it('a health error is shown loudly on the card', async () => {
    api.getOutreachAccount.mockResolvedValue({
      ...configuredAccount,
      lastError: 'Google token exchange failed (401): unauthorized_client',
    });
    wrap(<OutreachPersonasCard />);
    expect(await screen.findByText(/health error/i)).toBeInTheDocument();
    expect(screen.getByText(/unauthorized_client/)).toBeInTheDocument();
  });
});
