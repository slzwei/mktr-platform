import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutPanelTop,
  Loader2,
  Monitor,
  Palette,
  Plus,
  Save,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import GuidedReviewPage, { GuidedReviewSuccess } from './GuidedReviewPage';
import {
  GUIDED_REVIEW_REWARD_CONDITIONS,
  GUIDED_REVIEW_SECTION_LIBRARY,
  GUIDED_REVIEW_TEMPLATES,
  createGuidedReviewTemplate,
  guidedReviewToQuiz,
  normalizeGuidedReview,
  reorderGuidedReviewSections,
} from './guidedReviewDefaults';

const SECTION_META = Object.fromEntries(GUIDED_REVIEW_SECTION_LIBRARY.map((section) => [section.id, section]));

function SortableSectionRow({ section, sectionMeta, selected, onSelect, onToggle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const isQuestions = section.type === 'questions';
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={`group flex items-center gap-1 rounded-md px-1 py-1 transition ${selected ? 'bg-white shadow-sm ring-1 ring-black/5' : 'hover:bg-white/70'} ${isDragging ? 'opacity-60 shadow-lg ring-1 ring-black/10' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        aria-label={`Drag ${sectionMeta.label} section`}
        title="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 px-1 py-1 text-left">
        <span className="block truncate text-xs font-medium">{sectionMeta.label}</span>
        <span className="block truncate text-[9px] text-muted-foreground">{sectionMeta.description}</span>
      </button>
      <button
        type="button"
        disabled={isQuestions}
        onClick={onToggle}
        className={`shrink-0 rounded p-1 ${isQuestions ? 'cursor-not-allowed opacity-40' : 'hover:bg-muted'}`}
        title={isQuestions ? 'Required conversion section' : undefined}
        aria-label={isQuestions ? 'Questions section is required' : `${section.visible ? 'Hide' : 'Show'} ${sectionMeta.label}`}
      >
        {section.visible ? <Eye className="h-3 w-3 text-muted-foreground" /> : <EyeOff className="h-3 w-3 text-muted-foreground/50" />}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      <Input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {hint && <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LongField({ label, value, onChange, placeholder, rows = 4, hint }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      <Textarea value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} className="resize-none" />
      {hint && <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function InspectorIntro({ eyebrow, title, description }) {
  return (
    <div className="pb-5 border-b border-border">
      <p className="text-[10px] uppercase tracking-[0.17em] font-bold text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function ArrayCardsEditor({ items, onChange, labels = {} }) {
  const update = (index, key, value) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  return (
    <div className="space-y-3">
      {(items || []).map((item, index) => (
        <div key={index} className="rounded-lg border border-border bg-muted/35 p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Card {index + 1}</p>
          <Input value={item.title || ''} onChange={(event) => update(index, 'title', event.target.value)} placeholder={labels.title || 'Card title'} />
          <Textarea value={item.body || ''} onChange={(event) => update(index, 'body', event.target.value)} placeholder={labels.body || 'Supporting copy'} rows={3} className="resize-none" />
        </div>
      ))}
    </div>
  );
}

function QuestionEditor({ questions, onChange }) {
  const update = (index, patch) => onChange(questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question));
  const remove = (index) => onChange(questions.filter((_, questionIndex) => questionIndex !== index));
  const add = () => onChange([
    ...questions,
    { id: `question-${Date.now()}`, prompt: 'What would you most like help with?', options: ['Option one', 'Option two', 'Not sure'] },
  ]);

  return (
    <div className="space-y-3">
      {questions.map((question, index) => (
        <div key={question.id || index} className="rounded-lg border border-border bg-muted/35 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Question {index + 1}</p>
            {questions.length > 1 && <button type="button" onClick={() => remove(index)} className="p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove question ${index + 1}`}><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>
          <Textarea value={question.prompt || ''} onChange={(event) => update(index, { prompt: event.target.value })} rows={2} className="resize-none" />
          <Label className="text-[11px] text-muted-foreground">Options · one per line</Label>
          <Textarea
            value={(question.options || []).join('\n')}
            onChange={(event) => update(index, { options: event.target.value.split('\n').map((option) => option.trim()).filter(Boolean) })}
            rows={4}
            className="resize-none text-xs"
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={add}><Plus className="w-3.5 h-3.5 mr-1.5" />Add question</Button>
    </div>
  );
}

