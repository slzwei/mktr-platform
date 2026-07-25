/**
 * Lead Profile page — person-first rail (name-per-signup + variant flag),
 * draw voice vs reward voice per campaign, re-anchor navigation, the
 * consumer-less (B4) fallback, the erased banner, and history scope.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2LeadProfile from '../AdminV2LeadProfile';

vi.mock('@/api/adminV2', () => ({
  fetchProspectProfile: vi.fn(),
  fetchAgentOptions: vi.fn(async () => []),
  bulkAssign: vi.fn(),
  bulkReturnToHeld: vi.fn(),
  bulkDelete: vi.fn(),
}));

import { fetchProspectProfile } from '@/api/adminV2';

const PROFILE = {
  id: 'p1',
  firstName: 'Shawn', lastName: 'Lee', phone: '+6591234567', email: 's@x.com',
  leadStatus: 'new', quarantinedAt: null, quarantineReason: null,
  priority: null, score: null, leadSource: 'qr_code',
  createdAt: '2026-07-20T02:00:00Z',
  sourceMetadata: { utm: { utm_source: 'fb' }, phoneVerifiedAt: '2026-07-20T02:00:00Z' },
  consentMetadata: {},
  campaign: { id: 'camp-1', name: 'Tokyo Lucky Draw', status: 'active' },
  assignedAgent: null, externalAgent: null, externalAgentId: null, qrTag: null,
  commissions: [],
  activities: [{ id: 'a1', type: 'created', description: 'Lead captured', createdAt: '2026-07-20T02:00:00Z' }],
  session: null, lyfeDelivery: null, signupProfile: null,
  consumer: {
    consumer: {
      id: 'con-1', phone: '+6591234567', firstName: 'Shawn', lastName: 'Lee',
      signupCount: 2, verifiedSignupCount: 2, firstSeenAt: '2026-05-01T02:00:00Z', erasedAt: null,
    },
    signups: [
      {
        prospectId: 'p1', firstName: 'Shawn', lastName: 'Lee',
        campaign: { id: 'camp-1', name: 'Tokyo Lucky Draw', status: 'active' },
        leadStatus: 'new', leadSource: 'qr_code', createdAt: '2026-07-20T02:00:00Z',
        held: false, verified: true,
        draw: {
          drawId: 'd1', drawStatus: 'open', state: 'provisional_in', provisional: true,
          chances: 10, multiplier: 10, boosted: true, boostVia: 'agent_scan',
          boostedAt: '2026-07-21T02:00:00Z', boostReviewPending: false,
          closesAt: '2026-10-30T16:00:00Z', boostClosesAt: null, notEligibleReason: null,
          outcome: null, drawHistory: [],
        },
        consent: { contact: { granted: true, version: '2026-07-21-agree-all-v1', scope: 'campaign' } },
        rewardDiagnostic: null,
      },
      {
        prospectId: 'p2', firstName: 'Shawn', lastName: 'Tan',
        campaign: { id: 'camp-2', name: 'NTUC Trial', status: 'active' },
        leadStatus: 'won', leadSource: 'website', createdAt: '2026-05-01T02:00:00Z',
        held: false, verified: true, draw: null,
        consent: { contact: { granted: false } }, rewardDiagnostic: null,
      },
    ],
    entitlements: [{
      id: 'ent-1', status: 'redeemed', state: 'redeemed',
      createdAt: '2026-05-01T03:00:00Z', unlockedAt: '2026-05-02T03:00:00Z', expiresAt: null,
      rewardTitle: '1-for-1 latte', campaignName: 'NTUC Trial', campaignId: 'camp-2',
      redeemedAt: '2026-05-03T03:00:00Z', unlockedVia: 'agent_scan', tokenHint: '9876',
      drawLinked: false,
      delivery: { email: { ok: true, kind: 'voucher', at: '2026-05-02T03:05:00Z' }, whatsapp: null },
    }],
    drawEntries: 1,
    suppressions: [],
    broadcasts: {
      counts: { sent: 1 },
      recent: [{ broadcastId: 'b1', subject: 'Promo', status: 'sent', reason: null, sentAt: '2026-06-01T02:00:00Z', at: '2026-06-01T02:00:00Z' }],
    },
  },
};

function Loc() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

function setup(id = 'p1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/leads/${id}`]}>
        <Routes>
          <Route path="/admin/leads/:prospectId" element={<><AdminV2LeadProfile /><Loc /></>} />
          <Route path="/AdminProspects" element={<div>LIST</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProspectProfile.mockResolvedValue(JSON.parse(JSON.stringify(PROFILE)));
});

describe('AdminV2LeadProfile', () => {
  it('renders the person header and asks for the profile enrichment', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Shawn Lee' })).toBeInTheDocument();
    expect(fetchProspectProfile).toHaveBeenCalledWith('p1');
    expect(screen.getByText(/2 SIGNUPS \(2 VERIFIED\)/)).toBeInTheDocument();
  });

  it('tells each campaign story: name used, draw voice, reward voice', async () => {
    setup();
    await screen.findAllByText('Tokyo Lucky Draw');
    // Name-per-signup with the variant flagged (Shawn Tan ≠ canonical Shawn Lee).
    expect(screen.getByText('Shawn Tan')).toBeInTheDocument();
    expect(screen.getByText('name variant')).toBeInTheDocument();
    // Draw voice — provisional, never asserted.
    expect(screen.getByText(/On track for ×10 — consultant scan recorded/)).toBeInTheDocument();
    // Reward voice on the other campaign + delivery receipt microline
    // (history rows repeat the reward name, so match all).
    expect(screen.getAllByText(/Redeemed ✓/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1-for-1 latte/).length).toBeGreaterThan(0);
    expect(screen.getByText(/pass emailed ✓/)).toBeInTheDocument();
  });

  it('re-anchors to another signup by navigating to its URL', async () => {
    setup();
    const cards = await screen.findAllByText('NTUC Trial');
    fireEvent.click(cards[0]); // the rail card (history captions repeat the name)
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p2');
  });

  it('shows the ledger-backed consent and marketing touches', async () => {
    setup();
    await screen.findByText('Consent & reachability');
    expect(screen.getByText(/yes · 2026-07-21-agree-all-v1/)).toBeInTheDocument();
    expect(screen.getByText('1 sent')).toBeInTheDocument();
  });

  it('falls back to the signup profile for consumer-less (Retell) leads', async () => {
    fetchProspectProfile.mockResolvedValue({
      ...JSON.parse(JSON.stringify(PROFILE)),
      consumer: null,
      leadSource: 'call_bot',
      sourceMetadata: { sentiment: 'Positive', fromNumber: '+6562773210', durationMs: 61000 },
      signupProfile: { draw: null, entitlements: [], rewardDiagnostic: 'no_active_activation' },
    });
    setup();
    await screen.findByText(/Retell voice lead/);
    expect(screen.getByText('No reward attached to this campaign')).toBeInTheDocument();
    expect(screen.getByText('Voice call')).toBeInTheDocument();
    expect(screen.getByText('Positive')).toBeInTheDocument();
  });

  it('flags erased people and drops their draw claims', async () => {
    const erased = JSON.parse(JSON.stringify(PROFILE));
    erased.consumer.consumer.erasedAt = '2026-07-01T02:00:00Z';
    erased.consumer.signups[0].draw = { state: 'erased_draw_unavailable' };
    fetchProspectProfile.mockResolvedValue(erased);
    setup();
    await screen.findByText(/This person was erased/);
    expect(screen.getByText(/Draw record unavailable \(erased\)/)).toBeInTheDocument();
  });

  it('filters history by scope', async () => {
    setup();
    await screen.findByText('History');
    // Person-scope events include the second signup.
    expect(screen.getByText(/Signed up as Shawn Tan/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This signup' }));
    expect(screen.queryByText(/Signed up as Shawn Tan/)).not.toBeInTheDocument();
    expect(screen.getByText('Lead captured')).toBeInTheDocument();
  });
});
