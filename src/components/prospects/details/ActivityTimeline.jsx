import { format } from"date-fns";
import { Clock, User, FileText, CheckCircle2, Edit2 } from"lucide-react";

export default function ActivityTimeline({ details, prospect, campaign }) {
 return (
 <section>
 <h3 className="text-lg font-semibold text-foreground mb-4">Activity History</h3>
 <div className="relative pl-6 space-y-6">
 <div className="absolute left-[11px] top-2 bottom-4 w-px bg-muted"/>

 {(!details?.activities || details.activities.length === 0) ? (
 <div className="relative flex items-center gap-3">
 <div className="h-6 w-6 rounded-full bg-muted border-2 border-white ring-1 ring-border dark:ring-border flex items-center justify-center z-10">
 <Clock className="w-3 h-3 text-muted-foreground"/>
 </div>
 <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
 </div>
 ) : (
 details.activities.map((a, idx) => {
 const when = a.createdAt ? format(new Date(a.createdAt), 'MMM d, h:mm a') : '';
 let text = a.description || a.type;
 let icon = <FileText className="w-3 h-3 text-muted-foreground"/>;

 if (a.type === 'assigned') {
 text ="Assigned to agent";
 icon = <User className="w-3 h-3 text-plum"/>;
 } else if (a.type === 'created') {
 // Use backend description if it's the new rich format, otherwise fallback
 if (a.description && a.description.includes('Prospect signed up')) {
 text = a.description;
 } else {
 text ="Prospect created";
 }
 icon = <CheckCircle2 className="w-3 h-3 text-success"/>;
 } else if (a.type === 'lead_status_updated') {
 text = `Status updated to ${a.description || 'new status'}`;
 icon = <Edit2 className="w-3 h-3 text-primary"/>;
 }

 return (
 <div key={idx} className="relative group">
 <div className="flex items-start gap-4">
 <div className="absolute -left-[24px] mt-0.5">
 <div className="h-6 w-6 rounded-full bg-card border-2 border-border ring-1 ring-border dark:ring-border flex items-center justify-center z-10 shadow-sm">
 {icon}
 </div>
 </div>
 <div className="flex-1 bg-muted/50 rounded-lg p-3 border border-border">
 <p className="text-sm font-medium text-foreground">{text}</p>
 {a.type === 'assigned' && <p className="text-xs text-muted-foreground mt-0.5">{a.description || 'System assignment'}</p>}
 {a.type === 'created' && <p className="text-xs text-muted-foreground mt-0.5">via {prospect.source}, campaign: {campaign?.name}</p>}
 <p className="text-xs text-muted-foreground mt-2">{when}</p>
 </div>
 </div>
 </div>
 );
 })
 )}

 {/* Origin Marker */}
 <div className="relative flex items-center gap-4">
 <div className="absolute -left-[24px]">
 <div className="h-6 w-6 rounded-full bg-muted border-2 border-white ring-1 ring-border dark:ring-border flex items-center justify-center z-10">
 <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground"/>
 </div>
 </div>
 <div>
 <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Start of History</span>
 </div>
 </div>

 </div>
 </section>
 );
}
