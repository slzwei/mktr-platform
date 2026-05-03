import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockUser = {
 id: 'u1',
 firstName: 'John',
 lastName: 'Doe',
 email: 'john@test.com',
 phone: '91234567',
 role: 'agent',
 dateOfBirth: '1990-01-01',
};

const mockRefreshUser = vi.fn().mockResolvedValue(mockUser);

vi.mock('@/stores/authStore', () => ({
 useAuthStore: (selector) => {
 if (typeof selector === 'function') return selector({ refreshUser: mockRefreshUser, user: mockUser });
 return { refreshUser: mockRefreshUser, user: mockUser };
 },
}));

vi.mock('@/api/client', () => ({
 apiClient: {
 put: vi.fn().mockResolvedValue({ data: { success: true } }),
 post: vi.fn().mockResolvedValue({ data: { success: true } }),
 },
}));

vi.mock('sonner', () => ({
 toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/lib/customFunctions', () => ({
 sendOtp: vi.fn().mockResolvedValue({}),
 verifyOtp: vi.fn().mockResolvedValue({}),
}));

vi.mock('framer-motion', () => ({
 motion: {
 div: ({ children, ...props }) => <div {...props}>{children}</div>,
 },
}));

import AgentProfile from '../AgentProfile';

function renderPage() {
 return render(
 <MemoryRouter>
 <AgentProfile />
 </MemoryRouter>
 );
}

describe('AgentProfile', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('renders after loading user data', async () => {
 renderPage();
 await waitFor(() => {
 expect(mockRefreshUser).toHaveBeenCalled();
 });
 });

 it('renders first name field', async () => {
 renderPage();
 expect(await screen.findByLabelText(/First Name/i)).toBeInTheDocument();
 });

 it('renders last name field', async () => {
 renderPage();
 expect(await screen.findByLabelText(/Last Name/i)).toBeInTheDocument();
 });

 it('renders email field', async () => {
 renderPage();
 expect(await screen.findByLabelText(/Email/i)).toBeInTheDocument();
 });

 it('pre-fills first name from user data', async () => {
 renderPage();
 const input = await screen.findByLabelText(/First Name/i);
 expect(input.value).toBe('John');
 });

 it('pre-fills last name from user data', async () => {
 renderPage();
 const input = await screen.findByLabelText(/Last Name/i);
 expect(input.value).toBe('Doe');
 });

 it('pre-fills email from user data', async () => {
 renderPage();
 const input = await screen.findByLabelText(/Email/i);
 expect(input.value).toBe('john@test.com');
 });

 it('renders password change section', async () => {
 renderPage();
 const passwordElements = await screen.findAllByText(/Password/i);
 expect(passwordElements.length).toBeGreaterThanOrEqual(1);
 });

 it('renders save/update profile button', async () => {
 renderPage();
 const buttons = await screen.findAllByRole('button');
 expect(buttons.length).toBeGreaterThan(0);
 });

 it('calls refreshUser on mount', async () => {
 renderPage();
 await waitFor(() => {
 expect(mockRefreshUser).toHaveBeenCalledTimes(1);
 });
 });
});
