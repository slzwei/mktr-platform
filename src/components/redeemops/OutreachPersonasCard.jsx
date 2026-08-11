import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RoTag } from '@/components/redeemops/ui';

export const EMAIL_AUTOSEND_ENABLED = import.meta.env.VITE_REDEEM_OPS_EMAIL_AUTOSEND_ENABLED === 'true';

const ACCOUNT_KEY = ['redeem-ops', 'outreach-account'];
const PERSONAS_KEY = ['redeem-ops', 'outreach-personas'];

/**
 * Settings → Outreach personas (email auto-send Phase A, plan §7): connect the
 * Workspace account, import sending aliases FROM THE LIVE DIRECTORY (nobody
 * types an address — plan §2a), tie who-is-who, verify send-as health, test
 * send. Phase A never emails a prospect: test sends go to the account's own
 * inbox.
 */
export default function OutreachPersonasCard() {
  const queryClient = useQueryClient();
  const [setupOpen, setSetupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState('business@mktr.sg');
  const [keyJson, setKeyJson] = useState('');
  const [picked, setPicked] = useState({});

  const accountQuery = useQuery({ queryKey: ACCOUNT_KEY, queryFn: () => redeemOpsApi.getOutreachAccount() });
  const personasQuery = useQuery({ queryKey: PERSONAS_KEY, queryFn: () => redeemOpsApi.listOutreachPersonas() });
  const teamQuery = useQuery({ queryKey: ['redeem-ops', 'team'], queryFn: () => redeemOpsApi.getTeam() });
  const addressesQuery = useQuery({
    queryKey: ['redeem-ops', 'workspace-addresses'],
    queryFn: () => redeemOpsApi.listWorkspaceAddresses(),
    enabled: importOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
    queryClient.invalidateQueries({ queryKey: PERSONAS_KEY });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'workspace-addresses'] });
  };
  const onError = (title) => (err) => toast.error(title, { description: err.message });

  const setupMutation = useMutation({
    mutationFn: () => redeemOpsApi.setupOutreachAccount({ accountEmail: accountEmail.trim(), serviceAccountJson: keyJson }),
    onSuccess: (data) => {
      setSetupOpen(false);
      setKeyJson('');
      if (data?.health?.error) {
        toast.warning('Key saved — but the health check failed', { description: data.health.error, duration: 10000 });
      } else {
        toast.success('Workspace account connected', {
          description: `${data?.health?.aliasCount ?? 0} aliases visible on ${accountEmail.trim()}`,
        });
      }
      invalidate();
    },
    onError: onError('Could not connect the account'),
  });
  const healthMutation = useMutation({
    mutationFn: () => redeemOpsApi.refreshOutreachHealth(),
    onSuccess: (h) => {
      toast.success('Health check passed', {
        description: `${h.aliasCount} aliases · ${h.sendAsCount} send-as identities on ${h.accountEmail}`,
      });
      invalidate();
    },
    onError: onError('Health check failed'),
  });
  const importMutation = useMutation({
    mutationFn: () => redeemOpsApi.importOutreachPersonas(Object.keys(picked).filter((a) => picked[a])),
    onSuccess: (data) => {
      setImportOpen(false);
      setPicked({});
      const rejected = data?.rejected || [];
      toast.success(`Imported ${data?.created?.length || 0} persona${(data?.created?.length || 0) === 1 ? '' : 's'}`, {
        description: rejected.length ? `${rejected.length} skipped (${rejected.map((r) => r.reason).join(', ')})` : undefined,
      });
      invalidate();
    },
    onError: onError('Import failed'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => redeemOpsApi.updateOutreachPersona(id, body),
    onSuccess: () => invalidate(),
    onError: onError('Could not update the persona'),
  });
  const testMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.testSendOutreachPersona(id),
    onSuccess: (r) => {
      toast.success('Test email sent to the shared inbox', {
        description: r.mintedPreserved === false
          ? 'Note: Gmail rewrote our Message-ID (expected — the sender is designed for it).'
          : 'Check the shared mailbox for the test message.',
        duration: 8000,
      });
    },
    onError: onError('Test send failed'),
  });

  const account = accountQuery.data;
  const personas = personasQuery.data || [];
  const team = teamQuery.data || [];
  const takenUserIds = new Set(personas.map((p) => p.assignedUserId).filter(Boolean));

  const personaStatus = (p) => {
    if (!p.isActive) return { tone: 'paused', label: 'inactive' };
    if (!p.isAccountAlias) return { tone: 'lost', label: 'not an alias' };
    if (!p.sendAsVerified) return { tone: 'paused', label: 'send-as pending' };
    if (!p.assignedUserId) return { tone: 'paused', label: 'no rep' };
    return { tone: 'open', label: 'ready' };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outreach personas</CardTitle>
        <CardDescription>
          Which Workspace alias each rep sends outreach email as. Addresses come from the live
          Google directory — nothing is typed by hand. Auto-sending itself ships in a later
          phase; this card only sets up and verifies identities.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!account?.configured ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
              No Workspace account connected yet.
            </p>
            <Button size="sm" onClick={() => setSetupOpen(true)}>Connect account</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
              <p className="text-sm font-semibold m-0">{account.accountEmail}</p>
              {account.encryptionReady === false && (
                <RoTag tone="lost" size="sm">encryption key missing</RoTag>
              )}
              {account.lastError
                ? <RoTag tone="lost" size="sm">health error</RoTag>
                : account.lastHealthCheckAt && <RoTag tone="open" size="sm">healthy</RoTag>}
              <span className="text-xs" style={{ color: 'var(--ro-text-3)' }}>
                {account.lastHealthCheckAt
                  ? `checked ${new Date(account.lastHealthCheckAt).toLocaleString()}`
                  : 'never checked'}
              </span>
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="outline" disabled={healthMutation.isPending} onClick={() => healthMutation.mutate()}>
                  {healthMutation.isPending ? 'Checking…' : 'Refresh health'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>Replace key</Button>
                <Button size="sm" onClick={() => setImportOpen(true)}>Import from Workspace</Button>
              </span>
            </div>
            {account.lastError && (
              <p className="text-xs mb-3 mt-0 leading-relaxed" style={{ color: 'var(--ro-tag-red-fg, #BD3A2E)' }}>
                {account.lastError}
              </p>
            )}

            {personas.length === 0 ? (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
                No personas yet — import the redeem.sg aliases from Workspace.
              </p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border">
                {personas.map((p) => {
                  const st = personaStatus(p);
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold m-0 truncate">{p.address}</p>
                        <p className="text-xs m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-3)' }}>
                          From: “{p.displayName}” · cap {p.dailySendCap}/day
                        </p>
                      </div>
                      <RoTag tone={st.tone} size="sm">{st.label}</RoTag>
                      {/* Native select keeps the row compact; server enforces
                          the one-persona-per-rep rule and 409s duplicates. */}
                      <select
                        aria-label={`Rep for ${p.address}`}
                        className="h-8 rounded-md border border-border bg-white px-2 text-xs"
                        value={p.assignedUserId || ''}
                        onChange={(e) => updateMutation.mutate({
                          id: p.id, body: { assignedUserId: e.target.value || null },
                        })}
                      >
                        <option value="">Unassigned</option>
                        {team.map((u) => (
                          <option key={u.id} value={u.id} disabled={takenUserIds.has(u.id) && p.assignedUserId !== u.id}>
                            {u.fullName || u.email}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={testMutation.isPending}
                        onClick={() => testMutation.mutate(p.id)}
                      >
                        Test send
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* ── Connect / replace key ── */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect the Workspace account</DialogTitle>
            <DialogDescription>
              Paste the Google service-account key (JSON file). It is encrypted on the server and
              never shown again. The account email is the mailbox the platform impersonates —
              domain-wide delegation for its client ID must be granted in admin.google.com first.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={accountEmail}
            onChange={(e) => setAccountEmail(e.target.value)}
            placeholder="business@mktr.sg"
            aria-label="Account email"
          />
          <textarea
            value={keyJson}
            onChange={(e) => setKeyJson(e.target.value)}
            placeholder='{"type": "service_account", "client_email": …}'
            aria-label="Service account key JSON"
            rows={6}
            className="w-full rounded-md border border-border bg-white p-2 font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupOpen(false)}>Back</Button>
            <Button
              disabled={setupMutation.isPending || !keyJson.trim() || !accountEmail.trim()}
              onClick={() => setupMutation.mutate()}
            >
              {setupMutation.isPending ? 'Connecting…' : 'Connect & check'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import from Workspace ── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import personas from Workspace</DialogTitle>
            <DialogDescription>
              Only aliases of {account?.accountEmail || 'the connected account'} are listed —
              an address owned by another account would swallow its own replies, so it can’t be
              a persona.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {addressesQuery.isLoading && (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>Reading the directory…</p>
            )}
            {addressesQuery.isError && (
              <p className="text-sm m-0" style={{ color: 'var(--ro-tag-red-fg, #BD3A2E)' }}>
                {addressesQuery.error?.message}
              </p>
            )}
            {(addressesQuery.data?.accountAliases || []).map((a) => (
              <label key={a.address} className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox
                  checked={!!picked[a.address]}
                  disabled={!a.importable}
                  onCheckedChange={(v) => setPicked((prev) => ({ ...prev, [a.address]: !!v }))}
                />
                <span className={a.importable ? '' : 'opacity-50'}>
                  {a.address}{!a.importable && ' — already imported'}
                </span>
              </label>
            ))}
            {addressesQuery.data && (addressesQuery.data.accountAliases || []).length === 0 && (
              <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
                No aliases on {addressesQuery.data.accountEmail} — create them in Admin console first.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Back</Button>
            <Button
              disabled={importMutation.isPending || Object.values(picked).every((v) => !v)}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending ? 'Importing…' : 'Import selected'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
