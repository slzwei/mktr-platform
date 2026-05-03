import { Button } from"@/components/ui/button";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
} from"@/components/ui/dialog";
import { Badge } from"@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { format } from"date-fns";
import {
 User,
 Mail,
 Phone,
 Calendar,
 Tag,
 TrendingUp,
 Package,
 Cake
} from"lucide-react";

const statusColors = {
 active:"bg-success/15 text-success",
 inactive:"bg-destructive/15 text-destructive"};

export default function AgentDetailsDialog({ open, onOpenChange, agent }) {
 if (!agent) return null;

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-3">
 <div className="w-12 h-12 bg-info/15 text-primary rounded-full flex items-center justify-center font-semibold text-lg">
 {(agent.fullName || agent.firstName || 'A').charAt(0).toUpperCase()}
 </div>
 <div>
 <h2 className="text-xl font-bold">{agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || 'N/A'}</h2>
 <p className="text-sm text-muted-foreground font-normal">Sales Agent</p>
 </div>
 </DialogTitle>
 </DialogHeader>

 <div className="space-y-6 py-4">
 {/* Contact Information */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-lg">
 <User className="w-5 h-5"/>
 Contact Information
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="flex items-center gap-3">
 <Mail className="w-5 h-5 text-muted-foreground"/>
 <div>
 <p className="text-sm text-muted-foreground">Email Address</p>
 <p className="font-semibold">{agent.email}</p>
 </div>
 </div>

 {agent.phone && (
 <div className="flex items-center gap-3">
 <Phone className="w-5 h-5 text-muted-foreground"/>
 <div>
 <p className="text-sm text-muted-foreground">Phone Number</p>
 <p className="font-semibold">{agent.phone}</p>
 </div>
 </div>
 )}

 {agent.dateOfBirth && (
 <div className="flex items-center gap-3">
 <Cake className="w-5 h-5 text-muted-foreground"/>
 <div>
 <p className="text-sm text-muted-foreground">Date of Birth</p>
 <p className="font-semibold">
 {format(new Date(agent.dateOfBirth), 'PPP')}
 </p>
 </div>
 </div>
 )}

 <div className="flex items-center gap-3">
 <Calendar className="w-5 h-5 text-muted-foreground"/>
 <div>
 <p className="text-sm text-muted-foreground">Joined Date</p>
 <p className="font-semibold">
 {agent.createdAt ? format(new Date(agent.createdAt), 'PPP') : '-'}
 </p>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Status & Performance */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-lg">
 <Tag className="w-5 h-5"/>
 Status & Performance
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div>
 <p className="text-sm text-muted-foreground mb-2">Current Status</p>
 <Badge className={agent.isActive ? statusColors['active'] : statusColors['inactive']}>
 {agent.isActive ? 'Active' : 'Inactive'}
 </Badge>
 </div>

 <div className="flex items-center gap-3">
 <TrendingUp className="w-5 h-5 text-muted-foreground"/>
 <div>
 <p className="text-sm text-muted-foreground">Owed Leads Count</p>
 <p className="font-semibold text-2xl text-primary">
 {agent.owed_leads_count || 0}
 </p>
 </div>
 </div>

 <div>
 <p className="text-sm text-muted-foreground mb-2">Agent ID</p>
 <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
 {agent.id}
 </code>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Assigned Packages */}
 {agent.assignedPackages && agent.assignedPackages.length > 0 && (
 <Card className="mt-6">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-lg">
 <Package className="w-5 h-5"/>
 Assigned Packages
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {agent.assignedPackages.map((assignment) => (
 <div key={assignment.id} className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border">
 <div>
 <p className="font-semibold text-foreground">{assignment.package?.name || 'Unknown Package'}</p>
 <p className="text-sm text-muted-foreground capitalize">{assignment.package?.type || 'Standard'} • ${assignment.package?.price || 0}</p>
 </div>
 <div className="text-right">
 <p className="text-xs text-muted-foreground">Assigned</p>
 <p className="text-sm font-medium">{assignment.createdAt ? format(new Date(assignment.createdAt), 'MMM d, yyyy') : '-'}</p>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 <div className="flex justify-end">
 <Button onClick={() => onOpenChange(false)}>
 Close
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 );
}