/**
 * Wallet ledger entries — shared between the Wallets drawer and the Agents
 * drawer so both read the SAME append-only truth with one rendering. Paged
 * newest-first; the parent decides the scroll container.
 */
import { useState } from 'react';
import { useWalletLedger } from '@/hooks/queries/useAdminV2';
import { fmtSGDExact, fmtDateTime } from '@/lib/adminV2/format';
import { Chip, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';

export const LEDGER_LABELS = {
  topup: { label: 'Top-up', tone: 'ok' },
  commit: { label: 'Commitment', tone: 'accent' },
  takedown_refund: { label: 'Takedown refund', tone: 'hold' },
  adjustment: { label: 'Adjustment', tone: 'warn' },
};

export default function WalletLedgerList({ agentId }) {
  const [page, setPage] = useState(1);
  const ledger = useWalletLedger(agentId, page);
  const entries = ledger.data?.entries || [];
  const total = ledger.data?.total ?? 0;
  const limit = ledger.data?.limit ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (ledger.isLoading) return <div style={{ padding: '8px 16px' }}><Skeleton height={120} /></div>;
  if (ledger.isError) return <ErrorState error={ledger.error} onRetry={ledger.refetch} />;
  if (entries.length === 0) {
    return <EmptyState title="No ledger entries" hint="Top-ups, commitments, refunds and adjustments land here." />;
  }

  return (
    <>
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
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 0' }}>
          <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>page {page} / {totalPages}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="av2-btn av2-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
          <button type="button" className="av2-btn av2-btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Older →</button>
        </div>
      )}
    </>
  );
}
