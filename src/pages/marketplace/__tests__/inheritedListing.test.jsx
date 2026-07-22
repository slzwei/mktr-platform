/**
 * Phase B renders of the inherited listing keys: card prizes line + neutral
 * boost wording + unified title; door description/prizes/regulatory blocks.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import OfferCard from '../OfferCard';

const drawCampaign = {
  id: 'c1',
  name: 'Internal Draw Name',
  slug: 'tokyo-draw',
  design_config: {
    name: 'Win a 4D3N Tokyo Getaway',
    imageUrl: '/uploads/tokyo.jpg',
    image_label: 'Tokyo at dusk',
    value_line: '4D3N Tokyo getaway (flights + hotel)',
    prize_breakdown: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: 'AirPods' }],
    luckyDraw: { enabled: true, closesAt: '2099-10-30', boostClosesAt: '2099-10-30', multiplier: 10 },
    category: 'family_lifestyle',
    mode: 'hybrid',
  },
  ops: { partner: { name: 'Redeem', verified: true }, capacity: { total: 500, remaining: 500 } },
};

const renderCard = (campaign) =>
  render(
    <MemoryRouter>
      <OfferCard campaign={campaign} />
    </MemoryRouter>
  );

describe('OfferCard — inherited draw listing', () => {
  it('renders the derived title, the Prizes line (never "Includes"), and neutral boost wording', () => {
    renderCard(drawCampaign);
    expect(screen.getByText('Win a 4D3N Tokyo Getaway')).toBeInTheDocument();
    expect(screen.getByText(/Prizes: iPhone 17 Pro, 3× AirPods/)).toBeInTheDocument();
    expect(screen.queryByText(/Includes:/)).not.toBeInTheDocument();
    expect(screen.getByText(/when your consultant records your completed session/)).toBeInTheDocument();
    expect(screen.queryByText(/activation step/)).not.toBeInTheDocument();
  });

  it('falls back to the campaign name when no listing title serves', () => {
    const noTitle = structuredClone(drawCampaign);
    delete noTitle.design_config.name;
    renderCard(noTitle);
    expect(screen.getByText('Internal Draw Name')).toBeInTheDocument();
  });

  it('non-draw cards keep the Includes line', () => {
    const plain = structuredClone(drawCampaign);
    delete plain.design_config.luckyDraw;
    delete plain.design_config.prize_breakdown;
    plain.design_config.inclusions = ['One night stay', 'Breakfast'];
    renderCard(plain);
    expect(screen.getByText(/Includes: One night stay, Breakfast/)).toBeInTheDocument();
  });
});

describe('studioReadiness — generic headline warning (flag on)', () => {
  it('warns when a listed campaign has no real headline', async () => {
    vi.stubEnv('VITE_MARKETPLACE_INHERIT_ENABLED', 'true');
    const { computeDesignChecks } = await import('@/components/studio/studioReadiness');
    const doc = {
      version: 2,
      content: { headline: 'Get Started', media: { kind: 'none' } },
      form: { terms: { html: '<p>t</p>' } },
      theme: {},
      distribution: { marketplace: { listed: true } },
    };
    const out = computeDesignChecks({ campaign: { type: 'lead_generation' }, doc, marketplacePreview: null });
    expect(out.some((r) => /marketplace listing title/.test(r.msg))).toBe(true);
    vi.unstubAllEnvs();
  });
});
