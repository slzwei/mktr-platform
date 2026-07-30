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
      claimViews: { firstAt: '2026-05-02T03:00:00Z', count: 7 },
      events: [
        { at: '2026-05-03T03:20:00Z', type: 'verify_attempt' },
        { at: '2026-05-03T05:00:00Z', type: 'manual_override', action: 'resend_voucher', channel: 'whatsapp', actorName: 'Ops Staff' },
        { at: '2026-05-04T05:00:00Z', type: 'manual_override', action: 'cancelled', reason: 'duplicate signup', actorName: 'Ops Staff' },
      ],
    }],
    drawEntries: 1,
    suppressions: [],
    broadcasts: { counts: { sent: 1 }, recent: [] },
    consentTimeline: [
      { at: '2026-07-22T04:00:00Z', granted: false, source: 'unsubscribe', via: 'wa_stop', campaignId: null },
      { at: '2026-07-23T04:00:00Z', granted: true, source: 'resubscribe', via: null, campaignId: null },
    ],
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

describe('AdminV2LeadProfile — the lead score belongs to the campaign', () => {
  /** The fixture's two signups, given DIFFERENT scores — the case the person
   *  card cannot express, because it can only show the winning lead's number. */
  const twoScored = () => {
    const d = JSON.parse(JSON.stringify(PROFILE));
    Object.assign(d.consumer.signups[0], { score: 48, scoredAt: '2026-07-27T16:14:35Z' });
    Object.assign(d.consumer.signups[1], { score: 12, scoredAt: '2026-07-27T16:14:35Z' });
    return d;
  };

  it('the drill-in shows THIS campaign\'s score, not the person\'s best', async () => {
    fetchProspectProfile.mockResolvedValue(twoScored());
    setup('/admin/leads/p2');
    await screen.findByText('NTUC Trial Reward');
    // 12 is this lead's own score; 48 belongs to the other campaign and must
    // not be what a reader sees on this page.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('48')).not.toBeInTheDocument();
  });

  it('the campaign rail scores every row, so both signups are comparable', async () => {
    fetchProspectProfile.mockResolvedValue(twoScored());
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('NTUC Trial Reward');
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('an unscored lead says so — NULL is never rendered as a zero', async () => {
    const d = JSON.parse(JSON.stringify(PROFILE));
    d.consumer.signups[0].score = null;
    fetchProspectProfile.mockResolvedValue(d);
    setup();
    expect(await screen.findByText('NOT SCORED YET')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('a consumer-less lead still shows its score — those are scored too', async () => {
    fetchProspectProfile.mockResolvedValue({
      ...JSON.parse(JSON.stringify(PROFILE)),
      consumer: null,
      score: 33,
      scoreComputedAt: '2026-07-27T16:14:35Z',
      signupProfile: { draw: null, entitlements: [], rewardDiagnostic: null },
    });
    setup();
    expect(await screen.findByText('33')).toBeInTheDocument();
    expect(screen.queryByText('NOT SCORED YET')).not.toBeInTheDocument();
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

  it('a pre-stamp signup is never called "phone unverified"', async () => {
    // 134 of 138 prod rows predate the 2026-07-09 server stamp, and the public
    // form has hard-gated submit on a passed OTP since 2025-09-03 — so the
    // proof is missing, the verification almost certainly was not.
    const pre = JSON.parse(JSON.stringify(PROFILE));
    pre.createdAt = '2026-07-01T15:35:19Z';
    pre.sourceMetadata = {};
    pre.consumer.signups[0].draw = null;
    pre.consumer.signups[0].createdAt = '2026-07-01T15:35:19Z';
    pre.consumer.signups[0].verified = false;
    pre.consumer.signups[0].verificationEvidence = 'unrecorded';
    pre.consumer.signups[0].rewardDiagnostic = 'verification_not_recorded';
    pre.signupProfile = { draw: null, entitlements: [], rewardDiagnostic: 'verification_not_recorded' };
    fetchProspectProfile.mockResolvedValue(pre);
    setup();
    expect(await screen.findByText('No reward')).toBeInTheDocument();
    expect(screen.getByText(/signed up before we recorded OTP proof/)).toBeInTheDocument();
    expect(screen.queryByText(/phone unverified/)).not.toBeInTheDocument();
  });

  it('the no-linked-person banner blames the epoch, not the lead, for a pre-stamp signup', async () => {
    fetchProspectProfile.mockResolvedValue({
      ...JSON.parse(JSON.stringify(PROFILE)),
      consumer: null,
      createdAt: '2026-07-01T15:35:19Z',
      sourceMetadata: {},
      signupProfile: { draw: null, entitlements: [], rewardDiagnostic: 'verification_not_recorded' },
    });
    setup();
    expect(await screen.findByText(/predates the OTP proof the identity spine links on/)).toBeInTheDocument();
    expect(screen.queryByText(/\(phone unverified\)/)).not.toBeInTheDocument();
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

  it('History shows voucher lifecycle, draw outcome and consent rows', async () => {
    const profile = JSON.parse(JSON.stringify(PROFILE));
    profile.consumer.signups[0].draw.outcome = {
      status: 'selected_claimed', attemptNo: 2, drawnAt: '2026-07-24T06:00:00Z',
      claimedAt: '2026-07-25T06:00:00Z', outcomeAt: '2026-07-25T06:00:00Z', claimDeadline: null,
    };
    fetchProspectProfile.mockResolvedValue(profile);
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByText('Selected in the draw')).toBeInTheDocument();
    expect(screen.getByText('Prize claimed')).toBeInTheDocument();
    expect(screen.getByText(/Opened their reward link — ×7 views/)).toBeInTheDocument();
    expect(screen.getByText('Voucher scanned at merchant')).toBeInTheDocument();
    expect(screen.getByText('Voucher resend initiated by Ops Staff')).toBeInTheDocument();
    expect(screen.getByText('Cancelled by Ops Staff')).toBeInTheDocument();
    expect(screen.getByText(/duplicate signup/)).toBeInTheDocument();
    expect(screen.getByText('Marketing consent withdrawn')).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp STOP/)).toBeInTheDocument();
    expect(screen.getByText('Marketing consent re-granted')).toBeInTheDocument();
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

/**
 * MEET × BUY scoring panel (consumer-profile-enrichment §7.1b, §8).
 *
 * The breakdown leads and the number follows, so these tests are mostly about
 * the panel telling the truth about what it does NOT know: an unknown
 * component must never render like a scored zero, and an unscoreable Buy must
 * say why instead of showing a figure.
 */
describe('scoring panel', () => {
  const ENRICHED = (over = {}) => {
    const p = JSON.parse(JSON.stringify(PROFILE));
    p.consumer.enrichment = {
      meetScore: 32,
      buyScore: 8,
      consumerScore: 17,
      configVersion: 1,
      algorithmVersion: 'score/v1',
      scoredAt: '2026-07-26T10:30:41Z',
      breakdown: {
        groups: {
          meet: { score: 32, rawMax: 40, components: ['engagement', 'contactability', 'market_fit'] },
          buy: { score: 8, rawMax: 60, components: ['life_events', 'family_gap', 'capacity', 'coverage_headroom'] },
        },
        components: {
          engagement: { state: 'assessed', points: 7.5, maxPoints: 15, basisObservationIds: [], note: '1 signup(s), 1 verified' },
          contactability: { state: 'assessed', points: 5.5, maxPoints: 10, basisObservationIds: [], note: 'reachable via verified phone, email' },
          market_fit: { state: 'unknown', points: 0, maxPoints: 15, basisObservationIds: [], note: 'no language or ethnicity fact' },
          life_events: { state: 'unknown', points: 0, maxPoints: 25, basisObservationIds: [], note: 'no recent life event on record' },
          family_gap: { state: 'assessed', points: 3, maxPoints: 20, basisObservationIds: ['o2'], note: 'children 0' },
          capacity: { state: 'assessed', points: 1.5, maxPoints: 15, basisObservationIds: ['o1'], note: 'income <40k' },
          coverage_headroom: { state: 'unknown', points: 0, maxPoints: -10, basisObservationIds: [], note: 'no coverage fact' },
        },
        completeness: { assessed: 4, total: 7 },
      },
      facts: [
        { key: 'finance.annual_income_band', value: { v: '<40k' }, source: 'form', confidence: 1, observedAt: '2026-07-26T09:10:24Z', observationIds: ['o1'] },
        { key: 'family.children_count_band', value: { v: '0' }, source: 'form', confidence: 1, observedAt: '2026-07-26T09:10:24Z', observationIds: ['o2'] },
        { key: 'household.pets', value: { v: ['dog', 'cat'], complete: false }, source: 'screening_transcript', confidence: 0.8, observedAt: '2026-07-26T09:10:24Z', observationIds: ['o3'] },
      ],
      ...over,
    };
    return p;
  };

  it('shows both scores with the config version that produced them', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByText('Scoring')).toBeInTheDocument();
    expect(screen.getByTitle('Meet 32/100')).toHaveTextContent('32');
    expect(screen.getByTitle('Buy 8/100')).toHaveTextContent('8');
    expect(screen.getByText('CONFIG v1')).toBeInTheDocument();
  });

  it('groups components under reachability and potential', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByText('Reachability')).toBeInTheDocument();
    expect(screen.getByText('Potential')).toBeInTheDocument();
    expect(screen.getByText('engagement')).toBeInTheDocument();
    expect(screen.getByText('coverage headroom')).toBeInTheDocument();
  });

  it('an unknown component reads "—", never a scored zero', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Scoring');
    // The reason lives on the LABEL now, not in a trailing column that ellipsed
    // it. It must still be reachable WITHOUT a mouse — the accessible name is
    // the contract, because for several components this is the only place the
    // explanation exists at all.
    expect(screen.getByLabelText(/market fit: no language or ethnicity fact/)).toBeInTheDocument();
    expect(screen.getByLabelText(/life events: no recent life event on record/)).toBeInTheDocument();
    // The assessed ones DO show their points.
    expect(screen.getByText('7.5')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
  });

  it('names the campaign the person\'s numbers were copied from', async () => {
    const d = ENRICHED();
    d.consumer.enrichment.scoreSource = {
      prospectId: 'p2', campaignId: 'camp-2', campaignName: 'NTUC Trial Reward',
    };
    fetchProspectProfile.mockResolvedValue(d);
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Scoring');
    // "50" alone invites the reader to treat it as a verdict on the PERSON.
    // It is their best campaign's number, and which campaign is the difference
    // between actionable and misleading once weights differ per campaign.
    expect(screen.getByText(/their best campaign/)).toBeInTheDocument();
  });

  it('says nothing when the winning lead is not known yet', async () => {
    // Migration 101 deliberately did not backfill, so every person carries no
    // source until their next rescore. Silence beats naming the wrong campaign.
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Scoring');
    expect(screen.queryByText(/their best campaign/)).not.toBeInTheDocument();
  });

  it('the reason opens on hover, and on keyboard focus', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Scoring');
    const hint = screen.getByLabelText(/market fit: no language or ethnicity fact/);

    // Nothing on screen until asked — that is the whole point of the change.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(hint);
    expect(screen.getByRole('tooltip')).toHaveTextContent('no language or ethnicity fact');
    fireEvent.mouseLeave(hint);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // A mouse-only hint would hide these reasons from a keyboard reader
    // entirely, now that they are not printed on the row.
    fireEvent.focus(hint);
    expect(screen.getByRole('tooltip')).toHaveTextContent('no language or ethnicity fact');
    fireEvent.keyDown(hint, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('names the unknowns as unasked questions, not as low scores', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    expect(await screen.findByText(/4 of 7 components assessed/)).toBeInTheDocument();
    expect(screen.getByText(/questions nobody has been asked/)).toBeInTheDocument();
  });

  it('an unscoreable Buy explains itself instead of showing a number', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED({ buyScore: null }));
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Scoring');
    expect(screen.getByText('no facts to judge')).toBeInTheDocument();
    expect(screen.queryByTitle('Buy 0/100')).not.toBeInTheDocument();
  });

  it('renders the fact ledger with provenance, flagging partial collections', async () => {
    fetchProspectProfile.mockResolvedValue(ENRICHED());
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Scoring');
    expect(screen.getByText(/3 FACTS/)).toBeInTheDocument();
    expect(screen.getByText('annual income')).toBeInTheDocument();
    expect(screen.getByText('<40k')).toBeInTheDocument();
    // A non-complete collection must not imply a closed list.
    expect(screen.getByText('dog, cat — partial')).toBeInTheDocument();
    expect(screen.getByText('screening_transcript')).toBeInTheDocument();
  });

  it('is absent entirely when the person has never been scored', async () => {
    const p = JSON.parse(JSON.stringify(PROFILE));
    p.consumer.enrichment = null;
    fetchProspectProfile.mockResolvedValue(p);
    setup('/admin/leads/p1?view=profile');
    await screen.findByText('Campaigns');
    expect(screen.queryByText('Scoring')).not.toBeInTheDocument();
  });
});

/**
 * The LEAD score's own breakdown (per-campaign-lead-scoring §4/§6).
 *
 * The drill-in used to state the number and stop there, so the one page about
 * one lead was the one page that could not say why. The breakdown it shows is
 * the LEAD's — read off the prospect row — because the person's card is a copy
 * of their winning lead's and would explain a different number entirely.
 */
describe('lead score breakdown (drill-in)', () => {
  /** Shaped on a real prod row: two lead-grain components, one screening event,
   *  a negative-max penalty, and four unknowns. */
  const SCORED = (over = {}) => {
    const d = JSON.parse(JSON.stringify(PROFILE));
    Object.assign(d.consumer.signups[0], { score: 48, scoredAt: '2026-07-27T16:14:35Z' });
    return Object.assign(d, {
      score: 48,
      meetScore: 50,
      buyScore: 16,
      scoredConfigVersion: 3,
      scoringAlgorithmVersion: 'lead/v1',
      scoreComputedAt: '2026-07-27T16:14:35Z',
      scoreBreakdown: {
        algorithmVersion: 'lead/v1',
        groups: {
          meet: { score: 50, rawMax: 75, components: ['engagement', 'contactability', 'market_fit', 'response', 'screening'] },
          buy: { score: 16, rawMax: 70, components: ['life_events', 'family_gap', 'capacity', 'coverage_headroom', 'age'] },
        },
        components: {
          engagement: { state: 'assessed', points: 7.47, maxPoints: 15, basisObservationIds: [], note: '1 signup(s), 1 verified' },
          contactability: { state: 'assessed', points: 10, maxPoints: 10, basisObservationIds: [], note: 'reachable via marketing consent, verified phone, email, WhatsApp' },
          market_fit: { state: 'unknown', points: 0, maxPoints: 15, basisObservationIds: [], note: 'no language or ethnicity fact' },
          response: { state: 'unknown', points: 0, maxPoints: 15, basisObservationIds: [], note: 'no message owned by this lead yet' },
          screening: { state: 'assessed', points: 20, maxPoints: 20, basisObservationIds: [], note: 'qualified, sentiment positive' },
          life_events: { state: 'unknown', points: 0, maxPoints: 25, basisObservationIds: [], note: 'no recent life event on record' },
          family_gap: { state: 'assessed', points: 3, maxPoints: 20, basisObservationIds: ['o2'], note: 'children 0' },
          capacity: { state: 'assessed', points: 1.5, maxPoints: 15, basisObservationIds: ['o1'], note: 'income <40k' },
          coverage_headroom: { state: 'unknown', points: 0, maxPoints: -10, basisObservationIds: [], note: 'no coverage fact' },
          age: { state: 'assessed', points: 6.5, maxPoints: 10, basisObservationIds: ['o3'], note: 'born 1995-1999 — age 27-31 in 2026' },
        },
        completeness: { assessed: 6, total: 10 },
        events: [{
          type: 'screening', at: '2026-07-26T09:25:51Z', ageDays: 1, component: 'screening',
          verdict: 'qualified', interest: null, sentiment: 'positive', agreedToMeet: null,
          undecayedWeight: 20, schemaVersion: 'screening/v1',
        }],
      },
      ...over,
    });
  };

  it('states the working, not just the number: both halves, config, campaign', async () => {
    fetchProspectProfile.mockResolvedValue(SCORED());
    setup();
    expect(await screen.findByText('Lead score')).toBeInTheDocument();
    expect(screen.getByTitle('Meet 50/100')).toHaveTextContent('50');
    expect(screen.getByTitle('Buy 16/100')).toHaveTextContent('16');
    // SGT, like every other timestamp on the page: 16:14Z is 00:14 on the 28th.
    expect(screen.getByText('CONFIG v3 · SCORED 28 JUL 00:14')).toBeInTheDocument();
    // This fixture's person has never been person-scored (no enrichment), so
    // the page has no profile scoring card — the copy must not point the
    // reader at a comparison surface that is not there. Function matcher:
    // the campaign name is a nested span, so the sentence spans elements.
    expect(screen.getByText((_, el) => el?.textContent === 'Tokyo Getaway Lucky Draw only.')).toBeInTheDocument();
    expect(screen.queryByText(/profile card scores their best campaign/)).not.toBeInTheDocument();
  });

  it('says the total is a capped sum — a reader who averages 50 and 16 gets 33', async () => {
    fetchProspectProfile.mockResolvedValue(SCORED());
    setup();
    await screen.findByText('Lead score');
    expect(screen.getByText(/= the points below, added up and capped at 100/)).toBeInTheDocument();
    expect(screen.getByText(/not an average of the two halves/)).toBeInTheDocument();
    // The hero's number and the number the parts add to are the SAME number.
    expect(screen.getAllByText('48')).toHaveLength(2);
  });

  it('groups the parts and prices each one against its own maximum', async () => {
    fetchProspectProfile.mockResolvedValue(SCORED());
    setup();
    await screen.findByText('Lead score');
    expect(screen.getByText('Reachability')).toBeInTheDocument();
    expect(screen.getByText('Potential')).toBeInTheDocument();
    expect(screen.getByText('7.47')).toBeInTheDocument();
    expect(screen.getByText('6.5')).toBeInTheDocument();
    expect(screen.getByText(/6 of 10 components assessed/)).toBeInTheDocument();
    // The penalty keeps its negative maximum — a reader must be able to see
    // that coverage headroom can only ever subtract.
    expect(screen.getByText('/-10')).toBeInTheDocument();
  });

  it('names the two lead-grain components instead of printing column keys', async () => {
    fetchProspectProfile.mockResolvedValue(SCORED());
    setup();
    await screen.findByText('Lead score');
    expect(screen.getByLabelText(/screening call: qualified, sentiment positive/)).toBeInTheDocument();
    expect(screen.getByLabelText(/message response: no message owned by this lead yet/)).toBeInTheDocument();
    expect(screen.queryByText('screening')).not.toBeInTheDocument();
  });

  it('lists what happened, when, and what it was worth at full strength', async () => {
    fetchProspectProfile.mockResolvedValue(SCORED());
    setup();
    await screen.findByText('Lead score');
    expect(screen.getByText('Response events')).toBeInTheDocument();
    expect(screen.getByText('Screening call: qualified · sentiment positive')).toBeInTheDocument();
    expect(screen.getByText('+20')).toBeInTheDocument();
    expect(screen.getByText(/Weights are shown at full strength/)).toBeInTheDocument();
  });

  it('explains THIS lead, never the person\'s projection of their best one', async () => {
    const d = SCORED();
    // The person's card would say Meet 32 — their best lead's, which on a
    // second campaign is a different lead entirely.
    d.consumer.enrichment = {
      meetScore: 32, buyScore: 8, consumerScore: 17, configVersion: 3,
      scoredAt: '2026-07-27T16:14:35Z', breakdown: { groups: {}, components: {} }, facts: [],
    };
    fetchProspectProfile.mockResolvedValue(d);
    setup();
    await screen.findByText('Lead score');
    expect(screen.getByTitle('Meet 50/100')).toBeInTheDocument();
    expect(screen.queryByTitle('Meet 32/100')).not.toBeInTheDocument();
    // The person's own card belongs to the person's own view.
    expect(screen.queryByText('Scoring')).not.toBeInTheDocument();
    // But since that card EXISTS for this person, the drill-in names the §4
    // relationship, so the two cards disagreeing does not read as a bug.
    expect(screen.getByText(/only — the profile card scores their best campaign\./)).toBeInTheDocument();
  });

  it('is absent until the sweep has scored this lead', async () => {
    setup();
    await screen.findByText('Signup detail');
    expect(screen.queryByText('Lead score')).not.toBeInTheDocument();
  });

  it('is absent for an erased person, whose score columns are nulled', async () => {
    const d = SCORED();
    d.consumer.consumer.erasedAt = '2026-07-28T02:00:00Z';
    fetchProspectProfile.mockResolvedValue(d);
    setup();
    await screen.findByText(/This person was erased/);
    expect(screen.queryByText('Lead score')).not.toBeInTheDocument();
  });
});
