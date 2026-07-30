/**
 * The Lead scoring card (campaign-scoring-editor §3.2): read states per tier,
 * the flag-off neutral copy, regrade progress, the draft → preview → approve
 * flow with its §4.5 baseline and no-op contract, and the history rows'
 * date/action semantics.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignScoringCard from '../CampaignScoringCard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/api/adminV2', () => ({
  fetchScoringSheet: vi.fn(),
  fetchScoringHistory: vi.fn(async () => []),
  fetchScoringProgress: vi.fn(async () => ({ total: 0, current: 0, resolvedVersion: 0, complete: true })),
  fetchScoringEdition: vi.fn(),
  createScoringDraft: vi.fn(),
  simulateScoringDraft: vi.fn(),
  approveScoringDraft: vi.fn(),
  proposeScoringSheet: vi.fn(),
}));

import { toast } from 'sonner';
import {
  fetchScoringSheet, fetchScoringHistory, fetchScoringProgress, fetchScoringEdition,
  createScoringDraft, simulateScoringDraft, approveScoringDraft, proposeScoringSheet,
} from '@/api/adminV2';

const HOUSE = {
  components: {
    engagement: { maxPoints: 15 }, contactability: { maxPoints: 10 }, market_fit: { maxPoints: 15 },
    life_events: { maxPoints: 25 }, family_gap: { maxPoints: 20 }, capacity: { maxPoints: 15 },
    age: { maxPoints: 10 }, coverage_headroom: { maxPoints: -10 },
  },
  leadComponents: { response: { maxPoints: 15 }, screening: { maxPoints: 20 } },
  ageCurve: [{ upTo: 24, value: 0.25 }, { upTo: 44, value: 1 }, { upTo: null, value: 0.3 }],
  targetSegments: [{ language: 'zh', ethnicity: 'chinese', weight: 1 }],
};

const SHEET_DEFAULT = {
  version: 0, scope: 'default', config: HOUSE, raw: {}, activatedAt: null, actorName: null, houseDefault: HOUSE,
};
const SHEET_CAMPAIGN = {
  version: 7, scope: 'campaign', config: HOUSE, raw: { components: { age: { maxPoints: 8 } } },
  activatedAt: '2026-07-30T04:00:00Z', actorName: 'Shawn Lee', houseDefault: HOUSE,
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignScoringCard campaignId="camp-1" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchScoringHistory.mockResolvedValue([]);
  fetchScoringProgress.mockResolvedValue({ total: 0, current: 0, resolvedVersion: 0, complete: true });
});

describe('read states', () => {
  it('a 404 backend renders the neutral unavailable copy — never "the flag is off"', async () => {
    fetchScoringSheet.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    setup();
    expect(await screen.findByText(/Scoring controls are unavailable on this backend/)).toBeInTheDocument();
    expect(screen.queryByText(/flag/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customise' })).not.toBeInTheDocument();
  });

  it('house default reads as the fallback it is', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_DEFAULT);
    setup();
    expect(await screen.findByText('house default')).toBeInTheDocument();
    expect(screen.getByText('HOUSE DEFAULT')).toBeInTheDocument();
    expect(screen.getByText(/customising pins a sheet to this campaign only/)).toBeInTheDocument();
  });

  it('a campaign edition names itself, its activation, and its approver', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    setup();
    expect(await screen.findByText('campaign sheet')).toBeInTheDocument();
    expect(screen.getByText(/EDITION #7 · LIVE SINCE/)).toBeInTheDocument();
    expect(screen.getByText(/approved by Shawn Lee/)).toBeInTheDocument();
  });

  it('shows regrade progress only while the sweep still owes leads', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    fetchScoringProgress.mockResolvedValue({ total: 40, current: 12, resolvedVersion: 7, complete: false });
    setup();
    expect(await screen.findByTestId('scoring-progress')).toHaveTextContent('12 of 40');
    expect(screen.getByTestId('scoring-progress')).toHaveTextContent('edition #7');
  });
});

describe('draft → preview → approve', () => {
  it('saves the FULL exposed set as the patch and auto-runs the preview', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_DEFAULT);
    createScoringDraft.mockResolvedValue({ version: 9, status: 'draft' });
    simulateScoringDraft.mockResolvedValue({
      comparedTo: 'resolved', resolvedVersion: 0,
      population: { examined: 30, truncated: true },
      diff: { meanDelta: 4.2, movedOver20: 3, becameNull: 2 },
      stored: { scored: 28, mean: 21 },
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Customise' }));

    const engagement = screen.getByLabelText('engagement weight');
    fireEvent.change(engagement, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft & preview' }));

    await waitFor(() => expect(createScoringDraft).toHaveBeenCalled());
    const [cid, patch] = createScoringDraft.mock.calls[0];
    expect(cid).toBe('camp-1');
    // The full exposed set — exposed knobs never float (§4.1).
    expect(Object.keys(patch.components)).toHaveLength(8);
    expect(patch.components.engagement.maxPoints).toBe(20);
    expect(patch.components.coverage_headroom.maxPoints).toBe(-10);
    expect(patch.leadComponents).toEqual({ response: { maxPoints: 15 }, screening: { maxPoints: 20 } });
    expect(Array.isArray(patch.ageCurve)).toBe(true);

    // The preview states the sample, the movers, and the becameNull warning.
    expect(await screen.findByText(/Average score rises by 4.2 points/)).toBeInTheDocument();
    expect(screen.getByText(/a sample — the campaign holds more/)).toBeInTheDocument();
    expect(screen.getByText(/3 leads would move more than 20 points/)).toBeInTheDocument();
    expect(screen.getByText(/2 leads would lose their Buy score entirely/)).toBeInTheDocument();
    expect(screen.getByText(/includes drift since each lead's last rescore/)).toBeInTheDocument();
  });

  it('approve carries the baseline the editor OPENED with, and lands the success toast', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    createScoringDraft.mockResolvedValue({ version: 9, status: 'draft' });
    simulateScoringDraft.mockResolvedValue({ population: { examined: 5 }, diff: { meanDelta: 0, movedOver20: 0, becameNull: 0 } });
    approveScoringDraft.mockResolvedValue({ version: 9, status: 'approved' });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Customise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft & preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve & apply' }));
    // Inline confirm, then the commit.
    expect(screen.getByText(/Make edition #9 live\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, make it live' }));
    await waitFor(() => expect(approveScoringDraft).toHaveBeenCalledWith(9, 7));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Edition #9 is live/)));
  });

  it('a no-op approve says nothing changed and no regrade was triggered', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    createScoringDraft.mockResolvedValue({ version: 9, status: 'draft' });
    simulateScoringDraft.mockResolvedValue({ population: { examined: 5 }, diff: { meanDelta: 0, movedOver20: 0, becameNull: 0 } });
    approveScoringDraft.mockResolvedValue({ noOp: true, live: { version: 7 }, candidateVersion: 9 });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Customise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft & preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve & apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, make it live' }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/Already live.*no regrade/)));
  });

  it('a 409 surfaces the re-open-preview sentence', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    createScoringDraft.mockResolvedValue({ version: 9, status: 'draft' });
    simulateScoringDraft.mockResolvedValue({ population: { examined: 1 }, diff: { meanDelta: 0, movedOver20: 0, becameNull: 0 } });
    approveScoringDraft.mockRejectedValue(Object.assign(new Error('The live sheet changed while you were editing — re-open preview.'), { status: 409 }));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Customise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft & preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve & apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, make it live' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed while you were editing/)));
  });
});

describe('history', () => {
  it('dates drafts by creation and live rows by activation; actions split draft vs superseded', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    fetchScoringHistory.mockResolvedValue([
      { version: 9, status: 'draft', createdAt: '2026-07-30T10:00:00Z', activatedAt: '2026-07-30T10:00:00Z', actorName: 'Shawn Lee' },
      { version: 7, status: 'approved', createdAt: '2026-07-29T00:00:00Z', activatedAt: '2026-07-30T04:00:00Z', actorName: 'Shawn Lee' },
      { version: 4, status: 'superseded', createdAt: '2026-07-20T00:00:00Z', activatedAt: '2026-07-21T00:00:00Z', actorName: null },
    ]);
    setup();
    await screen.findByText('campaign sheet');
    fireEvent.click(screen.getByText('Edition history'));

    // Drafts get activatedAt AT INSERT (schema quirk) — the UI must not read
    // it as an activation.
    expect(await screen.findByText(/DRAFTED 30 JUL/)).toBeInTheDocument();
    expect(screen.getAllByText(/LIVE SINCE/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Review & make live' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Restore as new draft' }).length).toBe(2);
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });

  it('reviewing an OLD draft warns about rollback in the confirm', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN); // live = #7
    fetchScoringHistory.mockResolvedValue([
      { version: 5, status: 'draft', createdAt: '2026-07-28T00:00:00Z', activatedAt: '2026-07-28T00:00:00Z', actorName: null },
    ]);
    fetchScoringEdition.mockResolvedValue({ version: 5, status: 'draft', configJson: { components: { age: { maxPoints: 4 } } } });
    simulateScoringDraft.mockResolvedValue({ population: { examined: 2 }, diff: { meanDelta: -1, movedOver20: 0, becameNull: 0 } });
    setup();
    await screen.findByText('campaign sheet');
    fireEvent.click(screen.getByText('Edition history'));
    fireEvent.click(await screen.findByRole('button', { name: 'Review & make live' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Approve & apply' }));
    expect(screen.getByText(/This rolls back past edition #7/)).toBeInTheDocument();
  });
});

describe('the AI author (Phase 1.6)', () => {
  const AI_DRAFT = {
    version: 11, status: 'draft',
    configJson: {
      components: {
        engagement: { maxPoints: 15 }, contactability: { maxPoints: 12 }, market_fit: { maxPoints: 10 },
        life_events: { maxPoints: 20 }, family_gap: { maxPoints: 18 }, capacity: { maxPoints: 10 },
        age: { maxPoints: 8 }, coverage_headroom: { maxPoints: -6 },
      },
      leadComponents: { response: { maxPoints: 12 }, screening: { maxPoints: 24 } },
    },
  };

  it('one click + one optional sentence → the SAME draft/preview/approve flow as manual', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    proposeScoringSheet.mockResolvedValue({
      draft: AI_DRAFT,
      rationale: 'Screening is this campaign’s richest signal; capacity matters less for a draw audience.',
      simulation: { comparedTo: 'stored' }, // deliberately ignored by the card
    });
    simulateScoringDraft.mockResolvedValue({ population: { examined: 12 }, diff: { meanDelta: 2, movedOver20: 1, becameNull: 0 } });
    setup();

    fireEvent.click(await screen.findByRole('button', { name: /Draft with AI/ }));
    fireEvent.change(screen.getByLabelText('steer the AI (optional)'), { target: { value: 'screening matters most' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write the sheet' }));

    await waitFor(() => expect(proposeScoringSheet).toHaveBeenCalledWith('camp-1', 'screening matters most'));
    // The editor opens ON the AI's document…
    expect(await screen.findByText('Why the AI chose this')).toBeInTheDocument();
    expect(screen.getByLabelText('screening call weight')).toHaveValue(24);
    // …the preview re-runs with the resolved comparison (never the propose sim)…
    await waitFor(() => expect(simulateScoringDraft).toHaveBeenCalledWith(11));
    // …and approve is the same gate, carrying the same baseline.
    approveScoringDraft.mockResolvedValue({ version: 11, status: 'approved' });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve & apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, make it live' }));
    await waitFor(() => expect(approveScoringDraft).toHaveBeenCalledWith(11, 7));
  });

  it('touching any knob INVALIDATES the pending draft — approve can never ship a pre-edit doc', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    proposeScoringSheet.mockResolvedValue({ draft: AI_DRAFT, rationale: 'r' });
    simulateScoringDraft.mockResolvedValue({ population: { examined: 3 }, diff: { meanDelta: 0, movedOver20: 0, becameNull: 0 } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Draft with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Write the sheet' }));
    await screen.findByRole('button', { name: 'Approve & apply' });

    fireEvent.change(screen.getByLabelText('engagement weight'), { target: { value: '18' } });
    // Back through Save & preview — the stale draft and its rationale are gone.
    expect(screen.getByRole('button', { name: 'Save draft & preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve & apply' })).not.toBeInTheDocument();
    expect(screen.queryByText('Why the AI chose this')).not.toBeInTheDocument();
  });

  it('an unavailable AI degrades to a toast that points at AI Settings and the manual path', async () => {
    fetchScoringSheet.mockResolvedValue(SHEET_CAMPAIGN);
    proposeScoringSheet.mockRejectedValue(new Error('AI provider is not configured.'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Draft with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Write the sheet' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('AI provider is not configured.'));
  });
});
