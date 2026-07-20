import { useCallback, useMemo, useRef, useState } from 'react';
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import ScanLine from 'lucide-react/icons/scan-line';
import ChevronDown from 'lucide-react/icons/chevron-down';
import { RoMobileCard, RoPageHeader, RoTag, prettyEnum } from '@/components/redeemops/ui';
import QrScannerDialog from '@/components/redeemops/QrScannerDialog';

/**
 * A scanned reward QR is one of two shapes:
 *  - a reservation-pass LINK ending in /r/<presentationToken> → activate (unlock)
 *  - a bare voucher token → verify → redeem
 * Returns { kind: 'pass'|'voucher', value } or null when it isn't a reward code.
 */
function parseRewardQr(raw) {
  const s = String(raw || '').trim();
  // Require a known reward host — a foreign `.../r/<token>` URL must not be
  // treated as an activation pass (Codex review).
  const passMatch = s.match(/(?:https?:\/\/)?(?:www\.)?(?:redeem|mktr)\.sg\/r\/([A-Za-z0-9_-]{12,128})\/?$/i);
  if (passMatch) return { kind: 'pass', value: passMatch[1] };
  if (/^[A-Za-z0-9_-]{12,128}$/.test(s)) return { kind: 'voucher', value: s };
  return null;
}

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

/* Deterministic accent per campaign — the stack header dot and the Recent
   redemptions dot stay in sync because both hash the activation id. */
const CAMPAIGN_ACCENTS = ['#0364D3', '#6A3FD1', '#8F6400', '#177239', '#BD3A2E', '#0E7490'];
function campaignAccent(key) {
  let hash = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CAMPAIGN_ACCENTS[hash % CAMPAIGN_ACCENTS.length];
}

/* cancelled/expired collapse behind a per-stack "Show closed" link. */
const CLOSED_STATUSES = ['cancelled', 'expired'];
const STATUS_FILTERS = ['eligible', 'issued', 'redeemed', 'expired', 'cancelled'];
// "Reserved" is the ops wording for the locked eligible state.
const statusLabel = (s) => (s === 'eligible' ? 'Reserved' : prettyEnum(s));
const statusTone = (s) => (s === 'eligible' ? 'reserved' : s);

