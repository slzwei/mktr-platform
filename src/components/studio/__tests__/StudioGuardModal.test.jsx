import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudioGuardModal from '../StudioGuardModal';

describe('StudioGuardModal', () => {
  it('renders nothing without a guard', () => {
    const { container } = render(<StudioGuardModal guard={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('copy/share flavor: "Save first?", no Discard button', () => {
    render(<StudioGuardModal guard={{ kind: 'copy' }} onPrimary={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Save first?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & copy link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
  });

  it('switch/back flavor: "Unsaved changes" with Discard, and wires all three actions', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(
      <StudioGuardModal guard={{ kind: 'switch' }} onPrimary={onPrimary} onDiscard={onDiscard} onCancel={onCancel} />
    );
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save & continue' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the buttons while saving', () => {
    render(<StudioGuardModal guard={{ kind: 'back' }} saving onPrimary={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
  });
});
