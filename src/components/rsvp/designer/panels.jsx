import { THEME_PRESETS, FONT_IDS, THEME_RADIUS_IDS } from '@/lib/designConfigV2';
import { HERO_FONTS } from '@/lib/heroFonts';
import { BLOCK_TYPES, FIELD_TYPES, LIMITS, LOCKED_FIELD_KEYS, BUILTIN_FIELD_TYPES, slugProblem } from '@/lib/rsvpLayout';
import SortableList from './SortableList';
import { Field, AreaField, SelectField, Toggle, Section, Note, randomId } from './kit';

/**
 * The RSVP designer's four inspector panels (docs/plans/rsvp-pages.md §6):
 * Content (sortable blocks), Form (sortable fields), Theme, and Settings.
 * Every edit goes through `update(fn)` — an immutable transform of the working
 * layout — and the page owns save/publish.
 */

export const BLOCK_LABELS = { hero: 'Hero', text: 'Text', details: 'Details', image: 'Image', form: 'RSVP form' };
export const FIELD_TYPE_LABELS = {
  text: 'Short text', textarea: 'Long text', email: 'Email', phone: 'Phone', number: 'Number',
  date: 'Date', select: 'Choose one', multiselect: 'Choose many', checkbox: 'Checkbox',
};

const blockSnippet = (b) => {
  if (b.type === 'hero') return b.headline || 'No headline yet';
  if (b.type === 'text') return (b.body || '').slice(0, 60) || 'Empty';
  if (b.type === 'details') return `${(b.rows || []).length} rows`;
  if (b.type === 'image') return b.url ? 'Image set' : 'No image yet';
  return b.headline || 'Form';
};

// ── Content ────────────────────────────────────────────────────────────────

function BlockEditor({ block, onChange }) {
  const set = (k, v) => onChange({ ...block, [k]: v });
  const id = `blk-${block.id}`;
  switch (block.type) {
    case 'hero':
      return (
        <>
          <Field id={`${id}-h`} label="Headline" value={block.headline} onChange={(v) => set('headline', v)} limit={LIMITS.headline} />
          <AreaField id={`${id}-s`} label="Subheadline" value={block.subheadline} onChange={(v) => set('subheadline', v)} limit={LIMITS.subheadline} rows={2} />
          <Field id={`${id}-m`} label="Image URL" value={block.mediaUrl} onChange={(v) => set('mediaUrl', v)} limit={LIMITS.mediaUrl} placeholder="https://…" hint="https:// links only" />
          <Field id={`${id}-a`} label="Image description" value={block.mediaAlt} onChange={(v) => set('mediaAlt', v)} limit={LIMITS.mediaAlt} />
        </>
      );
    case 'text':
      return <AreaField id={`${id}-b`} label="Text" value={block.body} onChange={(v) => set('body', v)} limit={LIMITS.body} rows={6} hint="Blank line between paragraphs" />;
    case 'details': {
      const rows = block.rows || [];
      const setRow = (i, k, v) => set('rows', rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
      return (
        <>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, alignItems: 'end' }}>
              <Field id={`${id}-l${i}`} label={i === 0 ? 'Label' : ''} value={r.label} onChange={(v) => setRow(i, 'label', v)} limit={LIMITS.detailsLabel} placeholder="When" />
              <Field id={`${id}-v${i}`} label={i === 0 ? 'Value' : ''} value={r.value} onChange={(v) => setRow(i, 'value', v)} limit={LIMITS.detailsValue} placeholder="Sat 4 Oct, 7pm" />
              <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" aria-label={`Remove row ${i + 1}`} onClick={() => set('rows', rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={rows.length >= LIMITS.detailsRows} onClick={() => set('rows', [...rows, { label: '', value: '' }])}>+ Add row</button>
        </>
      );
    }
    case 'image':
      return (
        <>
          <Field id={`${id}-u`} label="Image URL" value={block.url} onChange={(v) => set('url', v)} limit={LIMITS.mediaUrl} placeholder="https://…" hint="https:// links only" />
          <Field id={`${id}-a`} label="Image description" value={block.alt} onChange={(v) => set('alt', v)} limit={LIMITS.mediaAlt} />
        </>
      );
    case 'form':
      return (
        <>
          <Field id={`${id}-h`} label="Form headline" value={block.headline} onChange={(v) => set('headline', v)} limit={LIMITS.headline} placeholder="Save your spot" />
          <Field id={`${id}-c`} label="Button label" value={block.submitLabel} onChange={(v) => set('submitLabel', v)} limit={LIMITS.submitLabel} placeholder="RSVP" />
        </>
      );
    default:
      return null;
  }
}

