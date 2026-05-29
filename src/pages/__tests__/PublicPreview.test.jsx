import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

// Capture the content slots LeadCaptureLayout receives.
vi.mock('@/components/campaigns/LeadCaptureLayout', () => ({
  default: ({ wordmark, regulatoryFooter, brand, children }) => (
    <div
      data-testid="layout"
      data-wordmark={wordmark || ''}
      data-regulatory={regulatoryFooter || ''}
      data-brand={brand || ''}
    >
      {children}
    </div>
  ),
}));

// Stub the form; expose previewMode and let the test fire onSubmit.
vi.mock('@/components/campaigns/CampaignSignupForm', () => ({
  default: ({ previewMode, onSubmit }) => (
    <div data-testid="form" data-preview={String(!!previewMode)}>
      <button onClick={() => onSubmit({ name: 'X Y', email: 'x@y.com', phone: '+6591234567' })}>fire-submit</button>
    </div>
  ),
}));

vi.mock('@/components/campaigns/ShareCampaignDialog', () => ({ default: () => null }));
vi.mock('@/components/ui/TypingLoader', () => ({ default: () => <div>loading</div> }));

import PublicPreview from '@/pages/public/Preview';
import { apiClient } from '@/api/client';
import { brand } from '@/lib/brand';

const snapshot = { id: 'c1', name: 'Acme Roadshow', design_config: {} };

function renderPreview() {
  return render(
    <MemoryRouter initialEntries={['/p/test-slug']}>
      <Routes>
        <Route path="/p/:slug" element={<PublicPreview />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PublicPreview (/p/:slug)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: { snapshot } });
  });

  it('renders with the same derived content slots as the live page', async () => {
    renderPreview();
    const layout = await screen.findByTestId('layout');
    expect(layout.getAttribute('data-wordmark')).toBe('acme.sg');
    expect(layout.getAttribute('data-regulatory')).toBe(brand.defaultRegulatory);
    expect(layout.getAttribute('data-brand')).toBe(brand.defaultPoweredBy);
  });

  it('runs the form in previewMode', async () => {
    renderPreview();
    const form = await screen.findByTestId('form');
    expect(form.getAttribute('data-preview')).toBe('true');
  });

  it('never POSTs a prospect, even if the form fires onSubmit', async () => {
    const user = userEvent.setup();
    renderPreview();
    await screen.findByTestId('form');
    await user.click(screen.getByText('fire-submit'));

    await waitFor(() => {
      const prospectCall = apiClient.post.mock.calls.find((c) => c[0] === '/prospects');
      expect(prospectCall).toBeUndefined();
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
