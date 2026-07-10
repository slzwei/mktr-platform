import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ScanLine from 'lucide-react/icons/scan-line';
import { RoMobileCard, RoPageHeader, RoTag, prettyEnum } from '@/components/redeemops/ui';

export default function RedemptionsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null);

  const historyQuery = useQuery({
    queryKey: ['redeem-ops', 'redemptions'],
    queryFn: () => redeemOpsApi.listRedemptions(),
  });
  const [resSearch, setResSearch] = useState('');
  const entitlementsQuery = useQuery({
    queryKey: ['redeem-ops', 'entitlements', resSearch],
    queryFn: () => redeemOpsApi.listEntitlements({ limit: 15, ...(resSearch.trim() ? { search: resSearch.trim() } : {}) }),
  });

  const unlockMutation = useMutation({
    mutationFn: (prospectId) => redeemOpsApi.unlockEntitlement({ prospectId }),
    onSuccess: (data) => {
      toast.success(data?.already ? 'Already unlocked' : 'Voucher unlocked — email with QR sent to the customer');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
    },
    onError: (err) => toast.error('Unlock failed', { description: err.message }),
  });

  const verifyMutation = useMutation({
    mutationFn: () => redeemOpsApi.verifyVoucher(token.trim()),
    onSuccess: (data) => setVerified(data),
    onError: (err) => {
      setVerified(null);
      toast.error('Verification failed', { description: err.message });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => redeemOpsApi.completeRedemption(token.trim()),
    onSuccess: (data) => {
      toast.success(data?.already ? 'Already redeemed' : 'Redeemed ✔');
      setVerified(null); setToken('');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'redemptions'] });
    },
    onError: (err) => toast.error('Redemption failed', { description: err.message }),
  });

  const redemptions = historyQuery.data?.redemptions || [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <RoPageHeader
        title="Redemptions"
        sub="Verify a voucher, confirm identity, redeem — double redemption is impossible."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="w-4 h-4" aria-hidden="true" /> Verify a voucher
          </CardTitle>
          <CardDescription>Paste the scanned QR value or the full voucher code.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={token}
              onChange={(e) => { setToken(e.target.value); setVerified(null); }}
              placeholder="Voucher code…"
              className="font-mono"
            />
            <Button disabled={!token.trim() || verifyMutation.isPending} onClick={() => verifyMutation.mutate()}>
              {verifyMutation.isPending ? 'Checking…' : 'Verify'}
            </Button>
          </div>

          {verified && (
            <div
              className="rounded-xl p-4 space-y-2"
              style={{ background: verified.valid ? 'var(--ro-tag-green-bg)' : 'var(--ro-tag-red-bg)' }}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold m-0">{verified.reward?.title}</p>
                <RoTag tone={verified.valid ? 'redeemed' : 'void'}>
                  {verified.valid ? 'Valid' : prettyEnum(verified.state)}
                </RoTag>
              </div>
              {verified.holder && (
                <p className="text-sm text-muted-foreground">
                  Holder: {[verified.holder.firstName, verified.holder.lastName].filter(Boolean).join(' ')}
                  {verified.holder.phone ? ` · ${verified.holder.phone}` : ''}
                </p>
              )}
              {verified.reward?.expiresAt && (
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(verified.reward.expiresAt).toLocaleDateString()}
                </p>
              )}
              {verified.valid && (
                <Button
                  size="sm"
                  disabled={completeMutation.isPending}
                  onClick={() => completeMutation.mutate()}
                >
                  {completeMutation.isPending ? 'Redeeming…' : 'Confirm redemption'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reservations &amp; vouchers</CardTitle>
          <CardDescription>
            Every captured lead's reward, from locked reservation to redeemed voucher.
            {isAdmin ? ' As admin you can unlock a reservation manually (audited) — normally the assigned consultant does this at the meeting.' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            className="ro-search w-full max-w-xs mb-3"
            placeholder="Search holder name or phone"
            value={resSearch}
            onChange={(e) => setResSearch(e.target.value)}
          />
          <div className="space-y-0">
            {(entitlementsQuery.data?.entitlements || []).map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2.5 border-t border-border first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold m-0 truncate">
                    {[e.prospect?.firstName, e.prospect?.lastName].filter(Boolean).join(' ') || 'Customer'}
                    <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}>
                      {e.prospect?.phone ? ` · ${e.prospect.phone}` : ''}
                    </span>
                  </p>
                  <p className="text-xs m-0 truncate" style={{ color: 'var(--ro-text-2)' }}>
                    {e.rewardOffer?.title || '—'}
                    {e.activation?.campaignNameSnapshot ? ` · ${e.activation.campaignNameSnapshot}` : ''}
                    {e.tokenHint ? ` · code …${e.tokenHint}` : ''}
                  </p>
                </div>
                <RoTag tone={e.status} size="sm">{prettyEnum(e.status)}</RoTag>
                {isAdmin && e.status === 'eligible' && e.prospect?.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unlockMutation.isPending}
                    onClick={() => unlockMutation.mutate(e.prospect.id)}
                  >
                    Unlock
                  </Button>
                )}
              </div>
            ))}
            {!entitlementsQuery.isLoading && (entitlementsQuery.data?.entitlements || []).length === 0 && (
              <p className="text-sm text-center py-6 m-0" style={{ color: 'var(--ro-text-2)' }}>
                No reservations yet — they appear when customers sign up on an active activation's campaign.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent redemptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="md:hidden -mx-6">
            {redemptions.map((r) => (
              <RoMobileCard key={r.id} className="px-6">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] leading-tight">{r.rewardOffer?.title || '—'}</span>
                    <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                      {r.partner?.tradingName || r.partner?.legalName || '—'}
                    </span>
                    <span className="block text-[11px] truncate mt-0.5" style={{ color: 'var(--ro-text-3)' }}>
                      {new Date(r.redeemedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                      {', '}
                      {new Date(r.redeemedAt).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })}
                      {' · '}
                      {r.actor?.fullName || r.actorType}
                    </span>
                  </span>
                  <RoTag tone={r.status === 'completed' ? 'completed' : 'void'} size="sm">{prettyEnum(r.status)}</RoTag>
                </span>
              </RoMobileCard>
            ))}
            {!historyQuery.isLoading && redemptions.length === 0 && (
              <p className="text-sm text-center py-8 m-0" style={{ color: 'var(--ro-text-2)' }}>No redemptions yet.</p>
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reward</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {redemptions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.rewardOffer?.title || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{r.partner?.tradingName || r.partner?.legalName || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(r.redeemedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{r.actor?.fullName || r.actorType}</TableCell>
                    <TableCell>
                      <RoTag tone={r.status === 'completed' ? 'completed' : 'void'} size="sm">{prettyEnum(r.status)}</RoTag>
                    </TableCell>
                  </TableRow>
                ))}
                {!historyQuery.isLoading && redemptions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      No redemptions yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
