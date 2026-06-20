import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RecentActivity from '../RecentActivity';

function renderWithRouter(ui) {
 return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// RecentActivity renders two layouts that coexist in the DOM — a mobile list
// (`md:hidden`) and a desktop table (`hidden md:block`). jsdom ignores the CSS
// that hides one, so every label is present twice and a bare getByText would
// throw "Found multiple elements". Scope queries to the desktop <table> (always
// rendered, even in the empty state) so each label resolves to one element.
describe('RecentActivity', () => {
 const table = () => within(screen.getByRole('table'));

 it('shows empty state when no prospects', () => {
 renderWithRouter(<RecentActivity prospects={[]} />);
 expect(table().getByText('No recent activity')).toBeInTheDocument();
 expect(table().getByText('View All Prospects')).toBeInTheDocument();
 });

 it('renders prospect rows with name and status', () => {
 const prospects = [
 { id: '1', name: 'Alice Johnson', status: 'new', createdAt: '2025-01-15T10:00:00Z' },
 { id: '2', name: 'Bob Smith', status: 'contacted', createdAt: '2025-01-14T09:00:00Z' },
 ];
 renderWithRouter(<RecentActivity prospects={prospects} />);
 expect(table().getByText('Alice Johnson')).toBeInTheDocument();
 expect(table().getByText('Bob Smith')).toBeInTheDocument();
 expect(table().getByText('New')).toBeInTheDocument();
 expect(table().getByText('Contacted')).toBeInTheDocument();
 });

 it('limits display to 8 prospects', () => {
 const prospects = Array.from({ length: 12 }, (_, i) => ({
 id: String(i),
 name: `Prospect ${i}`,
 status: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 }));
 renderWithRouter(<RecentActivity prospects={prospects} />);
 // Should show first 8, not Prospect 8-11
 expect(table().getByText('Prospect 0')).toBeInTheDocument();
 expect(table().getByText('Prospect 7')).toBeInTheDocument();
 expect(table().queryByText('Prospect 8')).not.toBeInTheDocument();
 });
});
