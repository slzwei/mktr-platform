/**
 * Switchboard Prospects — the operator lead table. Filters live in the URL
 * (removable chips, shareable links, back/forward safe), pagination + sort are
 * server-side (Phase B contracts), the drawer tells the whole lead story, and
 * the bulk bar drives the REAL bulk endpoints (assign / return-to-held /
 * delete) plus a client-side CSV export.
 */
import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProspects, useAgentOptions } from '@/hooks/queries/useAdminV2';
import { bulkAssign, bulkReturnToHeld, bulkDelete } from '@/api/adminV2';
import {
  LEAD_STATUSES, LEAD_SOURCES, STATUS_LABELS, STATUS_CHIP_CLASS,
  SOURCE_LABELS, HELD_REASON_LABELS, UTM_LABELS, PAGE_SIZE,
} from '@/lib/adminV2/constants';
import { fmtDateTime, fmtRelative } from '@/lib/adminV2/format';
import { prospectsToCsv, downloadCsv } from '@/lib/adminV2/csv';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

// ── URL param helpers (the URL is the single source of filter truth) ────────

function readFilters(searchParams) {
  return {
    status: (searchParams.get('status') || '').split(',').filter(Boolean),
    source: (searchParams.get('source') || '').split(',').filter(Boolean),
    assignment: searchParams.get('assignment') || '',
    search: searchParams.get('q') || '',
    sort: searchParams.get('sort') || '-createdAt',
    page: Math.max(1, parseInt(searchParams.get('page'), 10) || 1),
  };
}

function CheckboxGlyph({ checked }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18, height: 18, flex: 'none', borderRadius: 5, boxSizing: 'border-box',
        border: `2px solid ${checked ? 'var(--accent)' : 'var(--line-strong)'}`,
        background: checked ? 'var(--accent)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent-ink)', fontSize: 11, fontWeight: 800, lineHeight: 1,
      }}
    >
      {checked ? '✓' : ''}
    </span>
  );
}

function SortHeader({ label, field, sort, onSort, width, align }) {
  const active = sort === field || sort === `-${field}`;
  const desc = sort === `-${field}`;
  return (
    <button
      type="button"
      onClick={() => onSort(active && !desc ? `-${field}` : field)}
      className="av2-microcaps"
      style={{
        width, flex: width ? 'none' : 1, textAlign: align || 'left', background: 'none',
        border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-ui)',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
      }}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
    >
      {label}{active ? (desc ? ' ▼' : ' ▲') : ''}
    </button>
  );
}

