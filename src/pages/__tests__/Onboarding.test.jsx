import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock authStore
const mockRefreshUser = vi.fn();
vi.mock('@/stores/authStore', () => ({
 useAuthStore: (selector) => {
 if (typeof selector === 'function') {
 return selector({ refreshUser: mockRefreshUser });
 }
 return { refreshUser: mockRefreshUser };
 },
}));

// Mock API client
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

// Mock sub-components
vi.mock('@/components/onboarding/StepProfile', () => ({
 default: ({ role, changeRole, firstName, setFirstName, lastName, setLastName, saveBasic, loading }) => (
 <div data-testid="step-profile" style={{ minWidth: '100%', flexShrink: 0 }}>
 <button data-testid="role-driver" onClick={() => changeRole('driver_partner')}>
 Driver
 </button>
 <button data-testid="role-agent" onClick={() => changeRole('agent')}>
 Agent
 </button>
 <button data-testid="role-fleet" onClick={() => changeRole('fleet_owner')}>
 Fleet Owner
 </button>
 <input data-testid="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
 <input data-testid="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
 <div data-testid="current-role">{role || 'none'}</div>
 <button data-testid="save-basic" onClick={saveBasic} disabled={loading}>
 Next
 </button>
 </div>
 ),
}));

vi.mock('@/components/onboarding/StepPayout', () => ({
 default: ({ back, savePayout, loading }) => (
 <div data-testid="step-payout" style={{ minWidth: '100%', flexShrink: 0 }}>
 <button data-testid="payout-back" onClick={back}>
 Back
 </button>
 <button data-testid="save-payout" onClick={savePayout} disabled={loading}>
 Next
 </button>
 </div>
 ),
}));

vi.mock('@/components/onboarding/StepFinal', () => ({
 default: ({ role, back, navigate: _navigate }) => (
 <div data-testid="step-final" style={{ minWidth: '100%', flexShrink: 0 }}>
 <div data-testid="final-role">{role}</div>
 <button data-testid="final-back" onClick={back}>
 Back
 </button>
 </div>
 ),
}));

import Onboarding from '../Onboarding';

const mockUser = { id: 'u-1', firstName: 'Test', lastName: 'User', role: null };

function renderPage() {
 mockRefreshUser.mockResolvedValue(mockUser);
 return render(
 <MemoryRouter initialEntries={['/Onboarding']}>
 <Routes>
 <Route path="/Onboarding" element={<Onboarding />} />
 <Route path="/PendingApproval" element={<div>Pending Approval Page</div>} />
 <Route path="/" element={<div>Home</div>} />
 </Routes>
 </MemoryRouter>
 );
}

describe('Onboarding', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('shows loading state before user is fetched', () => {
 mockRefreshUser.mockReturnValue(new Promise(() => {})); // never resolves
 renderPage();
 expect(screen.getByText('Loading...')).toBeInTheDocument();
 });

 it('renders step profile after user loads', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });
 });

 it('renders step indicators (Profile, Payout, Done)', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Profile')).toBeInTheDocument();
 expect(screen.getByText('Payout')).toBeInTheDocument();
 });
 });

 it('displays step title for step 0', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Tell us about yourself')).toBeInTheDocument();
 });
 });

 it('allows selecting driver role', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByTestId('role-driver'));

 expect(screen.getByTestId('current-role')).toHaveTextContent('driver_partner');
 });

 it('allows selecting agent role', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByTestId('role-agent'));

 expect(screen.getByTestId('current-role')).toHaveTextContent('agent');
 });

 it('allows selecting fleet owner role', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByTestId('role-fleet'));

 expect(screen.getByTestId('current-role')).toHaveTextContent('fleet_owner');
 });

 it('shows Vehicle step label for driver role', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByTestId('role-driver'));

 expect(screen.getByText('Vehicle')).toBeInTheDocument();
 });

 it('shows Fleet step label for fleet owner role', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByTestId('role-fleet'));

 expect(screen.getByText('Fleet')).toBeInTheDocument();
 });

 it('shows Done step label for agent role', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('step-profile')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByTestId('role-agent'));

 expect(screen.getByText('Done')).toBeInTheDocument();
 });

 it('renders Back to Home link', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Back to Home')).toBeInTheDocument();
 });
 });

 it('calls refreshUser on mount', async () => {
 renderPage();
 await waitFor(() => {
 expect(mockRefreshUser).toHaveBeenCalled();
 });
 });
});
