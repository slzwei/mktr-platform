import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

function StatCard({ card }) {
  const cardElement = (
    <Card
      className={cn(
        "border-none shadow-sm transition-shadow duration-200 hover:shadow-md",
        card.linkTo && "cursor-pointer"
      )}
    >
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className={cn("p-3 rounded-xl", card.iconBg)}>
            <card.icon className={cn("w-6 h-6", card.iconColor)} />
          </div>
          {card.trend && (
            <div
              className={cn(
                "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                card.trendUp !== false
                  ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
              )}
            >
              {card.trendUp !== false ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              {card.trend}
            </div>
          )}
        </div>

        <p className="text-sm font-medium text-muted-foreground mb-1">
          {card.title}
        </p>
        <h3 className="text-2xl font-bold text-foreground">{card.value}</h3>
        {card.sparkData && card.sparkData.length > 0 && (
          <div className="h-8 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={card.sparkData.map((value) => ({ value }))}
              >
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="currentColor"
                  className="text-muted-foreground/50"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {card.description && (
          <p className="text-xs text-muted-foreground/70 mt-1">
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
  if (loading) {
    return (
      <div className="mb-8">
        <div className={`hidden md:grid md:grid-cols-2 lg:grid-cols-${columns} gap-6`}>
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
        <div
          className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
        >
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="min-w-[260px] snap-center shrink-0 h-32 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!cards || cards.length === 0) return null;

  const gridClass = columns === 5
    ? "hidden md:grid md:grid-cols-2 lg:grid-cols-5 gap-6"
    : `hidden md:grid md:grid-cols-2 lg:grid-cols-${columns} gap-6`;

  return (
    <div className="mb-8">
      {/* Desktop grid */}
      <div className={gridClass}>
        {cards.map((card, i) => (
          <StatCard key={card.title || i} card={card} />
        ))}
      </div>
      {/* Mobile horizontal scroll */}
      <div
        className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
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
