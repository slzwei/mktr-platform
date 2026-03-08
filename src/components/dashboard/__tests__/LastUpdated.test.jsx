import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LastUpdated from '../LastUpdated';

describe('LastUpdated', () => {
  it('renders nothing when lastUpdated is not provided', () => {
    const { container } = render(<LastUpdated onRefresh={() => {}} loading={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders relative time text', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    render(<LastUpdated lastUpdated={fiveMinutesAgo} onRefresh={() => {}} loading={false} />);
    expect(screen.getByText(/updated.*ago/i)).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', () => {
    const onRefresh = vi.fn();
    const now = new Date();
    render(<LastUpdated lastUpdated={now} onRefresh={onRefresh} loading={false} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the button when loading is true', () => {
    render(<LastUpdated lastUpdated={new Date()} onRefresh={() => {}} loading={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
