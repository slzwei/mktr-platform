import { cn } from '@/lib/utils';

/**
 * Shared empty-state component for the admin surface.
 *
 * Two variants:
 *   default — centered block, used inside a Card or page container.
 *   compact — inline row, used inside tables or dense panels.
 *
 * Visual language matches DashboardShell's error state:
 * icon-in-tinted-bg + title + muted description + optional action.
 * No decorative flourishes — canonical Tropic restraint.
 *
 * @param {object} props
 * @param {import('lucide-react').LucideIcon} [props.icon] Icon component (optional).
 * @param {string} props.title Short heading.
 * @param {string} [props.description] One-line supporting copy.
 * @param {React.ReactNode} [props.action] Optional action (typically a Button).
 * @param {'default'|'compact'} [props.variant='default']
 * @param {string} [props.className]
 */
export default function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    variant = 'default',
    className,
}) {
    if (variant === 'compact') {
        return (
            <div
                className={cn(
                    'flex flex-col items-center justify-center text-center py-10 px-6 animate-fade-in',
                    className,
                )}
            >
                {Icon && (
                    <Icon
                        className="w-5 h-5 text-muted-foreground mb-2"
                        aria-hidden="true"
                    />
                )}
                <p className="text-sm font-medium text-foreground">{title}</p>
                {description && (
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                        {description}
                    </p>
                )}
                {action && <div className="mt-4">{action}</div>}
            </div>
        );
    }

    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center text-center py-16 px-6 animate-fade-in-up',
                className,
            )}
        >
            {Icon && (
                <div className="w-14 h-14 bg-muted rounded-xl flex items-center justify-center mb-5">
                    <Icon
                        className="w-7 h-7 text-muted-foreground"
                        aria-hidden="true"
                    />
                </div>
            )}
            <h3 className="text-base font-semibold text-foreground tracking-tight">
                {title}
            </h3>
            {description && (
                <p className="mt-1.5 text-sm text-muted-foreground max-w-md leading-relaxed">
                    {description}
                </p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}
