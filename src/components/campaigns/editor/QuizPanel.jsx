import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Sparkles, GripVertical } from "lucide-react";
import { genId } from "./constants";

/**
 * QuizPanel — authoring UI for `design_config.quiz` (the IG/TikTok quiz funnel).
 *
 * Edits the single `quiz` object on the campaign's design_config via the existing
 * onDesignChange('quiz', …) mechanism, so it persists through the unchanged
 * Campaign.update({ design_config }) path — no backend change to save.
 *
 * The scorer (src/lib/quizScoring.js + backend/quizScoringService.js) reads this
 * shape. Each option maps to exactly one result profile (scores = { [id]: 1 });
 * the basic editor keeps that 1:1 mapping. rankFactor / tagPoints / bands are
 * managed via the starter template (or the Advanced JSON escape hatch).
 *
 * Canonical schema + validated content: docs/quiz-protection-personality.md.
 */

// The validated "Protection Personality" quiz (v2). "Load starter" drops this in
// so admins begin from the tested quiz and tweak copy, rather than building blind.
export const STARTER_QUIZ = {
  enabled: true,
  quizId: "protection-personality",
  version: 2,
  intro: {
    headline: "What's your money personality?",
    subhead: "A 60-second quiz. Find your type — and your blind spots.",
    ctaLabel: "Start the quiz",
  },
  scoring: {
    method: "profile-sum",
    tiebreak: "prepared-first",
    profileOrder: ["the-rock", "the-strategist", "the-dreamer", "the-free-spirit"],
    readiness: {
      enabled: true,
      label: "Your Protection Readiness",
      rankFactor: { "the-rock": 1.0, "the-strategist": 0.66, "the-dreamer": 0.33, "the-free-spirit": 0.0 },
    },
    leadScore: {
      enabled: true,
      tagPoints: {
        exposed: 3, uncertain: 2, covered: 1, confident: 0,
        "family-dependents": 3, couple: 2, single: 1, "single-free": 1,
        "life-income": 2, "savings-retirement": 2, "nurture-warm": 1, "nurture-cold": 0,
      },
      bands: [
        { gte: 6, label: "Hot", badge: "🔥" },
        { gte: 3, label: "Warm", badge: "🌤️" },
        { label: "Cool", badge: "❄️" },
      ],
    },
  },
  reveal: {
    alwaysShowGap: true,
    rarityEnabled: true,
    valueExchange: "Where should we send your full Protection Breakdown?",
    ctaSubtext: "Plus a free 15-min gap review with a licensed adviser.",
    tagAFriend: "Tag a friend who's a total Free Spirit 😎",
    disclaimer: "This quiz is for general information only and is not financial advice. By submitting, you agree to be contacted by a licensed financial representative.",
  },
  steps: [
    { id: "step1", questions: [{ id: "q1_weekend", prompt: "Pick your ideal weekend", type: "single", weight: 1, options: [
      { id: "cosy", label: "Cosy, planned, in bed by 11 🛌", scores: { "the-rock": 1 } },
      { id: "mix", label: "A bit of plan, a bit of spontaneous", scores: { "the-strategist": 1 } },
      { id: "adventure", label: "Last-minute yes to everything 🙌", scores: { "the-dreamer": 1 } },
      { id: "night", label: "Wherever the night takes me 🎉", scores: { "the-free-spirit": 1 } },
    ] }] },
    { id: "step2", questions: [{ id: "q2_payday", prompt: "Payday hits. First move?", type: "single", weight: 2, options: [
      { id: "save", label: "Straight to savings & investments 💰", scores: { "the-rock": 1 } },
      { id: "split", label: "Split — some saved, some for me", scores: { "the-strategist": 1 } },
      { id: "bills", label: "Pay the bills, pray for leftover", scores: { "the-dreamer": 1 } },
      { id: "treat", label: "Treat myself first — life's short! 🧋", scores: { "the-free-spirit": 1 } },
    ] }] },
    { id: "step3", questions: [{ id: "q3_circle", prompt: "Who's in your circle right now?", type: "single", weight: 2, options: [
      { id: "family", label: "Family who count on me (kids / parents)", scores: { "the-rock": 1 }, tag: "family-dependents" },
      { id: "partner", label: "Me and my other half", scores: { "the-strategist": 1 }, tag: "couple" },
      { id: "solo", label: "Just me — building my future", scores: { "the-dreamer": 1 }, tag: "single" },
      { id: "free", label: "Just me — no strings, living free", scores: { "the-free-spirit": 1 }, tag: "single-free" },
    ] }] },
    { id: "step4", questions: [{ id: "q4_worry", prompt: "The 'what if' that nags you most?", type: "single", weight: 1, options: [
      { id: "family_ok", label: "\"Would my family be okay without me?\"", scores: { "the-rock": 1 }, tag: "life-income" },
      { id: "saving", label: "\"Am I saving enough for the future?\"", scores: { "the-strategist": 1 }, tag: "savings-retirement" },
      { id: "eventually", label: "\"I'll sort my finances out… eventually\"", scores: { "the-dreamer": 1 }, tag: "nurture-warm" },
      { id: "avoid", label: "\"Honestly, I try not to think about it\"", scores: { "the-free-spirit": 1 }, tag: "nurture-cold" },
    ] }] },
    { id: "step5", questions: [{ id: "q5_protected", prompt: "How protected do you feel right now?", type: "single", weight: 3, options: [
      { id: "solid", label: "Rock-solid — life, health, the works", scores: { "the-rock": 1 }, tag: "confident" },
      { id: "basics", label: "Pretty covered — got the basics", scores: { "the-strategist": 1 }, tag: "covered" },
      { id: "patchy", label: "A bit patchy — not sure what I have", scores: { "the-dreamer": 1 }, tag: "uncertain" },
      { id: "exposed", label: "Honestly? Exposed", scores: { "the-free-spirit": 1 }, tag: "exposed" },
    ] }] },
    { id: "step6", questions: [{ id: "q6_bill", prompt: "A surprise $5,000 bill lands tomorrow. You…", type: "single", weight: 3, options: [
      { id: "fund", label: "Tap my emergency fund — no stress", scores: { "the-rock": 1 } },
      { id: "sting", label: "Manage, but it'd sting", scores: { "the-strategist": 1 } },
      { id: "credit", label: "Scramble a bit / put it on credit", scores: { "the-dreamer": 1 } },
      { id: "later", label: "Cross that bridge when I get there 🤷", scores: { "the-free-spirit": 1 } },
    ] }] },
  ],
  resultProfiles: [
    { id: "the-rock", title: "The Rock", subtitle: "The Guardian", description: "You think ahead and make sure the people you love are covered.", tagline: "Rain or shine, my people are covered. 🛡️", themeColor: "#0F9D58", ctaLabel: "Get my free protection check", agentAngle: "optimise / legacy / wealth transfer" },
    { id: "the-strategist", title: "The Strategist", subtitle: "The Planner", description: "Solid foundations, playing the long game. A few smart moves and you're sorted.", tagline: "Agak-agak also must steady. ♟️", themeColor: "#1A73E8", ctaLabel: "See where I can level up", agentAngle: "savings / retirement top-up" },
    { id: "the-dreamer", title: "The Big Dreamer", subtitle: "The Go-Getter", description: "Chasing big goals. Protection is on the list — just not at the top yet.", tagline: "Chiong first, sort the rest later lah! 🚀", themeColor: "#F4B400", ctaLabel: "Show me my blind spots", agentAngle: "starter health + CI, then savings" },
    { id: "the-free-spirit", title: "The Free Spirit", subtitle: "The Live-for-Now", description: "You live for today. Spontaneous and fun — but a curveball could catch you off guard.", tagline: "YOLO! Future me can deal with it. 😎", themeColor: "#DB4437", ctaLabel: "Find my biggest gap", agentAngle: "affordable starter protection" },
  ],
};

