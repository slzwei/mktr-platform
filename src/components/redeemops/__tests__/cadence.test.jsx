/**
 * Cadence UI — the behaviors that guard the engine's contract:
 * 1. the Outcome menu offers ONLY the channel-valid dispositions;
 * 2. a disposition fires the dedicated completion endpoint (never generic PATCH);
 * 3. not_interested confirms first and can mark the business Lost in the same call.
 * redeemOpsApi is fully mocked — no network.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => {
  vi.stubEnv('VITE_REDEEM_OPS_CADENCES_ENABLED', 'true');
});

const api = vi.hoisted(() => ({
  completeCadenceTask: vi.fn(),
  getPartnerCadence: vi.fn(),
  listCadences: vi.fn(),
  enrollCadence: vi.fn(),
  pauseCadence: vi.fn(),
  resumeCadence: vi.fn(),
  stopCadence: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  return t;
});
vi.mock('sonner', () => ({ toast: toastMock }));

import { CadenceOutcomeButton, CadenceChip, CadencePanel } from '../cadence';

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const callTask = {
  id: 'task-1',
  title: 'Intro call',
  partnerOrganisationId: 'p-1',
  description: 'Hi there, calling from Redeem…',
  snapshotRecipient: '+6581234567',
  cadenceStep: { id: 's-1', stepOrder: 1, channel: 'call', title: 'Intro call', cadence: { key: 'fnb_call_first', name: 'F&B call-first', version: 1 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.completeCadenceTask.mockResolvedValue({ nextTask: null });
});

describe('CadenceChip', () => {
  it('shows the cadence name and step order', () => {
    wrap(<CadenceChip task={callTask} />);
    expect(screen.getByText(/F&B call-first · 1/)).toBeInTheDocument();
  });
});

describe('CadenceOutcomeButton', () => {
  it('offers only the call-channel dispositions', async () => {
    const user = userEvent.setup();
    wrap(<CadenceOutcomeButton task={callTask} />);
    await user.click(screen.getByRole('button', { name: /outcome/i }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('No answer')).toBeInTheDocument();
    expect(screen.getByText('They replied')).toBeInTheDocument();
    expect(screen.queryByText('Sent')).not.toBeInTheDocument(); // whatsapp/email only
  });

  it('a plain disposition hits the dedicated completion endpoint', async () => {
    const user = userEvent.setup();
    wrap(<CadenceOutcomeButton task={callTask} />);
    await user.click(screen.getByRole('button', { name: /outcome/i }));
    await user.click(await screen.findByText('No answer'));
    await waitFor(() => expect(api.completeCadenceTask).toHaveBeenCalledWith('task-1', { disposition: 'no_answer' }));
  });

  it('not_interested confirms and can mark Lost in the same call', async () => {
    const user = userEvent.setup();
    wrap(<CadenceOutcomeButton task={callTask} />);
    await user.click(screen.getByRole('button', { name: /outcome/i }));
    await user.click(await screen.findByText('Not interested'));
    // confirm dialog, "also mark Lost" pre-checked
    await user.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.completeCadenceTask).toHaveBeenCalledWith('task-1', {
      disposition: 'not_interested', alsoMarkLost: true, lostReason: 'not_interested',
    }));
  });
});

describe('CadencePanel', () => {
  it('renders the live enrollment with progress and controls', async () => {
    api.getPartnerCadence.mockResolvedValue({
      enrollment: {
        id: 'e-1', state: 'active',
        cadence: { id: 'c-1', name: 'F&B call-first', version: 1, steps: [
          { id: 's-1', stepOrder: 1, title: 'Intro call' },
          { id: 's-2', stepOrder: 2, title: 'WhatsApp intro' },
        ] },
        currentStep: { id: 's-2', stepOrder: 2 },
      },
      openTask: { id: 'task-2', title: 'WhatsApp intro', dueAt: new Date().toISOString() },
    });
    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'NEW' }} />);
    expect(await screen.findByText(/F&B call-first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('offers enrollment when there is no live cadence', async () => {
    api.getPartnerCadence.mockResolvedValue({ enrollment: null, openTask: null });
    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'NEW' }} />);
    expect(await screen.findByRole('button', { name: /start cadence/i })).toBeInTheDocument();
  });
});
