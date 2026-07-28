/**
 * Lead Profile — master-detail (design handoff: Lead Profile — Redesign v2).
 *
 * One route, two URL-addressable views:
 *   /admin/leads/:id               → the SIGNUP DRILL-IN for that lead (outcome
 *                                    hero + signup detail + screening) — what a
 *                                    Prospects row click lands on.
 *   /admin/leads/:id?view=profile  → the PERSON PROFILE (identity + campaigns
 *                                    list + person-wide history). Campaign rows
 *                                    navigate to that signup's drill-in.
 *
 * A sticky command bar (back link · compact identity · Delete / Return to held /
 * Assign) rides above both views; Assign is a two-step menu from the profile
 * (which campaign's lead? → which agent?) and a one-step menu from a drill-in.
 * Data: GET /prospects/:id?include=profile (PR #269) — outcome voices are the
 * same lifecycle-honest strings the backend contract defines.
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProspectProfile, useAgentOptions } from '@/hooks/queries/useAdminV2';
import { bulkAssign, bulkReturnToHeld, bulkDelete, fetchConsentCopy } from '@/api/adminV2';
import { STATUS_LABELS, SOURCE_LABELS, heldLabel } from '@/lib/adminV2/constants';
import { fmtDateTime, fmtDate, fmtDay, fmtSGDExact } from '@/lib/adminV2/format';
import { Card, Chip, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { rowChipFor } from '@/lib/adminV2/outcome';
import CallRecordingPlayer from '@/components/prospects/CallRecordingPlayer';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useAdminV2Mobile } from '@/components/adminv2/mobile/useAdminV2Mobile';
import MobileSheet, { SheetHead, SheetMenuItem } from '@/components/adminv2/mobile/MobileSheet';
import { MobileActionBar, MobilePrimaryBtn, MobileMoreBtn } from '@/components/adminv2/mobile/MobileBars';
// The page's pure data layer — extracted so it can be tested directly (P3-3).
import {
  fullName,
  sameName,
  sgtTime,
  sgtDayKey,
  fmtPhone,
  campaignAccent,
  evidenceOf,
  heroFor,
  receiptBits,
  buildHistory,
} from '@/lib/adminV2/leadHistory';
// The page's shared presentational primitives and the Lead Score card, split
// out of this file (P3-3) — same markup, just no longer interleaved.
import { HoverHint, KvRow, Disclosure, GlyphTile } from './leadProfile/primitives';
import { LeadScoreCard, LeadScoreBadge, EnrichmentCard } from './leadProfile/LeadScoreCard';

// ── shared bits ─────────────────────────────────────────────────────────────


/** Tri-state OTP evidence (backend `verificationEvidence`). "UNRECORDED" is
 * deliberately not "UNVERIFIED" — for signups before the 2026-07-09 stamp we
 * hold no proof either way, and the form has hard-gated submit on a passed OTP
 * since 2025-09-03. Falls back to the legacy boolean for older payloads. */
const VERIFICATION_LABEL = {
  verified: { text: 'VERIFIED ✓', hint: 'OTP proof is on file and still binds to this number.' },
  unverified: { text: 'UNVERIFIED', hint: 'No OTP proof on file for the number currently on this lead.' },
  unrecorded: { text: 'UNRECORDED', hint: 'Signed up before the server stored OTP proof (2026-07-09). The form required a passed OTP to submit, so this is a gap in our records — not a lead that skipped verification.' },
};







/** The exact wording a consent version stamped — themed overlay, closes on
 * backdrop click or ✕. Draw-terms clauses arrive as pinned designer HTML
 * (our own stored bytes, same trust as the public campaign page rendering
 * them); registry clauses are plain text. */
