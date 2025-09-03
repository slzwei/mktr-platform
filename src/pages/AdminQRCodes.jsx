import { useState, useEffect } from "react";
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
  TableRow,
} from "@/components/ui/table";
import QrCode from "lucide-react/icons/qr-code";
import { format, parseISO } from "date-fns";
import CampaignQRManager from "@/components/qrcodes/CampaignQRManager";

export default function AdminQRCodes() {
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [userData, campaignsData] = await Promise.all([
          User.me(),
          Campaign.list("-created_date"),
        ]);
        setUser(userData);
        
        // Filter out archived campaigns - only show active campaigns for QR management
        const activeCampaigns = campaignsData.filter(campaign => campaign.status !== 'archived');
        setCampaigns(activeCampaigns);
      } catch (e) {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

  const handleBackToCampaigns = () => setSelectedCampaign(null);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-96 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  // Role gating handled by ProtectedRoute upstream

  if (selectedCampaign) {
    return <CampaignQRManager campaign={selectedCampaign} onBack={handleBackToCampaigns} />;
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">QR Code Management</h1>
            <p className="text-gray-600 mt-1">
              Generate and manage QR codes for your campaigns.
            </p>
          </div>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="w-6 h-6" />
              Select Campaign
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Campaign Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Age Range</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.id} className="hover:bg-gray-50">
                      <TableCell className="font-semibold">{campaign.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={campaign.is_active ? "default" : "outline"}
                          className={campaign.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}
                        >
                          {campaign.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {campaign.start_date ? format(parseISO(campaign.start_date), "dd MMM yyyy") : '-'} - {campaign.end_date ? format(parseISO(campaign.end_date), "dd MMM yyyy") : '-'}
                      </TableCell>
                      <TableCell>
                        {campaign.min_age} - {campaign.max_age || 'Any'}
                      </TableCell>
                      <TableCell>
                        <Button onClick={() => setSelectedCampaign(campaign)} disabled={!campaign.is_active} className="bg-blue-600 hover:bg-blue-700">
                          <QrCode className="w-4 h-4 mr-2" />
                          Manage QR Codes
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
                <p>Create a campaign first to generate QR codes.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}