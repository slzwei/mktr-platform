import { TableCell, TableRow } from '@/components/ui/table';
import EmptyState from './EmptyState';

/**
 * Full-width empty state cell for tables. Drop-in replacement for the
 * ad-hoc "No results" TableCell blocks that were scattered across pages.
 *
 * Usage:
 *   <TableEmpty colSpan={7} icon={Users} title="No agents found" />
 *
 * @param {object} props
 * @param {number} props.colSpan                   Number of columns the cell should span.
 * @param {import('lucide-react').LucideIcon} [props.icon]
 * @param {string}  props.title                    Short heading.
 * @param {string} [props.description]             One-line supporting copy.
 * @param {React.ReactNode} [props.action]         Optional action (typically a Button).
 * @param {'default'|'compact'} [props.variant]    EmptyState variant. Defaults to 'default'.
 */
export default function TableEmpty({
    colSpan,
    icon,
    title,
    description,
    action,
    variant = 'default',
}) {
    return (
        <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="p-0">
                <EmptyState
                    icon={icon}
                    title={title}
                    description={description}
                    action={action}
                    variant={variant}
                />
            </TableCell>
        </TableRow>
    );
}
