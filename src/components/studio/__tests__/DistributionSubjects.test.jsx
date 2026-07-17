import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from '@/api/client';
import useStudioDoc from '../useStudioDoc';
import DistributionPanel from '../panels/DistributionPanel';
import CanvasDropSubject from '../CanvasDropSubject';
import CanvasMarketplaceSubject from '../CanvasMarketplaceSubject';
import { upgradeDesignConfig } from '@/lib/designConfigV2';

let latestDoc = null;

function PanelHarness({ v1, campaign: campaignOver = {}, panelProps = {} }) {
  const campaign = { id: 'c1', name: 'FairPrice Voucher', slug: 'fairprice', ...campaignOver, design_config: v1 };
  const s = useStudioDoc(campaign);
  latestDoc = s.doc;
  if (!s.doc) return null;
  return (
    <DistributionPanel
      doc={s.doc}
      setPath={s.setPath}
      mut={s.mut}
      campaign={campaign}
      marketplacePreview={null}
      slugDraft={null}
      onSlugDraftChange={() => {}}
      onSlugSave={() => {}}
      slugSaving={false}
      slugError={null}
      {...panelProps}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  latestDoc = null;
});

describe('DistributionPanel', () => {
  it('host toggle writes distribution.host (the customerHost mirror is derived server-side)', async () => {
    const user = userEvent.setup();
    render(<PanelHarness v1={{ customerHost: 'redeem' }} />);
    await user.click(screen.getByRole('button', { name: 'mktr.sg' }));
    expect(latestDoc.distribution.host).toBe('mktr');
  });

  it('featured-drop fields land under distribution.featuredDrop', async () => {
    const user = userEvent.setup();
    render(<PanelHarness v1={{ featuredDrop: { enabled: true, title: 'Old' } }} />);
    const title = screen.getByLabelText('Drop title');
    await user.clear(title);
    await user.type(title, '$10 FairPrice');
    expect(latestDoc.distribution.featuredDrop).toMatchObject({ enabled: true, title: '$10 FairPrice' });
  });

  it('marketplace edits write v2 keys; inclusions cap at 8 lines', async () => {
    const user = userEvent.setup();
    render(<PanelHarness v1={{}} />);
    await user.click(screen.getByRole('switch', { name: /List on the marketplace/ }));
    expect(latestDoc.distribution.marketplace.listed).toBe(true);
    const inclusions = screen.getByLabelText('Inclusions (one per line, max 8)');
    await user.click(inclusions);
    await user.paste('a\nb\nc\nd\ne\nf\ng\nh\ni\nj');
    expect(latestDoc.distribution.marketplace.inclusions).toHaveLength(8);
  });

  it('renders the SERVER gate checklist verbatim (7 keys incl. opsResolvable)', () => {
    const gate = { listed: false, slug: true, active: false, marketplaceListed: true, redeemHost: true, supportedType: true, opsResolvable: false };
    render(<PanelHarness v1={{}} panelProps={{ marketplacePreview: { gate } }} />);
    const list = screen.getByTestId('dist-gate-checklist');
    expect(list.textContent).toContain('Live ops activation');
    expect(list.textContent).toContain('Hosted on redeem.sg');
    expect(list.querySelectorAll('div').length).toBe(7);
  });

  it('slug: lock message when activated-with-slug; availability check fires when drafting', async () => {
    render(<PanelHarness v1={{}} campaign={{ firstActivatedAt: '2026-01-01', slug: 'locked-slug' }} />);
    expect(screen.getByText(/permanently locked/)).toBeInTheDocument();
    expect(screen.getByLabelText(/redeem\.sg\/offers/)).toBeDisabled();
  });

  it('there is NO marketplace endsAt input (the clamp drops the key — it cannot persist)', () => {
    render(<PanelHarness v1={{}} />);
    expect(screen.queryByLabelText(/end date/i)).not.toBeInTheDocument();
    expect(screen.getByText(/expiry comes from the live activation window/)).toBeInTheDocument();
  });
});

describe('Canvas subjects', () => {
  it('drop subject: representative tile from the unsaved drop config, off-state when disabled', () => {
    const doc = upgradeDesignConfig({ featuredDrop: { enabled: true, title: 'FairPrice $10', valueLabel: '$10', emoji: '🧧', cap: 50 } });
    render(<CanvasDropSubject doc={doc} />);
    expect(screen.getByText('FairPrice $10')).toBeInTheDocument();
    expect(screen.getByText(/capped at 50/)).toBeInTheDocument();
    expect(screen.getByText(/representative of the redeem\.sg homepage tile/)).toBeInTheDocument();

    const off = upgradeDesignConfig({});
    render(<CanvasDropSubject doc={off} />);
    expect(screen.getByText(/Featured drop is off/)).toBeInTheDocument();
  });

  it('marketplace subject: the REAL OfferCard fed unsaved content + server ops, with the mismatch warning', () => {
    const doc = upgradeDesignConfig({
      name: 'FairPrice Voucher Listing',
      category: 'dining',
      mode: 'physical',
      value_line: '$10 off groceries',
    });
    doc.luckyDraw = { enabled: true, closesAt: '2026-10-30' };
    const preview = {
      slug: 'fairprice',
      design_config: {},
      // Real record shape (PR 5): an ISO cutoff INSTANT for a DIFFERENT day.
      ops: { partner: { locations: [] }, draw: { closesAt: '2026-11-05T16:00:00.000Z' } },
      gate: { slug: true, active: true },
    };
    render(
      <MemoryRouter>
        <CanvasMarketplaceSubject campaign={{ id: 'c1', name: 'FairPrice Voucher', slug: 'fairprice' }} doc={doc} preview={preview} previewStatus="success" />
      </MemoryRouter>
    );
    expect(screen.getByTestId('marketplace-subject')).toBeInTheDocument();
    expect(screen.getByText(/FairPrice Voucher Listing/)).toBeInTheDocument(); // unsaved title on the REAL card
    const banner = screen.getByText(/disagrees with the live draw record/);
    expect(banner.textContent).toContain('2026-11-05'); // record shown as its SGT day, not raw ISO
    expect(banner.textContent).not.toContain('T16:00');
    expect(screen.getByTestId('marketplace-gates')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('marketplace subject: NO mismatch banner when the record instant is the SAME SGT day (PR 5 misfire fix)', () => {
    const doc = upgradeDesignConfig({ name: 'X', category: 'dining', mode: 'physical' });
    doc.luckyDraw = { enabled: true, closesAt: '2026-10-30' };
    const preview = {
      slug: 'x',
      design_config: {},
      // 2026-10-30 SGT ends exactly at 2026-10-30T16:00:00.000Z — agreement.
      ops: { partner: { locations: [] }, draw: { closesAt: '2026-10-30T16:00:00.000Z' } },
      gate: { slug: true, active: true },
    };
    render(
      <MemoryRouter>
        <CanvasMarketplaceSubject campaign={{ id: 'c1', name: 'X', slug: 'x' }} doc={doc} preview={preview} previewStatus="success" />
      </MemoryRouter>
    );
    expect(screen.queryByText(/disagrees with the live draw record/)).toBeNull();
  });
});
