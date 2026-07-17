/**
 * Global search palette (⌘K) — the topbar pill is a real search, not a
 * Prospects shortcut. Leads hit GET /prospects?search= server-side; campaigns
 * and agents filter already-cached rosters client-side (same query keys as the
 * dashboard leaderboard / assign picker, so a warm cache costs zero requests);
 * page routes match on their sidebar labels. Selection deep-links: a lead
 * lands on Prospects pre-filtered with its drawer auto-opened (?q=…&lead=…),
 * a campaign opens /admin/campaigns/:id, an agent lands on the roster
 * pre-filtered (?q=…). The last row is always "search in Prospects", so ↵
 * never dead-ends.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchProspects, fetchCampaignsList, fetchAgentOptions } from '@/api/adminV2';
import { NAV } from '@/lib/adminV2/nav';

const MIN_QUERY = 2; // entity endpoints; page-label matching starts at 1 char
const GROUP_LIMIT = 5;

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const pillRef = useRef(null);
  const wasOpen = useRef(false);

  // ⌘K / Ctrl+K toggles the palette from anywhere in the admin shell.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setQ('');
      setDq('');
      setActive(0);
    } else if (wasOpen.current) {
      // Restore focus to the trigger on close (never on initial mount).
      wasOpen.current = false;
      pillRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const searching = open && dq.length >= MIN_QUERY;

  const leads = useQuery({
    queryKey: ['adminV2', 'palette', 'leads', dq],
    queryFn: () => fetchProspects({ search: dq, limit: GROUP_LIMIT, sort: '-createdAt' }),
    enabled: searching,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  const campaigns = useQuery({
    queryKey: ['adminV2', 'campaigns', '30d'],
    queryFn: () => fetchCampaignsList('30d'),
    enabled: searching,
    staleTime: 60_000,
  });
  const agents = useQuery({
    queryKey: ['adminV2', 'agentOptions'],
    queryFn: fetchAgentOptions,
    enabled: searching,
    staleTime: 300_000,
  });

  const groups = useMemo(() => {
    const needle = dq.toLowerCase();
    const trimmed = q.trim().toLowerCase();
    const out = [];

    if (searching) {
      out.push({
        label: 'Leads',
        busy: leads.isFetching,
        rows: (leads.data?.rows || []).map((p) => {
          const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email || p.phone || 'Lead';
          return {
            id: `av2-opt-lead-${p.id}`,
            title: name,
            sub: [p.phone, p.campaign?.name].filter(Boolean).join(' · ') || p.email || '',
            to: `/AdminProspects?q=${encodeURIComponent(p.phone || p.email || name)}&lead=${encodeURIComponent(p.id)}`,
          };
        }),
      });
      out.push({
        label: 'Campaigns',
        busy: campaigns.isFetching,
        rows: (campaigns.data?.rows || [])
          .filter((c) => (c.name || '').toLowerCase().includes(needle))
          .slice(0, GROUP_LIMIT)
          .map((c) => ({
            id: `av2-opt-campaign-${c.id}`,
            title: c.name || 'Campaign',
            sub: c.status || '',
            to: `/admin/campaigns/${c.id}`,
          })),
      });
      out.push({
        label: 'Agents',
        busy: agents.isFetching,
        rows: (agents.data || [])
          .filter((a) => [a.name, a.email, a.phone].filter(Boolean).some((s) => s.toLowerCase().includes(needle)))
          .slice(0, GROUP_LIMIT)
          .map((a) => ({
            id: `av2-opt-agent-${a.id}`,
            title: a.name || a.email || 'Agent',
            sub: [a.phone, a.email].filter(Boolean).join(' · '),
            to: `/AdminAgents?q=${encodeURIComponent(a.name || a.email || '')}`,
          })),
      });
    }

    if (trimmed.length >= 1) {
      out.push({
        label: 'Pages',
        rows: NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })))
          .filter((i) => i.label.toLowerCase().includes(trimmed))
          .map((i) => ({ id: `av2-opt-page-${i.to}`, title: i.label, sub: i.section, to: i.to })),
      });
    }

    if (searching) {
      out.push({
        label: null,
        rows: [{
          id: 'av2-opt-fallback',
          title: `Search “${dq}” in Prospects`,
          sub: 'full table search',
          to: `/AdminProspects?q=${encodeURIComponent(dq)}`,
        }],
      });
    }
    return out;
  }, [searching, dq, q, leads.data, leads.isFetching, campaigns.data, campaigns.isFetching, agents.data, agents.isFetching]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const settled = !leads.isFetching && !campaigns.isFetching && !agents.isFetching;
  const anyError = leads.isError || campaigns.isError || agents.isError;
  const nothingFound = searching && settled && !anyError && flat.length === 1; // fallback row only

  useEffect(() => { setActive(0); }, [dq]);
  useEffect(() => {
    if (active > 0 && active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);
  useEffect(() => {
    // Optional call — jsdom has no scrollIntoView.
    if (flat[active]) document.getElementById(flat[active].id)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, flat]);

  const select = (row) => {
    if (!row) return;
    setOpen(false);
    navigate(row.to);
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); select(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  let optionIndex = -1;

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        onClick={() => setOpen(true)}
        title="Search leads, campaigns, agents (⌘K)"
        style={{
          flex: '0 1 320px', height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
          boxSizing: 'border-box', cursor: 'pointer', fontFamily: 'var(--font-ui)',
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, flex: 'none' }} aria-hidden="true">
          <path d="M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" fill="none" stroke="var(--ink-3)" strokeWidth="2" />
          <path d="M16.2 16.2 21 21" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textAlign: 'left' }}>Search leads, campaigns, agents</span>
        <span className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-strong)', borderRadius: 5, padding: '1px 5px' }}>⌘K</span>
      </button>

      {open && (
        // Plain fixed divs (no portal) so the palette stays inside the
        // .admin-v2 subtree and inherits the [data-theme] CSS variables.
        <div
          onMouseDown={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(9, 11, 16, .42)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            onMouseDown={(e) => e.stopPropagation()}
            // The input is the dialog's only tab stop (options are pointer/
            // arrow-key targets) — swallow Tab so focus can't reach the page
            // behind the overlay.
            onKeyDown={(e) => { if (e.key === 'Tab') e.preventDefault(); }}
            style={{
              width: 'min(600px, 92vw)', marginTop: '12vh', background: 'var(--surface)',
              border: '1px solid var(--line-strong)', borderRadius: 14, boxShadow: 'var(--shadow)',
              overflow: 'hidden', boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 50, borderBottom: '1px solid var(--line)' }}>
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, flex: 'none' }} aria-hidden="true">
                <path d="M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" fill="none" stroke="var(--ink-3)" strokeWidth="2" />
                <path d="M16.2 16.2 21 21" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search leads, campaigns, agents…"
                aria-label="Global search"
                role="combobox"
                aria-expanded="true"
                aria-controls="av2-palette-list"
                aria-activedescendant={flat[active]?.id}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--ink)' }}
              />
              <span className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-strong)', borderRadius: 5, padding: '1px 5px', flex: 'none' }}>esc</span>
            </div>

            <div id="av2-palette-list" role="listbox" aria-label="Search results" style={{ maxHeight: 400, overflowY: 'auto', padding: 6 }}>
              {!searching && q.trim().length < 1 && (
                <div className="av2-mono" style={{ padding: '18px 12px', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>
                  Type to search leads, campaigns, agents and pages
                </div>
              )}
              {nothingFound && (
                <div className="av2-mono" style={{ padding: '14px 12px 6px', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>
                  No direct matches for “{dq}”
                </div>
              )}
              {searching && anyError && settled && (
                <div className="av2-mono" style={{ padding: '14px 12px 6px', fontSize: 11, color: 'var(--bad)', textAlign: 'center' }}>
                  Search hit an error — results may be incomplete
                </div>
              )}
              {groups.map((g, gi) => {
                if (g.rows.length === 0) return null;
                return (
                  <div key={g.label || `group-${gi}`} style={{ paddingTop: gi === 0 ? 0 : 4 }}>
                    {g.label && (
                      <div className="av2-microcaps" aria-hidden="true" style={{ padding: '8px 10px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {g.label}
                        {g.busy && <span className="av2-mono" style={{ fontSize: 9, color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>searching…</span>}
                      </div>
                    )}
                    {g.rows.map((r) => {
                      optionIndex += 1;
                      const i = optionIndex;
                      const isActive = i === active;
                      return (
                        <div
                          key={r.id}
                          id={r.id}
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => select(r)}
                          style={{
                            display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 10px',
                            borderRadius: 8, cursor: 'pointer',
                            background: isActive ? 'var(--surface-2)' : 'transparent',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                          <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'right' }}>{r.sub}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="av2-mono" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 10, color: 'var(--ink-3)', display: 'flex', gap: 14 }}>
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
