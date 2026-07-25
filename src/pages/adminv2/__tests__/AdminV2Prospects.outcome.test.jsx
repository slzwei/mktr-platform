/**
 * Prospects list STATUS column — the campaign-outcome precedence: held alarm →
 * outcome chip in the campaign's voice → pipeline status only when ≠ new →
 * screening; silence (muted dash) instead of a "New" wall. Plus the
 * ?include=outcome request contract and the campaign-type glyph.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2Prospects from '../AdminV2Prospects';

vi.mock('@/api/adminV2', () => ({
  fetchProspects: vi.fn(async () => ({
    rows: [
      { // draw lead, boosted — outcome chip carries the ×10; "New" suppressed
        id: 'p1', firstName: 'Shawn', lastName: 'Lee', phone: '+6580129432', email: 's@x.com',
        leadStatus: 'new', quarantinedAt: null, campaign: { name: 'iPhone 17 Pro Lucky Draw' },
        assignedAgent: null, createdAt: '2026-07-25T08:00:00Z', screeningVerdict: 'qualified',
        draw: { state: 'provisional_in', boosted: true, multiplier: 10, closesAt: '2026-09-30T16:00:00Z' },
        reward: null,
      },
      { // reward lead, redeemed
        id: 'p2', firstName: 'Sam', lastName: 'Tan', phone: '+6589279750', email: 'sam@x.com',
        leadStatus: 'new', quarantinedAt: null, campaign: { name: 'Redeem $10 Fairprice Voucher' },
        assignedAgent: null, createdAt: '2026-07-01T08:00:00Z',
        draw: null, reward: { state: 'redeemed', rewardTitle: '$10 voucher' },
      },
      { // pipeline exception — Lyfe flipped it to won; no outcome data
        id: 'p3', firstName: 'Mei', lastName: 'Lim', phone: '+6581112222', email: 'mei@x.com',
        leadStatus: 'won', quarantinedAt: null, campaign: { name: 'Free Pet Hotel 1 Night Trial' },
        assignedAgent: null, createdAt: '2026-06-01T08:00:00Z',
        draw: null, reward: null,
      },
      { // nothing yet — silence, not "New"
        id: 'p4', firstName: 'Jo', lastName: 'Ng', phone: '+6583334444', email: 'jo@x.com',
        leadStatus: 'new', quarantinedAt: null, campaign: { name: 'Free Pet Hotel 1 Night Trial' },
        assignedAgent: null, createdAt: '2026-06-02T08:00:00Z',
        draw: null, reward: null,
      },
      { // held — the alarm still overrides everything
        id: 'p5', firstName: 'Ken', lastName: 'Ong', phone: '+6585556666', email: 'ken@x.com',
        leadStatus: 'new', quarantinedAt: '2026-07-20T08:00:00Z', quarantineReason: 'dnc_registered',
        campaign: { name: 'Redeem $10 Fairprice Voucher' },
        assignedAgent: null, createdAt: '2026-06-03T08:00:00Z',
        draw: null, reward: { state: 'reserved' },
      },
    ],
    total: 5, page: 1, totalPages: 1,
  })),
  fetchAgentOptions: vi.fn(async () => []),
  bulkAssign: vi.fn(),
  bulkReturnToHeld: vi.fn(),
  bulkDelete: vi.fn(),
}));

import { fetchProspects } from '@/api/adminV2';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/AdminProspects']}>
        <Routes>
          <Route path="/AdminProspects" element={<AdminV2Prospects />} />
          <Route path="/admin/leads/:prospectId" element={<div>PROFILE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminV2Prospects outcome column', () => {
  it('requests the outcome enrichment', async () => {
    setup();
    await screen.findByText('Shawn Lee');
    expect(fetchProspects).toHaveBeenCalledWith(expect.objectContaining({ include: 'outcome' }));
  });

  it('speaks each campaign voice and silences the "New" wall', async () => {
    setup();
    await screen.findByText('Shawn Lee');
    // Draw lead: multiplier chip + screening secondary.
    expect(screen.getByText('×10 · closes 30 Sept')).toBeInTheDocument();
    expect(screen.getByText('AI qualified')).toBeInTheDocument();
    // Reward lead: redeemed voice.
    expect(screen.getByText('✓ redeemed')).toBeInTheDocument();
    // Pipeline exception still shows (won ≠ new)…
    expect(screen.getByText('✓ Won')).toBeInTheDocument();
    // …but the default resting state is silence, never a chip.
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(screen.getByLabelText('No outcome yet')).toBeInTheDocument();
  });

  it('held still overrides the outcome', async () => {
    setup();
    await screen.findByText('Ken Ong');
    // p5 is held with a reserved reward — the alarm wins, the voice waits.
    expect(screen.queryByText('reserved')).not.toBeInTheDocument();
    expect(screen.getAllByText(/DNC|Held|◆/i).length).toBeGreaterThan(0);
  });

  it('status column no longer offers a sort control', async () => {
    setup();
    await screen.findByText('Shawn Lee');
    // The filter dropdown ("Status ▾") stays; the exact-named sort button is gone.
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Status.*▾/ })).toBeInTheDocument();
  });
});
