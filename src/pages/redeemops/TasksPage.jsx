import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { RoPageHeader, RoTag } from '@/components/redeemops/ui';

const VIEWS = [
  { key: 'today', label: 'Due today', params: { due: 'today' } },
  { key: 'overdue', label: 'Overdue', params: { due: 'overdue' } },
  { key: 'upcoming', label: 'Upcoming', params: { due: 'upcoming' } },
  { key: 'mine', label: 'All mine', params: {} },
  { key: 'team', label: 'Team', params: { scope: 'team' }, managerOnly: true },
];

export default function TasksPage() {
  const user = useAuthStore((s) => s.user);
  const isManager = hasCapability(user, 'pipeline.view_team');
  const queryClient = useQueryClient();
  const [view, setView] = useState('today');

  const activeView = VIEWS.find((v) => v.key === view) || VIEWS[0];
  const tasksQuery = useQuery({
    queryKey: ['redeem-ops', 'tasks', activeView.params],
    queryFn: () => redeemOpsApi.listTasks({ ...activeView.params, limit: 50 }),
    placeholderData: keepPreviousData,
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, body }) => redeemOpsApi.updateTask(taskId, body),
    onSuccess: () => {
      toast.success('Task updated');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
    },
    onError: (err) => toast.error('Update failed', { description: err.message }),
  });

  const tasks = tasksQuery.data?.tasks || [];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-5">
      <RoPageHeader
        title="Tasks"
        sub="Follow-ups are tasks, not notes — create them from a partner's page."
      />

      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          {VIEWS.filter((v) => !v.managerOnly || isManager).map((v) => (
            <TabsTrigger key={v.key} value={v.key}>{v.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="px-2 py-1">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Priority</TableHead>
                  {view === 'team' && <TableHead>Assignee</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>
                      <Link to={`/redeem-ops/partners/${t.partner?.id}`} className="ro-link text-sm">
                        {t.partner?.tradingName || t.partner?.brandName || t.partner?.legalName || '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(t.dueAt).toLocaleDateString()}
                      {t.hasTime ? ` ${new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </TableCell>
                    <TableCell>
                      <RoTag tone={t.priority} size="sm">{t.priority}</RoTag>
                    </TableCell>
                    {view === 'team' && (
                      <TableCell className="text-muted-foreground text-sm">{t.assignee?.fullName || '—'}</TableCell>
                    )}
                    <TableCell className="text-right space-x-1">
                      {t.status !== 'completed' && (
                        <Button
                          size="sm" variant="outline"
                          disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'completed' } })}
                        >
                          Complete
                        </Button>
                      )}
                      {t.status === 'open' && (
                        <Button
                          size="sm" variant="ghost"
                          disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'cancelled' } })}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!tasksQuery.isLoading && tasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={view === 'team' ? 6 : 5} className="text-center text-muted-foreground py-10">
                      Nothing here.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