function CampaignDot({ id, size = 8 }) {
  return (
    <span
      aria-hidden="true"
      className="rounded-full flex-none inline-block"
      style={{ width: size, height: size, background: campaignAccent(id) }}
    />
  );
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
  // { entitlement } — voids the reward; requires a reason (audited server-side).
  const [cancelDialog, setCancelDialog] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  // { entitlement } — voids a REDEEMED reward by reversing its redemption
  // (terminal) so the one-live-reward-per-phone slot frees. Reason required.
  const [voidDialog, setVoidDialog] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const canOverrideRedemption = hasCapability(user, 'redemptions.override');
  const [scanOpen, setScanOpen] = useState(false);
  // presentationToken pending an explicit "Activate" confirm after a pass scan.
  const [activateToken, setActivateToken] = useState(null);
  const pasteRef = useRef(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [closedShown, setClosedShown] = useState(() => new Set());

  const historyQuery = useQuery({
    queryKey: ['redeem-ops', 'redemptions'],
    queryFn: () => redeemOpsApi.listRedemptions(),
  });
  const [resSearch, setResSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const entitlementsQuery = useQuery({
    queryKey: ['redeem-ops', 'entitlements', resSearch, statusFilter],
    queryFn: () => redeemOpsApi.listEntitlements({
      limit: 100,
      ...(resSearch.trim() ? { search: resSearch.trim() } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    }),
  });

  const unlockMutation = useMutation({
    // body is { prospectId } (row button) or { presentationToken } (pass scan).
    mutationFn: (body) => redeemOpsApi.unlockEntitlement(body),
    onSuccess: (data) => {
      // Truthful toast: only claim an email went out when one was queued.
      toast.success(
        data?.already
          ? 'Already unlocked'
          : data?.emailQueued
            ? 'Voucher unlocked — email with QR sent to the customer'
            : 'Voucher unlocked — no email on file; use Copy link to share the voucher'
      );
      setActivateToken(null);
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
    },
    onError: (err) => toast.error('Unlock failed', { description: err.message }),
  });

  const resendMutation = useMutation({
    mutationFn: ({ id, channel }) => redeemOpsApi.resendEntitlementPass(id, { channel }),
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
      if (vars.channel === 'email' || vars.channel === 'whatsapp' || vars.channel === 'both') {
        // These re-queue a fire-and-forget send (no one-time link to show).
        const fallback = vars.channel === 'both' ? 'Re-sent on email + WhatsApp'
          : vars.channel === 'whatsapp' ? 'Re-sent on WhatsApp' : 'New pass emailed';
        toast.success(res?.message || fallback);
        setShareDialog(null);
      } else {
        // Show the one-time link bundle — it is not retrievable later.
        setShareDialog((d) => (d ? { ...d, phase: 'result', result: res?.data } : d));
      }
    },
    onError: (err) => toast.error('Could not re-mint', { description: err.message }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }) => redeemOpsApi.cancelEntitlement(id, { reason }),
    onSuccess: () => {
      toast.success('Reward cancelled — inventory returned, the phone can earn a new one');
      setCancelDialog(null);
      setCancelReason('');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
    },
    onError: (err) => toast.error('Cancel failed', { description: err.message }),
  });

  const voidMutation = useMutation({
    mutationFn: ({ redemptionId, reason }) => redeemOpsApi.reverseRedemption(redemptionId, { reason }),
    onSuccess: () => {
      toast.success('Redemption voided — the reward is cancelled and the phone can earn a new one');
      setVoidDialog(null);
      setVoidReason('');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'entitlements'] });
    },
    onError: (err) => toast.error('Void failed', { description: err.message }),
  });

  const verifyMutation = useMutation({
    // Always pass the token explicitly (the field or a scan) — never read it
    // through a stale closure.
    mutationFn: (t) => redeemOpsApi.verifyVoucher(t.trim()),
    // Bind the result to the token that produced it, and drop a stale response
    // if the field changed while it was in flight — the irreversible redeem
    // must act on the reward SHOWN, never on whatever text is in the box now.
    onSuccess: (data, t) => {
      if (t.trim() === token.trim()) setVerified({ ...data, token: t.trim() });
    },
    onError: (err) => {
      setVerified(null);
      toast.error('Verification failed', { description: err.message });
    },
  });

  const completeMutation = useMutation({
    // Redeem the token the verified card is bound to, not the live field.
    mutationFn: () => redeemOpsApi.completeRedemption((verified?.token ?? token).trim()),
    onSuccess: (data) => {
      toast.success(data?.already ? 'Already redeemed' : 'Redeemed ✔');
      setVerified(null); setToken('');
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'redemptions'] });
    },
    onError: (err) => toast.error('Redemption failed', { description: err.message }),
  });

  const redemptions = historyQuery.data?.redemptions || [];
  const entitlements = useMemo(
    () => entitlementsQuery.data?.entitlements || [],
    [entitlementsQuery.data]
  );
  const pagination = entitlementsQuery.data?.pagination;

  // Campaign stacks: group rows by activation, newest-first by first appearance
  // (the API already sorts by createdAt DESC).
  const groups = useMemo(() => {
    const byId = new Map();
    for (const e of entitlements) {
      const key = e.activation?.id || 'none';
      if (!byId.has(key)) {
        byId.set(key, {
          key,
          name: e.activation?.campaignNameSnapshot || 'No campaign',
          partner: e.activation?.partner?.tradingName || e.activation?.partner?.legalName || '',
          open: [],
          closed: [],
        });
      }
      const g = byId.get(key);
      (CLOSED_STATUSES.includes(e.status) ? g.closed : g.open).push(e);
    }
    return [...byId.values()].map((g) => ({
      ...g,
      counts: {
        reserved: g.open.filter((e) => e.status === 'eligible').length,
        issued: g.open.filter((e) => e.status === 'issued').length,
        redeemed: g.open.filter((e) => e.status === 'redeemed').length,
        closed: g.closed.length,
      },
      deliveryIssues: g.open.filter((e) => e.delivery?.email && !e.delivery.email.ok).length,
      // Same condition as the old per-row badge: undeliverable NOW, regardless
      // of receipts — an email cleared after a send must keep warning.
      noEmail: g.open.filter(
        (e) => e.emailDeliverable === false && ['eligible', 'issued'].includes(e.status)
      ).length,
    }));
  }, [entitlements]);

  // Filtering to a closed status must SHOW those rows — hiding the only
  // matching rows behind the per-stack link would render empty stacks.
  const closedFilterActive = CLOSED_STATUSES.includes(statusFilter);

  const toggleIn = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleCollapsed = toggleIn(setCollapsed);
  const toggleClosedShown = toggleIn(setClosedShown);

  // A scanned QR is either a pass link (→ activate) or a voucher token (→ verify).
  const handleScanDetect = useCallback((raw) => {
    setScanOpen(false);
    const parsed = parseRewardQr(raw);
    if (!parsed) { toast.error("That QR isn't a MKTR reward code"); return; }
    if (parsed.kind === 'pass') {
      setActivateToken(parsed.value); // opens the Activate confirm dialog
    } else {
      setVerified(null);
      setToken(parsed.value);
      verifyMutation.mutate(parsed.value); // explicit token — no stale closure
    }
  }, [verifyMutation]);

  const focusPaste = useCallback(() => {
    // Defer so the scanner dialog has finished closing before we steal focus.
    setTimeout(() => pasteRef.current?.focus(), 0);
  }, []);

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed — select the text and copy manually');
    }
  };

  const dialogIsVoucher = shareDialog?.entitlement?.status === 'issued';

  const renderRow = (e, { closed = false } = {}) => {
    const delivery = deliveryStatus(e);
    const deliveryColor = delivery?.tone === 'warn'
      ? '#B45309'
      : ['issued', 'redeemed'].includes(e.status) ? 'var(--ro-text-2)' : 'var(--ro-text-3)';
    const holderName = [e.prospect?.firstName, e.prospect?.lastName].filter(Boolean).join(' ') || 'Customer';
    // Visible labels are compact per the design; aria-labels keep the
    // credential (pass vs voucher) + holder so repeated rows stay
    // distinguishable in a screen-reader button list.
    const credentialNoun = e.status === 'issued' ? 'voucher' : 'pass';
    const canShare = !closed && canIssueManual && ['eligible', 'issued'].includes(e.status);
    const unlockButton = !closed && isAdmin && e.status === 'eligible' && e.prospect?.id ? (
      <Button
        size="sm"
        variant="outline"
        aria-label={`Unlock — ${holderName}`}
        disabled={unlockMutation.isPending}
        onClick={() => unlockMutation.mutate({ prospectId: e.prospect.id })}
      >
        Unlock
      </Button>
    ) : null;
    // Cancel voids the reward (QR dies, inventory returns, phone slot frees).
    // Same capability the server requires for the cancel route.
    const cancelButton = canShare ? (
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        aria-label={`Cancel reward — ${holderName}`}
        disabled={cancelMutation.isPending}
        onClick={() => { setCancelReason(''); setCancelDialog({ entitlement: e }); }}
      >
        Cancel
      </Button>
    ) : null;
    // Void undoes a REDEEMED reward: reverses the redemption (terminal) so the
    // one-live-reward-per-phone slot frees. Gated on redemptions.override (the
    // same capability the reverse route requires) and a live, not-yet-reversed
    // redemption id from the list.
    const voidButton = e.status === 'redeemed' && canOverrideRedemption
      && e.redemptionId && !e.redemptionReversed ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          aria-label={`Void redemption — ${holderName}`}
          disabled={voidMutation.isPending}
          onClick={() => { setVoidReason(''); setVoidDialog({ entitlement: e }); }}
        >
          Void
        </Button>
      ) : null;
    return (
      <div
        key={e.id}
        className={`grid items-center gap-x-3 gap-y-1 py-2.5 border-t border-border md:grid-cols-[minmax(200px,1.4fr)_minmax(160px,1fr)_92px_230px]${closed ? ' opacity-[0.62]' : ''}`}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold m-0 truncate">
            {holderName}
            <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}>
              {e.prospect?.phone ? ` · ${e.prospect.phone}` : ''}
            </span>
          </p>
          <p className="text-xs m-0 truncate" style={{ color: 'var(--ro-text-2)' }}>
            {e.rewardOffer?.title || '—'}
            {e.tokenHint ? ` · code …${e.tokenHint}` : ''}
          </p>
        </div>
        <span className="text-xs truncate" style={{ color: deliveryColor }}>
          {delivery ? `${delivery.tone === 'warn' ? '⚠ ' : ''}${delivery.text}` : ''}
        </span>
        <span className="min-w-0">
          <RoTag tone={statusTone(e.status)} size="sm">{statusLabel(e.status)}</RoTag>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 md:justify-end">
          {canShare && (e.emailDeliverable !== false || e.whatsappDeliverable) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Resend ${credentialNoun} — ${holderName}`}
                  disabled={resendMutation.isPending}
                >
                  Resend <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {e.emailDeliverable !== false && (
                  <DropdownMenuItem onSelect={() => setShareDialog({ entitlement: e, mode: 'email', phase: 'confirm' })}>
                    Email
                  </DropdownMenuItem>
                )}
                {e.whatsappDeliverable && (
                  <DropdownMenuItem onSelect={() => setShareDialog({ entitlement: e, mode: 'whatsapp', phase: 'confirm' })}>
                    WhatsApp
                  </DropdownMenuItem>
                )}
                {e.emailDeliverable !== false && e.whatsappDeliverable && (
                  <DropdownMenuItem onSelect={() => setShareDialog({ entitlement: e, mode: 'both', phase: 'confirm' })}>
                    Both
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canShare && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Copy link — ${holderName}`}
              disabled={resendMutation.isPending}
              onClick={() => setShareDialog({ entitlement: e, mode: 'link', phase: 'confirm' })}
            >
              Copy link
            </Button>
          )}
          {unlockButton}
          {cancelButton}
          {voidButton}
        </span>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <RoPageHeader
        title="Redemptions"
        sub="Verify a voucher, confirm identity, redeem — double redemption is impossible."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="w-4 h-4" aria-hidden="true" /> Scan or verify a reward
          </CardTitle>
          <CardDescription>
            Scan the customer&apos;s QR to activate a reservation or redeem a voucher — or paste the code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={() => setScanOpen(true)}>
            <ScanLine className="w-4 h-4 mr-2" aria-hidden="true" /> Scan QR
          </Button>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ro-text-3)' }}>
            <span className="h-px flex-1 bg-border" /> or enter the code <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex gap-2">
            <Input
              ref={pasteRef}
              value={token}
              onChange={(e) => { setToken(e.target.value); setVerified(null); }}
              placeholder="Voucher code…"
              className="font-mono"
            />
            <Button disabled={!token.trim() || verifyMutation.isPending} onClick={() => verifyMutation.mutate(token)}>
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
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-60 space-y-1.5">
              <CardTitle className="text-base">Reservations &amp; vouchers</CardTitle>
              <CardDescription>
                Every captured lead's reward, grouped by campaign — each stack carries its own counts.
                {isAdmin ? ' As admin you can unlock a reservation manually (audited) — normally the assigned consultant does this at the meeting.' : ''}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 flex-none">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[140px] rounded-full text-[13px] font-semibold" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                className="ro-search w-56"
                placeholder="Search holder name or phone"
                value={resSearch}
                onChange={(e) => setResSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            const showClosed = closedFilterActive || closedShown.has(g.key);
            const countParts = [
              g.counts.reserved && [g.counts.reserved, 'reserved'],
              g.counts.issued && [g.counts.issued, 'issued'],
              g.counts.redeemed && [g.counts.redeemed, 'redeemed'],
              g.counts.closed && [g.counts.closed, 'closed'],
            ].filter(Boolean);
            return (
              <div key={g.key}>
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(g.key)}
                  className="w-full flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[10px] px-3.5 py-2.5 mt-3.5 text-left cursor-pointer"
                  style={{ background: 'var(--ro-subtle)' }}
                >
                  <CampaignDot id={g.key} />
                  <span className="text-[13.5px] font-bold whitespace-nowrap">{g.name}</span>
                  {g.partner && (
                    <span className="text-[12.5px] truncate" style={{ color: 'var(--ro-text-2)' }}>{g.partner}</span>
                  )}
                  {g.deliveryIssues > 0 && (
                    <RoTag tone="medium" size="sm">
                      ⚠ {g.deliveryIssues} delivery issue{g.deliveryIssues > 1 ? 's' : ''}
                    </RoTag>
                  )}
                  {g.noEmail > 0 && (
                    <RoTag tone="medium" size="sm">⚠ {g.noEmail} no email</RoTag>
                  )}
                  <span className="flex-1" />
                  <span
                    className="text-xs whitespace-nowrap"
                    style={{ color: 'var(--ro-text-2)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {countParts.map(([n, label], i) => (
                      <span key={label}>
                        {i > 0 ? ' · ' : ''}
                        <b style={{ color: '#0D1619' }}>{n}</b> {label}
                      </span>
                    ))}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`w-[15px] h-[15px] flex-none transition-transform${isCollapsed ? ' -rotate-90' : ''}`}
                    style={{ color: 'var(--ro-text-2)' }}
                  />
                </button>
                {!isCollapsed && (
                  <div className="flex flex-col pl-3 md:pl-[22px]">
                    {g.open.map((e) => renderRow(e))}
                    {showClosed && g.closed.map((e) => renderRow(e, { closed: true }))}
                    {!closedFilterActive && g.closed.length > 0 && (
                      <div className="pt-2 pb-0.5 border-t border-border">
                        <button
                          type="button"
                          className="text-[12.5px] font-semibold bg-transparent border-0 p-0 cursor-pointer hover:underline"
                          style={{ color: 'var(--ro-azure, #037AFF)' }}
                          onClick={() => toggleClosedShown(g.key)}
                        >
                          {showClosed
                            ? `Hide ${g.counts.closed} closed`
                            : `Show ${g.counts.closed} closed (cancelled / expired)`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!entitlementsQuery.isLoading && entitlements.length === 0 && (
            <p className="text-sm text-center py-6 m-0" style={{ color: 'var(--ro-text-2)' }}>
              No reservations yet — they appear when customers sign up on an active activation's campaign.
            </p>
          )}
          {pagination && pagination.total > entitlements.length && (
            <p className="text-xs text-center pt-4 m-0" style={{ color: 'var(--ro-text-3)' }}>
              Showing the latest {entitlements.length} of {pagination.total} — stack counts cover only
              these rows; search or filter to narrow.
            </p>
          )}
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
                    {r.activation && (
                      <span className="flex items-center gap-1.5 text-xs truncate mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                        <CampaignDot id={r.activation.id} size={7} />
                        {r.activation.campaignNameSnapshot || '—'}
                      </span>
                    )}
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
                  <TableHead>Campaign</TableHead>
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
                    <TableCell className="text-muted-foreground">
                      {r.activation ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CampaignDot id={r.activation.id} size={7} />
                          {r.activation.campaignNameSnapshot || '—'}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.partner?.tradingName || r.partner?.legalName || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.redeemedAt).toLocaleString('en-SG', {
                        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.actor?.fullName || r.actorType}</TableCell>
                    <TableCell>
                      <RoTag tone={r.status === 'completed' ? 'completed' : 'void'} size="sm">{prettyEnum(r.status)}</RoTag>
                    </TableCell>
                  </TableRow>
                ))}
                {!historyQuery.isLoading && redemptions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
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
                    : shareDialog.mode === 'whatsapp'
                      ? (dialogIsVoucher ? 'Resend voucher on WhatsApp?' : 'Resend pass on WhatsApp?')
                      : shareDialog.mode === 'both'
                        ? (dialogIsVoucher ? 'Resend voucher on email + WhatsApp?' : 'Resend pass on email + WhatsApp?')
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
                    : shareDialog.mode === 'email' ? 'Resend email'
                      : shareDialog.mode === 'whatsapp' ? 'Resend on WhatsApp'
                        : shareDialog.mode === 'both' ? 'Resend on both'
                          : 'Create new link'}
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

      {/* Cancel — voids the reward. Destructive + reason-gated (audited). */}
      <Dialog
        open={!!cancelDialog}
        onOpenChange={(open) => {
          // Don't let Escape / overlay / X dismiss mid-flight: the PATCH is
          // irreversible, and a dialog that vanishes while it's still running
          // reads as "aborted" when it actually completed (Codex review).
          if (!open && !cancelMutation.isPending) { setCancelDialog(null); setCancelReason(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cancel this {cancelDialog?.entitlement?.status === 'issued' ? 'voucher' : 'reservation'}?
            </DialogTitle>
            <DialogDescription>
              {[cancelDialog?.entitlement?.prospect?.firstName, cancelDialog?.entitlement?.prospect?.lastName]
                .filter(Boolean).join(' ') || 'The customer'}
              {"'s "}
              {cancelDialog?.entitlement?.status === 'issued' ? 'voucher QR/code' : 'reservation pass'}
              {' stops working immediately, the reward returns to the activation pool, and this'}
              {' phone number can earn a new reward. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={cancelReason}
            onChange={(ev) => setCancelReason(ev.target.value)}
            placeholder="Reason (required) — e.g. duplicate, testing, customer request"
            aria-label="Reason for cancelling this reward"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={cancelMutation.isPending}
              onClick={() => { setCancelDialog(null); setCancelReason(''); }}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancelMutation.isPending}
              onClick={() => cancelMutation.mutate({ id: cancelDialog.entitlement.id, reason: cancelReason.trim() })}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel reward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void — reverses a REDEEMED redemption. Destructive + reason-gated (audited). */}
      <Dialog
        open={!!voidDialog}
        onOpenChange={(open) => {
          // Same mid-flight guard as Cancel: the reverse is irreversible, so a
          // dialog vanishing while the POST runs must not read as "aborted".
          if (!open && !voidMutation.isPending) { setVoidDialog(null); setVoidReason(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this redeemed reward?</DialogTitle>
            <DialogDescription>
              {[voidDialog?.entitlement?.prospect?.firstName, voidDialog?.entitlement?.prospect?.lastName]
                .filter(Boolean).join(' ') || 'The customer'}
              {"'s reward is already redeemed. Voiding reverses that redemption"}
              {' and cancels the reward, so this phone number can earn a new one on'}
              {' this activation. The redemption record is kept and marked reversed'}
              {' (audited). This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={voidReason}
            onChange={(ev) => setVoidReason(ev.target.value)}
            placeholder="Reason (required) — e.g. testing, mistaken redemption, customer request"
            aria-label="Reason for voiding this redemption"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={voidMutation.isPending}
              onClick={() => { setVoidDialog(null); setVoidReason(''); }}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!voidReason.trim() || voidMutation.isPending}
              onClick={() => voidMutation.mutate({ redemptionId: voidDialog.entitlement.redemptionId, reason: voidReason.trim() })}
            >
              {voidMutation.isPending ? 'Voiding…' : 'Void redemption'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate — scanning a reservation pass issues the voucher. Confirm
          before firing (it sends the voucher + draws from allocation). */}
      <Dialog
        open={!!activateToken}
        onOpenChange={(open) => { if (!open && !unlockMutation.isPending) setActivateToken(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate this reward?</DialogTitle>
            <DialogDescription>
              This issues the customer&apos;s voucher now and sends it to them, drawing from the
              campaign&apos;s allocation. You can cancel it afterwards if it was a mistake.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={unlockMutation.isPending}
              onClick={() => setActivateToken(null)}
            >
              Not now
            </Button>
            <Button
              disabled={unlockMutation.isPending}
              onClick={() => unlockMutation.mutate({ presentationToken: activateToken })}
            >
              {unlockMutation.isPending ? 'Activating…' : 'Activate reward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onDetect={handleScanDetect}
        onPasteFallback={focusPaste}
      />
    </div>
  );
}
