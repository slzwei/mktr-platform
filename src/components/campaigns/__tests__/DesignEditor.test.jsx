import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), baseURL: 'http://localhost/api' },
}));
vi.mock('@/api/integrations', () => ({ UploadFile: vi.fn() }));

import DesignEditor from '@/components/campaigns/DesignEditor';

const campaign = { id: 'camp-1', name: 'Test Campaign', design_config: { formHeadline: 'Hi' } };

describe('DesignEditor — save failure keeps the dirty state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not clear unsaved changes or show "Saved" when onSave rejects', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'));
    render(<DesignEditor campaign={campaign} onSave={onSave} />);

    // Make an edit so the design becomes dirty.
    const headline = screen.getByPlaceholderText('e.g., Get Started Now!');
    await user.type(headline, '!');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Attempt to save — onSave rejects.
    await user.click(screen.getByRole('button', { name: /Save Design/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    // Dirty state must survive a failed save; the false "Saved" must not appear.
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('clears the dirty state and shows "Saved" when onSave resolves', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);

    const headline = screen.getByPlaceholderText('e.g., Get Started Now!');
    await user.type(headline, '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
});
