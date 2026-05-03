import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock dependencies
let mockProspect = null;
let mockLoading = false;
let mockQueryError = null;

vi.mock('@tanstack/react-query', async (importOriginal) => {
 const actual = await importOriginal();
 return {
 ...actual,
 useQuery: vi.fn(() => ({
 data: mockProspect,
 isLoading: mockLoading,
 error: mockQueryError,
 })),
 };
});

vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: { firstName: 'TestAgent' } }),
}));

vi.mock('@/api/entities', () => ({
 Prospect: {
 getById: vi.fn(),
 trackView: vi.fn().mockResolvedValue({}),
 },
}));

import ProspectDetailPage from '../ProspectDetailPage';

function renderPage(id = 'p-1') {
 return render(
 <MemoryRouter initialEntries={[`/prospects/${id}`]}>
 <Routes>
 <Route path="/prospects/:id" element={<ProspectDetailPage />} />
 <Route path="/MyProspects" element={<div>My Prospects List</div>} />
 </Routes>
 </MemoryRouter>
 );
}

describe('ProspectDetailPage', () => {
 beforeEach(() => {
 mockProspect = null;
 mockLoading = false;
 mockQueryError = null;
 vi.clearAllMocks();
 });

 it('shows loading spinner when data is loading', () => {
 mockLoading = true;
 renderPage();
 expect(screen.getByText('Loading prospect details...')).toBeInTheDocument();
 });

 it('renders prospect name and status', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'Jane',
 lastName: 'Doe',
 phone: '91234567',
 email: 'jane@test.com',
 leadStatus: 'Contacted',
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('Jane Doe')).toBeInTheDocument();
 expect(screen.getByText('Contacted')).toBeInTheDocument();
 });

 it('displays contact information section', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'Jane',
 lastName: 'Doe',
 phone: '91234567',
 email: 'jane@test.com',
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('Contact Information')).toBeInTheDocument();
 expect(screen.getByText('91234567')).toBeInTheDocument();
 expect(screen.getByText('jane@test.com')).toBeInTheDocument();
 });

 it('displays phone number', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 phone: '88887777',
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('88887777')).toBeInTheDocument();
 });

 it('displays email', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 email: 'test@example.com',
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('test@example.com')).toBeInTheDocument();
 });

 it('shows N/A when phone is missing', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 phone: null,
 email: null,
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 const naElements = screen.getAllByText('N/A');
 expect(naElements.length).toBeGreaterThanOrEqual(2);
 });

 it('shows default"New" status when leadStatus is not set', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 leadStatus: null,
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('New')).toBeInTheDocument();
 });

 it('displays formatted signup date', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 createdAt: '2025-03-15T14:30:00Z',
 };

 renderPage();
 // The exact format depends on locale, but the date should be present
 expect(screen.getByText(/Mar/)).toBeInTheDocument();
 });

 it('shows campaign badge when prospect has campaign', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 campaign: { name: 'Spring Promo' },
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText(/Spring Promo/)).toBeInTheDocument();
 });

 it('renders WhatsApp and Call buttons', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 phone: '91234567',
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('WhatsApp Message')).toBeInTheDocument();
 expect(screen.getByText('Call Now')).toBeInTheDocument();
 });

 it('disables action buttons when phone is missing', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 phone: null,
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 const whatsappBtn = screen.getByText('WhatsApp Message').closest('button');
 const callBtn = screen.getByText('Call Now').closest('button');
 expect(whatsappBtn).toBeDisabled();
 expect(callBtn).toBeDisabled();
 });

 it('shows error state for 403/404 errors', () => {
 mockQueryError = new Error('Request failed with status 403');
 renderPage();
 expect(screen.getByText('Access Denied')).toBeInTheDocument();
 expect(screen.getByText('You do not have permission to view this prospect.')).toBeInTheDocument();
 });

 it('shows generic error for non-403/404 errors', () => {
 mockQueryError = new Error('Server error');
 renderPage();
 expect(screen.getByText('Access Denied')).toBeInTheDocument();
 expect(screen.getByText('Failed to load prospect details. Please try again.')).toBeInTheDocument();
 });

 it('renders back button', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 const backButtons = screen.getAllByText('Back to My Prospects');
 expect(backButtons.length).toBeGreaterThanOrEqual(1);
 });

 it('shows postal code when location data exists', () => {
 mockProspect = {
 id: 'p-1',
 firstName: 'A',
 lastName: 'B',
 location: { postalCode: '123456' },
 createdAt: '2025-01-15T10:30:00Z',
 };

 renderPage();
 expect(screen.getByText('123456')).toBeInTheDocument();
 });
});
