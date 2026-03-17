import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete Item',
    description: 'This action cannot be undone.',
    onConfirm: vi.fn(),
  };

  it('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('does not render dialog content when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Delete Item')).not.toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    const continueBtn = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders Cancel button that triggers onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onOpenChange).toHaveBeenCalled();
  });

  it('applies destructive styling when destructive=true', () => {
    render(<ConfirmDialog {...defaultProps} destructive={true} />);

    const confirmBtn = screen.getByRole('button', { name: /continue/i });
    expect(confirmBtn.className).toMatch(/bg-destructive/);
  });

  it('does not apply destructive styling by default', () => {
    render(<ConfirmDialog {...defaultProps} />);

    const confirmBtn = screen.getByRole('button', { name: /continue/i });
    expect(confirmBtn.className).not.toMatch(/bg-destructive/);
  });

  it('shows custom confirmText', () => {
    render(<ConfirmDialog {...defaultProps} confirmText="Yes, delete" />);
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeInTheDocument();
  });

  it('defaults confirmText to "Continue"', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });
});
