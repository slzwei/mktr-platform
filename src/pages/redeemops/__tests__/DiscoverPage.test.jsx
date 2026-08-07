/**
 * DiscoverPage — the three behaviors that guard real money / real data:
 * 1. AI suggestions PREFILL the form and never fire a paid search;
 * 2. a candidate mid-enrichment shows "Enriching…" (not another paid action);
 * 3. dismiss hits the API and the undo toast's action restores.
 * redeemOpsApi is fully mocked — no network, no backend.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listDiscoveryRuns: vi.fn(),
  getDiscoveryRun: vi.fn(),
  startDiscovery: vi.fn(),
  suggestDiscoveryTerms: vi.fn(),
  enrichDiscoveryCandidates: vi.fn(),
  addDiscoveryCandidates: vi.fn(),
  dismissDiscoveryCandidate: vi.fn(),
  restoreDiscoveryCandidate: vi.fn(),
}));
vi.mock('@/api/redeemOps', () => ({ redeemOpsApi: api }));

const toastMock = vi.hoisted(() => {
  const t = vi.fn();
  t.success = vi.fn();
  t.error = vi.fn();
  t.info = vi.fn();
  return t;
});
vi.mock('sonner', () => ({ toast: toastMock }));

// CategorySelect has its own data fetching — swap for a plain input.
vi.mock('@/components/redeemops/CategorySelect', () => ({
  default: ({ value, onChange }) => (
    <input aria-label="Category" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import DiscoverPage from '../DiscoverPage';

const quota = { used: 0, limit: 5, remaining: 5, costPerResultUsd: 0.007 };
const completedRun = {
  id: 'r1', status: 'completed', category: 'Nail Salon', area: 'Tampines',
  requestedLimit: 30, resultCount: 1, createdAt: new Date().toISOString(),
};
const baseCandidate = {
  id: 'c1', name: 'Pending Nails', status: 'pending', dedupeStatus: 'new',
  instagramHandle: 'pend', followersCount: null, enrichmentStatus: 'none',
  rawPayload: { categoryName: 'Discount store' },
};

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DiscoverPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openResults() {
  await userEvent.click(await screen.findByRole('button', { name: /Open results/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listDiscoveryRuns.mockResolvedValue({ runs: [], quota });
});

describe('DiscoverPage', () => {
  it('shows every filter up front — nothing hidden behind an expander', async () => {
    renderPage();
    // No click: rating, closed-businesses and the category restriction are all
    // on screen as soon as the form is.
    expect(await screen.findByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Min rating')).toBeInTheDocument();
    expect(screen.getByText('Exclude closed businesses')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('learning center, education center')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More filters/i })).not.toBeInTheDocument();
  });

  it('offers no area controls — every search covers all of Singapore', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Search Google Maps/i }); // page settled
    expect(screen.queryByText('Search territory')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Neighbourhood or district…')).not.toBeInTheDocument();
    expect(screen.queryByText('Popular areas')).not.toBeInTheDocument();
    expect(screen.getByText(/Searches all of Singapore/)).toBeInTheDocument();
  });

  it('falls back to keyword search when the backend reports no aiEnabled', async () => {
    renderPage(); // beforeEach response has no aiEnabled
    await screen.findByRole('button', { name: /Search Google Maps/i }); // page settled
    // No LLM configured must never leave the page unable to run a search.
    expect(screen.queryByLabelText(/Describe who you're looking for/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/nail salon, taekwondo/)).toBeInTheDocument();
  });

  it('AI is the DEFAULT mode once the backend reports aiEnabled — no reveal needed', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [], quota, aiEnabled: true });
    renderPage();
    // Present on first paint, not behind a "Get AI suggestions" toggle. The
    // flag arrives async with the runs list, so this also pins that the default
    // follows it rather than latching the first (undefined) render.
    expect(await screen.findByLabelText(/Describe who you're looking for/i)).toBeInTheDocument();
    // ...and the terms that will actually run are still on screen and editable.
    expect(screen.getByLabelText(/Search phrases to run/i)).toBeInTheDocument();
  });

  it('an operator can still switch to typing phrases themselves', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [], quota, aiEnabled: true });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Type phrases myself/i }));
    expect(screen.queryByLabelText(/Describe who you're looking for/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/nail salon, taekwondo/)).toBeInTheDocument();
  });

  it('AI suggest populates the terms field and never starts a paid search', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [], quota, aiEnabled: true });
    api.suggestDiscoveryTerms.mockResolvedValue({
      terms: ['taekwondo', 'martial arts school', 'kids karate'],
      categories: ['Martial arts school', 'Gym'],
    });
    renderPage();
    // AI is the DEFAULT mode — the description box is there without revealing it.
    const aiInput = await screen.findByLabelText('Describe who you\'re looking for');
    await userEvent.type(aiInput, 'martial arts for kids');
    await userEvent.click(screen.getByRole('button', { name: 'Find terms' }));
    await waitFor(() => expect(api.suggestDiscoveryTerms).toHaveBeenCalledWith({
      description: 'martial arts for kids',
      provider: 'google_maps',
    }));
    // The terms that will actually run stay visible and editable in AI mode —
    // a search spends Apify budget, so it is never a black box.
    expect(screen.getByLabelText(/Search phrases to run/i)).toHaveValue(
      'taekwondo, martial arts school, kids karate',
    );
    // categories are pre-filled into the always-visible Restrict-categories field
    expect(screen.getByPlaceholderText('learning center, education center')).toHaveValue(
      'Martial arts school, Gym',
    );
    expect(api.startDiscovery).not.toHaveBeenCalled();
  });

  it('after an AI-suggested search, off-target categories are auto-hidden in the results', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [], quota, aiEnabled: true });
    api.suggestDiscoveryTerms.mockResolvedValue({
      terms: ['children robotics', 'coding enrichment'], categories: ['Learning center'],
    });
    api.startDiscovery.mockResolvedValue({ id: 'rNew' });
    api.getDiscoveryRun.mockResolvedValue({
      run: { id: 'rNew', status: 'completed', category: null, area: 'All Singapore', requestedLimit: 30 },
      candidates: [
        { ...baseCandidate, id: 'k1', name: 'Robotics Academy', rawPayload: { categoryName: 'Learning center' } },
        { ...baseCandidate, id: 'k2', name: 'Korean Buffet', rawPayload: { categoryName: 'Korean restaurant' } },
      ],
    });
    renderPage();
    await userEvent.type(await screen.findByLabelText('Describe who you\'re looking for'), 'robotics for kids');
    await userEvent.click(screen.getByRole('button', { name: 'Find terms' }));
    await screen.findByDisplayValue('children robotics, coding enrichment');
    await userEvent.click(screen.getByRole('button', { name: /Search Google Maps/i }));
    // The search fires with no area — the backend records it as All Singapore.
    await waitFor(() => expect(api.startDiscovery).toHaveBeenCalledWith({
      limit: 30, provider: 'google_maps',
      searchTerms: ['children robotics', 'coding enrichment'],
      skipClosed: true, categoryFilterWords: ['Learning center'],
    }));
    // results load; the off-target category (Korean restaurant) is auto-hidden, the on-target one stays
    expect(await screen.findByText('Robotics Academy')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Korean Buffet')).not.toBeInTheDocument());
    expect(screen.getByText(/1 hidden by type/)).toBeInTheDocument();
  });

  it('says which category words were ignored instead of quietly narrowing the search', async () => {
    // The backend drops words Google has no category for and echoes them back —
    // an unannounced drop makes a partly-applied filter look like the one asked for.
    api.startDiscovery.mockResolvedValue({
      id: 'rNew', rawPayload: { categoryFilterWords: ['gymnastics center'], categoryFilterWordsDropped: ['kids gym'] },
    });
    api.getDiscoveryRun.mockResolvedValue({
      run: {
        id: 'rNew', status: 'completed', area: 'Tampines', requestedLimit: 30,
        rawPayload: {
          searchTerms: ['gymnastics'],
          categoryFilterWords: ['gymnastics center'],
          categoryFilterWordsDropped: ['kids gym'],
        },
      },
      candidates: [],
    });
    renderPage();
    await userEvent.type(await screen.findByPlaceholderText(/nail salon, taekwondo/), 'gymnastics');
    await userEvent.type(screen.getByPlaceholderText('learning center, education center'), 'Gymnastics center, kids gym');
    await userEvent.click(screen.getByRole('button', { name: /Search Google Maps/i }));
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith(
      'Searching without "kids gym"',
      expect.objectContaining({ description: expect.stringContaining('Not a Google category') }),
    ));
    // …and the results header keeps the receipt.
    expect(await screen.findByText('Ignored')).toBeInTheDocument();
  });

  it('shows remaining results when the atomic quota response is present', async () => {
    api.listDiscoveryRuns.mockResolvedValue({
      runs: [],
      quota: {
        mode: 'results', resultsUsed: 125, resultsRemaining: 1375,
        profilesRemaining: 200, costPerResultUsd: 0.007,
      },
    });
    renderPage();
    expect(await screen.findByText(/1375/)).toBeInTheDocument();
    expect(screen.getByText(/results left today/)).toBeInTheDocument();
    expect(screen.queryByText(/searches today/)).not.toBeInTheDocument();
  });

  it('shows Enriching… while enrichment is pending instead of another paid action', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({
      run: completedRun,
      candidates: [{ ...baseCandidate, enrichmentStatus: 'pending' }],
    });
    renderPage();
    await openResults();
    expect(await screen.findByText('Enriching…')).toBeInTheDocument();
    expect(screen.queryByText('followers?')).not.toBeInTheDocument();
    // Google's own category label is surfaced so weak matches are self-evident.
    expect(screen.getByText(/Discount store/)).toBeInTheDocument();
  });

  it('hidden rows sit behind the Hidden segment with a Restore action', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({
      run: completedRun,
      candidates: [baseCandidate, { ...baseCandidate, id: 'c2', name: 'Hidden Nails', status: 'dismissed' }],
    });
    api.restoreDiscoveryCandidate.mockResolvedValue({});
    renderPage();
    await openResults();
    // dismissed by default, surfaced in the count line
    expect(await screen.findByText(/1 dismissed/)).toBeInTheDocument();
    expect(screen.queryByText('Hidden Nails')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Hidden 1/ }));
    expect(await screen.findByText('Hidden Nails')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore Hidden Nails' }));
    await waitFor(() => expect(api.restoreDiscoveryCandidate).toHaveBeenCalledWith('c2'));
  });

  it('post-search category facet hides an off-vertical Google category from the results', async () => {
    const cands = [
      { ...baseCandidate, id: 'c1', name: 'Robotics Academy', rawPayload: { categoryName: 'Learning center' } },
      { ...baseCandidate, id: 'c2', name: 'Coding Lab', rawPayload: { categoryName: 'Learning center' } },
      { ...baseCandidate, id: 'c3', name: 'Korean Buffet', rawPayload: { categoryName: 'Korean restaurant' } },
    ];
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({ run: completedRun, candidates: cands });
    renderPage();
    await openResults();
    expect(await screen.findByText('Korean Buffet')).toBeInTheDocument();
    // uncheck the off-vertical category → its row drops, the on-vertical ones stay
    await userEvent.click(screen.getByRole('button', { name: /Korean restaurant/i }));
    await waitFor(() => expect(screen.queryByText('Korean Buffet')).not.toBeInTheDocument());
    expect(screen.getByText(/1 hidden by type/)).toBeInTheDocument();
    expect(screen.getByText('Robotics Academy')).toBeInTheDocument();
  });

  it('recent searches show the exact terms; only a legacy narrow area is appended', async () => {
    api.listDiscoveryRuns.mockResolvedValue({
      runs: [{
        id: 'r9', status: 'completed', category: null, area: 'All Singapore',
        requestedLimit: 500, resultCount: 365, createdAt: new Date().toISOString(),
        rawPayload: { searchTerms: ['nail salon', 'facial', 'lashes'] },
      }, {
        id: 'r8', status: 'completed', category: null, area: 'Tampines',
        requestedLimit: 30, resultCount: 12, createdAt: new Date().toISOString(),
        rawPayload: { searchTerms: ['tuition'] },
      }],
      quota,
    });
    renderPage();
    // Every new run is country-wide, so 'All Singapore' would be noise on each row…
    expect(await screen.findByText('nail salon, facial, lashes')).toBeInTheDocument();
    // …but a pre-removal run that really was scoped keeps its saved area visible.
    expect(screen.getByText('tuition · Tampines')).toBeInTheDocument();
  });

  it('the results view shows a Terms pill and a back button that returns to the list', async () => {
    const runWithTerms = { ...completedRun, category: null, rawPayload: { searchTerms: ['nail salon', 'taekwondo'] } };
    api.listDiscoveryRuns.mockResolvedValue({ runs: [runWithTerms], quota });
    api.getDiscoveryRun.mockResolvedValue({ run: runWithTerms, candidates: [baseCandidate] });
    renderPage();
    await openResults();
    // query bar surfaces the fired terms (ad-hoc run → no Category pill '—')
    expect(await screen.findByText('Terms')).toBeInTheDocument();
    expect(screen.getByText('nail salon, taekwondo')).toBeInTheDocument();
    // back button returns to the recent-searches list
    await userEvent.click(screen.getByRole('button', { name: /All searches/i }));
    expect(await screen.findByRole('button', { name: /Open results/i })).toBeInTheDocument();
  });

  it('seen-before rows carry the Seen previously badge', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({
      run: completedRun,
      candidates: [{ ...baseCandidate, previouslySeenAt: new Date().toISOString() }],
    });
    renderPage();
    await openResults();
    expect(await screen.findByText('Seen previously')).toBeInTheDocument();
  });

  it('dismiss calls the API and the undo toast action restores', async () => {
    api.listDiscoveryRuns.mockResolvedValue({ runs: [completedRun], quota });
    api.getDiscoveryRun.mockResolvedValue({ run: completedRun, candidates: [baseCandidate] });
    api.dismissDiscoveryCandidate.mockResolvedValue({});
    api.restoreDiscoveryCandidate.mockResolvedValue({});
    renderPage();
    await openResults();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Pending Nails' }));
    await waitFor(() => expect(api.dismissDiscoveryCandidate).toHaveBeenCalledWith('c1'));
    const dismissedToast = toastMock.mock.calls.find(([msg]) => msg === 'Dismissed');
    expect(dismissedToast).toBeTruthy();
    dismissedToast[1].action.onClick();
    await waitFor(() => expect(api.restoreDiscoveryCandidate).toHaveBeenCalledWith('c1'));
  });
});
