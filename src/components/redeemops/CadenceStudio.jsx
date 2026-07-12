import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import ArrowUp from 'lucide-react/icons/arrow-up';
import ArrowDown from 'lucide-react/icons/arrow-down';
import Pencil from 'lucide-react/icons/pencil';
import { redeemOpsApi } from '@/api/redeemOps';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CADENCES_ENABLED } from '@/components/redeemops/cadence';

const CHANNELS = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'instagram_dm', label: 'Instagram DM' },
  { value: 'visit', label: 'Walk-in visit' },
  { value: 'custom', label: 'Custom step' },
];
const WINDOWS = [
  { value: 'any', label: 'Any time' },
  { value: 'morning', label: 'Morning (9:30)' },
  { value: 'afternoon', label: 'Afternoon (15:00)' },
  { value: 'off_peak', label: 'Off-peak (15:00–17:00)' },
];
/** Non-terminal outcomes that may advance to the next step, per channel. */
const CONTINUE_OPTIONS = {
  call: [{ value: '*', label: 'Any outcome' }, { value: 'no_answer', label: 'No answer only' }, { value: 'connected', label: 'Connected only' }],
  whatsapp: [{ value: '*', label: 'Any outcome' }, { value: 'sent', label: 'Sent' }],
  email: [{ value: '*', label: 'Any outcome' }, { value: 'sent', label: 'Sent' }],
  instagram_dm: [{ value: '*', label: 'Any outcome' }, { value: 'sent', label: 'Sent' }],
  visit: [{ value: '*', label: 'Any outcome' }, { value: 'met', label: 'Met only' }, { value: 'closed', label: 'Outlet closed only' }],
  custom: [{ value: '*', label: 'Any outcome' }, { value: 'done', label: 'Done' }],
};
const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

const emptyStep = (channel = 'call') => ({
  channel, title: '', script: '', priority: 'medium',
  delayDays: 0, timeWindow: 'any', continueOn: channel === 'call' ? 'no_answer' : '*',
});

/**
 * Reverse-map a stored cadence (steps + transition edges) into the builder's
 * linear dialect: each step's delay/window ride its INCOMING edge, its
 * continue-on is the OUTGOING edge to the next step. Both seeded cadences and
 * everything the builder saves are linear, so the round-trip is lossless.
 */
export function toBuilderSteps(cadence) {
  const steps = [...(cadence.steps || [])].sort((a, b) => a.stepOrder - b.stepOrder);
  const byFrom = {};
  let entry = null;
  for (const t of cadence.transitions || []) {
    if (t.fromStepId) byFrom[t.fromStepId] = t;
    else entry = t;
  }
  return steps.map((s, i) => {
    const incoming = i === 0 ? entry : byFrom[steps[i - 1].id];
    const outgoing = byFrom[s.id];
    return {
      channel: s.channel,
      title: s.title,
      script: s.scriptTemplate || '',
      priority: s.priority || 'medium',
      delayDays: incoming?.delayDays ?? 0,
      timeWindow: incoming?.timeWindow || 'any',
      continueOn: outgoing?.disposition || '*',
    };
  });
}

