import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { UserPlus, Undo2, Trash2, FileSpreadsheet, FileText, X, Loader2 } from 'lucide-react';

/**
 * Floating bulk-action bar — slides up from the bottom of the viewport while at
 * least one row is selected. Esc clears the selection. Export buttons render only
 * when handlers are supplied (AdminProspects has exports; AdminAgentDetail doesn't).
 */
export default function BulkActionBar({
  count,
  heldCount = 0,
  busy = false,
  assignLabel = 'Assign to agent…',
  onAssign,
  onReturnToHeld,
  onDelete,
  onExportCSV,
  onExportPDF,
  onClear,
}) {
  useEffect(() => {
    if (count === 0) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClear?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [count, onClear]);

  if (count === 0) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 rounded-xl border border-border bg-card shadow-xl px-3 py-2 sm:px-4">
        <span className="text-sm font-medium text-foreground pr-1 sm:pr-2 whitespace-nowrap">
          {count} selected
          {heldCount > 0 && (
            <span className="text-muted-foreground font-normal"> · {heldCount} held</span>
          )}
        </span>

        <div className="h-5 w-px bg-border hidden sm:block" />

        <Button size="sm" className="h-8" onClick={onAssign} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1.5" />}
          {assignLabel}
        </Button>

        <Button variant="outline" size="sm" className="h-8" onClick={onReturnToHeld} disabled={busy}>
          <Undo2 className="w-4 h-4 mr-1.5" />
          Return to held
        </Button>

        {onExportCSV && (
          <Button variant="outline" size="sm" className="h-8" onClick={onExportCSV} disabled={busy}>
            <FileSpreadsheet className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
        )}
        {onExportPDF && (
          <Button variant="outline" size="sm" className="h-8" onClick={onExportPDF} disabled={busy}>
            <FileText className="w-4 h-4 mr-1.5" />
            PDF
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          Delete
        </Button>

        <div className="h-5 w-px bg-border hidden sm:block" />

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          onClick={onClear}
          disabled={busy}
          aria-label="Clear selection (Esc)"
          title="Clear selection (Esc)"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
