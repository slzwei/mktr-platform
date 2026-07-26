/**
 * Lead Profile (master-detail redesign) — drill-in lands with the outcome hero,
 * the profile view tells the person story (name-per-signup + variant flag,
 * compact status chips, day-grouped history), the two views are URL-addressable,
 * and the command bar's two-step assign wires to bulkAssign for the picked
 * signup. Plus the consumer-less (Retell) and erased states.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminV2LeadProfile from '../AdminV2LeadProfile';

vi.mock('@/api/adminV2', () => ({
  fetchProspectProfile: vi.fn(),
  fetchAgentOptions: vi.fn(async () => [{ id: 'agent-1', name: 'Marcus Wong' }]),
  bulkAssign: vi.fn(async () => ({ data: { affectedCount: 1 } })),
  bulkReturnToHeld: vi.fn(),
  bulkDelete: vi.fn(),
  fetchConsentCopy: vi.fn(async () => ({
    version: '2026-07-21-agree-all-v1',
    clauses: [{ kind: 'contact', label: 'Contact & marketing', format: 'text', copy: 'CONTACT CLAUSE COPY', channels: ['phone'], scope: 'brand' }],
  })),
}));

import { fetchProspectProfile, bulkAssign, bulkReturnToHeld, bulkDelete, fetchConsentCopy } from '@/api/adminV2';

const PROFILE = {
  id: 'p1',
  firstName: 'Shawn', lastName: 'Lee', phone: '+6591234567', email: 'shawn@x.com',
  leadStatus: 'new', quarantinedAt: null, quarantineReason: null,
  priority: null, score: null, leadSource: 'qr_code',
  createdAt: '2026-07-20T06:05:00Z',
  sourceMetadata: { utm: { utm_source: 'fb', utm_medium: 'cpc', utm_campaign: 'aug-tokyo' }, phoneVerifiedAt: '2026-07-20T06:06:00Z' },
  consentMetadata: { drawTerms: { termsVersionId: 'abcd1234-0000' } },
  demographics: { dateOfBirth: '1988-03-12' },
  campaign: { id: 'camp-1', name: 'Tokyo Getaway Lucky Draw', status: 'active' },
  assignedAgent: null, externalAgent: null, externalAgentId: null, qrTag: null,
  commissions: [],
  activities: [{ id: 'a1', type: 'created', description: 'Lead captured', createdAt: '2026-07-20T06:05:00Z' }],
  session: { startedAt: '2026-07-20T06:02:00Z', landingPath: '/c/tokyo', utm: {}, steps: [{ type: 'page_view', at: '2026-07-20T06:02:00Z', path: '/c/tokyo' }], visitCount: 1 },
  lyfeDelivery: [{ eventType: 'lead.created', status: 'success', attempts: 1, lastAttemptAt: '2026-07-20T06:06:00Z', responseCode: 200, reason: null, at: '2026-07-20T06:06:00Z' }],
  signupProfile: null,
  screeningVerdict: 'qualified',
  screeningMetadata: { verdictDetail: { reason: 'Agreed to meet a consultant', sentiment: 'Positive' }, attempts: {} },
  screeningAttemptCount: 2,
  consumer: {
    consumer: {
      id: 'con-1', phone: '+6591234567', firstName: 'Shawn', lastName: 'Lee',
      signupCount: 2, verifiedSignupCount: 2, firstSeenAt: '2026-05-01T08:40:00Z', erasedAt: null,
    },
    signups: [
      {
        prospectId: 'p1', firstName: 'Shawn', lastName: 'Lee',
        campaign: { id: 'camp-1', name: 'Tokyo Getaway Lucky Draw', status: 'active' },
        leadStatus: 'new', leadSource: 'qr_code', createdAt: '2026-07-20T06:05:00Z',
        held: false, verified: true, agentName: null, externalBuyer: false,
        draw: {
          drawId: 'd1', drawStatus: 'open', state: 'provisional_in', provisional: true,
          chances: 10, multiplier: 10, boosted: true, boostVia: 'agent_scan',
          boostedAt: '2026-07-21T01:12:00Z',
          closesAt: '2026-10-30T16:00:00Z', boostClosesAt: null, notEligibleReason: null,
          outcome: null, drawHistory: [],
        },
        consent: { contact: { granted: true, version: '2026-07-21-agree-all-v1', scope: 'global', occurredAt: '2026-07-21T02:00:00Z' } },
        assignments: [
          { at: '2026-07-20T06:07:00Z', kind: 'assigned', agentName: 'Lee Yi Heng', external: false },
          { at: '2026-07-21T03:00:00Z', kind: 'returned_to_held', agentName: 'Lee Yi Heng', external: false },
          { at: '2026-07-21T05:00:00Z', kind: 'unassigned', agentName: null, external: false },
        ],
        rewardDiagnostic: null,
      },
      {
        prospectId: 'p2', firstName: 'Shawn', lastName: 'Tan',
        campaign: { id: 'camp-2', name: 'NTUC Trial Reward', status: 'active' },
        leadStatus: 'won', leadSource: 'website', createdAt: '2026-05-01T08:40:00Z',
        held: false, verified: true, agentName: null, externalBuyer: true,
        draw: null, consent: { contact: { granted: false } }, rewardDiagnostic: null,
      },
    ],
    entitlements: [{
      id: 'ent-1', status: 'redeemed', state: 'redeemed',
      createdAt: '2026-05-01T09:00:00Z', unlockedAt: '2026-05-02T02:00:00Z', expiresAt: null,
      rewardTitle: '1-for-1 latte', campaignName: 'NTUC Trial Reward', campaignId: 'camp-2',
      redeemedAt: '2026-05-03T03:26:00Z', unlockedVia: 'agent_scan', tokenHint: '9876',
      drawLinked: false,
      delivery: { email: { ok: true, kind: 'voucher', at: '2026-05-02T02:00:00Z' }, whatsapp: null },
    }],
    drawEntries: 1,
    suppressions: [],
    broadcasts: { counts: { sent: 1 }, recent: [] },
  },
};

function Loc() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}{location.search}</div>;
}

function setup(initial = '/admin/leads/p1', fromState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const qIdx = initial.indexOf('?');
  const entry = fromState === undefined
    ? initial
    : {
      pathname: qIdx === -1 ? initial : initial.slice(0, qIdx),
      search: qIdx === -1 ? '' : initial.slice(qIdx),
      state: { from: fromState },
    };
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/leads/:prospectId" element={<><AdminV2LeadProfile /><Loc /></>} />
          <Route path="/AdminProspects" element={<><div>LIST</div><Loc /></>} />
          <Route path="/AdminPeople" element={<><div>PEOPLE LIST</div><Loc /></>} />
          <Route path="/admin/cohorts/:id" element={<><div>COHORT PAGE</div><Loc /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchProspectProfile.mockResolvedValue(JSON.parse(JSON.stringify(PROFILE)));
});

describe('AdminV2LeadProfile — drill-in (default landing)', () => {
  it('lands on the campaign drill-in with the outcome hero as the loudest fact', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Tokyo Getaway Lucky Draw' })).toBeInTheDocument();
    expect(fetchProspectProfile).toHaveBeenCalledWith('p1');
    expect(screen.getByText('On track for ×10')).toBeInTheDocument();
    expect(screen.getByText(/consultant scan recorded/)).toBeInTheDocument();
    expect(screen.getByText(/CLOSES 30 OCT/)).toBeInTheDocument();
    // Command bar identity + back-to-profile affordance.
    expect(screen.getByText('SHAWN LEE · +65 9123 4567')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Shawn Lee — profile/ })).toBeInTheDocument();
  });

  it('shows signup facts and Lyfe delivery in the detail card', async () => {
    setup();
    await screen.findByText('Signup detail');
    expect(screen.getByText(/QR code → \/c\/tokyo/)).toBeInTheDocument();
    expect(screen.getByText(/fb \/ cpc \/ aug-tokyo/)).toBeInTheDocument();
    expect(screen.getByText('unassigned')).toBeInTheDocument();
    expect(screen.getByText(/delivered/)).toBeInTheDocument();
    expect(screen.getByText('“Agreed to meet a consultant”')).toBeInTheDocument();
  });

  it('back button opens the person profile view (URL-addressable)', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Shawn Lee — profile/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p1?view=profile');
    expect(await screen.findByRole('heading', { name: 'Shawn Lee' })).toBeInTheDocument();
  });

  it('drill-in assign is one step and targets THIS lead', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign this lead ▾' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Marcus Wong/ }));
    await waitFor(() => expect(bulkAssign).toHaveBeenCalledWith(['p1'], 'agent-1'));
  });
});

describe('AdminV2LeadProfile — person profile view', () => {
  it('tells the person story: identity, per-signup names, compact status chips', async () => {
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByRole('heading', { name: 'Shawn Lee' })).toBeInTheDocument();
    expect(screen.getByText(/2 signups \(2 verified\)/)).toBeInTheDocument();
    // Name used per signup (mono meta line) + the variant flag.
    expect(screen.getByText(/AS SHAWN TAN/)).toBeInTheDocument();
    expect(screen.getByText('name variant')).toBeInTheDocument();
    // Compact outcome chips — no outcome machinery on rows; a boosted lead
    // carries its multiplier (the ×N is already earned).
    expect(screen.getByText(/×10 · closes 30 Oct/)).toBeInTheDocument();
    expect(screen.getByText('✓ redeemed')).toBeInTheDocument();
    expect(screen.queryByText('On track for ×10')).not.toBeInTheDocument();
    // Agent segment: unassigned is warn-voiced; external buyer named as such.
    expect(screen.getByText('AGENT: UNASSIGNED')).toBeInTheDocument();
    expect(screen.getByText('AGENT: EXTERNAL BUYER')).toBeInTheDocument();
  });

  it('campaign rows drill in by navigating to that signup URL', async () => {
    setup('/admin/leads/p1?view=profile');
    fireEvent.click(await screen.findByText('NTUC Trial Reward'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p2');
  });

  it('history is day-grouped, person-wide, with no scope filter', async () => {
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('History');
    expect(screen.getByText(/Signed up as Shawn Tan/)).toBeInTheDocument();
    expect(screen.getByText(/Voucher redeemed ✓/)).toBeInTheDocument();
    expect(screen.getByText('MON 20 JUL')).toBeInTheDocument(); // SGT day header
    expect(screen.queryByRole('button', { name: 'This signup' })).not.toBeInTheDocument();
  });

  it('profile assign is two-step: pick the campaign, then the agent', async () => {
    setup('/admin/leads/p1?view=profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Assign to agent ▾' }));
    expect(screen.getByText("Which campaign's lead?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /NTUC Trial Reward/ }));
    expect(screen.getByText(/Assign NTUC Trial Reward lead to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Marcus Wong/ }));
    await waitFor(() => expect(bulkAssign).toHaveBeenCalledWith(['p2'], 'agent-1'));
  });

  it('consent card reads the ledger with scope tags', async () => {
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Consent & reachability');
    expect(screen.getByText('· global')).toBeInTheDocument();
    expect(screen.getByText(/1 sent/)).toBeInTheDocument();
  });
});

describe('AdminV2LeadProfile — states', () => {
  it('consumer-less Retell lead: banner, single signup, voice-call card', async () => {
    fetchProspectProfile.mockResolvedValue({
      ...JSON.parse(JSON.stringify(PROFILE)),
      consumer: null,
      leadSource: 'call_bot',
      screeningVerdict: null, screeningMetadata: null, screeningAttemptCount: 0,
      sourceMetadata: { sentiment: 'Positive', fromNumber: '+6562773210', durationMs: 61000 },
      signupProfile: { draw: null, entitlements: [], rewardDiagnostic: 'no_active_activation' },
    });
    setup();
    await screen.findByText(/Retell voice lead/);
    expect(screen.getByText('No reward')).toBeInTheDocument();
    expect(screen.getByText('Voice call')).toBeInTheDocument();
    expect(screen.getByText('Positive')).toBeInTheDocument();
  });

  it('erased person: banner and the honest draw hero', async () => {
    const erased = JSON.parse(JSON.stringify(PROFILE));
    erased.consumer.consumer.erasedAt = '2026-07-12T02:00:00Z';
    erased.consumer.signups[0].draw = { state: 'erased_draw_unavailable' };
    fetchProspectProfile.mockResolvedValue(erased);
    setup();
    await screen.findByText(/This person was erased/);
    expect(screen.getByText('⊘ Draw record unavailable')).toBeInTheDocument();
    expect(screen.getByText('ERASED')).toBeInTheDocument();
  });

  it('erased person: Assign and Return are suppressed, Delete stays', async () => {
    const erased = JSON.parse(JSON.stringify(PROFILE));
    erased.consumer.consumer.erasedAt = '2026-07-12T02:00:00Z';
    fetchProspectProfile.mockResolvedValue(erased);
    setup();
    await screen.findByText(/This person was erased/);
    expect(screen.queryByRole('button', { name: 'Return to held' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('AdminV2LeadProfile — back-link origins (§3.4)', () => {
  it('honors a People origin: label and destination keep the list query', async () => {
    setup('/admin/leads/p1', '/AdminPeople?q=zep&sort=-signupCount');
    fireEvent.click(await screen.findByRole('link', { name: '← People' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminPeople?q=zep&sort=-signupCount');
  });

  it('honors a cohort-detail origin with the Cohort label', async () => {
    setup('/admin/leads/p1', '/admin/cohorts/123e4567-e89b-42d3-a456-426614174000');
    expect(await screen.findByRole('link', { name: '← Cohort' })).toBeInTheDocument();
  });

  it('rejects prefix confusion — /AdminPeople-nope falls back to Prospects', async () => {
    setup('/admin/leads/p1', '/AdminPeople-nope');
    expect(await screen.findByRole('link', { name: '← Prospects' })).toBeInTheDocument();
  });

  it('rejects dot segments via canonical equality — the raw query never survives', async () => {
    setup('/admin/leads/p1', '/AdminPeople/../AdminProspects?x=1');
    fireEvent.click(await screen.findByRole('link', { name: '← Prospects' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/AdminProspects');
    expect(screen.getByTestId('loc')).not.toHaveTextContent('x=1');
  });
});

describe('AdminV2LeadProfile — person-origin mutations pick their signup (§3.5)', () => {
  it('profile-view Return is two-step: pick the campaign, then mutate THAT lead', async () => {
    bulkReturnToHeld.mockResolvedValue({ data: { returned: 1 } });
    setup('/admin/leads/p1?view=profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Return to held' }));
    expect(screen.getByText("Which campaign's lead?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /NTUC Trial Reward/ }));
    await waitFor(() => expect(bulkReturnToHeld).toHaveBeenCalledWith(['p2']));
  });

  it('profile-view Delete picks its signup, names it in the confirm, and stays on the page', async () => {
    bulkDelete.mockResolvedValue({ data: { deleted: 1 } });
    setup('/admin/leads/p1?view=profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /NTUC Trial Reward/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/NTUC Trial Reward/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bulkDelete).toHaveBeenCalledWith(['p2']));
    // Deleting a SIBLING signup keeps the operator on the person's page.
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/leads/p1?view=profile');
  });

  it('drill-in Return stays one step on the URL anchor', async () => {
    bulkReturnToHeld.mockResolvedValue({ data: { returned: 1 } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Return to held' }));
    expect(screen.queryByText("Which campaign's lead?")).not.toBeInTheDocument();
    await waitFor(() => expect(bulkReturnToHeld).toHaveBeenCalledWith(['p1']));
  });
});

describe('AdminV2LeadProfile — assignments + consent copy', () => {
  it('History names assignments, return-to-held and unassignment', async () => {
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByText('Assigned to Lee Yi Heng')).toBeInTheDocument();
    expect(screen.getByText('Returned to held')).toBeInTheDocument();
    expect(screen.getByText(/taken back from Lee Yi Heng/)).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('clicking a consent version opens the wording in a themed modal', async () => {
    setup('/admin/leads/p1?view=profile');
    // Open the disclosure, then click the version row.
    fireEvent.click(await screen.findByText(/Raw consent versions/));
    fireEvent.click(await screen.findByRole('button', { name: '2026-07-21-agree-all-v1' }));
    expect(fetchConsentCopy).toHaveBeenCalledWith('2026-07-21-agree-all-v1');
    expect(await screen.findByText('CONTACT CLAUSE COPY')).toBeInTheDocument();
    expect(screen.getByText(/Contact & marketing/)).toBeInTheDocument();
    // Backdrop close.
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByText('CONTACT CLAUSE COPY')).toBeNull();
  });
});

describe('AdminV2LeadProfile — delivery truth (wa-delivery-truth)', () => {
  it('renders unambiguous text states with hover explanations', async () => {
    const profile = JSON.parse(JSON.stringify(PROFILE));
    profile.consumer.entitlements[0].delivery = {
      email: { ok: true, kind: 'boost_receipt', at: '2026-05-02T02:00:00Z', delivery: null },
      whatsapp: {
        ok: true, kind: 'boost_receipt', at: '2026-05-02T02:00:05Z',
        delivery: { status: 'failed', errorCode: '131049', errorTitle: 'This message was not delivered to maintain healthy ecosystem engagement.', at: '2026-05-02T02:00:09Z' },
      },
    };
    fetchProspectProfile.mockResolvedValue(profile);
    setup('/admin/leads/p1?view=profile');
    // The state word is a dotted-underline hover target; hovering opens the
    // THEMED tooltip (role=tooltip), not a native title box.
    const failedState = await screen.findByText('not delivered (Meta marketing limit)');
    fireEvent.mouseEnter(failedState.parentElement);
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/marketing message limit/);
    fireEvent.mouseLeave(failedState.parentElement);
    // Email has no provider verdict → explicit "accepted", never a delivered claim.
    expect(screen.getByText(/boost receipt emailed —/)).toBeInTheDocument();
    const accepted = screen.getAllByText('accepted')[0];
    fireEvent.mouseEnter(accepted.parentElement);
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/Delivery is not confirmed/);
    fireEvent.mouseLeave(accepted.parentElement);
    // Campaign attribution is a colored dot whose hover/label is the FULL
    // campaign name (replaced the ambiguous first-word tag).
    expect(screen.getAllByLabelText('NTUC Trial Reward').length).toBeGreaterThan(0);
    expect(screen.queryByText(/NTUC ·/)).toBeNull();

    const delivered = JSON.parse(JSON.stringify(PROFILE));
    delivered.consumer.entitlements[0].delivery = {
      email: null,
      whatsapp: {
        ok: true, kind: 'pass', at: '2026-05-02T02:00:05Z',
        delivery: { status: 'delivered', errorCode: null, errorTitle: null, at: '2026-05-02T02:00:09Z' },
      },
    };
    fetchProspectProfile.mockResolvedValue(delivered);
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByText(/pass WhatsApp —/)).toBeInTheDocument();
    expect(screen.getAllByText('delivered').length).toBeGreaterThan(0);
  });
});
