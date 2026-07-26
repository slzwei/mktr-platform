import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BRIEF_OBJECTIVES,
  BRIEF_PRODUCTS,
  BRIEF_LANGUAGES,
  BRIEF_AGE_BANDS,
  BRIEF_INCOME_BANDS,
} from '@/lib/campaignBrief';

/**
 * The campaign brief — four structured questions answering "what is this
 * campaign FOR?" (docs/plans/campaign-brief.md). Mounted by BOTH create
 * surfaces (workspace CampaignDetailsTab + classic AdminCampaignForm) so the
 * server's create requirement can never 422 a UI that has no way to answer.
 *
 * Structured picks only — the answers deterministically feed the Studio AI
 * context, the profile-question suggestions, and (later phases) scoring and
 * measurement. Objective + product are required; the server blocks creation
 * without them. Audience and target are optional by owner decision (§7.2).
 */

/** campaign.targetAudience (or null) → controlled draft state. */
export function briefDraftFromCampaign(targetAudience) {
  const ta = targetAudience && typeof targetAudience === 'object' ? targetAudience : {};
  return {
    objective: typeof ta.objective === 'string' ? ta.objective : '',
    product: typeof ta.product === 'string' ? ta.product : '',
    language: typeof ta.audience?.language === 'string' ? ta.audience.language : '',
    ageBands: Array.isArray(ta.audience?.ageBands) ? ta.audience.ageBands.filter((b) => BRIEF_AGE_BANDS.includes(b)) : [],
    incomeBand: typeof ta.audience?.incomeBand === 'string' ? ta.audience.incomeBand : '',
    targetValue: ta.target?.value != null ? String(ta.target.value) : '',
    targetByDate: typeof ta.target?.byDate === 'string' ? ta.target.byDate : '',
  };
}

/** Both required picks made? (create is blocked until true) */
export function briefDraftComplete(draft) {
  return Boolean(draft.objective && draft.product);
}

/**
 * Draft → targetAudience payload, or null while the required picks are
 * missing (callers OMIT the key then — an edit of a pre-brief campaign must
 * not force answers, and `{}` must never reach the server as a "brief").
 */
export function briefDraftToPayload(draft) {
  if (!briefDraftComplete(draft)) return null;
  const audience = {};
  if (draft.language) audience.language = draft.language;
  if (draft.ageBands.length > 0) audience.ageBands = draft.ageBands;
  if (draft.incomeBand) audience.incomeBand = draft.incomeBand;
  const value = Number(draft.targetValue);
  const target = draft.targetValue !== '' && Number.isFinite(value) && value >= 1
    ? { value: Math.floor(value), ...(draft.targetByDate ? { byDate: draft.targetByDate } : {}) }
    : null;
  return {
    objective: draft.objective,
    product: draft.product,
    ...(Object.keys(audience).length > 0 ? { audience } : {}),
    ...(target ? { target } : {}),
  };
}

function ChipRow({ id, options, value, onPick, multi = false, hints = false }) {
  return (
    <div className="flex flex-wrap gap-2" id={id}>
      {options.map((opt) => {
        const active = multi ? value.includes(opt.id) : value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            title={hints && opt.hint ? opt.hint : undefined}
            onClick={() => onPick(opt.id)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              active ? 'border-foreground bg-muted font-medium' : 'border-input text-muted-foreground hover:border-foreground/40'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function CampaignBriefFields({ draft, onChange, isEdit = false }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  const toggleBand = (band) =>
    set({
      ageBands: draft.ageBands.includes(band)
        ? draft.ageBands.filter((b) => b !== band)
        : BRIEF_AGE_BANDS.filter((b) => draft.ageBands.includes(b) || b === band),
    });

  return (
    <Card data-testid="campaign-brief-card">
      <CardHeader>
        <CardTitle className="text-base">What is this campaign for?</CardTitle>
        <CardDescription>
          Four quick picks. The AI page design, the profile-question suggestions and campaign
          measurement all read these — only you know the answers.
          {isEdit ? '' : ' Objective and product are required.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="brief-objective">Objective — what does success look like?{isEdit ? '' : ' *'}</Label>
          <ChipRow
            id="brief-objective"
            options={BRIEF_OBJECTIVES}
            value={draft.objective}
            onPick={(id) => set({ objective: id })}
            hints
          />
          {draft.objective && (
            <p className="text-xs text-muted-foreground">
              {BRIEF_OBJECTIVES.find((o) => o.id === draft.objective)?.hint} — measured as{' '}
              {BRIEF_OBJECTIVES.find((o) => o.id === draft.objective)?.metric}.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="brief-product">Product — what is being offered?{isEdit ? '' : ' *'}</Label>
          <ChipRow
            id="brief-product"
            options={BRIEF_PRODUCTS}
            value={draft.product}
            onPick={(id) => set({ product: id })}
            hints
          />
        </div>

        <div className="space-y-2">
          <Label>Audience (optional)</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Language</span>
              <ChipRow
                id="brief-language"
                options={BRIEF_LANGUAGES}
                value={draft.language}
                onPick={(id) => set({ language: draft.language === id ? '' : id })}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Age bands</span>
              <ChipRow
                id="brief-age-bands"
                options={BRIEF_AGE_BANDS.map((b) => ({ id: b, label: b }))}
                value={draft.ageBands}
                onPick={toggleBand}
                multi
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Household income</span>
            <ChipRow
              id="brief-income"
              options={BRIEF_INCOME_BANDS}
              value={draft.incomeBand}
              onPick={(id) => set({ incomeBand: draft.incomeBand === id ? '' : id })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="brief-target-value">Target (optional) — how many, by when?</Label>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <Input
              id="brief-target-value"
              type="number"
              min={1}
              placeholder="e.g. 200"
              aria-label="Target number of sign-ups"
              value={draft.targetValue}
              onChange={(e) => set({ targetValue: e.target.value })}
            />
            <Input
              id="brief-target-date"
              type="date"
              aria-label="Target date"
              value={draft.targetByDate}
              onChange={(e) => set({ targetByDate: e.target.value })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
