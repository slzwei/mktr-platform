import { useState, useMemo } from"react";
import { useQuery, useQueryClient } from"@tanstack/react-query";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import { Campaign, QrTag } from"@/api/entities";
import CampaignQRManager from"@/components/qrcodes/CampaignQRManager";
import CampaignSelector from"@/components/qrcodes/CampaignSelector";
import PromotionalQRTable from"@/components/qrcodes/PromotionalQRTable";
import CarQRTable from"@/components/qrcodes/CarQRTable";

export default function AdminQRCodes() {
 const queryClient = useQueryClient();
 const { data: user } = useCurrentUser();

 const { data: campaignsRaw, isLoading: campaignsLoading } = useQuery({
 queryKey: ['campaigns', 'list', { sort: '-created_date', limit: 100 }],
 queryFn: () => Campaign.list({ sort: '-created_date', limit: 100 }),
 });

 const { data: qrTagsRaw, isLoading: qrLoading } = useQuery({
 queryKey: ['qrTags', 'list'],
 queryFn: () => QrTag.list({ sort: '-created_date', limit: 500 }),
 });

 const campaigns = useMemo(() => {
 const campaignsList = Array.isArray(campaignsRaw) ? campaignsRaw : (campaignsRaw?.campaigns || []);
 return campaignsList.filter(campaign => campaign.status !== 'archived');
 }, [campaignsRaw]);

 const allQrTags = useMemo(() => {
 const qrTagsList = Array.isArray(qrTagsRaw) ? qrTagsRaw : (qrTagsRaw?.qrTags || []);
 return qrTagsList || [];
 }, [qrTagsRaw]);

 const loading = campaignsLoading || qrLoading;

 const [selectedCampaign, setSelectedCampaign] = useState(null);
 const [campaignSearch, setCampaignSearch] = useState("");
 const [refreshing, setRefreshing] = useState(false);

 const promotionalQRs = useMemo(
 () => (allQrTags || []).filter(qr => qr.type !== 'car'),
 [allQrTags]
 );
 const carQRs = useMemo(
 () => (allQrTags || []).filter(qr => qr.type === 'car'),
 [allQrTags]
 );

 const refreshQrTables = async () => {
 setRefreshing(true);
 try {
 await queryClient.invalidateQueries({ queryKey: ['qrTags'] });
 await queryClient.invalidateQueries({ queryKey: ['campaigns'] });
 } catch (e) {
 console.error('Failed to refresh QR data:', e);
 }
 setRefreshing(false);
 };

 if (loading) {
 return (
 <div className="p-8">
 <div className="animate-pulse space-y-4">
 <div className="h-8 bg-muted rounded w-64"></div>
 <div className="h-96 bg-muted rounded-xl"></div>
 </div>
 </div>
 );
 }

 if (selectedCampaign) {
 return <CampaignQRManager campaign={selectedCampaign} onBack={() => setSelectedCampaign(null)} />;
 }

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-7xl mx-auto">
 <div className="flex justify-between items-center mb-8">
 <div>
 <h1 className="text-3xl font-bold text-foreground">QR Code Management</h1>
 <p className="text-muted-foreground mt-1">
 Generate and manage QR codes for your campaigns.
 </p>
 </div>
 </div>

 <CampaignSelector
 campaigns={campaigns}
 search={campaignSearch}
 onSearchChange={setCampaignSearch}
 onSelect={setSelectedCampaign}
 />

 <PromotionalQRTable
 qrTags={promotionalQRs}
 onRefresh={refreshQrTables}
 refreshing={refreshing}
 />

 <CarQRTable
 qrTags={carQRs}
 onRefresh={refreshQrTables}
 refreshing={refreshing}
 />
 </div>
 </div>
 );
}
