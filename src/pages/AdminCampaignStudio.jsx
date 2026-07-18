import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { Campaign } from '@/api/entities';
import { queryClient } from '@/lib/queryClient';
import { useCampaign, useCampaignLookup } from '@/hooks/queries/useCampaignsQuery';
import { customerLeadCaptureUrl, customerPublicUrl, resolveCustomerHost } from '@/lib/brand';
import useStudioDoc from '@/components/studio/useStudioDoc';
import useStudioGuards from '@/components/studio/useStudioGuards';
import StudioTopBar from '@/components/studio/StudioTopBar';
import StudioRail from '@/components/studio/StudioRail';
import StudioCanvas from '@/components/studio/StudioCanvas';
import FunnelJumper from '@/components/studio/FunnelJumper';
import { jumpStateById, quizStructureSignature } from '@/components/studio/studioJumpStates';
import PagePanel from '@/components/studio/panels/PagePanel';
import ThemePanel from '@/components/studio/panels/ThemePanel';
import FormPanel from '@/components/studio/panels/FormPanel';
import StudioQuizPanel from '@/components/studio/panels/QuizPanel';
import DistributionPanel from '@/components/studio/panels/DistributionPanel';
import CanvasDropSubject from '@/components/studio/CanvasDropSubject';
import CanvasMarketplaceSubject from '@/components/studio/CanvasMarketplaceSubject';
import StudioReadinessPopover from '@/components/studio/StudioReadinessPopover';
import { useServerReadiness, useMarketplacePreview } from '@/components/studio/useStudioData';
import { computeStudioReadiness } from '@/components/studio/studioReadiness';
import StudioJsonView from '@/components/studio/StudioJsonView';
import StudioGuardModal from '@/components/studio/StudioGuardModal';
import useStudioAi from '@/components/studio/useStudioAi';
import StudioAiPanel from '@/components/studio/StudioAiPanel';
import { studioPath, studioSupportsCampaign } from '@/components/studio/studioFlag';
import '@/styles/adminV2.css';

/**
 * Campaign Studio (PR 3) — the full-viewport editor that authors design_config
 * v2. Route: /admin/campaigns/:id/studio — always registered (the permanent
 * design surface since the teardown PR). Direction 1B
 * "Control Room": light chrome on the admin-v2 tokens, dark canvas stage.
 *
 * The page OWNS orchestration (doc lifecycle, guards, copy/share honesty);
 * rail panels and the canvas mount are separate components per checkpoint.
 */

