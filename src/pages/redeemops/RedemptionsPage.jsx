import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ScanLine from 'lucide-react/icons/scan-line';
import { RoPageHeader, RoTag, prettyEnum } from '@/components/redeemops/ui';

export default function RedemptionsPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null);

  const historyQuery = useQuery({
    queryKey: ['redeem-ops', 'redemptions'],
    queryFn: () => redeemOpsApi.listRedemptions(),
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
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-5">
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
          <CardTitle className="text-base">Recent redemptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
