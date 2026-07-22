/**
 * Cohort builder dialog (tracker "cohortui") — create/edit a cohort
 * definition with a LIVE reachable-count preview from POST /cohorts/preview
 * (debounced; the same resolution the backend uses for real, so the number
 * you see is the number a push would get).
 *
 * Vocabulary comes from GET /cohorts/facets — attribute values are the
 * verbatim strings capture stored ("Degree", "$3,000 - $4,999"), so pickers
 * never guess. minAge is clamped to the §9.5-2 floor of 18 in the UI AND
 * rejected server-side; the field says why.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchCohortFacets, previewCohortDefinition, createCohort, updateCohort,
} from '@/api/adminV2';
import { fmtNumber } from '@/lib/adminV2/format';
import {
  emptyDefinition, normalizeDefinitionShape, REASON_ORDER, REASON_META, CHANNEL_OPTIONS,
} from '@/lib/adminV2/cohorts';
import { Chip, Skeleton } from '@/components/adminv2/primitives';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

function TogglePill({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      className="av2-btn av2-btn--sm"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      style={active
        ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent-text)', fontWeight: 700 }
        : { color: 'var(--ink-2)' }}
    >
      {children}
    </button>
  );
}

function Section({ label, hint, children }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div>
        <span className="av2-microcaps">{label}</span>
        {hint && <span className="av2-caption" style={{ marginLeft: 8 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const toggle = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export default function CohortBuilder({ cohort = null, onClose, onSaved }) {
  const editing = !!cohort;
  const [name, setName] = useState(cohort?.name || '');
  const [description, setDescription] = useState(cohort?.description || '');
  const [definition, setDefinition] = useState(() => (cohort ? normalizeDefinitionShape(cohort.definition) : emptyDefinition()));
  const [channel, setChannel] = useState('all');
  const [postalText, setPostalText] = useState((cohort?.definition?.filters?.attributes?.postalPrefixes || []).join(', '));
  const queryClient = useQueryClient();

  const facets = useQuery({ queryKey: ['adminV2', 'cohortFacets'], queryFn: fetchCohortFacets, staleTime: 60_000 });

  // Debounce the definition into the preview query — every knob change
  // re-resolves ~400ms after the user stops touching it.
  const [debouncedDef, setDebouncedDef] = useState(definition);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedDef(definition), 400);
    return () => clearTimeout(t);
  }, [definition]);

  const preview = useQuery({
    queryKey: ['adminV2', 'cohortPreview', JSON.stringify(debouncedDef), channel],
    queryFn: () => previewCohortDefinition(debouncedDef, channel),
    placeholderData: (prev) => prev, // keep last counts on screen while the next resolves
  });

  const patch = (fn) => setDefinition((d) => {
    const next = structuredClone(d);
    fn(next);
    return next;
  });

  const setPostal = (text) => {
    setPostalText(text);
    const prefixes = [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^[0-9]{2,6}$/.test(s)))].slice(0, 20);
    patch((d) => { d.filters.attributes.postalPrefixes = prefixes; });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), description: description.trim() || null, definition };
      return editing ? updateCohort(cohort.id, payload) : createCohort(payload);
    },
    onSuccess: (r) => {
      toast.success(editing ? 'Cohort updated' : 'Cohort saved');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'cohorts'] });
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'cohort'] });
      onSaved?.(r?.data || null);
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const f = facets.data;
  const p = preview.data;
  const nonZeroReasons = useMemo(
    () => REASON_ORDER.filter((r) => (p?.byReason?.[r] ?? 0) > 0),
    [p],
  );
  const minAgeBelowFloor = definition.ageGate.minAge < 18;
  const canSave = name.trim().length > 0 && !minAgeBelowFloor && !save.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent
        className="admin-v2"
        style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: 760, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, textAlign: 'left' }}>
            {editing ? `Edit “${cohort.name}”` : 'New cohort'}
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--ink-2)', fontSize: 11.5, textAlign: 'left' }}>
            Membership resolves live at every use — saving stores the definition, never a list.
          </DialogDescription>
        </DialogHeader>

        {/* Live preview strip — always visible while scrolling the form */}
        <div className="av2-card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }} aria-live="polite">
          {preview.isError ? (
            <span className="av2-caption" style={{ color: 'var(--bad)' }}>{preview.error?.message || 'Preview failed'}</span>
          ) : !p ? (
            <Skeleton height={22} width={220} />
          ) : (
            <>
              <span className="av2-mono" style={{ fontSize: 18, fontWeight: 700 }}>{fmtNumber(p.total)}</span>
              <span className="av2-caption">people match</span>
              <span className="av2-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ok)' }}>{fmtNumber(p.reachable)}</span>
              <span className="av2-caption">reachable{preview.isFetching ? ' · refreshing…' : ''}</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                {nonZeroReasons.map((r) => (
                  <Chip key={r} tone={REASON_META[r].tone} >{`${REASON_META[r].label} ${fmtNumber(p.byReason[r])}`}</Chip>
                ))}
              </span>
            </>
          )}
        </div>

        <div style={{ overflowY: 'auto', display: 'grid', gap: 16, padding: '14px 2px', flex: 1 }}>
          <Section label="Name">
            <input className="av2-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tokyo draw entrants" maxLength={120} />
          </Section>

          <Section label="Description" hint="optional">
            <input className="av2-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this group is for" maxLength={2000} />
          </Section>

          <Section label="Campaigns" hint="signed up for ANY selected">
            {facets.isLoading ? <Skeleton height={30} /> : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(f?.campaigns || []).map((c) => (
                  <TogglePill
                    key={c.id}
                    active={definition.filters.campaignIds.includes(c.id)}
                    onClick={() => patch((d) => { d.filters.campaignIds = toggle(d.filters.campaignIds, c.id); })}
                    title={c.status}
                  >
                    {c.name}
                  </TogglePill>
                ))}
                {(f?.campaigns || []).length === 0 && <span className="av2-caption">No campaigns.</span>}
              </div>
            )}
          </Section>

          <Section label="Lucky draws" hint="entered ANY selected">
            {facets.isLoading ? <Skeleton height={30} /> : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <TogglePill
                  active={definition.filters.anyDraw}
                  onClick={() => patch((d) => { d.filters.anyDraw = !d.filters.anyDraw; })}
                >
                  Any draw
                </TogglePill>
                {(f?.draws || []).map((dr) => (
                  <TogglePill
                    key={dr.id}
                    active={definition.filters.drawIds.includes(dr.id)}
                    onClick={() => patch((d) => { d.filters.drawIds = toggle(d.filters.drawIds, dr.id); })}
                    title={dr.status}
                  >
                    {dr.campaignName || 'Draw'} · {String(dr.closesAt).slice(0, 10)}
                  </TogglePill>
                ))}
              </div>
            )}
          </Section>

          <Section label="Category" hint="signed up for any campaign in one of these — the campaign taxonomy, set in Studio">
            {facets.isLoading ? <Skeleton height={30} /> : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(f?.campaignCategories || []).map((c) => (
                  <TogglePill
                    key={c.id}
                    active={definition.filters.campaignCategories.includes(c.id)}
                    onClick={() => patch((d) => { d.filters.campaignCategories = toggle(d.filters.campaignCategories, c.id); })}
                    title={`${c.count} campaign${c.count === 1 ? '' : 's'} today`}
                  >
                    {c.label}{c.count > 0 ? ` · ${c.count}` : ''}
                  </TogglePill>
                ))}
                {(f?.campaignCategories || []).length === 0 && <span className="av2-caption">No categories.</span>}
              </div>
            )}
          </Section>

          <Section label="Campaign tags" hint={(f?.campaignTags || []).length === 0 ? 'no freeform tags exist yet — Category above is the curated taxonomy' : 'freeform labels — signed up for any campaign carrying one'}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(f?.campaignTags || []).map((t) => (
                <TogglePill
                  key={t}
                  active={definition.filters.campaignTags.includes(t)}
                  onClick={() => patch((d) => { d.filters.campaignTags = toggle(d.filters.campaignTags, t); })}
                >
                  {t}
                </TogglePill>
              ))}
            </div>
          </Section>

          <Section label="Attributes" hint="from signup answers — values shown are what people actually chose">
            <div style={{ display: 'grid', gap: 10 }}>
              {[['incomes', 'Income'], ['educations', 'Education'], ['genders', 'Gender']].map(([key, label]) => (
                (f?.attributes?.[key] || []).length > 0 && (
                  <div key={key} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="av2-caption" style={{ width: 70, flex: 'none' }}>{label}</span>
                    {(f?.attributes?.[key] || []).map((v) => (
                      <TogglePill
                        key={v}
                        active={definition.filters.attributes[key].includes(v)}
                        onClick={() => patch((d) => { d.filters.attributes[key] = toggle(d.filters.attributes[key], v); })}
                      >
                        {v}
                      </TogglePill>
                    ))}
                  </div>
                )
              ))}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="av2-caption" style={{ width: 70, flex: 'none' }}>Postal</span>
                <input
                  className="av2-input"
                  value={postalText}
                  onChange={(e) => setPostal(e.target.value)}
                  placeholder="prefixes, e.g. 52, 53"
                  style={{ maxWidth: 240 }}
                  aria-label="Postal prefixes"
                />
                <span className="av2-caption">2–6 digits each</span>
              </div>
            </div>
          </Section>

          <Section label="Age" hint="18+ is a consent-policy floor (§9.5-2) — it cannot go lower">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="av2-input"
                type="number"
                min={18}
                max={120}
                value={definition.ageGate.minAge}
                onChange={(e) => patch((d) => { d.ageGate.minAge = e.target.value === '' ? 18 : Number(e.target.value); })}
                style={{ width: 84 }}
                aria-label="Minimum age"
              />
              <span className="av2-caption">to</span>
              <input
                className="av2-input"
                type="number"
                min={18}
                max={120}
                value={definition.ageGate.maxAge ?? ''}
                placeholder="—"
                onChange={(e) => patch((d) => { d.ageGate.maxAge = e.target.value === '' ? null : Number(e.target.value); })}
                style={{ width: 84 }}
                aria-label="Maximum age"
              />
              <span className="av2-caption">no upper limit when blank · people with no valid birthdate are excluded</span>
            </div>
            {minAgeBelowFloor && (
              <div className="av2-caption" style={{ color: 'var(--bad)' }}>Minimum age cannot go below 18.</div>
            )}
          </Section>

          <Section label="Consent scope" hint="which grants count — a push about a specific campaign may use that campaign’s own signups">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="av2-input"
                value={definition.marketingContext.campaignId || ''}
                onChange={(e) => patch((d) => { d.marketingContext.campaignId = e.target.value || null; })}
                aria-label="Consent scope"
                style={{ maxWidth: 320 }}
              >
                <option value="">Brand-wide (global consent only)</option>
                {(f?.campaigns || []).map((c) => (
                  <option key={c.id} value={c.id}>About: {c.name}</option>
                ))}
              </select>
              <select
                className="av2-input"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                aria-label="Preview channel"
                style={{ maxWidth: 220 }}
              >
                {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>Preview: {c.label}</option>)}
              </select>
            </div>
            <span className="av2-caption">
              Sends always re-check per person at send time — this preview uses the exact same gate.
            </span>
          </Section>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          <button type="button" className="av2-btn" disabled={save.isPending} onClick={onClose}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Save cohort'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
