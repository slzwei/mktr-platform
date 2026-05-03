import { cn } from '@/lib/utils';

/**
 * Standard page header for admin-surface pages.
 *
 * Replaces the hand-rolled pattern seen across every page:
 *
 *   <div className="flex flex-col lg:flex-row justify-between ...">
 *     <div>
 *       <h1 className="text-2xl font-bold …">Prospects</h1>
 *       <p className="text-sm text-muted-foreground mt-1">Manage…</p>
 *     </div>
 *     <div className="flex items-center gap-2">{buttons}</div>
 *   </div>
 *
 * Becomes:
 *
 *   <PageHeader
 *     title="Prospects"
 *     description="Manage and track…"
 *     actions={<><Button>Export</Button><Button>New</Button></>}
 *   />
 *
 * Not used on the Dashboard route — that page uses DashboardHeader, which
 * adds the greeting + period picker that doesn't belong on plain pages.
 *
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions]
 * @param {string}          [props.className]
 */
export default function PageHeader({ title, description, actions, className }) {
    return (
        <div
            className={cn(
                'flex flex-col lg:flex-row lg:items-center justify-between gap-4',
                className,
            )}
        >
            <div className="min-w-0">
                <h1 className="text-2xl font-bold font-sans text-foreground tracking-tight">
                    {title}
                </h1>
                {description && (
                    <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
                        {description}
                    </p>
                )}
            </div>
            {actions && (
                <div className="flex items-center gap-2 shrink-0">{actions}</div>
            )}
        </div>
    );
}
