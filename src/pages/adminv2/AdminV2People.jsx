/**
 * People — the deduplicated person directory (admin-people-directory §3).
 * One row per PERSON (consumers with ≥1 linked signup row), searchable by
 * name / email / phone digits, clicking through to the Lead Profile's PERSON
 * view (/admin/leads/:latestProspectId?view=profile) with the state.from
 * contract so the back link restores these exact filters. Deliberately lean:
 * no selection, no bulk bar, no CSV — the signup-grain work lives on
 * Prospects, this page finds the person.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useConsumers } from '@/hooks/queries/useAdminV2';
import { PAGE_SIZE } from '@/lib/adminV2/constants';
import { fmtDateTime, fmtRelative, fmtPhone } from '@/lib/adminV2/format';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';

function readFilters(searchParams) {
  return {
    search: searchParams.get('q') || '',
    sort: searchParams.get('sort') || '-lastSeenAt',
    page: Math.max(1, parseInt(searchParams.get('page'), 10) || 1),
  };
}

function SortHeader({ label, field, sort, onSort, width, align }) {
  const active = sort === field || sort === `-${field}`;
  const desc = sort === `-${field}`;
  return (
    <button
      type="button"
      onClick={() => onSort(active && !desc ? `-${field}` : field)}
      className="av2-microcaps"
      style={{
        width, flex: width ? 'none' : 1, textAlign: align || 'left', background: 'none',
        border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-ui)',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
      }}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
    >
      {label}{active ? (desc ? ' ▼' : ' ▲') : ''}
    </button>
  );
}

/**
 * A MEET or BUY score (consumer-profile-enrichment §7.1b).
 *
 * NULL is not zero and must never look like a low score — it means we lack
 * the evidence to judge, so it renders as a dim em-dash with a title that
 * says which kind of nothing it is. Buy is NULL for anyone with no fact
 * component assessed, which today is nearly everyone.
 */
