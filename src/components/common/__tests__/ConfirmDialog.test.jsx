import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Confirm Action',
    description: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
  };

  it('renders title when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
  });

  it('renders description when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('renders default confirm button text "Continue"', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Continue')).toBeInTheDocument();
  });

  it('renders custom confirm button text', () => {
    render(<ConfirmDialog {...defaultProps} confirmText="Delete Now" />);
    expect(screen.getByText('Delete Now')).toBeInTheDocument();
  });

  it('renders Cancel button', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Continue'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not render dialog content when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
  });

  it('applies destructive styling when destructive is true', () => {
    render(<ConfirmDialog {...defaultProps} destructive={true} />);
    const confirmBtn = screen.getByText('Continue');
    expect(confirmBtn.className).toContain('destructive');
  });

  it('does not apply destructive styling when destructive is false', () => {
    render(<ConfirmDialog {...defaultProps} destructive={false} />);
    const confirmBtn = screen.getByText('Continue');
    expect(confirmBtn.className).not.toContain('destructive');
  });
});
