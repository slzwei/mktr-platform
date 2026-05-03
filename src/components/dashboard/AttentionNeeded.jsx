import { useMemo } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const TERMINAL_STATUSES = ['close_won', 'won', 'close_lost', 'lost', 'closed', 'archived'];

export default function AttentionNeeded({ prospects, campaigns, variant = 'card' }) {
 const alerts = useMemo(() => {
 const result = [];
 const now = new Date();

 // 1. Overdue follow-ups
 if (prospects && prospects.length > 0) {
 const overdue = prospects.filter((p) => {
 const followUp = p.nextFollowUpDate || p.next_follow_up_date;
 if (!followUp) return false;
 const status = (p.leadStatus || p.lead_status || '').toLowerCase();
 if (TERMINAL_STATUSES.includes(status)) return false;
 return new Date(followUp) < now;
 });

 if (overdue.length > 0) {
 result.push({
 severity: 'high',
 title: `${overdue.length} overdue follow-up${overdue.length === 1 ? '' : 's'}`,
 description: 'Prospects with past-due follow-up dates',
 });
 }
 }

 // 2. Campaigns ending soon (within 7 days)
 if (campaigns && campaigns.length > 0) {
 const sevenDays = 7 * 24 * 60 * 60 * 1000;
 const endingSoon = campaigns.filter((c) => {
 const endDate = c.end_date || c.endDate;
 if (!endDate) return false;
 const end = new Date(endDate);
 const diff = end.getTime() - now.getTime();
 return diff > 0 && diff <= sevenDays;
 });

 if (endingSoon.length > 0) {
 const soonest = endingSoon.sort(
 (a, b) => new Date(a.end_date || a.endDate) - new Date(b.end_date || b.endDate)
 )[0];
 const daysLeft = Math.ceil(
 (new Date(soonest.end_date || soonest.endDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
 );
 const name = soonest.name || soonest.title || 'Campaign';

 result.push({
 severity: 'medium',
 title: `${endingSoon.length} campaign${endingSoon.length === 1 ? '' : 's'} ending soon`,
 description: `${name} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
 });
 }
 }

 // 3. Stale prospects (status 'new', created > 14 days ago)
 if (prospects && prospects.length > 0) {
 const fourteenDays = 14 * 24 * 60 * 60 * 1000;
 const stale = prospects.filter((p) => {
 const status = (p.leadStatus || p.lead_status || '').toLowerCase();
 if (status !== 'new') return false;
 const created = p.createdAt || p.created_at;
 if (!created) return false;
 return now.getTime() - new Date(created).getTime() > fourteenDays;
 });

 if (stale.length > 0) {
 result.push({
 severity: 'low',
 title: `${stale.length} stale prospect${stale.length === 1 ? '' : 's'}`,
 description: 'New leads with no activity for 14+ days',
 });
 }
 }

 return result;
 }, [prospects, campaigns]);

 // Banner variant: compact horizontal strip, hidden when no alerts
 if (variant === 'banner') {
 if (alerts.length === 0) return null;

 return (
 <div className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-lg border border-warning/30 bg-warning/10">
 <AlertTriangle className="w-4 h-4 text-warning shrink-0" aria-hidden="true"/>
 {alerts.map((alert, i) => (
 <div key={i} className="flex items-center gap-2 text-sm">
 <div
 className={`w-1.5 h-1.5 rounded-full shrink-0 ${
 alert.severity === 'high' ? 'bg-destructive' : alert.severity === 'medium' ? 'bg-warning' : 'bg-info'
 }`}
 aria-hidden="true" />
 <span className="font-medium text-foreground">{alert.title}</span>
 <span className="text-muted-foreground hidden sm:inline">— {alert.description}</span>
 </div>
 ))}
 </div>
 );
 }

 // Default card variant
 return (
 <Card className="border border-border shadow-none bg-card">
 <CardHeader>
 <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
 <AlertTriangle className="w-4 h-4 text-warning" aria-hidden="true"/>
 Needs Attention
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 {alerts.map((alert, i) => (
 <div key={i} className="flex items-start gap-3 py-2">
 <div
 className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
 alert.severity === 'high'
 ? 'bg-destructive'
 : alert.severity === 'medium'
 ? 'bg-warning'
 : 'bg-info'
 }`}
 aria-hidden="true" />
 <div>
 <p className="text-sm font-medium text-foreground">{alert.title}</p>
 <p className="text-xs text-muted-foreground">{alert.description}</p>
 </div>
 </div>
 ))}
 {alerts.length === 0 && (
 <div className="text-center py-6">
 <CheckCircle className="w-8 h-8 mx-auto mb-2 text-success" aria-hidden="true"/>
 <p className="text-sm text-muted-foreground">No overdue follow-ups or stale leads. Alerts appear here when a prospect needs attention.</p>
 </div>
 )}
 </div>
 </CardContent>
 </Card>
 );
}
