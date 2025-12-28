import { useState, useEffect } from "react";
import { User } from "@/api/entities";
import { Campaign } from "@/api/entities";
import { Button } from "@/components/ui/button";
import ArrowLeft from "lucide-react/icons/arrow-left";
import Eye from "lucide-react/icons/eye";
import AlertTriangle from "lucide-react/icons/alert-triangle";
import { toast } from "sonner";

import DesignEditor from "../components/campaigns/DesignEditor";
import { apiClient } from "@/api/client";

export default function AdminCampaignDesigner() {
  const [user, setUser] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const userData = await User.me();
      setUser(userData);

      const params = new URLSearchParams(window.location.search);
      const campaignId = params.get('campaign_id');

      if (campaignId) {
        const campaignData = await Campaign.get(campaignId);
        if (campaignData) {
          console.log('Loaded campaign with design_config:', campaignData.design_config);
          setCampaign(campaignData);
        }
      }
    } catch (error) {
      console.error('Error loading campaign designer:', error);
    }
    setLoading(false);
  };

  const handleSave = async (designData) => {
    if (!campaign) return;

    try {
      console.log('Saving design data to campaign:', designData);
      await Campaign.update(campaign.id, {
        design_config: designData
      });

      // Reload the entire campaign data to ensure we get the latest
      await loadData();

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
          <p className="text-gray-600">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between p-6 bg-white border-b">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin - Campaign Designer</h1>
            <p className="text-gray-600">
              {campaign ? `Designing: ${campaign.name}` : 'Design your campaign landing page'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={!campaign}
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>

        </div>
      </div>

      {campaign ? (
        <DesignEditor
          key={campaign.id} // Force re-render when campaign changes
          campaign={campaign}
          onSave={handleSave}
        />
      ) : (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Campaign not found</h3>
            <p className="text-gray-600">Please select a valid campaign to design.</p>
          </div>
        </div>
      )}
    </div>
  );
}