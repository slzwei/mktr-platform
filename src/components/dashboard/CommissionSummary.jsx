
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  DollarSign,
  BarChart3,
  Clock,
  ArrowRight
} from "lucide-react";

const statusColors = {
  accrued: "bg-blue-100 text-blue-800 border-blue-200",
  payable: "bg-green-100 text-green-800 border-green-200",
  paid: "bg-gray-100 text-gray-800 border-gray-200"
};

export default function CommissionSummary({ commissions, userRole, period = '30d', lifetimeEarnings = 0, lifetimeScans = 0 }) {
  const recentCommissions = commissions.slice(0, 8);
  
  const totalEarnings = commissions.reduce((sum, c) => {
    if (userRole === 'driver_partner') return sum + c.amount_driver;
    if (userRole === 'fleet_owner') return sum + c.amount_fleet;
    return sum + c.amount_driver + c.amount_fleet;
  }, 0);

  const periodLabel = (() => {
    if (period === '1d') return 'Today';
    if (period === '7d') return 'Last 7 Days';
    if (period === '30d') return 'Last 30 Days';
    return 'Selected Period';
  })();

  return (
    <Card className="shadow-md">
      <CardHeader className="border-b border-gray-100">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg font-bold">Commission Summary</CardTitle>
          <Link to={createPageUrl("AdminCommissions")}>
            <Button variant="outline" size="sm">
              View All
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {/* Lifetime Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center p-3 bg-indigo-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <DollarSign className="w-5 h-5 text-indigo-600" />
            </div>
            <p className="text-2xl font-bold text-indigo-900">
              ${Number(lifetimeEarnings).toFixed(2)}
            </p>
            <p className="text-sm text-indigo-600">Total Lifetime Earnings</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <BarChart3 className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-2xl font-bold text-purple-900">
              {Number(lifetimeScans)}
            </p>
            <p className="text-sm text-purple-600">Total Lifetime Scans</p>
          </div>
        </div>

        {/* Period Earned */}
        <div className="grid grid-cols-1 gap-4 mb-6">
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-2xl font-bold text-blue-900">
              ${totalEarnings.toFixed(2)}
            </p>
            <p className="text-sm text-blue-600">Earned ({periodLabel})</p>
          </div>
        </div>

        {/* Recent Commissions */}
        <div className="space-y-3">
          <h4 className="font-semibold text-gray-900 text-sm">Recent Commissions</h4>
          {recentCommissions.length > 0 ? (
            recentCommissions.map((commission) => (
              <div key={commission.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-gray-500" />
                    <span className="font-semibold text-gray-900">
                      ${(userRole === 'driver_partner' ? commission.amount_driver : 
                         userRole === 'fleet_owner' ? commission.amount_fleet : 
                         commission.amount_driver + commission.amount_fleet).toFixed(2)}
                    </span>
                    <Badge variant="outline" className={statusColors[commission.status]}>
                      {commission.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    {format(new Date(commission.created_date), 'MMM d, HH:mm')}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-gray-500">
              <DollarSign className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm">No commissions yet</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