export const BLANK_QUIZ = {
  enabled: true,
  quizId: "",
  version: 1,
  intro: { headline: "", subhead: "", ctaLabel: "Start" },
  scoring: { method: "profile-sum", tiebreak: "prepared-first", profileOrder: [], readiness: { enabled: false, rankFactor: {} }, leadScore: { enabled: false, tagPoints: {}, bands: [] } },
  steps: [],
  resultProfiles: [],
};

export default function QuizPanel({ currentDesign, onDesignChange }) {
  const quiz = currentDesign.quiz || null;
  const setQuiz = (next) => onDesignChange("quiz", next);
  const patch = (partial) => setQuiz({ ...quiz, ...partial });
  const patchIntro = (partial) => patch({ intro: { ...(quiz.intro || {}), ...partial } });
  const patchScoring = (partial) => patch({ scoring: { ...(quiz.scoring || {}), ...partial } });

  // Flatten steps→questions (this quiz uses one question per step).
  const questions = useMemo(
    () => (quiz?.steps || []).flatMap((s, si) => (s.questions || []).map((q) => ({ q, si }))),
    [quiz]
  );
  const profiles = quiz?.resultProfiles || [];

  if (!quiz) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 px-4 border-2 border-dashed border-border rounded-xl">
          <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No quiz yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Add a personality quiz in front of the lead form. Users answer, see a result, then leave their details.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => setQuiz(structuredClone(STARTER_QUIZ))}>
              <Sparkles className="w-4 h-4 mr-2" /> Load "Protection Personality" starter
            </Button>
            <Button variant="outline" onClick={() => setQuiz(structuredClone(BLANK_QUIZ))}>
              Start blank
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- mutators (immutable) ---
  const updateQuestion = (stepIdx, partial) => {
    const steps = quiz.steps.map((s, i) =>
      i === stepIdx ? { ...s, questions: [{ ...(s.questions?.[0] || {}), ...partial }] } : s
    );
    patch({ steps });
  };
  const updateOption = (stepIdx, optIdx, partial) => {
    const steps = quiz.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      const q = s.questions?.[0] || {};
      const options = (q.options || []).map((o, oi) => (oi === optIdx ? { ...o, ...partial } : o));
      return { ...s, questions: [{ ...q, options }] };
    });
    patch({ steps });
  };
  const setOptionPersona = (stepIdx, optIdx, personaId) =>
    updateOption(stepIdx, optIdx, { scores: personaId ? { [personaId]: 1 } : {} });
  const addOption = (stepIdx) => {
    const steps = quiz.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      const q = s.questions?.[0] || {};
      const options = [...(q.options || []), { id: genId(), label: "", scores: {} }];
      return { ...s, questions: [{ ...q, options }] };
    });
    patch({ steps });
  };
  const removeOption = (stepIdx, optIdx) => {
    const steps = quiz.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      const q = s.questions?.[0] || {};
      return { ...s, questions: [{ ...q, options: (q.options || []).filter((_, oi) => oi !== optIdx) }] };
    });
    patch({ steps });
  };
  const addQuestion = () =>
    patch({ steps: [...(quiz.steps || []), { id: genId(), questions: [{ id: genId(), prompt: "", type: "single", weight: 1, options: [] }] }] });
  const removeQuestion = (stepIdx) => patch({ steps: quiz.steps.filter((_, i) => i !== stepIdx) });

  const updateProfile = (idx, partial) =>
    patch({ resultProfiles: profiles.map((p, i) => (i === idx ? { ...p, ...partial } : p)) });
  const addProfile = () => {
    const id = `profile-${genId()}`;
    patch({
      resultProfiles: [...profiles, { id, title: "", description: "", themeColor: "#3B82F6", ctaLabel: "" }],
      scoring: { ...(quiz.scoring || {}), profileOrder: [...((quiz.scoring || {}).profileOrder || []), id] },
    });
  };
  const removeProfile = (idx) => {
    const removed = profiles[idx]?.id;
    patch({
      resultProfiles: profiles.filter((_, i) => i !== idx),
      scoring: { ...(quiz.scoring || {}), profileOrder: ((quiz.scoring || {}).profileOrder || []).filter((p) => p !== removed) },
    });
  };

  return (
    <div className="space-y-6">
      {/* Enable */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold text-foreground">Quiz funnel</Label>
          <p className="text-xs text-muted-foreground">Show a quiz before the lead form on this campaign.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={quiz.enabled !== false}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
          />
          Enabled
        </label>
      </div>

      {/* Intro */}
      <div className="space-y-3 pt-4 border-t">
        <Label className="text-sm font-semibold text-foreground">Intro screen</Label>
        <Input value={quiz.intro?.headline || ""} maxLength={80}
          onChange={(e) => patchIntro({ headline: e.target.value })} placeholder="Headline — e.g. What's your money personality?" />
        <Textarea value={quiz.intro?.subhead || ""} maxLength={160} className="resize-none h-16"
          onChange={(e) => patchIntro({ subhead: e.target.value })} placeholder="Sub-headline" />
        <Input value={quiz.intro?.ctaLabel || ""} maxLength={40}
          onChange={(e) => patchIntro({ ctaLabel: e.target.value })} placeholder="Start button label" />
      </div>

      {/* Scoring */}
      <div className="space-y-3 pt-4 border-t">
        <Label className="text-sm font-semibold text-foreground">Scoring</Label>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tie-break (which result wins on a tie)</Label>
          <Select value={quiz.scoring?.tiebreak || "prepared-first"} onValueChange={(v) => patchScoring({ tiebreak: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prepared-first">Prepared-first (flattering → more shares)</SelectItem>
              <SelectItem value="gap-first">Gap-first (motivates conversion)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={quiz.scoring?.readiness?.enabled !== false}
            onChange={(e) => patchScoring({ readiness: { ...(quiz.scoring?.readiness || {}), enabled: e.target.checked } })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-ring" />
          Show Protection Readiness % on the result
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={quiz.scoring?.leadScore?.enabled === true}
            onChange={(e) => patchScoring({ leadScore: { ...(quiz.scoring?.leadScore || {}), enabled: e.target.checked } })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-ring" />
          Compute Hot / Warm / Cool lead score (from option tags)
        </label>
        <p className="text-xs text-muted-foreground">
          Readiness weights and lead-score points come from the starter template. Use the campaign JSON / docs to tune them.
        </p>
      </div>

      {/* Result profiles */}
      <div className="space-y-3 pt-4 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-foreground">Result profiles ({profiles.length})</Label>
          <Button variant="outline" size="sm" onClick={addProfile}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
        </div>
        {profiles.map((p, idx) => (
          <div key={p.id || idx} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input type="color" value={p.themeColor || "#3B82F6"} aria-label="Theme color"
                onChange={(e) => updateProfile(idx, { themeColor: e.target.value })}
                className="h-8 w-8 rounded border border-border bg-transparent p-0.5" />
              <Input value={p.title || ""} maxLength={40} placeholder="Title — e.g. The Rock"
                onChange={(e) => updateProfile(idx, { title: e.target.value })} />
              <Button variant="ghost" size="icon" aria-label="Remove profile" className="text-destructive shrink-0"
                onClick={() => removeProfile(idx)}><Trash2 className="w-4 h-4" /></Button>
            </div>
            <Input value={p.id || ""} maxLength={64} placeholder="id (stable key — referenced by options)" className="font-mono text-xs"
              onChange={(e) => updateProfile(idx, { id: e.target.value })} />
            <Textarea value={p.description || ""} maxLength={400} className="resize-none h-16" placeholder="Description shown on the result"
              onChange={(e) => updateProfile(idx, { description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input value={p.ctaLabel || ""} maxLength={40} placeholder="Result CTA label"
                onChange={(e) => updateProfile(idx, { ctaLabel: e.target.value })} />
              <Input value={p.agentAngle || ""} maxLength={80} placeholder="Agent angle (internal)"
                onChange={(e) => updateProfile(idx, { agentAngle: e.target.value })} />
            </div>
          </div>
        ))}
      </div>

      {/* Questions */}
      <div className="space-y-3 pt-4 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-foreground">Questions ({questions.length})</Label>
          <Button variant="outline" size="sm" onClick={addQuestion}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
        </div>
        {questions.map(({ q }, idx) => (
          <div key={q.id || idx} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground shrink-0">{idx + 1}/{questions.length}</span>
              <Input value={q.prompt || ""} maxLength={140} placeholder="Question prompt"
                onChange={(e) => updateQuestion(idx, { prompt: e.target.value })} />
              <Button variant="ghost" size="icon" aria-label="Remove question" className="text-destructive shrink-0"
                onClick={() => removeQuestion(idx)}><Trash2 className="w-4 h-4" /></Button>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Weight</Label>
              <Input type="number" min={0} max={10} value={q.weight ?? 1} className="w-20"
                onChange={(e) => updateQuestion(idx, { weight: Number(e.target.value) })} />
              <span className="text-xs text-muted-foreground">higher = counts more toward the result</span>
            </div>
            {/* Options */}
            <div className="space-y-1.5 pl-2 border-l-2 border-border">
              {(q.options || []).map((o, oi) => (
                <div key={o.id || oi} className="flex items-center gap-1.5">
                  <Input value={o.label || ""} maxLength={80} placeholder="Option label" className="flex-1"
                    onChange={(e) => updateOption(idx, oi, { label: e.target.value })} />
                  <Select value={Object.keys(o.scores || {})[0] || ""} onValueChange={(v) => setOptionPersona(idx, oi, v)}>
                    <SelectTrigger className="w-32 shrink-0"><SelectValue placeholder="→ profile" /></SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.title || p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={o.tag || ""} maxLength={40} placeholder="tag" className="w-24 shrink-0 font-mono text-xs"
                    onChange={(e) => updateOption(idx, oi, { tag: e.target.value })} />
                  <Button variant="ghost" size="icon" aria-label="Remove option" className="text-destructive shrink-0"
                    onClick={() => removeOption(idx, oi)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => addOption(idx)}>
                <Plus className="w-3.5 h-3.5 mr-1" />Option
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
