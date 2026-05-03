import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Standard pagination footer for tables.
 *
 * Left side  — "Showing 1–25 of 124" summary.
 * Right side — Previous / Next buttons with page-of-total indicator.
 *
 * Designed for server-paginated lists where the caller tracks
 * currentPage, totalItems, and itemsPerPage. No client-side page
 * math happens here beyond the range label.
 *
 * @param {object}  props
 * @param {number}  props.currentPage    1-indexed.
 * @param {number}  props.totalItems     Total result count across all pages.
 * @param {number}  props.itemsPerPage   Page size.
 * @param {Function} props.onPageChange  (nextPage) => void
 * @param {string}  [props.itemLabel]    Singular noun for the summary. Default 'item'.
 * @param {string}  [props.className]
 */
export default function TablePagination({
    currentPage,
    totalItems,
    itemsPerPage,
    onPageChange,
    itemLabel = 'item',
    className,
}) {
    const safeTotal = Math.max(0, totalItems || 0);
    const safePerPage = Math.max(1, itemsPerPage || 1);
    const totalPages = Math.max(1, Math.ceil(safeTotal / safePerPage));
    const page = Math.min(Math.max(1, currentPage || 1), totalPages);

    const rangeStart = safeTotal === 0 ? 0 : (page - 1) * safePerPage + 1;
    const rangeEnd = Math.min(page * safePerPage, safeTotal);

    const isFirst = page <= 1;
    const isLast = page >= totalPages;

    const plural = safeTotal === 1 ? itemLabel : `${itemLabel}s`;

    return (
        <nav
            aria-label="Pagination"
            className={cn(
                'flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-border',
                className,
            )}
        >
            <p className="text-xs text-muted-foreground tabular-nums">
                {safeTotal === 0 ? (
                    <>No {plural}</>
                ) : (
                    <>
                        Showing <span className="font-medium text-foreground">{rangeStart}</span>
                        –<span className="font-medium text-foreground">{rangeEnd}</span> of{' '}
                        <span className="font-medium text-foreground">{safeTotal}</span> {plural}
                    </>
                )}
            </p>

            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
                    Page {page} of {totalPages}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                    disabled={isFirst}
                    className="h-8 gap-1"
                    aria-label="Previous page"
                >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={isLast}
                    className="h-8 gap-1"
                    aria-label="Next page"
                >
                    Next
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
            </div>
        </nav>
    );
}
