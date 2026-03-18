import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, search: '', pathname: '/CustomerLogin' }),
  };
});

const mockLogin = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector) => {
    if (typeof selector === 'function') return selector({ login: mockLogin });
    return { login: mockLogin };
  },
}));

vi.mock('@/config/google', () => ({
  GOOGLE_CLIENT_ID: 'test-google-client-id',
}));

vi.mock('@/lib/utils', () => ({
  getPostAuthRedirectPath: (user) => `/${user.role}-dashboard`,
  cn: (...args) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/layout/SiteHeader', () => ({
  default: () => <div data-testid="site-header">SiteHeader</div>,
}));

import CustomerLogin from '../Login';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/CustomerLogin']}>
      <CustomerLogin />
    </MemoryRouter>
  );
}

function fillAndSubmit(email, password) {
  if (email) {
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  }
  if (password) {
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  }
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Rendering ---
  it('renders the sign-in heading', () => {
    renderLogin();
    expect(screen.getByText('Sign in to MKTR')).toBeInTheDocument();
  });

  it('renders email input field', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('renders password input field', () => {
    renderLogin();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders the Sign In submit button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders the Continue with Google button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('renders the Forgot password link', () => {
    renderLogin();
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
  });

  it('renders the Contact Us link', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /contact us to get started/i })).toBeInTheDocument();
  });

  // --- Validation ---
  it('shows error when submitting with only email (no password)', async () => {
    // The HTML required attribute will prevent totally empty submit,
    // so we test the JS-level validation by providing only one field
    mockLogin.mockResolvedValue({ success: false, message: 'Login failed' });
    renderLogin();

    // Set email but leave password empty by submitting the form directly
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    // Submit the form element directly to bypass HTML5 validation
    const form = screen.getByRole('button', { name: /sign in/i }).closest('form');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Please enter both email and password')).toBeInTheDocument();
    });
  });

  // --- Submit behavior ---
  it('calls login function on valid submit', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      data: { user: { id: '1', role: 'admin' } },
    });
    renderLogin();

    fillAndSubmit('test@example.com', 'password123');

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('navigates to role dashboard on successful login', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      data: { user: { id: '1', role: 'admin' } },
    });
    renderLogin();

    fillAndSubmit('test@example.com', 'password123');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin-dashboard');
    });
  });

  it('displays error message on failed login', async () => {
    mockLogin.mockResolvedValue({
      success: false,
      message: 'Invalid credentials',
    });
    renderLogin();

    fillAndSubmit('test@example.com', 'wrongpass');

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('shows loading state during submit', async () => {
    mockLogin.mockImplementation(() => new Promise(() => {}));
    renderLogin();

    fillAndSubmit('test@example.com', 'password123');

    await waitFor(() => {
      expect(screen.getByText('Signing In...')).toBeInTheDocument();
    });
  });

  it('displays generic error when login throws an exception', async () => {
    mockLogin.mockRejectedValue(new Error('Network error'));
    renderLogin();

    fillAndSubmit('test@example.com', 'password123');

    await waitFor(() => {
      expect(screen.getByText('Login failed. Please try again.')).toBeInTheDocument();
    });
  });
});
