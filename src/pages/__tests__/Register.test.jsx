import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useForm } from 'react-hook-form';
import { Tabs } from '@/components/ui/tabs';
import RegisterTab from '@/components/auth/RegisterTab';

// Wrapper to provide react-hook-form context and Tabs context
function RegisterTabWrapper(props = {}) {
  const form = useForm({
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      company_name: '',
      role: 'customer',
      password: '',
      confirm_password: '',
    },
  });

  return (
    <Tabs defaultValue="register">
      <RegisterTab
        form={form}
        showPassword={false}
        setShowPassword={() => {}}
        showConfirmPassword={false}
        setShowConfirmPassword={() => {}}
        loading={false}
        onSubmit={(e) => e.preventDefault()}
        {...props}
      />
    </Tabs>
  );
}

describe('RegisterTab', () => {
  it('renders Full Name field', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
  });

  it('renders Email field', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
  });

  it('renders Phone Number field', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByLabelText(/Phone Number/i)).toBeInTheDocument();
  });

  it('renders Company Name field', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByLabelText(/Company Name/i)).toBeInTheDocument();
  });

  it('renders Account Type field', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByLabelText(/Account Type/i)).toBeInTheDocument();
  });

  it('renders Password field', () => {
    render(<RegisterTabWrapper />);
    const passwordFields = screen.getAllByLabelText(/Password/i);
    expect(passwordFields.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Confirm Password field', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByLabelText(/Confirm Password/i)).toBeInTheDocument();
  });

  it('renders Create Account button', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByText('Create Account')).toBeInTheDocument();
  });

  it('shows Creating Account text when loading', () => {
    render(<RegisterTabWrapper loading={true} />);
    expect(screen.getByText('Creating Account...')).toBeInTheDocument();
  });

  it('renders account type options', () => {
    render(<RegisterTabWrapper />);
    const select = screen.getByLabelText(/Account Type/i);
    expect(select).toBeInTheDocument();
    // Options include Customer, Sales Agent, Fleet Owner
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('Sales Agent')).toBeInTheDocument();
    expect(screen.getByText('Fleet Owner')).toBeInTheDocument();
  });

  it('renders password visibility toggle buttons', () => {
    render(<RegisterTabWrapper />);
    const toggleButtons = screen.getAllByRole('button', { name: '' });
    // At least 2 toggle buttons (password + confirm password)
    expect(toggleButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Full Name placeholder', () => {
    render(<RegisterTabWrapper />);
    expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
  });
});
