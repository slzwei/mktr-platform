import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { redeemOpsApi } from '@/api/redeemOps';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { RoPageHeader, RoAvatar, prettyEnum } from '@/components/redeemops/ui';

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
    <div className="p-6 md:p-8 space-y-5">
      <RoPageHeader
        title="Team pipeline"
        sub="Everyone's opportunities by stage. Click a business to act on it."
      />

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const items = byStage[stage] || [];
          if (items.length === 0 && ['NO_RESPONSE', 'NOT_INTERESTED', 'DISQUALIFIED'].includes(stage)) return null;
          return (
            <div key={stage} className="min-w-64 w-64 shrink-0">
              <div className="flex items-center justify-between px-1 pb-2">
                <p className="text-[12.5px] font-bold m-0" style={{ color: 'var(--ro-text-2)' }}>
                  {prettyEnum(stage)}
                </p>
                <span className="text-[11.5px] font-bold tabular-nums rounded-full px-2 py-0.5"
                  style={{ background: 'var(--ro-tag-gray-bg)', color: 'var(--ro-tag-gray-fg)' }}
                >
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.slice(0, 30).map((p) => (
                  <Link
                    key={p.id}
                    to={`/redeem-ops/partners/${p.id}`}
                    className="block rounded-xl border border-border bg-white p-3 hover:bg-[var(--ro-subtle)] transition-colors no-underline"
                  >
                    <p className="text-sm font-semibold flex items-center gap-1.5 m-0 text-foreground">
                      <span className="truncate">{p.tradingName || p.brandName || p.legalName}</span>
                      {(p.atRiskFlag || p.staleFlag) && (
                        <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: 'var(--ro-tag-yellow-fg)' }} aria-hidden="true" />
                      )}
                    </p>
                    <p className="text-xs m-0 mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--ro-text-2)' }}>
                      {p.owner?.fullName ? (
                        <>
                          <RoAvatar name={p.owner.fullName} size={18} />
                          {p.owner.fullName.split(/\s+/)[0]}
                        </>
                      ) : 'Unowned'}
                      {p.category ? <span className="truncate">· {p.category}</span> : null}
                    </p>
                  </Link>
                ))}
                {items.length === 0 && (
                  <p className="text-xs px-1 py-2 m-0" style={{ color: 'var(--ro-text-3)' }}>Empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