export function ContentPanel({ layout, update, selectedId, onSelect }) {
  const blocks = layout.blocks || [];
  const selected = blocks.find((b) => b.id === selectedId) || null;
  const items = blocks.map((b) => ({
    id: b.id, label: BLOCK_LABELS[b.type] || b.type, meta: blockSnippet(b),
    locked: b.type === 'form', lockedReason: 'Every page has exactly one RSVP form',
  }));
  const addBlock = (type) => {
    const id = randomId('b');
    const fresh = type === 'hero' ? { id, type, headline: '', subheadline: '', mediaUrl: '', mediaAlt: '' }
      : type === 'text' ? { id, type, body: '' }
        : type === 'details' ? { id, type, rows: [{ label: 'When', value: '' }] }
          : { id, type, url: '', alt: '' };
    // New blocks land above the form so the form stays last by default.
    update((l) => {
      const idx = l.blocks.findIndex((b) => b.type === 'form');
      const next = [...l.blocks];
      next.splice(idx < 0 ? next.length : idx, 0, fresh);
      return { ...l, blocks: next };
    });
    onSelect(id);
  };
  return (
    <>
      <Section title="Blocks" first>
        <SortableList
          ariaLabel="Page blocks"
          items={items}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={(id) => update((l) => ({ ...l, blocks: l.blocks.filter((b) => b.id !== id || b.type === 'form') }))}
          onReorder={(ids) => update((l) => ({ ...l, blocks: ids.map((id) => l.blocks.find((b) => b.id === id)).filter(Boolean) }))}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {BLOCK_TYPES.filter((t) => t !== 'form').map((t) => (
            <button key={t} type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={blocks.length >= LIMITS.blocks} onClick={() => addBlock(t)}>+ {BLOCK_LABELS[t]}</button>
          ))}
        </div>
      </Section>
      {selected ? (
        <Section title={BLOCK_LABELS[selected.type] || 'Block'}>
          <BlockEditor block={selected} onChange={(next) => update((l) => ({ ...l, blocks: l.blocks.map((b) => (b.id === next.id ? next : b)) }))} />
        </Section>
      ) : (
        <Section title="Edit"><Note>Select a block to edit it. Drag the handle (or focus it and use Space + arrows) to reorder.</Note></Section>
      )}
    </>
  );
}

// ── Form ───────────────────────────────────────────────────────────────────

function FieldEditor({ field, frozen, onChange }) {
  const locked = LOCKED_FIELD_KEYS.includes(field.key);
  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_FIELD_TYPES, field.key);
  const typeFixed = builtin || frozen;
  const hasOptions = field.type === 'select' || field.type === 'multiselect';
  const id = `fld-${field.key}`;
  const set = (k, v) => onChange({ ...field, [k]: v });
  return (
    <>
      {frozen ? <Note tone="warn">People have already answered. The key, type and options are fixed; label, help text, required and order can still change.</Note> : null}
      <Field id={`${id}-l`} label="Label" value={field.label} onChange={(v) => set('label', v)} limit={LIMITS.label} />
      <Field id={`${id}-h`} label="Help text" value={field.help} onChange={(v) => set('help', v)} limit={LIMITS.help} />
      <SelectField
        id={`${id}-t`}
        label="Type"
        value={field.type}
        disabled={typeFixed}
        onChange={(v) => onChange({ ...field, type: v, ...(v === 'select' || v === 'multiselect' ? { options: field.options || [] } : {}) })}
        options={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}
        hint={builtin ? 'Built-in field — the type is fixed' : undefined}
      />
      {hasOptions ? (
        <AreaField
          id={`${id}-o`}
          label="Options (one per line)"
          value={(field.options || []).join('\n')}
          disabled={frozen}
          rows={4}
          onChange={(v) => set('options', v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.options))}
          hint={`Up to ${LIMITS.options}; at least 2 to publish`}
        />
      ) : null}
      <Toggle id={`${id}-r`} label="Required" checked={field.required === true} disabled={locked} onChange={(v) => set('required', v)} hint={locked ? 'Name and email are always required' : undefined} />
    </>
  );
}

export function FormPanel({ layout, update, selectedKey, onSelect, frozenKeys }) {
  const fields = layout.fields || [];
  const selected = fields.find((f) => f.key === selectedKey) || null;
  const items = fields.map((f) => {
    const locked = LOCKED_FIELD_KEYS.includes(f.key);
    const frozen = frozenKeys.has(f.key);
    return {
      id: f.key, label: f.label || f.key, meta: `${FIELD_TYPE_LABELS[f.type] || f.type}${f.required ? ' · required' : ''}`,
      locked: locked || frozen, lockedReason: locked ? 'Always on the form' : 'People have answered this field',
    };
  });
  const addField = (type) => {
    const key = randomId('f');
    const fresh = { key, type, label: FIELD_TYPE_LABELS[type], help: '', required: false, ...(type === 'select' || type === 'multiselect' ? { options: [] } : {}) };
    update((l) => ({ ...l, fields: [...l.fields, fresh] }));
    onSelect(key);
  };
  return (
    <>
      <Section title="Fields" first>
        <SortableList
          ariaLabel="Form fields"
          items={items}
          selectedId={selectedKey}
          onSelect={onSelect}
          onDelete={(key) => update((l) => ({ ...l, fields: l.fields.filter((f) => f.key !== key || LOCKED_FIELD_KEYS.includes(f.key) || frozenKeys.has(f.key)) }))}
          onReorder={(keys) => update((l) => ({ ...l, fields: keys.map((k) => l.fields.find((f) => f.key === k)).filter(Boolean) }))}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FIELD_TYPES.map((t) => (
            <button key={t} type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={fields.length >= LIMITS.fields} onClick={() => addField(t)}>+ {FIELD_TYPE_LABELS[t]}</button>
          ))}
        </div>
      </Section>
      {selected ? (
        <Section title="Field">
          <FieldEditor field={selected} frozen={frozenKeys.has(selected.key)} onChange={(next) => update((l) => ({ ...l, fields: l.fields.map((f) => (f.key === next.key ? next : f)) }))} />
        </Section>
      ) : (
        <Section title="Edit"><Note>Select a field to edit it. Name and email are always on the form.</Note></Section>
      )}
    </>
  );
}

