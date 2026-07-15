/**
 * Switchboard Wallets & Commitments — the money observability screen. The
 * admin OBSERVES and adjusts; it never sells: top-ups happen in the agents'
 * own app, refunds only via campaign takedown, and the manual adjustment
 * (signed cents + MANDATORY note, idempotent via requestId) is the sole
 * exception path. Roster is attention-first (S$0 wallets on top).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWallets, useWalletLedger } from '@/hooks/queries/useAdminV2';
import { adjustWallet } from '@/api/adminV2';
import { fmtNumber, fmtSGD, fmtSGDExact, fmtDateTime, fmtRelative } from '@/lib/adminV2/format';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const LEDGER_LABELS = {
  topup: { label: 'Top-up', tone: 'ok' },
  commit: { label: 'Commitment', tone: 'accent' },
  takedown_refund: { label: 'Takedown refund', tone: 'hold' },
  adjustment: { label: 'Adjustment', tone: 'warn' },
};

function AdjustDialog({ wallet, onClose }) {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('credit');
  const [note, setNote] = useState('');
  // One idempotency key per opened dialog — a double-click or retry after a
  // lost response replays the SAME adjustment instead of applying a second one.
  const [requestId] = useState(() => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `adj${Date.now()}${Math.random().toString(36).slice(2, 10)}`));
  const queryClient = useQueryClient();

  // Money is validated as a STRING: whole dollars + at most 2 decimals. No
  // silent rounding — "1.005" is an error the operator must fix, never a
  // different amount than they typed.
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;
  const cents = amountValid ? Math.round(Number(amount.trim()) * 100) : 0;
  const overdraft = direction === 'debit' && amountValid && cents > wallet.walletBalanceCents;
  const valid = amountValid && !overdraft && note.trim().length > 0;

  const mutation = useMutation({
    mutationFn: () => adjustWallet(wallet.id, {
      amountCents: direction === 'credit' ? cents : -cents,
      note: note.trim(),
      requestId,
    }),
    onSuccess: (r) => {
      const bal = r?.data?.balanceCents;
      toast.success(`Adjustment applied${r?.data?.replayed ? ' (replayed)' : ''} — balance ${fmtSGDExact(bal)}`);
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'wallets'] });
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'walletLedger', wallet.id] });
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Adjustment failed'),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
      <DialogContent
        className="admin-v2"
        style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: 440 }}
        onInteractOutside={(e) => { if (mutation.isPending) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (mutation.isPending) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, textAlign: 'left' }}>Manual adjustment</DialogTitle>
          <DialogDescription style={{ color: 'var(--ink-2)', fontSize: 11.5, textAlign: 'left' }}>
            {wallet.name} · balance {fmtSGDExact(wallet.walletBalanceCents)} — the exception path. Top-ups happen in the agent app; refunds only via campaign takedown.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[['credit', '+ Credit'], ['debit', '\u2212 Debit']].map(([v, label]) => (
            <button
              key={v}
              type="button"
              className="av2-btn av2-btn--sm"
              aria-pressed={direction === v}
              style={direction === v ? { background: 'var(--ink)', color: 'var(--canvas)', borderColor: 'var(--ink)' } : undefined}
              onClick={() => setDirection(v)}
            >
              {label}
            </button>
          ))}
          <div className="av2-input" style={{ flex: 1, height: 32, borderRadius: 9 }}>
            <span className="av2-mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>S$</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal" placeholder="0.00"
              aria-label="Adjustment amount in dollars"
              aria-invalid={amount.trim() !== '' && !amountValid}
              style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'inherit', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        </div>
        {amount.trim() !== '' && !amountValid && (
          <div className="av2-caption" style={{ color: 'var(--bad)', marginBottom: 8 }}>
            Enter dollars with at most two decimals (e.g. 12.50) — amounts are never rounded for you.
          </div>
        )}
        {overdraft && (
          <div className="av2-caption" style={{ color: 'var(--bad)', marginBottom: 8 }}>
            That debit exceeds the current balance ({fmtSGDExact(wallet.walletBalanceCents)}) — wallets can never go below S$0.
          </div>
        )}
        <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          <span className="av2-microcaps">Note (required — lands in the ledger)</span>
          <input className="av2-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. duplicate delivery on 2 leads — goodwill credit" />
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="av2-btn" disabled={mutation.isPending} onClick={onClose}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Applying\u2026' : `Apply ${direction === 'credit' ? '+' : '\u2212'}${amountValid ? fmtSGDExact(cents) : ''}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LedgerDrawer({ wallet, onClose }) {
  const [page, setPage] = useState(1);
  const ledger = useWalletLedger(wallet?.id, page);
  if (!wallet) return null;
  const entries = ledger.data?.entries || [];
  const total = ledger.data?.total ?? 0;
  const limit = ledger.data?.limit ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="admin-v2" style={{ width: 432, maxWidth: '90vw', padding: 0, background: 'var(--surface)', color: 'var(--ink)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <SheetHeader style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <SheetTitle style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
            {wallet.name} — ledger
          </SheetTitle>
          <div className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            balance {fmtSGDExact(wallet.walletBalanceCents)} · append-only, newest first
          </div>
        </SheetHeader>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {ledger.isLoading && <div style={{ padding: 16 }}><Skeleton height={120} /></div>}
          {ledger.isError && <ErrorState error={ledger.error} onRetry={ledger.refetch} />}
          {!ledger.isLoading && !ledger.isError && entries.length === 0 && (
            <EmptyState title="No ledger entries" hint="Top-ups, commitments, refunds and adjustments land here." />
          )}
          {entries.map((e) => {
            const meta = LEDGER_LABELS[e.type] || { label: e.type, tone: '' };
            const credit = e.amountCents > 0;
            return (
              <div key={e.id} className="av2-qrow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Chip tone={meta.tone}>{meta.label}</Chip>
                    {e.note && <span className="av2-caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.note}</span>}
                  </span>
                  <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', marginTop: 3 }}>{fmtDateTime(e.createdAt)}</span>
                </span>
                <span style={{ textAlign: 'right', flex: 'none' }}>
                  <span className="av2-mono" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: credit ? 'var(--ok)' : 'var(--ink)' }}>
                    {credit ? '+' : '−'}{fmtSGDExact(Math.abs(e.amountCents))}
                  </span>
                  <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)' }}>→ {fmtSGDExact(e.balanceAfterCents)}</span>
                </span>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
            <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>page {page} / {totalPages}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="av2-btn av2-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
            <button type="button" className="av2-btn av2-btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Older →</button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AdminV2Wallets() {
  const wallets = useWallets();
  const [ledgerFor, setLedgerFor] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);

  const rows = useMemo(() => {
    // Attention-first: S$0 on top, then ascending balance (design contract).
    return [...(wallets.data || [])].sort((a, b) => a.walletBalanceCents - b.walletBalanceCents);
  }, [wallets.data]);

  const floatCents = rows.reduce((s, w) => s + (w.walletBalanceCents || 0), 0);
  const committedCents = rows.reduce((s, w) => s + (w.committedValueCents || 0), 0);

  return (
    <div>
      <PageHeader
        title="Wallets & Commitments"
        meta={`${fmtNumber(rows.length)} EXTERNAL AGENTS · FLOAT ${fmtSGD(floatCents)} · COMMITTED ${fmtSGD(committedCents)}`}
      >
        <Link to="/AdminLeadPackages" className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>
          Legacy packages →
        </Link>
      </PageHeader>

      <div className="av2-caption" style={{ marginBottom: 16 }}>
        Wallets exist for external (mktr-leads) agents in v1. Top-ups happen in the agents’ own app and are non-refundable to cash;
        the only automatic refund is a campaign takedown returning undelivered commitments as credits.
      </div>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="grid" aria-label="Agent wallets">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.4 }}>Agent</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none', textAlign: 'right' }}>Balance</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.6 }}>Open commitments</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 100, flex: 'none', textAlign: 'right' }}>Last activity</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 150, flex: 'none', textAlign: 'right' }}>Actions</span>
        </div>

        {wallets.isLoading && [0, 1, 2].map((i) => (
          <div key={i} className="av2-row" style={{ cursor: 'default' }}><Skeleton height={36} /></div>
        ))}
        {wallets.isError && <ErrorState error={wallets.error} onRetry={wallets.refetch} />}
        {!wallets.isLoading && !wallets.isError && rows.length === 0 && (
          <EmptyState
            title="No external agents yet"
            hint="Wallets appear when mktr-leads agents are synced. Balances stay S$0 until the wallet goes live and agents top up."
          />
        )}

        {rows.map((w) => (
          <div key={w.id} className="av2-row" role="row" style={{ cursor: 'default' }}>
            <span role="gridcell" style={{ flex: 1.4, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{w.name}</span>
                {w.isActive === false && <Chip tone="warn">Inactive</Chip>}
              </span>
              <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)' }}>{w.email}</span>
            </span>
            <span role="gridcell" className="av2-mono" style={{ width: 110, flex: 'none', fontSize: 13, fontWeight: 600, textAlign: 'right', color: w.walletBalanceCents === 0 ? 'var(--warn)' : 'var(--ink)' }}>
              {fmtSGDExact(w.walletBalanceCents)}
            </span>
            <span role="gridcell" style={{ flex: 1.6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(w.openCommitments || []).length === 0
                ? <span className="av2-caption">none</span>
                : (w.openCommitments || []).map((oc) => (
                  <Chip key={oc.assignmentId} tone="accent">
                    {oc.campaign || 'campaign'} · {fmtNumber(oc.remaining)} @ {fmtSGD(oc.unitPriceCents)}
                  </Chip>
                ))}
            </span>
            <span role="gridcell" className="av2-mono" style={{ width: 100, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>
              {w.lastActivityAt ? fmtRelative(w.lastActivityAt) : '—'}
            </span>
            <span role="gridcell" style={{ width: 150, flex: 'none', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" className="av2-btn av2-btn--sm" onClick={() => setLedgerFor(w)}>Ledger</button>
              <button type="button" className="av2-btn av2-btn--sm" onClick={() => setAdjustFor(w)}>Adjust</button>
            </span>
          </div>
        ))}
      </div>

      <LedgerDrawer wallet={ledgerFor} onClose={() => setLedgerFor(null)} />
      {adjustFor && <AdjustDialog wallet={adjustFor} onClose={() => setAdjustFor(null)} />}
    </div>
  );
}
