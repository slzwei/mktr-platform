import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }));

import StudioCanvas from '../StudioCanvas';
import { upgradeDesignConfig } from '@/lib/designConfigV2';

const CAMPAIGN = { id: 'c1', name: 'FairPrice Voucher', status: 'active' };
const V1_DOC = { formHeadline: 'Redeem your voucher', customerHost: 'mktr', sgPrOnly: false };

function renderCanvas(docOverrides = {}) {
  const doc = { ...upgradeDesignConfig(V1_DOC), ...docOverrides };
  return { doc, ...render(<StudioCanvas campaign={CAMPAIGN} doc={doc} />) };
}

describe('StudioCanvas', () => {
  it('shows the UNSAVED host in the URL chip (the canvas previews the unsaved doc)', () => {
    renderCanvas();
    expect(screen.getByText(/mktr\.sg\/LeadCapture\?campaign_id=c1/)).toBeInTheDocument();
    expect(
      screen.getByText('preview — OTP & submit stubbed · pixels suppressed · rendering the UNSAVED document')
    ).toBeInTheDocument();
  });

  it('mounts the REAL campaign-page renderer inside the device iframe', async () => {
    const { container } = renderCanvas();
    await waitFor(() => {
      const doc = container.querySelector('iframe')?.contentDocument;
      expect(doc?.querySelector('[data-campaign-page-ready="true"]')).toBeTruthy();
    });
  });

  it('device toggle switches the frame between the true 390 and 1280 viewports', async () => {
    const user = userEvent.setup();
    const { container } = renderCanvas();
    expect(container.querySelector('iframe').style.width).toBe('390px');
    await user.click(screen.getByRole('button', { name: 'Desktop · 1280' }));
    expect(container.querySelector('iframe').style.width).toBe('1280px');
  });

  it('keeps drop/card subjects disabled until their checkpoints supply slots', () => {
    renderCanvas();
    expect(screen.getByRole('button', { name: 'Featured drop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Marketplace card' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Campaign page' })).toBeEnabled();
  });
});
