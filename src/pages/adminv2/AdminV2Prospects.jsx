/**
 * Switchboard Prospects — the operator lead table. Filters live in the URL
 * (removable chips, shareable links, back/forward safe), pagination + sort are
 * server-side (Phase B contracts), a row click opens the lead's full-page
 * profile (/admin/leads/:id — the drawer's replacement), and the bulk bar
 * drives the REAL bulk endpoints (assign / return-to-held / delete) plus a
 * client-side CSV export.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProspects, useAgentOptions } from '@/hooks/queries/useAdminV2';
import { bulkAssign, bulkReturnToHeld, bulkDelete } from '@/api/adminV2';
import {
  LEAD_STATUSES, LEAD_SOURCES, STATUS_LABELS, STATUS_CHIP_CLASS,
  SOURCE_LABELS, heldLabel, PAGE_SIZE,
} from '@/lib/adminV2/constants';
import { fmtDateTime, fmtRelative } from '@/lib/adminV2/format';
import { prospectsToCsv, downloadCsv } from '@/lib/adminV2/csv';
import { rowChipFor } from '@/lib/adminV2/outcome';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { useAdminV2Mobile } from '@/components/adminv2/mobile/useAdminV2Mobile';
import { useLongPress } from '@/components/adminv2/mobile/useLongPress';
import MobileSheet, { SheetHead, SheetConfirm } from '@/components/adminv2/mobile/MobileSheet';
import { MobileSelectBar } from '@/components/adminv2/mobile/MobileBars';
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
    // Legacy deep-link params — AdminCampaigns links ?campaign=<id>, the QR
    // tables link ?qrTagId=<id>. Both must keep narrowing the table.
    campaign: searchParams.get('campaign') || searchParams.get('campaignId') || '',
    qrTagId: searchParams.get('qrTagId') || '',
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

/**
 * The LEAD score — (person × campaign), not the person
 * (docs/plans/per-campaign-lead-scoring.md §4). The same number the queue
 * sorts by, because there is only one: it is decayed at WRITE time and stored,
 * so sort and display can never disagree (§6).
 *
 * NULL is not zero. It means this lead has not been scored yet, and rendering
 * it as a low number would rank a brand-new lead below a genuinely poor one.
 * Mirrors AdminV2People's ScoreCell idiom so the two queues read alike.
 */
