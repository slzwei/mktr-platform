import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useRsvpEvent } from '@/hooks/queries/useRsvp';
import { updateRsvpEvent, publishRsvpEvent, closeRsvpEvent, checkRsvpSlug } from '@/api/rsvp';
import { queryClient } from '@/lib/queryClient';
import { rsvpPublicUrl } from '@/lib/brand';
import { clampLayout, consentTemplateOf, renderConsentTemplate } from '@/lib/rsvpLayout';
import DeviceFrame from '@/components/studio/DeviceFrame';
import RsvpPageRenderer from '@/components/rsvp/RsvpPageRenderer';
import { ContentPanel, FormPanel, ThemePanel, SettingsPanel, isoToSgtLocal } from '@/components/rsvp/designer/panels';
import '@/styles/adminV2.css';

/**
 * RSVP designer — /admin/rsvp/:id (docs/plans/rsvp-pages.md §6). Studio's
 * chrome language (rail → panel → live preview), a third of its surface:
 * Content · Form · Theme · Settings, two drag-and-drop lists, ONE renderer
 * shared with the public page, and EXPLICIT save (no autosave — there is no
 * conflict model for two admins on one document).
 *
 * Edits are kept RAW in local state (clamping every keystroke trimmed the
 * space you were about to type after); the PREVIEW renders the clamped
 * document with the same twin the server applies, so what you see is what
 * the save will store, and the server's response (clamped, frozen fields
 * restored) is adopted as the new baseline after every save.
 *
 * Undo/redo: every edit (layout or settings) snapshots the previous
 * {layout, meta} onto a bounded history. Consecutive TYPING edits within
 * HISTORY_COALESCE_MS share one entry so a burst undoes as a phrase, not a
 * keystroke; structural edits (add / delete / reorder / toggle) always get
 * their own step — otherwise "add a block, start typing, undo" removed the
 * block (caught by the designer test). ⌘Z / ⌘⇧Z (Ctrl on Windows) and the
 * top-bar buttons. Saving does not clear history — a save is a checkpoint,
 * not a point of no return.
 */

const SECTIONS = [['content', 'Content'], ['form', 'Form'], ['theme', 'Theme'], ['settings', 'Settings']];
const HISTORY_LIMIT = 100;
const HISTORY_COALESCE_MS = 700;
const DEVICES = [{ id: 'mobile', label: 'Mobile', width: 390, height: 780 }, { id: 'desktop', label: 'Desktop', width: 1180, height: 820 }];

export const PROBLEM_COPY = {
  slug_missing: 'Add a link in Settings',
  slug_invalid: 'The link needs 3–40 lowercase letters, digits or hyphens',
  organiser_missing: 'Name the organiser in Settings',
  form_block_missing: 'The page needs its RSVP form',
  no_content: 'Add at least one block above the form',
};
export function problemLabel(code) {
  if (PROBLEM_COPY[code]) return PROBLEM_COPY[code];
  if (code.startsWith('options_too_few:')) return `"${code.split(':')[1]}" needs at least 2 options`;
  if (code.startsWith('duplicate_key:')) return `Duplicate field key ${code.split(':')[1]}`;
  if (code.startsWith('locked_field_missing:')) return `The ${code.split(':')[1]} field is missing`;
  return code;
}

const metaFromEvent = (ev) => ({
  title: ev.title || '',
  slug: ev.slug || '',
  organiserName: ev.organiserName || '',
  capacity: ev.capacity == null ? '' : String(ev.capacity),
  closesAt: isoToSgtLocal(ev.closesAt),
  notifyEmails: (ev.notifyEmails || []).join('\n'),
});

/** Only the meta keys that changed go into the PATCH (frozen fields 409 if re-sent changed). */
export function metaPatch(baseline, meta) {
  const patch = {};
  if (meta.title !== baseline.title) patch.title = meta.title;
  if (meta.slug !== baseline.slug) patch.slug = meta.slug || null;
  if (meta.organiserName !== baseline.organiserName) patch.organiserName = meta.organiserName;
  if (meta.capacity !== baseline.capacity) patch.capacity = meta.capacity === '' ? null : Number(meta.capacity);
  if (meta.closesAt !== baseline.closesAt) patch.closesAt = meta.closesAt || null;
  if (meta.notifyEmails !== baseline.notifyEmails) patch.notifyEmails = meta.notifyEmails;
  return patch;
}

