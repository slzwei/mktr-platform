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
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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
  createCadence: vi.fn(),
  createCadenceVersion: vi.fn(),
  retireCadence: vi.fn(),
  suggestCadence: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
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
import { toBuilderSteps } from '../cadenceBuilder';
import CadenceEditorPage from '@/pages/redeemops/CadenceEditorPage';

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
  // The editor fetches the list in NEW mode too (it carries aiEnabled).
  api.listCadences.mockResolvedValue({ cadences: [], aiEnabled: false });
  api.listTasks.mockResolvedValue({ tasks: [] });
  api.updateTask.mockResolvedValue({});
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

describe('toBuilderSteps (edit prefill)', () => {
  it('reverse-maps edges into the linear builder dialect', () => {
    const cadence = {
      steps: [
        { id: 's1', stepOrder: 1, channel: 'call', title: 'Intro call', scriptTemplate: 'hi', priority: 'high' },
        { id: 's2', stepOrder: 2, channel: 'whatsapp', title: 'WA intro', scriptTemplate: null, priority: 'medium' },
      ],
      transitions: [
        { fromStepId: null, disposition: '*', toStepId: 's1', delayDays: 0, timeWindow: 'any' },
        { fromStepId: 's1', disposition: 'no_answer', toStepId: 's2', delayDays: 2, timeWindow: 'off_peak' },
      ],
    };
    const steps = toBuilderSteps(cadence);
    expect(steps).toEqual([
      { channel: 'call', title: 'Intro call', script: 'hi', priority: 'high', delayDays: 0, timeWindow: 'any', continueOn: 'no_answer' },
      { channel: 'whatsapp', title: 'WA intro', script: '', priority: 'medium', delayDays: 2, timeWindow: 'off_peak', continueOn: '*' },
    ]);
  });
});

