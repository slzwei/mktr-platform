import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ScanLine from 'lucide-react/icons/scan-line';
import { RoMobileCard, RoPageHeader, RoTag, prettyEnum } from '@/components/redeemops/ui';

/** Per-row delivery truth from the receipts the backend now records. */
function deliveryStatus(e) {
  const em = e.delivery?.email;
  if (em) {
    const noun = em.kind === 'voucher' ? 'Voucher' : 'Pass';
    if (em.ok) {
      const at = new Date(em.at).toLocaleString('en-SG', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      });
      return { text: `${noun} emailed · ${at}`, tone: 'ok' };
    }
    return { text: `${noun} email failed — resend or share a link`, tone: 'warn' };
  }
  if (e.emailDeliverable === false) return { text: 'Never emailed — share a link instead', tone: 'warn' };
  if (['eligible', 'issued'].includes(e.status)) return { text: 'Not delivered yet', tone: 'muted' };
  return null;
}

export default function RedemptionsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const canIssueManual = hasCapability(user, 'entitlements.issue_manual');
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null);
  // { entitlement, mode: 'email'|'link', phase: 'confirm'|'result', result }
  const [shareDialog, setShareDialog] = useState(null);

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
      // Truthful toast: only claim an email went out when one was queued.
      toast.success(
        data?.already
          ? 'Already unlocked'
          : data?.emailQueued
            ? 'Voucher unlocked — email with QR sent to the customer'
            : 'Voucher unlocked — no email on file; use Copy link to share the voucher'
      );
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
    },
    onError: (err) => toast.error('Unlock failed', { description: err.message }),
  });

  const resendMutation = useMutation({
    mutationFn: ({ id, channel }) => redeemOpsApi.resendEntitlementPass(id, { channel }),
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
      if (vars.channel === 'email') {
        toast.success(res?.message || 'New pass emailed');
        setShareDialog(null);
      } else {
        // Show the one-time link bundle — it is not retrievable later.
        setShareDialog((d) => (d ? { ...d, phase: 'result', result: res?.data } : d));
      }
    },
    onError: (err) => toast.error('Could not re-mint', { description: err.message }),
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

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed — select the text and copy manually');
    }
  };

  const dialogIsVoucher = shareDialog?.entitlement?.status === 'issued';

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
            Every captured lead's reward, from locked reservation to redeemed voucher — with
            whether the customer actually received it.
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
            {(entitlementsQuery.data?.entitlements || []).map((e) => {
              const delivery = deliveryStatus(e);
              const canShare = canIssueManual && ['eligible', 'issued'].includes(e.status);
              const unlockButton = isAdmin && e.status === 'eligible' && e.prospect?.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unlockMutation.isPending}
                  onClick={() => unlockMutation.mutate(e.prospect.id)}
                >
                  Unlock
                </Button>
              ) : null;
              return (
                <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 border-t border-border first:border-t-0">
                  <div className="min-w-0 flex-1 basis-52">
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
                    {delivery && (
                      <p
                        className="text-[11px] m-0 truncate"
                        style={{ color: delivery.tone === 'warn' ? '#B45309' : 'var(--ro-text-3)' }}
                      >
                        {delivery.tone === 'warn' ? '⚠ ' : ''}{delivery.text}
                      </p>
                    )}
                  </div>
                  <span className="flex items-center gap-1.5 flex-none">
                    {e.emailDeliverable === false && ['eligible', 'issued'].includes(e.status) && (
                      <RoTag tone="medium" size="sm">No email</RoTag>
                    )}
                    <RoTag tone={e.status} size="sm">{prettyEnum(e.status)}</RoTag>
                  </span>
                  {canShare ? (
                    <span className="flex items-center gap-1.5 flex-none">
                      {e.emailDeliverable !== false && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resendMutation.isPending}
                          onClick={() => setShareDialog({ entitlement: e, mode: 'email', phase: 'confirm' })}
                        >
                          {e.status === 'issued' ? 'Resend voucher' : 'Resend pass'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resendMutation.isPending}
                        onClick={() => setShareDialog({ entitlement: e, mode: 'link', phase: 'confirm' })}
                      >
                        Copy link
                      </Button>
                      {unlockButton}
                    </span>
                  ) : unlockButton}
                </div>
              );
            })}
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

      {/* Resend / share — explicit confirm BEFORE rotating (opening this dialog
          must never kill the customer's existing QR by itself). */}
      <Dialog open={!!shareDialog} onOpenChange={(open) => { if (!open) setShareDialog(null); }}>
        <DialogContent>
          {shareDialog?.phase === 'confirm' && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {shareDialog.mode === 'email'
                    ? (dialogIsVoucher ? 'Resend voucher email?' : 'Resend pass email?')
                    : 'Create a new share link?'}
                </DialogTitle>
                <DialogDescription>
                  This mints a fresh QR/link for{' '}
                  {[shareDialog.entitlement?.prospect?.firstName, shareDialog.entitlement?.prospect?.lastName]
                    .filter(Boolean).join(' ') || 'the customer'}
                  {' — the previous '}
                  {dialogIsVoucher ? 'voucher code/QR' : 'pass QR/link'}
                  {' stops working immediately.'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShareDialog(null)}>Cancel</Button>
                <Button
                  disabled={resendMutation.isPending}
                  onClick={() => resendMutation.mutate({ id: shareDialog.entitlement.id, channel: shareDialog.mode })}
                >
                  {resendMutation.isPending
                    ? 'Working…'
                    : shareDialog.mode === 'email' ? 'Resend email' : 'Create new link'}
                </Button>
              </DialogFooter>
            </>
          )}
          {shareDialog?.phase === 'result' && shareDialog.result && (
            <>
              <DialogHeader>
                <DialogTitle>New link ready — shown once</DialogTitle>
                <DialogDescription>
                  The previous {dialogIsVoucher ? 'voucher code/QR' : 'pass QR/link'} no longer works.
                  Share this with the customer now; it cannot be retrieved again (only re-minted).
                </DialogDescription>
              </DialogHeader>
              <p className="font-mono text-xs break-all rounded-md border border-border p-2.5 m-0 select-all">
                {shareDialog.result.link}
              </p>
              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => copyText(shareDialog.result.link, 'Link')}>
                  Copy link
                </Button>
                <Button variant="outline" onClick={() => copyText(shareDialog.result.waMessage, 'Message')}>
                  Copy message
                </Button>
                {shareDialog.result.waUrl && (
                  <Button asChild>
                    <a href={shareDialog.result.waUrl} target="_blank" rel="noreferrer">Open in WhatsApp</a>
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
