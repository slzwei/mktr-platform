import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import LastUpdated from './LastUpdated';

const PERIOD_OPTIONS = {
    today: 'Today',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
};

// Each triplet stays in a single hue family. Spotlight terracotta (primary)
// is intentionally reserved — role badges are ambient, not focal.
const ROLE_BADGE_STYLES = {
    admin: 'bg-destructive/10 text-destructive border-destructive/30',
    agent: 'bg-info/10 text-info border-info/30',
    fleet_owner: 'bg-success/10 text-success border-success/30',
    driver_partner: 'bg-warning/10 text-warning border-warning/30',
};

export default function DashboardHeader({
    user,
    greeting = false,
    title,
    subtitle,
    roleBadge,
    period,
    onPeriodChange,
    periodOptions,
    lastUpdated,
    onRefresh,
    refreshLoading,
    actions,
}) {
    const isGreeting = greeting && user?.full_name;
    const displayTitle = isGreeting
        ? `Welcome back, ${user.full_name}!`
        : title || 'Dashboard';

    const options = periodOptions || PERIOD_OPTIONS;
    const badgeStyle = ROLE_BADGE_STYLES[user?.role] || '';

    return (
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="min-w-0">
                <h1
                    className={cn(
                        'text-2xl tracking-tight text-foreground',
                        // Fraunces is reserved for greetings and hero moments —
                        // never used for label-like page titles.
                        isGreeting ? 'font-serif font-medium' : 'font-sans font-bold',
                    )}
                >
                    {displayTitle}
                </h1>
                {subtitle && (
                    <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
                        {subtitle}
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                    {roleBadge && (
                        <Badge variant="outline" className={badgeStyle}>
                            {roleBadge}
                        </Badge>
                    )}
                    <span className="text-sm text-muted-foreground">
                        {format(new Date(), 'EEEE, d MMMM yyyy')}
                    </span>
                </div>
                {lastUpdated && (
                    <LastUpdated
                        lastUpdated={lastUpdated}
                        onRefresh={onRefresh}
                        loading={refreshLoading}
                    />
                )}
            </div>

            <div className="flex items-center gap-3">
                {period && onPeriodChange && (
                    <Select value={period} onValueChange={onPeriodChange}>
                        <SelectTrigger className="w-[140px] bg-card" size="sm">
                            <SelectValue placeholder="Period" />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(options).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {actions}
            </div>
        </div>
    );
}
