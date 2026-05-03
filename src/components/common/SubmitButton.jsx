import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Standard submit button for form dialogs. Shows a spinner + optional swap
 * of label text when pending, and stays disabled while the request is in
 * flight.
 *
 * Replaces the scattered ternary pattern:
 *   <Button disabled={isSubmitting}>
 *     {isSubmitting ? 'Saving…' : 'Save Changes'}
 *   </Button>
 *
 * Usage:
 *   <SubmitButton pending={isSubmitting} pendingText="Inviting…">
 *     Send Invite
 *   </SubmitButton>
 *
 * When `pendingText` is omitted the original label is retained alongside
 * the spinner, which works well for concise CTAs ("Save", "Delete").
 *
 * Any Button prop can be passed through (variant, size, className, etc.).
 *
 * @param {object}  props
 * @param {boolean} [props.pending]      Whether the request is in flight.
 * @param {string}  [props.pendingText]  Optional label to show while pending.
 * @param {React.ReactNode} props.children Default label.
 * @param {boolean} [props.disabled]     Manual disabled state (combined with pending).
 */
const SubmitButton = forwardRef(function SubmitButton(
    { pending = false, pendingText, children, disabled, className, type = 'submit', ...rest },
    ref,
) {
    return (
        <Button
            ref={ref}
            type={type}
            disabled={pending || disabled}
            aria-busy={pending || undefined}
            className={cn('gap-2', className)}
            {...rest}
        >
            {pending && (
                <Loader2
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                />
            )}
            {pending && pendingText ? pendingText : children}
        </Button>
    );
});

export default SubmitButton;
