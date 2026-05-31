import { Campaign } from"@/api/entities";
import { Button } from"@/components/ui/button";
import ArrowLeft from"lucide-react/icons/arrow-left";
import Eye from"lucide-react/icons/eye";
import { toast } from"sonner";

import DesignEditor from"../components/campaigns/DesignEditor";
import CampaignReadinessBanner from"../components/campaigns/CampaignReadinessBanner";
import { apiClient } from"@/api/client";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import { useCampaign } from"@/hooks/queries/useCampaignsQuery";
import { queryClient } from"@/lib/queryClient";
import { customerPublicUrl } from"@/lib/brand";

export default function AdminCampaignDesigner() {
 const campaignId = new URLSearchParams(window.location.search).get('campaign_id');
 const { data: user, isLoading: userLoading } = useCurrentUser();
 const { data: campaign, isLoading: campaignLoading } = useCampaign(campaignId);
 const loading = userLoading || campaignLoading;

 const handleSave = async (designData) => {
 if (!campaign) return;

 try {
 await Campaign.update(campaign.id, {
 design_config: designData
 });

 queryClient.invalidateQueries({ queryKey: ['campaigns'] });

 toast.success("Design saved successfully!");
 } catch (error) {
 console.error('Error saving design:', error);
 toast.error("Failed to save design");
 // Re-throw so DesignEditor.handleManualSave's catch runs: the dirty state
 // and unload guard stay armed, and the false "Saved" indicator is avoided.
 throw error;
 }
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
 // Open preview on the customer-facing redeem.sg so the admin reviews
 // the same render the customer would see (avoiding a mktr→redeem hop).
 const url = customerPublicUrl(urlPath);
 window.open(url, '_blank');
 } catch (e) {
 console.error('Failed to create preview:', e);
 toast.error('Failed to create preview');
 }
 };

 if (loading) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-muted">
 <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ring"></div>
 </div>
 );
 }

 // Role gating handled by ProtectedRoute; avoid double-deny here

 return (
 <div className="flex flex-col h-[calc(100vh-4rem)] bg-muted">
 {/* Compact Header */}
 <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border shrink-0">
 <div className="flex items-center gap-3">
 <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
 <ArrowLeft className="w-4 h-4 mr-1"/>
 Back
 </Button>
 <div className="h-5 w-px bg-muted"/>
 <div>
 <h1 className="text-sm font-semibold text-foreground">Campaign Designer</h1>
 {campaign && (
 <p className="text-xs text-muted-foreground truncate max-w-[300px]">{campaign.name}</p>
 )}
 </div>
 </div>
 <Button
 variant="outline" size="sm" onClick={handlePreview}
 disabled={!campaign}
 >
 <Eye className="w-4 h-4 mr-1"/>
 Preview
 </Button>
 </div>

 {campaign && <CampaignReadinessBanner campaignId={campaign.id} />}

 {/* Editor fills remaining space */}
 {campaign ? (
 <div className="flex-1 min-h-0">
 <DesignEditor
 key={campaign.id}
 campaign={campaign}
 onSave={handleSave}
 />
 </div>
 ) : (
 <div className="flex items-center justify-center flex-1">
 <div className="text-center">
 <h2 className="text-lg font-semibold text-foreground mb-2">Campaign not found</h2>
 <p className="text-muted-foreground">Please select a valid campaign to design.</p>
 </div>
 </div>
 )}
 </div>
 );
}
