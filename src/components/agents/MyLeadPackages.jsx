
import React, { useState, useEffect } from "react";
import { LeadPackage } from "@/api/entities";
import { Campaign } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Package, 
  Calendar, 
  DollarSign, 
  Users, 
  Clock,
  CheckCircle2
} from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  active: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  paused: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-red-100 text-red-800"
};

const paymentStatusColors = {
  paid: "bg-green-100 text-green-800",
  pending: "bg-yellow-100 text-yellow-800",
  partial: "bg-orange-100 text-orange-800",
  refunded: "bg-red-100 text-red-800"
};

export default function MyLeadPackages({ userId }) {
  const [packages, setPackages] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [packagesData, allCampaignsData] = await Promise.all([
          LeadPackage.filter({ agent_id: userId }),
          Campaign.list()
        ]);
        
        // Filter out archived campaigns
        const campaignsData = allCampaignsData.filter(campaign => campaign.status !== 'archived');
        
        setPackages(packagesData);
        setCampaigns(campaignsData);
      } catch (error) {
        console.error('Error loading lead packages:', error);
      }
      setLoading(false);
    };

    loadData();
  }, [userId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            My Lead Packages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (packages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            My Lead Packages
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="font-medium text-gray-900">No Lead Packages</p>
          <p className="text-sm text-gray-500">You haven't purchased any lead packages yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          My Lead Packages
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {packages.map((pkg) => {
          const campaign = campaigns.find(c => c.id === pkg.campaign_id);
          const deliveryProgress = pkg.total_leads > 0 ? (pkg.leads_delivered / pkg.total_leads) * 100 : 0;
          
          return (
            <div key={pkg.id} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{pkg.package_name}</h3>
                  <p className="text-sm text-gray-600">
                    Campaign: {campaign?.name || 'Unknown Campaign'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge className={statusColors[pkg.status]}>
                    {pkg.status}
                  </Badge>
                  <Badge variant="outline" className={paymentStatusColors[pkg.payment_status]}>
                    {pkg.payment_status}
                  </Badge>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex justify-between items-center text-sm mb-1">
                  <span className="text-gray-600">Delivery Progress</span>
                  <span className="font-medium">
                    {pkg.leads_delivered} / {pkg.total_leads} leads
                  </span>
                </div>
                <Progress value={deliveryProgress} className="h-2" />
              </div>

              {/* Package Details Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-gray-500">Total Value</p>
                    <p className="font-semibold">${pkg.total_amount.toFixed(2)}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-gray-500">Per Lead</p>
                    <p className="font-semibold">${pkg.price_per_lead.toFixed(2)}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-gray-500">Remaining</p>
                    <p className="font-semibold text-blue-600">{pkg.leads_remaining}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-gray-500">Purchased</p>
                    <p className="font-semibold">
                      {format(new Date(pkg.purchase_date), 'dd/MM/yyyy')}
                    </p>
                  </div>
                </div>
              </div>

              {pkg.notes && (
                <div className="mt-3 p-2 bg-blue-50 rounded text-sm">
                  <p className="text-blue-800">{pkg.notes}</p>
                </div>
              )}

              {pkg.status === 'completed' && (
                <div className="mt-3 flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Package completed!</span>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
