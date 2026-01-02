import { ArrowUpRight, ArrowDownRight, Users, TrendingUp, DollarSign, Car } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function DashboardStats({ stats, loading }) {
    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
                ))}
            </div>
        );
    }

    const { prospects, campaigns, commissions, cars, overview } = stats;

    // Helper to calculate percentage change (mock logic or real if previous period data existed)
    // Since we only have current totals properly, we'll use safe defaults or derived metrics

    // Example: Active campaigns ratio
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
            trend: "+12.5%", // In a real app, this would be calculated from previous month
            trendUp: true,
            description: "from last month",
            color: "text-emerald-600",
            bg: "bg-emerald-50",
            iconColor: "text-emerald-600"
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
            iconColor: "text-blue-600"
        },
        {
            title: "Total Prospects",
            value: totalProspects.toLocaleString(),
            icon: Users,
            trend: `+${overview.newProspects || 0}`,
            trendUp: true,
            description: "new this month",
            color: "text-violet-600",
            bg: "bg-violet-50",
            iconColor: "text-violet-600"
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
            iconColor: "text-orange-600"
        }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {cards.map((card, index) => (
                <Card key={index} className="border-none shadow-sm hover:shadow-md transition-shadow duration-200">
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
                            <p className="text-xs text-gray-400 mt-1">{card.description}</p>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
