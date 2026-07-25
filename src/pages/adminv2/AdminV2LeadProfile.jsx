/**
 * Lead Profile — the full-page lead story (/admin/leads/:prospectId), replacing
 * the Prospects drawer (docs/plans/admin-lead-profile-page.md §3).
 *
 * Person-first, prospect-anchored: the URL names one signup; the campaigns
 * rail tells the whole person's story (name used per signup, draw standing OR
 * reward state per campaign), and clicking another signup RE-ANCHORS by
 * navigating to that prospect's URL (back/forward and sharing come free).
 * Data: GET /prospects/:id?include=profile (PR #269) — one endpoint, admin-only
 * enrichments; the classic payload fields render instantly for everyone else.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProspectProfile, useAgentOptions } from '@/hooks/queries/useAdminV2';
import { bulkAssign, bulkReturnToHeld, bulkDelete } from '@/api/adminV2';
import {
  STATUS_LABELS, STATUS_CHIP_CLASS, SOURCE_LABELS, heldLabel, UTM_LABELS,
} from '@/lib/adminV2/constants';
import { fmtDateTime, fmtRelative, fmtSGDExact } from '@/lib/adminV2/format';
import { Card, Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

// ── voice helpers ───────────────────────────────────────────────────────────

const fullName = (o) => `${o?.firstName || ''} ${o?.lastName || ''}`.trim();
const sameName = (a, b) => fullName(a).toLowerCase() === fullName(b).toLowerCase();

const NOT_ELIGIBLE_COPY = {
  no_phone: 'no phone on record',
  phone_unverified: 'phone unverified',
  terms_not_pinned: 'draw terms not accepted',
  signed_up_after_close: 'signed up after entries closed',
};

const BOOST_VIA_COPY = { agent_scan: 'consultant scan', agent_button: 'consultant confirmation' };

/** One line of draw truth per lifecycle state — provisional voice before seal. */
function drawLine(draw) {
  if (!draw) return null;
  const d = fmtDateTime;
  switch (draw.state) {
    case 'no_draw_record':
      return { tone: 'warn', text: 'Draw configured — no draw record yet' };
    case 'erased_draw_unavailable':
      return { tone: '', text: 'Draw record unavailable (erased)' };
    case 'void':
      return { tone: '', text: 'Draw void' };
    case 'provisional_out':
      return {
        tone: 'warn',
        text: `Not counted yet — ${NOT_ELIGIBLE_COPY[draw.notEligibleReason] || draw.notEligibleReason || 'not eligible'}`,
      };
    case 'provisional_in': {
      const close = draw.closesAt ? ` · closes ${d(draw.closesAt)}` : '';
      if (draw.boosted) {
        return { tone: 'ok', text: `On track for ×${draw.multiplier} — ${BOOST_VIA_COPY[draw.boostVia] || 'boost'} recorded${close}` };
      }
      const pending = draw.boostReviewPending ? ' · boost pending ops review' : '';
      const boostBy = draw.boostClosesAt || draw.closesAt;
      return { tone: '', text: `1 chance so far · boost window open${boostBy ? ` until ${d(boostBy)}` : ''}${pending}` };
    }
    case 'frozen_in': {
      const pending = draw.boostReviewPending ? ' · boost pending ops review' : '';
      return draw.boosted
        ? { tone: 'ok', text: `In the pool — 1 chance · ×${draw.multiplier} boost applies at seal` }
        : { tone: '', text: `In the pool — 1 chance${pending}` };
    }
    case 'excluded_at_freeze':
      return { tone: 'warn', text: 'Excluded at freeze' };
    case 'sealed': {
      const n = draw.chances;
      const base = `${n} chance${n === 1 ? '' : 's'}`;
      const o = draw.outcome;
      if (!o) return { tone: '', text: `${base} · sealed` };
      switch (o.status) {
        case 'selected_pending':
          return { tone: 'accent', text: `Selected — claim by ${d(o.claimDeadline)}` };
        case 'selected_claimed':
          return { tone: 'ok', text: `🏆 Winner — claimed ${d(o.claimedAt)}` };
        case 'selected_declined':
        case 'selected_unreachable':
        case 'selected_ineligible':
        case 'selected_unclaimed':
          return { tone: 'warn', text: `Selected — ${o.status.replace('selected_', '')}, redrawn` };
        case 'not_selected_final':
          return { tone: '', text: `Not selected (${base})` };
        case 'not_selected_yet':
        default:
          return { tone: '', text: `${base} · draw in progress` };
      }
    }
    default:
      return null;
  }
}

