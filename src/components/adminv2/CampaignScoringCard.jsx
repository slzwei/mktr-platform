/**
 * "Lead scoring" card on the campaign page (campaign-scoring-editor §3.2).
 *
 * Read state: which sheet governs this campaign right now (tier chip +
 * activation meta) and, mid-regrade, how far the nightly sweeps have rolled
 * the new edition out. Customise opens the ScoringSheetEditor inline; Save
 * mints a DRAFT (composed server-side onto the winning raw doc), Preview
 * re-scores a sample under draft-vs-current at one fixed now, and Approve —
 * the only door to live — carries the §4.5 concurrency guard.
 *
 * Flag-off: the backend router is unmounted until SCORING_CONFIG_ADMIN_ENABLED
 * flips, so every call 404s. The card then says "unavailable on this backend"
 * — deliberately NOT "the flag is off": an old deploy 404s identically (B10).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useScoringSheet, useScoringHistory, useScoringProgress } from '@/hooks/queries/useAdminV2';
import { createScoringDraft, simulateScoringDraft, approveScoringDraft, fetchScoringEdition } from '@/api/adminV2';
import { Card, Chip, Skeleton, ErrorState } from '@/components/adminv2/primitives';
import { fmtDateTime } from '@/lib/adminV2/format';
import ScoringSheetEditor from '@/components/adminv2/ScoringSheetEditor';
import { EXPOSED_COMPONENTS, weightOf } from '@/lib/adminV2/scoringLabels';

const TIER_LABEL = {
  campaign: 'campaign sheet',
  product: 'product sheet',
  global: 'house sheet',
  default: 'house default',
};

/** The full exposed set as a patch — the editor always writes every exposed
 *  knob (§4.1: exposed knobs never float), UI-only keys stripped. */
function patchFromDoc(doc, houseDefault) {
  const components = {};
  const leadComponents = {};
  for (const comp of EXPOSED_COMPONENTS) {
    const value = weightOf(doc, comp) ?? weightOf(houseDefault, comp) ?? 0;
    (comp.leadGrain ? leadComponents : components)[comp.name] = { maxPoints: value };
  }
  const patch = { components, leadComponents };
  if (Array.isArray(doc?.ageCurve) && doc.ageCurve.length) patch.ageCurve = doc.ageCurve;
  if (Array.isArray(doc?.targetSegments)) patch.targetSegments = doc.targetSegments;
  return patch;
}

/** Seed the editor from the strict resolve: effective values only. */
function docFromSheet(sheet) {
  const cfg = sheet?.config || {};
  return {
    components: { ...(cfg.components || {}) },
    leadComponents: { ...(cfg.leadComponents || {}) },
    ageCurve: Array.isArray(cfg.ageCurve) ? cfg.ageCurve.map((s) => ({ ...s })) : [],
    targetSegments: Array.isArray(cfg.targetSegments) ? cfg.targetSegments.map((s) => ({ ...s })) : [],
    _ageBands: [],
  };
}

function PreviewPanel({ sim }) {
  if (!sim) return null;
  const d = sim.diff || {};
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="av2-microcaps">Preview — this change only</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4, display: 'grid', gap: 3 }}>
        <span>
          Average score {d.meanDelta > 0 ? 'rises' : d.meanDelta < 0 ? 'falls' : 'holds'}
          {d.meanDelta ? ` by ${Math.abs(d.meanDelta)} points` : ''} across {sim.population?.examined ?? 0} sampled lead{(sim.population?.examined ?? 0) === 1 ? '' : 's'}
          {sim.population?.truncated ? ' (a sample — the campaign holds more)' : ''}.
        </span>
        <span>{d.movedOver20 ?? 0} lead{(d.movedOver20 ?? 0) === 1 ? '' : 's'} would move more than 20 points.</span>
        {(d.becameNull ?? 0) > 0 && (
          <span style={{ color: 'var(--bad)', fontWeight: 700 }}>
            ⚠ {d.becameNull} lead{d.becameNull === 1 ? '' : 's'} would lose their Buy score entirely under this sheet.
          </span>
        )}
        {sim.stored && (
          <span style={{ color: 'var(--ink-3)' }}>
            Stored scores today: {sim.stored.scored} scored, mean {sim.stored.mean ?? '—'} — includes drift since each lead's last rescore.
          </span>
        )}
      </div>
    </div>
  );
}

