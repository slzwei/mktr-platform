import { Loader2 } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * Standard confirmation dialog. Works in two modes:
 *
 * 1. **Controlled** (existing): pass `open` + `onOpenChange`. Useful when
 *    you need to orchestrate a delete from a parent component.
 *
 *    <ConfirmDialog
 *      open={open}
 *      onOpenChange={setOpen}
 *      title="Delete agent?"
 *      description="This can't be undone."
 *      onConfirm={handleDelete}
 *      destructive
 *    />
 *
 * 2. **Uncontrolled with trigger**: pass `trigger`. The dialog opens when
 *    the trigger is clicked. Useful for inline delete buttons inside a
 *    table row that doesn't need external state.
 *
 *    <ConfirmDialog
 *      trigger={<Button variant="destructive"><Trash2 /></Button>}
 *      title="Delete agent?"
 *      description="This can't be undone."
 *      onConfirm={handleDelete}
 *      destructive
 *      pending={deleting}
 *      pendingText="Deleting…"
 *      confirmIcon={<Trash2 className="w-4 h-4" />}
 *    />
 *
 * When `pending` is true, the confirm button shows a spinner, swaps in
 * `pendingText` if provided, and both buttons are disabled.
 *
 * @param {object} props
 * @param {boolean} [props.open]           Controlled open state.
 * @param {Function} [props.onOpenChange]  Controlled open setter.
 * @param {React.ReactNode} [props.trigger] Uncontrolled trigger element.
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} props.description
 * @param {Function} props.onConfirm
 * @param {string}  [props.confirmText="Continue"]
 * @param {boolean} [props.destructive=false]
 * @param {boolean} [props.pending=false]
 * @param {string}  [props.pendingText]
 * @param {React.ReactNode} [props.confirmIcon]
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    trigger,
    title,
    description,
    onConfirm,
    confirmText = 'Continue',
    destructive = false,
    pending = false,
    pendingText,
    confirmIcon,
}) {
    const confirmLabel = pending && pendingText ? pendingText : confirmText;

    const handleConfirm = (event) => {
        // When pending we block the underlying action — but Radix still closes
        // the AlertDialog unless we stop propagation. Calling preventDefault on
        // the click prevents the close.
        if (pending) {
            event.preventDefault();
            return;
        }
        onConfirm?.(event);
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        disabled={pending}
                        aria-busy={pending || undefined}
                        className={cn(
                            'gap-2',
                            destructive &&
                                'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                        )}
                    >
                        {pending ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                            confirmIcon
                        )}
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