export default function GuidedReviewDesigner({ campaign, onSave, heightClass = 'h-[calc(100vh-13rem)]' }) {
  const storedDesign = useMemo(() => campaign?.design_config || {}, [campaign?.design_config]);
  const [draft, setDraft] = useState(() => normalizeGuidedReview(storedDesign.guidedReview, campaign?.name));
  const [pendingTemplate, setPendingTemplate] = useState(() => storedDesign.guidedReview?.templateId || 'financial_readiness');
  const [selected, setSelected] = useState('hero');
  const [viewport, setViewport] = useState('desktop');
  // A newly-created Guided Review campaign receives a complete visual preset in
  // memory; treat that preset as unsaved so the first save persists the page and
  // derives its qualification quiz even when the operator changes no copy.
  const [dirty, setDirty] = useState(() => !storedDesign.guidedReview);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const beforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const change = (recipe) => {
    setDraft((current) => recipe(current));
    setDirty(true);
    setSaved(false);
  };
  const patchSectionData = (section, patch) => change((current) => ({ ...current, [section]: { ...current[section], ...patch } }));
  const patchCustomSection = (sectionId, patch) => change((current) => ({
    ...current,
    customSections: {
      ...(current.customSections || {}),
      [sectionId]: { ...(current.customSections?.[sectionId] || {}), ...patch },
    },
  }));
  const patchTheme = (patch) => change((current) => ({ ...current, theme: { ...current.theme, ...patch } }));

  const currentSection = draft.sections.find((section) => section.id === selected);
  const meta = SECTION_META[currentSection?.type || selected]
    || (selected === 'styles'
      ? { label: 'Site styles', description: 'Global palette and typography' }
      : { label: 'Content section', description: 'A flexible editorial text section' });
  const pendingTemplateMeta = GUIDED_REVIEW_TEMPLATES.find((template) => template.id === pendingTemplate);

  const toggleSection = (id) => {
    const target = draft.sections.find((section) => section.id === id);
    // The question/form section is the conversion surface. Keeping it required
    // prevents a visually valid page that has no way to submit a lead.
    if (target?.type === 'questions') return;
    change((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === id ? { ...section, visible: !section.visible } : section),
    }));
  };
  const moveSection = (direction) => change((current) => {
    const index = current.sections.findIndex((section) => section.id === selected);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.sections.length) return current;
    const sections = [...current.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    return { ...current, sections };
  });

  const handleSectionDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    change((current) => ({
      ...current,
      sections: reorderGuidedReviewSections(current.sections, active.id, over.id),
    }));
  };

  const addTextSection = () => {
    const id = `custom-${Date.now()}`;
    change((current) => ({
      ...current,
      sections: [...current.sections, { id, type: 'custom', visible: true }],
      customSections: {
        ...(current.customSections || {}),
        [id]: { eyebrow: 'New section', title: 'Tell the story your way.', body: 'Add supporting context, proof or a useful explanation here.' },
      },
    }));
    setSelected(id);
  };

  const applyTemplate = () => {
    const template = createGuidedReviewTemplate(pendingTemplate, campaign?.name);
    setDraft({
      ...template,
      // Switching a content preset must not silently replace the accountable
      // business or its disclosure copy.
      trust: { ...template.trust, ...draft.trust },
    });
    setSelected('hero');
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ...storedDesign,
        guidedReview: draft,
        quiz: guidedReviewToQuiz(draft),
        themeColor: draft.theme.accent,
        formHeadline: 'Your details',
        formSubheadline: 'Leave your details and we will arrange a suitable review time.',
        ctaText: draft.booking.ctaLabel,
        sgPrOnly: true,
      });
      setDirty(false);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const commonFields = (section) => {
    const data = draft[section];
    return (
      <>
        <Field label="Eyebrow" value={data.eyebrow} onChange={(value) => patchSectionData(section, { eyebrow: value })} />
        <Field label="Section heading" value={data.title} onChange={(value) => patchSectionData(section, { title: value })} />
        <LongField label="Supporting copy" value={data.body} onChange={(value) => patchSectionData(section, { body: value })} rows={4} />
      </>
    );
  };

  const renderInspector = () => {
    if (selected === 'styles') {
      return (
        <div className="space-y-5">
          <InspectorIntro eyebrow="Global" title="Site styles" description="A restrained editorial system keeps every Guided Review campaign recognisably Redeem." />
          <div className="grid grid-cols-2 gap-3">
            {[['accent', 'Accent'], ['ink', 'Ink'], ['paper', 'Paper'], ['sage', 'Secondary']].map(([key, label]) => (
              <label key={key} className="space-y-1.5"><span className="text-xs font-semibold">{label}</span><span className="flex h-10 items-center gap-2 rounded-md border bg-card px-2"><input type="color" value={draft.theme[key]} onChange={(event) => patchTheme({ [key]: event.target.value })} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" /><code className="text-[10px] text-muted-foreground">{draft.theme[key]}</code></span></label>
            ))}
          </div>
          <div className="space-y-2"><Label className="text-xs font-semibold">Heading style</Label><Select value={draft.theme.headingStyle} onValueChange={(value) => patchTheme({ headingStyle: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editorial">Editorial serif</SelectItem><SelectItem value="modern">Modern sans</SelectItem></SelectContent></Select></div>
        </div>
      );
    }

    const intro = <InspectorIntro eyebrow="Page section" title={meta.label} description={meta.description} />;
    switch (currentSection?.type) {
      case 'hero': return <div className="space-y-4">{intro}<Field label="Campaign label" value={draft.hero.eyebrow} onChange={(value) => patchSectionData('hero', { eyebrow: value })} /><LongField label="Main headline" value={draft.hero.headline} onChange={(value) => patchSectionData('hero', { headline: value })} rows={2} /><LongField label="Supporting headline" value={draft.hero.supportingHeadline} onChange={(value) => patchSectionData('hero', { supportingHeadline: value })} rows={2} /><LongField label="Introduction" value={draft.hero.body} onChange={(value) => patchSectionData('hero', { body: value })} /><Field label="Primary button" value={draft.hero.ctaLabel} onChange={(value) => patchSectionData('hero', { ctaLabel: value })} /><Field label="Availability note" value={draft.hero.closingLabel} onChange={(value) => patchSectionData('hero', { closingLabel: value })} /><Field label="Visual card label" value={draft.hero.visualLabel} onChange={(value) => patchSectionData('hero', { visualLabel: value })} /></div>;
      case 'audience': return <div className="space-y-4">{intro}{commonFields('audience')}<LongField label="Eligibility badges" value={(draft.audience.chips || []).join('\n')} onChange={(value) => patchSectionData('audience', { chips: value.split('\n').map((item) => item.trim()).filter(Boolean) })} rows={4} hint="One badge per line." /></div>;
      case 'problem': return <div className="space-y-4">{intro}{commonFields('problem')}<ArrayCardsEditor items={draft.problem.cards || []} onChange={(cards) => patchSectionData('problem', { cards })} /></div>;
      case 'review': return <div className="space-y-4">{intro}{commonFields('review')}<div className="grid grid-cols-2 gap-3"><Field label="Duration" value={draft.review.duration} onChange={(value) => patchSectionData('review', { duration: value })} /><Field label="Session mode" value={draft.review.mode} onChange={(value) => patchSectionData('review', { mode: value })} /></div><LongField label="No-obligation promise" value={draft.review.noObligation} onChange={(value) => patchSectionData('review', { noObligation: value })} rows={3} /><ArrayCardsEditor items={draft.review.outcomes || []} onChange={(outcomes) => patchSectionData('review', { outcomes })} labels={{ title: 'Outcome title', body: 'What the participant gets' }} /></div>;
      case 'rewards': return (
        <div className="space-y-4">
          {intro}
          {commonFields('rewards')}
          {['grand', 'attendance'].map((rewardKey) => {
            const reward = draft.rewards[rewardKey];
            return (
              <div key={rewardKey} className="rounded-xl border p-3 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{rewardKey === 'grand' ? 'Entry reward' : 'Attendance reward'}</p>
                <Field label="Label" value={reward.label} onChange={(value) => patchSectionData('rewards', { [rewardKey]: { ...reward, label: value } })} />
                <Field label="Reward name" value={reward.title} onChange={(value) => patchSectionData('rewards', { [rewardKey]: { ...reward, title: value } })} />
                <Field label="Value / availability" value={reward.value} onChange={(value) => patchSectionData('rewards', { [rewardKey]: { ...reward, value } })} />
                <LongField label="Description" value={reward.body} onChange={(value) => patchSectionData('rewards', { [rewardKey]: { ...reward, body: value } })} rows={3} />
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Eligibility event</Label>
                  <Select
                    value={reward.conditionKey}
                    onValueChange={(conditionKey) => {
                      const condition = GUIDED_REVIEW_REWARD_CONDITIONS.find((item) => item.id === conditionKey)?.label;
                      patchSectionData('rewards', { [rewardKey]: { ...reward, conditionKey, condition } });
                    }}
                  >
                    <SelectTrigger aria-label={`${rewardKey} eligibility event`}><SelectValue /></SelectTrigger>
                    <SelectContent>{GUIDED_REVIEW_REWARD_CONDITIONS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Allocation" type="number" value={reward.quantity} onChange={(value) => patchSectionData('rewards', { [rewardKey]: { ...reward, quantity: Math.max(0, Number(value) || 0) } })} hint="Available rewards" />
                  <Field label="Fulfilment" type="number" value={reward.fulfilmentDays} onChange={(value) => patchSectionData('rewards', { [rewardKey]: { ...reward, fulfilmentDays: Math.max(1, Number(value) || 1) } })} hint="Days after eligibility" />
                </div>
              </div>
            );
          })}
        </div>
      );
      case 'questions': return <div className="space-y-4">{intro}{commonFields('questions')}<Field label="Start button" value={draft.questions.ctaLabel} onChange={(value) => patchSectionData('questions', { ctaLabel: value })} /><QuestionEditor questions={draft.questions.items || []} onChange={(items) => patchSectionData('questions', { items })} /></div>;
      case 'booking': return <div className="space-y-4">{intro}{commonFields('booking')}<Field label="Primary button" value={draft.booking.ctaLabel} onChange={(value) => patchSectionData('booking', { ctaLabel: value })} /><LongField label="Consent note" value={draft.booking.note} onChange={(value) => patchSectionData('booking', { note: value })} rows={3} /></div>;
      case 'trust': return <div className="space-y-4">{intro}{commonFields('trust')}<Field label="Campaign operator" value={draft.trust.operator} onChange={(value) => patchSectionData('trust', { operator: value })} /><Field label="Operator UEN" value={draft.trust.operatorUen} onChange={(value) => patchSectionData('trust', { operatorUen: value })} /><Field label="Review provider" value={draft.trust.partner} onChange={(value) => patchSectionData('trust', { partner: value })} /><LongField label="Regulatory disclosure" value={draft.trust.disclosure} onChange={(value) => patchSectionData('trust', { disclosure: value })} rows={6} /></div>;
      case 'success': return <div className="space-y-4">{intro}{commonFields('success')}<Field label="Reward status" value={draft.success.statusLabel} onChange={(value) => patchSectionData('success', { statusLabel: value })} /><LongField label="Next step" value={draft.success.nextStep} onChange={(value) => patchSectionData('success', { nextStep: value })} rows={4} /><Field label="Share button" value={draft.success.shareLabel} onChange={(value) => patchSectionData('success', { shareLabel: value })} /></div>;
      case 'custom': { const data = draft.customSections?.[currentSection.id] || {}; return <div className="space-y-4">{intro}<Field label="Eyebrow" value={data.eyebrow} onChange={(value) => patchCustomSection(currentSection.id, { eyebrow: value })} /><Field label="Section heading" value={data.title} onChange={(value) => patchCustomSection(currentSection.id, { title: value })} /><LongField label="Supporting copy" value={data.body} onChange={(value) => patchCustomSection(currentSection.id, { body: value })} rows={6} /></div>; }
      default: return <div>{intro}</div>;
    }
  };

  return (
    <div className={`${heightClass} flex min-h-[620px] overflow-hidden bg-[#f3f3f1] text-foreground`}>
      <aside className="w-[230px] shrink-0 border-r border-[#dededb] bg-[#f8f8f6] flex flex-col">
        <div className="h-14 px-4 flex items-center gap-2 border-b border-[#dededb]"><LayoutPanelTop className="w-4 h-4" /><div><p className="text-xs font-semibold">Review page</p><p className="text-[10px] text-muted-foreground">{campaign?.name}</p></div></div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-3 rounded-lg border border-[#dededb] bg-white p-2.5 space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Starting point</Label>
            <Select value={pendingTemplate} onValueChange={setPendingTemplate}>
              <SelectTrigger className="h-9 text-xs" aria-label="Guided Review template"><SelectValue /></SelectTrigger>
              <SelectContent>{GUIDED_REVIEW_TEMPLATES.map((template) => <SelectItem key={template.id} value={template.id}>{template.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[9px] leading-4 text-muted-foreground">{pendingTemplateMeta?.description}</p>
            <div className="rounded-md border border-[#e5e3df] bg-[#fafaf8] p-2">
              <div className="flex gap-1.5" aria-label={`${pendingTemplateMeta?.label} colour scheme`}>
                {['accent', 'ink', 'paper', 'sage'].map((colour) => (
                  <span
                    key={colour}
                    className="h-4 flex-1 rounded-sm border border-black/10"
                    style={{ backgroundColor: pendingTemplateMeta?.theme?.[colour] }}
                    title={`${colour}: ${pendingTemplateMeta?.theme?.[colour]}`}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-muted-foreground">{pendingTemplateMeta?.paletteLabel}</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-7 w-full text-[10px]" disabled={pendingTemplate === draft.templateId} onClick={applyTemplate}>Apply template</Button>
            {pendingTemplate !== draft.templateId && <p className="text-[9px] leading-4 text-amber-700">Replaces page copy, questions, rewards and styles. Trust and disclosure details are preserved.</p>}
          </div>
          <div className="flex items-center justify-between px-2 py-2"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Page sections</span><button type="button" onClick={addTextSection} className="p-1 rounded hover:bg-muted" aria-label="Add section"><Plus className="w-3.5 h-3.5" /></button></div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
            <SortableContext items={draft.sections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {draft.sections.map((section) => {
                  const sectionMeta = SECTION_META[section.type] || { label: 'Content section', description: 'Reusable content block' };
                  return (
                    <SortableSectionRow
                      key={section.id}
                      section={section}
                      sectionMeta={sectionMeta}
                      selected={selected === section.id}
                      onSelect={() => setSelected(section.id)}
                      onToggle={() => toggleSection(section.id)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
          <div className="mt-5 pt-4 border-t border-[#dededb]"><button type="button" onClick={() => setSelected('styles')} className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-left ${selected === 'styles' ? 'bg-white shadow-sm ring-1 ring-black/5' : 'hover:bg-white/70'}`}><Palette className="w-3.5 h-3.5" /><span><span className="block text-xs font-medium">Site styles</span><span className="block text-[9px] text-muted-foreground">Colours and typography</span></span></button></div>
        </div>
        <div className="p-3 border-t border-[#dededb]"><Button onClick={handleSave} disabled={saving || !dirty} className="w-full bg-black text-white hover:bg-black/85">{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : saved ? <Check className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}{saving ? 'Saving…' : saved ? 'Saved' : 'Save page'}</Button><p className={`mt-2 text-center text-[10px] ${dirty ? 'text-amber-600' : 'text-muted-foreground'}`}>{dirty ? 'Unsaved page changes' : 'All changes saved'}</p></div>
      </aside>

      <aside className="w-[350px] shrink-0 border-r border-[#dededb] bg-white flex flex-col">
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#dededb]"><div className="flex items-center gap-2"><ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs font-semibold">{meta.label}</span></div>{currentSection && <div className="flex gap-1"><button type="button" className="p-1.5 rounded hover:bg-muted disabled:opacity-30" onClick={() => moveSection(-1)} disabled={draft.sections[0]?.id === selected} aria-label="Move section up"><ArrowUp className="w-3.5 h-3.5" /></button><button type="button" className="p-1.5 rounded hover:bg-muted disabled:opacity-30" onClick={() => moveSection(1)} disabled={draft.sections.at(-1)?.id === selected} aria-label="Move section down"><ArrowDown className="w-3.5 h-3.5" /></button></div>}</div>
        {currentSection && <div className="px-4 py-2.5 border-b flex items-center justify-between"><div><p className="text-xs font-medium">Show section</p><p className="text-[10px] text-muted-foreground">{currentSection.type === 'questions' ? 'Required for lead submission.' : 'Hidden sections stay saved.'}</p></div><Switch checked={currentSection.visible} disabled={currentSection.type === 'questions'} onCheckedChange={() => toggleSection(currentSection.id)} aria-label="Show section" /></div>}
        <div className="flex-1 overflow-y-auto p-5">{renderInspector()}</div>
      </aside>

      <main className="min-w-0 flex-1 flex flex-col">
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#dededb] bg-white"><div><p className="text-xs font-semibold">Live page canvas</p><p className="text-[10px] text-muted-foreground">Click any section to edit it</p></div><div className="flex items-center gap-1 rounded-md bg-[#efefed] p-1"><button type="button" onClick={() => setViewport('desktop')} className={`p-1.5 rounded ${viewport === 'desktop' ? 'bg-white shadow-sm' : ''}`} aria-label="Desktop preview"><Monitor className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setViewport('mobile')} className={`p-1.5 rounded ${viewport === 'mobile' ? 'bg-white shadow-sm' : ''}`} aria-label="Mobile preview"><Smartphone className="w-3.5 h-3.5" /></button></div></div>
        <div className="flex-1 min-h-0 overflow-auto p-5 bg-[#e9e9e6]">
          <div className={`mx-auto min-h-full overflow-hidden bg-white shadow-[0_12px_45px_rgba(0,0,0,.12)] transition-[width] duration-200 ${viewport === 'mobile' ? 'gr-editor-mobile w-[390px] max-w-full' : 'w-full max-w-[1180px]'}`}>
            {selected === 'success' ? <GuidedReviewSuccess config={draft} campaignName={campaign?.name} editableProps={{ selected: true, onSelect: setSelected }} /> : <GuidedReviewPage config={draft} campaignName={campaign?.name} selectedSection={selected} onSelectSection={setSelected} onCta={() => setSelected('questions')} />}
          </div>
        </div>
      </main>
    </div>
  );
}
