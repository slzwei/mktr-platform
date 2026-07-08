import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { redeemOpsApi } from '@/api/redeemOps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import AlertTriangle from 'lucide-react/icons/alert-triangle';

/**
 * Manager board: pipeline stages as columns, partner cards inside. Stage moves
 * happen on the partner detail page (server-validated transitions) — this board
 * is the team-wide visibility surface (brief §17: table/board view; server-side
 * rules regardless of UI).
 */
export default function TeamPipeline() {
  const constants = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });
  const boardQuery = useQuery({
    queryKey: ['redeem-ops', 'team-pipeline'],
    queryFn: redeemOpsApi.getTeamPipeline,
  });

  const stages = (constants.data?.pipelineStages || []).filter((s) => s !== 'UNCLAIMED');
  const partners = boardQuery.data?.partners || [];
  const byStage = {};
  for (const p of partners) {
    byStage[p.pipelineStage] = byStage[p.pipelineStage] || [];
    byStage[p.pipelineStage].push(p);
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everyone's opportunities by stage. Click a business to act on it.
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const items = byStage[stage] || [];
          if (items.length === 0 && ['NO_RESPONSE', 'NOT_INTERESTED', 'DISQUALIFIED'].includes(stage)) return null;
          return (
            <Card key={stage} className="min-w-64 w-64 shrink-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  {stage.replaceAll('_', ' ')}
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.slice(0, 30).map((p) => (
                  <Link
                    key={p.id}
                    to={`/redeem-ops/partners/${p.id}`}
                    className="block rounded-md border border-border p-2 hover:bg-accent transition-colors"
                  >
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {p.tradingName || p.brandName || p.legalName}
                      {(p.atRiskFlag || p.staleFlag) && (
                        <AlertTriangle className="w-3 h-3 text-amber-500" aria-hidden="true" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.owner?.fullName || 'Unowned'}
                      {p.category ? ` · ${p.category}` : ''}
                    </p>
                  </Link>
                ))}
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">Empty</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