function LeadDrawer({ prospect, onClose }) {
  if (!prospect) return null;
  const p = prospect;
  const utm = p.sourceMetadata?.utm || {};
  const held = !!p.quarantinedAt;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="admin-v2" style={{ width: 432, maxWidth: '90vw', padding: 0, background: 'var(--surface)', color: 'var(--ink)', borderLeft: '1px solid var(--line)' }}>
        <SheetHeader style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <SheetTitle style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
            {p.firstName} {p.lastName}
          </SheetTitle>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>
            {held && <Chip tone="hold" glyph="◆">{HELD_REASON_LABELS[p.quarantineReason] || 'Held'}</Chip>}
            {!held && !p.assignedAgent && <Chip tone="warn">Unassigned</Chip>}
            {p.priority && <Chip>{p.priority}</Chip>}
            {Number.isFinite(Number(p.score)) && p.score !== null && <Chip>score {p.score}</Chip>}
          </div>
        </SheetHeader>
        <div style={{ padding: 16, overflowY: 'auto', display: 'grid', gap: 18 }}>
          <section>
            <div className="av2-microcaps" style={{ marginBottom: 6 }}>Contact</div>
            <div className="av2-kv"><span>phone</span><span>{p.phone || '—'}</span></div>
            <div className="av2-kv"><span>email</span><span>{p.email || '—'}</span></div>
          </section>
          <section>
            <div className="av2-microcaps" style={{ marginBottom: 6 }}>Attribution</div>
            <div className="av2-kv"><span>source</span><span>{SOURCE_LABELS[p.leadSource] || p.leadSource}</span></div>
            {utm.utm_source && <div className="av2-kv"><span>utm_source</span><span>{UTM_LABELS[utm.utm_source] || utm.utm_source}</span></div>}
            {utm.utm_medium && <div className="av2-kv"><span>utm_medium</span><span>{utm.utm_medium}</span></div>}
            {utm.utm_campaign && <div className="av2-kv"><span>utm_campaign</span><span>{utm.utm_campaign}</span></div>}
            {p.qrTag && <div className="av2-kv"><span>qr tag</span><span>{p.qrTag.name}</span></div>}
            <div className="av2-kv"><span>campaign</span><span>{p.campaign?.name || '—'}</span></div>
          </section>
          <section>
            <div className="av2-microcaps" style={{ marginBottom: 6 }}>Routing</div>
            <div className="av2-kv"><span>agent</span><span>{p.assignedAgent ? `${p.assignedAgent.firstName || ''} ${p.assignedAgent.lastName || ''}`.trim() : held ? 'held' : 'unassigned'}</span></div>
            {held && <div className="av2-kv"><span>held since</span><span>{fmtDateTime(p.quarantinedAt)}</span></div>}
            {held && <div className="av2-kv"><span>reason</span><span>{HELD_REASON_LABELS[p.quarantineReason] || p.quarantineReason || '—'}</span></div>}
          </section>
          <section>
            <div className="av2-microcaps" style={{ marginBottom: 6 }}>Timeline</div>
            <div className="av2-kv"><span>created</span><span>{fmtDateTime(p.createdAt)}</span></div>
            <div className="av2-kv"><span>last contact</span><span>{fmtDateTime(p.lastContactDate)}</span></div>
            <div className="av2-kv"><span>converted</span><span>{fmtDateTime(p.conversionDate)}</span></div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminV2Prospects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [selected, setSelected] = useState(() => new Set());
  const [drawer, setDrawer] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();

  // Debounced search → URL (which drives the query)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== filters.search) patch({ q: searchDraft || null, page: null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  function patch(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '' || v === undefined) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  const queryParams = useMemo(() => ({
    page: filters.page,
    limit: PAGE_SIZE,
    ...(filters.status.length ? { leadStatus: filters.status.join(',') } : {}),
    ...(filters.source.length ? { leadSource: filters.source.join(',') } : {}),
    ...(filters.assignment ? { assignment: filters.assignment } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    sort: filters.sort,
  }), [filters]);

  const prospects = useProspects(queryParams);
  const rows = prospects.data?.rows || [];
  const total = prospects.data?.total ?? 0;

  // Selection is per-page; changing the result set clears it.
  useEffect(() => { setSelected(new Set()); }, [queryParams]);

  const toggleList = (key, value) => {
    const current = new Set(filters[key]);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    patch({ [key === 'status' ? 'status' : 'source']: [...current].join(',') || null, page: null });
  };

  const activeChips = [
    ...filters.status.map((s) => ({ key: `status:${s}`, label: STATUS_LABELS[s] || s, clear: () => toggleList('status', s) })),
    ...filters.source.map((s) => ({ key: `source:${s}`, label: SOURCE_LABELS[s] || s, clear: () => toggleList('source', s) })),
    ...(filters.assignment ? [{ key: 'assignment', label: `${filters.assignment} only`, clear: () => patch({ assignment: null, page: null }) }] : []),
    ...(filters.search ? [{ key: 'q', label: `“${filters.search}”`, clear: () => { setSearchDraft(''); patch({ q: null, page: null }); } }] : []),
  ];

  // ── Bulk actions (live endpoints) ──────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['adminV2', 'prospects'] });
  const ids = [...selected];
  const agentOptions = useAgentOptions(selected.size > 0);

  const assignMutation = useMutation({
    mutationFn: ({ agentId }) => bulkAssign(ids, agentId),
    onSuccess: (_r, { agentName }) => { toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} assigned to ${agentName}`); setSelected(new Set()); invalidate(); },
    onError: (e) => toast.error(e?.message || 'Assign failed'),
  });
  const returnMutation = useMutation({
    mutationFn: () => bulkReturnToHeld(ids),
    onSuccess: () => { toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} returned to held`); setSelected(new Set()); invalidate(); },
    onError: (e) => toast.error(e?.message || 'Return failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => bulkDelete(ids),
    onSuccess: () => { toast.success(`${ids.length} lead${ids.length === 1 ? '' : 's'} deleted`); setSelected(new Set()); setConfirmDelete(false); invalidate(); },
    onError: (e) => { toast.error(e?.message || 'Delete failed'); setConfirmDelete(false); },
  });

  const exportSelection = () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    const data = chosen.length ? chosen : rows;
    downloadCsv(`prospects-${new Date().toISOString().slice(0, 10)}.csv`, prospectsToCsv(data));
    toast.success(`Exported ${data.length} row${data.length === 1 ? '' : 's'}`);
  };

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const totalPages = prospects.data?.totalPages ?? 0;
  const rangeStart = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filters.page * PAGE_SIZE, total);

  return (
    <div>
      <PageHeader title="Prospects" meta={`${total.toLocaleString('en-SG')} LEADS · SERVER-SIDE 25/PAGE`}>
        <button type="button" className="av2-btn" onClick={exportSelection}>Export CSV</button>
      </PageHeader>

      {/* ── Filter toolbar ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: activeChips.length ? 8 : 16 }}>
        <div className="av2-input" style={{ maxWidth: 320 }}>
          <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>⌕</span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name, phone, email"
            aria-label="Search prospects"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'inherit' }}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="av2-btn">Status{filters.status.length ? ` · ${filters.status.length}` : ''} ▾</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="admin-v2" align="start">
            <DropdownMenuLabel>Lead status</DropdownMenuLabel>
            {LEAD_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem key={s} checked={filters.status.includes(s)} onCheckedChange={() => toggleList('status', s)}>
                {STATUS_LABELS[s] || s}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="av2-btn">Source{filters.source.length ? ` · ${filters.source.length}` : ''} ▾</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="admin-v2" align="start">
            <DropdownMenuLabel>Lead source</DropdownMenuLabel>
            {LEAD_SOURCES.map((s) => (
              <DropdownMenuCheckboxItem key={s} checked={filters.source.includes(s)} onCheckedChange={() => toggleList('source', s)}>
                {SOURCE_LABELS[s] || s}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {['held', 'unassigned'].map((a) => (
          <button
            key={a}
            type="button"
            className="av2-btn"
            aria-pressed={filters.assignment === a}
            style={filters.assignment === a ? { background: 'var(--hold-soft)', color: 'var(--hold)', borderColor: 'var(--hold)' } : undefined}
            onClick={() => patch({ assignment: filters.assignment === a ? null : a, page: null })}
          >
            {a === 'held' ? '◆ Held' : 'Unassigned'}
          </button>
        ))}
      </div>

      {/* ── Active filter chips ── */}
      {activeChips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {activeChips.map((c) => (
            <button key={c.key} type="button" className="av2-filterchip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>
              {c.label} ✕
            </button>
          ))}
          <button
            type="button" className="av2-filterchip" style={{ background: 'transparent', color: 'var(--ink-3)' }}
            onClick={() => { setSearchDraft(''); setSearchParams(new URLSearchParams(), { replace: true }); }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="av2-card" style={{ overflow: 'hidden' }}>
        <div className="av2-thead">
          <button type="button" onClick={toggleAll} aria-label={allOnPageSelected ? 'Deselect all on page' : 'Select all on page'} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
            <CheckboxGlyph checked={allOnPageSelected} />
          </button>
          <SortHeader label="Lead" field="firstName" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} />
          <span className="av2-microcaps" style={{ width: 110, flex: 'none' }}>Phone</span>
          <SortHeader label="Status" field="leadStatus" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={130} />
          <span className="av2-microcaps" style={{ flex: 1 }}>Campaign</span>
          <span className="av2-microcaps" style={{ width: 100, flex: 'none' }}>Agent</span>
          <SortHeader label="Created" field="createdAt" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={100} align="right" />
        </div>

        {prospects.isLoading && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="av2-row" style={{ cursor: 'default' }}><Skeleton height={32} /></div>
        ))}
        {prospects.isError && <ErrorState error={prospects.error} onRetry={prospects.refetch} />}
        {!prospects.isLoading && !prospects.isError && rows.length === 0 && (
          <EmptyState
            title="No leads match these filters"
            hint="Loosen a filter or clear them all."
            action={activeChips.length > 0 && (
              <button type="button" className="av2-btn av2-btn--sm" onClick={() => { setSearchDraft(''); setSearchParams(new URLSearchParams(), { replace: true }); }}>Clear all filters</button>
            )}
          />
        )}

        {rows.map((p) => {
          const held = !!p.quarantinedAt;
          const isSelected = selected.has(p.id);
          return (
            <div key={p.id} className="av2-row" data-selected={isSelected} role="button" tabIndex={0}
              onClick={() => setDrawer(p)}
              onKeyDown={(e) => { if (e.key === 'Enter') setDrawer(p); }}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleOne(p.id); }}
                aria-label={isSelected ? 'Deselect' : 'Select'}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}
              >
                <CheckboxGlyph checked={isSelected} />
              </button>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{p.firstName} {p.lastName}</span>
                <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email || '—'}</span>
              </span>
              <span className="av2-mono" style={{ width: 110, flex: 'none', fontSize: 11, color: 'var(--ink-2)' }}>{p.phone || '—'}</span>
              <span style={{ width: 130, flex: 'none' }}>
                {held
                  ? <Chip tone="hold" glyph="◆">{HELD_REASON_LABELS[p.quarantineReason]?.split(' ').slice(0, 2).join(' ') || 'Held'}</Chip>
                  : <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.campaign?.name || '—'}</span>
              <span style={{ width: 100, flex: 'none', fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.assignedAgent ? `${p.assignedAgent.firstName || ''}` : held ? '—' : <Chip tone="warn">none</Chip>}
              </span>
              <span className="av2-mono" style={{ width: 100, flex: 'none', fontSize: 10, color: 'var(--ink-3)', textAlign: 'right' }} title={fmtDateTime(p.createdAt)}>
                {fmtRelative(p.createdAt)}
              </span>
            </div>
          );
        })}

        {/* ── Pagination footer ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
          <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {rangeStart}–{rangeEnd} of {total.toLocaleString('en-SG')}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="av2-btn av2-btn--sm" disabled={filters.page <= 1} onClick={() => patch({ page: String(filters.page - 1) })}>← Prev</button>
          <button type="button" className="av2-btn av2-btn--sm" disabled={filters.page >= totalPages} onClick={() => patch({ page: String(filters.page + 1) })}>Next →</button>
        </div>
      </div>

      {/* ── Bulk bar (floats only while a selection exists) ── */}
      {selected.size > 0 && (
        <div className="av2-bulkbar" role="toolbar" aria-label="Bulk actions">
          <span className="av2-mono" style={{ fontSize: 12, fontWeight: 600 }}>{selected.size} selected</span>
          <span style={{ width: 1, height: 20, background: 'var(--ink-2)' }} aria-hidden="true" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="av2-btn av2-btn--sm" disabled={assignMutation.isPending}>Assign to agent ▾</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="admin-v2" align="center" side="top">
              <DropdownMenuLabel>Assign {selected.size} lead{selected.size === 1 ? '' : 's'} to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(agentOptions.data || []).map((a) => (
                <DropdownMenuItem key={a.id} onSelect={() => assignMutation.mutate({ agentId: a.id, agentName: a.name })}>
                  {a.name}
                </DropdownMenuItem>
              ))}
              {agentOptions.isLoading && <DropdownMenuItem disabled>Loading agents…</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="av2-btn av2-btn--sm" disabled={returnMutation.isPending} onClick={() => returnMutation.mutate()}>Return to held</button>
          <button type="button" className="av2-btn av2-btn--sm" onClick={exportSelection}>Export CSV</button>
          <button type="button" className="av2-btn av2-btn--sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => setConfirmDelete(true)}>Delete</button>
          <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" style={{ background: 'none', border: 'none', color: 'var(--canvas)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Delete {selected.size} lead{selected.size === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
              This permanently removes the selected leads and their activity history. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              style={{ background: 'var(--bad)', color: '#fff' }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LeadDrawer prospect={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
