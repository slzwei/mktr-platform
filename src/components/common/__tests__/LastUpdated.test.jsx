import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LastUpdated from '@/components/dashboard/LastUpdated';

vi.mock('date-fns', async () => {
 const actual = await vi.importActual('date-fns');
 return {
 ...actual,
 formatDistanceToNow: () => '5 minutes',
 };
});

describe('LastUpdated', () => {
 it('renders nothing when lastUpdated is null', () => {
 const { container } = render(<LastUpdated lastUpdated={null} />);
 expect(container.innerHTML).toBe('');
 });

 it('renders nothing when lastUpdated is undefined', () => {
 const { container } = render(<LastUpdated />);
 expect(container.innerHTML).toBe('');
 });

 it('renders relative time text when lastUpdated is provided', () => {
 render(<LastUpdated lastUpdated={new Date()} onRefresh={() => {}} />);
 expect(screen.getByText(/Updated/)).toBeInTheDocument();
 });

 it('renders refresh button', () => {
 render(<LastUpdated lastUpdated={new Date()} onRefresh={() => {}} />);
 const button = screen.getByRole('button');
 expect(button).toBeInTheDocument();
 });

 it('calls onRefresh when refresh button is clicked', () => {
 const onRefresh = vi.fn();
 render(<LastUpdated lastUpdated={new Date()} onRefresh={onRefresh} />);
 fireEvent.click(screen.getByRole('button'));
 expect(onRefresh).toHaveBeenCalledOnce();
 });

 it('disables refresh button when loading is true', () => {
 render(<LastUpdated lastUpdated={new Date()} onRefresh={() => {}} loading={true} />);
 expect(screen.getByRole('button')).toBeDisabled();
 });

 it('enables refresh button when loading is false', () => {
 render(<LastUpdated lastUpdated={new Date()} onRefresh={() => {}} loading={false} />);
 expect(screen.getByRole('button')).not.toBeDisabled();
 });
});
