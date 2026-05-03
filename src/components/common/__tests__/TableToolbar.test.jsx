import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TableToolbar from '@/components/common/TableToolbar';

describe('TableToolbar', () => {
    it('renders leading content', () => {
        render(<TableToolbar leading={<input placeholder="Search" />} />);
        expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
    });

    it('renders trailing content', () => {
        render(
            <TableToolbar
                trailing={<button type="button">New item</button>}
            />,
        );
        expect(screen.getByText('New item')).toBeInTheDocument();
    });

    it('renders both leading and trailing together', () => {
        render(
            <TableToolbar
                leading={<input placeholder="Search" />}
                trailing={<button type="button">New item</button>}
            />,
        );
        expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
        expect(screen.getByText('New item')).toBeInTheDocument();
    });

    it('renders children when provided, ignoring leading/trailing props', () => {
        render(
            <TableToolbar
                leading={<span>leading</span>}
                trailing={<span>trailing</span>}
            >
                <span>custom content</span>
            </TableToolbar>,
        );
        expect(screen.getByText('custom content')).toBeInTheDocument();
        expect(screen.queryByText('leading')).not.toBeInTheDocument();
        expect(screen.queryByText('trailing')).not.toBeInTheDocument();
    });

    it('merges custom className', () => {
        const { container } = render(
            <TableToolbar className="custom-class" leading={<span>x</span>} />,
        );
        expect(container.firstChild.className).toContain('custom-class');
    });
});
