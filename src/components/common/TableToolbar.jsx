import { cn } from '@/lib/utils';

/**
 * Consistent toolbar above a table. Two slots:
 *   - leading  — search input, filter selects, result count
 *   - trailing — primary/secondary actions (Invite, New, Export, etc.)
 *
 * Both slots take arbitrary children. The wrapper handles responsive
 * collapse (column on mobile, row on sm+), consistent spacing, and
 * bottom margin before the table.
 *
 * Usage:
 *   <TableToolbar
 *     leading={<SearchBox />}
 *     trailing={<Button>Invite agent</Button>}
 *   />
 *
 * Or pass children for bespoke layouts.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.leading]
 * @param {React.ReactNode} [props.trailing]
 * @param {React.ReactNode} [props.children]   If provided, overrides leading/trailing slots.
 * @param {string}          [props.className]
 */
export default function TableToolbar({ leading, trailing, children, className }) {
    const base = cn(
        'flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4',
        className,
    );

    if (children) {
        return <div className={base}>{children}</div>;
    }

    return (
        <div className={base}>
            {leading && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
                    {leading}
                </div>
            )}
            {trailing && (
                <div className="flex items-center gap-2 shrink-0">{trailing}</div>
            )}
        </div>
    );
}
