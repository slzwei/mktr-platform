
import { useState, useEffect } from"react";
import { LeadPackage } from"@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Badge } from"@/components/ui/badge";
import { Progress } from"@/components/ui/progress";
import {
 Package,
 Calendar,
 CheckCircle2
} from"lucide-react";
import { format } from"date-fns";

const statusColors = {
 active:"bg-success/15 text-success",
 completed:"bg-info/15 text-info",
 paused:"bg-warning/15 text-warning",
 cancelled:"bg-destructive/15 text-destructive"};

const paymentStatusColors = {
 paid:"bg-success/15 text-success",
 pending:"bg-warning/15 text-warning",
 partial:"bg-warning/15 text-warning",
 refunded:"bg-destructive/15 text-destructive"};

export default function MyLeadPackages({ userId }) {
 const [packages, setPackages] = useState([]);
 const [loading, setLoading] = useState(true);

 const [error, setError] = useState(null);

 useEffect(() => {
 const loadData = async () => {
 // Do not attempt fetch if userId is missing
 if (!userId) {
 setLoading(false);
 return;
 }

 setLoading(true);
 setError(null);

 try {
 // Fetch assignments
 let assignmentsData = [];
 try {
 assignmentsData = await LeadPackage.getAssignments(userId);
 } catch (e) {
 console.error("Failed to load assignments:", e);
 throw new Error("Failed to load package assignments");
 }

 // Map assignments to component format
 // specific campaign details are already nested in the assignment response
 const mappedPackages = assignmentsData.map(assignment => ({
 id: assignment.id,
 campaign_id: assignment.package?.campaign?.id,
 campaign_name: assignment.package?.campaign?.name || 'Unknown Campaign',
 package_name: assignment.package?.name || 'Unknown Package',
 status: assignment.status,
 payment_status: 'paid', // Default to paid as assignments are manually created
 total_leads: assignment.leadsTotal,
 leads_delivered: assignment.leadsTotal - assignment.leadsRemaining,
 leads_remaining: assignment.leadsRemaining,
 total_amount: parseFloat(assignment.priceSnapshot),
 price_per_lead: assignment.leadsTotal > 0 ? parseFloat(assignment.priceSnapshot) / assignment.leadsTotal : 0,
 purchase_date: assignment.purchaseDate,
 notes: assignment.package?.description
 }));

 setPackages(mappedPackages);
 } catch (err) {
 console.error('Error loading lead packages:', err);
 setError(err.message || 'Unable to load packages');
 } finally {
 setLoading(false);
 }
 };

 loadData();
 }, [userId]);

 if (loading) {
 return (
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Package className="w-5 h-5"/>
 My Lead Packages
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="animate-pulse space-y-4">
 {[1, 2].map(i => (
 <div key={i} className="h-32 bg-muted rounded"></div>
 ))}
 </div>
 </CardContent>
 </Card>
 );
 }

 if (error) {
 return (
 <Card className="border-destructive/30 bg-destructive/10">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-destructive">
 <Package className="w-5 h-5"/>
 My Lead Packages
 </CardTitle>
 </CardHeader>
 <CardContent>
 <p className="text-destructive text-sm">Failed to load packages: {error}</p>
 <p className="text-xs text-destructive mt-1">Please try refreshing the page.</p>
 </CardContent>
 </Card>
 );
 }

 if (packages.length === 0) {
 return (
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Package className="w-5 h-5"/>
 My Lead Packages
 </CardTitle>
 </CardHeader>
 <CardContent className="text-center py-8">
 <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50"/>
 <p className="font-medium text-foreground">No Lead Packages</p>
 <p className="text-sm text-muted-foreground">You haven't purchased any lead packages yet</p>
 </CardContent>
 </Card>
 );
 }

 return (
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Package className="w-5 h-5"/>
 My Lead Packages
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 {packages.map((pkg) => {
 const deliveryProgress = pkg.total_leads > 0 ? (pkg.leads_delivered / pkg.total_leads) * 100 : 0;

 return (
 <div key={pkg.id} className="border border-border rounded-lg p-4 bg-muted/50">
 <div className="flex justify-between items-start mb-3">
 <div>
 <h3 className="font-semibold text-foreground">{pkg.package_name}</h3>
 <p className="text-sm text-muted-foreground">
 Campaign: {pkg.campaign_name}
 </p>
 </div>
 <div className="flex gap-2">
 <Badge className={statusColors[pkg.status]}>
 {pkg.status}
 </Badge>
 <Badge variant="outline" className={paymentStatusColors[pkg.payment_status]}>
 {pkg.payment_status}
 </Badge>
 </div>
 </div>

 {/* Progress Bar */}
 <div className="mb-3">
 <div className="flex justify-between items-center text-sm mb-1">
 <span className="text-muted-foreground">Delivery Progress</span>
 <span className="font-medium">
 {pkg.leads_delivered} / {pkg.total_leads} leads
 </span>
 </div>
 <Progress value={deliveryProgress} className="h-2"/>
 </div>

 <div className="grid grid-cols-2 gap-4 text-sm">
 <div className="flex items-center gap-2">
 <Calendar className="w-4 h-4 text-muted-foreground"/>
 <div>
 <p className="text-muted-foreground">Purchased</p>
 <p className="font-semibold">
 {format(new Date(pkg.purchase_date), 'dd/MM/yyyy')}
 </p>
 </div>
 </div>
 </div>

 {pkg.notes && (
 <div className="mt-3 p-2 bg-primary/10 rounded text-sm">
 <p className="text-info">{pkg.notes}</p>
 </div>
 )}

 {pkg.status === 'completed' && (
 <div className="mt-3 flex items-center gap-2 text-success text-sm">
 <CheckCircle2 className="w-4 h-4"/>
 <span>Package completed!</span>
 </div>
 )}
 </div>
 );
 })}
 </CardContent>
 </Card>
 );
}
