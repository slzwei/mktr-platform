import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import FormRow from '@/components/common/FormRow';

describe('FormRow', () => {
    it('renders the label', () => {
        render(
            <FormRow label="Full Name">
                <input type="text" />
            </FormRow>,
        );
        expect(screen.getByText('Full Name')).toBeInTheDocument();
    });

    it('shows a required asterisk when required', () => {
        render(
            <FormRow label="Full Name" required>
                <input type="text" />
            </FormRow>,
        );
        expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('does not show an asterisk when not required', () => {
        render(
            <FormRow label="Full Name">
                <input type="text" />
            </FormRow>,
        );
        expect(screen.queryByText('*')).not.toBeInTheDocument();
    });

    it('links the label to the input via htmlFor/id', () => {
        render(
            <FormRow label="Email">
                <input type="email" data-testid="the-input" />
            </FormRow>,
        );
        const input = screen.getByTestId('the-input');
        const label = screen.getByText('Email');
        expect(input.id).toBeTruthy();
        expect(label.getAttribute('for')).toBe(input.id);
    });

    it('honors an explicit htmlFor override', () => {
        render(
            <FormRow label="Phone" htmlFor="phone-field">
                <input type="tel" data-testid="the-input" />
            </FormRow>,
        );
        const label = screen.getByText('Phone');
        expect(label.getAttribute('for')).toBe('phone-field');
    });

    it('renders a description when provided and no error', () => {
        render(
            <FormRow
                label="Username"
                description="Only letters and numbers."
            >
                <input type="text" />
            </FormRow>,
        );
        expect(
            screen.getByText('Only letters and numbers.'),
        ).toBeInTheDocument();
    });

    it('renders the error message when provided', () => {
        render(
            <FormRow label="Email" error="Must be a valid email">
                <input type="email" />
            </FormRow>,
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Must be a valid email',
        );
    });

    it('hides the description while an error is present', () => {
        render(
            <FormRow
                label="Email"
                description="We never share your email."
                error="Required"
            >
                <input type="email" />
            </FormRow>,
        );
        expect(
            screen.queryByText('We never share your email.'),
        ).not.toBeInTheDocument();
        expect(screen.getByText('Required')).toBeInTheDocument();
    });

    it('sets aria-invalid and aria-describedby on the child when an error is present', () => {
        render(
            <FormRow label="Email" error="Required">
                <input type="email" data-testid="the-input" />
            </FormRow>,
        );
        const input = screen.getByTestId('the-input');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toBeTruthy();
    });
});
