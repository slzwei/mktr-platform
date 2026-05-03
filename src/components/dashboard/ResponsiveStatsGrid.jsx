import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

// Explicit map so Tailwind JIT can see every class — string templates get purged.
const LG_COLS_CLASS = {
    2: 'lg:grid-cols-2',
    3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4',
    5: 'lg:grid-cols-5',
    6: 'lg:grid-cols-6',
};

const MOBILE_SCROLL_STYLE = {
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    WebkitOverflowScrolling: 'touch',
};

function StatCard({ card }) {
    const cardElement = (
        <Card
            className={cn(
                'border border-border bg-card shadow-none transition-colors duration-micro ease-out-quart',
                'hover:border-foreground/20',
                card.linkTo && 'cursor-pointer group',
            )}
        >
            <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                    <div className={cn('p-2.5 rounded-xl', card.iconBg)}>
                        <card.icon className={cn('w-5 h-5', card.iconColor)} aria-hidden="true" />
                    </div>
                    {card.trend && (
                        <div
                            className={cn(
                                'flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-md tabular-nums',
                                card.trendUp !== false
                                    ? 'bg-success/10 text-success'
                                    : 'bg-destructive/10 text-destructive',
                            )}
                        >
                            {card.trendUp !== false ? (
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                            ) : (
                                <ArrowDownRight className="w-3 h-3" aria-hidden="true" />
                            )}
                            {card.trend}
                        </div>
                    )}
                </div>

                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-2">
                    {card.title}
                </p>
                <h3 className="text-3xl font-semibold text-foreground tracking-tight leading-none tabular-nums">
                    {card.value}
                </h3>
                {card.description && (
                    <p className="text-xs text-muted-foreground mt-2 leading-snug">
                        {card.description}
                    </p>
                )}
            </CardContent>
        </Card>
    );

    if (card.linkTo) {
        return (
            <Link to={card.linkTo} className="no-underline">
                {cardElement}
            </Link>
        );
    }
    return cardElement;
}

export default function ResponsiveStatsGrid({ cards, loading, columns = 4 }) {
    const lgColsClass = LG_COLS_CLASS[columns] ?? LG_COLS_CLASS[4];
    const gridClass = cn('hidden md:grid md:grid-cols-2 gap-5', lgColsClass);

    if (loading) {
        return (
            <div className="mb-8">
                <div className={gridClass}>
                    {Array.from({ length: columns }, (_, i) => (
                        <div
                            key={i}
                            className="h-[140px] bg-muted/60 rounded-lg border border-border animate-pulse"
                            style={{ animationDelay: `${i * 80}ms` }}
                        />
                    ))}
                </div>
                <div
                    className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
                    style={MOBILE_SCROLL_STYLE}
                >
                    {Array.from({ length: columns }, (_, i) => (
                        <div
                            key={i}
                            className="min-w-[260px] snap-center shrink-0 h-[140px] bg-muted/60 rounded-lg border border-border animate-pulse"
                            style={{ animationDelay: `${i * 80}ms` }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    if (!cards || cards.length === 0) return null;

    return (
        <div className="mb-8">
            <div className={gridClass}>
                {cards.map((card, i) => (
                    <StatCard key={card.title || i} card={card} />
                ))}
            </div>
            <div
                className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
                style={MOBILE_SCROLL_STYLE}
            >
                {cards.map((card, i) => (
                    <div key={card.title || i} className="min-w-[260px] snap-center shrink-0">
                        <StatCard card={card} />
                    </div>
                ))}
            </div>
        </div>
    );
}
