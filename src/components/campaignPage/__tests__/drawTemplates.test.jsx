/**
 * The five draw-focused templates (drawTemplates.jsx) — open/success/closed
 * states, draw-chrome conditionality, and the pure helpers. Uses the REAL
 * migration over the shared v1 fixtures, exactly like CampaignPageRenderer's
 * own suite.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), baseURL: 'http://localhost/api' },
}));

import CampaignPageRenderer from '../CampaignPageRenderer';
import {
  DRAW_TEMPLATE_IDS,
  DrawSuccessPage,
  formatDrawDateFull,
  drawDaysLeft,
  maskSgPhone,
} from '../drawTemplates';
import { upgradeDesignConfig, TEMPLATE_IDS } from '@/lib/designConfigV2';
import { editorialBaseline, adminRichDoc } from '../../../../test-fixtures/designConfigV1Docs.mjs';

const drawCampaign = (templateId, params = {}, docOver = {}) => {
  const doc = upgradeDesignConfig(adminRichDoc);
  doc.template = { ...doc.template, id: templateId };
  if (Object.keys(params).length) {
    doc.template.params = {
      ...doc.template.params,
      [templateId]: { ...doc.template.params[templateId], ...params },
    };
  }
  Object.assign(doc, docOver);
  return { id: 'camp-1', name: 'Tokyo Getaway Lucky Draw', is_active: true, design_config: doc };
};

const plainCampaign = (templateId) => {
  const doc = upgradeDesignConfig(editorialBaseline);
  doc.template = { ...doc.template, id: templateId };
  return { id: 'camp-2', name: 'Plain Campaign', is_active: true, design_config: doc };
};

/** jsdom defaults to 1024 (desktop branch); mobile-specific assertions set 390. */
const setViewport = (w) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => setViewport(1024));

describe('registry', () => {
  it('the five draw ids are registered in TEMPLATE_IDS (twin contract)', () => {
    for (const id of DRAW_TEMPLATE_IDS) expect(TEMPLATE_IDS).toContain(id);
  });
});

