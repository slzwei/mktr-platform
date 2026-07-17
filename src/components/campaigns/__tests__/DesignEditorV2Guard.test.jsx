import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));
vi.mock('@/api/integrations', () => ({ UploadFile: vi.fn() }));

import DesignEditor from '../DesignEditor';

const V1_CAMPAIGN = {
  id: 'c1',
  name: 'FairPrice Voucher',
  type: 'lead_generation',
  design_config: { formHeadline: 'Hello' },
};
const V2_CAMPAIGN = {
  ...V1_CAMPAIGN,
  design_config: { version: 2, template: { id: 'editorial', params: {} }, content: {}, form: {}, distribution: { host: 'redeem' } },
};

function renderEditor(campaign, onSave = vi.fn()) {
  return render(
    <MemoryRouter>
      <DesignEditor campaign={campaign} onSave={onSave} />
    </MemoryRouter>
  );
}

describe('DesignEditor — v2 guard (Studio PR 3 cutover)', () => {
  it('a version:2 doc renders the read-only "open in Studio" notice INSTEAD of the classic panels', () => {
    renderEditor(V2_CAMPAIGN);
    expect(screen.getByTestId('studio-v2-notice')).toBeInTheDocument();
    expect(screen.getByText('This design was saved by Campaign Studio')).toBeInTheDocument();
    // None of the classic panels mount (they would destroy the v2 doc on save).
    expect(screen.queryByRole('button', { name: /Save Design/ })).not.toBeInTheDocument();
    // Teardown PR: the Studio is permanent — the notice always links to it.
    expect(screen.getByRole('link', { name: /Open Campaign Studio/ })).toBeInTheDocument();
  });

  it('v1 docs keep the classic editor exactly as before', () => {
    renderEditor(V1_CAMPAIGN);
    expect(screen.getByRole('button', { name: /Save Design/ })).toBeInTheDocument();
    expect(screen.queryByTestId('studio-v2-notice')).not.toBeInTheDocument();
  });
});

describe('DesignEditor — save failures are no longer swallowed', () => {
  it('a 409 DESIGN_CONFIG_VERSION_CONFLICT swaps the editor for the Studio notice', async () => {
    const user = userEvent.setup();
    const err = new Error("This campaign's design was saved by Campaign Studio…");
    err.status = 409;
    err.data = { code: 'DESIGN_CONFIG_VERSION_CONFLICT' };
    const onSave = vi.fn().mockRejectedValue(err);
    renderEditor(V1_CAMPAIGN, onSave);
    // dirty it, then save
    const headline = await screen.findByLabelText(/Form Headline/i);
    await user.type(headline, '!');
    await user.click(screen.getByRole('button', { name: /Save Design/ }));
    await waitFor(() => expect(screen.getByTestId('studio-v2-notice')).toBeInTheDocument());
  });

  it('a generic failure renders inline in the save bar (no silent dead-end) and keeps the dirty state', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Network exploded'));
    renderEditor(V1_CAMPAIGN, onSave);
    const headline = await screen.findByLabelText(/Form Headline/i);
    await user.type(headline, '!');
    await user.click(screen.getByRole('button', { name: /Save Design/ }));
    await waitFor(() => expect(screen.getByTestId('design-save-error')).toHaveTextContent('Network exploded'));
    // A later save attempt clears the error banner first
    onSave.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: /Save Design/ }));
    await waitFor(() => expect(screen.queryByTestId('design-save-error')).not.toBeInTheDocument());
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
