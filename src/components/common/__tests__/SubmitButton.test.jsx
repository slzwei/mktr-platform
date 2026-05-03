import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SubmitButton from '@/components/common/SubmitButton';

describe('SubmitButton', () => {
    it('renders the default label when not pending', () => {
        render(<SubmitButton>Save</SubmitButton>);
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('defaults to type="submit"', () => {
        render(<SubmitButton>Save</SubmitButton>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('is disabled while pending', () => {
        render(<SubmitButton pending>Save</SubmitButton>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('exposes aria-busy while pending', () => {
        render(<SubmitButton pending>Save</SubmitButton>);
        expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });

    it('swaps to pendingText while pending when provided', () => {
        render(
            <SubmitButton pending pendingText="Saving…">
                Save
            </SubmitButton>,
        );
        expect(screen.getByRole('button')).toHaveTextContent('Saving…');
        expect(screen.queryByText('Save', { exact: true })).toBeNull();
    });

    it('retains the default label while pending if no pendingText', () => {
        render(<SubmitButton pending>Save</SubmitButton>);
        expect(screen.getByRole('button')).toHaveTextContent('Save');
    });

    it('shows a spinner only while pending', () => {
        const { container, rerender } = render(<SubmitButton>Save</SubmitButton>);
        expect(container.querySelector('.animate-spin')).toBeNull();
        rerender(<SubmitButton pending>Save</SubmitButton>);
        expect(container.querySelector('.animate-spin')).not.toBeNull();
    });

    it('respects an explicit disabled prop independently of pending', () => {
        render(<SubmitButton disabled>Save</SubmitButton>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not fire onClick while pending', () => {
        const onClick = vi.fn();
        render(
            <SubmitButton pending onClick={onClick}>
                Save
            </SubmitButton>,
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).not.toHaveBeenCalled();
    });
});