// ── Theme ──────────────────────────────────────────────────────────────────

export function ThemePanel({ layout, update }) {
  const theme = layout.theme || {};
  const setTheme = (patch) => update((l) => ({ ...l, theme: { ...l.theme, ...patch } }));
  const preset = THEME_PRESETS.find((p) => p.id === theme.preset) || THEME_PRESETS[0];
  return (
    <>
      <Section title="Preset" first>
        <div role="radiogroup" aria-label="Theme preset" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {THEME_PRESETS.map((p) => {
            const active = p.id === preset.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme({ preset: p.id, accent: '' })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 9, cursor: 'pointer', textAlign: 'left', border: `1px solid ${active ? 'var(--accent, #4059C8)' : 'var(--line, #E3E6EB)'}`, background: active ? 'var(--accent-soft, #ECEFFA)' : 'var(--surface, #fff)' }}
              >
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, flex: 'none', background: p.bg, boxShadow: `inset 0 0 0 6px ${p.card}, inset 0 0 0 9px ${p.accent}` }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #171A20)' }}>{p.name}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Adjust">
        <Field id="theme-accent" label="Accent colour" value={theme.accent} onChange={(v) => setTheme({ accent: v })} placeholder={preset.accent} hint="#RRGGBB — blank uses the preset's accent" />
        <SelectField id="theme-font" label="Font" value={theme.font || ''} onChange={(v) => setTheme({ font: v })} options={[{ value: '', label: `Preset (${(HERO_FONTS.find((f) => f.id === preset.font) || {}).label || preset.font})` }, ...FONT_IDS.map((id) => ({ value: id, label: (HERO_FONTS.find((f) => f.id === id) || {}).label || id }))]} />
        <SelectField id="theme-radius" label="Corners" value={theme.radius || ''} onChange={(v) => setTheme({ radius: v })} options={[{ value: '', label: `Preset (${preset.radius})` }, ...THEME_RADIUS_IDS.map((r) => ({ value: r, label: r }))]} />
      </Section>
    </>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

/** ISO instant → SGT wall time for a datetime-local input ('' when unset). */
export function isoToSgtLocal(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function SettingsPanel({ meta, setMeta, layout, update, locked, slugStatus }) {
  const confirmation = layout.confirmation || {};
  const setConf = (patch) => update((l) => ({ ...l, confirmation: { ...l.confirmation, ...patch } }));
  const problem = meta.slug ? slugProblem(meta.slug) : null;
  return (
    <>
      <Section title="Event" first>
        <Field id="set-title" label="Title (admin only)" value={meta.title} onChange={(v) => setMeta({ title: v })} limit={LIMITS.title} />
        <Field id="set-organiser" label="Organiser (named in the consent line)" value={meta.organiserName} onChange={(v) => setMeta({ organiserName: v })} limit={LIMITS.title} disabled={locked} hint={locked ? 'Fixed once published' : 'Who receives the attendee details'} />
        <Field
          id="set-slug"
          label="Link"
          value={meta.slug}
          onChange={(v) => setMeta({ slug: v.toLowerCase() })}
          disabled={locked}
          placeholder="launch-night"
          hint={locked ? 'Fixed once published — links are out' : problem === 'invalid' ? '3–40 lowercase letters, digits or hyphens' : problem === 'reserved' ? 'That word is reserved' : slugStatus === 'taken' ? 'Already in use' : slugStatus === 'available' ? `rsvp.redeem.sg/${meta.slug}` : 'rsvp.redeem.sg/your-link'}
        />
        <Field id="set-capacity" label="Capacity (blank = unlimited)" type="number" value={meta.capacity ?? ''} onChange={(v) => setMeta({ capacity: v })} />
        <Field id="set-closes" label="RSVPs close (Singapore time)" type="datetime-local" value={meta.closesAt} onChange={(v) => setMeta({ closesAt: v })} />
      </Section>
      <Section title="After they RSVP">
        <Field id="set-conf-h" label="Headline" value={confirmation.headline} onChange={(v) => setConf({ headline: v })} limit={LIMITS.confirmationHeadline} placeholder="You're in" />
        <AreaField id="set-conf-b" label="Message" value={confirmation.body} onChange={(v) => setConf({ body: v })} limit={LIMITS.confirmationBody} rows={3} />
        <Toggle id="set-conf-email" label="Send a confirmation email" checked={confirmation.emailEnabled !== false} onChange={(v) => setConf({ emailEnabled: v })} />
      </Section>
    </>
  );
}
