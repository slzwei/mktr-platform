import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock authStore
const mockRefreshUser = vi.fn();
const mockLogout = vi.fn();
vi.mock('@/stores/authStore', () => ({
 useAuthStore: (selector) => {
 if (typeof selector === 'function') {
 return selector({ refreshUser: mockRefreshUser, logout: mockLogout });
 }
 return { refreshUser: mockRefreshUser, logout: mockLogout };
 },
}));

// Mock API client — the closed page must never call it, and the tests assert that.
vi.mock('@/api/client', () => ({
 apiClient: {
 put: vi.fn().mockResolvedValue({ success: true }),
 post: vi.fn().mockResolvedValue({ success: true }),
 },
}));

import Onboarding from '../Onboarding';
import { apiClient } from '@/api/client';

const mockUser = { id: 'u-1', firstName: 'Test', lastName: 'User', role: 'customer' };

function renderPage() {
 mockRefreshUser.mockResolvedValue(mockUser);
 return render(
 <MemoryRouter initialEntries={['/Onboarding']}>
 <Routes>
 <Route path="/Onboarding" element={<Onboarding />} />
 <Route path="/" element={<div>Home</div>} />
 </Routes>
 </MemoryRouter>
 );
}

// P0-2 (2026-07-30) closed self-serve onboarding; P2-7 deleted the wizard.
// The page is now only the invitation-only notice for role='customer' landings.
describe('Onboarding (closed — P0-2, wizard removed — P2-7)', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('shows loading state before user is fetched', () => {
 mockRefreshUser.mockReturnValue(new Promise(() => {})); // never resolves
 renderPage();
 expect(screen.getByText('Loading...')).toBeInTheDocument();
 });

 it('renders the invitation-only notice', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('onboarding-closed')).toBeInTheDocument();
 });
 expect(screen.getByText('Onboarding is invitation-only')).toBeInTheDocument();
 });

 it('makes no onboarding API calls (role endpoint no longer exists)', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('onboarding-closed')).toBeInTheDocument();
 });
 expect(apiClient.post).not.toHaveBeenCalled();
 expect(apiClient.put).not.toHaveBeenCalled();
 });

 it('offers a way back home', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Back to home')).toBeInTheDocument();
 });
 });

 it('calls refreshUser on mount', async () => {
 renderPage();
 await waitFor(() => {
 expect(mockRefreshUser).toHaveBeenCalled();
 });
 });
});
