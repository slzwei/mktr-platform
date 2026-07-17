/**
 * Switchboard Agents — roster per the MKTR Admin design: money-attention count
 * line, wallet-state filters (All / Wallet at S$0 / No commitments), phone +
 * commitments columns, attention-first sort (S$0 wallets on top), and
 * click-through — every row opens the agent drawer (wallet, commitments,
 * assignment, ledger); "Ledger →" deep-links to Wallets via ?focus=<id>.
 * Internal agents render "—" for wallet fields (null from the API — they have
 * no wallets in v1) and sort after the external roster.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAgentsRoster } from '@/hooks/queries/useAdminV2';
import { fmtNumber, fmtSGD, fmtSGDExact, fmtRelative } from '@/lib/adminV2/format';
import { Chip, PageHeader, PeriodSwitch, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import WalletLedgerList from '@/components/adminv2/WalletLedgerList';

const LOW_WALLET_CENTS = 5000;

const agentName = (a) => a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email;
const isExternal = (a) => a.walletBalanceCents !== null && a.walletBalanceCents !== undefined;

function AgentDrawer({ agent, period, onClose }) {
  if (!agent) return null;
  const external = isExternal(agent);
  const zero = external && agent.walletBalanceCents === 0;
  const breakdown = agent.owed_leads_breakdown || [];
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="admin-v2" style={{ width: 432, maxWidth: '90vw', padding: 0, background: 'var(--surface)', color: 'var(--ink)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <SheetHeader style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <SheetTitle style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontFamily: 'var(--font-ui)', textAlign: 'left' }}>
            {agentName(agent)}
          </SheetTitle>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {external && <Chip tone="accent">External</Chip>}
            {!agent.isActive && <Chip tone="warn">Inactive</Chip>}
          </div>
          <div className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {agent.email}{agent.phone ? ` · ${agent.phone}` : ''}
          </div>
        </SheetHeader>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {external && (
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="av2-mono" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: zero ? 'var(--bad)' : 'var(--ink)' }}>
                {fmtSGDExact(agent.walletBalanceCents)}
              </span>
              <span className="av2-caption">wallet credits · S$1 = 1 credit</span>
              <span style={{ flex: 1 }} />
              <span className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>top-ups: agent app</span>
            </div>
          )}
          <section style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div className="av2-microcaps" style={{ marginBottom: 8 }}>{external ? 'Open commitments' : 'Lead credits (packages)'}</div>
            {breakdown.length === 0 ? (
              <div className="av2-caption">None — this agent isn’t receiving leads.</div>
            ) : (
              breakdown.map((b, i) => (
                <div key={b.campaignId || i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.campaignName || 'campaign'}</span>
                  <span className="av2-mono" style={{ fontSize: 11.5, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmtNumber(b.leadsRemaining)} leads</span>
                </div>
              ))
            )}
            {external && agent.committedLeads > 0 && (
              <div className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 6 }}>
                total {fmtNumber(agent.committedLeads)} leads · {fmtSGD(agent.committedValueCents)} committed
              </div>
            )}
          </section>
          <section style={{ padding: '14px 16px', borderBottom: external ? '1px solid var(--line)' : 'none' }}>
            <div className="av2-microcaps" style={{ marginBottom: 8 }}>Assignment</div>
            <div className="av2-kv"><span>assigned · {period}</span><span>{fmtNumber(agent.assignedThisPeriod ?? 0)}</span></div>
            <div className="av2-kv"><span>last assigned</span><span>{agent.lastAssignedAt ? fmtRelative(agent.lastAssignedAt) : '—'}</span></div>
            <div className="av2-kv"><span>lifetime prospects</span><span>{fmtNumber(agent.stats?.totalProspects ?? 0)}</span></div>
            <div className="av2-kv"><span>converted</span><span>{fmtNumber(agent.stats?.convertedProspects ?? 0)}</span></div>
          </section>
          {external && (
            <section style={{ padding: '14px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 16px' }}>
                <div className="av2-microcaps" style={{ flex: 1 }}>Ledger — append-only, newest first</div>
                <Link
                  to={`/AdminWallets?focus=${agent.id}`}
                  style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  Open in Wallets →
                </Link>
              </div>
              <WalletLedgerList agentId={agent.id} />
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminV2Agents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = ['7d', '30d', '90d'].includes(searchParams.get('period')) ? searchParams.get('period') : '30d';
  const status = searchParams.get('status') ?? 'active';
  const wFilter = ['zero', 'nocommit'].includes(searchParams.get('w')) ? searchParams.get('w') : '';
  const urlSearch = searchParams.get('q') || '';
  const [search, setSearch] = useState(urlSearch);
  const [drawer, setDrawer] = useState(null);
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
  const setWFilter = (v) => patch({ w: v || null });
  // Live view of the params for timers created in older renders — RR v7's
  // setSearchParams (functional form included) closes over its render's
  // params and always navigates, so a stale timer would rewind the URL.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  // Debounce the search into the URL, reading LIVE params at fire time and
  // skipping navigation entirely when q is already in sync.
  useEffect(() => {
    const t = setTimeout(() => {
      const prev = paramsRef.current;
      if ((prev.get('q') || '') === search) return;
      const next = new URLSearchParams(prev);
      if (search) next.set('q', search);
      else next.delete('q');
      setSearchParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ?q can change while mounted (⌘K palette pick, back/forward) — resync the
  // input unless the operator is mid-typing. The roster query already follows
  // urlSearch; without this the box would show stale text.
  useEffect(() => {
    if (document.activeElement?.getAttribute('aria-label') !== 'Search agents' && urlSearch !== search) {
      setSearch(urlSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);
  const roster = useAgentsRoster({ period, search: urlSearch, status });
  const rows = roster.data?.rows || [];

  // Money-attention header stats over the EXTERNAL roster (internal agents
  // have no wallets — a null must never read as "S$0 float").
  const external = useMemo(() => rows.filter(isExternal), [rows]);
  const floatCents = external.reduce((s, a) => s + a.walletBalanceCents, 0);
  const zeroCount = external.filter((a) => a.walletBalanceCents === 0).length;
  const noCommitCount = external.filter((a) => !(a.committedLeads > 0)).length;

  const visible = useMemo(() => {
    let out = rows;
    if (wFilter === 'zero') out = rows.filter((a) => isExternal(a) && a.walletBalanceCents === 0);
    if (wFilter === 'nocommit') out = rows.filter((a) => isExternal(a) && !(a.committedLeads > 0));
    // Attention-first (design contract): emptiest wallets on top, then routing
    // volume; internal agents (no wallet) follow, busiest first.
    return [...out].sort((a, b) => {
      const aExt = isExternal(a);
      const bExt = isExternal(b);
      if (aExt !== bExt) return aExt ? -1 : 1;
      if (aExt && a.walletBalanceCents !== b.walletBalanceCents) return a.walletBalanceCents - b.walletBalanceCents;
      return (b.assignedThisPeriod ?? 0) - (a.assignedThisPeriod ?? 0);
    });
  }, [rows, wFilter]);

  const total = roster.data?.total ?? 0;
  const meta = [
    `${fmtNumber(total)} AGENTS`,
    total > rows.length && rows.length > 0 ? `SHOWING FIRST ${fmtNumber(rows.length)}` : null,
    `FLOAT ${fmtSGD(floatCents)}`,
    `${fmtNumber(zeroCount)} WALLETS AT S$0`,
    `${fmtNumber(noCommitCount)} WITHOUT OPEN COMMITMENTS`,
  ].filter(Boolean).join(' · ');

  return (
    <div>
      <PageHeader title="Agents" meta={meta}>
        <div className="av2-seg" role="group" aria-label="Wallet filter">
          {[['', 'All'], ['zero', 'Wallet at S$0'], ['nocommit', 'No commitments']].map(([v, label]) => (
            <button key={v || 'all'} type="button" aria-pressed={wFilter === v} onClick={() => setWFilter(v)}>
              {label}
            </button>
          ))}
        </div>
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

      <div className="av2-card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 880 }} role="table" aria-label="Agents roster">
            <div className="av2-thead" role="row">
              <span className="av2-microcaps" role="columnheader" style={{ width: 190, flex: 'none' }}>Agent</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none' }}>Phone</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 120, flex: 'none', textAlign: 'right' }}>Wallet</span>
              <span className="av2-microcaps" role="columnheader" style={{ flex: 1, minWidth: 0, paddingLeft: 12 }}>Open commitments</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 96, flex: 'none', textAlign: 'right' }}>Assigned · {period}</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 96, flex: 'none', textAlign: 'right' }}>Last assigned</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 86, flex: 'none' }}><span className="sr-only">Ledger</span></span>
            </div>

            {roster.isLoading && [0, 1, 2, 3].map((i) => (
              <div key={i} className="av2-row" role="row" style={{ cursor: 'default' }}><span role="cell" style={{ flex: 1 }}><Skeleton height={32} /></span></div>
            ))}
            {roster.isError && <StateRow><ErrorState error={roster.error} onRetry={roster.refetch} /></StateRow>}
            {!roster.isLoading && !roster.isError && visible.length === 0 && (
              <StateRow><EmptyState title="No agents match" hint="Adjust the search or filters." /></StateRow>
            )}

            {visible.map((a) => {
              const external2 = isExternal(a);
              const zero = external2 && a.walletBalanceCents === 0;
              const low = external2 && a.walletBalanceCents > 0 && a.walletBalanceCents < LOW_WALLET_CENTS;
              return (
                <div
                  key={a.id}
                  className="av2-row"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${agentName(a)}`}
                  onClick={() => setDrawer(a)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrawer(a); } }}
                >
                  <span style={{ width: 190, flex: 'none', minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agentName(a)}</span>
                      {external2 && <Chip tone="accent">External</Chip>}
                      {!a.isActive && <Chip tone="warn">Inactive</Chip>}
                    </span>
                    <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email}</span>
                  </span>
                  <span className="av2-mono" style={{ width: 110, flex: 'none', fontSize: 11, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{a.phone || '—'}</span>
                  <span style={{ width: 120, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    {zero && <Chip tone="bad" glyph="▲">Empty</Chip>}
                    {low && <Chip tone="warn">Low</Chip>}
                    <span className="av2-mono" style={{ fontSize: 12.5, fontWeight: 600, color: zero ? 'var(--bad)' : low ? 'var(--warn)' : external2 ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {external2 ? fmtSGD(a.walletBalanceCents) : '—'}
                    </span>
                  </span>
                  <span className="av2-mono" style={{ flex: 1, minWidth: 0, paddingLeft: 12, fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {!external2 ? '—' : a.committedLeads > 0 ? `${fmtNumber(a.committedLeads)} leads · ${fmtSGD(a.committedValueCents)}` : '— none'}
                  </span>
                  <span className="av2-mono" style={{ width: 96, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtNumber(a.assignedThisPeriod ?? 0)}</span>
                  <span className="av2-mono" style={{ width: 96, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{a.lastAssignedAt ? fmtRelative(a.lastAssignedAt) : '—'}</span>
                  <span style={{ width: 86, flex: 'none', display: 'flex', justifyContent: 'flex-end' }}>
                    {external2 && (
                      <Link
                        to={`/AdminWallets?focus=${a.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        Ledger →
                      </Link>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AgentDrawer agent={drawer} period={period} onClose={() => setDrawer(null)} />
    </div>
  );
}
