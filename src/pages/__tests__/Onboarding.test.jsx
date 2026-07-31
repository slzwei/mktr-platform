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

// Mock validation utils
vi.mock('@/utils/validation', () => ({
 isValidSgPlate: vi.fn(() => true),
 parseSgPlate: vi.fn((v) => v),
 isValidSgMobile: vi.fn((v) => /^[3689]\d{7}$/.test(v)),
}));

// Mock helpers
vi.mock('@/components/onboarding/helpers', () => ({
 sanitizePhoneInput: vi.fn((v) => v.replace(/\D/g, '')),
 isValidNricFin: vi.fn(() => true),
 formatDateInput: vi.fn((v) => v),
 calculateAge: vi.fn(() => 30),
 parseCsvToRows: vi.fn(() => []),
 collectGridCars: vi.fn(() => []),
 findDuplicatePlates: vi.fn(() => []),
}));

// Mock OTP functions
vi.mock('@/components/lib/customFunctions', () => ({
 sendOtp: vi.fn().mockResolvedValue({ success: true }),
 verifyOtp: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock JSON data
vi.mock('@/data/mktr_make_models.json', () => ({
 default: { Toyota: ['Corolla', 'Camry'], Honda: ['Civic', 'City'] },
}));

// Mock sub-components (still imported by the page; must never render)
vi.mock('@/components/onboarding/StepProfile', () => ({
 default: () => <div data-testid="step-profile" />,
}));
vi.mock('@/components/onboarding/StepPayout', () => ({
 default: () => <div data-testid="step-payout" />,
}));
vi.mock('@/components/onboarding/StepFinal', () => ({
 default: () => <div data-testid="step-final" />,
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

// P0-2 (2026-07-30): self-serve onboarding is closed — the wizard let any
// customer promote themselves to 'agent' via POST /auth/onboarding/role
// (endpoint since removed). The page now renders an invitation-only notice.
describe('Onboarding (closed — P0-2)', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('shows loading state before user is fetched', () => {
 mockRefreshUser.mockReturnValue(new Promise(() => {})); // never resolves
 renderPage();
 expect(screen.getByText('Loading...')).toBeInTheDocument();
 });

 it('renders the invitation-only notice instead of the wizard', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('onboarding-closed')).toBeInTheDocument();
 });
 expect(screen.getByText('Onboarding is invitation-only')).toBeInTheDocument();
 });

 it('never renders any wizard step', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('onboarding-closed')).toBeInTheDocument();
 });
 expect(screen.queryByTestId('step-profile')).not.toBeInTheDocument();
 expect(screen.queryByTestId('step-payout')).not.toBeInTheDocument();
 expect(screen.queryByTestId('step-final')).not.toBeInTheDocument();
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