describe('CadenceEditorPage (full-page builder)', () => {
  function renderNew() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/redeem-ops/cadences/new']}>
          <Routes>
            <Route path="/redeem-ops/cadences/new" element={<CadenceEditorPage />} />
            <Route path="/redeem-ops/settings" element={<p>settings page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('creates & publishes a cadence from the mapped builder state', async () => {
    api.createCadence.mockResolvedValue({ id: 'c-new', version: 1, publishedAt: new Date().toISOString() });
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByPlaceholderText(/beauty salons/i), 'Fitness studios chase');
    await user.type(screen.getByPlaceholderText(/what the rep sees/i), 'Intro call');
    await user.click(screen.getByRole('button', { name: /add step/i }));
    const titles = screen.getAllByPlaceholderText(/what the rep sees/i);
    await user.type(titles[1], 'WhatsApp follow-up');

    await user.click(screen.getByRole('button', { name: /create & publish/i }));
    await waitFor(() => expect(api.createCadence).toHaveBeenCalledTimes(1));
    const payload = api.createCadence.mock.calls[0][0];
    expect(payload.name).toBe('Fitness studios chase');
    expect(payload.publish).toBe(true);
    expect(payload.steps).toHaveLength(2);
    expect(payload.steps[0]).toMatchObject({ channel: 'call', title: 'Intro call', continueOn: 'no_answer' });
    expect(payload.steps[1]).toMatchObject({ channel: 'whatsapp', title: 'WhatsApp follow-up' });
  });

  it('"Save as draft" sends publish:false and says who can see it', async () => {
    api.createCadence.mockResolvedValue({ id: 'c-draft', version: 1, publishedAt: null });
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByPlaceholderText(/beauty salons/i), 'My private chase');
    await user.type(screen.getByPlaceholderText(/what the rep sees/i), 'Intro call');
    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    await waitFor(() => expect(api.createCadence).toHaveBeenCalledTimes(1));
    expect(api.createCadence.mock.calls[0][0].publish).toBe(false);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringMatching(/only you and admins/i)
    ));
  });

  it('refuses to save without a name', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole('button', { name: /create & publish/i }));
    expect(api.createCadence).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('hides the AI card unless the backend reports aiEnabled', async () => {
    renderNew();
    await screen.findByPlaceholderText(/beauty salons/i); // page settled
    expect(screen.queryByText('Draft with AI')).not.toBeInTheDocument();
  });

  it('AI draft populates the builder and never creates by itself', async () => {
    api.listCadences.mockResolvedValue({ cadences: [], aiEnabled: true });
    api.suggestCadence.mockResolvedValue({
      name: 'Café chase',
      description: 'New cafés, gentle tone',
      steps: [
        { channel: 'call', title: 'Intro call', script: 'Hi {{contact_name}}', priority: 'medium', delayDays: 0, timeWindow: 'morning', continueOn: 'no_answer' },
        { channel: 'whatsapp', title: 'WA follow-up', script: '', priority: 'medium', delayDays: 2, timeWindow: 'any', continueOn: '*' },
      ],
    });
    const user = userEvent.setup();
    renderNew();

    await user.type(await screen.findByPlaceholderText(/call-first chase/i), '5-step chase for new cafés');
    await user.click(screen.getByRole('button', { name: /generate draft/i }));

    await waitFor(() => expect(api.suggestCadence).toHaveBeenCalledWith({
      prompt: '5-step chase for new cafés',
    }));
    expect(screen.getByPlaceholderText(/beauty salons/i)).toHaveValue('Café chase');
    expect(screen.getByDisplayValue('Intro call')).toBeInTheDocument();
    expect(screen.getByDisplayValue('WA follow-up')).toBeInTheDocument();
    expect(api.createCadence).not.toHaveBeenCalled();
  });

  it('a dirty builder asks before replacing — cancel keeps everything', async () => {
    api.listCadences.mockResolvedValue({ cadences: [], aiEnabled: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderNew();

    await user.type(await screen.findByPlaceholderText(/beauty salons/i), 'Hand-built name');
    await user.type(screen.getByPlaceholderText(/call-first chase/i), 'replace everything please');
    await user.click(screen.getByRole('button', { name: /generate draft/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.suggestCadence).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/beauty salons/i)).toHaveValue('Hand-built name');
    confirmSpy.mockRestore();
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

/* ── The Cadence & Tasks rail section (Business Detail design) ── */

const activeEnrollment = {
  id: 'e-1', state: 'active',
  cadence: { id: 'c-1', name: 'F&B call-first', version: 1, steps: [
    { id: 's-1', stepOrder: 1, title: 'Intro call' },
    { id: 's-2', stepOrder: 2, title: 'WhatsApp intro' },
  ] },
  currentStep: { id: 's-2', stepOrder: 2 },
};

function isoDaysFromToday(days) {
  const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() + days);
  return d.toISOString();
}

const cadenceRowTask = {
  id: 'task-c', title: 'WhatsApp intro', partnerOrganisationId: 'p-1', status: 'open',
  dueAt: isoDaysFromToday(0), snapshotRecipient: '+6581234567',
  cadenceStep: { id: 's-2', stepOrder: 2, channel: 'whatsapp', title: 'WhatsApp intro', cadence: { id: 'c-1', name: 'F&B call-first', version: 1 } },
};
const overdueManualTask = {
  id: 'task-m1', title: 'Prepare partnership one-pager', partnerOrganisationId: 'p-1',
  status: 'open', dueAt: isoDaysFromToday(-1), cadenceStep: null,
};
const laterManualTask = {
  id: 'task-m2', title: 'Call Sarah re: trial-class slots', partnerOrganisationId: 'p-1',
  status: 'open', dueAt: isoDaysFromToday(3), cadenceStep: null,
};

describe('CadencePanel — outstanding tasks zone', () => {
  it('lists the cadence task first (Outcome) and manual tasks with one-click complete', async () => {
    api.getPartnerCadence.mockResolvedValue({ enrollment: activeEnrollment, openTask: cadenceRowTask });
    api.listTasks.mockResolvedValue({ tasks: [overdueManualTask, cadenceRowTask, laterManualTask] });
    const user = userEvent.setup();
    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'MEETING' }} />);

    // header count + overdue tally
    expect(await screen.findByText('· 3')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();

    // the cadence task is actionable via Outcome, never a checkbox
    expect(screen.getByRole('button', { name: /outcome/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /complete whatsapp intro/i })).not.toBeInTheDocument();

    // manual tasks complete through the generic PATCH
    await user.click(screen.getByRole('button', { name: /complete prepare partnership one-pager/i }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('task-m1', { status: 'completed' }));
  });

  it('shows the template message inline with a working Copy message', async () => {
    const script = 'Hi! Keen to feature Coding Lab on Redeem?';
    api.getPartnerCadence.mockResolvedValue({ enrollment: activeEnrollment, openTask: null });
    api.listTasks.mockResolvedValue({ tasks: [{ ...cadenceRowTask, description: script }] });
    const user = userEvent.setup();
    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'MEETING' }} />);

    expect(await screen.findByText(script)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /copy message/i }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(script);
    });
  });

  it('a paused enrollment freezes the cadence task row', async () => {
    api.getPartnerCadence.mockResolvedValue({
      enrollment: { ...activeEnrollment, state: 'paused' },
      openTask: cadenceRowTask,
    });
    api.listTasks.mockResolvedValue({ tasks: [cadenceRowTask] });
    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'MEETING' }} />);
    expect(await screen.findByText(/no tasks will be scheduled until resumed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /outcome/i })).toBeDisabled();
  });

  it('truncates past four rows into "View all n" linking to the filtered Tasks page', async () => {
    api.getPartnerCadence.mockResolvedValue({ enrollment: null, openTask: null });
    api.listTasks.mockResolvedValue({
      tasks: [1, 2, 3, 4, 5, 6].map((n) => ({
        id: `t-${n}`, title: `Manual task ${n}`, partnerOrganisationId: 'p-1',
        status: 'open', dueAt: isoDaysFromToday(n), cadenceStep: null,
      })),
    });
    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'NEW' }} />);
    const viewAll = await screen.findByRole('link', { name: /view all 6/i });
    expect(viewAll).toHaveAttribute('href', '/redeem-ops/tasks?partnerId=p-1');
    expect(screen.getByText('Manual task 4')).toBeInTheDocument();
    expect(screen.queryByText('Manual task 5')).not.toBeInTheDocument();
  });

  it('the ghost add opens the page dialog; terminal stages hide it', async () => {
    api.getPartnerCadence.mockResolvedValue({ enrollment: null, openTask: null });
    const onAddTask = vi.fn();
    const user = userEvent.setup();
    const { unmount } = wrap(
      <CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'NEW' }} onAddTask={onAddTask} />
    );
    await user.click(await screen.findByRole('button', { name: /add task/i }));
    expect(onAddTask).toHaveBeenCalledTimes(1);
    unmount();

    wrap(<CadencePanel partner={{ id: 'p-1', ownerUserId: 'u-1', pipelineStage: 'LOST' }} onAddTask={onAddTask} />);
    await screen.findByText(/no open tasks/i);
    expect(screen.queryByRole('button', { name: /add task/i })).not.toBeInTheDocument();
  });
});
