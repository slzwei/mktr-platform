import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import X from 'lucide-react/icons/x';
import { RoMobileCard, RoPageHeader, RoTag, RoAvatar, prettyEnum } from '@/components/redeemops/ui';
import { CadenceChip, CadenceOutcomeButton } from '@/components/redeemops/cadence';

const VIEWS = [
  { key: 'today', label: 'Due today', params: { due: 'today' } },
  { key: 'overdue', label: 'Overdue', params: { due: 'overdue' } },
  { key: 'upcoming', label: 'Upcoming', params: { due: 'upcoming' } },
  { key: 'mine', label: 'All mine', params: {} },
  { key: 'completed', label: 'Completed', params: { status: 'completed' } },
  { key: 'team', label: 'Team', params: { scope: 'team', status: 'all' }, managerOnly: true },
];

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function dueLabel(t) {
  if (t.status === 'completed') {
    return { text: t.completedAt ? `Done ${new Date(t.completedAt).toLocaleDateString()}` : 'Done', color: 'var(--ro-tag-green-fg)' };
  }
  if (t.status === 'cancelled') return { text: 'Cancelled', color: 'var(--ro-text-3)' };
  const due = new Date(t.dueAt);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (due < today) {
    const days = Math.max(1, Math.round((today - due) / 86400000));
    return { text: `${days}d overdue`, color: 'var(--ro-tag-red-fg)' };
  }
  if (due < tomorrow) {
    return { text: t.hasTime ? due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today', color: 'var(--ro-tag-yellow-fg)' };
  }
  return { text: due.toLocaleDateString(), color: 'var(--ro-text-2)' };
}

/* Shared partner search-picker used by the New task dialog. */
function PartnerPicker({ value, onPick }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const results = useQuery({
    queryKey: ['redeem-ops', 'task-partner-search', debounced],
    queryFn: () => redeemOpsApi.listPartners({ limit: 6, ...(debounced ? { search: debounced } : {}) }),
  });
  const partners = results.data?.partners || [];
  return (
    <div className="space-y-2">
      <input
        className="ro-search w-full"
        placeholder="Search business by name, phone or UEN"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-48 overflow-y-auto rounded-xl border border-border">
        {partners.map((p) => {
          const name = p.tradingName || p.brandName || p.legalName;
          const selected = value?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="w-full flex items-center gap-2.5 px-3 py-2 border-t border-border first:border-t-0 cursor-pointer text-left"
              style={{ background: selected ? 'var(--ro-tag-blue-bg)' : '#fff' }}
            >
              <RoAvatar name={name} size={26} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{name}</span>
                <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>
                  {[p.category, p.owner?.fullName && `owned by ${p.owner.fullName}`].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
            </button>
          );
        })}
        {!results.isLoading && partners.length === 0 && (
          <p className="text-sm text-center py-4 m-0" style={{ color: 'var(--ro-text-2)' }}>No businesses match.</p>
        )}
      </div>
    </div>
  );
}

const EMPTY_TASK = { title: '', dueDate: '', priority: 'medium', assigneeUserId: '' };

export default function TasksPage() {
  const user = useAuthStore((s) => s.user);
  const isManager = hasCapability(user, 'pipeline.view_team');
  const queryClient = useQueryClient();
  // "View all n" on a business detail page deep-links here pre-filtered.
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerId = searchParams.get('partnerId') || '';
  const [view, setView] = useState(partnerId ? 'mine' : 'today');

  const activeView = VIEWS.find((v) => v.key === view) || VIEWS[0];
  const listParams = { ...activeView.params, ...(partnerId ? { partnerId } : {}) };
  const tasksQuery = useQuery({
    queryKey: ['redeem-ops', 'tasks', listParams],
    queryFn: () => redeemOpsApi.listTasks({ ...listParams, limit: 50 }),
    placeholderData: keepPreviousData,
  });
  const filterPartnerQuery = useQuery({
    queryKey: ['redeem-ops', 'partner', partnerId],
    queryFn: () => redeemOpsApi.getPartner(partnerId),
    enabled: !!partnerId,
  });
  const teamQuery = useQuery({
    queryKey: ['redeem-ops', 'team'],
    queryFn: redeemOpsApi.getTeam,
    enabled: isManager,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ taskId, body }) => redeemOpsApi.updateTask(taskId, body),
    onSuccess: () => { toast.success('Task updated'); invalidate(); },
    onError: (err) => toast.error('Update failed', { description: err.message }),
  });

  // ── New task ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [partner, setPartner] = useState(null);
  const [form, setForm] = useState(EMPTY_TASK);
  const createMutation = useMutation({
    mutationFn: () => redeemOpsApi.createTask({
      partnerOrganisationId: partner.id,
      title: form.title.trim(),
      dueAt: new Date(`${form.dueDate}T09:00:00`).toISOString(),
      priority: form.priority,
      ...(form.assigneeUserId ? { assigneeUserId: form.assigneeUserId } : {}),
    }),
    onSuccess: () => {
      toast.success('Task created');
      setCreateOpen(false); setPartner(null); setForm(EMPTY_TASK);
      invalidate();
    },
    onError: (err) => toast.error('Could not create task', { description: err.message }),
  });

  // ── Edit task ───────────────────────────────────────────────────────────
  const [editTask, setEditTask] = useState(null); // { id, title, dueDate, priority, assigneeUserId }
  const editMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateTask(editTask.id, {
      title: editTask.title.trim(),
      dueAt: new Date(`${editTask.dueDate}T09:00:00`).toISOString(),
      priority: editTask.priority,
      ...(isManager && editTask.assigneeUserId ? { assigneeUserId: editTask.assigneeUserId } : {}),
    }),
    onSuccess: () => { toast.success('Task updated'); setEditTask(null); invalidate(); },
    onError: (err) => toast.error('Could not update task', { description: err.message }),
  });

  const tasks = tasksQuery.data?.tasks || [];
  const team = (teamQuery.data || []).filter((m) => m.isActive);
  const showStatus = view === 'mine' || view === 'team' || view === 'completed';

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <RoPageHeader
        title="Tasks"
        sub="Your follow-ups across every business — completed ones live in their own tab."
        actions={(
          <Button onClick={() => { setCreateOpen(true); setPartner(null); setForm(EMPTY_TASK); }}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New task
          </Button>
        )}
      />

      <Tabs value={view} onValueChange={setView}>
        <div className="max-w-full overflow-x-auto">
        <TabsList className="w-max">
          {VIEWS.filter((v) => !v.managerOnly || isManager).map((v) => (
            <TabsTrigger key={v.key} value={v.key}>{v.label}</TabsTrigger>
          ))}
        </TabsList>
        </div>
      </Tabs>

      {partnerId && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold"
          style={{ background: 'var(--ro-tag-blue-bg)', color: 'var(--ro-tag-blue-fg)' }}
        >
          {filterPartnerQuery.data
            ? (filterPartnerQuery.data.tradingName || filterPartnerQuery.data.brandName || filterPartnerQuery.data.legalName)
            : 'One business'}
          <button
            type="button"
            aria-label="Clear business filter"
            className="grid place-items-center rounded-full cursor-pointer border-0 bg-transparent p-0"
            onClick={() => setSearchParams({}, { replace: true })}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </span>
      )}

      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="md:hidden">
          {tasks.map((t) => {
            const due = dueLabel(t);
            const open = t.status === 'open' || t.status === 'in_progress';
            return (
              <RoMobileCard key={t.id}>
                <p className="text-[14px] font-semibold m-0 leading-tight">{t.title}</p>
                <p className="text-xs m-0 mt-0.5 truncate">
                  <Link to={`/redeem-ops/partners/${t.partner?.id}`} className="ro-link">
                    {t.partner?.tradingName || t.partner?.brandName || t.partner?.legalName || '—'}
                  </Link>
                  {view === 'team' && t.assignee?.fullName ? (
                    <span style={{ color: 'var(--ro-text-3)' }}> · {t.assignee.fullName}</span>
                  ) : null}
                </p>
                <span className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[12.5px] font-semibold" style={{ color: due.color }}>{due.text}</span>
                  <RoTag tone={t.priority} size="sm">{t.priority}</RoTag>
                  {showStatus && <RoTag tone={t.status} size="sm">{prettyEnum(t.status)}</RoTag>}
                  {t.cadenceStep && <CadenceChip task={t} />}
                  <span className="ml-auto inline-flex gap-1">
                    {open && (t.cadenceStep ? (
                      <CadenceOutcomeButton task={t} />
                    ) : (
                      <>
                        <Button
                          size="sm" variant="outline"
                          disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'completed' } })}
                        >
                          Complete
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          aria-label="Edit task"
                          onClick={() => setEditTask({
                            id: t.id,
                            title: t.title,
                            dueDate: new Date(t.dueAt).toISOString().slice(0, 10),
                            priority: t.priority,
                            assigneeUserId: t.assigneeUserId || '',
                          })}
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </>
                    ))}
                    {t.status === 'completed' && !t.cadenceStep && (
                      <Button
                        size="sm" variant="ghost"
                        disabled={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'open' } })}
                      >
                        Reopen
                      </Button>
                    )}
                  </span>
                </span>
              </RoMobileCard>
            );
          })}
          {!tasksQuery.isLoading && tasks.length === 0 && (
            <p className="text-sm text-center py-10 m-0" style={{ color: 'var(--ro-text-2)' }}>Nothing here.</p>
          )}
        </div>
        <div className="hidden md:block px-2 py-1">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Priority</TableHead>
                  {showStatus && <TableHead>Status</TableHead>}
                  {view === 'team' && <TableHead>Assignee</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => {
                  const due = dueLabel(t);
                  const open = t.status === 'open' || t.status === 'in_progress';
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.title}</TableCell>
                      <TableCell>
                        <Link to={`/redeem-ops/partners/${t.partner?.id}`} className="ro-link text-sm">
                          {t.partner?.tradingName || t.partner?.brandName || t.partner?.legalName || '—'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="text-[12.5px] font-semibold" style={{ color: due.color }}>{due.text}</span>
                      </TableCell>
                      <TableCell>
                        <RoTag tone={t.priority} size="sm">{t.priority}</RoTag>
                      </TableCell>
                      {showStatus && (
                        <TableCell>
                          <RoTag tone={t.status} size="sm">{prettyEnum(t.status)}</RoTag>
                        </TableCell>
                      )}
                      {view === 'team' && (
                        <TableCell className="text-muted-foreground text-sm">{t.assignee?.fullName || '—'}</TableCell>
                      )}
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        {open && (t.cadenceStep ? (
                          <CadenceOutcomeButton task={t} />
                        ) : (
                          <>
                            <Button
                              size="sm" variant="outline"
                              disabled={updateMutation.isPending}
                              onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'completed' } })}
                            >
                              Complete
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              aria-label="Edit task"
                              onClick={() => setEditTask({
                                id: t.id,
                                title: t.title,
                                dueDate: new Date(t.dueAt).toISOString().slice(0, 10),
                                priority: t.priority,
                                assigneeUserId: t.assigneeUserId || '',
                              })}
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={updateMutation.isPending}
                              onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'cancelled' } })}
                            >
                              Cancel
                            </Button>
                          </>
                        ))}
                        {t.status === 'completed' && !t.cadenceStep && (
                          <Button
                            size="sm" variant="ghost"
                            disabled={updateMutation.isPending}
                            onClick={() => updateMutation.mutate({ taskId: t.id, body: { status: 'open' } })}
                          >
                            Reopen
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!tasksQuery.isLoading && tasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      Nothing here.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {partner ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2">
                <RoAvatar name={partner.tradingName || partner.brandName || partner.legalName} size={26} />
                <span className="text-sm font-semibold flex-1 truncate">
                  {partner.tradingName || partner.brandName || partner.legalName}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPartner(null)}>Change</Button>
              </div>
            ) : (
              <PartnerPicker value={partner} onPick={setPartner} />
            )}
            <div className="space-y-1.5">
              <Label>What needs doing? *</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Follow up on proposal" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Due date *</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(priority) => setForm((f) => ({ ...f, priority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isManager && team.length > 0 && (
              <div className="space-y-1.5">
                <Label>Assign to</Label>
                <Select value={form.assigneeUserId} onValueChange={(assigneeUserId) => setForm((f) => ({ ...f, assigneeUserId }))}>
                  <SelectTrigger><SelectValue placeholder="Myself" /></SelectTrigger>
                  <SelectContent>
                    {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName || m.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={!partner || !form.title.trim() || !form.dueDate || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Saving…' : 'Create task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTask} onOpenChange={(open) => { if (!open) setEditTask(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
          </DialogHeader>
          {editTask && (
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={editTask.title} onChange={(e) => setEditTask((t) => ({ ...t, title: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Due date *</Label>
                  <Input type="date" value={editTask.dueDate} onChange={(e) => setEditTask((t) => ({ ...t, dueDate: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={editTask.priority} onValueChange={(priority) => setEditTask((t) => ({ ...t, priority }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {isManager && team.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Assignee</Label>
                  <Select value={editTask.assigneeUserId} onValueChange={(assigneeUserId) => setEditTask((t) => ({ ...t, assigneeUserId }))}>
                    <SelectTrigger><SelectValue placeholder="Unchanged" /></SelectTrigger>
                    <SelectContent>
                      {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName || m.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!editTask?.title?.trim() || !editTask?.dueDate || editMutation.isPending}
              onClick={() => editMutation.mutate()}
            >
              {editMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
