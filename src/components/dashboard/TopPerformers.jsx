import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatName } from '@/services/formatters';

export default function TopPerformers({ prospects }) {
 const topAgents = useMemo(() => {
 if (!prospects || prospects.length === 0) return [];

 const agentMap = {};
 prospects.forEach((p) => {
 const agentId = p.assignedAgentId || p.assigned_agent_id;
 if (!agentId) return;

 const agent = p.assignedAgent || p.assigned_agent;

 // Skip prospects with no agent record (system agent, deleted users)
 if (!agent) return;
 if (agent.email === 'system@mktr.local') return;

 if (!agentMap[agentId]) {
 const name = formatName(agent) || `Agent ${agentId.slice(0, 8)}`;
 agentMap[agentId] = { id: agentId, name, total: 0, won: 0 };
 }
 agentMap[agentId].total += 1;

 const status = (p.leadStatus || p.lead_status || '').toLowerCase();
 if (status === 'close_won' || status === 'won') {
 agentMap[agentId].won += 1;
 }
 });

 return Object.values(agentMap)
 .sort((a, b) => b.won - a.won)
 .slice(0, 5)
 .map((agent) => ({
 ...agent,
 rate: agent.total > 0 ? Math.round((agent.won / agent.total) * 100) : 0,
 }));
 }, [prospects]);

 return (
 <Card className="border border-border shadow-none bg-card">
 <CardHeader>
 <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
 <Trophy className="w-[18px] h-[18px] text-warning" aria-hidden="true"/>
 Top Performers
 </CardTitle>
 <p className="text-sm text-muted-foreground">By conversion rate this period</p>
 </CardHeader>
 <CardContent>
 {topAgents.map((agent, i) => (
 <div key={agent.id} className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0">
 <div
 className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
 i === 0
 ? 'bg-warning/20 text-warning'
 : i === 1
 ? 'bg-muted text-muted-foreground'
 : i === 2
 ? 'bg-terracotta/20 text-terracotta'
 : 'bg-muted/50 text-muted-foreground'
 }`}
 aria-label={`Rank ${i + 1}`}
 >
 {i + 1}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
 <p className="text-xs text-muted-foreground">{agent.total} prospects</p>
 </div>
 <div className="text-right">
 <p className="text-sm font-semibold text-success">{agent.won} won</p>
 <p className="text-xs text-muted-foreground">{agent.rate}% rate</p>
 </div>
 </div>
 ))}
 {topAgents.length === 0 && (
 <p className="text-center py-6 text-muted-foreground text-sm">No conversion data yet</p>
 )}
 </CardContent>
 </Card>
 );
}
