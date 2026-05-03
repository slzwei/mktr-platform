import { cloneElement, isValidElement, useId } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Wraps a form input with consistent Label + required asterisk + description
 * + error message. Works with react-hook-form's `errors` object — no
 * FormProvider required.
 *
 * Pattern this replaces (seen across every form dialog):
 *
 *   <div>
 *     <Label htmlFor="full_name">Full Name *</Label>
 *     <Input id="full_name" {...register("full_name")} />
 *     {errors.full_name && (
 *       <p className="text-destructive text-xs mt-1">
 *         {errors.full_name.message}
 *       </p>
 *     )}
 *   </div>
 *
 * Becomes:
 *
 *   <FormRow label="Full Name" required error={errors.full_name?.message}>
 *     <Input {...register("full_name")} />
 *   </FormRow>
 *
 * The single input child is auto-assigned an id and aria-described-by so the
 * error message is announced by screen readers.
 *
 * @param {object} props
 * @param {string}          props.label        Visible field label.
 * @param {React.ReactNode} props.children     Single input-ish element.
 * @param {boolean}         [props.required]   Adds a red asterisk.
 * @param {string}          [props.description] Helper text below the input.
 * @param {string}          [props.error]      Validation error message.
 * @param {string}          [props.htmlFor]    Override auto-generated id.
 * @param {string}          [props.className]
 */
export default function FormRow({
    label,
    children,
    required = false,
    description,
    error,
    htmlFor,
    className,
}) {
    const autoId = useId();
    const fieldId = htmlFor || autoId;
    const errorId = error ? `${fieldId}-error` : undefined;
    const descriptionId = description ? `${fieldId}-description` : undefined;

    // Inject id + aria-describedby into the single child so the caller
    // doesn't have to plumb them manually.
    const enhancedChild =
        isValidElement(children)
            ? cloneElement(children, {
                  id: children.props.id || fieldId,
                  'aria-invalid': error ? 'true' : children.props['aria-invalid'],
                  'aria-describedby':
                      [errorId, descriptionId, children.props['aria-describedby']]
                          .filter(Boolean)
                          .join(' ') || undefined,
              })
            : children;

    return (
        <div className={cn('space-y-2', className)}>
            <Label htmlFor={fieldId} className="text-sm font-medium">
                {label}
                {required && (
                    <span className="text-destructive ml-0.5" aria-hidden="true">
                        *
                    </span>
                )}
            </Label>
            {enhancedChild}
            {description && !error && (
                <p id={descriptionId} className="text-xs text-muted-foreground">
                    {description}
                </p>
            )}
            {error && (
                <p id={errorId} className="text-xs text-destructive" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