function LeadScoreCell({ value, scoredAt }) {
  if (value == null) {
    return (
      <span
        className="av2-mono"
        style={{ width: 52, flex: 'none', fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}
        title="Not scored yet"
      >
        —
      </span>
    );
  }
  // Weight only the top of the range: a faint ramp reads as ranking without
  // implying precision the number doesn't have.
  const strong = value >= 60;
  return (
    <span
      className="av2-mono"
      style={{
        width: 52, flex: 'none', fontSize: 12, textAlign: 'right',
        fontWeight: strong ? 700 : 500,
        color: strong ? 'var(--ink)' : 'var(--ink-2)',
      }}
      title={`Lead score ${value}/100${scoredAt ? ` · as of ${fmtDateTime(scoredAt)}` : ''}`}
    >
      {value}
    </span>
  );
}

/**
 * Campaign-outcome chip cluster (plan: admin-prospects-outcome-column):
 * held alarm → outcome in the campaign's own voice → pipeline status ONLY
 * when it isn't the default 'new' → screening verdict. Shared by the desktop
 * table cell and the mobile card row so the two can never disagree.
 */
function OutcomeChips({ p, held }) {
  return (
    <>
      {held
        ? <Chip tone="hold" glyph="◆">{heldLabel(p).short}</Chip>
        : (() => {
          const chip = rowChipFor(p.draw, p.reward ? [p.reward] : []);
          const pipeline = p.leadStatus && p.leadStatus !== 'new' && (
            <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>
              {STATUS_LABELS[p.leadStatus] || p.leadStatus}
            </Chip>
          );
          if (!chip && !pipeline) {
            return <span className="av2-mono" aria-label="No outcome yet" style={{ fontSize: 11, color: 'var(--ink-3)', paddingTop: 2 }}>—</span>;
          }
          return (
            <>
              {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
              {pipeline}
            </>
          );
        })()}
      {p.screeningVerdict && !String(p.quarantineReason || '').startsWith('screening_') && (
        <span
          title={p.screeningVerdict === 'qualified'
            ? 'Passed the AI screening call — SG/PR, in age range, agreed to meet a consultant'
            : p.screeningVerdict === 'not_qualified'
              ? 'Did not pass the AI screening call'
              : 'AI screening result'}
          style={{ display: 'inline-flex' }}
        >
          <Chip
            tone={p.screeningVerdict === 'qualified' ? 'ok' : p.screeningVerdict === 'not_qualified' ? 'bad' : 'warn'}
            glyph={p.screeningVerdict === 'qualified' ? '✓' : p.screeningVerdict === 'not_qualified' ? '✗' : '☎'}
          >
            {p.screeningVerdict === 'qualified' ? 'AI qualified'
              : p.screeningVerdict === 'not_qualified' ? 'AI failed'
                : 'AI screen'}
          </Chip>
        </span>
      )}
    </>
  );
}

/** Mobile lead card (design 1694f8b2): tap opens/toggles, long-press selects. */
function MobileLeadRow({ p, selecting, isSelected, onTap, onLongPress }) {
  const lp = useLongPress(onLongPress);
  const held = !!p.quarantinedAt;
  const agent = p.assignedAgent ? `${p.assignedAgent.firstName || ''} ${p.assignedAgent.lastName || ''}`.trim() : '';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}
      {...lp}
      className="av2-card"
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', cursor: 'pointer',
        background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
        borderColor: isSelected ? 'var(--accent)' : 'var(--line)',
        WebkitUserSelect: 'none', userSelect: 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {selecting && <CheckboxGlyph checked={isSelected} />}
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.firstName} {p.lastName}
        </span>
        <span className="av2-mono" style={{ flex: 'none', fontSize: 9.5, color: 'var(--ink-3)' }}>{fmtRelative(p.createdAt)}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
        <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', flex: 'none' }}>{p.phone || '—'}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.campaign?.name || '—'}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
        <OutcomeChips p={p} held={held} />
        <span style={{ flex: 1, minWidth: 24, textAlign: 'right', fontSize: 11, fontWeight: 600, color: agent ? 'var(--ink-2)' : 'var(--warn)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agent || (p.externalAgentId ? 'External' : held ? '' : 'Unassigned')}
        </span>
        {p.score != null && (
          <span className="av2-mono" style={{ flex: 'none', fontSize: 10.5, color: 'var(--ink-2)' }} title={`Lead score ${p.score}/100`}>
            Score {p.score}
          </span>
        )}
      </span>
    </div>
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


export default function AdminV2Prospects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useAdminV2Mobile();
  // Mobile-only UI state: which bottom sheet is up, the filter draft it edits
  // (applied to the URL in one patch), explicit select mode, agent search.
  const [sheet, setSheet] = useState(null); // 'filters' | 'assign' | 'confirmDelete'
  const [filterDraft, setFilterDraft] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [agentQ, setAgentQ] = useState('');

  // Open a lead's full-page profile, carrying the CURRENT list URL as
  // state.from so the page's back link restores these exact filters (§3.8).
  const openLead = (id) => navigate(`/admin/leads/${id}`, {
    state: { from: `${location.pathname}${location.search}` },
  });

  // Live view of the params for timers created in older renders. RR v7's
  // setSearchParams closes over ITS render's params (even the functional
  // form receives that stale snapshot and always navigates), so a 350ms-old
  // updater would rewind the URL — clobbering filters clicked inside the
  // window and resurrecting consumed params like `lead`.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  // Debounced search → URL (which drives the query). Reads the LIVE params at
  // fire time and skips navigation entirely when q is already in sync.
  useEffect(() => {
    const t = setTimeout(() => {
      const prev = paramsRef.current;
      if ((prev.get('q') || '') === searchDraft) return;
      const next = new URLSearchParams(prev);
      if (searchDraft) next.set('q', searchDraft);
      else next.delete('q');
      next.delete('page');
      setSearchParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // Back/forward (or a pasted URL) changes q outside the input — resync the
  // draft unless the operator is mid-typing.
  useEffect(() => {
    if (document.activeElement?.getAttribute('aria-label') !== 'Search prospects' && filters.search !== searchDraft) {
      setSearchDraft(filters.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  function patch(changes) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '' || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }

  const queryParams = useMemo(() => ({
    page: filters.page,
    limit: PAGE_SIZE,
    // The STATUS column speaks the campaign-outcome voice — admin-only,
    // opt-in enrichment (the palette and agent surfaces never send this).
    include: 'outcome',
    ...(filters.status.length ? { leadStatus: filters.status.join(',') } : {}),
    ...(filters.source.length ? { leadSource: filters.source.join(',') } : {}),
    ...(filters.assignment ? { assignment: filters.assignment } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.campaign ? { campaignId: filters.campaign } : {}),
    ...(filters.qrTagId ? { qrTagId: filters.qrTagId } : {}),
    sort: filters.sort,
  }), [filters]);

  const prospects = useProspects(queryParams);
  const rows = prospects.data?.rows || [];
  const total = prospects.data?.total ?? 0;

  // Selection is per-page; changing the result set clears it.
  useEffect(() => { setSelected(new Set()); }, [queryParams]);

  // Legacy deep-link: ?lead=<id> (the old drawer contract — saved links and
  // any un-migrated caller still emit it) → redirect to the Lead Profile
  // page. No need to wait for the row set: the page detail-fetches by id.
  // The CLEANED list URL rides along as state.from for the back link.
  const leadParam = searchParams.get('lead');
  useEffect(() => {
    if (!leadParam) return;
    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete('lead');
    const qs = cleaned.toString();
    navigate(`/admin/leads/${leadParam}`, {
      replace: true,
      state: { from: `/AdminProspects${qs ? `?${qs}` : ''}` },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadParam]);

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
    ...(filters.campaign ? [{ key: 'campaign', label: 'campaign filter', clear: () => patch({ campaign: null, campaignId: null, page: null }) }] : []),
    ...(filters.qrTagId ? [{ key: 'qrTagId', label: 'QR tag filter', clear: () => patch({ qrTagId: null, page: null }) }] : []),
  ];

  // ── Bulk actions (live endpoints) ──────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'prospects'] });
    // The drawer's detail cache carries the same lead + the Person journey —
    // keep it in step with row mutations (assign / return / delete).
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'prospectDetail'] });
  };
  const ids = [...selected];
  const agentOptions = useAgentOptions(selected.size > 0);

  // Toasts report the SERVER's counts — the backend legitimately skips rows
  // (e.g. DNC-held leads are not releasable via assign), and the operator must
  // see that, never an assumed "N done".
  const assignMutation = useMutation({
    mutationFn: ({ agentId }) => bulkAssign(ids, agentId),
    onSuccess: (r, { agentName }) => {
      const n = r?.data?.affectedCount ?? 0;
      const skippedObj = r?.data?.skipped || {};
      const skipped = Object.values(skippedObj).reduce((a, b) => a + (Number(b) || 0), 0);
      if (n > 0) toast.success(`${n} lead${n === 1 ? '' : 's'} assigned to ${agentName}${skipped ? ` · ${skipped} skipped (not releasable)` : ''}`);
      else toast.warning(`Nothing assigned — ${skipped || ids.length} lead${(skipped || ids.length) === 1 ? ' was' : 's were'} not eligible`);
      setSelected(new Set()); invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Assign failed'),
  });
  const returnMutation = useMutation({
    mutationFn: () => bulkReturnToHeld(ids),
    onSuccess: (r) => {
      const c = r?.data || {};
      const n = c.returned ?? 0;
      const rest = (c.alreadyHeld || 0) + (c.undeliverable || 0) + (c.notFound || 0);
      if (n > 0) toast.success(`${n} lead${n === 1 ? '' : 's'} returned to held${rest ? ` · ${rest} skipped` : ''}`);
      else toast.warning('Nothing returned — the selection was already held or not eligible');
      setSelected(new Set()); invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Return failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => bulkDelete(ids),
    onSuccess: (r) => {
      const c = r?.data || {};
      const n = c.deleted ?? 0;
      const rest = (c.notFound || 0) + (c.failed || 0);
      if (n > 0) toast.success(`${n} lead${n === 1 ? '' : 's'} deleted${rest ? ` · ${rest} skipped` : ''}`);
      else toast.warning('Nothing deleted');
      setSelected(new Set()); setConfirmDelete(false); invalidate();
    },
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

  /* ── Mobile (design 1694f8b2): card list, filter sheet, select mode ── */
  if (mobile) {
    const selecting = selectMode || selected.size > 0;
    const filterCount = filters.status.length + filters.source.length + (filters.assignment ? 1 : 0);
    const pillStyle = (on) => ({
      minHeight: 36, padding: '0 13px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-ui)',
      fontSize: 12, fontWeight: 700, background: on ? 'var(--ink)' : 'var(--surface)',
      color: on ? 'var(--canvas)' : 'var(--ink-2)', border: `1px solid ${on ? 'var(--ink)' : 'var(--line-strong)'}`,
    });
    const openFiltersSheet = () => {
      setFilterDraft({ status: [...filters.status], source: [...filters.source], assignment: filters.assignment, sort: filters.sort });
      setSheet('filters');
    };
    const draftToggle = (key, value) => setFilterDraft((d) => {
      const cur = new Set(d[key]);
      if (cur.has(value)) cur.delete(value); else cur.add(value);
      return { ...d, [key]: [...cur] };
    });
    const applyDraft = () => {
      patch({
        status: filterDraft.status.join(',') || null,
        source: filterDraft.source.join(',') || null,
        assignment: filterDraft.assignment || null,
        sort: filterDraft.sort === '-createdAt' ? null : filterDraft.sort,
        page: null,
      });
      setSheet(null);
    };
    const exitSelect = () => { setSelected(new Set()); setSelectMode(false); };
    const agentNeedle = agentQ.trim().toLowerCase();
    const agentRows = (agentOptions.data || []).filter((a) => !agentNeedle
      || [a.name, a.email, a.phone].filter(Boolean).some((s) => s.toLowerCase().includes(agentNeedle)));
    const toggleSwitch = (on) => (
      <span aria-hidden="true" style={{ width: 44, height: 26, flex: 'none', borderRadius: 13, position: 'relative', transition: 'background .15s', background: on ? 'var(--accent)' : 'var(--line-strong)' }}>
        <span style={{ position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .15s', left: on ? 21 : 3 }} />
      </span>
    );

    return (
      <div>
        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="av2-input" style={{ flex: 1, height: 44, minWidth: 0 }}>
            <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>⌕</span>
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Name, phone, email…"
              aria-label="Search prospects"
              style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, minWidth: 0, font: 'inherit', color: 'inherit', fontSize: 13.5 }}
            />
            {searchDraft && (
              <button type="button" onClick={() => setSearchDraft('')} aria-label="Clear search" style={{ background: 'var(--surface-2)', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', color: 'var(--ink-2)', fontSize: 11, lineHeight: 1, flex: 'none', padding: 0 }}>✕</button>
            )}
          </div>
          <button type="button" onClick={openFiltersSheet} style={{ height: 44, flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '0 13px', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14 }} aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Filters
            {filterCount > 0 && (
              <span className="av2-mono" style={{ fontSize: 10, fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 6, padding: '1px 6px' }}>{filterCount}</span>
            )}
          </button>
        </div>

        {/* Applied filter chips — horizontal scroll */}
        {activeChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '9px 14px 1px', margin: '0 -14px' }}>
            {activeChips.map((c) => (
              <button key={c.key} type="button" className="av2-filterchip" onClick={c.clear} aria-label={`Remove filter ${c.label}`} style={{ flex: 'none', whiteSpace: 'nowrap' }}>
                {c.label} ✕
              </button>
            ))}
            <button
              type="button" className="av2-filterchip" style={{ background: 'transparent', color: 'var(--ink-3)', flex: 'none', whiteSpace: 'nowrap' }}
              onClick={() => { setSearchDraft(''); setSearchParams(new URLSearchParams(), { replace: true }); }}
            >
              Clear all
            </button>
          </div>
        )}

        {/* Meta + select toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px 8px' }}>
          <span className="av2-mono" style={{ fontSize: 10, letterSpacing: '.13em', color: 'var(--ink-3)', textTransform: 'uppercase', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {total.toLocaleString('en-SG')} lead{total === 1 ? '' : 's'}{total > 0 ? ` · ${rangeStart}–${rangeEnd}` : ''}
          </span>
          <button type="button" onClick={() => (selecting ? exitSelect() : setSelectMode(true))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', padding: '4px 2px' }}>
            {selecting ? 'Done' : 'Select'}
          </button>
        </div>

        {/* Card list */}
        {prospects.isLoading && (
          <div style={{ display: 'grid', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} style={{ borderRadius: 14 }} />)}
          </div>
        )}
        {prospects.isError && <div className="av2-card"><ErrorState error={prospects.error} onRetry={prospects.refetch} /></div>}
        {!prospects.isLoading && !prospects.isError && rows.length === 0 && (
          <div className="av2-card">
            <EmptyState
              title="No leads match"
              hint="Loosen the filters or clear the search — nothing in the pipeline matches this slice."
              action={activeChips.length > 0 && (
                <button type="button" className="av2-btn av2-btn--sm" onClick={() => { setSearchDraft(''); setSearchParams(new URLSearchParams(), { replace: true }); }}>Clear filters</button>
              )}
            />
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((p) => (
            <MobileLeadRow
              key={p.id}
              p={p}
              selecting={selecting}
              isSelected={selected.has(p.id)}
              onTap={() => { if (selecting) toggleOne(p.id); else openLead(p.id); }}
              onLongPress={() => { if (!selecting) { setSelectMode(true); toggleOne(p.id); } }}
            />
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px' }}>
            <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {rangeStart}–{rangeEnd} of {total.toLocaleString('en-SG')}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="av2-btn av2-btn--sm" disabled={filters.page <= 1} onClick={() => patch({ page: String(filters.page - 1) })}>← Prev</button>
            <button type="button" className="av2-btn av2-btn--sm" disabled={filters.page >= totalPages} onClick={() => patch({ page: String(filters.page + 1) })}>Next →</button>
          </div>
        )}

        {/* Select-mode action bar (replaces the tab bar while active) */}
        {selecting && (
          <MobileSelectBar
            count={selected.size}
            onCancel={exitSelect}
            actions={[
              { label: 'Assign', tone: 'primary', disabled: selected.size === 0 || assignMutation.isPending, run: () => { setAgentQ(''); setSheet('assign'); } },
              { label: 'Return', disabled: selected.size === 0 || returnMutation.isPending, run: () => { returnMutation.mutate(); setSelectMode(false); } },
              { label: 'CSV', disabled: selected.size === 0, run: exportSelection },
              { label: 'Delete', tone: 'danger', disabled: selected.size === 0, run: () => setSheet('confirmDelete') },
            ]}
          />
        )}

        {/* Filters sheet */}
        <MobileSheet open={sheet === 'filters' && !!filterDraft} onClose={() => setSheet(null)} label="Filters">
          {filterDraft && (
            <>
              <SheetHead
                title="Filters"
                action={(
                  <button type="button" onClick={() => setFilterDraft({ status: [], source: [], assignment: '', sort: '-createdAt' })} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)', padding: '6px 2px' }}>
                    Clear all
                  </button>
                )}
              />
              <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)', paddingBottom: 7 }}>Status</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 14 }}>
                {LEAD_STATUSES.map((s) => (
                  <button key={s} type="button" aria-pressed={filterDraft.status.includes(s)} onClick={() => draftToggle('status', s)} style={pillStyle(filterDraft.status.includes(s))}>
                    {STATUS_LABELS[s] || s}
                  </button>
                ))}
              </div>
              <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)', paddingBottom: 7 }}>Source</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 14 }}>
                {LEAD_SOURCES.map((s) => (
                  <button key={s} type="button" aria-pressed={filterDraft.source.includes(s)} onClick={() => draftToggle('source', s)} style={pillStyle(filterDraft.source.includes(s))}>
                    {SOURCE_LABELS[s] || s}
                  </button>
                ))}
              </div>
              {[['held', '◆ Held only', 'Quarantined — no funded agent, screening, DNC'], ['unassigned', 'Unassigned only', 'Captured but not delivered to any agent']].map(([key, label, hint]) => (
                <button key={key} type="button" onClick={() => setFilterDraft((d) => ({ ...d, assignment: d.assignment === key ? '' : key }))} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '4px 2px', background: 'transparent', border: 'none', borderTop: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{hint}</span>
                  </span>
                  {toggleSwitch(filterDraft.assignment === key)}
                </button>
              ))}
              <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)', padding: '12px 0 7px', borderTop: '1px solid var(--line)' }}>Sort</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 16 }}>
                {[['-createdAt', 'Newest'], ['createdAt', 'Oldest'], ['-score', 'Score high'], ['firstName', 'Name A–Z']].map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={filterDraft.sort === v} onClick={() => setFilterDraft((d) => ({ ...d, sort: v }))} style={pillStyle(filterDraft.sort === v)}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={applyDraft} style={{ width: '100%', height: 48, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700 }}>
                Apply filters
              </button>
            </>
          )}
        </MobileSheet>

        {/* Assign sheet */}
        <MobileSheet open={sheet === 'assign'} onClose={() => setSheet(null)} label="Assign to agent">
          <SheetHead title={`Assign ${selected.size} lead${selected.size === 1 ? '' : 's'}`} kicker="wallet charged on assignment" />
          <div className="av2-input" style={{ height: 44, marginBottom: 10, background: 'var(--surface-2)' }}>
            <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>⌕</span>
            <input value={agentQ} onChange={(e) => setAgentQ(e.target.value)} placeholder="Search agents…" aria-label="Search agents" style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, minWidth: 0, font: 'inherit', color: 'inherit', fontSize: 13 }} />
          </div>
          {agentOptions.isLoading && <div style={{ padding: 8 }}><Skeleton height={44} /></div>}
          {!agentOptions.isLoading && agentRows.length === 0 && (
            <div className="av2-mono" style={{ padding: '16px 4px', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>No agents match</div>
          )}
          {agentRows.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { assignMutation.mutate({ agentId: a.id, agentName: a.name }); setSheet(null); setSelectMode(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 56, padding: '8px 4px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', color: 'var(--ink)' }}
            >
              <span style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700 }}>
                {(a.name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{a.name}</span>
                <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[a.phone, a.email].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <span style={{ color: 'var(--ink-3)', flex: 'none' }} aria-hidden="true">›</span>
            </button>
          ))}
        </MobileSheet>

        {/* Delete confirm sheet */}
        <MobileSheet open={sheet === 'confirmDelete'} onClose={() => setSheet(null)} label="Delete leads">
          <SheetConfirm
            title={`Delete ${selected.size} lead${selected.size === 1 ? '' : 's'}?`}
            body="This permanently removes the selected leads and their activity history. It cannot be undone."
            label={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            onConfirm={() => { deleteMutation.mutate(); setSheet(null); setSelectMode(false); }}
            onCancel={() => setSheet(null)}
          />
        </MobileSheet>
      </div>
    );
  }

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
          {/* Outcome isn't a DB column — no sort affordance (ordering by
              new/contacted was never useful anyway). */}
          <span className="av2-microcaps" style={{ width: 130, flex: 'none' }}>Status</span>
          <span className="av2-microcaps" style={{ flex: 1 }}>Campaign</span>
          <span className="av2-microcaps" style={{ width: 100, flex: 'none' }}>Agent</span>
          <SortHeader label="Score" field="score" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={52} align="right" />
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
          // Selection mode: while ANY rows are selected, a row click toggles
          // that row (Gmail-style) instead of navigating — navigation unmounts
          // this component and would silently drop the whole selection.
          const openRow = () => {
            if (selected.size > 0) toggleOne(p.id);
            else openLead(p.id);
          };
          return (
            <div key={p.id} className="av2-row" data-selected={isSelected} role="button" tabIndex={0}
              onClick={openRow}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(); } }}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleOne(p.id); }}
                onKeyDown={(e) => e.stopPropagation()}
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
              <span style={{ width: 130, flex: 'none', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                {/* Chip cluster shared with the mobile card — see OutcomeChips. */}
                <OutcomeChips p={p} held={held} />
              </span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.campaign && (
                  <span aria-hidden="true" style={{ width: 16, height: 16, flex: 'none', borderRadius: 5, background: p.draw ? 'var(--hold-soft)' : 'var(--surface-2)', color: p.draw ? 'var(--hold)' : 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8 }}>◆</span>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.campaign?.name || '—'}</span>
              </span>
              <span style={{ width: 100, flex: 'none', fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.assignedAgent
                  ? `${p.assignedAgent.firstName || ''}`
                  : p.externalAgentId
                    ? <Chip tone="accent">External</Chip>
                    : held ? '—' : <Chip tone="warn">none</Chip>}
              </span>
              <LeadScoreCell value={p.score} scoredAt={p.scoreComputedAt} />
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

    </div>
  );
}
