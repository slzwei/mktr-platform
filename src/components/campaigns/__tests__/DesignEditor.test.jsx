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

describe('DesignEditor — SG/PR only toggle persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the SG/PR only toggle, off by default', () => {
    render(<DesignEditor campaign={campaign} onSave={vi.fn()} />);
    expect(screen.getByText('SG / PR only')).toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('persists sgPrOnly:false when the toggle is left off', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);
    // Dirty the design without touching the toggle.
    await user.type(screen.getByPlaceholderText('e.g., Get Started Now!'), '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sgPrOnly: false });
  });

  it('persists sgPrOnly:true after switching it on', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);
    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sgPrOnly: true });
  });

  it('initializes the toggle ON for a campaign with sgPrOnly:true and preserves it on save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const gated = { id: 'camp-2', name: 'Gated', design_config: { formHeadline: 'Hi', sgPrOnly: true } };
    render(<DesignEditor campaign={gated} onSave={onSave} />);
    expect(screen.getByRole('switch')).toBeChecked();
    await user.type(screen.getByPlaceholderText('e.g., Get Started Now!'), '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sgPrOnly: true });
  });
});