const REWARD_STATE_COPY = {
  reserved: { tone: 'accent', label: 'Reserved' },
  unlocked: { tone: 'ok', label: 'Unlocked' },
  redeemed: { tone: 'ok', label: 'Redeemed ✓' },
  expired: { tone: '', label: 'Expired' },
  cancelled: { tone: '', label: 'Cancelled' },
  blocked: { tone: 'bad', label: 'Blocked' },
};

const DIAGNOSTIC_COPY = {
  no_active_activation: 'No reward attached to this campaign',
  allocation_exhausted: 'No reward — quota full',
  phone_not_verified: 'No reward — phone unverified',
  no_phone: 'No reward — no phone on record',
  duplicate_phone: 'No reward — this phone already holds one',
  offer_not_active: 'No reward — offer paused',
  activation_ended: 'No reward — activation ended',
  quarantined: 'No reward — lead is held',
  not_issued_yet: 'Reward pending — issuance sweep hasn’t landed',
};

/** One line of reward truth per entitlement (non-draw voice). */
function rewardLine(ent) {
  const s = REWARD_STATE_COPY[ent.state] || { tone: '', label: ent.state || ent.status };
  const bits = [ent.rewardTitle].filter(Boolean);
  if (ent.state === 'redeemed' && ent.redeemedAt) bits.push(`redeemed ${fmtDateTime(ent.redeemedAt)}`);
  else if (ent.state === 'unlocked' && ent.expiresAt) bits.push(`voucher live until ${fmtDateTime(ent.expiresAt)}`);
  else if (ent.state === 'reserved' && ent.expiresAt) bits.push(`expires ${fmtDateTime(ent.expiresAt)}`);
  return { tone: s.tone, label: s.label, detail: bits.join(' · ') };
}

function receiptLine(delivery) {
  if (!delivery) return null;
  const part = (r, name) => (r ? `${name} ${r.ok ? '✓' : 'failed ✗'}` : null);
  const bits = [part(delivery.email, 'emailed'), part(delivery.whatsapp, 'WhatsApp')].filter(Boolean);
  return bits.length ? `pass ${bits.join(' · ')}` : null;
}

// ── history composition (client-side; the endpoint already has the facts) ────

