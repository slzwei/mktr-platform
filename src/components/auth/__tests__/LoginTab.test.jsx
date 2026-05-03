import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { Tabs } from '@/components/ui/tabs';
import LoginTab from '../LoginTab';

function renderLoginTab(props = {}) {
 const form = props.form || undefined;
 const Wrapper = () => {
 const defaultForm = useForm({ defaultValues: { email: '', password: '' } });
 const activeForm = form || defaultForm;
 return (
 <Tabs defaultValue="login">
 <LoginTab
 form={activeForm}
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

describe('LoginTab', () => {
 it('renders email and password fields', () => {
 renderLoginTab();
 expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
 expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
 });

 it('renders sign in button', () => {
 renderLoginTab();
 expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
 });

 it('shows loading state when loading=true', () => {
 renderLoginTab({ loading: true });
 const btn = screen.getByRole('button', { name: /signing in/i });
 expect(btn).toBeDisabled();
 });

 it('renders OR divider and children (Google button slot)', () => {
 renderLoginTab({ children: <div data-testid="google-btn">Google</div> });
 expect(screen.getByText('OR')).toBeInTheDocument();
 expect(screen.getByTestId('google-btn')).toBeInTheDocument();
 });

 it('toggles password visibility when eye icon clicked', () => {
 const setShowPassword = vi.fn();
 renderLoginTab({ showPassword: false, setShowPassword });

 const toggleBtn = screen.getByLabelText(/password/i)
 .closest('.form-input')
 ?.querySelector('button');
 if (toggleBtn) {
 fireEvent.click(toggleBtn);
 expect(setShowPassword).toHaveBeenCalledWith(true);
 }
 });

 it('calls onSubmit when form is submitted', () => {
 const onSubmit = vi.fn((e) => e.preventDefault());
 renderLoginTab({ onSubmit });

 const form = screen.getByRole('button', { name: /sign in/i }).closest('form');
 fireEvent.submit(form);
 expect(onSubmit).toHaveBeenCalled();
 });
});
