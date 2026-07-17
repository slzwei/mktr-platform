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
import { studioPath, studioSupportsCampaign } from '@/components/studio/studioFlag';
import '@/styles/adminV2.css';

/**
 * Campaign Studio (PR 3) — the full-viewport editor that authors design_config
 * v2. Route: /admin/campaigns/:id/studio, registered only while
 * VITE_CAMPAIGN_STUDIO_ENABLED is on (src/pages/index.jsx). Direction 1B
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

  const { doc, baseline, dirty, saving, savedAt, saveError, mut, setPath, save, isStoredV1 } = useStudioDoc(campaign);

  const [section, setSection] = useState('page');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);

  // Slug — a campaign COLUMN with its own save path (never in the doc).
  const [slugDraft, setSlugDraft] = useState(null); // null = no draft
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugError, setSlugError] = useState(null);
  const slugDirty = slugDraft !== null && slugDraft !== (campaign?.slug || '');

  const { data: serverReadiness } = useServerReadiness(campaign?.id);
  const { data: marketplacePreview, status: previewStatus } = useMarketplacePreview(campaign?.id);
  const readiness = useMemo(
    () => computeStudioReadiness({ campaign, doc, serverReadiness, marketplacePreview }),
    [campaign, doc, serverReadiness, marketplacePreview]
  );

  // Funnel-state jumper (CP3): jump id + a reset counter — together they key
  // the canvas subject, so every jump/reset is a coherent remount while doc
  // edits re-render live without losing funnel state.
  const [jump, setJump] = useState(null);
  const [resetKey, setResetKey] = useState(0);

  // Unified dirty (Codex F10): the doc AND any unsaved slug draft drive every
  // guard — a pending slug is as losable as pending copy.
  const anyDirty = dirty || slugDirty;
  const { guard, guardedRun, leaveViaHistory, closeGuard } = useStudioGuards({ dirty: anyDirty });

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

  // Campaign switch: fresh preview state (the canvas itself remounts via key).
  useEffect(() => {
    setJump(null);
    setResetKey(0);
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

  // Save = the whole doc + any pending, format-valid slug draft (one PUT —
  // slug is its own field on the same endpoint; nothing pending is dropped).
  const SLUG_RE = /^[a-z0-9-]{3,80}$/;
  const handleSave = useCallback(async () => {
    const slugRide = slugDirty && (slugDraft === '' || SLUG_RE.test(slugDraft)) ? { slug: slugDraft || null } : {};
    const res = await save(slugRide);
    if (res.ok) {
      if ('slug' in slugRide) setSlugDraft(null);
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
    try {
      await Campaign.update(id, { slug: slugDraft || null });
      setSlugDraft(null);
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

  const doCopyLink = useCallback(async () => {
    const url = customerLeadCaptureUrl(id, {}, savedHostChoice);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Lead capture link copied');
    } catch {
      toast.error('Could not copy link');
    }
  }, [id, savedHostChoice]);

  const doSharePreview = useCallback(async () => {
    try {
      const res = await apiClient.post(`/campaigns/${id}/preview`, {});
      const urlPath = res?.data?.url || (res?.data?.slug ? `/p/${res.data.slug}` : null);
      if (!urlPath) {
        toast.error('Failed to generate preview link');
        return;
      }
      window.open(customerPublicUrl(urlPath, savedHostChoice), '_blank');
    } catch (e) {
      console.error('Failed to create preview:', e);
      toast.error('Failed to create preview');
    }
  }, [id, savedHostChoice]);

  const goWorkspace = useCallback(() => {
    navigate(`/admin/campaigns/${id}/workspace`);
  }, [navigate, id]);

  const handleGuardPrimary = useCallback(async () => {
    const parked = guard;
    const res = await saveRef.current();
    closeGuard();
    if (!res.ok || !parked) return; // save error stays visible in the top bar
    if (parked.kind === 'back-browser') leaveViaHistory();
    else parked.action?.();
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
          {doc && section === 'page' && <PagePanel doc={doc} setPath={setPath} mut={mut} />}
          {doc && section === 'form' && <FormPanel doc={doc} setPath={setPath} mut={mut} />}
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
