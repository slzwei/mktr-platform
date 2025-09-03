import React, { useState, useEffect } from "react";
import { User } from "@/api/entities";
import { Campaign } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, parseISO } from "date-fns";
import { 
  Plus, 
  Edit, 
  Copy,
  Link as LinkIcon,
  Users,
  Palette,
  AlertTriangle
} from "lucide-react";

import CampaignFormDialog from "../components/campaigns/CampaignFormDialog";
import ManageAgentsDialog from "../components/campaigns/ManageAgentsDialog";

export default function AdminCampaigns() {
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAgentsDialogOpen, setIsAgentsDialogOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userData, campaignsData] = await Promise.all([
        User.me(),
        Campaign.list('-created_date')
      ]);
      
      setUser(userData);
      setCampaigns(campaignsData);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
    setLoading(false);
  };

  const handleOpenForm = (campaign = null) => {
    setSelectedCampaign(campaign);
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (formData) => {
    try {
      if (selectedCampaign) {
        await Campaign.update(selectedCampaign.id, formData);
      } else {
        await Campaign.create(formData);
      }
      await loadData();
      setIsFormOpen(false);
      setSelectedCampaign(null);
    } catch (error) {
      console.error('Error saving campaign:', error);
    }
  };

  const handleOpenAgentsDialog = (campaign) => {
    setSelectedCampaign(campaign);
    setIsAgentsDialogOpen(true);
  };

  const handleCopyLink = (campaignId) => {
    const baseUrl = window.location.origin;
    const campaignUrl = `${baseUrl}${createPageUrl(`LeadCapture?campaign_id=${campaignId}`)}`;
    
    navigator.clipboard.writeText(campaignUrl).then(() => {
      setCopiedId(campaignId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-96 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
        <p className="text-gray-600">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin - Campaign Management</h1>
            <p className="text-gray-600 mt-1">
              Create and manage your marketing campaigns.
            </p>
          </div>
          <Button onClick={() => handleOpenForm()} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-5 h-5 mr-2" />
            Create Campaign
          </Button>
        </div>

        <Card className="shadow-lg">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Campaign Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Age Range</TableHead>
                    <TableHead>Assigned Agents</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.id} className="hover:bg-gray-50">
                      <TableCell className="font-semibold">
                        <Link 
                          to={createPageUrl(`AdminProspects?campaign=${campaign.id}`)}
                          className="text-blue-600 hover:underline hover:text-blue-800"
                        >
                          {campaign.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={campaign.is_active ? "default" : "outline"}
                          className={
                            campaign.is_active
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }
                        >
                          {campaign.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(parseISO(campaign.start_date), "dd MMM yyyy")} -{" "}
                        {format(parseISO(campaign.end_date), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        {campaign.min_age} - {campaign.max_age || 'Any'}
                      </TableCell>
                      <TableCell>{campaign.assigned_agents?.length || 0}</TableCell>
                      <TableCell className="space-x-2 flex items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyLink(campaign.id)}
                        >
                          {copiedId === campaign.id ? <Copy className="w-4 h-4 mr-2 text-green-500" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                          {copiedId === campaign.id ? 'Copied!' : 'Copy Link'}
                        </Button>
                        <Link to={createPageUrl(`AdminCampaignDesigner?campaign_id=${campaign.id}`)}>
                            <Button
                                variant="outline"
                                size="sm"
                            >
                                <Palette className="w-4 h-4 mr-2" />
                                Design
                            </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenAgentsDialog(campaign)}
                        >
                          <Users className="w-4 h-4 mr-2" />
                          Agents
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenForm(campaign)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {campaigns.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <h3 className="font-semibold">No campaigns found.</h3>
                    <p>Click "Create Campaign" to get started.</p>
                </div>
            )}
          </CardContent>
        </Card>

        <CampaignFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          campaign={selectedCampaign}
          onSubmit={handleFormSubmit}
        />

        {selectedCampaign && (
            <ManageAgentsDialog
            open={isAgentsDialogOpen}
            onOpenChange={setIsAgentsDialogOpen}
            campaign={selectedCampaign}
            />
        )}
      </div>
    </div>
  );
}