function buildHistory(p, journey) {
  const events = [];
  const push = (at, label, { scope = 'signup', campaign = null, prospectId = null } = {}) => {
    const t = at ? Date.parse(at) : NaN;
    if (!Number.isNaN(t)) events.push({ at: t, label, scope, campaign, prospectId });
  };

  // Lifecycle + engagement — the merged timeline when the EF answered, else
  // the prospect's own activities (plan §3.6: env-gated fallback).
  const rows = Array.isArray(p.timeline)
    ? p.timeline.map((x) => ({
      at: x.row?.createdAt || x.row?.created_at,
      label: x.entry?.label || x.row?.description || x.row?.type || 'activity',
    }))
    : (p.activities || []).map((a) => ({ at: a.createdAt, label: a.description || a.type }));
  for (const r of rows) push(r.at, r.label, { prospectId: p.id });

  for (const s of journey?.signups || []) {
    push(s.createdAt, `Signed up as ${fullName(s) || '—'}`, {
      scope: 'person', campaign: s.campaign?.name, prospectId: s.prospectId,
    });
    if (s.draw?.boostedAt) {
      push(s.draw.boostedAt, `Draw boost recorded — ${BOOST_VIA_COPY[s.draw.boostVia] || 'boost'}`, {
        scope: 'person', campaign: s.campaign?.name, prospectId: s.prospectId,
      });
    }
  }
  for (const e of journey?.entitlements || []) {
    const title = e.rewardTitle || 'reward';
    push(e.createdAt, e.drawLinked ? 'Draw pass reserved' : `Reward reserved — ${title}`, { scope: 'person', campaign: e.campaignName });
    if (e.unlockedAt) push(e.unlockedAt, e.drawLinked ? 'Draw boost confirmed' : `Voucher unlocked — ${title}`, { scope: 'person', campaign: e.campaignName });
    if (e.redeemedAt) push(e.redeemedAt, `Redeemed — ${title}`, { scope: 'person', campaign: e.campaignName });
    for (const ch of ['email', 'whatsapp']) {
      const r = e.delivery?.[ch];
      if (r?.at) push(r.at, `${r.kind || 'pass'} ${ch} ${r.ok ? 'sent ✓' : 'send failed ✗'}`, { scope: 'person', campaign: e.campaignName });
    }
  }
  for (const b of journey?.broadcasts?.recent || []) {
    push(b.sentAt || b.at, `Marketing email — ${b.status}${b.reason ? ` (${b.reason.replace(/_/g, ' ')})` : ''}`, { scope: 'person' });
  }
  for (const ld of p.lyfeDelivery || []) {
    push(ld.at, `Lyfe ${ld.eventType.replace('lead.', '')} — ${ld.status}${ld.reason ? ` (${ld.reason.replace(/_/g, ' ')})` : ''}`, { prospectId: p.id });
  }
  if (p.session?.startedAt) {
    push(p.session.startedAt, `Arrived — ${p.session.landingPath || 'landing page'}`, { prospectId: p.id });
  }
  const attempts = Object.values(p.screeningMetadata?.attempts || {}).filter((a) => a?.startedAt);
  for (const a of attempts) push(a.startedAt, `AI screening call — ${(a.outcome || 'attempted').replace(/_/g, ' ')}`, { prospectId: p.id });

  return events.sort((a, b) => b.at - a.at);
}

// ── small pieces ────────────────────────────────────────────────────────────

function Kv({ k, children }) {
  return <div className="av2-kv"><span>{k}</span><span>{children ?? '—'}</span></div>;
}

function SectionCaps({ children }) {
  return <div className="av2-microcaps" style={{ marginBottom: 6 }}>{children}</div>;
}

function consentRow(state) {
  if (!state) return '—';
  return `${state.granted ? 'yes' : 'no'}${state.version ? ` · ${String(state.version).slice(0, 28)}` : ''}${state.scope === 'global' ? ' · global' : ''}`;
}

// ── the page ────────────────────────────────────────────────────────────────

