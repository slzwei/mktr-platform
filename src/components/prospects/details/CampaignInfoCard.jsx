import { Badge } from"@/components/ui/badge";
import { Tag } from"lucide-react";

export default function CampaignInfoCard({ campaign, prospect }) {
 return (
 <div className="space-y-4">
 <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
 <Tag className="w-4 h-4 text-muted-foreground"/>
 Campaign
 </h3>
 <div className="bg-card rounded-lg border shadow-sm p-4 space-y-3">
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-1">Campaign Name</p>
 <Badge variant="outline" className="font-normal text-foreground border-border">
 {campaign?.name || 'Unknown Campaign'}
 </Badge>
 </div>
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-1">Lead Source</p>
 <div className="inline-flex items-center px-2 py-1 rounded bg-muted text-foreground text-xs font-medium uppercase tracking-wide">
 {prospect.source || 'Unknown'}
 </div>
 </div>
 {prospect.campaigns_subscribed && prospect.campaigns_subscribed.length > 1 && (
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-1">Subscriptions</p>
 <div className="flex flex-wrap gap-1">
 {prospect.campaigns_subscribed.map((cid) => (
 <span key={cid} className="text-[10px] px-1.5 py-0.5 bg-muted border rounded text-muted-foreground">{cid}</span>
 ))}
 </div>
 </div>
 )}
 </div>
 </div>
 );
}
