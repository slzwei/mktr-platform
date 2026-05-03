import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import RegisterTab from '../RegisterTab';
import { Tabs } from '@/components/ui/tabs';

function renderRegisterTab(props = {}) {
 const Wrapper = () => {
 const form = useForm({
 defaultValues: {
 full_name: '', email: '', phone: '', password: '',
 confirm_password: '', role: 'customer', company_name: '',
 },
 });
 return (
 <Tabs defaultValue="register">
 <RegisterTab
 form={form}
 showPassword={props.showPassword ?? false}
 setShowPassword={props.setShowPassword ?? vi.fn()}
 showConfirmPassword={props.showConfirmPassword ?? false}
 setShowConfirmPassword={props.setShowConfirmPassword ?? vi.fn()}
 loading={props.loading ?? false}
 onSubmit={props.onSubmit ?? ((e) => e.preventDefault())}
 />
 </Tabs>
 );
 };
 return render(<Wrapper />);
}

describe('RegisterTab', () => {
 it('renders all registration fields', () => {
 renderRegisterTab();
 expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
 expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
 expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
 expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
 expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
 expect(screen.getByLabelText(/account type/i)).toBeInTheDocument();
 });

 it('renders company name field', () => {
 renderRegisterTab();
 expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
 });

 it('renders role options: Customer, Sales Agent, Fleet Owner', () => {
 renderRegisterTab();
 const select = screen.getByLabelText(/account type/i);
 expect(select).toBeInTheDocument();
 expect(screen.getByText('Customer')).toBeInTheDocument();
 expect(screen.getByText('Sales Agent')).toBeInTheDocument();
 expect(screen.getByText('Fleet Owner')).toBeInTheDocument();
 });

 it('renders create account button', () => {
 renderRegisterTab();
 expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
 });

 it('shows loading state when loading=true', () => {
 renderRegisterTab({ loading: true });
 const btn = screen.getByRole('button', { name: /creating account/i });
 expect(btn).toBeDisabled();
 });

 it('calls onSubmit when form is submitted', () => {
 const onSubmit = vi.fn((e) => e.preventDefault());
 renderRegisterTab({ onSubmit });

 const form = screen.getByRole('button', { name: /create account/i }).closest('form');
 fireEvent.submit(form);
 expect(onSubmit).toHaveBeenCalled();
 });
});
