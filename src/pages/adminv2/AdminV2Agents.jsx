/**
 * Switchboard Agents — the roster with routing volume, recency, and wallet
 * columns (B7 aggregates). Internal agents render "—" for wallet fields
 * (null from the API — they have no wallets in v1); external agents link
 * through to Wallets & Commitments.
 */
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAgentsRoster } from '@/hooks/queries/useAdminV2';
import { fmtNumber, fmtSGD, fmtRelative } from '@/lib/adminV2/format';
import { Chip, PageHeader, PeriodSwitch, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';

export default function AdminV2Agents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = ['7d', '30d', '90d'].includes(searchParams.get('period')) ? searchParams.get('period') : '30d';
  const status = searchParams.get('status') ?? 'active';
  const urlSearch = searchParams.get('q') || '';
  const [search, setSearch] = useState(urlSearch);
  const patch = (changes) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '' || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  };
  const setPeriod = (p) => patch({ period: p === '30d' ? null : p });
  const setStatus = (v) => patch({ status: v === 'active' ? null : v });
  // Debounce the search into the URL (functional — never clobbers other params).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchParams((prev) => {
        if ((prev.get('q') || '') === search) return prev;
        const next = new URLSearchParams(prev);
        if (search) next.set('q', search);
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const roster = useAgentsRoster({ period, search: urlSearch, status });
  const rows = roster.data?.rows || [];

  return (
    <div>
      <PageHeader title="Agents" meta={`${fmtNumber(roster.data?.total ?? 0)} AGENTS${(roster.data?.total ?? 0) > rows.length && rows.length > 0 ? ` · SHOWING FIRST ${fmtNumber(rows.length)}` : ''} · ASSIGNMENT VOLUME LAST ${period.toUpperCase()}`}>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </PageHeader>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="av2-input" style={{ maxWidth: 300 }}>
          <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search agents"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'inherit' }}
          />
        </div>
        {[['active', 'Active'], ['inactive', 'Inactive'], ['', 'All']].map(([v, label]) => (
          <button
            key={v || 'all'}
            type="button"
            className="av2-btn av2-btn--sm"
            aria-pressed={status === v}
            style={status === v ? { background: 'var(--ink)', color: 'var(--canvas)', borderColor: 'var(--ink)' } : undefined}
            onClick={() => setStatus(v)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="grid" aria-label="Agents roster">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.5 }}>Agent</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none', textAlign: 'right' }}>Assigned · {period}</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 100, flex: 'none', textAlign: 'right' }}>Last assigned</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 100, flex: 'none', textAlign: 'right' }}>Wallet</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 150, flex: 'none', textAlign: 'right' }}>Committed</span>
        </div>

        {roster.isLoading && [0, 1, 2, 3].map((i) => (
          <div key={i} className="av2-row" style={{ cursor: 'default' }}><Skeleton height={32} /></div>
        ))}
        {roster.isError && <ErrorState error={roster.error} onRetry={roster.refetch} />}
        {!roster.isLoading && !roster.isError && rows.length === 0 && (
          <EmptyState title="No agents match" hint="Adjust the search or status filter." />
        )}

        {rows.map((a) => {
          const external = a.mktrLeadsId != null;
          const name = a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email;
          return (
            <div key={a.id} className="av2-row" role="row" style={{ cursor: 'default' }}>
              <span role="gridcell" style={{ flex: 1.5, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{name}</span>
                  {external && <Chip tone="accent">External</Chip>}
                  {!a.isActive && <Chip tone="warn">Inactive</Chip>}
                </span>
                <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)' }}>{a.email}</span>
              </span>
              <span role="gridcell" className="av2-mono" style={{ width: 110, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtNumber(a.assignedThisPeriod ?? 0)}</span>
              <span role="gridcell" className="av2-mono" style={{ width: 100, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{a.lastAssignedAt ? fmtRelative(a.lastAssignedAt) : '—'}</span>
              <span role="gridcell" className="av2-mono" style={{ width: 100, flex: 'none', fontSize: 12, textAlign: 'right', color: a.walletBalanceCents === 0 ? 'var(--warn)' : 'var(--ink)' }}>
                {a.walletBalanceCents === null || a.walletBalanceCents === undefined ? '—' : fmtSGD(a.walletBalanceCents)}
              </span>
              <span role="gridcell" style={{ width: 150, flex: 'none', textAlign: 'right' }}>
                {a.committedLeads === null || a.committedLeads === undefined ? (
                  <span className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>—</span>
                ) : a.committedLeads > 0 ? (
                  <Link to="/AdminWallets" className="av2-mono" style={{ fontSize: 12, color: 'var(--accent-text)', textDecoration: 'none', fontWeight: 600 }}>
                    {fmtNumber(a.committedLeads)} · {fmtSGD(a.committedValueCents)}
                  </Link>
                ) : (
                  <span className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>0</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