export default function AdminV2LeadProfile() {
  const { prospectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyScope, setHistoryScope] = useState('all');

  // Back target: the list URL the operator came from (state.from contract,
  // plan §3.8) — validated same-app path; reloads/direct links fall back.
  const from = typeof location.state?.from === 'string' && location.state.from.startsWith('/AdminProspects')
    ? location.state.from
    : '/AdminProspects';
  const reAnchor = (id) => navigate(`/admin/leads/${id}`, { state: { from } });

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
    mutationFn: ({ agentId }) => bulkAssign([prospectId], agentId),
    onSuccess: (r, { agentName }) => {
      const n = r?.data?.affectedCount ?? 0;
      if (n > 0) toast.success(`Assigned to ${agentName}`);
      else toast.warning('Not assigned — lead not eligible');
      invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Assign failed'),
  });
  const returnMutation = useMutation({
    mutationFn: () => bulkReturnToHeld([prospectId]),
    onSuccess: (r) => {
      const n = r?.data?.returned ?? 0;
      if (n > 0) toast.success('Returned to held');
      else toast.warning('Not returned — already held or not eligible');
      invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Return failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => bulkDelete([prospectId]),
    onSuccess: (r) => {
      const n = r?.data?.deleted ?? 0;
      setConfirmDelete(false);
      invalidate();
      if (n > 0) { toast.success('Lead deleted'); navigate(from); }
      else toast.warning('Nothing deleted');
    },
    onError: (e) => { toast.error(e?.message || 'Delete failed'); setConfirmDelete(false); },
  });

  // Entitlements grouped by campaign for the rail's reward slot; draw-linked
  // rows speak in the DRAW slot (boost evidence), never as vouchers.
  const rewardsByCampaign = useMemo(() => {
    const map = new Map();
    for (const e of journey?.entitlements || []) {
      if (e.drawLinked || !e.campaignId) continue;
      const k = String(e.campaignId);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return map;
  }, [journey]);

  const history = useMemo(() => (p ? buildHistory(p, journey) : []), [p, journey]);
  const filteredHistory = useMemo(() => history.filter((e) => {
    if (historyScope === 'all') return true;
    if (historyScope === 'signup') return String(e.prospectId || '') === String(prospectId);
    return e.scope === 'person';
  }), [history, historyScope, prospectId]);

  if (profile.isLoading) {
    return (
      <div>
        <Skeleton height={30} width={340} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, marginTop: 20 }}>
          {[7, 5, 12].map((span, i) => <div key={i} style={{ gridColumn: `span ${span}` }}><Skeleton height={i === 2 ? 120 : 260} /></div>)}
        </div>
      </div>
    );
  }
  if (profile.isError || !p) {
    return (
      <div>
        <PageHeader title="Lead">
          <Link to={from} className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← Prospects</Link>
        </PageHeader>
        <ErrorState error={profile.error || new Error('This lead may have been deleted.')} onRetry={profile.refetch} />
      </div>
    );
  }

  const held = !!p.quarantinedAt;
  const canonicalName = fullName(person) || fullName(p) || 'Lead';
  const utm = p.sourceMetadata?.utm || {};
  const sm = p.screeningMetadata || {};
  const screeningAttempts = Object.values(sm.attempts || {})
    .filter((a) => a && a.startedAt)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const screeningCostCents = screeningAttempts.reduce((s, a) => s + (Number(a.costCents) || 0), 0);
  const hasScreening = p.screeningVerdict || p.screeningMetadata || String(p.quarantineReason || '').startsWith('screening_');
  const verdictDetail = sm.verdictDetail || {};
  const quiz = p.sourceMetadata?.quiz || null;
  const isVoiceLead = p.leadSource === 'call_bot';

  // Rail rows: the journey's signups, else this prospect alone (B4 fallback).
  const railSignups = journey?.signups?.length
    ? journey.signups
    : [{
      prospectId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      campaign: p.campaign ? { id: p.campaign.id, name: p.campaign.name, status: p.campaign.status } : null,
      leadStatus: p.leadStatus,
      leadSource: p.leadSource,
      createdAt: p.createdAt,
      held,
      verified: false,
      draw: p.signupProfile?.draw ?? null,
      rewardDiagnostic: p.signupProfile?.rewardDiagnostic ?? null,
      _fallback: true,
    }];
  const fallbackRewards = p.signupProfile?.entitlements?.filter((e) => !e.drawLinked) || [];

  // Current-signup consent (ledger, scoped) with legacy-boolean fallback.
  const currentSignup = journey?.signups?.find((s) => String(s.prospectId) === String(prospectId)) || null;
  const consent = currentSignup?.consent || null;

  return (
    <div>
      <PageHeader
        title={canonicalName}
        meta={[
          person?.phone || p.phone || null,
          person ? `${person.signupCount} SIGNUP${person.signupCount === 1 ? '' : 'S'} (${person.verifiedSignupCount} VERIFIED)` : null,
          person?.firstSeenAt ? `FIRST SEEN ${fmtDateTime(person.firstSeenAt)}` : `CREATED ${fmtDateTime(p.createdAt)}`,
        ].filter(Boolean).join(' · ')}
      >
        <Link to={from} className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← Prospects</Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="av2-btn av2-btn--sm" disabled={assignMutation.isPending}>Assign to agent ▾</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="admin-v2" align="end">
            <DropdownMenuLabel>Assign to</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(agentOptions.data || []).map((a) => (
              <DropdownMenuItem key={a.id} onSelect={() => assignMutation.mutate({ agentId: a.id, agentName: a.name })}>
                {a.name}
              </DropdownMenuItem>
            ))}
            {agentOptions.isLoading && <DropdownMenuItem disabled>Loading agents…</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className="av2-btn av2-btn--sm" disabled={returnMutation.isPending} onClick={() => returnMutation.mutate()}>Return to held</button>
        <button type="button" className="av2-btn av2-btn--sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => setConfirmDelete(true)}>Delete</button>
      </PageHeader>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, marginTop: -6 }}>
        <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>
        {held && <Chip tone="hold" glyph="◆">{heldLabel(p).full}</Chip>}
        {!held && !p.assignedAgent && !p.externalAgentId && <Chip tone="warn">Unassigned</Chip>}
        {p.screeningVerdict && (
          <Chip tone={p.screeningVerdict === 'qualified' ? 'ok' : 'bad'} glyph={p.screeningVerdict === 'qualified' ? '✓' : '✗'}>
            {p.screeningVerdict === 'qualified' ? 'AI qualified' : 'AI failed'}
          </Chip>
        )}
        {p.priority && <Chip>{p.priority}</Chip>}
        {Number.isFinite(Number(p.score)) && p.score !== null && <Chip>score {p.score}</Chip>}
        {erased && <Chip tone="bad">erased</Chip>}
      </div>

      {erased && (
        <div className="av2-card" style={{ padding: '10px 14px', marginBottom: 16, borderColor: 'var(--bad)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            This person was erased on {fmtDateTime(person.erasedAt)} — the profile shows only what the
            allowlist rebuild kept. Draw entries are unjoinable by design.
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
        {/* ── Campaigns rail — the person's whole story ── */}
        <Card
          span={7}
          title="Campaigns"
          meta={journey ? `${railSignups.length} SIGNUP${railSignups.length === 1 ? '' : 'S'}` : undefined}
        >
          {!journey && (
            <div className="av2-caption" style={{ padding: '8px 14px 0' }}>
              {isVoiceLead
                ? 'Retell voice lead — the call carries no caller phone, so there is no cross-campaign identity.'
                : 'No linked person yet (phone unverified) — showing this signup only.'}
            </div>
          )}
          <div style={{ display: 'grid', gap: 0 }}>
            {railSignups.map((s) => {
              const isCurrent = String(s.prospectId) === String(prospectId);
              const nameVariant = person && fullName(s) && !sameName(s, person);
              const dl = drawLine(s.draw);
              const rewards = s._fallback
                ? fallbackRewards
                : (s.campaign ? rewardsByCampaign.get(String(s.campaign.id)) || [] : []);
              const diagnostic = !dl && rewards.length === 0 ? (DIAGNOSTIC_COPY[s.rewardDiagnostic] || null) : null;
              return (
                <button
                  key={s.prospectId}
                  type="button"
                  onClick={() => { if (!isCurrent) reAnchor(s.prospectId); }}
                  aria-current={isCurrent ? 'page' : undefined}
                  style={{
                    textAlign: 'left', background: isCurrent ? 'var(--surface-2)' : 'none',
                    border: 'none', borderTop: '1px solid var(--line)',
                    borderLeft: isCurrent ? '3px solid var(--accent)' : '3px solid transparent',
                    padding: '12px 14px', cursor: isCurrent ? 'default' : 'pointer',
                    color: 'var(--ink)', fontFamily: 'var(--font-ui)', display: 'grid', gap: 5,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800 }}>{s.campaign?.name || 'No campaign'}</span>
                    {s.campaign?.status && s.campaign.status !== 'active' && <Chip>{s.campaign.status}</Chip>}
                    {isCurrent && <Chip tone="accent">viewing</Chip>}
                    <span style={{ flex: 1 }} />
                    <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }} title={fmtDateTime(s.createdAt)}>
                      {fmtRelative(s.createdAt)}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-2)' }}>
                    <span>as <strong style={{ color: 'var(--ink)' }}>{fullName(s) || '—'}</strong></span>
                    {nameVariant && <Chip tone="warn" glyph="⚠">name variant</Chip>}
                    <Chip>{SOURCE_LABELS[s.leadSource] || s.leadSource}</Chip>
                    {s.verified ? <Chip tone="ok" glyph="✓">verified</Chip> : <Chip>unverified</Chip>}
                    {s.held && <Chip tone="hold" glyph="◆">held</Chip>}
                  </span>
                  {dl && (
                    <span style={{ fontSize: 12.5, color: dl.tone === 'warn' ? 'var(--warn)' : dl.tone === 'ok' ? 'var(--ok)' : dl.tone === 'accent' ? 'var(--accent-text)' : 'var(--ink)' }}>
                      🎟 {dl.text}
                    </span>
                  )}
                  {rewards.map((e) => {
                    const rl = rewardLine(e);
                    const receipts = receiptLine(e.delivery);
                    return (
                      <span key={e.id} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 12.5 }}>
                          🎁 <strong>{rl.label}</strong>{rl.detail ? ` — ${rl.detail}` : ''}
                        </span>
                        {receipts && <span className="av2-caption">{receipts}</span>}
                      </span>
                    );
                  })}
                  {diagnostic && <span className="av2-caption">{diagnostic}</span>}
                </button>
              );
            })}
          </div>
        </Card>

        {/* ── Right column ── */}
        <div style={{ gridColumn: 'span 5', display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card title="This signup">
            <div style={{ padding: '4px 14px 12px', display: 'grid', gap: 14 }}>
              <section>
                <SectionCaps>Contact</SectionCaps>
                <Kv k="phone">
                  {p.phone || '—'}
                  {p.sourceMetadata?.phoneVerifiedAt && <span className="av2-caption" title={fmtDateTime(p.sourceMetadata.phoneVerifiedAt)}> · verified ✓</span>}
                </Kv>
                <Kv k="email">{p.email || '—'}</Kv>
              </section>
              <section>
                <SectionCaps>Attribution</SectionCaps>
                <Kv k="source">{SOURCE_LABELS[p.leadSource] || p.leadSource}</Kv>
                {utm.utm_source && <Kv k="utm_source">{UTM_LABELS[utm.utm_source] || utm.utm_source}</Kv>}
                {utm.utm_medium && <Kv k="utm_medium">{utm.utm_medium}</Kv>}
                {utm.utm_campaign && <Kv k="utm_campaign">{utm.utm_campaign}</Kv>}
                {p.session?.utm?.term && <Kv k="utm_term">{p.session.utm.term}</Kv>}
                {p.session?.utm?.content && <Kv k="utm_content">{p.session.utm.content}</Kv>}
                {p.session?.landingPath && <Kv k="landing">{p.session.landingPath}</Kv>}
                {p.qrTag && <Kv k="qr tag">{p.qrTag.name}</Kv>}
                <Kv k="campaign">
                  {p.campaign
                    ? <Link to={`/admin/campaigns/${p.campaign.id}`} style={{ color: 'var(--accent-text)', textDecoration: 'none', fontWeight: 700 }}>{p.campaign.name} ↗</Link>
                    : '—'}
                </Kv>
              </section>
              <section>
                <SectionCaps>Routing</SectionCaps>
                <Kv k="agent">
                  {p.assignedAgent
                    ? fullName(p.assignedAgent)
                    : p.externalAgent
                      ? `${p.externalAgent.fullName || 'External buyer'}${p.externalAgent.agency ? ` (${p.externalAgent.agency})` : ''}`
                      : p.externalAgentId ? 'external buyer' : held ? 'held' : 'unassigned'}
                </Kv>
                {held && <Kv k="held since">{fmtDateTime(p.quarantinedAt)}</Kv>}
                {held && <Kv k="reason">{heldLabel(p).full || p.quarantineReason || '—'}</Kv>}
                <Kv k="lyfe delivery">
                  {p.lyfeDelivery
                    ? p.lyfeDelivery.map((ld) => `${ld.eventType.replace('lead.', '')}: ${ld.status === 'success' ? '✓ delivered' : ld.status === 'failed' ? `✗ failed ×${ld.attempts}${ld.reason ? ` (${ld.reason.replace(/_/g, ' ')})` : ''}` : '… pending'}`).join(' · ')
                    : 'not sent — no app destination'}
                </Kv>
                {p.nextFollowUpDate && <Kv k="follow-up">{fmtDateTime(p.nextFollowUpDate)}</Kv>}
                {(p.commissions || []).map((cm) => (
                  <Kv key={cm.id} k="commission">{cm.type} · {cm.status}</Kv>
                ))}
              </section>
            </div>
          </Card>

          {quiz && (
            <Card title="Quiz">
              <div style={{ padding: '4px 14px 12px' }}>
                {Object.entries(quiz)
                  .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
                  .slice(0, 12)
                  .map(([k, v]) => <Kv key={k} k={k}>{String(v)}</Kv>)}
              </div>
            </Card>
          )}

          <Card title="Consent & reachability">
            <div style={{ padding: '4px 14px 12px', display: 'grid', gap: 14 }}>
              <section>
                <SectionCaps>{consent ? 'Consent (ledger, this campaign + global)' : 'Consent (legacy flags)'}</SectionCaps>
                {consent ? (
                  <>
                    <Kv k="marketing">{consentRow(consent.contact)}</Kv>
                    <Kv k="terms">{consentRow(consent.campaign_terms)}</Kv>
                    <Kv k="third-party">{consentRow(consent.third_party)}</Kv>
                    {consent.draw_terms && <Kv k="draw terms">{consentRow(consent.draw_terms)}</Kv>}
                  </>
                ) : (
                  <>
                    <Kv k="marketing">{p.sourceMetadata?.consent_contact === true ? 'yes' : p.sourceMetadata?.consent_contact === false ? 'no' : '—'}</Kv>
                    <Kv k="terms">{p.sourceMetadata?.consent_terms === true ? 'yes' : p.sourceMetadata?.consent_terms === false ? 'no' : '—'}</Kv>
                    <Kv k="third-party">{p.sourceMetadata?.consent_third_party === true ? 'yes' : p.sourceMetadata?.consent_third_party === false ? 'no' : '—'}</Kv>
                  </>
                )}
                {p.consentMetadata?.drawTerms?.termsVersionId && (
                  <Kv k="draw terms pinned"><span className="av2-mono" style={{ fontSize: 11 }}>{String(p.consentMetadata.drawTerms.termsVersionId).slice(0, 8)}…</span></Kv>
                )}
              </section>
              {(journey?.suppressions?.length > 0) && (
                <section>
                  <SectionCaps>Suppressions</SectionCaps>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {journey.suppressions.map((s2, i) => (
                      <Chip key={i} tone="bad">{s2.channel}: {s2.reason.replace(/_/g, ' ')}</Chip>
                    ))}
                  </div>
                </section>
              )}
              <section>
                <SectionCaps>DNC registry</SectionCaps>
                <Kv k="status">{p.dncStatus || '—'}</Kv>
                {(p.dncNoVoiceCall || p.dncNoTextMessage) && (
                  <Kv k="blocked">{[p.dncNoVoiceCall && 'voice', p.dncNoTextMessage && 'SMS'].filter(Boolean).join(' + ')}</Kv>
                )}
                {p.dncCheckedAt && <Kv k="checked">{fmtDateTime(p.dncCheckedAt)}{p.dncValidUntil ? ` · valid until ${fmtDateTime(p.dncValidUntil)}` : ''}</Kv>}
              </section>
              {journey?.broadcasts && (
                <section>
                  <SectionCaps>Marketing touches</SectionCaps>
                  <Kv k="broadcasts">
                    {Object.keys(journey.broadcasts.counts).length
                      ? Object.entries(journey.broadcasts.counts).map(([k, v]) => `${v} ${k}`).join(' · ')
                      : 'none yet'}
                  </Kv>
                </section>
              )}
            </div>
          </Card>

          {hasScreening && (
            <Card title="AI screening">
              <div style={{ padding: '4px 14px 12px' }}>
                <Kv k="verdict">
                  {p.screeningVerdict === 'qualified' ? 'Qualified'
                    : p.screeningVerdict === 'not_qualified' ? 'Not qualified'
                      : sm.unreachable ? 'Unreachable' : 'Pending'}
                </Kv>
                {verdictDetail.reason && <Kv k="reason">{verdictDetail.reason}</Kv>}
                {verdictDetail.sentiment && <Kv k="sentiment">{verdictDetail.sentiment}</Kv>}
                <Kv k="attempts">{p.screeningAttemptCount || screeningAttempts.length || 0}</Kv>
                {sm.callbackGranted && p.screeningNextAttemptAt && <Kv k="callback">{fmtDateTime(p.screeningNextAttemptAt)}</Kv>}
                {screeningAttempts.some((a) => Number.isFinite(a.costCents)) && (
                  <Kv k="call cost">{fmtSGDExact(screeningCostCents)}</Kv>
                )}
                {verdictDetail.summary && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                    {String(verdictDetail.summary).slice(0, 600)}
                  </div>
                )}
                {verdictDetail.transcript && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', cursor: 'pointer', userSelect: 'none' }}>
                      Call transcript
                    </summary>
                    <div style={{ marginTop: 6, maxHeight: 260, overflowY: 'auto', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ink-2)' }}>
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
                  </details>
                )}
                {screeningAttempts.filter((a) => a.recordingUrl).map((a, i) => (
                  <div key={a.token || i} style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Recording — attempt {i + 1} ({fmtDateTime(a.startedAt)})</span>
                    <audio controls preload="none" src={a.recordingUrl} style={{ width: '100%', height: 34 }} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {isVoiceLead && (
            <Card title="Voice call">
              <div style={{ padding: '4px 14px 12px' }}>
                <Kv k="from">{p.sourceMetadata?.fromNumber || '—'}</Kv>
                <Kv k="sentiment">{p.sourceMetadata?.sentiment || '—'}</Kv>
                {p.sourceMetadata?.durationMs && <Kv k="duration">{Math.round(p.sourceMetadata.durationMs / 1000)}s</Kv>}
                {p.notes && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {String(p.notes).slice(0, 800)}
                  </div>
                )}
                {p.sourceMetadata?.recordingUrl && (
                  <audio controls preload="none" src={p.sourceMetadata.recordingUrl} style={{ width: '100%', height: 34, marginTop: 8 }} />
                )}
              </div>
            </Card>
          )}
        </div>

        {/* ── History ── */}
        <Card
          span={12}
          title="History"
          action={(
            <div className="av2-seg" role="group" aria-label="History scope">
              {[['all', 'All'], ['signup', 'This signup'], ['person', 'Person']].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={historyScope === v} onClick={() => setHistoryScope(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        >
          {filteredHistory.length === 0 ? (
            <EmptyState title="Nothing yet" hint="This lead was just captured — events land here as they happen." />
          ) : (
            <div style={{ padding: '4px 0 8px' }}>
              {filteredHistory.slice(0, 80).map((e, i) => (
                <div key={i} className="av2-qrow" style={{ cursor: 'default', minHeight: 36 }}>
                  <span className="av2-mono" style={{ width: 130, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)' }} title={fmtDateTime(new Date(e.at))}>
                    {fmtDateTime(new Date(e.at))}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5 }}>{e.label}</span>
                  {e.campaign && <span className="av2-caption" style={{ flex: 'none' }}>{e.campaign}</span>}
                </div>
              ))}
              {filteredHistory.length > 80 && (
                <div className="av2-caption" style={{ padding: '8px 14px' }}>Showing the latest 80 events.</div>
              )}
            </div>
          )}
        </Card>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
              This permanently removes the lead and its activity history. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteMutation.mutate(); }}
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
