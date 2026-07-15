import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Zap from 'lucide-react/icons/zap';
import Eye from 'lucide-react/icons/eye';
import Plus from 'lucide-react/icons/plus';
import Check from 'lucide-react/icons/check';
import Copy from 'lucide-react/icons/copy';
import Ellipsis from 'lucide-react/icons/ellipsis';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { RoTag } from '@/components/redeemops/ui';

export const CADENCES_ENABLED = import.meta.env.VITE_REDEEM_OPS_CADENCES_ENABLED === 'true';

/** Mirror of backend CHANNEL_DISPOSITIONS (constants.js) — the buttons a rep sees. */
const CHANNEL_DISPOSITIONS = {
  call: ['connected', 'no_answer', 'not_interested', 'replied'],
  whatsapp: ['sent', 'replied', 'not_interested'],
  email: ['sent', 'replied', 'not_interested'],
  instagram_dm: ['sent', 'replied', 'not_interested'],
  visit: ['met', 'closed', 'not_interested'],
  custom: ['done', 'not_interested'],
};

const DISPOSITION_LABELS = {
  connected: 'Connected', no_answer: 'No answer', sent: 'Sent', replied: 'They replied',
  not_interested: 'Not interested', met: 'Met in person', closed: 'Outlet closed', done: 'Done',
};

const CHANNEL_LABELS = {
  call: 'Call', whatsapp: 'WhatsApp', email: 'Email',
  instagram_dm: 'Instagram DM', visit: 'Visit', custom: 'Step',
};

/* The rail shows at most this many rows; the rest sit behind "View all n". */
const MAX_VISIBLE_TASKS = 4;

function invalidateCadenceData(queryClient, partnerId) {
  queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
  queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
  if (partnerId) {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner-cadence', partnerId] });
  }
}

/**
 * Due label per the Cadence & Tasks spec: overdue reads "Overdue · 14 Jul" in
 * red, today/tomorrow are words, anything later is "Wed 18 Jul" in gray.
 */
