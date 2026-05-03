import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Inbox } from 'lucide-react';
import EmptyState from '@/components/common/EmptyState';

describe('EmptyState', () => {
    it('renders the title', () => {
        render(<EmptyState title="No prospects yet" />);
        expect(screen.getByText('No prospects yet')).toBeInTheDocument();
    });

    it('renders an optional description', () => {
        render(
            <EmptyState
                title="No prospects yet"
                description="Create your first campaign to start capturing leads."
            />,
        );
        expect(
            screen.getByText('Create your first campaign to start capturing leads.'),
        ).toBeInTheDocument();
    });

    it('renders an optional icon', () => {
        const { container } = render(<EmptyState icon={Inbox} title="Empty" />);
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('does not render an icon container when no icon is passed', () => {
        const { container } = render(<EmptyState title="Empty" />);
        expect(container.querySelector('svg')).toBeNull();
    });

    it('renders an optional action', () => {
        render(
            <EmptyState
                title="Empty"
                action={<button type="button">Create campaign</button>}
            />,
        );
        expect(screen.getByText('Create campaign')).toBeInTheDocument();
    });

    it('renders as a h3 heading in the default variant', () => {
        render(<EmptyState title="Nothing here" />);
        const heading = screen.getByRole('heading', { level: 3 });
        expect(heading).toHaveTextContent('Nothing here');
    });

    it('renders compact variant without an h3 heading', () => {
        render(<EmptyState title="Nothing here" variant="compact" />);
        expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
        expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });
});
