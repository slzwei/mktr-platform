import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import ArrowUp from 'lucide-react/icons/arrow-up';
import ArrowDown from 'lucide-react/icons/arrow-down';
import Zap from 'lucide-react/icons/zap';
import Sparkles from 'lucide-react/icons/sparkles';
import { redeemOpsApi } from '@/api/redeemOps';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RoPageHeader } from '@/components/redeemops/ui';
import {
  CHANNELS, WINDOWS, PRIORITIES, CONTINUE_OPTIONS, CHANNEL_LABEL,
  emptyStep, toBuilderSteps, cumulativeDays, toPayload,
} from '@/components/redeemops/cadenceBuilder';

function Field({ label, children, className = '' }) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <Label className="text-xs font-semibold" style={{ color: 'var(--ro-text-2)' }}>{label}</Label>
      {children}
    </div>
  );
}

function StepCard({ step, index, total, dayMark, onChange, onRemove, onMove }) {
  const set = (patch) => onChange({ ...step, ...patch });
  const isLast = index === total - 1;
  return (
    <div className="relative pl-12">
      {/* timeline gutter: numbered bubble + connector */}
      <div className="absolute left-0 top-0 bottom-0 flex flex-col items-center w-8">
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 bg-white border border-border"
          style={{ color: 'var(--ro-bunker, #0D1619)' }}
        >
          {index + 1}
        </span>
        {!isLast && <span className="w-px flex-1 mt-1" style={{ background: 'var(--ro-subtle)' }} />}
      </div>

      <div className="rounded-2xl border border-border bg-white p-4 md:p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--ro-text-3)' }}>
            Step {index + 1} · ≈ Day {dayMark}
          </span>
          <span className="inline-flex gap-0.5">
            <Button size="sm" variant="ghost" aria-label="Move step up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move step down" disabled={isLast} onClick={() => onMove(1)}>
              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Remove step" disabled={total === 1} onClick={onRemove}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-[170px_1fr_130px]">
          <Field label="Channel">
            <Select value={step.channel} onValueChange={(channel) => set({ channel, continueOn: channel === 'call' ? 'no_answer' : '*' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Task title">
            <Input
              value={step.title}
              placeholder="What the rep sees in their queue"
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <Field label="Priority">
            <Select value={step.priority} onValueChange={(priority) => set({ priority })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className={`grid gap-3 ${isLast ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          <Field label={index === 0 ? 'Start (days after enrolling)' : 'Wait (days after previous step)'}>
            <Input
              type="number" min={0} max={60}
              value={step.delayDays}
              onChange={(e) => set({ delayDays: e.target.value })}
            />
          </Field>
          <Field label="Time window (SGT)">
            <Select value={step.timeWindow} onValueChange={(timeWindow) => set({ timeWindow })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {!isLast && (
            <Field label="Continue to next step when">
              <Select value={step.continueOn} onValueChange={(continueOn) => set({ continueOn })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(CONTINUE_OPTIONS[step.channel] || CONTINUE_OPTIONS.custom).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>

        <Field label="Script / notes (shown on the task)">
          <Textarea
            rows={4}
            value={step.script}
            placeholder={'Hi {{contact_name}}, calling about {{partner_name}} — …'}
            onChange={(e) => set({ script: e.target.value })}
          />
        </Field>

        {isLast && (
          <p className="text-[12px] m-0" style={{ color: 'var(--ro-text-3)' }}>
            Last step — any outcome finishes the cadence.
          </p>
        )}
      </div>
    </div>
  );
}

export default function CadenceEditorPage() {
  const { cadenceId } = useParams();
  const isNew = !cadenceId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState([emptyStep()]);
  const [loadedFrom, setLoadedFrom] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSteps, setAiSteps] = useState('auto');

  const listQuery = useQuery({
    queryKey: ['redeem-ops', 'cadences', 'all'],
    // Enabled in NEW mode too — the response carries aiEnabled for the AI card.
    queryFn: () => redeemOpsApi.listCadences({ all: 'true' }),
  });
  const base = isNew ? null : (listQuery.data?.cadences || []).find((c) => c.id === cadenceId);
  const aiEnabled = listQuery.data?.aiEnabled === true;

  useEffect(() => {
    if (base && loadedFrom !== base.id) {
      setName(base.name);
      setDescription(base.description || '');
      setSteps(toBuilderSteps(base));
      setLoadedFrom(base.id);
    }
  }, [base, loadedFrom]);

  useEffect(() => {
    if (!isNew && listQuery.isSuccess && !base) {
      toast.error('Cadence not found');
      navigate('/redeem-ops/settings', { replace: true });
    }
  }, [isNew, listQuery.isSuccess, base, navigate]);

  const saveMutation = useMutation({
    mutationFn: (payload) => (isNew
      ? redeemOpsApi.createCadence(payload)
      : redeemOpsApi.createCadenceVersion(cadenceId, payload)),
    onSuccess: (cadence) => {
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'cadences'] });
      toast.success(isNew
        ? 'Cadence created — it’s in every Start cadence picker now'
        : `Saved as v${cadence?.version} — businesses already enrolled finish on their current version`);
      navigate('/redeem-ops/settings');
    },
    onError: (err) => toast.error('Could not save the cadence', { description: err.message }),
  });

  const save = () => {
    if (!name.trim()) return toast.error('Give the cadence a name');
    if (steps.some((s) => !s.title.trim())) return toast.error('Every step needs a title');
    return saveMutation.mutate(toPayload({ name, description, steps }));
  };

  // The AI draft only POPULATES the builder — creating still goes through the
  // human-reviewed save above.
  const suggestMutation = useMutation({
    mutationFn: () => redeemOpsApi.suggestCadence({
      prompt: aiPrompt.trim(),
      ...(aiSteps !== 'auto' ? { stepCount: Number(aiSteps) } : {}),
    }),
    onSuccess: (draft) => {
      if (!draft?.steps?.length) return;
      setName(draft.name || '');
      setDescription(draft.description || '');
      setSteps(draft.steps);
      toast.success('Draft ready — review each step before creating');
    },
    onError: (err) => toast.error('Could not draft the cadence', { description: err.message }),
  });
  // Structural pristine check (reference compare would always read dirty —
  // both the state array and emptyStep() are fresh allocations).
  const pristineStep = emptyStep();
  const isPristine = !name.trim() && !description.trim() && steps.length === 1
    && Object.keys(pristineStep).every((k) => String(steps[0][k]) === String(pristineStep[k]));
  const generateDraft = () => {
    if (!isPristine
      && !window.confirm('Replace your current name, description and steps with the AI draft?')) {
      return;
    }
    suggestMutation.mutate();
  };
  const canGenerate = aiPrompt.trim().length >= 3 && !suggestMutation.isPending;

  const dayMarks = useMemo(() => cumulativeDays(steps), [steps]);
  const spanDays = dayMarks[dayMarks.length - 1] || 0;

  if (!isNew && listQuery.isLoading) {
    return <div className="p-8" style={{ color: 'var(--ro-text-2)' }}>Loading cadence…</div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5">
      <RoPageHeader
        title={isNew ? 'New cadence' : `Edit — ${base?.name || ''}`}
        sub={isNew
          ? 'Each step becomes a task in the owner’s queue at the right time. Replies and “not interested” always end the cadence early.'
          : `Saving creates v${(base?.version || 1) + 1}. Businesses already enrolled keep following v${base?.version}.`}
        actions={(
          <span className="inline-flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/redeem-ops/settings">Cancel</Link>
            </Button>
            <Button disabled={saveMutation.isPending} onClick={save}>
              {saveMutation.isPending ? 'Saving…' : isNew ? 'Create cadence' : `Save as v${(base?.version || 1) + 1}`}
            </Button>
          </span>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        <div className="space-y-4">
          {isNew && aiEnabled && (
            <div className="rounded-2xl p-4 md:p-5 grid gap-3"
              style={{ background: 'var(--ro-subtle)', border: '1px dashed var(--ro-border)' }}>
              <p className="text-[14px] font-bold m-0">
                <Sparkles className="w-4 h-4 inline mr-1.5 -mt-0.5" aria-hidden="true" />
                Draft with AI
              </p>
              <Field label="Describe the cadence you want">
                <Textarea
                  rows={2}
                  value={aiPrompt}
                  placeholder={'e.g. "Call-first chase for cafés that just opened — gentle tone, WhatsApp follow-ups, finish with a walk-in visit"'}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
              </Field>
              <div className="flex items-end gap-3">
                <Field label="Steps" className="w-[110px]">
                  <Select value={aiSteps} onValueChange={setAiSteps}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Button variant="outline" disabled={!canGenerate} onClick={generateDraft}>
                  <Sparkles className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  {suggestMutation.isPending ? 'Drafting…' : 'Generate draft'}
                </Button>
                <p className="text-[12px] m-0 pb-2" style={{ color: 'var(--ro-text-3)' }}>
                  Fills the builder below — nothing is saved until you hit Create.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-white p-4 md:p-5 grid gap-3.5">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beauty salons — call-first" />
            </Field>
            <Field label="Description (optional — when should reps pick this one?)">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Cold chase for beauty & wellness outlets" />
            </Field>
          </div>

          <div className="space-y-4">
            {steps.map((s, i) => (
              <StepCard
                key={i}
                step={s} index={i} total={steps.length} dayMark={dayMarks[i]}
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

          <div className="pl-12">
            <Button variant="outline" disabled={steps.length >= 20} onClick={() => setSteps([...steps, emptyStep('whatsapp')])}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add step
            </Button>
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-border bg-white p-5">
            <p className="text-[15px] font-bold m-0 mb-2">
              <Zap className="w-4 h-4 inline mr-1 -mt-0.5" aria-hidden="true" /> Summary
            </p>
            <p className="text-[13px] m-0 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
              {steps.length} step{steps.length === 1 ? '' : 's'} over ≈ {spanDays} day{spanDays === 1 ? '' : 's'}
            </p>
            <p className="text-[13px] mt-1.5 mb-0 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
              {steps.map((s) => CHANNEL_LABEL[s.channel] || s.channel).join(' → ')}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5">
            <p className="text-[15px] font-bold m-0 mb-2">Merge fields</p>
            <p className="text-[12.5px] m-0 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
              Scripts can use <code>{'{{partner_name}}'}</code>, <code>{'{{contact_name}}'}</code>,{' '}
              <code>{'{{category}}'}</code> and <code>{'{{recipient}}'}</code> — filled in when each
              task is created. An unknown field blocks the step, so stick to these.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5">
            <p className="text-[15px] font-bold m-0 mb-2">How steps advance</p>
            <p className="text-[12.5px] m-0 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>
              A step only reaches the next one on its “continue when” outcome. Replies and
              “not interested” end the cadence immediately; moving the business to Meeting or
              beyond, snoozing, or releasing it stops the schedule automatically. Steps that can’t
              reach anyone (no phone or handle on record) are skipped.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