export default function CampaignScoringCard({ campaignId }) {
  const qc = useQueryClient();
  const sheet = useScoringSheet(campaignId);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [doc, setDoc] = useState(null);
  // The version the admin SAW as live when the editor opened — the §4.5 guard.
  const [baseline, setBaseline] = useState(null);
  const [restoredFrom, setRestoredFrom] = useState(null);
  const [draft, setDraft] = useState(null);
  const [sim, setSim] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const progress = useScoringProgress(campaignId, { enabled: !sheet.isError });
  const history = useScoringHistory(campaignId, historyOpen);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['adminV2', 'scoringSheet', campaignId] });
    qc.invalidateQueries({ queryKey: ['adminV2', 'scoringHistory', campaignId] });
    qc.invalidateQueries({ queryKey: ['adminV2', 'scoringProgress', campaignId] });
  };

  const saveDraft = useMutation({
    mutationFn: () => createScoringDraft(campaignId, patchFromDoc(doc, sheet.data?.houseDefault)),
    onSuccess: async (row) => {
      setDraft(row);
      setSim(null);
      toast.success(`Draft edition #${row.version} saved — preview it before it can go live`);
      invalidate();
      try {
        setSim(await simulateScoringDraft(row.version));
      } catch (e) {
        toast.error(e?.message || 'Preview failed — you can retry it');
      }
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const approve = useMutation({
    mutationFn: ({ version }) => approveScoringDraft(version, baseline ?? sheet.data?.version ?? 0),
    onSuccess: (res) => {
      if (res?.noOp) {
        toast.info(`Already live — edition #${res.live?.version} has identical content. Nothing changed, no regrade triggered.`);
      } else {
        toast.success(`Edition #${res?.version} is live — leads regrade over the nightly runs`);
      }
      setEditing(false);
      setDraft(null);
      setSim(null);
      setConfirming(false);
      setRestoredFrom(null);
      invalidate();
    },
    onError: (e) => {
      if (e?.status === 409) toast.error(e?.message || 'The live sheet changed while you were editing — re-open preview.');
      else toast.error(e?.message || 'Approve failed');
    },
  });

  if (sheet.isLoading) return <Card span={12} title="Lead scoring"><div style={{ padding: 16 }}><Skeleton height={60} /></div></Card>;

  // 404 = router unmounted (flag off) OR an old backend — indistinguishable,
  // so the copy claims neither (round-2 B10).
  if (sheet.isError && sheet.error?.status === 404) {
    return (
      <Card span={12} title="Lead scoring">
        <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--ink-3)' }}>
          Scoring controls are unavailable on this backend.
        </div>
      </Card>
    );
  }
  if (sheet.isError) return <Card span={12} title="Lead scoring"><ErrorState error={sheet.error} onRetry={sheet.refetch} /></Card>;

  const s = sheet.data;
  const p = progress.data;
  const openEditor = (seedDoc, from = null) => {
    setDoc(seedDoc);
    setBaseline(s.version);
    setRestoredFrom(from);
    setDraft(null);
    setSim(null);
    setConfirming(false);
    setEditing(true);
  };

  return (
    <Card
      span={12}
      title="Lead scoring"
      meta={s.version > 0 ? `EDITION #${s.version}${s.activatedAt ? ` · LIVE SINCE ${fmtDateTime(s.activatedAt).toUpperCase()}` : ''}` : 'HOUSE DEFAULT'}
      action={!editing ? (
        <button type="button" className="av2-btn av2-btn--sm" onClick={() => openEditor(docFromSheet(s))}>
          Customise
        </button>
      ) : undefined}
    >
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone={s.scope === 'campaign' ? 'accent' : ''}>{TIER_LABEL[s.scope] || s.scope}</Chip>
          {s.actorName && <span className="av2-caption">approved by {s.actorName}</span>}
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {s.scope === 'campaign'
              ? 'This campaign scores by its own sheet.'
              : s.scope === 'product'
                ? 'Inherited from the product sheet — customising pins a sheet to this campaign only.'
                : 'Scoring by the house rules — customising pins a sheet to this campaign only.'}
          </span>
        </div>

        {/* Regrade progress — visible only while the sweep still owes leads. */}
        {p && !p.complete && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-2)' }} data-testid="scoring-progress">
            Regrading: <span className="av2-mono" style={{ fontWeight: 700 }}>{p.current} of {p.total}</span> leads
            are on edition #{p.resolvedVersion} — the rest roll through the nightly runs.
          </div>
        )}

        {editing && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            {restoredFrom && (
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>
                Editing a copy of edition #{restoredFrom} — saving mints a NEW draft.
              </div>
            )}
            <ScoringSheetEditor
              doc={doc}
              houseDefault={s.houseDefault}
              onChange={setDoc}
              disabled={saveDraft.isPending || approve.isPending}
            />
            <PreviewPanel sim={sim} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              {!draft ? (
                <button type="button" className="av2-btn av2-btn--primary av2-btn--sm" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate()}>
                  {saveDraft.isPending ? 'Saving…' : 'Save draft & preview'}
                </button>
              ) : !confirming ? (
                <button
                  type="button"
                  className="av2-btn av2-btn--primary av2-btn--sm"
                  disabled={approve.isPending || !sim}
                  title={!sim ? 'Preview must finish before this can go live' : undefined}
                  onClick={() => setConfirming(true)}
                >
                  Approve & apply
                </button>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
                    Make edition #{draft.version} live?
                    {draft.version < (s.version || 0) && (
                      <span style={{ color: 'var(--warn)' }}> This rolls back past edition #{s.version}.</span>
                    )}
                    {(sim?.diff?.becameNull ?? 0) > 0 && (
                      <span style={{ color: 'var(--bad)' }}> {sim.diff.becameNull} lead{sim.diff.becameNull === 1 ? '' : 's'} lose their Buy score.</span>
                    )}
                  </span>
                  <button
                    type="button" className="av2-btn av2-btn--primary av2-btn--sm" disabled={approve.isPending}
                    onClick={() => approve.mutate({ version: draft.version })}
                  >
                    {approve.isPending ? 'Approving…' : 'Yes, make it live'}
                  </button>
                  <button type="button" className="av2-btn av2-btn--sm" onClick={() => setConfirming(false)}>Back</button>
                </span>
              )}
              <button
                type="button" className="av2-btn av2-btn--sm"
                onClick={() => { setEditing(false); setDraft(null); setSim(null); setConfirming(false); setRestoredFrom(null); }}
              >Close</button>
              {draft && <span className="av2-caption">draft #{draft.version} — inert until approved</span>}
            </div>
          </div>
        )}

        {/* History: this campaign's editions only (server-side filter). */}
        <details
          style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}
          onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
        >
          <summary style={{ padding: '8px 0 2px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>
            Edition history
          </summary>
          {history.isLoading && <div style={{ padding: 8 }}><Skeleton height={30} /></div>}
          {history.isSuccess && history.data.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '6px 0' }}>No campaign editions yet — this campaign inherits.</div>
          )}
          {history.isSuccess && history.data.map((row) => (
            <div key={row.version} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 12.5 }}>
              <span className="av2-mono" style={{ width: 40, flex: 'none', fontWeight: 700 }}>#{row.version}</span>
              <Chip tone={row.status === 'approved' ? 'ok' : row.status === 'draft' ? '' : 'warn'}>{row.status}</Chip>
              <span style={{ flex: 1, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                {/* Drafts date by creation; only approved rows ever activated. */}
                {row.status === 'approved' && row.activatedAt ? `LIVE SINCE ${fmtDateTime(row.activatedAt).toUpperCase()}` : `DRAFTED ${fmtDateTime(row.createdAt).toUpperCase()}`}
                {row.actorName ? ` · ${row.actorName.toUpperCase()}` : ''}
              </span>
              {row.status === 'draft' && !editing && (
                <button
                  type="button" className="av2-btn av2-btn--sm"
                  onClick={async () => {
                    try {
                      const full = await fetchScoringEdition(row.version);
                      openEditor(docFromSheet({ config: { ...s.config, ...full.configJson } }), null);
                      setDraft(full);
                      setSim(await simulateScoringDraft(row.version));
                    } catch (e) {
                      toast.error(e?.message || 'Could not load that draft');
                    }
                  }}
                >Review & make live</button>
              )}
              {row.status !== 'draft' && !editing && (
                <button
                  type="button" className="av2-btn av2-btn--sm"
                  title="Copies this edition's settings into a fresh draft"
                  onClick={async () => {
                    try {
                      const full = await fetchScoringEdition(row.version);
                      openEditor(docFromSheet({ config: { ...s.houseDefault, ...full.configJson } }), row.version);
                    } catch (e) {
                      toast.error(e?.message || 'Could not load that edition');
                    }
                  }}
                >Restore as new draft</button>
              )}
            </div>
          ))}
        </details>
      </div>
    </Card>
  );
}