describe('open states', () => {
  it.each(DRAW_TEMPLATE_IDS)('%s renders headline + draw chrome + funnel through the renderer', (id) => {
    render(<CampaignPageRenderer campaign={drawCampaign(id)} previewMode onSubmit={vi.fn()} />);
    expect(document.querySelector(`[data-campaign-page-template="${id}"]`)).toBeTruthy();
    // Headline from the doc renders somewhere in the page chrome.
    expect(screen.getAllByText('Win a 4D3N Tokyo getaway for two').length).toBeGreaterThanOrEqual(1);
    // Draw chrome: the anti-scam brand line is draw-only.
    expect(screen.getAllByText(/never ask for payment to release a prize/).length).toBeGreaterThanOrEqual(1);
    // The reused production funnel mounts (adminRichDoc has no SG/PR gate, so
    // the form's phone field renders directly).
    expect(screen.getAllByPlaceholderText('9123 4567').length).toBeGreaterThanOrEqual(1);
  });

  it('postcard shows the prize chip and the full close date', () => {
    render(<CampaignPageRenderer campaign={drawCampaign('postcard')} previewMode onSubmit={vi.fn()} />);
    expect(screen.getByText('4D3N Tokyo getaway for two')).toBeInTheDocument(); // prize chip
    expect(screen.getByText('CLOSES 30 AUG 2026')).toBeInTheDocument();
  });

  it('gazette renders the fact table with prize, close, and boost rows', () => {
    render(<CampaignPageRenderer campaign={drawCampaign('gazette')} previewMode onSubmit={vi.fn()} />);
    expect(screen.getByText('PRIZE')).toBeInTheDocument();
    expect(screen.getByText('30 Aug 2026 · 23:59 SGT')).toBeInTheDocument();
    expect(screen.getByText(/×10 when a consultant meets you/)).toBeInTheDocument();
    expect(screen.getByText('SER. TGL-2026')).toBeInTheDocument(); // campaign-name initials + closes year
  });

  it('nightfall (mobile) opens the form sheet from the CTA — funnel mounted throughout', async () => {
    setViewport(390);
    const user = userEvent.setup();
    render(<CampaignPageRenderer campaign={drawCampaign('nightfall')} previewMode onSubmit={vi.fn()} />);
    // Funnel is mounted (hidden inside the closed sheet) so form state survives.
    expect(screen.getAllByPlaceholderText('9123 4567').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Close entry form' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit Now' }));
    expect(screen.getByRole('button', { name: 'Close entry form' })).toBeInTheDocument();
  });

  it('stub renders the ticket stub line with serial, and hides the serial via param', () => {
    const { unmount } = render(<CampaignPageRenderer campaign={drawCampaign('stub')} previewMode onSubmit={vi.fn()} />);
    expect(screen.getByText('ADMIT 1 ENTRY')).toBeInTheDocument();
    expect(screen.getByText('NO. 0000001')).toBeInTheDocument();
    unmount();
    render(<CampaignPageRenderer campaign={drawCampaign('stub', { showSerial: false })} previewMode onSubmit={vi.fn()} />);
    expect(screen.queryByText('NO. 0000001')).not.toBeInTheDocument();
  });

  it('checklist (mobile) renders the ×10 step in the spine, or as a footnote via param', () => {
    setViewport(390);
    const { unmount } = render(<CampaignPageRenderer campaign={drawCampaign('checklist')} previewMode onSubmit={vi.fn()} />);
    expect(screen.getByText('Verify with an SMS code')).toBeInTheDocument();
    expect(screen.getByText('Bonus: make it ×10')).toBeInTheDocument();
    unmount();
    render(<CampaignPageRenderer campaign={drawCampaign('checklist', { boostStep: 'footnote' })} previewMode onSubmit={vi.fn()} />);
    expect(screen.queryByText('Bonus: make it ×10')).not.toBeInTheDocument();
    expect(screen.getByText('Bonus ×10:')).toBeInTheDocument();
  });

  it('a non-draw campaign on a draw template renders clean (no draw chrome)', () => {
    render(<CampaignPageRenderer campaign={plainCampaign('postcard')} previewMode onSubmit={vi.fn()} />);
    expect(document.querySelector('[data-campaign-page-template="postcard"]')).toBeTruthy();
    expect(screen.queryByText(/LUCKY DRAW/)).not.toBeInTheDocument();
    expect(screen.queryByText(/never ask for payment/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SMS-VERIFIED/)).not.toBeInTheDocument();
  });
});

describe('winner-count copy (structured multi-prize)', () => {
  const withWinners = (id, winners) => {
    const campaign = drawCampaign(id);
    campaign.design_config.luckyDraw = { ...campaign.design_config.luckyDraw, winners };
    return campaign;
  };

  it.each(DRAW_TEMPLATE_IDS)('%s open state never claims "One winner" when 4 winners are configured', (id) => {
    render(<CampaignPageRenderer campaign={withWinners(id, 4)} previewMode onSubmit={vi.fn()} />);
    expect(document.body.textContent).not.toContain('One winner');
  });

  it.each(DRAW_TEMPLATE_IDS)('%s open state never prints "1 winners" for the default single-winner fixture', (id) => {
    render(<CampaignPageRenderer campaign={drawCampaign(id)} previewMode onSubmit={vi.fn()} />);
    expect(document.body.textContent).not.toContain('1 winners');
  });

  it('postcard mobile fact list (factStyle: list) speaks in the configured count', () => {
    setViewport(390); // belowCard (the facts) renders on the mobile branch only
    const campaign = drawCampaign('postcard', { factStyle: 'list' });
    campaign.design_config.luckyDraw = { ...campaign.design_config.luckyDraw, winners: 4 };
    render(<CampaignPageRenderer campaign={campaign} previewMode onSubmit={vi.fn()} />);
    expect(document.body.textContent).toContain('4 winners, drawn in a witnessed process.');
  });

  it('checklist names the count after the close date', () => {
    render(<CampaignPageRenderer campaign={withWinners('checklist', 4)} previewMode onSubmit={vi.fn()} />);
    expect(document.body.textContent).toContain('4 winners drawn after');
  });

  it('the closed page pluralizes its being-drawn line (and keeps the singular verbatim for one winner)', () => {
    const multi = withWinners('postcard', 4);
    multi.design_config.luckyDraw.closesAt = '2020-01-01';
    const { unmount } = render(<CampaignPageRenderer campaign={multi} previewMode onSubmit={vi.fn()} />);
    expect(document.body.textContent).toContain('The 4 winners are being drawn in a witnessed process');
    unmount();
    const single = withWinners('postcard', 1);
    single.design_config.luckyDraw.closesAt = '2020-01-01';
    render(<CampaignPageRenderer campaign={single} previewMode onSubmit={vi.fn()} />);
    expect(document.body.textContent).toContain('The winner is being drawn in a witnessed process');
  });
});

