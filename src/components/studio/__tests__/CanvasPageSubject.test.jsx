import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

import { apiClient } from '@/api/client';
import CanvasPageSubject from '../CanvasPageSubject';
import { upgradeDesignConfig } from '@/lib/designConfigV2';

const CAMPAIGN = { id: 'c1', name: 'FairPrice Voucher', status: 'active' };
const DOC = upgradeDesignConfig({ formHeadline: 'Get your voucher', customerHost: 'redeem' });

function renderSubject(jump) {
  // MemoryRouter mirrors the DeviceFrame wrapper (ErrorState carries a <Link>).
  return render(
    <MemoryRouter>
      <CanvasPageSubject campaign={CAMPAIGN} doc={DOC} jump={jump} />
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('CanvasPageSubject — harness-owned outcome states (LeadCapture orchestration shape)', () => {
  it('success: themed outcome card + SuccessState + the share sheet OPEN, zero shortlink fetch', () => {
    const { container } = renderSubject('success');
    expect(container.querySelector('[data-studio-outcome="success"]')).toBeTruthy();
    expect(screen.getByText("You're all set.")).toBeInTheDocument();
    // "Success + share sheet": the dialog opens immediately…
    expect(screen.getByRole('dialog', { name: 'Share campaign' })).toBeInTheDocument();
    // …and because a serverShareUrl is supplied, ShareCampaignDialog never
    // mints a shortlink (zero network in the canvas).
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(screen.getAllByText(/redeem\.sg\/LeadCapture\?campaign_id=c1/).length).toBeGreaterThan(0);
  });

  it('duplicate: Already Registered with the FROZEN countdown (no redirect timer)', () => {
    renderSubject('duplicate');
    expect(screen.getByText('Already Registered')).toBeInTheDocument();
    expect(screen.getByText('Redirecting in 5s…')).toBeInTheDocument();
    // The EXACT live fallback string (LeadCapture handleSubmit catch).
    expect(
      screen.getByText("You have already signed up for this campaign. We'll open the share options in 5 seconds.")
    ).toBeInTheDocument();
  });

  it('error: the generic production fallback copy', () => {
    renderSubject('error');
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('An error occurred. Please try again later.')).toBeInTheDocument();
  });

  it('referred: maps to the renderer referrerName badge (not a funnel fixture)', () => {
    renderSubject('referred');
    expect(screen.getByText(/Referred by Sarah Tan/)).toBeInTheDocument();
    expect(screen.getByText('Get your voucher')).toBeInTheDocument(); // resting page around it
  });

  it('default: the plain resting page through the real renderer', () => {
    const { container } = renderSubject(null);
    expect(container.querySelector('[data-campaign-page-ready="true"]')).toBeTruthy();
    expect(screen.getByText('Get your voucher')).toBeInTheDocument();
  });
});
