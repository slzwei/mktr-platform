import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Zap from 'lucide-react/icons/zap';
import Eye from 'lucide-react/icons/eye';
import SkipForward from 'lucide-react/icons/skip-forward';
import SendHorizontal from 'lucide-react/icons/send-horizontal';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import Check from 'lucide-react/icons/check';
import Copy from 'lucide-react/icons/copy';
import Ellipsis from 'lucide-react/icons/ellipsis';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability, canActOnPartnerRow } from '@/lib/redeemOpsPermissions';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RoTag } from '@/components/redeemops/ui';
import { EMAIL_AUTOSEND_ENABLED } from '@/components/redeemops/OutreachPersonasCard';

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

export function invalidateCadenceData(queryClient, partnerId) {
  queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'queue'] });
  queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'tasks'] });
  if (partnerId) {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner', partnerId] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partner-cadence', partnerId] });
  }
}

/**
 * Client-side mirror of the engine's recipient resolution: which of these
 * channels can reach THIS business right now, and what each unreachable one
 * needs. Contacts/locations ride the partner payload the detail page already
 * holds. `custom` steps need nothing.
 */
export function unreachableChannels(partner, channels) {
  const contacts = (partner?.contacts || []).filter((c) => !c.archivedAt);
  const hasPhone = !!(partner?.primaryPhone || contacts.some((c) => c.mobile || c.whatsapp));
  const hasEmail = !!(partner?.primaryEmail || contacts.some((c) => c.email));
  const reach = {
    call: { ok: hasPhone, need: 'a phone number' },
    whatsapp: { ok: hasPhone, need: 'a phone number' },
    email: { ok: hasEmail, need: 'an email address' },
    instagram_dm: { ok: !!partner?.instagramHandle, need: 'an Instagram handle' },
    visit: { ok: (partner?.locations || []).some((l) => l.isActive !== false), need: 'an outlet address' },
  };
  const out = [];
  for (const ch of channels || []) {
    const r = reach[ch];
    if (r && !r.ok && !out.some((o) => o.channel === ch)) out.push({ channel: ch, need: r.need });
  }
  return out;
}

