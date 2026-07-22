import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Campaign } from '@/api/entities';
import { apiClient } from '@/api/client';
import { useCampaign, useSetCampaignLaunchState } from '@/hooks/queries/useCampaignsQuery';
import { queryClient } from '@/lib/queryClient';
import { customerLeadCaptureUrl, customerPublicUrl, resolveCustomerHost } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Eye, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import DesignEditor from '@/components/campaigns/DesignEditor';
import OpenInStudioCard from '@/components/studio/OpenInStudioCard';
import QuizAnalyticsCard from '@/components/campaigns/QuizAnalyticsCard';
import { studioSupportsCampaign } from '@/components/studio/studioFlag';
import CampaignQRManager from '@/components/qrcodes/CampaignQRManager';
import CampaignDetailsTab from '@/components/campaigns/workspace/CampaignDetailsTab';
import CampaignDeliveryPoolTab from '@/components/campaigns/workspace/CampaignDeliveryPoolTab';
import CampaignLaunchTab from '@/components/campaigns/workspace/CampaignLaunchTab';
import { generateCampaignDesign } from '@/components/campaigns/workspace/autoDesign';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'design', label: 'Design' },
  { id: 'pool', label: 'Delivery Pool' },
  { id: 'sources', label: 'Sources' },
  { id: 'launch', label: 'Launch' },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function AdminCampaignWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isCreate = !id;
  const rawType = searchParams.get('type') || 'lead_generation';
  // 'lucky_draw' is a CREATE-FLOW choice, not a backend type: it creates a
  // lead_generation campaign with design_config.luckyDraw pre-armed (the
  // server validates closesAt + terms and pins the terms version on create).
  const isDrawCreate = isCreate && rawType === 'lucky_draw';
  const typeParam = rawType === 'lucky_draw' ? 'lead_generation' : rawType;
  const tabParam = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState(
    !isCreate && TAB_IDS.includes(tabParam) ? tabParam : 'details'
  );
  const [savingDetails, setSavingDetails] = useState(false);
  // Distinct from savingDetails: the post-create AI page-design pass. Drives a
  // separate "Designing…" button label so the many-second AI call never reads
  // as a stuck Create.
  const [designingPage, setDesigningPage] = useState(false);

  const { data: campaign, isLoading } = useCampaign(id);
  const launchMutation = useSetCampaignLaunchState(id);

  useEffect(() => {
    if (!isCreate && tabParam && TAB_IDS.includes(tabParam)) setActiveTab(tabParam);
  }, [tabParam, isCreate]);

  const goTab = (t) => {
    if (isCreate && t !== 'details') return; // other tabs need a saved campaign
    setActiveTab(t);
    if (!isCreate) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', t);
      setSearchParams(next, { replace: true });
    }
  };

  // Post-create AI page-design pass. Self-contained + never throws: on ANY
  // failure (provider off, rate-limited, network, no usable look) it just warns
  // and returns, leaving the created draft intact for the manual Studio button.
  const autoDesignCampaign = async (newId, designConfig, brief) => {
    setDesigningPage(true);
    const toastId = toast.loading('Designing your campaign page…');
    try {
      const nextDoc = await generateCampaignDesign({
        campaign: { id: newId, design_config: designConfig },
        brief,
      });
      if (!nextDoc) {
        toast.warning('Draft created — open the Design tab and click “Fill everything with AI” to design the page.', { id: toastId });
        return;
      }
      // Same save + cache-invalidation the manual design save does, so the
      // Design tab renders the freshly generated document.
      await Campaign.update(newId, { design_config: nextDoc });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'detail', newId] });
      toast.success('Page designed', { id: toastId });
    } catch {
      toast.warning('Draft created, but the page wasn’t auto-designed — open the Design tab and click “Fill everything with AI”.', { id: toastId });
    } finally {
      setDesigningPage(false);
    }
  };

  const handleSaveDetails = async (payload, brief) => {
    setSavingDetails(true);
    try {
      if (isCreate) {
        // New campaigns are created as a DRAFT (is_active:false) so they never go
        // live before being funded; the operator launches from the Launch tab.
        const created = await Campaign.create({ ...payload, is_active: false });
        const newId = created?.id || created?.campaign?.id;
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        toast.success('Draft created');
        // One brief → also design the whole page (the Studio's "Fill everything
        // with AI", run headlessly here). Best-effort ONLY: the draft is already
        // saved, so any AI failure just lands the operator on the Design tab with
        // the manual button — it must never undo or block the create.
        const trimmedBrief = typeof brief === 'string' ? brief.trim() : '';
        if (newId && trimmedBrief) {
          await autoDesignCampaign(newId, created?.design_config ?? payload.design_config, trimmedBrief);
        }
        if (newId) navigate(`/admin/campaigns/${newId}/workspace?tab=design`);
        else navigate('/AdminCampaigns');
      } else {
        await Campaign.update(id, payload);
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        queryClient.invalidateQueries({ queryKey: ['campaigns', 'detail', id] });
        toast.success('Details saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || 'Failed to save campaign');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleSaveDesign = async (designData) => {
    await Campaign.update(id, { design_config: designData });
    queryClient.invalidateQueries({ queryKey: ['campaigns', 'detail', id] });
    toast.success('Design saved');
  };

  const handlePreview = async () => {
    if (!campaign) return;
    try {
      const res = await apiClient.post(`/campaigns/${campaign.id}/preview`, {});
      const urlPath = res?.data?.url || (res?.data?.slug ? `/p/${res.data.slug}` : null);
      if (!urlPath) {
        toast.error('Failed to generate preview link');
        return;
      }
      const host = resolveCustomerHost(campaign?.design_config?.customerHost);
      window.open(customerPublicUrl(urlPath, host), '_blank');
    } catch (e) {
      console.error('Failed to create preview:', e);
      toast.error('Failed to create preview');
    }
  };

  const handleCopyLink = async () => {
    if (!campaign) return;
    const host = resolveCustomerHost(campaign?.design_config?.customerHost);
    const url = customerLeadCaptureUrl(campaign.id, {}, host);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Lead capture link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleSetLaunchState = async (state) => {
    try {
      await launchMutation.mutateAsync({ state });
      toast.success(state === 'active' ? 'Campaign activated' : 'Campaign paused');
    } catch (e) {
      // apiClient throws Error(message) with .status (not an axios-style .response).
      // The backend's 409 message already explains "not ready"; the Readiness banner
      // on this same tab shows the specific blockers.
      toast.error(e?.message || 'Failed to update launch state');
    }
  };

  if (!isCreate && isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isCreate && !campaign) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold mb-2">Campaign not found</h2>
        <Button variant="outline" onClick={() => navigate('/AdminCampaigns')}>Back to campaigns</Button>
      </div>
    );
  }

  const status = campaign?.status || (isCreate ? 'new' : 'draft');

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" aria-label="Back to campaigns" onClick={() => navigate('/AdminCampaigns')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {isCreate ? 'New campaign' : campaign?.name || 'Campaign'}
            </h1>
            <Badge className="mt-0.5 bg-muted text-foreground text-[11px]">{status}</Badge>
          </div>
        </div>
        {!isCreate && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyLink}>
              <Copy className="w-4 h-4 mr-1.5" /> Copy link
            </Button>
            <Button variant="outline" size="sm" onClick={handlePreview}>
              <Eye className="w-4 h-4 mr-1.5" /> Preview
            </Button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 lg:px-6 border-b border-border bg-card shrink-0 overflow-x-auto">
        {TABS.map((t) => {
          const disabled = isCreate && t.id !== 'details';
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => goTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'details' && (
          <div className="p-4 lg:p-6">
            <CampaignDetailsTab
              initial={isCreate ? null : campaign}
              type={typeParam}
              draw={isDrawCreate}
              isEdit={!isCreate}
              saving={savingDetails}
              designing={designingPage}
              onSubmit={handleSaveDetails}
            />
          </div>
        )}

        {/* Design tab = the Campaign Studio entry point (permanent since the
            teardown PR) — except guided_review, whose classic designer stays
            mounted here (CSS-hidden across tab switches so it keeps unsaved
            edits + its unload guard). */}
        {!isCreate && campaign && (
          <div className={activeTab === 'design' ? 'h-full' : 'hidden'}>
            {/* Quiz-results strip (relocated from the deleted standalone
                designer page — teardown PR): self-hides until the campaign
                has quiz submissions. quiz sits at the doc top level in BOTH
                design_config versions, so this read is version-safe. */}
            <QuizAnalyticsCard
              campaignId={campaign.id}
              profiles={campaign.design_config?.quiz?.resultProfiles}
            />
            {studioSupportsCampaign(campaign) ? (
              <OpenInStudioCard campaignId={campaign.id} />
            ) : (
              <DesignEditor
                key={campaign.id}
                campaign={campaign}
                onSave={handleSaveDesign}
                heightClass="h-[calc(100vh-13rem)]"
              />
            )}
          </div>
        )}

        {activeTab === 'pool' && !isCreate && (
          <div className="p-4 lg:p-6">
            <CampaignDeliveryPoolTab campaignId={campaign.id} campaignName={campaign.name} />
          </div>
        )}

        {activeTab === 'sources' && !isCreate && (
          <div className="p-4 lg:p-6">
            <CampaignQRManager campaign={campaign} embedded />
          </div>
        )}

        {activeTab === 'launch' && !isCreate && (
          <div className="p-4 lg:p-6">
            <CampaignLaunchTab campaign={campaign} onSetState={handleSetLaunchState} saving={launchMutation.isPending} />
          </div>
        )}
      </div>
    </div>
  );
}
