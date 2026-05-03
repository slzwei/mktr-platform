import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PageHeader from '@/components/common/PageHeader';

describe('PageHeader', () => {
    it('renders the title as an h1', () => {
        render(<PageHeader title="Prospects" />);
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent('Prospects');
    });

    it('renders an optional description', () => {
        render(<PageHeader title="Prospects" description="Manage and track your sales prospects." />);
        expect(
            screen.getByText('Manage and track your sales prospects.'),
        ).toBeInTheDocument();
    });

    it('does not render description wrapper when not provided', () => {
        const { container } = render(<PageHeader title="Prospects" />);
        expect(container.querySelectorAll('p').length).toBe(0);
    });

    it('renders actions in the right slot', () => {
        render(
            <PageHeader
                title="Prospects"
                actions={<button type="button">Export CSV</button>}
            />,
        );
        expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });

    it('allows custom className pass-through', () => {
        const { container } = render(
            <PageHeader title="Prospects" className="custom-x" />,
        );
        expect(container.firstChild.className).toContain('custom-x');
    });

    it('does not render actions region when no actions passed', () => {
        const { container } = render(<PageHeader title="Prospects" />);
        // Should only have the title wrapper + (no actions wrapper)
        expect(container.firstChild.children.length).toBe(1);
    });
});
