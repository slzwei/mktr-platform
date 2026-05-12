import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AttentionNeeded from '../AttentionNeeded';

describe('AttentionNeeded', () => {
 it('shows the empty-state message when there are no alerts', () => {
 render(<AttentionNeeded prospects={[]} campaigns={[]} />);
 expect(
 screen.getByText('No overdue follow-ups or stale leads. Alerts appear here when a prospect needs attention.')
 ).toBeInTheDocument();
 });

 it('shows overdue follow-ups alert', () => {
 const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
 const prospects = [
 { id: '1', nextFollowUpDate: yesterday, leadStatus: 'contacted' },
 { id: '2', nextFollowUpDate: yesterday, leadStatus: 'meeting' },
 ];
 render(<AttentionNeeded prospects={prospects} campaigns={[]} />);
 expect(screen.getByText('2 overdue follow-ups')).toBeInTheDocument();
 expect(screen.getByText('Prospects with past-due follow-up dates')).toBeInTheDocument();
 });

 it('does not count terminal-status prospects as overdue', () => {
 const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
 const prospects = [
 { id: '1', nextFollowUpDate: yesterday, leadStatus: 'close_won' },
 { id: '2', nextFollowUpDate: yesterday, leadStatus: 'lost' },
 ];
 render(<AttentionNeeded prospects={prospects} campaigns={[]} />);
 expect(
 screen.getByText('No overdue follow-ups or stale leads. Alerts appear here when a prospect needs attention.')
 ).toBeInTheDocument();
 });

 it('shows stale prospects alert for 14+ day old"new" prospects', () => {
 const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
 const prospects = [
 { id: '1', leadStatus: 'new', createdAt: twentyDaysAgo },
 ];
 render(<AttentionNeeded prospects={prospects} campaigns={[]} />);
 expect(screen.getByText('1 stale prospect')).toBeInTheDocument();
 expect(screen.getByText('New leads with no activity for 14+ days')).toBeInTheDocument();
 });

 it('shows campaign ending soon alert', () => {
 const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
 const campaigns = [
 { id: '1', name: 'Summer Sale', end_date: threeDaysFromNow },
 ];
 render(<AttentionNeeded prospects={[]} campaigns={campaigns} />);
 expect(screen.getByText('1 campaign ending soon')).toBeInTheDocument();
 expect(screen.getByText(/Summer Sale ends in 3 days/)).toBeInTheDocument();
 });
});
