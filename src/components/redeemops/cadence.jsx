import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Zap from 'lucide-react/icons/zap';
import Eye from 'lucide-react/icons/eye';
import { redeemOpsApi } from '@/api/redeemOps';
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

function invalidateCadenceData(queryClient, partnerId) {
  queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
  queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
  if (partnerId) {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner-cadence', partnerId] });
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
 * same transaction.
 */
export function CadenceOutcomeButton({ task, size = 'sm' }) {
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
          <Button size={size} variant="outline" className="ml-1 shrink-0" disabled={completeMutation.isPending}>
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
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Partner Detail cadence card (§8.2): live enrollment with step progress and
 * Pause/Resume/Stop, or an Enroll picker. `variant="summary"` renders the
 * compact mobile strip. Renders nothing while the feature flag is off.
 */
export function CadencePanel({ partner, canManage = true, variant = 'card' }) {
  const queryClient = useQueryClient();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const partnerId = partner?.id;

  const cadenceQuery = useQuery({
    queryKey: ['redeem-ops', 'partner-cadence', partnerId],
    queryFn: () => redeemOpsApi.getPartnerCadence(partnerId),
    enabled: CADENCES_ENABLED && !!partnerId,
  });
  const defsQuery = useQuery({
    queryKey: ['redeem-ops', 'cadences'],
    queryFn: redeemOpsApi.listCadences,
    enabled: CADENCES_ENABLED && enrollOpen,
  });

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

  if (!CADENCES_ENABLED || !partnerId) return null;

  const enrollment = cadenceQuery.data?.enrollment;
  const openTask = cadenceQuery.data?.openTask;
  const live = enrollment && ['active', 'paused'].includes(enrollment.state);
  const steps = enrollment?.cadence?.steps || [];
  const currentOrder = enrollment?.currentStep?.stepOrder || 0;
  const terminalStage = ['PARTNERED', 'LOST'].includes(partner?.pipelineStage);

  const enrollButton = canManage && !terminalStage && (
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

  const body = live ? (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold m-0 truncate">
          {enrollment.cadence?.name}
          <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}> · v{enrollment.cadence?.version}</span>
        </p>
        <RoTag tone={enrollment.state === 'active' ? 'open' : 'follow_up_later'} size="sm">
          {enrollment.state}
        </RoTag>
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
      <p className="text-[13px] mt-2 mb-0" style={{ color: 'var(--ro-text-2)' }}>
        {enrollment.state === 'paused'
          ? 'Paused — no tasks will be scheduled until resumed.'
          : openTask
            ? <>Next: <span className="font-semibold">{openTask.title}</span> · {new Date(openTask.dueAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</>
            : 'Scheduling next step…'}
      </p>
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
      <div className="mt-3">{enrollButton}</div>
    </>
  );

  return (
    <>
      {variant === 'summary' ? (
        <div className="rounded-2xl border border-border bg-white px-4 py-3 lg:hidden">
          {live ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold m-0 truncate">
                <Zap className="w-3.5 h-3.5 inline mr-1 -mt-0.5" aria-hidden="true" />
                {enrollment.cadence?.name} · step {currentOrder}/{steps.length}
                {enrollment.state === 'paused' && <span style={{ color: 'var(--ro-text-3)' }}> · paused</span>}
              </p>
              {openTask && (
                <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--ro-text-2)' }}>
                  {new Date(openTask.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] m-0" style={{ color: 'var(--ro-text-2)' }}>No active cadence</p>
              {enrollButton}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-white p-5">
          <p className="text-[15px] font-bold m-0 mb-3">
            <Zap className="w-4 h-4 inline mr-1 -mt-0.5" aria-hidden="true" /> Cadence
          </p>
          {cadenceQuery.isLoading ? (
            <p className="text-[13px] m-0" style={{ color: 'var(--ro-text-2)' }}>Loading…</p>
          ) : body}
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
            {(defsQuery.data || []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left rounded-xl border border-border px-4 py-3 hover:bg-[var(--ro-subtle)] transition-colors disabled:opacity-60"
                disabled={enrollMutation.isPending}
                onClick={() => enrollMutation.mutate({ cadenceId: c.id })}
              >
                <p className="text-sm font-semibold m-0">{c.name}</p>
                <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                  {c.steps?.length || 0} steps — {(c.steps || []).map((s) => CHANNEL_LABELS[s.channel] || s.channel).join(' → ')}
                </p>
              </button>
            ))}
            {defsQuery.isLoading && <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>Loading cadences…</p>}
            {!defsQuery.isLoading && (defsQuery.data || []).length === 0 && (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>No cadences defined yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