/** "an email address and an Instagram handle" — dedupes repeated needs. */
export function needsSentence(missing) {
  const needs = [...new Set(missing.map((m) => m.need))];
  return needs.length <= 1 ? needs.join('') : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`;
}

/**
 * Why a parked step can't go out, in rep words — mirrors the engine's
 * `blockedReason` values. `need`ful reasons are fixable record gaps (the
 * contact-info hook auto-resumes once added); the other two are not, so their
 * copy points at skip/stop instead of the Contacts tab.
 */
const BLOCKED_REASON_META = {
  no_phone: { need: 'a phone number', fixTab: 'contacts' },
  no_email: { need: 'an email address', fixTab: 'contacts' },
  no_instagram_handle: { need: 'an Instagram handle', fixTab: 'contacts' },
  no_active_location: { need: 'an outlet address', fixTab: 'locations' },
  suppressed: {
    text: 'the contact is on the do-not-contact list',
    guide: 'The contact is on the do-not-contact list for this channel. Skip this step, or stop the cadence.',
  },
  unresolved_template: {
    text: 'its script has an unresolved placeholder',
    guide: 'This step’s script has an unresolved placeholder, so it can’t be prepared. Skip it, or fix the cadence and re-enroll.',
  },
};

/** One-line toast phrase for a blocked step: “Recap email” needs an email address on record. */
export function blockedStepPhrase(entry) {
  if (!entry) return 'A step is blocked';
  const meta = BLOCKED_REASON_META[entry.reason];
  const title = entry.stepTitle ? `“${entry.stepTitle}”` : 'The next step';
  if (meta?.need) return `${title} needs ${meta.need} on record`;
  if (meta?.text) return `${title} is blocked — ${meta.text}`;
  return `${title} can’t be prepared`;
}

/** Short reason label for list rows (MyQueue "Waiting on info" bucket). */
export function blockedReasonLabel(reason) {
  const meta = BLOCKED_REASON_META[reason];
  if (meta?.need) return `no ${meta.need.replace(/^an? /, '')} on record`;
  if (meta?.text) return meta.text;
  return 'needs attention';
}

/**
 * Full toast description for a park: the phrase plus what ACTUALLY unblocks
 * it — only record gaps get the "add it and it resumes on its own" promise
 * (the contact-info hook is the sole auto-resume; a DNC block or a template
 * bug can't be fixed by adding contact info).
 */
export function blockedStepToast(entry, verb = 'continues') {
  const phrase = blockedStepPhrase(entry);
  const meta = entry ? BLOCKED_REASON_META[entry.reason] : null;
  if (meta?.need) return `${phrase}. Add it and the cadence ${verb} on its own — or skip that step.`;
  if (entry?.reason === 'unresolved_template') return `${phrase}. Skip that step, or fix the cadence and re-enroll.`;
  return `${phrase}. Skip that step or stop the cadence.`;
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

/**
 * A cadence's name, linking through to its definition for anyone who can open
 * the editor (`tasks.manage` — non-authors land on its read-only view, so this
 * is a "see the script" affordance, not an edit one).
 *
 * Enrollments are version-pinned, so this points at the EXACT version being
 * run. That version may since have been retired by an edit; the editor loads
 * its list with all=true, so a retired version still resolves.
 */
export function CadenceName({ cadence, className = '', style }) {
  const authUser = useAuthStore((s) => s.user);
  const label = cadence?.name || 'Cadence';
  if (!CADENCES_ENABLED || !cadence?.id || !hasCapability(authUser, 'tasks.manage')) {
    return <span className={className} style={style}>{label}</span>;
  }
  return (
    <Link
      to={`/redeem-ops/cadences/${cadence.id}/edit`}
      title={`Open “${label}”`}
      className={`hover:underline ${className}`}
      style={{ color: 'inherit', ...style }}
    >
      {label}
    </Link>
  );
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
 * Confirm-and-skip for the CURRENT cadence step — the only way past a step
 * without logging its outcome (the engine never skips on its own). Used from
 * the Outcome menu (open task the rep deems irrelevant) and from the parked
 * banner (step the record can't serve). Cancels the step's open task, if any,
 * and advances through the step's continue edge on the authored delay.
 */
export function SkipStepDialog({ open, onOpenChange, partnerId, stepTitle, expectedStepId, blocked = false }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  // Closing by any route (Back, Esc, overlay) drops the draft note — a stale
  // note must not ride into a later, unrelated skip's audit entry.
  const setOpen = (v) => {
    if (!v) setNote('');
    onOpenChange(v);
  };

  const skipMutation = useMutation({
    mutationFn: () => redeemOpsApi.skipCadenceStep(partnerId, {
      ...(note.trim() ? { note: note.trim() } : {}),
      // Staleness guard: the server 409s if this is no longer the current step.
      ...(expectedStepId ? { expectedStepId } : {}),
    }),
    onSuccess: (data) => {
      setOpen(false);
      if (data?.finished) {
        toast.success('Step skipped — that was the last step, so the cadence is finished');
      } else if (data?.pausedForInfo) {
        toast.warning('Step skipped — the next one is waiting too', {
          description: blockedStepToast(data.pausedForInfo.blocked?.[0]),
          duration: 8000,
        });
      } else if (data?.nextTask) {
        toast.success('Step skipped — next step scheduled', {
          description: `${data.nextTask.title} · ${new Date(data.nextTask.dueAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`,
        });
      } else {
        toast.success('Step skipped');
      }
      invalidateCadenceData(queryClient, partnerId);
    },
    onError: (err) => toast.error('Could not skip the step', { description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Skip {stepTitle ? `“${stepTitle}”` : 'this step'}?</DialogTitle>
          <DialogDescription>
            {blocked
              ? 'The cadence is waiting on this step. Skipping moves straight on to the next step without doing it.'
              : 'For steps that don’t apply to this business. Its open task is cancelled and the cadence moves straight on to the next step.'}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={note}
          maxLength={200}
          placeholder="Why? (optional — kept in the audit log)"
          onChange={(e) => setNote(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Back</Button>
          <Button disabled={skipMutation.isPending} onClick={() => skipMutation.mutate()}>
            {skipMutation.isPending ? 'Skipping…' : 'Skip step'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const authUser = useAuthStore((s) => s.user);
  const [confirmNI, setConfirmNI] = useState(false);
  const [alsoMarkLost, setAlsoMarkLost] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);

  const channel = task?.cadenceStep?.channel || 'custom';
  const dispositions = CHANNEL_DISPOSITIONS[channel] || CHANNEL_DISPOSITIONS.custom;
  const partnerId = task.partnerOrganisationId || task.partner?.id;
  // Skipping is a deal decision (owner-or-admin), narrower than completing
  // (manager tier). Cadence tasks are always assigned to the business owner,
  // so the assignee stands in for row ownership — mirrors the server rule
  // instead of offering a menu item that can only 403.
  const canSkip = canActOnPartnerRow(authUser, { ownerUserId: task.assigneeUserId });

  const completeMutation = useMutation({
    mutationFn: (body) => redeemOpsApi.completeCadenceTask(task.id, body),
    onSuccess: (data) => {
      setConfirmNI(false);
      const next = data?.nextTask;
      if (next) {
        toast.success('Logged — next step scheduled', {
          description: `${next.title} · ${new Date(next.dueAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`,
        });
      } else if (data?.cadencePaused) {
        toast.warning('Logged — the cadence is waiting at the next step (nothing skipped)', {
          description: blockedStepToast(data.cadencePaused.blocked?.[0], 'resumes'),
          duration: 8000,
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
          {canSkip && (
            <>
              <DropdownMenuSeparator />
              {/* The nothing-happened exit: for a step that doesn't apply to
                  this business. Confirms first; the server re-checks the row. */}
              <DropdownMenuItem onSelect={() => setSkipOpen(true)}>
                <SkipForward className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Skip this step…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SkipStepDialog
        open={skipOpen}
        onOpenChange={setSkipOpen}
        partnerId={partnerId}
        stepTitle={task.title}
        expectedStepId={task.cadenceStep?.id}
      />

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
        {/* A drafted script can run long — it scrolls inside the dialog so
            Copy message never gets pushed off the bottom of the screen. */}
        <DialogContent className="max-w-md flex flex-col max-h-[85dvh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>{task.title}</DialogTitle>
            {task.snapshotRecipient && (
              <DialogDescription>To: {task.snapshotRecipient}</DialogDescription>
            )}
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap m-0 min-h-0 overflow-y-auto" style={{ color: 'var(--ro-text-2)' }}>
            {task.description || 'No script for this step.'}
          </p>
          {task.description && (
            <DialogFooter className="shrink-0">
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

/**
 * The machine-send state strip on a task row (Phase B): says plainly that the
 * CRM will send this itself, with first-class Don't send / Approve levers.
 * Renders nothing for tasks without a live outbox row.
 */
const CANCELLED_SEND_COPY = {
  no_sending_persona: 'No sending persona assigned to you — assign one in Settings, or send manually.',
  recipient_changed: 'The email address changed after this was scheduled — review and send manually.',
  no_email: 'The email address was removed — fix the record or send another way.',
  reassigned_review: 'This business changed owner — the drafted send was cancelled for your review.',
  autosend_disabled: 'Auto-send was switched off — send it yourself and log the outcome.',
  reply_in_thread: 'They replied in this thread — read it before doing anything else.',
};

export function ScheduledSendStrip({ task, canManage = true }) {
  const queryClient = useQueryClient();
  const rows = task.outboxEmails || [];
  // A live row outranks a system-cancelled one (a task can carry both after
  // a cancel + re-materialization on a later enrollment step).
  const row = rows.find((r) => ['queued', 'needs_approval', 'sending', 'failed'].includes(r.status)) || rows[0];
  const partnerId = task.partnerOrganisationId || task.partner?.id;
  const done = () => invalidateCadenceData(queryClient, partnerId);
  const approveMutation = useMutation({
    mutationFn: () => redeemOpsApi.approveOutreachEmail(row.id),
    onSuccess: () => { toast.success('Approved — it sends at the scheduled time'); done(); },
    onError: (err) => toast.error('Could not approve', { description: err.message }),
  });
  const dontSendMutation = useMutation({
    mutationFn: () => redeemOpsApi.convertOutreachEmailToManual(row.id),
    onSuccess: () => { toast.success('Won’t send — it’s a normal manual task now'); done(); },
    onError: (err) => toast.error('Could not cancel the send', { description: err.message }),
  });
  const sendNowMutation = useMutation({
    mutationFn: () => redeemOpsApi.sendNowOutreachEmail(row.id),
    onSuccess: () => { toast.success('Sending — it goes out within a minute'); done(); },
    onError: (err) => toast.error('Could not send now', { description: err.message }),
  });
  const [confirmSend, setConfirmSend] = useState(false);
  const sendEmailMutation = useMutation({
    mutationFn: () => redeemOpsApi.sendTaskOutreachEmail(task.id),
    onSuccess: () => { setConfirmSend(false); toast.success('Sending — it goes out within a minute'); done(); },
    onError: (err) => { setConfirmSend(false); toast.error('Could not send', { description: err.message }); },
  });
  if (!row) {
    // Manual email steps still get a one-click CRM send: it queues directly
    // (the rep reviewed this exact message — no ramp hold) and rides the same
    // worker guards. Sends as the task owner's outreach persona.
    if (!EMAIL_AUTOSEND_ENABLED || !canManage || !task.cadenceEnrollmentId || task.cadenceStep?.channel !== 'email') {
      return null;
    }
    return (
      <>
        <div className="mt-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11.5px]" onClick={() => setConfirmSend(true)}>
            <SendHorizontal className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Send email
          </Button>
        </div>
        <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Send this email now?</DialogTitle>
              <DialogDescription>
                Sends the message on this task from the task owner’s outreach address to the
                business email on file{task.snapshotRecipient ? ` (${task.snapshotRecipient})` : ''},
                and completes the task once it’s out.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm mb-0" style={{ color: 'var(--ro-text-2)' }}>
              Subject: <span className="font-semibold">{task.emailSubject || task.title}</span>
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmSend(false)}>Back</Button>
              <Button disabled={sendEmailMutation.isPending} onClick={() => sendEmailMutation.mutate()}>
                {sendEmailMutation.isPending ? 'Sending…' : 'Send email'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  const when = row.nextAttemptAt
    ? new Date(row.nextAttemptAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'soon';

  if (row.status === 'failed') {
    return (
      <p className="text-[12px] font-semibold mt-1.5 mb-0" style={{ color: 'var(--ro-tag-red-fg, #BD3A2E)' }}>
        Auto-send failed — send it yourself and log the outcome.
      </p>
    );
  }
  if (row.status === 'cancelled') {
    // System cancellations that need a human's eyes (M-2) — never invisible.
    return (
      <p className="text-[12px] font-semibold mt-1.5 mb-0" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
        Auto-send cancelled: {CANCELLED_SEND_COPY[row.lastError] || 'review this step before sending.'}
      </p>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[10px] px-2.5 py-1.5 mt-1.5"
      style={{ background: 'var(--ro-tag-blue-bg, #E8F1FF)' }}
    >
      <SendHorizontal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ro-tag-blue-fg, #1B5FBE)' }} aria-hidden="true" />
      <span className="text-[12px] font-semibold flex-1 min-w-0" style={{ color: 'var(--ro-tag-blue-fg, #1B5FBE)' }}>
        {row.status === 'needs_approval'
          ? `Held for your approval — would send ${when}`
          : row.status === 'sending'
            ? 'Sending right now…'
            : `CRM sends this itself — ${when}`}
      </span>
      {canManage && row.status === 'needs_approval' && (
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11.5px]" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
          Approve
        </Button>
      )}
      {canManage && row.status === 'queued' && (
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11.5px]" disabled={sendNowMutation.isPending} onClick={() => sendNowMutation.mutate()}>
          Send now
        </Button>
      )}
      {canManage && ['queued', 'needs_approval'].includes(row.status) && (
        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[11.5px]" disabled={dontSendMutation.isPending} onClick={() => dontSendMutation.mutate()}>
          Don’t send
        </Button>
      )}
    </div>
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
   clamp to three lines behind a Show more toggle. Editable in place: the task
   description IS the message (and for auto-send emails, the edit is exactly
   what sends — single source of truth). */
const SCRIPT_CLAMP_CHARS = 140;

function TaskScriptBox({ task, canManage = false }) {
  const queryClient = useQueryClient();
  const text = task.description || '';
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [subjectDraft, setSubjectDraft] = useState('');
  const clampable = text.length > SCRIPT_CLAMP_CHARS || text.split('\n').length > 3;
  const hasSubject = task.emailSubject != null && task.cadenceStep?.channel === 'email';

  const saveMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateTask(task.id, {
      description: draft.trim(),
      ...(hasSubject ? { emailSubject: subjectDraft.trim() } : {}),
    }),
    onSuccess: () => {
      setEditing(false);
      toast.success('Message updated — this is exactly what goes out');
      invalidateCadenceData(queryClient, task.partnerOrganisationId || task.partner?.id);
    },
    // The one 409 here is "sending right now" — surfacing it verbatim is the point.
    onError: (err) => toast.error('Could not save the message', { description: err.message }),
  });

  const startEdit = () => {
    setDraft(text);
    setSubjectDraft(task.emailSubject || '');
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="mt-2 rounded-[10px] px-3 py-2 space-y-2" style={{ background: 'var(--ro-subtle)' }}>
        {hasSubject && (
          <Input
            value={subjectDraft}
            maxLength={200}
            aria-label="Email subject"
            placeholder="Subject"
            className="bg-white"
            onChange={(e) => setSubjectDraft(e.target.value)}
          />
        )}
        <textarea
          value={draft}
          aria-label="Message"
          rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
          className="w-full rounded-md border border-border bg-white p-2 text-xs leading-relaxed"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" className="h-[26px] px-2.5 text-[11.5px]" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-[26px] px-2.5 text-[11.5px]"
            disabled={saveMutation.isPending || !draft.trim()
              || (draft === text && (!hasSubject || subjectDraft === (task.emailSubject || '')))}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-[10px] px-3 py-2" style={{ background: 'var(--ro-subtle)' }}>
      {hasSubject && (
        <p className="text-xs font-semibold m-0 mb-1" style={{ color: 'var(--ro-text-2)' }}>
          Subject: {task.emailSubject}
        </p>
      )}
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
        <span className="ml-auto flex gap-1.5">
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-[26px] px-2.5 text-[11.5px] font-medium"
              onClick={startEdit}
            >
              <Pencil className="w-3 h-3 mr-1" aria-hidden="true" /> Edit
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-[26px] px-2.5 text-[11.5px] font-medium"
            onClick={() => copyTaskMessage(text)}
          >
            <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy message
          </Button>
        </span>
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
        <ScheduledSendStrip task={task} canManage={canManage} />
        {task.description && <TaskScriptBox task={task} canManage={canManage} />}
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
// canManage = may work TASKS here. canRunCadence = may start/pause/stop the
// cadence, which is working the deal itself and so follows business ownership
// (#307); it defaults to canManage so other call sites keep their behavior.
export function CadencePanel({ partner, canManage = true, canRunCadence = canManage, variant = 'card', onAddTask, onEditTask, onFixContactInfo }) {
  const queryClient = useQueryClient();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [skipParkedOpen, setSkipParkedOpen] = useState(false);
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
      if (data?.pausedForInfo) {
        toast.warning('Enrolled — waiting at step 1', {
          description: blockedStepToast(data.pausedForInfo.blocked?.[0], 'starts'),
          duration: 8000,
        });
      } else {
        toast.success('Cadence started — first task is in the queue');
      }
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
    onSuccess: (resumed) => {
      // A resume that re-parked means the step is still blocked — say WHY
      // instead of pretending it's running (or blaming missing contact info
      // for a DNC or template block it can't fix).
      if (resumed?.state === 'paused') {
        const meta = BLOCKED_REASON_META[resumed?.blockedReason];
        toast.warning(meta?.need
          ? `Still waiting — add ${meta.need} first`
          : meta
            ? `Still blocked — ${meta.text}`
            : 'Still can’t reach them — add the missing contact info first');
      } else {
        toast.success('Cadence resumed');
      }
      invalidateCadenceData(queryClient, partnerId);
    },
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

  // Parked ON a step it can't prepare (nothing skipped): the engine records
  // exactly why in blockedReason, so the fix is one glance away (the
  // contact-info hook resumes it automatically). Legacy parks from before
  // blockedReason existed fall back to the client-side reachability mirror.
  const pausedForInfo = paused && enrollment?.pausedReason === 'missing_info';
  const blockedMeta = pausedForInfo ? BLOCKED_REASON_META[enrollment?.blockedReason] : null;
  const missingInfo = pausedForInfo && !blockedMeta
    ? unreachableChannels(partner, steps.filter((s) => s.stepOrder >= currentOrder).map((s) => s.channel))
    : [];
  const fixTab = blockedMeta?.fixTab
    || (missingInfo.length > 0 && missingInfo.every((m) => m.channel === 'visit') ? 'locations' : 'contacts');
  const parkedStepTitle = enrollment?.currentStep?.title;

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

  const enrollButton = CADENCES_ENABLED && canRunCadence && !terminalStage && (
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
              <CadenceName cadence={enrollment.cadence} />
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
          {pausedForInfo ? (
            <div className="rounded-lg px-3 py-2.5 mt-2" style={{ background: 'var(--ro-tag-yellow-bg, #FFF6DE)' }}>
              <p className="text-[12.5px] font-semibold m-0" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
                {blockedMeta
                  ? `Waiting at step ${currentOrder}${parkedStepTitle ? ` · “${parkedStepTitle}”` : ''} — nothing has been skipped.`
                  : 'Paused — no way to reach them for the remaining steps.'}
              </p>
              <p className="text-[12px] m-0 mt-1 leading-relaxed" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
                {blockedMeta?.need
                  ? `This business has ${blockedMeta.need.replace(/^an? /, 'no ')} on record. Add it and the cadence continues on its own — or skip this step if it doesn’t apply.`
                  : blockedMeta
                    ? blockedMeta.guide
                    : missingInfo.length > 0
                      ? <>Add {needsSentence(missingInfo)} and the cadence continues on its own.</>
                      : 'Add contact info (or lift the do-not-contact block) and resume.'}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(!blockedMeta || blockedMeta.need) && onFixContactInfo && (
                  <Button size="sm" variant="outline" onClick={() => onFixContactInfo(fixTab)}>
                    Add contact info
                  </Button>
                )}
                {canRunCadence && (
                  <Button size="sm" variant="outline" onClick={() => setSkipParkedOpen(true)}>
                    Skip this step
                  </Button>
                )}
              </div>
            </div>
          ) : paused && (
            <p className="text-[12.5px] mt-2 mb-0" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
              Paused — no tasks will be scheduled until resumed.
            </p>
          )}
          {canRunCadence && (
            <div className="flex gap-1.5 mt-3">
              {enrollment.state === 'active' ? (
                <Button size="sm" variant="outline" disabled={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>Pause</Button>
              ) : (
                <Button size="sm" variant="outline" disabled={resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>
                  {pausedForInfo ? 'Retry now' : 'Resume'}
                </Button>
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
            ? `No open tasks — add one${CADENCES_ENABLED && canRunCadence && !live ? ' or start a cadence' : ''}.`
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
  // The phone layout renders ONLY this strip (the card with the parked banner
  // is hidden lg:block on PartnerDetail) — so a park must surface its levers
  // here too, and even when manual tasks push the cadence out of `primary`.
  const parkedNotice = pausedForInfo ? (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2 mb-2"
      style={{ background: 'var(--ro-tag-yellow-bg, #FFF6DE)' }}
    >
      <p className="text-[12px] font-semibold m-0 flex-1 min-w-0" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
        Cadence waiting at step {currentOrder}
        {parkedStepTitle ? ` · ${parkedStepTitle}` : ''}
        {enrollment.blockedReason ? ` — ${blockedReasonLabel(enrollment.blockedReason)}` : ''}
      </p>
      {canRunCadence && (
        <span className="flex gap-1.5 shrink-0">
          {(!blockedMeta || blockedMeta.need) && onFixContactInfo && (
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11.5px]" onClick={() => onFixContactInfo(fixTab)}>
              Add info
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11.5px]" onClick={() => setSkipParkedOpen(true)}>
            Skip step
          </Button>
        </span>
      )}
    </div>
  ) : null;
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
        <CadenceName cadence={enrollment.cadence} /> · step {currentOrder}/{steps.length}
      </span>
      {pausedForInfo ? ' · waiting' : paused ? ' · paused' : ' · scheduling next step…'}
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
          {parkedNotice}
          {strip}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-white overflow-hidden">
          {cadenceZone}
          {tasksZone}
        </div>
      )}

      {/* Skip for the PARKED step (no open task to hang the menu on). */}
      <SkipStepDialog
        open={skipParkedOpen}
        onOpenChange={setSkipParkedOpen}
        partnerId={partnerId}
        stepTitle={parkedStepTitle}
        expectedStepId={enrollment?.currentStep?.id}
        blocked
      />

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        {/* The library grows without bound, so the dialog is capped to the
            viewport and only the list scrolls — the heading and the "New
            cadence" escape hatch stay on screen at any library size. */}
        <DialogContent className="max-w-md flex flex-col max-h-[85dvh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>Start a cadence</DialogTitle>
            <DialogDescription>
              Every step becomes a task in the owner's queue at the right time — replies and stage moves stop it automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 min-h-0 overflow-y-auto">
            {cadenceDefs.map((c) => {
              // Warn BEFORE enrolling: which of this cadence's channels can't
              // reach the business yet. Nothing skips — the cadence waits at
              // each such step until the info is added or the rep skips it.
              const missing = unreachableChannels(partner, (c.steps || []).map((s) => s.channel));
              const reachableSteps = (c.steps || []).filter(
                (s) => s.channel === 'custom' || !missing.some((m) => m.channel === s.channel)
              );
              return (
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
                    {c.steps?.length || 0} steps — {(c.steps || []).map((s) => `${CHANNEL_LABELS[s.channel] || s.channel}${s.mode === 'auto' ? ' (auto)' : ''}`).join(' → ')}
                  </p>
                  {(c.steps || []).some((s) => s.mode === 'auto') && (
                    <p className="text-xs m-0 mt-1 font-medium" style={{ color: 'var(--ro-tag-blue-fg, #1B5FBE)' }}>
                      Steps marked (auto) are SENT by the CRM itself at the scheduled time.
                    </p>
                  )}
                  {missing.length > 0 && (
                    <p className="text-xs m-0 mt-1 font-medium" style={{ color: 'var(--ro-tag-yellow-fg, #8F6400)' }}>
                      {reachableSteps.length === 0
                        ? `Needs ${needsSentence(missing)} — enrolling waits at step 1 until it's added.`
                        : `Missing ${needsSentence(missing)} — the cadence will wait at those steps (add the info or skip them).`}
                    </p>
                  )}
                </button>
              );
            })}
            {defsQuery.isLoading && <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>Loading cadences…</p>}
            {!defsQuery.isLoading && cadenceDefs.length === 0 && (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>No cadences defined yet.</p>
            )}
          </div>
          {canAuthor && (
            <Button size="sm" variant="ghost" className="w-full shrink-0" asChild>
              <Link to="/redeem-ops/cadences/new">
                <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
                New cadence — yours stays a private draft until you publish it
              </Link>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
