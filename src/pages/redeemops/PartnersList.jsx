import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Plus from 'lucide-react/icons/plus';
import Upload from 'lucide-react/icons/upload';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { RoStageTag, RoAvatar, RoOwner, RoPageHeader, prettyEnum } from '@/components/redeemops/ui';

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* Minimal CSV parsing for the strict import template (handles quoted fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const IMPORT_TEMPLATE = 'name,category,phone,instagram,website,uen,email\n"Nail Bliss","Nail Salon","+6591234567","@nailbliss.sg","nailbliss.sg","202512345K","hello@nailbliss.sg"\n';
const IMPORT_COLUMNS = ['name', 'category', 'phone', 'instagram', 'website', 'uen', 'email'];

const EMPTY_FORM = {
  tradingName: '', legalName: '', category: '', primaryPhone: '', primaryEmail: '',
  website: '', instagramHandle: '', uen: '', notes: '',
};

export default function PartnersList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const [owner, setOwner] = useState('all');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  const constants = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });

  const params = {
    page, limit: 25,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(stage !== 'all' ? { stage } : {}),
    ...(owner !== 'all' ? { owner } : {}),
  };
  const listQuery = useQuery({
    queryKey: ['redeem-ops', 'partners', params],
    queryFn: () => redeemOpsApi.listPartners(params),
    placeholderData: keepPreviousData,
  });

  // ── Duplicate-aware create flow ────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [duplicates, setDuplicates] = useState(null); // null = not checked yet
  const [overrideReason, setOverrideReason] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const createMutation = useMutation({
    mutationFn: (body) => redeemOpsApi.createPartner(body),
    onSuccess: (data) => {
      toast.success('Business added');
      setCreateOpen(false);
      setForm(EMPTY_FORM); setDuplicates(null); setOverrideReason('');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
      if (data?.partner?.id) navigate(`/redeem-ops/partners/${data.partner.id}`);
    },
    onError: (err) => {
      if (err.status === 409 && err.data?.duplicates) {
        setDuplicates(err.data.duplicates);
        toast.warning('Possible duplicate found', { description: 'Review the matches below.' });
      } else {
        toast.error('Could not add business', { description: err.message });
      }
    },
  });

  const handleCreate = async () => {
    if (!form.tradingName.trim()) {
      toast.error('Business name is required');
      return;
    }
    // Pre-check so the user sees matches BEFORE submitting (server re-checks anyway)
    if (duplicates === null) {
      const found = await redeemOpsApi.checkDuplicates(form).catch(() => ({ exact: [], potential: [] }));
      if (found.exact.length > 0 || found.potential.length > 0) {
        setDuplicates(found);
        return;
      }
    }
    createMutation.mutate({
      ...form,
      ...(duplicates?.exact?.length ? { overrideReason } : {}),
    });
  };

  // ── CSV import: strict template, row-by-row through the same dedupe-gated
  // create endpoint (exact duplicates are skipped and counted, every created
  // row is audited like a manual add). Client-side on purpose — no new
  // backend surface, works for the list sizes a 3-person team imports.
  const user = useAuthStore((st) => st.user);
  const canImport = hasCapability(user, 'partners.import');
  const [importOpen, setImportOpen] = useState(false);
  const [importState, setImportState] = useState(null); // null | {running, done, total, created, skipped, failed, errors[]}

  const runImport = async (file) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) { toast.error('CSV has no data rows'); return; }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)]));
    if (idx.name === -1) { toast.error('CSV must have a "name" column — download the template'); return; }
    const dataRows = rows.slice(1).slice(0, 500);
    const state = { running: true, done: 0, total: dataRows.length, created: 0, skipped: 0, failed: 0, errors: [] };
    setImportState({ ...state });
    const bodies = [];
    for (const row of dataRows) {
      const cell = (k) => (idx[k] >= 0 ? String(row[idx[k]] || '').trim() : '');
      const body = {
        tradingName: cell('name'),
        category: cell('category'),
        primaryPhone: cell('phone'),
        instagramHandle: cell('instagram'),
        website: cell('website'),
        uen: cell('uen'),
        primaryEmail: cell('email'),
      };
      if (!body.tradingName) {
        state.failed += 1; state.done += 1;
        if (state.errors.length < 5) state.errors.push('Row with empty name skipped');
      } else bodies.push(body);
    }
    // Chunked bulk endpoint (100 rows/request) — a 500-row file is 5 requests,
    // far under the production rate limit, and each row is still dedupe-gated
    // and audited server-side.
    for (let i = 0; i < bodies.length; i += 100) {
      const chunk = bodies.slice(i, i + 100);
      try {
        const r = await redeemOpsApi.importPartners(chunk);
        state.created += r.created; state.skipped += r.skipped; state.failed += r.failed;
        for (const er of r.errors || []) if (state.errors.length < 5) state.errors.push(er);
      } catch (err) {
        state.failed += chunk.length;
        if (state.errors.length < 5) state.errors.push(`Chunk failed: ${err.message}`);
      }
      state.done += chunk.length;
      setImportState({ ...state });
    }
    state.running = false;
    setImportState({ ...state });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
  };

  const partners = listQuery.data?.partners || [];
  const pagination = listQuery.data?.pagination;
  const stages = constants.data?.pipelineStages || [];
  const needsOverride = (duplicates?.exact?.length || 0) > 0;

  const partnerName = (p) => p.tradingName || p.brandName || p.legalName;
  const partnerMeta = (p) => [p.category, p.instagramHandle && `@${p.instagramHandle}`, p.primaryPhone]
    .filter(Boolean).slice(0, 2).join(' · ');

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-5">
      <RoPageHeader
        title="Partners"
        sub={pagination ? `${pagination.total} business${pagination.total === 1 ? '' : 'es'} on the books — search before you add, claim before you contact.` : 'The shared business database — search before you add, claim before you contact.'}
        actions={(
          <>
            {canImport && (
              <Button variant="outline" onClick={() => { setImportOpen(true); setImportState(null); }}>
                <Upload className="w-4 h-4 mr-1.5" aria-hidden="true" /> Import CSV
              </Button>
            )}
            <Button onClick={() => { setCreateOpen(true); setDuplicates(null); }}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add business
            </Button>
          </>
        )}
      />

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="ro-search w-full max-w-xs"
          placeholder="Search name, phone, UEN or @handle"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select value={owner} onValueChange={(v) => { setOwner(v); setPage(1); }}>
          <SelectTrigger className="w-40 h-10"><SelectValue placeholder="Owner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any owner</SelectItem>
            <SelectItem value="me">My partners</SelectItem>
            <SelectItem value="none">Unowned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stage} onValueChange={(v) => { setStage(v); setPage(1); }}>
          <SelectTrigger className="w-48 h-10"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {stages.map((s) => <SelectItem key={s} value={s}>{prettyEnum(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left" style={{ color: 'var(--ro-text-2)' }}>
                <th className="font-semibold text-[12.5px] px-5 py-3">Business</th>
                <th className="font-semibold text-[12.5px] px-3 py-3">Category</th>
                <th className="font-semibold text-[12.5px] px-3 py-3">Stage</th>
                <th className="font-semibold text-[12.5px] px-3 py-3">Owner</th>
                <th className="font-semibold text-[12.5px] px-5 py-3 text-right">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-t border-border hover:bg-[var(--ro-subtle)] transition-colors"
                  onClick={() => navigate(`/redeem-ops/partners/${p.id}`)}
                >
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-3 min-w-0">
                      <RoAvatar name={partnerName(p)} size={36} />
                      <span className="min-w-0">
                        <span className="font-semibold flex items-center gap-1.5 leading-tight">
                          <span className="truncate">{partnerName(p)}</span>
                          {(p.atRiskFlag || p.staleFlag) && (
                            <AlertTriangle
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: 'var(--ro-tag-yellow-fg)' }}
                              aria-label={p.atRiskFlag ? 'At risk — no first outreach' : 'Stale'}
                            />
                          )}
                        </span>
                        <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>
                          {partnerMeta(p) || '—'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--ro-text-2)' }}>{p.category || '—'}</td>
                  <td className="px-3 py-2.5"><RoStageTag stage={p.pipelineStage} /></td>
                  <td className="px-3 py-2.5"><RoOwner name={p.owner?.fullName} /></td>
                  <td className="px-5 py-2.5 text-right text-[12.5px] tabular-nums" style={{ color: 'var(--ro-text-3)' }}>
                    {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
              {!listQuery.isLoading && partners.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={5} className="text-center py-12" style={{ color: 'var(--ro-text-2)' }}>
                    No businesses match. Add the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <span className="text-[13px]" style={{ color: 'var(--ro-text-2)' }}>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} businesses
            </span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </span>
          </div>
        )}
      </div>

      <Dialog open={importOpen} onOpenChange={(open) => { if (!open && !importState?.running) { setImportOpen(false); setImportState(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import businesses from CSV</DialogTitle>
            <DialogDescription>
              Columns: name (required), category, phone (+65…), instagram, website, uen, email.
              Exact duplicates are skipped automatically; every created row is audited.{' '}
              <a
                className="ro-link"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`}
                download="redeem-ops-import-template.csv"
              >
                Download template
              </a>
            </DialogDescription>
          </DialogHeader>
          {!importState && (
            <div className="py-2">
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) runImport(f); }}
              />
              <p className="text-xs mt-2 m-0" style={{ color: 'var(--ro-text-3)' }}>Up to 500 rows per file.</p>
            </div>
          )}
          {importState && (
            <div className="py-2 space-y-2">
              <div className="ro-progress"><i style={{ width: `${importState.total ? Math.round((importState.done / importState.total) * 100) : 0}%` }} /></div>
              <p className="text-sm m-0">
                {importState.running ? `Importing ${importState.done} of ${importState.total}…` : 'Done.'}{' '}
                <b>{importState.created}</b> created · <b>{importState.skipped}</b> duplicates skipped · <b>{importState.failed}</b> failed
              </p>
              {importState.errors.length > 0 && (
                <ul className="text-xs m-0 pl-4" style={{ color: 'var(--ro-tag-red-fg)' }}>
                  {importState.errors.map((er) => <li key={er}>{er}</li>)}
                </ul>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) { setDuplicates(null); setOverrideReason(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add business</DialogTitle>
            <DialogDescription>
              The system checks for duplicates before creating — one business, one owner.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Business name *</Label>
              <Input value={form.tradingName} onChange={set('tradingName')} placeholder="Nail Bliss" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={form.category} onChange={set('category')} placeholder="Nail Salon" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone (+65…)</Label>
              <Input value={form.primaryPhone} onChange={set('primaryPhone')} placeholder="+6591234567" />
            </div>
            <div className="space-y-1.5">
              <Label>Instagram</Label>
              <Input value={form.instagramHandle} onChange={set('instagramHandle')} placeholder="@nailbliss.sg" />
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={form.website} onChange={set('website')} placeholder="nailbliss.sg" />
            </div>
            <div className="space-y-1.5">
              <Label>UEN</Label>
              <Input value={form.uen} onChange={set('uen')} placeholder="202507548M" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.primaryEmail} onChange={set('primaryEmail')} placeholder="hello@nailbliss.sg" />
            </div>
          </div>

          {duplicates && (duplicates.exact.length > 0 || duplicates.potential.length > 0) && (
            <div className="rounded-xl p-3.5 space-y-2 text-sm" style={{ background: 'var(--ro-tag-yellow-bg)' }}>
              <p className="font-semibold flex items-center gap-2 m-0" style={{ color: 'var(--ro-bunker)' }}>
                <AlertTriangle className="w-4 h-4" style={{ color: 'var(--ro-tag-yellow-fg)' }} aria-hidden="true" />
                {duplicates.exact.length > 0 ? 'This business may already exist' : 'Similar businesses found'}
              </p>
              {[...duplicates.exact, ...duplicates.potential].slice(0, 4).map((m) => (
                <div key={m.partner.id} className="flex items-center justify-between gap-2">
                  <span>
                    <Link
                      to={`/redeem-ops/partners/${m.partner.id}`}
                      className="ro-link"
                      onClick={() => setCreateOpen(false)}
                    >
                      {m.partner.tradingName || m.partner.legalName}
                    </Link>{' '}
                    <span style={{ color: 'var(--ro-text-2)' }}>
                      — {m.reason} · {prettyEnum(m.partner.pipelineStage)}
                      {m.partner.owner ? ` · owned by ${m.partner.owner.fullName}` : ' · unowned'}
                    </span>
                  </span>
                </div>
              ))}
              {needsOverride && (
                <div className="space-y-1.5 pt-1">
                  <Label>Reason to create anyway (required for exact matches)</Label>
                  <Input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. separate outlet with different owner"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || (needsOverride && !overrideReason.trim())}
            >
              {createMutation.isPending
                ? 'Saving…'
                : duplicates === null
                  ? 'Check & create'
                  : needsOverride ? 'Create anyway' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