function StepEditor({ step, index, total, onChange, onRemove, onMove }) {
  const set = (patch) => onChange({ ...step, ...patch });
  const isLast = index === total - 1;
  return (
    <div className="rounded-xl border border-border p-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold w-5 shrink-0" style={{ color: 'var(--ro-text-3)' }}>{index + 1}.</span>
        <Select value={step.channel} onValueChange={(channel) => set({ channel, continueOn: channel === 'call' ? 'no_answer' : '*' })}>
          <SelectTrigger className="w-[150px] shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={step.title}
          placeholder="Step title (becomes the task title)"
          onChange={(e) => set({ title: e.target.value })}
        />
        <span className="inline-flex gap-0.5 shrink-0">
          <Button size="sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Move down" disabled={isLast} onClick={() => onMove(1)}>
            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Remove step" disabled={total === 1} onClick={onRemove}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label className="text-xs" style={{ color: 'var(--ro-text-2)' }}>
          {index === 0 ? 'Start' : 'Wait'}
        </Label>
        <Input
          type="number" min={0} max={60} className="w-16"
          value={step.delayDays}
          onChange={(e) => set({ delayDays: e.target.value })}
        />
        <span className="text-xs" style={{ color: 'var(--ro-text-2)' }}>
          {index === 0 ? 'day(s) after enrolling' : 'day(s) after the previous step'}
        </span>
        <Select value={step.timeWindow} onValueChange={(timeWindow) => set({ timeWindow })}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {!isLast && (
          <>
            <Label className="text-xs ml-1" style={{ color: 'var(--ro-text-2)' }}>Continue when</Label>
            <Select value={step.continueOn} onValueChange={(continueOn) => set({ continueOn })}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(CONTINUE_OPTIONS[step.channel] || CONTINUE_OPTIONS.custom).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      <Textarea
        rows={2}
        value={step.script}
        placeholder="Script / notes shown on the task ({{partner_name}}, {{contact_name}} merge in)"
        onChange={(e) => set({ script: e.target.value })}
      />
      {isLast && (
        <p className="text-[11.5px] m-0" style={{ color: 'var(--ro-text-3)' }}>
          Last step — any outcome finishes the cadence. Replies and “not interested” always end it early.
        </p>
      )}
    </div>
  );
}

export default function CadenceStudio() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // cadence being edited (null = new)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState([emptyStep()]);

  const listQuery = useQuery({
    queryKey: ['redeem-ops', 'cadences'],
    queryFn: () => redeemOpsApi.listCadences(),
    enabled: CADENCES_ENABLED,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'cadences'] });

  const saveMutation = useMutation({
    mutationFn: (payload) => (editing
      ? redeemOpsApi.createCadenceVersion(editing.id, payload)
      : redeemOpsApi.createCadence(payload)),
    onSuccess: (cadence) => {
      setEditorOpen(false);
      toast.success(editing
        ? `Saved as v${cadence?.version} — businesses already enrolled finish on their current version`
        : 'Cadence created — it’s available in every Start cadence picker now');
      invalidate();
    },
    onError: (err) => toast.error('Could not save the cadence', { description: err.message }),
  });
  const retireMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.retireCadence(id),
    onSuccess: () => { toast.success('Cadence retired — no new enrollments; running ones finish normally'); invalidate(); },
    onError: (err) => toast.error('Could not retire', { description: err.message }),
  });

  if (!CADENCES_ENABLED) return null;

  const openNew = () => {
    setEditing(null); setName(''); setDescription(''); setSteps([emptyStep()]);
    setEditorOpen(true);
  };
  const openEdit = (cadence) => {
    setEditing(cadence); setName(cadence.name); setDescription(cadence.description || '');
    setSteps(toBuilderSteps(cadence));
    setEditorOpen(true);
  };
  const save = () => {
    if (!name.trim()) return toast.error('Give the cadence a name');
    if (steps.some((s) => !s.title.trim())) return toast.error('Every step needs a title');
    return saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || null,
      steps: steps.map((s) => ({
        channel: s.channel, title: s.title.trim(), script: s.script || null,
        priority: s.priority, delayDays: Number(s.delayDays) || 0,
        timeWindow: s.timeWindow, continueOn: s.continueOn,
      })),
    });
  };

  const cadences = listQuery.data || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="text-base">Cadences</CardTitle>
          <CardDescription>
            The outreach sequences your team can enroll businesses into. Editing creates a new
            version — businesses mid-cadence finish on the version they started.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New cadence
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {cadences.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold m-0">
                {c.name} <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}>v{c.version}</span>
              </p>
              <p className="text-xs m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-2)' }}>
                {(c.steps || []).length} steps — {(c.steps || []).map((s) => CHANNEL_LABEL[s.channel] || s.channel).join(' → ')}
              </p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c)}>
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button
              size="sm" variant="ghost"
              disabled={retireMutation.isPending}
              onClick={() => retireMutation.mutate(c.id)}
            >
              Retire
            </Button>
          </div>
        ))}
        {!listQuery.isLoading && cadences.length === 0 && (
          <p className="text-sm text-center py-6 m-0" style={{ color: 'var(--ro-text-2)' }}>
            No cadences yet — create the first sequence your team will run.
          </p>
        )}
      </CardContent>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New cadence'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Saving creates v${editing.version + 1}. Businesses already enrolled keep following v${editing.version}.`
                : 'Each step becomes a task in the owner’s queue at the right time.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="cadence-name">Name</Label>
              <Input id="cadence-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beauty salons — call-first" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cadence-desc">Description (optional)</Label>
              <Input id="cadence-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When should reps pick this one?" />
            </div>
            <div className="space-y-2.5">
              {steps.map((s, i) => (
                <StepEditor
                  key={i}
                  step={s} index={i} total={steps.length}
                  onChange={(next) => setSteps(steps.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
                  onMove={(dir) => {
                    const j = i + dir;
                    const next = [...steps];
                    [next[i], next[j]] = [next[j], next[i]];
                    setSteps(next);
                  }}
                />
              ))}
            </div>
            <Button variant="outline" size="sm" disabled={steps.length >= 20} onClick={() => setSteps([...steps, emptyStep('whatsapp')])}>
              <Plus className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Add step
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button disabled={saveMutation.isPending} onClick={save}>
              {saveMutation.isPending ? 'Saving…' : editing ? `Save as v${editing.version + 1}` : 'Create cadence'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
