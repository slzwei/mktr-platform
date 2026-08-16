/**
 * /winners — the results board reads the hand-posted WINNERS list, while the
 * countdown and the "still open" grid read the live marketplace list. Each has
 * to degrade to an honest empty state (the route is cited in draw T&Cs).
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockWinners = vi.hoisted(() => ({ list: [] }));
const mockCampaigns = vi.hoisted(() => ({ list: [] }));

vi.mock('../redeemWinnersContent', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, get WINNERS() { return mockWinners.list; } };
});

vi.mock('@/api/marketplace', () => ({
  listMarketplaceCampaigns: () => Promise.resolve(mockCampaigns.list),
}));

const { default: RedeemWinners } = await import('../RedeemWinners');

const drawCampaign = (over = {}) => ({
  slug: over.slug || 'pottery-draw',
  name: 'Pottery draw',
  design_config: {
    name: over.title || 'Weekend pottery for two — plus the draw',
    luckyDraw: { enabled: true, closesAt: over.closesAt || '2099-08-28' },
    prize_breakdown: over.prizes ?? [{ qty: 1, name: 'Family staycation for four' }],
    category: 'family_lifestyle',
    mode: 'in_person',
  },
  ops: { partner: { name: 'Claypool Studio', verified: true }, capacity: { total: 100, remaining: 40 } },
});

const winner = (over = {}) => ({
  draw: 'Draw 04',
  prize: 'Family staycation for four',
  prizeMeta: 'Two nights, weekend stay',
  name: 'Sarah T.',
  entry: '9••• •312',
  area: 'Bedok',
  drawnOn: '20 Jul 2026',
  status: 'claimed',
  ...over,
});

const renderPage = async () => {
  const view = render(
    <MemoryRouter>
      <RedeemWinners />
    </MemoryRouter>
  );
  // let the marketplace list promise settle
  await screen.findByText('Every draw, posted in full.');
  return view;
};

afterEach(() => {
  mockWinners.list = [];
  mockCampaigns.list = [];
  vi.useRealTimers();
});

describe('RedeemWinners — results board', () => {
  it('shows the empty state, and no ledger, until a draw has closed', async () => {
    await renderPage();
    expect(await screen.findByText('No results yet')).toBeInTheDocument();
    expect(screen.queryByText('Earlier draws')).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest result/)).not.toBeInTheDocument();
  });

  it('features the newest winner and lists the rest in the ledger', async () => {
    mockWinners.list = [
      winner(),
      winner({ draw: 'Draw 03', prize: 'Robotics term programme', name: 'Marcus L.', entry: '8••• •907', drawnOn: '28 Jun 2026' }),
    ];
    await renderPage();

    expect(screen.getByText('Latest result · Draw 04')).toBeInTheDocument();
    expect(screen.getByText('Sarah T.')).toBeInTheDocument();
    expect(screen.getByText('9••• •312')).toBeInTheDocument();
    expect(screen.getByText('Drawn 20 Jul 2026')).toBeInTheDocument();

    expect(screen.getByText('Earlier draws')).toBeInTheDocument();
    expect(screen.getByText('Robotics term programme')).toBeInTheDocument();
    // ledger composes the masked identity from name + entry
    expect(screen.getByText('Marcus L. · 8••• •907')).toBeInTheDocument();
    // the featured winner is not repeated in the ledger
    expect(screen.queryByText('Sarah T. · 9••• •312')).not.toBeInTheDocument();
  });

  it('hides the ledger when only one draw has ever closed', async () => {
    mockWinners.list = [winner()];
    await renderPage();
    expect(screen.getByText('Latest result · Draw 04')).toBeInTheDocument();
    expect(screen.queryByText('Earlier draws')).not.toBeInTheDocument();
  });

  it('labels a contacted-but-unclaimed winner without claiming it is claimed', async () => {
    mockWinners.list = [winner({ status: 'pending' })];
    await renderPage();
    expect(screen.getByText('Contacted')).toBeInTheDocument();
    expect(screen.queryByText('Claimed')).not.toBeInTheDocument();
  });

  it('renders the winner photo only when one was supplied', async () => {
    mockWinners.list = [winner({ photo: '/winners/draw04.jpg', photoCaption: 'Sarah collects her stay' })];
    const { container } = await renderPage();
    expect(container.querySelector('.rw-arch img')).toHaveAttribute('src', '/winners/draw04.jpg');
    expect(screen.getByText('Sarah collects her stay')).toBeInTheDocument();
  });
});

describe('RedeemWinners — next-draw countdown', () => {
  it('counts down to the soonest-closing open draw and links to it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2099-08-25T12:00:00+08:00'));
    mockCampaigns.list = [
      drawCampaign({ slug: 'later', closesAt: '2099-09-12' }),
      drawCampaign({ slug: 'sooner', closesAt: '2099-08-28', prizes: [{ qty: 2, name: 'Robotics term' }] }),
    ];
    await renderPage();

    const timer = await screen.findByRole('timer');
    // 25 Aug 12:00 SGT → 28 Aug 23:59:59.999 SGT = 3 days, 11 hours
    expect(within(timer).getByText('03')).toBeInTheDocument();
    expect(within(timer).getByText('11')).toBeInTheDocument();

    expect(screen.getByText('2× Robotics term')).toBeInTheDocument();
    expect(screen.getByText('Entries close 28 August 2099 · 23:59 SGT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter this draw' })).toHaveAttribute('href', '/offers/sooner');
  });

  it('falls back to the listing title when a draw has no prize rows', async () => {
    mockCampaigns.list = [drawCampaign({ prizes: [] })];
    const { container } = await renderPage();
    expect(container.querySelector('.rw-next-prize')).toHaveTextContent('Weekend pottery for two — plus the draw');
  });

  it('says no draw is open rather than showing a dead countdown', async () => {
    mockCampaigns.list = [drawCampaign({ closesAt: '2020-01-01' })];
    await renderPage();
    expect(await screen.findByText('None open')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByText('No draw is open right now.')).toBeInTheDocument();
  });
});

describe('RedeemWinners — still-open grid', () => {
  it('lists only draws that can still be entered, soonest first', async () => {
    mockCampaigns.list = [
      drawCampaign({ slug: 'later', title: 'Later draw', closesAt: '2099-09-12' }),
      drawCampaign({ slug: 'sooner', title: 'Sooner draw', closesAt: '2099-08-28' }),
      drawCampaign({ slug: 'closed', title: 'Closed draw', closesAt: '2020-01-01' }),
    ];
    await renderPage();

    const cards = document.querySelectorAll('.rm-offercard');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Sooner draw');
    expect(cards[1]).toHaveTextContent('Later draw');
    expect(screen.queryByText('Closed draw')).not.toBeInTheDocument();
  });

  it('excludes non-draw offers and sold-out draws', async () => {
    const soldOut = drawCampaign({ slug: 'sold-out', title: 'Sold out draw' });
    soldOut.ops.capacity = { total: 100, remaining: 0 };
    const plainOffer = drawCampaign({ slug: 'plain', title: 'Plain offer' });
    plainOffer.design_config.luckyDraw = { enabled: false };

    mockCampaigns.list = [soldOut, plainOffer];
    await renderPage();

    expect(document.querySelectorAll('.rm-offercard')).toHaveLength(0);
    expect(screen.getByText('No draw is open right now.')).toBeInTheDocument();
  });
});

describe('RedeemWinners — multi-winner draws (Phase 3)', () => {
  const fiveWinnerDraw = {
    draw: 'Draw 05',
    prize: 'AirPods Pro 3',
    prizeMeta: 'Five winners drawn from 2,140 verified entries',
    drawnOn: '30 Sep 2026',
    winners: [
      { name: 'Sarah T.', entry: '9••• •312', area: 'Bedok', status: 'claimed' },
      { name: 'Marcus L.', entry: '8••• •907', status: 'claimed' },
      { name: 'Priya R.', entry: '9••• •620', status: 'claimed' },
      { name: 'Wei Ming C.', entry: '9••• •144', status: 'claimed' },
      { name: 'Aisha B.', entry: '8••• •455', status: 'pending' },
    ],
  };

  it('renders ONE grouped result, not five orphan cards', async () => {
    mockWinners.list = [fiveWinnerDraw];
    await renderPage();

    // One draw event, headlined by its count.
    expect(screen.getByText('Latest result · Draw 05')).toBeInTheDocument();
    expect(screen.getByText('5 winners')).toBeInTheDocument();
    // Every winner is named on that single result.
    for (const w of fiveWinnerDraw.winners) {
      expect(screen.getByText(w.name)).toBeInTheDocument();
      expect(screen.getByText(w.entry)).toBeInTheDocument();
    }
    // ...and none of them leaked into the "earlier draws" ledger.
    expect(screen.queryByText('Earlier draws')).not.toBeInTheDocument();
  });

  it('stays Contacted while ANY winner has not claimed — matching the engine', async () => {
    mockWinners.list = [fiveWinnerDraw];
    const { container } = await renderPage();
    expect(container.querySelector('.rw-tag--status')).toHaveTextContent('Contacted');
  });

  it('reads Claimed only once EVERY winner has claimed', async () => {
    mockWinners.list = [{
      ...fiveWinnerDraw,
      winners: fiveWinnerDraw.winners.map((w) => ({ ...w, status: 'claimed' })),
    }];
    const { container } = await renderPage();
    expect(container.querySelector('.rw-tag--status')).toHaveTextContent('Claimed');
  });

  it('summarises a grouped draw in the ledger by count, not by one name', async () => {
    mockWinners.list = [winner(), fiveWinnerDraw];
    await renderPage();
    expect(screen.getByText('5 winners')).toBeInTheDocument();
    // The masked identities stay on the draw's own result, not the ledger row.
    expect(screen.queryByText('Sarah T. · 9••• •312')).not.toBeInTheDocument();
  });

  it('still renders a flat single-winner row unchanged', async () => {
    mockWinners.list = [winner()];
    await renderPage();
    expect(screen.getByText('Sarah T.')).toBeInTheDocument();
    expect(screen.getByText('9••• •312')).toBeInTheDocument();
    expect(screen.getByText('Bedok')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ winners$/)).not.toBeInTheDocument();
  });

  it('labels the photo for the group rather than one winner', async () => {
    mockWinners.list = [{ ...fiveWinnerDraw, photo: '/winners/draw05.jpg' }];
    const { container } = await renderPage();
    expect(container.querySelector('.rw-arch img')).toHaveAttribute('alt', '5 winners — AirPods Pro 3');
  });
});
