/**
 * Email Push detail (tracker "emailpush") — status-driven actions (Send/Test
 * on drafts, Cancel while active, Resume when interrupted), the send-confirm
 * flow with the live reachable estimate + campaign-scope reminder, and the
 * send log with reason chips. API layer mocked.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2BroadcastDetail from '../AdminV2BroadcastDetail';

const definition = {
  filters: { campaignIds: ['c1'], drawIds: [], anyDraw: false, campaignTags: [], attributes: { postalPrefixes: [], incomes: [], educations: [], genders: [] } },
  ageGate: { minAge: 18, maxAge: null },
  marketingContext: { campaignId: null },
};

const draft = {
  id: 'eb1',
  cohortId: 'co1',
  campaignId: 'c1',
  subject: 'Tokyo push',
  bodyText: 'Come join.',
  ctaLabel: 'Enter',
  ctaUrl: null,
  ctaUrlPreview: 'https://redeem.sg/LeadCapture?campaign_id=c1&utm_source=mktr&utm_medium=email&utm_campaign=broadcast-eb1',
  status: 'draft',
  totalRecipients: 0,
  sentCount: 0,
  skippedCount: 0,
  failedCount: 0,
  lastError: null,
  createdAt: new Date().toISOString(),
  cohort: { id: 'co1', name: 'Tokyo entrants', definition },
  campaign: { id: 'c1', name: 'Tokyo Getaway Lucky Draw', status: 'active', is_active: true },
  liveCounts: { pending: 0, attempting: 0, sent: 0, skipped: 0, failed: 0 },
};

vi.mock('@/api/adminV2', () => ({
  fetchEmailBroadcast: vi.fn(async () => null),
  fetchEmailBroadcastRecipients: vi.fn(async () => ({ total: 0, limit: 50, offset: 0, recipients: [] })),
  sendEmailBroadcast: vi.fn(async () => ({ data: { id: 'eb1', status: 'sending' } })),
  cancelEmailBroadcast: vi.fn(async () => ({ data: { id: 'eb1', status: 'cancelling' } })),
  deleteEmailBroadcast: vi.fn(async () => ({ data: { id: 'eb1', deleted: true } })),
  testEmailBroadcast: vi.fn(async () => ({ data: { sentTo: 'admin@mktr.sg' } })),
  previewCohortDefinition: vi.fn(async () => ({
    total: 200, reachable: 150, excluded: 50,
    byReason: {}, gate: { channel: 'email', campaignId: 'c1', minAge: 18, maxAge: null },
  })),
  fetchCohorts: vi.fn(async () => ({ rows: [], total: 0 })),
  fetchCohortFacets: vi.fn(async () => ({ attributes: {}, campaignTags: [], campaigns: [], draws: [] })),
  createEmailBroadcast: vi.fn(),
  updateEmailBroadcast: vi.fn(),
}));

import {
  fetchEmailBroadcast, fetchEmailBroadcastRecipients, sendEmailBroadcast,
  cancelEmailBroadcast, previewCohortDefinition,
} from '@/api/adminV2';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/broadcasts/eb1']}>
        <Routes>
          <Route path="/admin/broadcasts/:id" element={<AdminV2BroadcastDetail />} />
          <Route path="/AdminBroadcasts" element={<div>list page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminV2BroadcastDetail', () => {
  it('drafts offer Send / Test / Edit / Delete and show the CTA preview', async () => {
    fetchEmailBroadcast.mockResolvedValue(draft);
    setup();
    expect(await screen.findByText('Tokyo push')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send test to my email' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByText(/utm_campaign=broadcast-eb1/)).toBeTruthy();
    expect(fetchEmailBroadcastRecipients).not.toHaveBeenCalled();
  });

  it('send confirm shows the live estimate under the push campaign scope, then kicks the send', async () => {
    fetchEmailBroadcast.mockResolvedValue(draft);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Send…' }));

    await waitFor(() => expect(previewCohortDefinition).toHaveBeenCalled());
    // The estimate re-aims the cohort definition at THIS campaign ('email' channel).
    const [defArg, channelArg] = previewCohortDefinition.mock.calls[0];
    expect(defArg.marketingContext.campaignId).toBe('c1');
    expect(channelArg).toBe('email');

    expect(await screen.findByText(/are reachable under this campaign/)).toBeTruthy();
    expect(screen.getByText(/must be ABOUT/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(sendEmailBroadcast).toHaveBeenCalledWith('eb1', { resume: false }));
  });

  it('an active send shows live tiles and Cancel', async () => {
    fetchEmailBroadcast.mockResolvedValue({
      ...draft,
      status: 'sending',
      totalRecipients: 120,
      liveCounts: { pending: 40, attempting: 1, sent: 70, skipped: 8, failed: 1 },
    });
    setup();
    expect(await screen.findByRole('button', { name: 'Cancel send' })).toBeTruthy();
    expect(screen.getByText('70')).toBeTruthy();
    expect(screen.getByText('41')).toBeTruthy(); // remaining = pending + attempting
    fireEvent.click(screen.getByRole('button', { name: 'Cancel send' }));
    await waitFor(() => expect(cancelEmailBroadcast).toHaveBeenCalledWith('eb1'));
  });

  it('interrupted sends offer Resume (pending rows only) and Cancel remaining', async () => {
    fetchEmailBroadcast.mockResolvedValue({ ...draft, status: 'interrupted', totalRecipients: 120, lastError: 'worker lost (deploy/crash) — resume to continue' });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(sendEmailBroadcast).toHaveBeenCalledWith('eb1', { resume: true }));
    expect(screen.getByRole('button', { name: 'Cancel remaining' })).toBeTruthy();
    expect(screen.getByText(/worker lost/)).toBeTruthy();
  });

  it('renders the send log with sender-side reason language', async () => {
    fetchEmailBroadcast.mockResolvedValue({ ...draft, status: 'completed', totalRecipients: 3, sentCount: 1, skippedCount: 2, failedCount: 0, liveCounts: { pending: 0, attempting: 0, sent: 1, skipped: 2, failed: 0 } });
    fetchEmailBroadcastRecipients.mockResolvedValue({
      total: 3, limit: 50, offset: 0,
      recipients: [
        { id: 'r1', consumerId: 'x1', email: 'a@x.test', status: 'sent', reason: null, error: null, sentAt: new Date().toISOString() },
        { id: 'r2', consumerId: 'x2', email: 'b@x.test', status: 'skipped', reason: 'address_suppressed', error: null, sentAt: null },
        { id: 'r3', consumerId: 'x3', email: 'c@x.test', status: 'skipped', reason: 'not_consented', error: null, sentAt: null },
      ],
    });
    setup();
    expect(await screen.findByText('a@x.test')).toBeTruthy();
    expect(screen.getByText('Address unsubscribed')).toBeTruthy(); // sender-side vocab
    expect(screen.getByText('No consent')).toBeTruthy(); // cohort vocab reused
    fireEvent.click(screen.getByRole('button', { name: 'skipped' }));
    await waitFor(() => expect(fetchEmailBroadcastRecipients).toHaveBeenLastCalledWith('eb1', { status: 'skipped', limit: 50, offset: 0 }));
  });
});