function ScoreCell({ value, scored, kind }) {
  if (value == null) {
    return (
      <span
        className="av2-mono"
        style={{ width: 58, flex: 'none', fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}
        title={scored
          ? `Not enough evidence to score ${kind} — open the person to see what's missing`
          : 'Not scored yet'}
      >
        —
      </span>
    );
  }
  // Weight only the top of the range: a faint ramp reads as ranking without
  // implying precision the number doesn't have.
  const strong = value >= 60;
  return (
    <span
      className="av2-mono"
      style={{
        width: 58, flex: 'none', fontSize: 12, textAlign: 'right',
        fontWeight: strong ? 700 : 500,
        color: strong ? 'var(--ink)' : 'var(--ink-2)',
      }}
      title={`${kind} ${value}/100`}
    >
      {value}
    </span>
  );
}

export default function AdminV2People() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const navigate = useNavigate();
  const location = useLocation();

  // Live params ref for the debounce timer — RR v7's setSearchParams closes
  // over ITS render's params (the AdminV2Prospects lesson): a stale updater
  // would rewind filters clicked inside the debounce window.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  useEffect(() => {
    const t = setTimeout(() => {
      const prev = paramsRef.current;
      if ((prev.get('q') || '') === searchDraft) return;
      const next = new URLSearchParams(prev);
      if (searchDraft) next.set('q', searchDraft);
      else next.delete('q');
      next.delete('page');
      setSearchParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // Back/forward (or a pasted URL) changes q outside the input — resync the
  // draft unless the operator is mid-typing.
  useEffect(() => {
    if (document.activeElement?.getAttribute('aria-label') !== 'Search people' && filters.search !== searchDraft) {
      setSearchDraft(filters.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  function patch(changes) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '' || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }

  const queryParams = useMemo(() => ({
    page: filters.page,
    limit: PAGE_SIZE,
    ...(filters.search ? { q: filters.search } : {}),
    sort: filters.sort,
  }), [filters]);

  const people = useConsumers(queryParams);
  const rows = people.data?.rows || [];
  const total = people.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filters.page * PAGE_SIZE, total);

  // The person view of the existing profile — never a new detail surface.
  const openPerson = (r) => {
    if (!r.latestProspectId) return;
    navigate(`/admin/leads/${r.latestProspectId}?view=profile`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  return (
    <div>
      <PageHeader title="People" meta={`${total.toLocaleString('en-SG')} LINKED PEOPLE · SERVER-SIDE 25/PAGE`} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="av2-input" style={{ maxWidth: 320 }}>
          <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>⌕</span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name, phone, email"
            aria-label="Search people"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'inherit' }}
          />
        </div>
      </div>

      <div className="av2-card" style={{ overflow: 'hidden' }}>
        <div className="av2-thead">
          <SortHeader label="Person" field="name" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} />
          <span className="av2-microcaps" style={{ width: 130, flex: 'none' }}>Phone</span>
          <SortHeader label="Signups" field="signupCount" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={150} />
          <SortHeader label="Meet" field="meetScore" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={58} align="right" />
          <SortHeader label="Buy" field="buyScore" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={58} align="right" />
          <SortHeader label="Last seen" field="lastSeenAt" sort={filters.sort} onSort={(s) => patch({ sort: s, page: null })} width={100} align="right" />
        </div>

        {people.isLoading && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="av2-row" style={{ cursor: 'default' }}><Skeleton height={32} /></div>
        ))}
        {people.isError && <ErrorState error={people.error} onRetry={people.refetch} />}
        {!people.isLoading && !people.isError && rows.length === 0 && (
          <EmptyState
            title={filters.search ? 'No people match this search' : 'No linked people yet'}
            hint={filters.search
              ? 'Search matches name, email, and phone digits. Erased people are browsable but never searchable.'
              : 'People appear here once a signup links to the consumer spine.'}
            action={filters.search && (
              <button type="button" className="av2-btn av2-btn--sm" onClick={() => { setSearchDraft(''); patch({ q: null, page: null }); }}>Clear search</button>
            )}
          />
        )}

        {rows.map((r) => {
          const erased = !!r.erasedAt;
          const name = `${r.firstName || ''} ${r.lastName || ''}`.trim();
          const clickable = !!r.latestProspectId;
          return (
            <div
              key={r.id}
              className="av2-row"
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              style={clickable ? undefined : { cursor: 'default' }}
              onClick={() => openPerson(r)}
              onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPerson(r); } }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: erased ? 'var(--ink-2)' : 'var(--ink)' }}>
                    {erased ? 'Erased person' : (name || '—')}
                  </span>
                  {erased && <Chip tone="bad" glyph="⊘">erased</Chip>}
                </span>
                <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {erased ? '—' : (r.email || '—')}
                </span>
              </span>
              <span className="av2-mono" style={{ width: 130, flex: 'none', fontSize: 11, color: 'var(--ink-2)' }}>
                {fmtPhone(r.phone) || '—'}
              </span>
              <span style={{ width: 150, flex: 'none', fontSize: 12, color: 'var(--ink-2)' }}>
                {r.signupCount} signup{r.signupCount === 1 ? '' : 's'} ({r.verifiedSignupCount} verified)
              </span>
              {/* Erased people keep no profile row (§9) — show nothing rather
                  than a stale number. */}
              <ScoreCell value={erased ? null : r.meetScore} scored={!erased && r.scoredConfigVersion != null} kind="Meet" />
              <ScoreCell value={erased ? null : r.buyScore} scored={!erased && r.scoredConfigVersion != null} kind="Buy" />
              <span className="av2-mono" style={{ width: 100, flex: 'none', fontSize: 10, color: 'var(--ink-3)', textAlign: 'right' }} title={fmtDateTime(r.lastSeenAt)}>
                {fmtRelative(r.lastSeenAt)}
              </span>
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
          <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {rangeStart}–{rangeEnd} of {total.toLocaleString('en-SG')}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="av2-btn av2-btn--sm" disabled={filters.page <= 1} onClick={() => patch({ page: String(filters.page - 1) })}>← Prev</button>
          <button type="button" className="av2-btn av2-btn--sm" disabled={filters.page >= totalPages} onClick={() => patch({ page: String(filters.page + 1) })}>Next →</button>
        </div>
      </div>

      {/* Persistent scope note — the total above is LINKED people, and that is
          not everyone: voice/pre-spine leads have no person row (§3.1). */}
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10 }}>
        Voice (Retell) and pre-spine leads have no linked person — find them in Prospects.
      </div>
    </div>
  );
}
