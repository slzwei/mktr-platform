import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { Tabs } from '@/components/ui/tabs';
import LoginTab from '../LoginTab';

function renderLoginTab(props = {}) {
  const Wrapper = () => {
    const form = useForm({
      defaultValues: { email: '', password: '' },
    });
    return (
      <Tabs defaultValue="login">
        <LoginTab
          form={form}
          showPassword={props.showPassword ?? false}
          setShowPassword={props.setShowPassword ?? vi.fn()}
          loading={props.loading ?? false}
          onSubmit={props.onSubmit ?? ((e) => e.preventDefault())}
        >
          {props.children}
        </LoginTab>
      </Tabs>
    );
  };
  return render(<Wrapper />);
}

describe('LoginTab - extended', () => {
  // --- Field rendering ---
  it('renders email input with correct type', () => {
    renderLoginTab();
    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('renders password input with password type by default', () => {
    renderLoginTab({ showPassword: false });
    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('renders password input with text type when showPassword is true', () => {
    renderLoginTab({ showPassword: true });
    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute('type', 'text');
  });

  it('renders email placeholder', () => {
    renderLoginTab();
    expect(screen.getByPlaceholderText(/enter your email/i)).toBeInTheDocument();
  });

  it('renders password placeholder', () => {
    renderLoginTab();
    expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument();
  });

  // --- Button states ---
  it('enables Sign In button when not loading', () => {
    renderLoginTab({ loading: false });
    const btn = screen.getByRole('button', { name: /sign in/i });
    expect(btn).not.toBeDisabled();
  });

  it('disables Sign In button when loading', () => {
    renderLoginTab({ loading: true });
    const btn = screen.getByRole('button', { name: /signing in/i });
    expect(btn).toBeDisabled();
  });

  // --- Children slot ---
  it('renders custom children below the OR divider', () => {
    renderLoginTab({
      children: <button data-testid="custom-btn">Custom Auth</button>,
    });
    expect(screen.getByTestId('custom-btn')).toBeInTheDocument();
  });

  it('renders OR divider', () => {
    renderLoginTab();
    expect(screen.getByText('OR')).toBeInTheDocument();
  });

  // --- Form submission ---
  it('calls onSubmit handler when form is submitted', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    renderLoginTab({ onSubmit });

    const form = screen.getByRole('button', { name: /sign in/i }).closest('form');
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('accepts user input in email field', () => {
    renderLoginTab();
    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'hello@test.com' } });
    expect(emailInput).toHaveValue('hello@test.com');
  });

  it('accepts user input in password field', () => {
    renderLoginTab();
    const passwordInput = screen.getByLabelText(/password/i);
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    expect(passwordInput).toHaveValue('secret');
  });
});
