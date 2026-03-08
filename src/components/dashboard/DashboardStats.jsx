import { ArrowUpRight, ArrowDownRight, Users, TrendingUp, DollarSign, Car, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { subDays, isSameDay } from 'date-fns';

export default function DashboardStats({ stats, loading, period = '30d' }) {
    if (loading) {
        return (
            <div className="mb-8">
                <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
                    ))}
                </div>
                <div
                    className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="min-w-[260px] snap-center shrink-0 h-32 bg-gray-100 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    const { prospects, campaigns, commissions, cars, overview } = stats;

    // Period-over-period comparison
    const periodDaysMap = { 'today': 1, '1d': 1, '7d': 7, '30d': 30, '90d': 90 };
    const days = periodDaysMap[period] || 30;
    const now = new Date();
    const currentStart = subDays(now, days);
    const previousStart = subDays(now, days * 2);

    // Revenue comparison
    const currentRevenue = commissions
      .filter(c => new Date(c.created_date || c.createdAt) >= currentStart)
      .reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0);
    const previousRevenue = commissions
      .filter(c => { const d = new Date(c.created_date || c.createdAt); return d >= previousStart && d < currentStart; })
      .reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0);
    const revenueChange = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : null;

    // Prospects comparison
    const currentProspects = prospects.filter(p => new Date(p.created_date || p.createdAt || p.created_at) >= currentStart).length;
    const previousProspects = prospects.filter(p => { const d = new Date(p.created_date || p.createdAt || p.created_at); return d >= previousStart && d < currentStart; }).length;
    const prospectsChange = previousProspects > 0 ? ((currentProspects - previousProspects) / previousProspects * 100).toFixed(1) : null;

    // Active campaigns ratio
    const activeCampaigns = overview.campaignsActive || campaigns.filter(c => c.status === 'active').length;
    const totalCampaigns = overview.campaignsTotal || campaigns.length;
    const campaignActivityRate = totalCampaigns > 0 ? Math.round((activeCampaigns / totalCampaigns) * 100) : 0;

    // Calculate total revenue
    const totalRevenue = overview.commissionsTotal || commissions.reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0);

    // Calculate average revenue per prospect (just as an interesting metric)
    const totalProspects = overview.prospectsTotal || prospects.length;
    const revenuePerProspect = totalProspects > 0 ? (totalRevenue / totalProspects).toFixed(2) : 0;

    const cards = [
        {
            title: "Total Revenue",
            value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            icon: DollarSign,
            trend: revenueChange !== null ? `${revenueChange > 0 ? '+' : ''}${revenueChange}%` : 'N/A',
            trendUp: revenueChange !== null ? revenueChange > 0 : true,
            description: revenueChange !== null ? "vs previous period" : "no prior data",
            color: "text-emerald-600",
            bg: "bg-emerald-50",
            iconColor: "text-emerald-600",
            linkTo: createPageUrl("AdminCommissions")
        },
        {
            title: "Active Campaigns",
            value: activeCampaigns,
            icon: TrendingUp,
            trend: `${campaignActivityRate}%`,
            trendUp: true,
            description: "active rate",
            color: "text-blue-600",
            bg: "bg-blue-50",
            iconColor: "text-blue-600",
            linkTo: createPageUrl("AdminCampaigns")
        },
        {
            title: "Total Prospects",
            value: totalProspects.toLocaleString(),
            icon: Users,
            trend: prospectsChange !== null ? `${prospectsChange > 0 ? '+' : ''}${prospectsChange}%` : `+${overview.newProspects || 0}`,
            trendUp: prospectsChange !== null ? prospectsChange > 0 : true,
            description: prospectsChange !== null ? "vs previous period" : "new this month",
            color: "text-violet-600",
            bg: "bg-violet-50",
            iconColor: "text-violet-600",
            linkTo: createPageUrl("AdminProspects")
        },
        {
            title: "Fleet Size",
            value: cars.length,
            icon: Car,
            trend: "Active",
            trendUp: true,
            description: "vehicles registered",
            color: "text-orange-600",
            bg: "bg-orange-50",
            iconColor: "text-orange-600",
            linkTo: createPageUrl("AdminFleet")
        },
        {
            title: "Ad Impressions",
            value: (overview.impressionsToday || 0).toLocaleString(),
            icon: Eye,
            trend: "Today",
            trendUp: true,
            description: "views delivered",
            color: "text-pink-600",
            bg: "bg-pink-50",
            iconColor: "text-pink-600"
        }
    ];

    // Compute 7-day sparklines for revenue and prospects
    const today = new Date();
    const last7Days = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i));

    // Revenue sparkline: daily commission totals
    const revenueSparkData = last7Days.map(day =>
      commissions
        .filter(c => isSameDay(new Date(c.created_date || c.createdAt), day))
        .reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0)
    );
    cards[0].sparkData = revenueSparkData;

    // Prospects sparkline: daily new prospect counts
    const prospectSparkData = last7Days.map(day =>
      prospects.filter(p => isSameDay(new Date(p.created_date || p.createdAt), day)).length
    );
    cards[2].sparkData = prospectSparkData;

    const renderCard = (card, index) => {
        const cardElement = (
            <Card key={index} className={cn(
                "border-none shadow-sm transition-shadow duration-200",
                card.linkTo ? "cursor-pointer hover:shadow-md" : "hover:shadow-md"
            )}>
                <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                        <div className={cn("p-3 rounded-xl", card.bg)}>
                            <card.icon className={cn("w-6 h-6", card.iconColor)} />
                        </div>
                        <div className={cn("flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                            card.trendUp ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        )}>
                            {card.trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {card.trend}
                        </div>
                    </div>

                    <div>
                        <p className="text-sm font-medium text-gray-500 mb-1">{card.title}</p>
                        <h3 className="text-2xl font-bold text-gray-900">{card.value}</h3>
                        {card.sparkData && card.sparkData.length > 0 && (
                            <div className="h-8 mt-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={card.sparkData.map((value, i) => ({ value }))}>
                                        <Line type="monotone" dataKey="value" stroke="#9ca3af" strokeWidth={1.5} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                        <p className="text-xs text-gray-400 mt-1">{card.description}</p>
                    </div>
                </CardContent>
            </Card>
        );

        return card.linkTo ? (
            <Link key={index} to={card.linkTo} className="no-underline">
                {cardElement}
            </Link>
        ) : (
            cardElement
        );
    };

    return (
        <div className="mb-8">
            {/* Desktop: grid layout */}
            <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card, index) => renderCard(card, index))}
            </div>
            {/* Mobile: horizontal scroll */}
            <div
                className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
            >
                {cards.map((card, index) => (
                    <div key={`mobile-${index}`} className="min-w-[260px] snap-center shrink-0">
                        {renderCard(card, index)}
                    </div>
                ))}
            </div>
        </div>
    );
}