export default function AdminRsvpDesigner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading, isError } = useRsvpEvent(id);

  const [layout, setLayout] = useState(null);
  const [meta, setMeta] = useState(null);
  const [baseline, setBaseline] = useState(null); // { layout, meta }
  const [section, setSection] = useState('content');
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [selectedField, setSelectedField] = useState(null);
  const [device, setDevice] = useState('mobile');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [slugStatus, setSlugStatus] = useState(null);
  const stageRef = useRef(null);
  const [stageW, setStageW] = useState(0);

  // The current {layout, meta} mirrored in a ref so history pushes read the
  // pre-edit state synchronously (a push inside a React updater would double
  // under StrictMode).
  const snapshotRef = useRef({ layout: null, meta: null });
  const historyRef = useRef({ past: [], future: [], lastAt: 0, lastKind: null });
  const [historyTick, setHistoryTick] = useState(0);
  const commit = useCallback((next) => {
    snapshotRef.current = next;
    setLayout(next.layout);
    setMeta(next.meta);
  }, []);
  const pushHistory = useCallback((kind = 'structural') => {
    const h = historyRef.current;
    const now = Date.now();
    const cur = snapshotRef.current;
    if (!cur.layout) return;
    const coalesce = kind === 'text' && h.lastKind === 'text' && h.lastAt && now - h.lastAt < HISTORY_COALESCE_MS && h.past.length > 0;
    if (!coalesce) {
      h.past.push(cur);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.future = [];
    h.lastAt = now;
    h.lastKind = kind;
    setHistoryTick((t) => t + 1);
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push(snapshotRef.current);
    h.lastAt = 0;
    h.lastKind = null;
    commit(h.past.pop());
    setHistoryTick((t) => t + 1);
  }, [commit]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(snapshotRef.current);
    h.lastAt = 0;
    h.lastKind = null;
    commit(h.future.pop());
    setHistoryTick((t) => t + 1);
  }, [commit]);
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  void historyTick;

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Adopt the server document once (and again after each save via adopt()).
  const adopt = useCallback((ev) => {
    const l = clampLayout(ev.layout);
    const m = metaFromEvent(ev);
    commit({ layout: l, meta: m });
    setBaseline({ layout: l, meta: m });
    setProblems(ev.problems || []);
  }, [commit]);
  useEffect(() => { if (event && !baseline) adopt(event); }, [event, baseline, adopt]);

  const dirty = useMemo(() => baseline && layout && meta && (JSON.stringify(layout) !== JSON.stringify(baseline.layout) || JSON.stringify(meta) !== JSON.stringify(baseline.meta)), [baseline, layout, meta]);

  useEffect(() => {
    const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setStageW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frozenDefs = useMemo(() => (event?.frozen ? (event.layout?.fields || []) : null), [event]);
  const frozenKeys = useMemo(() => new Set((frozenDefs || []).map((f) => f.key)), [frozenDefs]);
  // `kind: 'text'` marks a typed edit (coalesced); anything else is one step.
  const update = useCallback((fn, { kind } = {}) => {
    pushHistory(kind);
    const cur = snapshotRef.current;
    commit({ layout: fn(cur.layout), meta: cur.meta });
  }, [pushHistory, commit]);
  const previewLayout = useMemo(() => (layout ? clampLayout(layout, { frozen: frozenDefs }) : null), [layout, frozenDefs]);
  const patchMeta = useCallback((patch) => {
    pushHistory('text');
    const cur = snapshotRef.current;
    commit({ layout: cur.layout, meta: { ...cur.meta, ...patch } });
  }, [pushHistory, commit]);

  // Slug availability probe (debounced) while the link is still editable.
  useEffect(() => {
    if (!meta || !event || event.locked) return undefined;
    const slug = meta.slug;
    if (!slug || slug === baseline?.meta.slug) { setSlugStatus(null); return undefined; }
    const t = setTimeout(() => {
      checkRsvpSlug(slug, event.id).then((r) => setSlugStatus(r?.available ? 'available' : r?.reason || null)).catch(() => setSlugStatus(null));
    }, 350);
    return () => clearTimeout(t);
  }, [meta, event, baseline]);

  const save = useCallback(async () => {
    if (!event || saving) return null;
    setSaving(true);
    try {
      const updated = await updateRsvpEvent(event.id, { layout, ...metaPatch(baseline.meta, meta) });
      queryClient.setQueryData(['rsvp', 'event', event.id], updated);
      queryClient.invalidateQueries({ queryKey: ['rsvp', 'events'] });
      adopt(updated);
      toast.success('Saved');
      return updated;
    } catch (err) {
      toast.error(err?.message || 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }, [event, saving, layout, meta, baseline, adopt]);

  const publish = useCallback(async () => {
    if (!event) return;
    setBusy(true);
    try {
      if (dirty) { const saved = await save(); if (!saved) return; }
      const updated = await publishRsvpEvent(event.id);
      queryClient.setQueryData(['rsvp', 'event', event.id], updated);
      queryClient.invalidateQueries({ queryKey: ['rsvp', 'events'] });
      adopt(updated);
      toast.success(`Live at ${rsvpPublicUrl(updated.slug)}`);
    } catch (err) {
      if (err?.data?.problems) setProblems(err.data.problems);
      toast.error(err?.message || 'Could not publish');
    } finally {
      setBusy(false);
    }
  }, [event, dirty, save, adopt]);

  const close = useCallback(async () => {
    if (!event) return;
    setBusy(true);
    try {
      const updated = await closeRsvpEvent(event.id);
      queryClient.setQueryData(['rsvp', 'event', event.id], updated);
      queryClient.invalidateQueries({ queryKey: ['rsvp', 'events'] });
      adopt(updated);
      toast.success('RSVPs closed');
    } catch (err) {
      toast.error(err?.message || 'Could not close');
    } finally {
      setBusy(false);
    }
  }, [event, adopt]);

  const copyLink = useCallback(async () => {
    const slug = baseline?.meta.slug;
    if (!slug) { toast.error('Set a link in Settings and save first'); return; }
    try { await navigator.clipboard.writeText(rsvpPublicUrl(slug)); toast.success('Link copied'); } catch { toast.error('Could not copy'); }
  }, [baseline]);

  const leave = useCallback(() => {
    if (dirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
    navigate('/admin/rsvp');
  }, [dirty, navigate]);

  if (isLoading || (event && !layout)) {
    return <Shell><span style={{ fontSize: 13, color: 'var(--ink-2, #5B616E)' }}>Loading RSVP designer…</span></Shell>;
  }
  if (isError || !event) {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>Event not found.</p>
          <button type="button" className="av2-btn av2-btn--ghost" onClick={() => navigate('/admin/rsvp')}>← Back to RSVP pages</button>
        </div>
      </Shell>
    );
  }

  const dev = DEVICES.find((d) => d.id === device) || DEVICES[0];
  const scale = stageW > 0 ? Math.min(1, (stageW - 32) / dev.width) : 1;
  const statusTone = { draft: '#5B616E', published: '#1F7A46', closed: '#8A5B07' }[event.status] || '#5B616E';

  return (
    <div className="admin-v2" data-theme="light" style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', background: 'var(--canvas, #F4F5F7)', color: 'var(--ink, #171A20)', fontFamily: "var(--font-ui, 'Schibsted Grotesk', system-ui, sans-serif)" }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface, #fff)', borderBottom: '1px solid var(--line, #E3E6EB)' }}>
        <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={leave}>← RSVP pages</button>
        <strong style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{meta.title || 'Untitled event'}</strong>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: statusTone }}>{event.status}</span>
        {baseline.meta.slug ? <code style={{ fontSize: 11.5, color: 'var(--ink-2, #5B616E)' }}>rsvp.redeem.sg/{baseline.meta.slug}</code> : null}
        <span style={{ fontSize: 11.5, color: dirty ? '#8A5B07' : 'var(--ink-3, #9BA0AB)' }}>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <div role="group" aria-label="History" style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">Redo</button>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={copyLink} disabled={!baseline.meta.slug}>Copy link</button>
        <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => navigate(`/admin/rsvp/${event.id}/responses`)}>Responses ({event.goingCount || 0})</button>
        {event.status === 'published' ? (
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={close} disabled={busy}>Close RSVPs</button>
        ) : (
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={publish} disabled={busy}>{event.status === 'closed' ? 'Reopen' : 'Publish'}</button>
        )}
        <button type="button" className="av2-btn av2-btn--primary av2-btn--sm" onClick={save} disabled={!dirty || saving}>Save</button>
      </div>

      {problems.length > 0 && event.status !== 'published' ? (
        <div role="status" style={{ padding: '6px 14px', fontSize: 12, background: '#FFF7E6', color: '#8A5B07', borderBottom: '1px solid #F3E2B8' }}>
          Before publishing: {problems.map(problemLabel).join(' · ')}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Rail */}
        <nav aria-label="Designer sections" style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 8px', background: 'var(--surface, #fff)', borderRight: '1px solid var(--line, #E3E6EB)' }}>
          {SECTIONS.map(([sid, label]) => (
            <button key={sid} type="button" onClick={() => setSection(sid)} aria-current={section === sid ? 'page' : undefined} style={{ padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13.5, fontWeight: section === sid ? 600 : 500, color: section === sid ? 'var(--ink, #171A20)' : 'var(--ink-2, #5B616E)', background: section === sid ? 'var(--accent-soft, #ECEFFA)' : 'transparent' }}>{label}</button>
          ))}
        </nav>

        {/* Panel */}
        <aside style={{ width: 320, flexShrink: 0, overflowY: 'auto', background: 'var(--surface, #fff)', borderRight: '1px solid var(--line, #E3E6EB)' }}>
          {section === 'content' && <ContentPanel layout={layout} update={update} selectedId={selectedBlock} onSelect={setSelectedBlock} consentDefault={event.consent?.defaultTemplate || ''} />}
          {section === 'form' && <FormPanel layout={layout} update={update} selectedKey={selectedField} onSelect={setSelectedField} frozenKeys={frozenKeys} />}
          {section === 'theme' && <ThemePanel layout={layout} update={update} />}
          {section === 'settings' && <SettingsPanel meta={meta} setMeta={patchMeta} layout={layout} update={update} locked={Boolean(event.locked)} slugStatus={slugStatus} />}
        </aside>

        {/* Stage */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1E2026' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
            <div role="group" aria-label="Device" style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.08)', padding: 3, borderRadius: 9 }}>
              {DEVICES.map((d) => (
                <button key={d.id} type="button" onClick={() => setDevice(d.id)} aria-pressed={device === d.id} style={{ padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: device === d.id ? '#171A20' : 'rgba(255,255,255,.55)', background: device === d.id ? '#fff' : 'transparent' }}>{d.label}</button>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)' }}>Live preview — the form is inert here</span>
          </div>
          <div ref={stageRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '4px 16px 24px' }}>
            <DeviceFrame width={dev.width} height={dev.height} scale={scale} ariaLabel="RSVP page preview">
              <RsvpPageRenderer
                title={meta.title}
                organiserName={meta.organiserName}
                layout={previewLayout}
                state="open"
                consent={{
                  version: event.consent?.version,
                  // Same substitution the server applies, over the UNSAVED wording + organiser.
                  copy: renderConsentTemplate(consentTemplateOf(previewLayout) || event.consent?.defaultTemplate || '', meta.organiserName),
                }}
                mode="preview"
              />
            </DeviceFrame>
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return <div className="admin-v2" data-theme="light" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--canvas, #F4F5F7)' }}>{children}</div>;
}
