import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { RoStatTile, RoEmpty, prettyEnum } from '@/components/redeemops/ui';

function partnerName(p) {
  return p?.tradingName || p?.brandName || p?.legalName || 'Business';
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function GroupLabel({ color, children }) {
  return <div className="ro-group-label" style={{ color }}>{children}</div>;
}

function DocketRow({ title, sub, when, whenColor, action }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-3 border-t border-border hover:bg-[var(--ro-subtle)] transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold m-0 truncate">{title}</p>
        <p className="text-xs m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-2)' }}>{sub}</p>
      </div>
      {when && (
        <span className="text-xs font-semibold whitespace-nowrap" style={{ color: whenColor || 'var(--ro-text-3)' }}>
          {when}
        </span>
      )}
      {action}
    </div>
  );
}

export default function MyQueue() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const queueQuery = useQuery({ queryKey: ['redeem-ops', 'queue'], queryFn: redeemOpsApi.getMyQueue });

  const completeMutation = useMutation({
    mutationFn: (taskId) => redeemOpsApi.updateTask(taskId, { status: 'completed' }),
    onSuccess: () => {
      toast.success('Task completed');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
    },
    onError: (err) => toast.error('Could not complete task', { description: err.message }),
  });

  const q = queueQuery.data;
  if (queueQuery.isLoading) {
    return <div className="p-8" style={{ color: 'var(--ro-text-2)' }}>Loading your queue…</div>;
  }
  if (!q) {
    return <div className="p-8" style={{ color: 'var(--ro-text-2)' }}>Queue unavailable.</div>;
  }

  const firstName = (user?.firstName || user?.fullName || '').split(/\s+/)[0] || 'there';
  const overdue = q.overdueTasks.items;
  const dueToday = q.dueTodayTasks.items;
  const awaiting = q.awaitingFirstOutreach.items;
  const replies = q.recentReplies.items;
  const upcoming = q.upcomingTasks.items;
  const stale = q.stalePartners.items;

  const todoToday = (q.overdueTasks.total || 0) + (q.dueTodayTasks.total || 0) + (q.awaitingFirstOutreach.total || 0);
  const empty = overdue.length + dueToday.length + awaiting.length + stale.length + replies.length + upcoming.length === 0;

  const doneButton = (task) => (
    <Button
      size="sm"
      variant="outline"
      className="ml-1 shrink-0"
      disabled={completeMutation.isPending}
      onClick={() => completeMutation.mutate(task.id)}
    >
      Done
    </Button>
  );
  const openButton = (partnerId) => (
    <Button size="sm" variant="outline" className="ml-1 shrink-0" asChild>
      <Link to={`/redeem-ops/partners/${partnerId}`}>Open</Link>
    </Button>
  );

  const taskSub = (t) => (
    <>
      <Link to={`/redeem-ops/partners/${t.partner?.id}`} className="ro-link">{partnerName(t.partner)}</Link>
      {t.contact?.name ? ` · ${t.contact.name}` : ''}
    </>
  );

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ro-title">{greeting()}, {firstName}</h1>
          <p className="ro-sub">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {todoToday === 0 ? 'nothing due — nice' : `${todoToday} thing${todoToday === 1 ? '' : 's'} to clear today`}
          </p>
        </div>
        <Button asChild>
          <Link to="/redeem-ops/pools">Claim next prospect</Link>
        </Button>
      </div>

      <div className="ro-tiles">
        <RoStatTile value={todoToday} label="To do today" />
        <RoStatTile value={q.overdueTasks.total || 0} label="Overdue" hot />
        <RoStatTile value={q.awaitingFirstOutreach.total || 0} label="Awaiting first touch" />
        <RoStatTile value={replies.length} label="Replies to answer" />
        <RoStatTile value={q.stalePartners.total || 0} label="Gone quiet" />
      </div>

      {empty ? (
        <RoEmpty
          title="You're all caught up"
          body="Nothing due right now. Pull your next prospect from a pool and keep the pipeline moving."
        >
          <Button asChild>
            <Link to="/redeem-ops/pools">Claim next prospect</Link>
          </Button>
        </RoEmpty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_316px] items-start">
          <div className="rounded-2xl border border-border overflow-hidden bg-white">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-base font-bold m-0">Today's docket</p>
              <span className="text-xs" style={{ color: 'var(--ro-text-3)' }}>Ordered by urgency</span>
            </div>

            {overdue.length > 0 && (
              <>
                <GroupLabel color="var(--ro-tag-red-fg)">Overdue</GroupLabel>
                {overdue.map((t) => (
                  <DocketRow
                    key={t.id}
                    title={t.title}
                    sub={taskSub(t)}
                    when={`Due ${new Date(t.dueAt).toLocaleDateString()}`}
                    whenColor="var(--ro-tag-red-fg)"
                    action={doneButton(t)}
                  />
                ))}
              </>
            )}

            {dueToday.length > 0 && (
              <>
                <GroupLabel color="var(--ro-bunker)">Due today</GroupLabel>
                {dueToday.map((t) => (
                  <DocketRow
                    key={t.id}
                    title={t.title}
                    sub={taskSub(t)}
                    when={t.hasTime ? new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today'}
                    action={doneButton(t)}
                  />
                ))}
              </>
            )}

            {awaiting.length > 0 && (
              <>
                <GroupLabel color="var(--ro-tag-yellow-fg)">Awaiting first touch</GroupLabel>
                {awaiting.map((p) => (
                  <DocketRow
                    key={p.id}
                    title={`Make first contact — ${partnerName(p)}`}
                    sub={`Claimed ${p.claimedAt ? new Date(p.claimedAt).toLocaleDateString() : 'recently'} · 48h window`}
                    when={p.atRiskFlag ? 'At risk' : 'Today'}
                    whenColor="var(--ro-tag-yellow-fg)"
                    action={openButton(p.id)}
                  />
                ))}
              </>
            )}

            {replies.length > 0 && (
              <>
                <GroupLabel color="var(--ro-tag-blue-fg)">Replied — keep the momentum</GroupLabel>
                {replies.map((r) => (
                  <DocketRow
                    key={r.id}
                    title={r.summary || prettyEnum(r.type)}
                    sub={`${r.partnerName} · ${prettyEnum(r.type)} · ${new Date(r.occurredAt).toLocaleDateString()}`}
                    when="Reply now"
                    whenColor="var(--ro-tag-blue-fg)"
                    action={openButton(r.partnerId)}
                  />
                ))}
              </>
            )}

            {upcoming.length > 0 && (
              <>
                <GroupLabel color="var(--ro-text-3)">Coming up (3 days)</GroupLabel>
                {upcoming.map((t) => (
                  <DocketRow
                    key={t.id}
                    title={t.title}
                    sub={taskSub(t)}
                    when={new Date(t.dueAt).toLocaleDateString(undefined, { weekday: 'short' })}
                    action={doneButton(t)}
                  />
                ))}
              </>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-white p-5">
              <p className="text-[15px] font-bold m-0">Need more prospects?</p>
              <p className="text-[13px] mt-1 mb-3.5 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
                Pull the next business from a pool — claiming is collision-safe, so the team can draw at once.
              </p>
              <Button asChild className="w-full">
                <Link to="/redeem-ops/pools">Claim next</Link>
              </Button>
            </div>

            {stale.length > 0 && (
              <div className="rounded-2xl border border-border bg-white overflow-hidden">
                <div className="px-5 pt-4 pb-2">
                  <p className="text-[15px] font-bold m-0">Gone quiet</p>
                  <p className="text-[13px] mt-1 m-0" style={{ color: 'var(--ro-text-2)' }}>
                    No activity in 14+ days. Revive or release.
                  </p>
                </div>
                {stale.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 px-5 py-2.5 border-t border-border">
                    <Link to={`/redeem-ops/partners/${p.id}`} className="text-sm font-semibold truncate text-foreground no-underline hover:underline">
                      {partnerName(p)}
                    </Link>
                    <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--ro-tag-red-fg)' }}>
                      {p.lastActivityAt
                        ? `${Math.max(1, Math.round((Date.now() - new Date(p.lastActivityAt)) / 86400000))}d`
                        : 'never'}
                    </span>
                  </div>
                ))}
                <Link to="/redeem-ops/partners" className="ro-link block px-5 py-3 border-t border-border text-[13px]">
                  See all partners
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
