import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Users } from 'lucide-react';
import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import TableEmpty from '@/components/common/TableEmpty';

function renderInTable(emptyProps) {
    return render(
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableEmpty {...emptyProps} />
            </TableBody>
        </Table>,
    );
}

describe('TableEmpty', () => {
    it('renders the title', () => {
        renderInTable({ colSpan: 2, title: 'No agents found' });
        expect(screen.getByText('No agents found')).toBeInTheDocument();
    });

    it('renders an optional description', () => {
        renderInTable({
            colSpan: 2,
            title: 'No agents found',
            description: 'Invite your first agent to get started.',
        });
        expect(
            screen.getByText('Invite your first agent to get started.'),
        ).toBeInTheDocument();
    });

    it('renders an optional icon', () => {
        const { container } = renderInTable({
            colSpan: 2,
            icon: Users,
            title: 'Empty',
        });
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('spans the given number of columns', () => {
        const { container } = renderInTable({ colSpan: 5, title: 'Empty' });
        const td = container.querySelector('td[colspan="5"]');
        expect(td).not.toBeNull();
    });

    it('renders an optional action', () => {
        renderInTable({
            colSpan: 2,
            title: 'Empty',
            action: <button type="button">Invite agent</button>,
        });
        expect(screen.getByText('Invite agent')).toBeInTheDocument();
    });
});
