import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function TopPerformers({ prospects }) {
  const topAgents = useMemo(() => {
    if (!prospects || prospects.length === 0) return [];

    const agentMap = {};
    prospects.forEach((p) => {
      const agentId = p.assignedAgentId || p.assigned_agent_id;
      if (!agentId) return;

      if (!agentMap[agentId]) {
        agentMap[agentId] = { id: agentId, total: 0, won: 0 };
      }
      agentMap[agentId].total += 1;

      const status = (p.leadStatus || p.lead_status || "").toLowerCase();
      if (status === "close_won" || status === "won") {
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          Top Performers
        </CardTitle>
        <p className="text-sm text-gray-500">By conversion rate this period</p>
      </CardHeader>
      <CardContent>
        {topAgents.map((agent, i) => (
          <div key={agent.id} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              i === 0 ? 'bg-amber-100 text-amber-700' :
              i === 1 ? 'bg-gray-100 text-gray-600' :
              i === 2 ? 'bg-orange-100 text-orange-700' :
              'bg-gray-50 text-gray-500'
            }`}>
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                Agent {agent.id?.slice(0, 8)}
              </p>
              <p className="text-xs text-gray-400">{agent.total} prospects</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-emerald-600">{agent.won} won</p>
              <p className="text-xs text-gray-400">{agent.rate}% rate</p>
            </div>
          </div>
        ))}
        {topAgents.length === 0 && (
          <p className="text-center py-6 text-gray-400 text-sm">No conversion data yet</p>
        )}
      </CardContent>
    </Card>
  );
}
