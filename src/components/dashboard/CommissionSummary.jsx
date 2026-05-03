
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Badge } from"@/components/ui/badge";
import { Button } from"@/components/ui/button";
import { format } from"date-fns";
import { Link } from"react-router-dom";
import { 
 DollarSign,
 BarChart3,
 Clock,
 ArrowRight
} from"lucide-react";

const statusColors = {
 accrued:"bg-info/15 text-info border-info/30",
 payable:"bg-success/15 text-success border-success/30",
 paid:"bg-muted text-muted-foreground border-border"};

export default function CommissionSummary({ commissions, userRole, period = '30d', lifetimeEarnings = 0, lifetimeScans = 0, totalScans = 0 }) {
 const recentCommissions = commissions.slice(0, 8);
 
 const totalEarnings = commissions.reduce((sum, c) => {
 if (userRole === 'driver_partner') return sum + Number(c.amount_driver || 0);
 if (userRole === 'fleet_owner') return sum + Number(c.amount_fleet || 0);
 return sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0);
 }, 0);

 const totalDriverCommissions = commissions.reduce((sum, c) => sum + Number(c.amount_driver || 0), 0);
 const totalFleetCommissions = commissions.reduce((sum, c) => sum + Number(c.amount_fleet || 0), 0);

 const periodLabel = (() => {
 if (period === '1d') return 'Today';
 if (period === '7d') return 'Last 7 Days';
 if (period === '30d') return 'Last 30 Days';
 return 'Selected Period';
 })();

 return (
 <Card className="border-none shadow-sm">
 <CardHeader className="border-b border-border">
 <div className="flex justify-between items-center">
 <CardTitle className="text-lg font-bold">Commission Summary</CardTitle>
 <Link to={"/AdminCommissions"}>
 <Button variant="outline" size="sm">
 View All
 <ArrowRight className="w-4 h-4 ml-2"/>
 </Button>
 </Link>
 </div>
 </CardHeader>
 <CardContent className="p-6">
 {userRole === 'admin' ? (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
 <div className="text-center p-3 bg-success/10 rounded-lg">
 <div className="flex items-center justify-center mb-2">
 <DollarSign className="w-5 h-5 text-success"/>
 </div>
 <p className="text-2xl font-bold text-success">
 ${totalDriverCommissions.toFixed(2)}
 </p>
 <p className="text-sm text-success">Driver Commissions (total)</p>
 </div>
 <div className="text-center p-3 bg-primary/10 rounded-lg">
 <div className="flex items-center justify-center mb-2">
 <DollarSign className="w-5 h-5 text-primary"/>
 </div>
 <p className="text-2xl font-bold text-info">
 ${totalFleetCommissions.toFixed(2)}
 </p>
 <p className="text-sm text-primary">Fleet Owner Commissions (total)</p>
 </div>
 <div className="text-center p-3 bg-plum/10 rounded-lg">
 <div className="flex items-center justify-center mb-2">
 <BarChart3 className="w-5 h-5 text-plum"/>
 </div>
 <p className="text-2xl font-bold text-plum">
 {Number(totalScans).toLocaleString()}
 </p>
 <p className="text-sm text-plum">Total Scans</p>
 </div>
 </div>
 ) : (
 <>
 {/* Lifetime Stats */}
 <div className="grid grid-cols-2 gap-4 mb-6">
 <div className="text-center p-3 bg-info/10 rounded-lg">
 <div className="flex items-center justify-center mb-2">
 <DollarSign className="w-5 h-5 text-primary"/>
 </div>
 <p className="text-2xl font-bold text-info">
 ${Number(lifetimeEarnings).toFixed(2)}
 </p>
 <p className="text-sm text-primary">Total Lifetime Earnings</p>
 </div>
 <div className="text-center p-3 bg-plum/10 rounded-lg">
 <div className="flex items-center justify-center mb-2">
 <BarChart3 className="w-5 h-5 text-plum"/>
 </div>
 <p className="text-2xl font-bold text-plum">
 {Number(lifetimeScans)}
 </p>
 <p className="text-sm text-plum">Total Lifetime Scans</p>
 </div>
 </div>

 {/* Period Earned */}
 <div className="grid grid-cols-1 gap-4 mb-6">
 <div className="text-center p-3 bg-primary/10 rounded-lg">
 <div className="flex items-center justify-center mb-2">
 <DollarSign className="w-5 h-5 text-primary"/>
 </div>
 <p className="text-2xl font-bold text-info">
 ${totalEarnings.toFixed(2)}
 </p>
 <p className="text-sm text-primary">Earned ({periodLabel})</p>
 </div>
 </div>
 </>
 )}

 {/* Recent Commissions */}
 <div className="space-y-3">
 <h4 className="font-semibold text-foreground text-sm">Recent Commissions</h4>
 {recentCommissions.length > 0 ? (
 recentCommissions.map((commission) => (
 <div key={commission.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
 <div className="flex-1">
 <div className="flex items-center gap-2 mb-1">
 <DollarSign className="w-4 h-4 text-muted-foreground"/>
 <span className="font-semibold text-foreground">
 ${(userRole === 'driver_partner' ? commission.amount_driver : 
 userRole === 'fleet_owner' ? commission.amount_fleet : 
 commission.amount_driver + commission.amount_fleet).toFixed(2)}
 </span>
 <Badge variant="outline" className={statusColors[commission.status]}>
 {commission.status}
 </Badge>
 </div>
 <div className="flex items-center gap-1 text-xs text-muted-foreground">
 <Clock className="w-3 h-3"/>
 {format(new Date(commission.created_date), 'MMM d, HH:mm')}
 </div>
 </div>
 </div>
 ))
 ) : (
 <div className="text-center py-6 text-muted-foreground">
 <DollarSign className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50"/>
 <p className="text-sm">No commissions yet</p>
 </div>
 )}
 </div>
 </CardContent>
 </Card>
 );
}
