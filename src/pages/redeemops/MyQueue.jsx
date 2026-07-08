import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function partnerName(p) {
  return p?.tradingName || p?.brandName || p?.legalName || 'Business';
}

function TaskRow({ task, onComplete, completing }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          <Link to={`/redeem-ops/partners/${task.partner?.id}`} className="underline">
            {partnerName(task.partner)}
          </Link>
          {' · due '}
          {new Date(task.dueAt).toLocaleDateString()}
          {task.contact?.name ? ` · ${task.contact.name}` : ''}
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={completing} onClick={() => onComplete(task.id)}>
        Done
      </Button>
    </div>
  );
}

function PartnerRow({ partner, note }) {
  return (
    <div className="py-2 border-b border-border last:border-0">
      <p className="text-sm font-medium">
        <Link to={`/redeem-ops/partners/${partner.id}`} className="underline">
          {partnerName(partner)}
        </Link>
      </p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Bucket({ title, description, count, children, tone }) {
  return (
    <Card className={tone === 'warn' ? 'border-amber-300' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {title}
          {count > 0 && <Badge variant={tone === 'warn' ? 'destructive' : 'secondary'}>{count}</Badge>}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function MyQueue() {
  const queryClient = useQueryClient();
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
  if (queueQuery.isLoading) return <div className="p-6 text-muted-foreground">Loading your queue…</div>;
  if (!q) return <div className="p-6 text-muted-foreground">Queue unavailable.</div>;

  const empty =
    q.overdueTasks.items.length + q.dueTodayTasks.items.length + q.awaitingFirstOutreach.items.length +
    q.stalePartners.items.length + q.recentReplies.items.length + q.upcomingTasks.items.length === 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My queue</h1>
        <p className="text-sm text-muted-foreground mt-1">Start here — this is your day, in order of urgency.</p>
      </div>

      {empty && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Queue clear 🎉 — grab a new prospect from a <Link to="/redeem-ops/pools" className="underline">pool</Link> or
            search <Link to="/redeem-ops/partners" className="underline">Partners</Link>.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {q.overdueTasks.items.length > 0 && (
          <Bucket title="Overdue" description="Follow-ups past their due date" count={q.overdueTasks.total} tone="warn">
            {q.overdueTasks.items.map((t) => (
              <TaskRow key={t.id} task={t} onComplete={completeMutation.mutate} completing={completeMutation.isPending} />
            ))}
          </Bucket>
        )}
        {q.dueTodayTasks.items.length > 0 && (
          <Bucket title="Due today" description="Scheduled for today" count={q.dueTodayTasks.total}>
            {q.dueTodayTasks.items.map((t) => (
              <TaskRow key={t.id} task={t} onComplete={completeMutation.mutate} completing={completeMutation.isPending} />
            ))}
          </Bucket>
        )}
        {q.awaitingFirstOutreach.items.length > 0 && (
          <Bucket
            title="Awaiting first outreach"
            description="Claimed but not yet contacted — reach out within 48h"
            count={q.awaitingFirstOutreach.total}
            tone="warn"
          >
            {q.awaitingFirstOutreach.items.map((p) => (
              <PartnerRow
                key={p.id}
                partner={p}
                note={`Claimed ${p.claimedAt ? new Date(p.claimedAt).toLocaleDateString() : 'recently'}${p.atRiskFlag ? ' · AT RISK' : ''}`}
              />
            ))}
          </Bucket>
        )}
        {q.recentReplies.items.length > 0 && (
          <Bucket title="Recent replies" description="They responded — keep the momentum" count={q.recentReplies.items.length}>
            {q.recentReplies.items.map((r) => (
              <div key={r.id} className="py-2 border-b border-border last:border-0">
                <p className="text-sm font-medium">
                  <Link to={`/redeem-ops/partners/${r.partnerId}`} className="underline">{r.partnerName}</Link>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.type.replaceAll('_', ' ')} · {r.summary} · {new Date(r.occurredAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </Bucket>
        )}
        {q.upcomingTasks.items.length > 0 && (
          <Bucket title="Coming up (3 days)" description="What's next after today">
            {q.upcomingTasks.items.map((t) => (
              <TaskRow key={t.id} task={t} onComplete={completeMutation.mutate} completing={completeMutation.isPending} />
            ))}
          </Bucket>
        )}
        {q.stalePartners.items.length > 0 && (
          <Bucket title="Gone quiet" description="No activity in 14+ days — revive or release" count={q.stalePartners.total} tone="warn">
            {q.stalePartners.items.map((p) => (
              <PartnerRow
                key={p.id}
                partner={p}
                note={`Last activity ${p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleDateString() : 'never'} · ${p.pipelineStage.replaceAll('_', ' ')}`}
              />
            ))}
          </Bucket>
        )}
      </div>
    </div>
  );
}