export function taskDueMeta(task) {
  const due = new Date(task.dueAt);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
  if (due < today) {
    return {
      text: `Overdue · ${due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
      color: 'var(--ro-tag-red-fg, #BD3A2E)',
      overdue: true,
    };
  }
  if (due < tomorrow) return { text: 'Due today', color: 'var(--ro-bunker, #0D1619)', overdue: false };
  if (due < dayAfter) return { text: 'Due tomorrow', color: 'var(--ro-text-2)', overdue: false };
  return {
    text: due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    color: 'var(--ro-text-2)',
    overdue: false,
  };
}

async function copyTaskMessage(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Message copied');
  } catch {
    toast.error('Could not copy — select the text instead');
  }
}

/** Small pill marking a task as cadence-driven: "⚡ F&B call-first · 3". */
export function CadenceChip({ task }) {
  const step = task?.cadenceStep;
  if (!step) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold align-middle"
      style={{ background: 'var(--ro-subtle)', color: 'var(--ro-text-2)' }}
      title={`${step.cadence?.name || 'Cadence'} — step ${step.stepOrder}`}
    >
      <Zap className="w-3 h-3" aria-hidden="true" />
      {step.cadence?.name || 'Cadence'} · {step.stepOrder}
    </span>
  );
}

/**
 * The one-tap completion for cadence tasks (docs/plans/redeem-ops-cadences.md §8.1):
 * an "Outcome" menu with only the channel-valid dispositions. One choice
 * completes the task, logs the honest activity, and schedules the next step.
 * `not_interested` confirms first and offers marking the business Lost in the
 * same transaction. `disabled` freezes the button (paused enrollment).
 */
export function CadenceOutcomeButton({ task, size = 'sm', disabled = false, disabledHint }) {
  const queryClient = useQueryClient();
  const [confirmNI, setConfirmNI] = useState(false);
  const [alsoMarkLost, setAlsoMarkLost] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(false);

  const channel = task?.cadenceStep?.channel || 'custom';
  const dispositions = CHANNEL_DISPOSITIONS[channel] || CHANNEL_DISPOSITIONS.custom;

  const completeMutation = useMutation({
    mutationFn: (body) => redeemOpsApi.completeCadenceTask(task.id, body),
    onSuccess: (data) => {
      setConfirmNI(false);
      const next = data?.nextTask;
      if (next) {
        toast.success('Logged — next step scheduled', {
          description: `${next.title} · ${new Date(next.dueAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`,
        });
      } else {
        toast.success('Logged — cadence finished for this business');
      }
      invalidateCadenceData(queryClient, task.partnerOrganisationId || task.partner?.id);
    },
    onError: (err) => toast.error('Could not record the outcome', { description: err.message }),
  });

  const pick = (disposition) => {
    if (disposition === 'not_interested') {
      setAlsoMarkLost(true);
      setConfirmNI(true);
      return;
    }
    completeMutation.mutate({ disposition });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={size}
            variant="outline"
            className="ml-1 shrink-0"
            disabled={completeMutation.isPending || disabled}
            title={disabled ? disabledHint : undefined}
          >
            {completeMutation.isPending ? 'Saving…' : 'Outcome'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{CHANNEL_LABELS[channel]} — what happened?</DropdownMenuLabel>
          {dispositions.map((dsp) => (
            <DropdownMenuItem key={dsp} onSelect={() => pick(dsp)}>
              {DISPOSITION_LABELS[dsp] || dsp}
            </DropdownMenuItem>
          ))}
          {(task.description || task.snapshotRecipient) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setScriptOpen(true)}>
                <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> View script
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmNI} onOpenChange={setConfirmNI}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Not interested</DialogTitle>
            <DialogDescription>
              This ends the cadence for the business. You can revive it later from the pipeline.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={alsoMarkLost} onCheckedChange={(v) => setAlsoMarkLost(!!v)} />
            Also move the business to Lost
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNI(false)}>Back</Button>
            <Button
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate({
                disposition: 'not_interested',
                alsoMarkLost,
                ...(alsoMarkLost ? { lostReason: 'not_interested' } : {}),
              })}
            >
              {completeMutation.isPending ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{task.title}</DialogTitle>
            {task.snapshotRecipient && (
              <DialogDescription>To: {task.snapshotRecipient}</DialogDescription>
            )}
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap m-0" style={{ color: 'var(--ro-text-2)' }}>
            {task.description || 'No script for this step.'}
          </p>
          {task.description && (
            <DialogFooter>
              <Button variant="outline" onClick={() => copyTaskMessage(task.description)}>
                <Copy className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Copy message
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* 18px circle checkbox — one click completes a manual task (strike + fade
   while the mutation is in flight, the invalidate removes the row). */
function CompleteCircle({ task, busy, onComplete }) {
  return (
    <button
      type="button"
      aria-label={`Complete ${task.title}`}
      disabled={busy}
      onClick={() => onComplete(task.id)}
      className="shrink-0 mt-0.5 grid place-items-center rounded-full transition-colors cursor-pointer"
      style={{
        width: 18, height: 18, padding: 0,
        border: `1.8px solid ${busy ? 'var(--ro-azure, #037AFF)' : 'var(--ro-border-strong)'}`,
        background: busy ? 'var(--ro-azure, #037AFF)' : '#fff',
      }}
    >
      {busy && <Check className="w-3 h-3" strokeWidth={3} style={{ color: '#fff' }} aria-hidden="true" />}
    </button>
  );
}

/* Inline template message under a task row (design: the copyable script box —
   the rep reads/copies the DM text without opening anything). Long scripts
   clamp to three lines behind a Show more toggle. */
const SCRIPT_CLAMP_CHARS = 140;

function TaskScriptBox({ text }) {
  const [expanded, setExpanded] = useState(false);
  const clampable = text.length > SCRIPT_CLAMP_CHARS || text.split('\n').length > 3;
  return (
    <div className="mt-2 rounded-[10px] px-3 py-2" style={{ background: 'var(--ro-subtle)' }}>
      <p
        className={`text-xs leading-relaxed m-0 whitespace-pre-wrap ${clampable && !expanded ? 'line-clamp-3' : ''}`}
        style={{ color: 'var(--ro-text-2)' }}
      >
        {text}
      </p>
      <div className="flex items-center justify-between gap-2 mt-2">
        {clampable && (
          <button
            type="button"
            className="ro-link p-0 border-0 bg-transparent text-[11.5px] font-semibold cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-[26px] px-2.5 text-[11.5px] font-medium"
          onClick={() => copyTaskMessage(text)}
        >
          <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy message
        </Button>
      </div>
    </div>
  );
}

/* One outstanding-task row in the rail card (spec note ③/④). */
function PartnerTaskRow({
  task, viewerId, canManage, frozen, terminal, onEditTask, onComplete, onCancel, completingId,
}) {
  const isCadence = !!task.cadenceStep;
  const due = taskDueMeta(task);
  const completing = completingId === task.id;
  const assigneeNote = task.assignee && task.assignee.id !== viewerId ? task.assignee.fullName : null;

  return (
    <div
      className={`relative flex items-start gap-2.5 px-5 py-3 border-t transition-opacity duration-300 ${frozen ? 'opacity-55' : ''} ${completing ? 'opacity-40' : ''}`}
      style={{ borderTopColor: '#F0F2F4' }}
    >
      {due.overdue && !frozen && (
        <span
          aria-hidden="true"
          className="absolute left-0 w-[3px] rounded-r"
          style={{ top: 9, bottom: 9, background: 'var(--ro-tag-red-fg, #BD3A2E)' }}
        />
      )}
      {!isCadence && canManage && (
        <CompleteCircle task={task} busy={completing} onComplete={onComplete} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[13.5px] font-semibold m-0 leading-snug flex-1 min-w-0 ${completing ? 'line-through' : ''}`}>
            {task.title}
          </p>
          {isCadence && canManage && (
            <span className="-mt-0.5">
              <CadenceOutcomeButton task={task} disabled={frozen} disabledHint="Cadence paused" />
            </span>
          )}
          {!isCadence && canManage && !terminal && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="-mt-0.5 h-7 w-7 p-0 shrink-0" aria-label={`Actions for ${task.title}`}>
                  <Ellipsis className="w-4 h-4" style={{ color: 'var(--ro-text-3)' }} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEditTask && (
                  <DropdownMenuItem onSelect={() => onEditTask(task)}>Edit task</DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onCancel(task.id)}
                >
                  Cancel task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          {isCadence && <CadenceChip task={task} />}
          <span className="text-xs font-semibold" style={{ color: due.color }}>{due.text}</span>
          {task.snapshotRecipient && (
            <span className="text-xs" style={{ color: 'var(--ro-text-3)' }}>→ {task.snapshotRecipient}</span>
          )}
          {assigneeNote && (
            <span className="text-xs" style={{ color: 'var(--ro-text-3)' }}>for {assigneeNote}</span>
          )}
          {frozen && (
            <span className="text-[11px] italic" style={{ color: 'var(--ro-text-3)' }}>paused</span>
          )}
        </div>
        {task.description && <TaskScriptBox text={task.description} />}
      </div>
    </div>
  );
}

/**
 * Partner Detail "Cadence & Tasks" rail section (design: claude.ai/design
 * "Business Detail - Cadence & Tasks"): one card, two zones. Zone 1 is the
 * cadence state (enrollment + step progress + Pause/Resume/Stop, or the
 * Enroll picker; hidden while the feature flag is off). Zone 2 lists every
 * outstanding task on the business — the live cadence task first (actionable
 * via the Outcome menu), then manual tasks with one-click complete. The
 * passive "Next: …" line is gone; the task row replaced it.
 * `variant="summary"` renders the compact actionable mobile strip.
 */
export function CadencePanel({ partner, canManage = true, variant = 'card', onAddTask, onEditTask }) {
  const queryClient = useQueryClient();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [stripExpanded, setStripExpanded] = useState(false);
  const partnerId = partner?.id;
  const authUser = useAuthStore((s) => s.user);
  // Anyone who works tasks can author; unpublished saves stay private drafts.
  const canAuthor = hasCapability(authUser, 'tasks.manage');

  const cadenceQuery = useQuery({
    queryKey: ['redeem-ops', 'partner-cadence', partnerId],
    queryFn: () => redeemOpsApi.getPartnerCadence(partnerId),
    enabled: CADENCES_ENABLED && !!partnerId,
  });
  // Outstanding tasks on THIS business. scope:'team' lets managers see every
  // assignee's tasks; the backend ignores it for non-managers (own tasks only).
  const tasksQuery = useQuery({
    queryKey: ['redeem-ops', 'tasks', { partnerId }],
    queryFn: () => redeemOpsApi.listTasks({ partnerId, scope: 'team' }),
    enabled: !!partnerId,
  });
  const defsQuery = useQuery({
    queryKey: ['redeem-ops', 'cadences'],
    // Wrapped: a bare reference would receive React Query's context object as
    // the params arg and leak it into the query string.
    queryFn: () => redeemOpsApi.listCadences(),
    enabled: CADENCES_ENABLED && enrollOpen,
  });
  const cadenceDefs = defsQuery.data?.cadences || [];

  const enrollMutation = useMutation({
    mutationFn: (body) => redeemOpsApi.enrollCadence(partnerId, body),
    onSuccess: (data) => {
      setEnrollOpen(false);
      toast.success(data?.finishedImmediately
        ? 'Enrolled — but every step was blocked (check phone/handle on record)'
        : 'Cadence started — first task is in the queue');
      invalidateCadenceData(queryClient, partnerId);
    },
    onError: (err) => toast.error('Could not enroll', { description: err.message }),
  });
  const pauseMutation = useMutation({
    mutationFn: () => redeemOpsApi.pauseCadence(partnerId),
    onSuccess: () => { toast.success('Cadence paused'); invalidateCadenceData(queryClient, partnerId); },
    onError: (err) => toast.error('Could not pause', { description: err.message }),
  });
  const resumeMutation = useMutation({
    mutationFn: () => redeemOpsApi.resumeCadence(partnerId),
    onSuccess: () => { toast.success('Cadence resumed'); invalidateCadenceData(queryClient, partnerId); },
    onError: (err) => toast.error('Could not resume', { description: err.message }),
  });
  const stopMutation = useMutation({
    mutationFn: () => redeemOpsApi.stopCadence(partnerId),
    onSuccess: () => { toast.success('Cadence stopped'); invalidateCadenceData(queryClient, partnerId); },
    onError: (err) => toast.error('Could not stop', { description: err.message }),
  });
  const completeTaskMutation = useMutation({
    mutationFn: (taskId) => redeemOpsApi.updateTask(taskId, { status: 'completed' }),
    onSuccess: () => { toast.success('Task completed'); invalidateCadenceData(queryClient, partnerId); },
    onError: (err) => toast.error('Could not complete the task', { description: err.message }),
  });
  const cancelTaskMutation = useMutation({
    mutationFn: (taskId) => redeemOpsApi.updateTask(taskId, { status: 'cancelled' }),
    onSuccess: () => { toast.success('Task cancelled'); invalidateCadenceData(queryClient, partnerId); },
    onError: (err) => toast.error('Could not cancel the task', { description: err.message }),
  });

  if (!partnerId) return null;

  const enrollment = CADENCES_ENABLED ? cadenceQuery.data?.enrollment : null;
  const live = enrollment && ['active', 'paused'].includes(enrollment.state);
  const paused = enrollment?.state === 'paused';
  const steps = enrollment?.cadence?.steps || [];
  const currentOrder = enrollment?.currentStep?.stepOrder || 0;
  const terminalStage = ['PARTNERED', 'LOST'].includes(partner?.pipelineStage);

  // Rows: the live cadence task always leads; manual tasks follow in the
  // backend's dueAt-ascending order (overdue first by construction).
  const openTasks = (tasksQuery.data?.tasks || [])
    .filter((t) => t.status === 'open' || t.status === 'in_progress');
  const cadenceTask = openTasks.find((t) => t.cadenceStep);
  const manualTasks = openTasks.filter((t) => !t.cadenceStep);
  const rows = [...(cadenceTask ? [cadenceTask] : []), ...manualTasks];
  const overdueCount = rows.reduce((n, t) => n + (taskDueMeta(t).overdue ? 1 : 0), 0);
  const visibleRows = rows.slice(0, MAX_VISIBLE_TASKS);
  const truncated = rows.length > MAX_VISIBLE_TASKS;

  const completingId = completeTaskMutation.isPending ? completeTaskMutation.variables : null;
  const completeTask = (taskId) => completeTaskMutation.mutate(taskId);
  const cancelTask = (taskId) => {
    if (window.confirm('Cancel this task? It stays on the timeline as cancelled.')) {
      cancelTaskMutation.mutate(taskId);
    }
  };
  const rowProps = {
    viewerId: authUser?.id,
    canManage,
    terminal: terminalStage,
    onEditTask,
    onComplete: completeTask,
    onCancel: cancelTask,
    completingId,
  };

  const enrollButton = CADENCES_ENABLED && canManage && !terminalStage && (
    <Button
      size="sm"
      className={variant === 'summary' ? 'shrink-0' : 'w-full'}
      disabled={!partner?.ownerUserId}
      title={partner?.ownerUserId ? undefined : 'Claim the business first'}
      onClick={() => setEnrollOpen(true)}
    >
      Start cadence
    </Button>
  );

  /* ── Zone 1: cadence state (flag-gated) ── */
  const cadenceZone = CADENCES_ENABLED && (
    <div className="px-5 pt-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[15px] font-bold m-0 inline-flex items-center gap-1.5">
          <Zap className="w-4 h-4" aria-hidden="true" /> Cadence
        </p>
        {live && (
          <RoTag tone={paused ? 'paused' : 'open'} size="sm">{enrollment.state}</RoTag>
        )}
      </div>
      {cadenceQuery.isLoading ? (
        <p className="text-[13px] m-0" style={{ color: 'var(--ro-text-2)' }}>Loading…</p>
      ) : live ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13.5px] font-semibold m-0 truncate">
              {enrollment.cadence?.name}
              <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}> · v{enrollment.cadence?.version}</span>
            </p>
            {steps.length > 0 && (
              <span className="text-[11.5px] font-semibold shrink-0" style={{ color: 'var(--ro-text-3)' }}>
                Step {currentOrder} of {steps.length}
              </span>
            )}
          </div>
          {steps.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2.5" aria-label={`Step ${currentOrder} of ${steps.length}`}>
              {steps.map((s) => (
                <span
                  key={s.id}
                  className="h-1.5 rounded-full flex-1"
                  title={`${s.stepOrder}. ${s.title}`}
                  style={{
                    background: s.stepOrder < currentOrder
                      ? 'var(--ro-azure, #037AFF)'
                      : s.stepOrder === currentOrder ? 'var(--ro-bunker, #0D1619)' : 'var(--ro-subtle)',
                  }}
                />
              ))}
            </div>
          )}
          {paused && (
            <p className="text-[12.5px] mt-2 mb-0" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
              Paused — no tasks will be scheduled until resumed.
            </p>
          )}
          {canManage && (
            <div className="flex gap-1.5 mt-3">
              {enrollment.state === 'active' ? (
                <Button size="sm" variant="outline" disabled={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>Pause</Button>
              ) : (
                <Button size="sm" variant="outline" disabled={resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>Resume</Button>
              )}
              <Button size="sm" variant="ghost" disabled={stopMutation.isPending} onClick={() => stopMutation.mutate()}>Stop</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px] m-0 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
            {enrollment
              ? `Last cadence ${enrollment.state === 'completed' ? 'finished' : `ended (${(enrollment.exitReason || '').replace(/_/g, ' ')})`}.`
              : 'No cadence yet — enroll to auto-schedule every follow-up touch.'}
          </p>
          {enrollButton && <div className="mt-3">{enrollButton}</div>}
        </>
      )}
    </div>
  );

  /* ── Zone 2: outstanding tasks on this business ── */
  const tasksZone = (
    <div className={CADENCES_ENABLED ? 'mt-4 border-t border-border' : ''}>
      <div className="flex items-baseline justify-between gap-2 px-5 pt-3 pb-1">
        <p className="text-[12.5px] font-bold m-0">
          Tasks{rows.length > 0 && <span className="font-semibold" style={{ color: 'var(--ro-text-3)' }}> · {rows.length}</span>}
        </p>
        {overdueCount > 0 && (
          <span className="text-[11.5px] font-semibold" style={{ color: 'var(--ro-tag-red-fg, #BD3A2E)' }}>
            {overdueCount} overdue
          </span>
        )}
      </div>
      {visibleRows.map((t) => (
        <PartnerTaskRow key={t.id} task={t} frozen={paused && !!t.cadenceStep} {...rowProps} />
      ))}
      {rows.length === 0 && !tasksQuery.isLoading && (
        <p className="text-[12.5px] m-0 px-5 pb-3.5 leading-relaxed" style={{ color: 'var(--ro-text-3)' }}>
          {canManage && !terminalStage
            ? `No open tasks — add one${CADENCES_ENABLED ? ' or start a cadence' : ''}.`
            : 'No open tasks.'}
        </p>
      )}
      {truncated && (
        <Link
          to={`/redeem-ops/tasks?partnerId=${partnerId}`}
          className="ro-link block px-5 py-1 text-[12.5px] font-semibold"
        >
          View all {rows.length}
        </Link>
      )}
      {canManage && !terminalStage && onAddTask ? (
        <div className="px-3 pt-1 pb-2.5">
          <Button size="sm" variant="ghost" onClick={onAddTask} style={{ color: 'var(--ro-text-2)' }}>
            <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Add task
          </Button>
        </div>
      ) : (
        rows.length > 0 && <div className="h-2.5" aria-hidden="true" />
      )}
    </div>
  );

  /* ── Mobile strip: the primary owed task, actionable in place ── */
  const primary = rows[0];
  const others = rows.slice(1);
  const othersOverdue = others.reduce((n, t) => n + (taskDueMeta(t).overdue ? 1 : 0), 0);
  const primaryDue = primary ? taskDueMeta(primary) : null;
  const primaryContext = primary?.cadenceStep
    ? `${primary.cadenceStep.cadence?.name || 'Cadence'} · ${primary.cadenceStep.stepOrder}`
    : primary?.assignee && primary.assignee.id !== authUser?.id ? `for ${primary.assignee.fullName}` : null;

  const strip = primary ? (
    <>
      <div className="flex items-center gap-2.5">
        {primary.cadenceStep ? (
          <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : canManage ? (
          <CompleteCircle task={primary} busy={completingId === primary.id} onComplete={completeTask} />
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold m-0 truncate">{primary.title}</p>
          <p className="text-[11.5px] m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-3)' }}>
            <span className="font-semibold" style={{ color: primaryDue.color }}>{primaryDue.text}</span>
            {primaryContext && <span> · {primaryContext}</span>}
            {paused && primary.cadenceStep && <span className="italic"> · paused</span>}
          </p>
        </div>
        {canManage && (primary.cadenceStep ? (
          <CadenceOutcomeButton task={primary} disabled={paused} disabledHint="Cadence paused" />
        ) : (
          <Button
            size="sm" variant="outline" className="shrink-0"
            disabled={completingId === primary.id}
            onClick={() => completeTask(primary.id)}
          >
            Complete
          </Button>
        ))}
      </div>
      {others.length > 0 && (
        <button
          type="button"
          className="ro-link block mt-1.5 p-0 border-0 bg-transparent text-xs font-semibold cursor-pointer"
          onClick={() => setStripExpanded((v) => !v)}
        >
          {stripExpanded
            ? 'Show less'
            : `+${others.length} more${othersOverdue > 0 ? ` · ${othersOverdue} overdue` : ''}`}
        </button>
      )}
      {stripExpanded && (
        <div className="mt-2 border-t" style={{ borderTopColor: '#F0F2F4' }}>
          {others.map((t) => {
            const due = taskDueMeta(t);
            return (
              <div key={t.id} className="flex items-center gap-2 py-2 border-t first:border-t-0" style={{ borderTopColor: '#F0F2F4' }}>
                {canManage && !t.cadenceStep && (
                  <CompleteCircle task={t} busy={completingId === t.id} onComplete={completeTask} />
                )}
                <p className="text-[12.5px] font-semibold m-0 flex-1 min-w-0 truncate">{t.title}</p>
                <span className="text-[11.5px] font-semibold shrink-0" style={{ color: due.color }}>{due.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  ) : live ? (
    <p className="text-[13px] m-0" style={{ color: 'var(--ro-text-2)' }}>
      <Zap className="w-3.5 h-3.5 inline mr-1 -mt-0.5" aria-hidden="true" />
      <span className="font-semibold" style={{ color: 'var(--ro-bunker)' }}>
        {enrollment.cadence?.name} · step {currentOrder}/{steps.length}
      </span>
      {paused ? ' · paused' : ' · scheduling next step…'}
    </p>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[13px] m-0" style={{ color: 'var(--ro-text-2)' }}>No open tasks</p>
      {enrollButton}
    </div>
  );

  return (
    <>
      {variant === 'summary' ? (
        <div className="rounded-2xl border border-border bg-white px-4 py-3 lg:hidden">
          {strip}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-white overflow-hidden">
          {cadenceZone}
          {tasksZone}
        </div>
      )}

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start a cadence</DialogTitle>
            <DialogDescription>
              Every step becomes a task in the owner's queue at the right time — replies and stage moves stop it automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {cadenceDefs.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left rounded-xl border border-border px-4 py-3 hover:bg-[var(--ro-subtle)] transition-colors disabled:opacity-60"
                disabled={enrollMutation.isPending}
                onClick={() => enrollMutation.mutate({ cadenceId: c.id })}
              >
                <p className="text-sm font-semibold m-0">
                  {c.name}
                  {/* drafts only reach their creator + admins — flag them */}
                  {!c.publishedAt && (
                    <span
                      className="ml-2 inline-block align-middle rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--ro-text-2)' }}
                    >
                      Draft
                    </span>
                  )}
                </p>
                <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                  {c.steps?.length || 0} steps — {(c.steps || []).map((s) => CHANNEL_LABELS[s.channel] || s.channel).join(' → ')}
                </p>
              </button>
            ))}
            {defsQuery.isLoading && <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>Loading cadences…</p>}
            {!defsQuery.isLoading && cadenceDefs.length === 0 && (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>No cadences defined yet.</p>
            )}
            {canAuthor && (
              <Button size="sm" variant="ghost" className="w-full" asChild>
                <Link to="/redeem-ops/cadences/new">
                  <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  New cadence — yours stays a private draft until you publish it
                </Link>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
