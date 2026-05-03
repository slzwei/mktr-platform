import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DashboardShell from '@/components/dashboard/DashboardShell';

describe('DashboardShell', () => {
 it('renders loading skeleton when loading is true', () => {
 const { container } = render(<DashboardShell loading={true} />);
 expect(container.querySelector('.animate-pulse')).not.toBeNull();
 });

 it('renders four loading placeholders in loading state', () => {
 const { container } = render(<DashboardShell loading={true} />);
 const placeholders = container.querySelectorAll('.h-32');
 expect(placeholders.length).toBe(4);
 });

 it('does not render children when loading', () => {
 render(<DashboardShell loading={true}><div>Content</div></DashboardShell>);
 expect(screen.queryByText('Content')).not.toBeInTheDocument();
 });

 it('renders error state with message', () => {
 render(<DashboardShell loading={false} error="Network error" />);
 expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument();
 expect(screen.getByText('Network error')).toBeInTheDocument();
 });

 it('renders Try Again button when onRetry is provided', () => {
 const onRetry = vi.fn();
 render(<DashboardShell loading={false} error="fail" onRetry={onRetry} />);
 expect(screen.getByText('Try Again')).toBeInTheDocument();
 });

 it('calls onRetry when Try Again button is clicked', () => {
 const onRetry = vi.fn();
 render(<DashboardShell loading={false} error="fail" onRetry={onRetry} />);
 fireEvent.click(screen.getByText('Try Again'));
 expect(onRetry).toHaveBeenCalledOnce();
 });

 it('does not render Try Again button when onRetry is not provided', () => {
 render(<DashboardShell loading={false} error="fail" />);
 expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
 });

 it('renders children when not loading and no error', () => {
 render(
 <DashboardShell loading={false}>
 <div>Dashboard Content</div>
 </DashboardShell>
 );
 expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
 });

 it('renders multiple children', () => {
 render(
 <DashboardShell loading={false}>
 <div>Section 1</div>
 <div>Section 2</div>
 </DashboardShell>
 );
 expect(screen.getByText('Section 1')).toBeInTheDocument();
 expect(screen.getByText('Section 2')).toBeInTheDocument();
 });

 it('does not show error elements when there is no error', () => {
 render(
 <DashboardShell loading={false}>
 <div>Content</div>
 </DashboardShell>
 );
 expect(screen.queryByText('Failed to load dashboard')).not.toBeInTheDocument();
 });

 it('prioritizes loading state over error state', () => {
 const { container } = render(
 <DashboardShell loading={true} error="Some error" />
 );
 expect(container.querySelector('.animate-pulse')).not.toBeNull();
 expect(screen.queryByText('Failed to load dashboard')).not.toBeInTheDocument();
 });
});
