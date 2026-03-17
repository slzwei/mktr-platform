import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../ProtectedRoute';

// Mock auth store
const mockAuthState = { user: null, token: null };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector) => {
    if (typeof selector === 'function') return selector(mockAuthState);
    return mockAuthState;
  },
}));

// Mock utils
vi.mock('@/lib/utils', () => ({
  getDefaultRouteForRole: (role) => `/${role}-dashboard`,
}));

function renderWithRouter(ui, { route = '/protected' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/protected" element={ui} />
        <Route path="/CustomerLogin" element={<div>Login Page</div>} />
        <Route path="/PendingApproval" element={<div>Pending Approval</div>} />
        <Route path="/admin-dashboard" element={<div>Admin Dashboard</div>} />
        <Route path="/agent-dashboard" element={<div>Agent Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockAuthState.user = null;
    mockAuthState.token = null;
  });

  it('redirects to login when no token', () => {
    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated with no role requirement', () => {
    mockAuthState.user = { id: 'u-1', role: 'admin', approvalStatus: 'approved' };
    mockAuthState.token = 'tok-123';

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('renders children when user has the required role', () => {
    mockAuthState.user = { id: 'u-1', role: 'admin', approvalStatus: 'approved' };
    mockAuthState.token = 'tok-123';

    renderWithRouter(
      <ProtectedRoute requiredRole="admin"><div>Admin Panel</div></ProtectedRoute>
    );
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('redirects to role dashboard when user has wrong role', () => {
    mockAuthState.user = { id: 'u-1', role: 'agent', approvalStatus: 'approved' };
    mockAuthState.token = 'tok-123';

    renderWithRouter(
      <ProtectedRoute requiredRole="admin"><div>Admin Panel</div></ProtectedRoute>
    );
    expect(screen.getByText('Agent Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });

  it('redirects to PendingApproval when user status is pending', () => {
    mockAuthState.user = { id: 'u-1', role: 'agent', approvalStatus: 'pending' };
    mockAuthState.token = 'tok-123';

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
  });

  it('redirects to PendingApproval when status is pending_approval', () => {
    mockAuthState.user = { id: 'u-1', role: 'agent', status: 'pending_approval' };
    mockAuthState.token = 'tok-123';

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
    );
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
  });
});
