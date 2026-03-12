import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import LastUpdated from "./LastUpdated";

const PERIOD_OPTIONS = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const ROLE_BADGE_STYLES = {
  admin: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
  agent: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  fleet_owner: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  driver_partner: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800",
};

export default function DashboardHeader({
  user,
  greeting = false,
  title,
  roleBadge,
  period,
  onPeriodChange,
  periodOptions,
  lastUpdated,
  onRefresh,
  refreshLoading,
  actions,
}) {
  const displayTitle = greeting && user?.full_name
    ? `Welcome back, ${user.full_name}!`
    : title || "Dashboard";

  const options = periodOptions || PERIOD_OPTIONS;
  const badgeStyle = ROLE_BADGE_STYLES[user?.role] || "";

  return (
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          {displayTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          {roleBadge && (
            <Badge variant="outline" className={badgeStyle}>
              {roleBadge}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {format(new Date(), "EEEE, d MMMM yyyy")}
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
