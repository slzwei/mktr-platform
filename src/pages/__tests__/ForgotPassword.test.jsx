import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', () => ({
 apiClient: {
 post: vi.fn().mockResolvedValue({ success: true }),
 },
}));

import ForgotPassword from '../ForgotPassword';
import { apiClient } from '@/api/client';

function renderPage() {
 return render(
 <MemoryRouter>
 <ForgotPassword />
 </MemoryRouter>
 );
}

describe('ForgotPassword', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('renders the heading', () => {
 renderPage();
 expect(screen.getByText('Forgot password')).toBeInTheDocument();
 });

 it('renders description text', () => {
 renderPage();
 expect(screen.getByText(/Enter your email to receive a reset link/)).toBeInTheDocument();
 });

 it('renders email input', () => {
 renderPage();
 expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
 });

 it('renders submit button', () => {
 renderPage();
 expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
 });

 it('renders Back to Login link', () => {
 renderPage();
 expect(screen.getByText('Back to Login')).toBeInTheDocument();
 });

 it('shows error when submitting empty email', async () => {
 renderPage();
 const form = screen.getByRole('button', { name: /send reset link/i }).closest('form');
 fireEvent.submit(form);

 await waitFor(() => {
 expect(screen.getByText('Please enter your email')).toBeInTheDocument();
 });
 });

 it('calls API on valid email submission', async () => {
 renderPage();
 fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
 const form = screen.getByRole('button', { name: /send reset link/i }).closest('form');
 fireEvent.submit(form);

 await waitFor(() => {
 expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'test@test.com' });
 });
 });

 it('shows success message after submission', async () => {
 renderPage();
 fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
 const form = screen.getByRole('button', { name: /send reset link/i }).closest('form');
 fireEvent.submit(form);

 await waitFor(() => {
 expect(screen.getByText(/a reset link has been sent/)).toBeInTheDocument();
 });
 });

 it('shows success message even on API error (no information leak)', async () => {
 apiClient.post.mockRejectedValueOnce(new Error('Server error'));
 renderPage();
 fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
 const form = screen.getByRole('button', { name: /send reset link/i }).closest('form');
 fireEvent.submit(form);

 await waitFor(() => {
 expect(screen.getByText(/a reset link has been sent/)).toBeInTheDocument();
 });
 });

 it('updates email input value', () => {
 renderPage();
 const input = screen.getByLabelText(/Email/i);
 fireEvent.change(input, { target: { value: 'new@email.com' } });
 expect(input.value).toBe('new@email.com');
 });
});
