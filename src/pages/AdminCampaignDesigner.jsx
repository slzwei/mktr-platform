import { Campaign } from "@/api/entities";
import { Button } from "@/components/ui/button";
import ArrowLeft from "lucide-react/icons/arrow-left";
import Eye from "lucide-react/icons/eye";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import { toast } from "sonner";

import DesignEditor from "../components/campaigns/DesignEditor";
import { apiClient } from "@/api/client";
import { useCurrentUser } from "@/hooks/queries/useUsersQuery";
import { useCampaign } from "@/hooks/queries/useCampaignsQuery";
import { queryClient } from "@/lib/queryClient";

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
      const url = `${window.location.origin}${urlPath}`;
      window.open(url, '_blank');
    } catch (e) {
      console.error('Failed to create preview:', e);
      toast.error('Failed to create preview');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Access Denied</h2>
          <p className="text-gray-600 dark:text-gray-400">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-900">
      {/* Compact Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <div>
            <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campaign Designer</h1>
            {campaign && (
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[300px]">{campaign.name}</p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePreview}
          disabled={!campaign}
        >
          <Eye className="w-4 h-4 mr-1" />
          Preview
        </Button>
      </div>

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
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Campaign not found</h3>
            <p className="text-gray-600 dark:text-gray-400">Please select a valid campaign to design.</p>
          </div>
        </div>
      )}
    </div>
  );
}
