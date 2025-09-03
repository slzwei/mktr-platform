import React, { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, QrCode, Car, Tag, Plus } from "lucide-react";

import ExistingQRCodes from "./ExistingQRCodes";
import PromotionalQRForm from "./PromotionalQRForm";
import CarQRSelection from "./CarQRSelection";

export default function CampaignQRManager({ campaign, onBack }) {
  const [qrTags, setQrTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("existing");

  useEffect(() => {
    const loadQRTags = async () => {
      setLoading(true);
      try {
        const allQRTags = await QrTag.filter({ campaignId: campaign.id });
        setQrTags(allQRTags.filter(t => t.campaignId === campaign.id));
      } catch (error) {
        console.error("Error loading QR tags:", error);
      }
      setLoading(false);
    };

    loadQRTags();
  }, [campaign.id]);

  const handleRefreshQRTags = async () => {
    setLoading(true);
    try {
      const allQRTags = await QrTag.filter({ campaignId: campaign.id });
      setQrTags(allQRTags.filter(t => t.campaignId === campaign.id));
    } catch (error) {
      console.error("Error loading QR tags:", error);
    }
    setLoading(false);
  };

  const handleQRGenerated = () => {
    // Refresh the QR tags list and switch to existing tab
    handleRefreshQRTags();
    setActiveTab("existing");
  };

  const promotionalQRs = qrTags.filter(qr => qr.type === 'promo');
  const carQRs = qrTags.filter(qr => qr.type === 'car');

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Campaigns
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              QR Codes for "{campaign.name}"
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <Badge 
                variant={campaign.is_active ? "default" : "outline"}
                className={campaign.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}
              >
                {campaign.is_active ? "Active" : "Inactive"}
              </Badge>
              <span className="text-gray-500 text-sm">
                {promotionalQRs.length} Promotional • {carQRs.length} Car QRs
              </span>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="existing" className="flex items-center gap-2">
              <QrCode className="w-4 h-4" />
              Existing QR Codes ({qrTags.length})
            </TabsTrigger>
            <TabsTrigger value="promotional" className="flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Generate Promotional QR
            </TabsTrigger>
            <TabsTrigger value="car" className="flex items-center gap-2">
              <Car className="w-4 h-4" />
              Generate Car QRs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="existing">
            <ExistingQRCodes 
              qrTags={qrTags} 
              loading={loading}
              onRefresh={handleRefreshQRTags}
            />
          </TabsContent>

          <TabsContent value="promotional">
            <PromotionalQRForm 
              campaign={campaign}
              onQRGenerated={handleQRGenerated}
            />
          </TabsContent>

          <TabsContent value="car">
            <CarQRSelection 
              campaign={campaign}
              onQRGenerated={handleQRGenerated}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}