function ConsentCopyModal({ view, onClose }) {
  if (!view) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(620px, 100%)', maxHeight: '74vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 22px 22px', fontFamily: 'var(--font-ui)', boxShadow: '0 24px 60px rgba(0,0,0,.45)' }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>Consent wording</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{view.version}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontSize: 15, padding: 2 }} aria-label="Close">✕</button>
        </div>
        {view.loading && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Loading…</div>}
        {!view.loading && view.missing && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            No stored wording for this version — it predates the consent-copy registry.
          </div>
        )}
        {!view.loading && (view.clauses || []).map((c, i) => (
          <div key={i} style={{ marginBottom: i < view.clauses.length - 1 ? 16 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
              {c.label || c.kind}
              {c.scope ? ` · ${c.scope} scope` : ''}
              {Array.isArray(c.channels) && c.channels.length ? ` · ${c.channels.join(', ')}` : ''}
            </div>
            {c.format === 'html'
              ? <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }} dangerouslySetInnerHTML={{ __html: c.copy }} />
              : <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{c.copy}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── history composition (family + tag per row; grouped by SGT day) ──────────


function ConsentKv({ label, state, legacy }) {
  const granted = state ? state.granted : legacy;
  if (granted === undefined || granted === null) return null;
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '4px 0', alignItems: 'baseline' }}>
      <span style={{ width: 96, flex: 'none', color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
        <span style={{ color: granted ? 'var(--ok)' : 'var(--bad)' }}>{granted ? '✓' : '✗'}</span>
        {' '}{granted ? 'granted' : 'denied'}
        {state?.scope === 'global' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}> · global</span>}
        {!state && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}> · legacy</span>}
      </span>
    </div>
  );
}



// ── the page ────────────────────────────────────────────────────────────────

/** Back-link origins the profile honors (admin-people-directory §3.4). */
const FROM_LABELS = { '/AdminProspects': 'Prospects', '/AdminPeople': 'People' };
const COHORT_FROM_RE = /^\/admin\/cohorts\/[0-9a-f-]{36}$/;

export default function AdminV2LeadProfile() {
  const { prospectId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const view = searchParams.get('view') === 'profile' ? 'profile' : 'signup';
  // Delete confirm: null | targetId — the picked signup, not always the URL's.
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Command picker: stage null | 'campaign' | 'agent', with the ACTION it is
  // picking for — assign advances campaign→agent, return/delete act on the
  // picked campaign directly (§3.5: person-origin mutations pick explicitly).
  const [menu, setMenu] = useState(null);
  const [menuAction, setMenuAction] = useState(null);
  const [menuTarget, setMenuTarget] = useState(null);
  const mobile = useAdminV2Mobile();
  // Mobile ⋯ overflow sheet (Return to held / Delete live there on phones).
  const [mobileMenu, setMobileMenu] = useState(false);
  // Consent-version click-through: null | { version, loading, clauses?, missing? }
  const [consentCopyView, setConsentCopyView] = useState(null);
  const openConsentCopy = useCallback(async (version) => {
    setConsentCopyView({ version, loading: true });
    try {
      const data = await fetchConsentCopy(version);
      setConsentCopyView({ version, loading: false, clauses: data?.clauses || null, missing: !data });
    } catch {
      setConsentCopyView({ version, loading: false, clauses: null, missing: true });
    }
  }, []);
  useEffect(() => { setMenu(null); setMenuAction(null); }, [prospectId, view]);
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // Canonical-equality validation: the raw state.from must equal its own
  // parsed pathname+search (one comparison rules out dot segments,
  // backslashes, //network-path refs and fragments — new URL() NORMALIZES
  // dot segments, so an allowlist check alone could be walked into), then
  // the pathname must match a known list page exactly.
  const { from, fromLabel } = useMemo(() => {
    const fallback = { from: '/AdminProspects', fromLabel: 'Prospects' };
    const raw = location.state?.from;
    if (typeof raw !== 'string' || !raw.startsWith('/')) return fallback;
    let url;
    try { url = new URL(raw, window.location.origin); } catch { return fallback; }
    if (url.origin !== window.location.origin) return fallback;
    if (raw !== `${url.pathname}${url.search}`) return fallback;
    if (FROM_LABELS[url.pathname]) return { from: raw, fromLabel: FROM_LABELS[url.pathname] };
    if (COHORT_FROM_RE.test(url.pathname)) return { from: raw, fromLabel: 'Cohort' };
    return fallback;
  }, [location.state]);
  const goSignup = useCallback((id) => navigate(`/admin/leads/${id}`, { state: { from } }), [navigate, from]);
  const goProfile = useCallback(() => navigate(`/admin/leads/${prospectId}?view=profile`, { state: { from } }), [navigate, prospectId, from]);

  const profile = useProspectProfile(prospectId);
  const p = profile.data;
  const journey = p?.consumer || null;
  const person = journey?.consumer || null;
  const erased = Boolean(person?.erasedAt);
  const agentOptions = useAgentOptions(true);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'prospects'] });
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'prospectProfile'] });
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'prospectDetail'] });
  };
  const assignMutation = useMutation({
    mutationFn: ({ targetId, agentId }) => bulkAssign([targetId], agentId),
    onSuccess: (r, { agentName }) => {
      const n = r?.data?.affectedCount ?? 0;
      if (n > 0) toast.success(`Assigned to ${agentName}`);
      else toast.warning('Not assigned — lead not eligible');
      invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Assign failed'),
  });
  const returnMutation = useMutation({
    mutationFn: ({ targetId } = {}) => bulkReturnToHeld([targetId || prospectId]),
    onSuccess: (r) => {
      const n = r?.data?.returned ?? 0;
      if (n > 0) toast.success('Returned to held');
      else toast.warning('Not returned — already held or not eligible');
      invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Return failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ targetId } = {}) => bulkDelete([targetId || prospectId]),
    onSuccess: (r, vars) => {
      const n = r?.data?.deleted ?? 0;
      setConfirmDelete(null);
      invalidate();
      if (n > 0) {
        toast.success('Lead deleted');
        // Leaving the page only makes sense when the URL's own anchor died;
        // deleting a SIBLING signup from the profile view stays put.
        if (!vars?.targetId || String(vars.targetId) === String(prospectId)) navigate(from);
      } else toast.warning('Nothing deleted');
    },
    onError: (e) => { toast.error(e?.message || 'Delete failed'); setConfirmDelete(null); },
  });

  // Rail rows: journey signups, else this prospect alone (consumer-less B4).
  const railSignups = useMemo(() => {
    if (journey?.signups?.length) return journey.signups;
    if (!p) return [];
    return [{
      prospectId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      campaign: p.campaign ? { id: p.campaign.id, name: p.campaign.name, status: p.campaign.status } : null,
      leadStatus: p.leadStatus,
      leadSource: p.leadSource,
      createdAt: p.createdAt,
      held: !!p.quarantinedAt,
      verified: false,
      verificationEvidence: evidenceOf(p),
      draw: p.signupProfile?.draw ?? null,
      rewardDiagnostic: p.signupProfile?.rewardDiagnostic ?? null,
      agentName: p.assignedAgent ? fullName(p.assignedAgent) : null,
      externalBuyer: Boolean(p.externalAgentId),
      // Consumer-less leads ARE scored — findStaleLeadIds admits them
      // explicitly — so the fallback must carry the score too, or the one
      // page about a Retell voice lead claims it was never scored.
      score: p.score ?? null,
      scoredAt: p.scoreComputedAt ?? null,
      _fallback: true,
    }];
  }, [journey, p]);

  const rewardsByCampaign = useMemo(() => {
    const map = new Map();
    const list = journey?.entitlements || p?.signupProfile?.entitlements || [];
    for (const e of list) {
      if (e.drawLinked) continue;
      const k = String(e.campaignId || (p?.signupProfile ? p?.campaign?.id : '') || '');
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return map;
  }, [journey, p]);

  const rewardsFor = useCallback(
    (s) => (s.campaign ? rewardsByCampaign.get(String(s.campaign.id)) || [] : []),
    [rewardsByCampaign],
  );

  const history = useMemo(() => (p ? buildHistory(p, journey) : []), [p, journey]);
  const historyDays = useMemo(() => {
    const days = [];
    let current = null;
    for (const e of history.slice(0, 120)) {
      const key = sgtDayKey(e.at);
      if (!current || current.key !== key) { current = { key, events: [] }; days.push(current); }
      current.events.push(e);
    }
    return days;
  }, [history]);

  const currentSignup = railSignups.find((s) => String(s.prospectId) === String(prospectId)) || railSignups[0] || null;
  const consent = journey?.signups?.find((s) => String(s.prospectId) === String(prospectId))?.consent
    || currentSignup?.consent || null;

  if (profile.isLoading) {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <Skeleton height={280} style={{ borderRadius: 14 }} />
          <Skeleton height={280} style={{ borderRadius: 14 }} />
          <div style={{ gridColumn: '1 / -1' }}><Skeleton height={300} style={{ borderRadius: 14 }} /></div>
        </div>
      </div>
    );
  }
  if (profile.isError || !p) {
    return (
      <div>
        <Link to={from} className="av2-btn av2-btn--sm" style={{ textDecoration: 'none', marginBottom: 16, display: 'inline-flex' }}>← {fromLabel}</Link>
        <ErrorState error={profile.error || new Error("Couldn't load this lead — it may have been deleted.")} onRetry={profile.refetch} />
      </div>
    );
  }

  const held = !!p.quarantinedAt;
  const canonicalName = fullName(person) || fullName(p) || 'Lead';
  const phone = fmtPhone(person?.phone || p.phone);
  const isVoiceLead = p.leadSource === 'call_bot';
  const dob = p.demographics?.dateOfBirth || null;
  const quiz = p.sourceMetadata?.quiz || null;
  const sm = p.screeningMetadata || {};
  const verdictDetail = sm.verdictDetail || {};
  const screeningAttempts = Object.values(sm.attempts || {})
    .filter((a) => a && a.startedAt)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const screeningCostCents = screeningAttempts.reduce((s, a) => s + (Number(a.costCents) || 0), 0);
  const hasScreening = p.screeningVerdict || p.screeningMetadata || String(p.quarantineReason || '').startsWith('screening_');

  const assignButtonLabel = view === 'profile' ? 'Assign to agent ▾' : 'Assign this lead ▾';
  // One opener for all three command-bar actions: in profile view with >1
  // signup every action picks its campaign first (the URL's anchor is just
  // the newest signup — not an operator choice); in drill-in the anchor IS
  // the choice, so return/delete act directly and assign goes straight to
  // the agent stage.
  const openAction = (action) => {
    if (menu) { setMenu(null); setMenuAction(null); return; }
    if (view === 'profile' && railSignups.length > 1) {
      setMenuAction(action); setMenu('campaign'); setMenuTarget(null);
      return;
    }
    if (action === 'assign') {
      setMenuAction('assign'); setMenu('agent');
      setMenuTarget(currentSignup?.prospectId || prospectId);
    } else if (action === 'return') {
      returnMutation.mutate({ targetId: currentSignup?.prospectId || prospectId });
    } else {
      setConfirmDelete(currentSignup?.prospectId || prospectId);
    }
  };
  const pickCampaign = (s) => {
    if (menuAction === 'assign') { setMenu('agent'); setMenuTarget(s.prospectId); return; }
    setMenu(null); setMenuAction(null);
    if (menuAction === 'return') returnMutation.mutate({ targetId: s.prospectId });
    else setConfirmDelete(s.prospectId);
  };
  const menuTargetSignup = railSignups.find((s) => String(s.prospectId) === String(menuTarget)) || null;
  // Delete-confirm copy names the PICKED signup's campaign, not the URL's.
  const confirmSignup = railSignups.find((s) => String(s.prospectId) === String(confirmDelete)) || currentSignup;

  const consentVersions = consent
    ? [...new Set(Object.values(consent).map((c) => c?.version).filter(Boolean))]
    : [];

  // ── signup drill-in pieces ──
  const currentDraw = currentSignup?.draw || null;
  const currentRewards = currentSignup ? rewardsFor(currentSignup).length ? rewardsFor(currentSignup) : (p.signupProfile?.entitlements?.filter((e) => !e.drawLinked) || []) : [];
  const hero = heroFor(currentDraw, currentRewards, currentSignup?.rewardDiagnostic);
  const heroReceipts = [
    ...receiptBits(currentRewards[0]?.delivery),
    ...((journey?.entitlements || p?.signupProfile?.entitlements || [])
      .filter((e) => e.drawLinked && String(e.campaignId || '') === String(currentSignup?.campaign?.id || ''))
      .slice(0, 1)
      .flatMap((e) => receiptBits(e.delivery))),
  ];
  const heroToneColor = hero.tone === 'ok' ? 'var(--ok)' : hero.tone === 'quiet' ? 'var(--ink-2)' : 'var(--ink)';

  return (
    <div>
      {/* ── Command bar: sticky under the desktop topbar; on mobile a plain
             identity row (actions live in the bottom action bar instead) ── */}
      <div style={mobile
        ? { display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0 10px', marginBottom: 12, borderBottom: '1px solid var(--line)' }
        : { position: 'sticky', top: 64, zIndex: 30, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', background: 'var(--canvas)', borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <Link to={from} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none', flex: 'none' }}>← {fromLabel}</Link>
        <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--line-strong)', flex: 'none' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {`${canonicalName.toUpperCase()}${phone ? ` · ${phone}` : ''}`}
        </span>
        <span style={{ flex: 1 }} />
        {!mobile && (
        <div style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="av2-btn av2-btn--sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--bad)' }} onClick={() => openAction('delete')}>Delete</button>
          {/* Erased people cannot be re-dispatched — the backend bulk paths
              don't fence this yet (tracker follow-up), so the controls that
              would recreate operational records are suppressed here. */}
          {!erased && (
            <button type="button" className="av2-btn av2-btn--sm" disabled={returnMutation.isPending} onClick={() => openAction('return')}>Return to held</button>
          )}
          {!erased && (
            <button type="button" className="av2-btn av2-btn--sm av2-btn--primary" aria-haspopup="menu" aria-expanded={!!menu} disabled={assignMutation.isPending} onClick={() => openAction('assign')}>
              {assignButtonLabel}
            </button>
          )}
          {menu && (
            <>
              <div onClick={() => setMenu(null)} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
              <div role="menu" aria-label={menuAction === 'return' ? 'Return lead' : menuAction === 'delete' ? 'Delete lead' : 'Assign lead'} style={{ position: 'absolute', right: 0, top: 40, zIndex: 70, width: 264, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12, boxShadow: 'var(--shadow)', padding: 8, boxSizing: 'border-box' }}>
                {menu === 'campaign' && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-2)', padding: '4px 10px 6px' }}>Which campaign's lead?</div>
                    {railSignups.map((s) => (
                      <button
                        key={s.prospectId}
                        type="button"
                        role="menuitem"
                        onClick={() => pickCampaign(s)}
                        style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
                      >
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{s.campaign?.name || 'No campaign'}</span>
                        <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>
                          agent: {s.agentName || (s.externalBuyer ? 'external buyer' : 'unassigned')}
                        </span>
                      </button>
                    ))}
                  </>
                )}
                {menu === 'agent' && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-2)', padding: '4px 10px 6px' }}>
                      Assign {menuTargetSignup?.campaign?.name || 'this'} lead to
                    </div>
                    {(agentOptions.data || []).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="menuitem"
                        onClick={() => { setMenu(null); assignMutation.mutate({ targetId: menuTarget || prospectId, agentId: a.id, agentName: a.name }); }}
                        style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', boxSizing: 'border-box', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{a.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>LYFE</span>
                      </button>
                    ))}
                    {agentOptions.isLoading && <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 10px' }}>Loading agents…</div>}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* ── Page-level banners ── */}
      {erased && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bad-soft)', color: 'var(--bad)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, fontWeight: 700 }}>
          <span aria-hidden="true" style={{ flex: 'none' }}>⊘</span>
          This person was erased on {fmtDate(person.erasedAt)} — profile shows only what the allowlist rebuild kept.
        </div>
      )}
      {!journey && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--line-strong)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, fontWeight: 600 }}>
          <span aria-hidden="true" style={{ flex: 'none', color: 'var(--ink-3)' }}>{isVoiceLead ? '☏' : '○'}</span>
          {isVoiceLead
            ? 'Retell voice lead — the call carries no caller phone, so there is no cross-campaign identity.'
            : evidenceOf(p) === 'unrecorded'
              ? 'No linked person yet — this signup predates the OTP proof the identity spine links on. Showing this signup only.'
              : 'No linked person yet (phone unverified) — showing this signup only.'}
        </div>
      )}

      {view === 'profile' ? (
        <>
          {/* ── Person profile view ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start', marginBottom: 16 }}>
            <section className="av2-card">
              <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--line)' }}>
                <div className="av2-microcaps">Person</div>
                <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.015em', color: 'var(--ink)', lineHeight: 1.1 }}>{canonicalName}</h1>
                {phone && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', letterSpacing: '.02em', marginTop: 5 }}>{phone}</div>}
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginTop: 4 }}>
                  {person
                    ? `${person.signupCount} signup${person.signupCount === 1 ? '' : 's'} (${person.verifiedSignupCount} verified) · first seen ${fmtDate(person.firstSeenAt)}`
                    : '1 signup · no cross-campaign identity'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <Chip tone="accent">{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>
                  {held && <Chip tone="hold" glyph="◆">{heldLabel(p).full}</Chip>}
                  {p.screeningVerdict && (
                    <Chip tone={p.screeningVerdict === 'qualified' ? 'ok' : 'bad'} glyph={p.screeningVerdict === 'qualified' ? '✓' : '✗'}>
                      {p.screeningVerdict === 'qualified' ? 'AI qualified' : 'AI failed'}
                    </Chip>
                  )}
                  {erased && <Chip tone="bad" glyph="⊘">erased</Chip>}
                </div>
              </div>
              <div style={{ padding: '10px 18px 8px' }}>
                <div className="av2-microcaps" style={{ padding: '2px 0 4px' }}>Consent &amp; reachability</div>
                {!erased && (p.email || person?.email) && <KvRow label="email">{p.email || person?.email}</KvRow>}
                {!erased && dob && <KvRow label="date of birth">{fmtDate(dob)}</KvRow>}
                <ConsentKv label="marketing" state={consent?.contact} legacy={p.sourceMetadata?.consent_contact} />
                <ConsentKv label="terms" state={consent?.campaign_terms} legacy={p.sourceMetadata?.consent_terms} />
                <ConsentKv label="third-party" state={consent?.third_party} legacy={p.sourceMetadata?.consent_third_party} />
                {p.dncStatus && (
                  <div style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '4px 0', alignItems: 'baseline' }}>
                    <span style={{ width: 96, flex: 'none', color: 'var(--ink-3)' }}>DNC</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
                      {(p.dncNoVoiceCall || p.dncNoTextMessage)
                        ? `no ${[p.dncNoVoiceCall && 'voice', p.dncNoTextMessage && 'SMS'].filter(Boolean).join(' + ')}`
                        : p.dncStatus}
                      {p.dncCheckedAt && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                          {' '}· checked {fmtDate(p.dncCheckedAt)}{p.dncValidUntil ? ` · valid to ${fmtDate(p.dncValidUntil)}` : ''}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {journey?.broadcasts && Object.keys(journey.broadcasts.counts).length > 0 && (
                  <div style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '4px 0', alignItems: 'baseline' }}>
                    <span style={{ width: 96, flex: 'none', color: 'var(--ink-3)' }}>broadcasts</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
                      {Object.values(journey.broadcasts.counts).reduce((a, b) => a + b, 0)} — {Object.entries(journey.broadcasts.counts).map(([k, v]) => `${v} ${k}`).join(' · ')}
                      {journey.suppressions?.length > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}> · suppressed</span>}
                    </span>
                  </div>
                )}
              </div>
              {consentVersions.length > 0 && (
                <Disclosure label="Raw consent versions" count={`${consentVersions.length} VERSION${consentVersions.length === 1 ? '' : 'S'}`} indent={36}>
                  {Object.entries(consent || {}).filter(([, c]) => c?.version).map(([kind, c]) => (
                    <div key={kind} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '2px 0' }}>
                      <button
                        type="button"
                        onClick={() => openConsentCopy(c.version)}
                        title="Show the exact wording this version stamped"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-text)', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                      >{c.version}</button>
                      {' '}· {kind.replace(/_/g, ' ')} · {c.scope} scope{c.occurredAt ? ` · ${fmtDate(c.occurredAt)}` : ''}
                    </div>
                  ))}
                </Disclosure>
              )}
            </section>

            {/* Absent until the sweep has scored this person (and gone for
                erased people, whose profile row is deleted) — an empty
                scoring card would imply a verdict we haven't reached. */}
            {journey?.enrichment && <EnrichmentCard enrichment={journey.enrichment} />}

            <Card title="Campaigns" meta={`${railSignups.length} SIGNUP${railSignups.length === 1 ? '' : 'S'}`}>
              {railSignups.map((s, i) => {
                const draw = s.draw || null;
                const rewards = s._fallback ? (p.signupProfile?.entitlements?.filter((e) => !e.drawLinked) || []) : rewardsFor(s);
                const chip = rowChipFor(draw, rewards);
                const nameVariant = person && fullName(s) && !sameName(s, person);
                const isDraw = Boolean(draw);
                return (
                  <button
                    key={s.prospectId}
                    type="button"
                    onClick={() => goSignup(s.prospectId)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', boxSizing: 'border-box', padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: i < railSignups.length - 1 ? '1px solid var(--line)' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}
                  >
                    <span aria-hidden="true" style={{ width: 32, height: 32, flex: 'none', borderRadius: 9, background: isDraw ? 'var(--hold-soft)' : 'var(--surface-2)', color: isDraw ? 'var(--hold)' : 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>◆</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{s.campaign?.name || 'No campaign'}</span>
                        <Chip tone={isDraw ? 'hold' : ''}>{isDraw ? 'draw' : 'reward'}</Chip>
                        {nameVariant && <Chip tone="warn" glyph="⚠">name variant</Chip>}
                      </span>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 3 }}>
                        {fmtDateTime(s.createdAt).toUpperCase()} · {(SOURCE_LABELS[s.leadSource] || s.leadSource).toUpperCase()} · <span title={VERIFICATION_LABEL[s.verificationEvidence || (s.verified ? 'verified' : 'unverified')].hint}>{VERIFICATION_LABEL[s.verificationEvidence || (s.verified ? 'verified' : 'unverified')].text}</span>
                        {fullName(s) ? ` · AS ${fullName(s).toUpperCase()}` : ''}
                        {s.held ? <span style={{ color: 'var(--hold)' }}> · HELD</span> : null}
                        {' · '}
                        {s.agentName
                          ? <span>AGENT: {s.agentName.toUpperCase()}</span>
                          : s.externalBuyer
                            ? <span>AGENT: EXTERNAL BUYER</span>
                            : <span style={{ color: 'var(--warn)' }}>AGENT: UNASSIGNED</span>}
                      </span>
                    </span>
                    {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
                    {/* Per-row, because each signup carries its OWN score and the
                        card above this one can only ever show the winning lead's. */}
                    <LeadScoreBadge signup={s} />
                    <span aria-hidden="true" style={{ color: 'var(--ink-3)', fontSize: 14, flex: 'none' }}>›</span>
                  </button>
                );
              })}
            </Card>
          </div>

          <Card title="History" meta={history.length > 120 ? `LATEST 120 OF ${history.length} EVENTS` : `EVERY ACTION BY THIS PERSON · ${history.length} EVENT${history.length === 1 ? '' : 'S'}`}>
            {historyDays.length === 0 ? (
              <EmptyState title="Nothing yet" hint="Events land here as they happen." />
            ) : (
              <div style={{ padding: '10px 16px 14px', columnWidth: 340, columnGap: 32 }}>
                {historyDays.map((day) => (
                  <div key={day.key} style={{ breakInside: 'avoid' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink-3)', padding: '4px 0 2px' }}>
                      {fmtDay(day.key).toUpperCase()}
                    </div>
                    {day.events.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0' }}>
                        <GlyphTile family={e.family} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: e.tone === 'bad' ? 'var(--bad)' : e.quiet ? 'var(--ink-2)' : 'var(--ink)', fontWeight: e.quiet ? 500 : 600, lineHeight: 1.35 }}>
                          {e.title}
                          {e.state && <HoverHint label={e.state.text} hint={e.state.hint} color={e.state.ok ? undefined : 'var(--bad)'} />}
                          {e.detail && <span style={{ color: e.tone === 'bad' ? 'var(--bad)' : 'var(--ink-2)', fontWeight: 500 }}>{e.detail}</span>}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', flex: 'none', paddingTop: 2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {e.campaign && (
                            <HoverHint
                              label="●"
                              hint={e.campaign.name}
                              underline={false}
                              color={campaignAccent(e.campaign.key)}
                              ariaLabel={e.campaign.name}
                            />
                          )}
                          {sgtTime(e.at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : (
        <>
          {/* ── Campaign drill-in view ── */}
          <button type="button" onClick={goProfile} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, margin: '0 0 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--accent-text)', fontFamily: 'var(--font-ui)' }}>
            ← {canonicalName} — profile
          </button>

          <section className="av2-card" style={{ padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.015em', color: 'var(--ink)' }}>{currentSignup?.campaign?.name || p.campaign?.name || 'No campaign'}</h1>
              <Chip tone={currentDraw ? 'hold' : ''}>{currentDraw ? 'draw' : 'reward'}</Chip>
              {(currentSignup?.campaign?.id || p.campaign?.id) && (
                <Link to={`/admin/campaigns/${currentSignup?.campaign?.id || p.campaign.id}`} style={{ fontSize: 11.5, fontWeight: 700 }}>campaign page ↗</Link>
              )}
              <span style={{ flex: 1 }} />
              <LeadScoreBadge signup={currentSignup} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>
                SIGNED UP {fmtDateTime(p.createdAt).toUpperCase()} · {(SOURCE_LABELS[p.leadSource] || p.leadSource).toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.015em', color: heroToneColor, lineHeight: 1.15, marginTop: 10 }}>
              {hero.big}
              {hero.tail && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>{hero.tail}</span>}
            </div>
            {hero.meta && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.1em', color: 'var(--ink-3)', marginTop: 4 }}>{hero.meta}</div>
            )}
            {heroReceipts.length > 0 && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginTop: 6 }}>
                {heroReceipts.map((r, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <span style={{ fontWeight: 700 }}>
                      {r.prefix}
                      {' — '}
                      <HoverHint label={r.state.text} hint={r.state.hint} color={r.ok ? 'var(--ok)' : 'var(--bad)'} />
                    </span>
                  </span>
                ))}
              </div>
            )}
            {currentDraw?.drawHistory?.length > 0 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 8 }}>
                {currentDraw.drawHistory.length} earlier draw{currentDraw.drawHistory.length === 1 ? '' : 's'}: {currentDraw.drawHistory.map((h) => h.drawStatus).join(' · ')}
              </div>
            )}
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
            <Card title="Signup detail" meta={fmtDateTime(p.createdAt).toUpperCase()}>
              <div style={{ padding: '12px 16px 8px' }}>
                <div style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '4px 0', alignItems: 'center' }}>
                  <span style={{ width: 96, flex: 'none', color: 'var(--ink-3)' }}>name used</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{fullName(p) || '—'}</span>
                  {person && fullName(p) && !sameName(p, person) && <Chip tone="warn" glyph="⚠">name variant</Chip>}
                </div>
                {!erased && p.email && <KvRow label="email">{p.email}</KvRow>}
                {p.sourceMetadata?.phoneVerifiedAt && (
                  <KvRow label="verified"><span style={{ color: 'var(--ok)' }}>✓</span> {fmtDateTime(p.sourceMetadata.phoneVerifiedAt)}</KvRow>
                )}
                <KvRow label="source">
                  {SOURCE_LABELS[p.leadSource] || p.leadSource}
                  {p.session?.landingPath ? ` → ${p.session.landingPath}` : ''}
                  {p.qrTag ? ` · ${p.qrTag.name}` : ''}
                </KvRow>
                {(p.sourceMetadata?.utm?.utm_source || p.session?.utm?.source) && (
                  <KvRow label="utm">
                    {[
                      p.sourceMetadata?.utm?.utm_source || p.session?.utm?.source,
                      p.sourceMetadata?.utm?.utm_medium || p.session?.utm?.medium,
                      p.sourceMetadata?.utm?.utm_campaign || p.session?.utm?.campaign,
                    ].filter(Boolean).join(' / ')}
                  </KvRow>
                )}
                <div style={{ display: 'flex', gap: 12, fontSize: 12.5, padding: '4px 0', alignItems: 'center' }}>
                  <span style={{ width: 96, flex: 'none', color: 'var(--ink-3)' }}>agent</span>
                  {p.assignedAgent
                    ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{fullName(p.assignedAgent)}</span>
                    : p.externalAgent || p.externalAgentId
                      ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{p.externalAgent?.fullName || 'External buyer'} <span style={{ color: 'var(--ink-3)' }}>· {p.externalAgent?.agency ? `${p.externalAgent.agency} · ` : ''}external buyer</span></span>
                      : <Chip tone="warn" glyph="◆">unassigned</Chip>}
                </div>
                {held && <KvRow label="held" mono={false}><span style={{ fontWeight: 600 }}>{heldLabel(p).full || p.quarantineReason}</span> <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>· since {fmtDate(p.quarantinedAt)}</span></KvRow>}
                <KvRow label="Lyfe delivery">
                  {p.lyfeDelivery
                    ? p.lyfeDelivery.map((ld, i) => (
                      <span key={ld.eventType}>
                        {i > 0 && ' · '}
                        {ld.eventType.replace('lead.', '')}: {ld.status === 'success'
                          ? <><span style={{ color: 'var(--ok)' }}>✓</span> delivered</>
                          : ld.status === 'failed'
                            ? <><span style={{ color: 'var(--bad)' }}>✗</span> failed ×{ld.attempts}{ld.reason ? ` (${ld.reason.replace(/_/g, ' ')})` : ''}</>
                            : '… pending'}
                      </span>
                    ))
                    : <span style={{ color: 'var(--ink-2)' }}>not sent — no app destination</span>}
                </KvRow>
                {currentDraw && p.consentMetadata?.drawTerms?.termsVersionId && (
                  <KvRow label="draw terms">
                    pinned ·{' '}
                    <button
                      type="button"
                      onClick={() => openConsentCopy(p.consentMetadata.drawTerms.termsVersionId)}
                      title="Show the pinned terms as the person saw them"
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--accent-text)', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                    >{String(p.consentMetadata.drawTerms.termsVersionId).slice(0, 8)}</button>
                  </KvRow>
                )}
                {p.nextFollowUpDate && <KvRow label="follow-up">{fmtDateTime(p.nextFollowUpDate)}</KvRow>}
              </div>
              {p.session?.steps?.length > 0 && (
                <Disclosure label="Session funnel" count={`${p.session.steps.length} STEP${p.session.steps.length === 1 ? '' : 'S'}`}>
                  {p.session.steps.slice(0, 12).map((s2, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '3px 0' }}>
                      {s2.at && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', marginRight: 8 }}>{sgtTime(s2.at)}</span>}
                      {s2.type.replace(/_/g, ' ')}{s2.path ? ` — ${s2.path}` : ''}
                    </div>
                  ))}
                </Disclosure>
              )}
              {quiz && (
                <Disclosure label="Quiz answers" count={`${Object.keys(quiz).length}`}>
                  {Object.entries(quiz)
                    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
                    .slice(0, 12)
                    .map(([k, v]) => (
                      <div key={k} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '3px 0' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', marginRight: 8 }}>{k}</span>{String(v)}
                      </div>
                    ))}
                </Disclosure>
              )}
              {/* Custom-question answers (studio-custom-questions §7) — the
                  frozen {qid, prompt, values} snapshots from capture. Values
                  include customer-typed free text: rendered as PLAIN React
                  text only, never markup. */}
              {Array.isArray(p.sourceMetadata?.customAnswers) && p.sourceMetadata.customAnswers.length > 0 && (
                <Disclosure label="Custom answers" count={`${p.sourceMetadata.customAnswers.length}`}>
                  {p.sourceMetadata.customAnswers.slice(0, 12).map((a, i) => (
                    <div key={a?.qid || i} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '4px 0', overflowWrap: 'anywhere' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)' }}>{String(a?.prompt || a?.qid || '')}</div>
                      <div>{Array.isArray(a?.values) ? a.values.map((v) => String(v)).join(' · ') : ''}</div>
                    </div>
                  ))}
                </Disclosure>
              )}
            </Card>

            {hasScreening && (
              <Card
                title="AI screening"
                action={(
                  <Chip tone={p.screeningVerdict === 'qualified' ? 'ok' : p.screeningVerdict === 'not_qualified' ? 'bad' : 'warn'} glyph={p.screeningVerdict === 'qualified' ? '✓' : p.screeningVerdict === 'not_qualified' ? '✗' : '☎'}>
                    {p.screeningVerdict === 'qualified' ? 'Qualified' : p.screeningVerdict === 'not_qualified' ? 'Not qualified' : sm.unreachable ? 'Unreachable' : 'Pending'}
                  </Chip>
                )}
              >
                <div style={{ padding: '12px 16px 10px' }}>
                  {verdictDetail.reason && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4 }}>“{verdictDetail.reason}”</div>}
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginTop: verdictDetail.reason ? 4 : 0 }}>
                    {[
                      verdictDetail.sentiment && `${String(verdictDetail.sentiment).toLowerCase()} sentiment`,
                      `${p.screeningAttemptCount || screeningAttempts.length || 0} attempt${(p.screeningAttemptCount || screeningAttempts.length) === 1 ? '' : 's'}`,
                    ].filter(Boolean).join(' · ')}
                    {screeningAttempts.some((a) => Number.isFinite(a.costCents)) && <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtSGDExact(screeningCostCents)}</span></>}
                  </div>
                  {sm.callbackGranted && p.screeningNextAttemptAt && (
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginTop: 4 }}>callback promised · {fmtDateTime(p.screeningNextAttemptAt)}</div>
                  )}
                </div>
                {(screeningAttempts.length > 0 || verdictDetail.transcript) && (
                  <Disclosure label="Transcript & recordings" count={`${screeningAttempts.length} ATTEMPT${screeningAttempts.length === 1 ? '' : 'S'}`}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {screeningAttempts.map((a, i) => (
                        <div key={a.token || i} style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', marginRight: 8 }}>{fmtDateTime(a.startedAt).toUpperCase()}</span>
                          Attempt {i + 1} — {(a.outcome || 'attempted').replace(/_/g, ' ')}
                          {a.recordingUrl && (
                            <CallRecordingPlayer
                              src={a.recordingUrl}
                              multiChannelSrc={a.recordingMultiChannelUrl}
                              style={{ marginTop: 4 }}
                            />
                          )}
                        </div>
                      ))}
                      {verdictDetail.transcript && (
                        <div style={{ maxHeight: 240, overflowY: 'auto', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ink-2)' }}>
                          {String(verdictDetail.transcript).split('\n').map((line, i) => {
                            const m = /^(Agent|User):\s?(.*)$/.exec(line);
                            if (!m) return line ? <div key={i}>{line}</div> : <div key={i}>&nbsp;</div>;
                            return (
                              <div key={i} style={{ marginBottom: 3 }}>
                                <span style={{ fontWeight: 700, color: m[1] === 'Agent' ? 'var(--accent-text)' : 'var(--ink)' }}>
                                  {m[1] === 'Agent' ? 'Sarah' : p.firstName || 'Lead'}:
                                </span>{' '}
                                {m[2]}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </Disclosure>
                )}
              </Card>
            )}

            {isVoiceLead && (
              <Card title="Voice call" meta={p.sourceMetadata?.durationMs ? `${Math.round(p.sourceMetadata.durationMs / 1000)}S` : undefined}>
                <div style={{ padding: '12px 16px 12px' }}>
                  {p.sourceMetadata?.fromNumber && <KvRow label="from">{p.sourceMetadata.fromNumber}</KvRow>}
                  {p.sourceMetadata?.sentiment && <KvRow label="sentiment" mono={false}>{p.sourceMetadata.sentiment}</KvRow>}
                  {p.notes && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {String(p.notes).slice(0, 800)}
                    </div>
                  )}
                  {p.sourceMetadata?.recordingUrl && (
                    <CallRecordingPlayer
                      src={p.sourceMetadata.recordingUrl}
                      multiChannelSrc={p.sourceMetadata.recordingMultiChannelUrl}
                      style={{ marginTop: 8 }}
                    />
                  )}
                </div>
              </Card>
            )}

            {/* Last in the grid on purpose: this is the page's explanation, not
                its news. Gone for an erased person, whose lead-score columns are
                nulled by the erasure rebuild — the guard is belt-and-braces, so
                a later change to that rebuild cannot turn this into a leak. */}
            {!erased && (
              <LeadScoreCard
                prospect={p}
                campaignName={currentSignup?.campaign?.name || p.campaign?.name || null}
                campaignId={currentSignup?.campaign?.id || p.campaign?.id || null}
                hasPersonCard={Boolean(journey?.enrichment)}
              />
            )}
          </div>
        </>
      )}

      {/* ── Mobile: fixed action bar + sheet variants of the command menus ── */}
      {mobile && (
        <>
          <MobileActionBar>
            {erased ? (
              <button
                type="button"
                onClick={() => openAction('delete')}
                style={{ flex: 1, height: 48, background: 'var(--surface)', color: 'var(--bad)', border: '1px solid var(--bad)', borderRadius: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, boxShadow: 'var(--shadow)' }}
              >
                Delete
              </button>
            ) : (
              <>
                <MobilePrimaryBtn onClick={() => openAction('assign')} disabled={assignMutation.isPending}>
                  {view === 'profile' ? 'Assign to agent' : currentSignup?.agentName ? 'Reassign' : 'Assign this lead'}
                </MobilePrimaryBtn>
                <MobileMoreBtn onClick={() => setMobileMenu(true)} />
              </>
            )}
          </MobileActionBar>

          <MobileSheet open={mobileMenu} onClose={() => setMobileMenu(false)} label="Lead actions">
            <SheetHead title={canonicalName} kicker={phone || 'lead actions'} />
            {!erased && (
              <SheetMenuItem
                label="Return to held"
                sub="Pull back from the agent · refund the wallet charge"
                onClick={() => { setMobileMenu(false); openAction('return'); }}
              />
            )}
            <SheetMenuItem
              label="Delete lead"
              danger
              sub="Removes the signup and its history · can't be undone"
              onClick={() => { setMobileMenu(false); openAction('delete'); }}
            />
          </MobileSheet>

          <MobileSheet open={!!menu} onClose={() => { setMenu(null); setMenuAction(null); }} label={menuAction === 'assign' ? 'Assign lead' : menuAction === 'return' ? 'Return lead' : 'Pick campaign'}>
            {menu === 'campaign' && (
              <>
                <SheetHead title="Which campaign's lead?" kicker={menuAction === 'assign' ? 'then pick an agent' : `${menuAction} that signup`} />
                {railSignups.map((s) => (
                  <button
                    key={s.prospectId}
                    type="button"
                    onClick={() => pickCampaign(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 56, padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', color: 'var(--ink)', boxSizing: 'border-box' }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.campaign?.name || 'No campaign'}</span>
                      <span className="av2-mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>
                        agent: {s.agentName || (s.externalBuyer ? 'external buyer' : 'unassigned')}
                      </span>
                    </span>
                    <span style={{ color: 'var(--ink-3)', flex: 'none' }} aria-hidden="true">›</span>
                  </button>
                ))}
              </>
            )}
            {menu === 'agent' && (
              <>
                <SheetHead title={`Assign ${menuTargetSignup?.campaign?.name || 'this'} lead`} kicker="wallet charged on assignment" />
                {agentOptions.isLoading && <div style={{ padding: 8 }}><Skeleton height={44} /></div>}
                {(agentOptions.data || []).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => { setMenu(null); assignMutation.mutate({ targetId: menuTarget || prospectId, agentId: a.id, agentName: a.name }); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52, padding: '8px 4px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', color: 'var(--ink)' }}
                  >
                    <span style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700 }}>
                      {(a.name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700 }}>{a.name}</span>
                    <span className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)', flex: 'none' }}>LYFE</span>
                  </button>
                ))}
              </>
            )}
          </MobileSheet>
        </>
      )}

      <ConsentCopyModal view={consentCopyView} onClose={() => setConsentCopyView(null)} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
              This permanently removes the {confirmSignup?.campaign?.name ? `${confirmSignup.campaign.name} ` : ''}lead and its activity history. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteMutation.mutate({ targetId: confirmDelete }); }}
              disabled={deleteMutation.isPending}
              style={{ background: 'var(--bad)', color: '#fff' }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