describe('closed state', () => {
  it('draw templates get their designed closed page', () => {
    const campaign = drawCampaign('postcard');
    campaign.design_config.luckyDraw = { ...campaign.design_config.luckyDraw, closesAt: '2020-01-01' };
    render(<CampaignPageRenderer campaign={campaign} previewMode onSubmit={vi.fn()} />);
    expect(document.querySelector('[data-draw-closed="postcard"]')).toBeTruthy();
    expect(document.querySelector('[data-campaign-page-blocked="draw"]')).toBeTruthy();
    expect(screen.getByText('Entries closed.')).toBeInTheDocument();
    expect(screen.getByText('TOKYO GETAWAY LUCKY DRAW')).toBeInTheDocument(); // campaign-name kicker
    expect(screen.getByRole('link', { name: /masked results/ })).toHaveAttribute('href', 'https://redeem.sg/winners');
  });

  it('non-draw templates keep the shared BlockedPage', () => {
    const campaign = drawCampaign('editorial');
    campaign.design_config.luckyDraw = { ...campaign.design_config.luckyDraw, closesAt: '2020-01-01' };
    render(<CampaignPageRenderer campaign={campaign} previewMode onSubmit={vi.fn()} />);
    expect(screen.getByText('This draw has closed.')).toBeInTheDocument();
    expect(document.querySelector('[data-draw-closed]')).toBeFalsy();
  });

  it('jump="draw-closed" forces the designed page on a draw template', () => {
    render(<CampaignPageRenderer campaign={drawCampaign('gazette')} jump="draw-closed" previewMode onSubmit={vi.fn()} />);
    expect(document.querySelector('[data-draw-closed="gazette"]')).toBeTruthy();
  });
});

describe('DrawSuccessPage', () => {
  it('renders the postcard success with masked phone, chances, and closes line', () => {
    render(<DrawSuccessPage campaign={drawCampaign('postcard')} submittedPhone="+6591234312" />);
    expect(document.querySelector('[data-draw-success="postcard"]')).toBeTruthy();
    expect(screen.getByText("You're in.")).toBeInTheDocument();
    expect(screen.getByText(/\+65 9••• 4312/)).toBeInTheDocument();
    expect(screen.getByText('1x')).toBeInTheDocument();
    expect(screen.getByText('10x')).toBeInTheDocument();
    expect(screen.getByText('ENTRIES CLOSE 30 AUG 2026 · 23:59 SGT')).toBeInTheDocument();
    // No bookingUrl configured → no Book CTA.
    expect(screen.queryByRole('link', { name: /Book your 20-min review/ })).not.toBeInTheDocument();
  });

  it('gazette success uses the "Entered." display word', () => {
    render(<DrawSuccessPage campaign={drawCampaign('gazette')} submittedPhone={null} />);
    expect(screen.getByText('Entered.')).toBeInTheDocument();
  });

  it('renders the Book CTA when luckyDraw.bookingUrl is configured', () => {
    const campaign = drawCampaign('nightfall');
    campaign.design_config.luckyDraw = {
      ...campaign.design_config.luckyDraw,
      bookingUrl: 'https://redeem.sg/book',
    };
    render(<DrawSuccessPage campaign={campaign} submittedPhone="+6591234312" />);
    expect(screen.getByRole('link', { name: 'Book your 20-min review' })).toHaveAttribute('href', 'https://redeem.sg/book');
  });

  it('stub success renders as a ticket with the ENTRY HELD stub line', () => {
    render(<DrawSuccessPage campaign={drawCampaign('stub')} submittedPhone={null} />);
    expect(screen.getByText('ENTRY HELD · CLOSES 30 AUG 2026')).toBeInTheDocument();
  });
});