export default function AdminCampaignStudio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: campaign, isLoading } = useCampaign(id);
  const { data: allCampaigns } = useCampaignLookup();

  const { doc, baseline, dirty, saving, savedAt, saveError, mut, setPath, replaceDoc, save, isStoredV1 } = useStudioDoc(campaign);

  const [section, setSection] = useState('page');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);

  // Slug — a campaign COLUMN with its own save path (never in the doc).
  const [slugDraft, setSlugDraft] = useState(null); // null = no draft
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugError, setSlugError] = useState(null);
  const slugDirty = slugDraft !== null && slugDraft !== (campaign?.slug || '');

  const { data: serverReadiness, status: readinessStatus } = useServerReadiness(campaign?.id);
  const { data: marketplacePreview, status: previewStatus } = useMarketplacePreview(campaign?.id);
  const readiness = useMemo(
    () =>
      computeStudioReadiness({
        campaign,
        doc,
        serverReadiness,
        serverStatus: readinessStatus,
        marketplacePreview,
      }),
    [campaign, doc, serverReadiness, readinessStatus, marketplacePreview]
  );

  // Funnel-state jumper (CP3): jump id + a reset counter — together they key
  // the canvas subject, so every jump/reset is a coherent remount while doc
  // edits re-render live without losing funnel state.
  const [jump, setJump] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  // Canvas subject lifted here (PR 4, F12) — picking an AI look must land the
  // operator on the page subject.
  const [subject, setSubject] = useState('page');

  // Unified dirty (Codex F10): the doc AND any unsaved slug draft drive every
  // guard — a pending slug is as losable as pending copy.
  const anyDirty = dirty || slugDirty;
  const { guard, guardedRun, leaveViaHistory, closeGuard } = useStudioGuards({
    dirty: anyDirty,
    campaignId: campaign?.id,
  });

  // "✦ Write it for me" (Studio PR 4 + full-coverage amendment) — fill-
  // everything suggestions, advisory recommendations + CO-1 look proposals;
  // fully campaign-scoped (the hook resets + aborts on switch). Picking a
  // look forces a coherent page-subject remount (F12). A slug recommendation
  // only PREFILLS the draft (own save path, post-activation lock) and lands
  // the operator on the Distribution panel to see it.
  const onPickLook = useCallback(() => {
    setSubject('page');
    setJump(null);
    setResetKey((k) => k + 1);
  }, []);
  const onSlugPrefill = useCallback((value) => {
    setSlugDraft(value);
    setSlugError(null);
    setSection('dist');
  }, []);
  const ai = useStudioAi({ campaign, doc, setPath, replaceDoc, onPickLook, onSlugPrefill, onJumpSection: setSection });
  const aiRef = useRef(ai);
  aiRef.current = ai;

  // Codex F11a: an edit can make the active jump unavailable (e.g. the SG/PR
  // gate toggled off while previewing it) — leave it instead of rendering a
  // contradictory state.
  useEffect(() => {
    if (!doc || !jump) return;
    const reason = jumpStateById(jump)?.available?.(doc, campaign);
    if (reason) {
      setJump(null);
      setResetKey((k) => k + 1);
      toast(`Preview state reset — ${reason}`);
    }
  }, [doc, jump, campaign]);

  // Codex F11b: STRUCTURAL quiz edits (steps/questions/profiles/mode) while a
  // Quiz-group jump is active remount the funnel so fixtures recompute against
  // the new shape; copy/theme edits never remount.
  const quizSig = useMemo(() => (doc ? quizStructureSignature(doc) : 'none'), [doc]);
  const prevQuizSigRef = useRef(quizSig);
  useEffect(() => {
    if (prevQuizSigRef.current === quizSig) return;
    prevQuizSigRef.current = quizSig;
    if (jump && jumpStateById(jump)?.group === 'Quiz') setResetKey((k) => k + 1);
  }, [quizSig, jump]);

  // Campaign switch: fresh preview state (the canvas itself remounts via key)
  // AND campaign-scoped drafts — a slug typed for A must never ride into B
  // (Codex diff-review #3).
  useEffect(() => {
    setJump(null);
    setResetKey(0);
    setSubject('page');
    setSlugDraft(null);
    setSlugError(null);
  }, [campaign?.id]);

  const switcherCampaigns = useMemo(() => {
    const list = (allCampaigns || []).filter(
      (c) => c.status !== 'archived' && c.type !== 'guided_review'
    );
    if (campaign && !list.some((c) => c.id === campaign.id)) list.unshift(campaign);
    return list;
  }, [allCampaigns, campaign]);

  const savedHostChoice = resolveCustomerHost(baseline?.distribution?.host);
  const savedHostName = savedHostChoice === 'mktr' ? 'mktr.sg' : 'redeem.sg';

  // Save = the whole doc + any pending slug draft (one PUT — slug is its own
  // field on the same endpoint). An INVALID pending slug blocks the save
  // instead of being silently dropped, and the draft only clears if it still
  // equals what was sent (the input stays editable in flight) — Codex #3.
  const SLUG_RE = /^[a-z0-9-]{3,80}$/;
  const handleSave = useCallback(async () => {
    // F9: EVERY save entry (toolbar, ⌘S, guard "Save & continue") converges
    // here — an unadopted AI look proposal must resolve before persisting.
    if (aiRef.current.proposal && !aiRef.current.proposal.adopted) {
      toast.error('Adopt or discard the AI look before saving.');
      return { ok: false, reason: 'proposal-unadopted' };
    }
    if (slugDirty && !(slugDraft === '' || SLUG_RE.test(slugDraft))) {
      setSlugError('Fix the slug before saving — 3–80 chars: a–z, 0–9, dashes.');
      setSection('dist');
      return { ok: false, reason: 'slug-invalid' };
    }
    const slugRide = slugDirty ? { slug: slugDraft || null } : {};
    const sentSlug = slugDraft;
    // Codex diff #3: commit only the proposal THIS save carried — a look
    // picked while the PUT is in flight must survive with its gate intact.
    const proposalAtStart = aiRef.current.proposal;
    const res = await save(slugRide);
    if (res.ok) {
      aiRef.current.notifySaved(proposalAtStart); // commit point — that look is no longer revertable
      if ('slug' in slugRide) setSlugDraft((cur) => (cur === sentSlug ? null : cur));
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['studio', 'readiness', id] });
      queryClient.invalidateQueries({ queryKey: ['studio', 'marketplace-preview', id] });
    } else if (res.reason === 'draw-invariant' || res.classified?.kind === 'draw-invariant') {
      setSection('form');
    }
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, id, slugDirty, slugDraft]);

  // The explicit "Save slug" action (Distribution panel) — slug ONLY, its own
  // path per the handoff; 409 lock / 422 format surfaced inline.
  const handleSlugSave = useCallback(async () => {
    if (!slugDirty) return;
    setSlugSaving(true);
    setSlugError(null);
    const sentSlug = slugDraft;
    try {
      await Campaign.update(id, { slug: sentSlug || null });
      setSlugDraft((cur) => (cur === sentSlug ? null : cur));
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['studio', 'marketplace-preview', id] });
      toast.success('Slug saved');
    } catch (err) {
      setSlugError(err?.message || 'Failed to save slug');
    } finally {
      setSlugSaving(false);
    }
  }, [id, slugDirty, slugDraft]);

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Copy/share accept an explicit host override: after a guarded "Save &
  // copy/mint", the parked closure would otherwise still see the PRE-save
  // baseline host (Codex diff-review #4) — the guard passes the host from the
  // save RESPONSE instead.
  const doCopyLink = useCallback(
    async ({ hostChoice } = {}) => {
      const url = customerLeadCaptureUrl(id, {}, hostChoice || savedHostChoice);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Lead capture link copied');
      } catch {
        toast.error('Could not copy link');
      }
    },
    [id, savedHostChoice]
  );

  const doSharePreview = useCallback(
    async ({ hostChoice } = {}) => {
      try {
        const res = await apiClient.post(`/campaigns/${id}/preview`, {});
        const urlPath = res?.data?.url || (res?.data?.slug ? `/p/${res.data.slug}` : null);
        if (!urlPath) {
          toast.error('Failed to generate preview link');
          return;
        }
        window.open(customerPublicUrl(urlPath, hostChoice || savedHostChoice), '_blank');
      } catch (e) {
        console.error('Failed to create preview:', e);
        toast.error('Failed to create preview');
      }
    },
    [id, savedHostChoice]
  );

  const goWorkspace = useCallback(() => {
    navigate(`/admin/campaigns/${id}/workspace`);
  }, [navigate, id]);

  const handleGuardPrimary = useCallback(async () => {
    const parked = guard;
    const res = await saveRef.current();
    closeGuard();
    if (!res.ok || !parked) return; // save error stays visible in the top bar
    if (parked.kind === 'back-browser') {
      leaveViaHistory();
      return;
    }
    // Codex #4: the just-saved doc (server response) is the host truth for a
    // parked copy/share — the closure's baseline-derived host is pre-save.
    const savedDoc = res.campaign?.design_config;
    const hostChoice = resolveCustomerHost(savedDoc?.distribution?.host ?? savedDoc?.customerHost);
    parked.action?.({ hostChoice });
  }, [guard, closeGuard, leaveViaHistory]);

  const handleGuardDiscard = useCallback(() => {
    const parked = guard;
    closeGuard();
    if (!parked) return;
    if (parked.kind === 'back-browser') leaveViaHistory();
    else parked.action?.();
  }, [guard, closeGuard, leaveViaHistory]);

  if (isLoading) {
    return (
      <div className="admin-v2" data-theme="light" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--canvas, #F4F5F7)' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-2, #5B616E)' }}>Loading Campaign Studio…</span>
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="admin-v2" data-theme="light" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--canvas, #F4F5F7)' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>Campaign not found.</p>
          <button type="button" className="av2-btn av2-btn--ghost" onClick={() => navigate('/AdminCampaigns')}>
            ← Back to campaigns
          </button>
        </div>
      </div>
    );
  }
  // Guided-review campaigns keep their own designer (binding out-of-scope).
  if (!studioSupportsCampaign(campaign)) {
    return <Navigate to={`/admin/campaigns/${campaign.id}/workspace?tab=design`} replace />;
  }

  return (
    <div
      className="admin-v2"
      data-theme="light"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--canvas, #F4F5F7)',
        color: 'var(--ink, #171A20)',
        fontFamily: "var(--font-ui, 'Schibsted Grotesk', system-ui, sans-serif)",
      }}
    >
      <div style={{ position: 'relative' }}>
      <StudioTopBar
        campaign={campaign}
        campaigns={switcherCampaigns}
        savedHostName={savedHostName}
        dirty={anyDirty}
        saving={saving}
        savedAt={savedAt}
        saveError={saveError}
        isStoredV1={isStoredV1}
        drawInfo={doc?.luckyDraw}
        readiness={doc ? { label: readiness.label, tone: readiness.tone } : null}
        onReadinessOpen={() => setReadyOpen((o) => !o)}
        onSave={handleSave}
        onSwitchCampaign={(nextId) => {
          if (!nextId || nextId === campaign.id) return;
          guardedRun('switch', () => navigate(studioPath(nextId)));
        }}
        onBack={() => guardedRun('back', goWorkspace)}
        onCopyLink={() => guardedRun('copy', doCopyLink)}
        onSharePreview={() => guardedRun('share', doSharePreview)}
        onRevertLook={ai.proposal ? ai.revertLook : null}
      />
      <div style={{ position: 'absolute', left: 320, top: '100%' }}>
        <StudioReadinessPopover
          open={readyOpen}
          items={readiness.items}
          onGoSection={setSection}
          onClose={() => setReadyOpen(false)}
        />
      </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <StudioRail
          section={section}
          onSection={setSection}
          sectionFlags={readiness.sectionFlags}
          onOpenJson={() => setJsonOpen(true)}
          onAi={doc ? () => ai.setOpen(true) : null}
        />

        <section
          aria-label="Inspector"
          style={{
            width: 308,
            flexShrink: 0,
            overflowY: 'auto',
            background: 'var(--surface, #fff)',
            borderRight: '1px solid var(--line, #E3E6EB)',
          }}
        >
          {doc && section === 'page' && (
            <PagePanel
              doc={doc}
              setPath={setPath}
              mut={mut}
              onSuggest={ai.suggestField}
              mediaHint={ai.mediaHint}
              onDismissMediaHint={ai.dismissMediaHint}
            />
          )}
          {doc && section === 'form' && (
            <FormPanel
              doc={doc}
              setPath={setPath}
              mut={mut}
              // Success-gated (Codex diff #6): stale cached data through a
              // failed refetch must not claim "verified".
              whatsappOtpConfigured={readinessStatus === 'success' ? serverReadiness?.whatsappOtpConfigured : undefined}
            />
          )}
          {doc && section === 'quiz' && <StudioQuizPanel doc={doc} campaign={campaign} setPath={setPath} />}
          {doc && section === 'theme' && <ThemePanel doc={doc} setPath={setPath} mut={mut} />}
          {doc && section === 'dist' && (
            <DistributionPanel
              doc={doc}
              setPath={setPath}
              mut={mut}
              campaign={campaign}
              marketplacePreview={marketplacePreview}
              slugDraft={slugDraft}
              onSlugDraftChange={(v) => {
                setSlugDraft(v);
                setSlugError(null);
              }}
              onSlugSave={handleSlugSave}
              slugSaving={slugSaving}
              slugError={slugError}
              onSuggest={ai.suggestField}
            />
          )}
        </section>

        {doc ? (
          <StudioCanvas
            key={campaign.id}
            campaign={campaign}
            doc={doc}
            jump={jump}
            jumpRenderKey={`${jump || 'default'}:${resetKey}`}
            subject={subject}
            onSubject={setSubject}
            banner={
              ai.proposal ? (
                <div
                  data-testid="studio-proposal-banner"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 14px',
                    background: '#2E3350',
                    color: '#DCE2FF',
                    font: "600 10.5px ui-monospace, 'SF Mono', Menlo, monospace",
                    letterSpacing: '.05em',
                  }}
                >
                  <span>
                    AI PROPOSAL — UNCOMMITTED · {ai.proposal.look.name}
                    {ai.proposal.adopted ? ' · ADOPTED (save to commit)' : ''}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={ai.revertLook}
                    style={{ border: 'none', background: 'none', color: '#B9C4FF', cursor: 'pointer', font: 'inherit' }}
                  >
                    ↩ Revert
                  </button>
                </div>
              ) : null
            }
            jumperSlot={
              <FunnelJumper
                doc={doc}
                campaign={campaign}
                jump={jump}
                onPick={(jumpId) => {
                  setJump(jumpId === 'default' ? null : jumpId);
                  setResetKey((k) => k + 1);
                }}
                onReset={() => {
                  setJump(null);
                  setResetKey((k) => k + 1);
                }}
              />
            }
            subjectSlots={{
              drop: <CanvasDropSubject doc={doc} />,
              card: (
                <CanvasMarketplaceSubject
                  campaign={{ ...campaign, slug: slugDraft ?? campaign.slug }}
                  doc={doc}
                  preview={marketplacePreview}
                  previewStatus={previewStatus}
                />
              ),
            }}
          />
        ) : (
          <main aria-label="Canvas" style={{ flex: 1, minWidth: 0, background: '#15171C' }} />
        )}
      </div>

      <StudioAiPanel ai={ai} campaign={campaign} doc={doc} />
      <StudioJsonView open={jsonOpen} doc={doc} onClose={() => setJsonOpen(false)} />
      <StudioGuardModal
        guard={guard}
        saving={saving}
        onPrimary={handleGuardPrimary}
        onDiscard={handleGuardDiscard}
        onCancel={closeGuard}
      />
    </div>
  );
}
