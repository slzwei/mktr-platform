import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/alert-triangle';

const STAGE_BADGE = {
  PARTNERED: 'default',
  DISQUALIFIED: 'destructive',
  NOT_INTERESTED: 'destructive',
};

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

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

  const partners = listQuery.data?.partners || [];
  const pagination = listQuery.data?.pagination;
  const stages = constants.data?.pipelineStages || [];
  const needsOverride = (duplicates?.exact?.length || 0) > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The shared business database — search before you add, claim before you contact.
          </p>
        </div>
        <Button size="sm" onClick={() => { setCreateOpen(true); setDuplicates(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Add business
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search name, phone, UEN, @handle, domain…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-sm"
        />
        <Select value={stage} onValueChange={(v) => { setStage(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {stages.map((s) => <SelectItem key={s} value={s}>{s.replaceAll('_', ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={owner} onValueChange={(v) => { setOwner(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Owner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any owner</SelectItem>
            <SelectItem value="me">My partners</SelectItem>
            <SelectItem value="none">Unowned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/redeem-ops/partners/${p.id}`)}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {p.tradingName || p.brandName || p.legalName}
                        {(p.atRiskFlag || p.staleFlag) && (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label={p.atRiskFlag ? 'At risk — no first outreach' : 'Stale'} />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.category || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={STAGE_BADGE[p.pipelineStage] || 'secondary'}>
                        {p.pipelineStage.replaceAll('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.owner?.fullName || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                  </TableRow>
                ))}
                {!listQuery.isLoading && partners.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      No businesses match. Add the first one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-3">
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} businesses
              </span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>

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
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2 text-sm">
              <p className="font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
                {duplicates.exact.length > 0 ? 'This business may already exist' : 'Similar businesses found'}
              </p>
              {[...duplicates.exact, ...duplicates.potential].slice(0, 4).map((m) => (
                <div key={m.partner.id} className="flex items-center justify-between gap-2">
                  <span>
                    <Link
                      to={`/redeem-ops/partners/${m.partner.id}`}
                      className="underline font-medium"
                      onClick={() => setCreateOpen(false)}
                    >
                      {m.partner.tradingName || m.partner.legalName}
                    </Link>{' '}
                    <span className="text-muted-foreground">
                      — {m.reason} · {m.partner.pipelineStage.replaceAll('_', ' ')}
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