describe('close-date de-duplication + type floors (2026-07-23)', () => {
  // Every inline font size actually rendered, parsed from style attributes.
  // clamp()/unset values parse to NaN and are filtered.
  const inlineFontSizes = (root) => Array.from(root.querySelectorAll('*'))
    .map((el) => parseFloat(el.style?.fontSize))
    .filter((n) => Number.isFinite(n));

  it.each(DRAW_TEMPLATE_IDS)('%s success prints the close date exactly once — the free-session row carries no date', (id) => {
    render(<DrawSuccessPage campaign={drawCampaign(id)} submittedPhone="+6591234312" />);
    expect(document.body.textContent).toContain('FREE SESSION · NO PAYMENT EVER');
    expect(document.body.textContent).not.toContain('NO PAYMENT EVER · BEFORE');
    // One authoritative uppercase date row (ENTRIES CLOSE / ENTRY HELD); the
    // only other mention is step 2's contextual mixed-case booking deadline.
    expect(document.body.textContent.match(/30 AUG 2026/g)).toHaveLength(1);
    expect(screen.getByText(/20-minute financial review/)).toBeInTheDocument();
  });

  it.each(DRAW_TEMPLATE_IDS)('%s success keeps every font at or above the 10.5px floor', (id) => {
    const { container } = render(<DrawSuccessPage campaign={drawCampaign(id)} submittedPhone="+6591234312" />);
    const sizes = inlineFontSizes(container);
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
  });

  it.each(DRAW_TEMPLATE_IDS)('%s closed page keeps every font at or above the 10.5px floor', (id) => {
    const { container } = render(
      <CampaignPageRenderer campaign={drawCampaign(id)} jump="draw-closed" previewMode onSubmit={vi.fn()} />,
    );
    expect(document.querySelector(`[data-draw-closed="${id}"]`)).toBeTruthy();
    const sizes = inlineFontSizes(container);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
  });
});

describe('helpers', () => {
  it('formatDrawDateFull renders day month year and rejects junk', () => {
    expect(formatDrawDateFull('2026-10-30')).toBe('30 Oct 2026');
    expect(formatDrawDateFull('junk')).toBe('');
    expect(formatDrawDateFull(undefined)).toBe('');
  });

  it('drawDaysLeft counts whole SGT days and clamps at zero', () => {
    const now = new Date('2026-10-28T00:00:00+08:00').getTime();
    expect(drawDaysLeft('2026-10-30', now)).toBe(3);
    expect(drawDaysLeft('2026-10-30', new Date('2026-11-05T00:00:00+08:00').getTime())).toBe(0);
    expect(drawDaysLeft(undefined, now)).toBe(null);
  });

  it('maskSgPhone masks +65 numbers and rejects short input', () => {
    expect(maskSgPhone('+6591234312')).toBe('+65 9••• 4312');
    expect(maskSgPhone('91234312')).toBe('+65 9••• 4312');
    expect(maskSgPhone('123')).toBe(null);
    expect(maskSgPhone(null)).toBe(null);
  });
});
