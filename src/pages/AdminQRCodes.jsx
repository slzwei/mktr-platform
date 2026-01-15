import { useState, useEffect } from "react";
import { User, Campaign, QrTag, Prospect } from "@/api/entities";
import { apiClient } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import QrCode from "lucide-react/icons/qr-code";
import Download from "lucide-react/icons/download";
import LinkIcon from "lucide-react/icons/link";
import Copy from "lucide-react/icons/copy";
import Trash2 from "lucide-react/icons/trash-2";
import Users from "lucide-react/icons/users";
import Loader2 from "lucide-react/icons/loader-2";
import CarIcon from "lucide-react/icons/car";
import TagIcon from "lucide-react/icons/tag";
import RefreshCw from "lucide-react/icons/refresh-cw";
import { format, parseISO } from "date-fns";
import CampaignQRManager from "@/components/qrcodes/CampaignQRManager";

export default function AdminQRCodes() {
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allQrTags, setAllQrTags] = useState([]);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [promoSearch, setPromoSearch] = useState("");
  const [carSearch, setCarSearch] = useState("");

  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scanTotals, setScanTotals] = useState({});
  const [copiedLink, setCopiedLink] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [userData, campaignsData, qrTagsDataHelper] = await Promise.all([
          User.me(),
          Campaign.list({ sort: "-created_date", limit: 100 }),
          QrTag.list({ sort: "-created_date", limit: 500 }),
        ]);
        setUser(userData);

        // Handle paginated responses
        const campaignsList = Array.isArray(campaignsData) ? campaignsData : (campaignsData.campaigns || []);
        const qrTagsList = Array.isArray(qrTagsDataHelper) ? qrTagsDataHelper : (qrTagsDataHelper.qrTags || []);

        // Filter out archived campaigns - only show active campaigns for QR management
        const activeCampaigns = campaignsList.filter(campaign => campaign.status !== 'archived');
        setCampaigns(activeCampaigns);
        setAllQrTags(qrTagsList || []);
      } catch (e) {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const loadAnalytics = async () => {
      if (!allQrTags || allQrTags.length === 0) return;

      setLoadingAnalytics(true);
      try {
        const totals = {};
        const analyticsPromises = (allQrTags || []).map(async (qr) => {
          try {
            const resp = await apiClient.get(`/qrcodes/${qr.id}/analytics`);
            return { id: qr.id, data: resp?.data?.analytics?.summary || { totalScans: 0, landings: 0, leads: 0 } };
          } catch (_) {
            return { id: qr.id, data: { totalScans: 0, landings: 0, leads: 0 } };
          }
        });

        const results = await Promise.all(analyticsPromises);
        results.forEach(({ id, data }) => {
          totals[id] = data;
        });
        setScanTotals(totals);
      } finally {
        setLoadingAnalytics(false);
      }
    };

    loadAnalytics();
  }, [allQrTags]);

  const handleBackToCampaigns = () => setSelectedCampaign(null);

  const backendOrigin = apiClient.baseURL.replace(/\/api\/?$/, "");
  const trackingBase = `${backendOrigin}/t`;
  const resolveBackendUrl = (path) => {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${backendOrigin}${path.startsWith('/') ? path : '/' + path}`;
  };

  const handleCopyLink = (slug) => {
    const url = `${trackingBase}/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(slug);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const handleDownload = (imageUrl, slug, id) => {
    const downloadUrl = `${apiClient.baseURL}/qrcodes/${id}/download`;
    fetch(downloadUrl, { credentials: 'include', headers: { Authorization: `Bearer ${apiClient.getToken()}` } })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `qr-code-${slug || 'code'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch(err => console.error('Failed to download image via proxy:', err));
  };

  const handleDelete = async (qrTag) => {
    setDeleting(true);
    try {
      await QrTag.delete(qrTag.id);
      // refresh lists
      const refreshed = await QrTag.list({ sort: "-created_date", limit: 500 });
      const refreshedList = Array.isArray(refreshed) ? refreshed : (refreshed.qrTags || []);
      setAllQrTags(refreshedList || []);
    } catch (e) {
      console.error('Failed to delete QR tag:', e);
    }
    setDeleting(false);
  };

  const refreshQrTables = async () => {
    setRefreshing(true);
    try {
      const qrTagsData = await QrTag.list({ sort: "-created_date", limit: 500 });
      const qrTagsList = Array.isArray(qrTagsData) ? qrTagsData : (qrTagsData.qrTags || []);
      setAllQrTags(qrTagsList || []);
      setAllQrTags(qrTagsList || []);
    } catch (e) {
      console.error('Failed to refresh QR data:', e);
    }
    setRefreshing(false);
  };

  const promotionalQRs = (allQrTags || []).filter(qr => qr.type !== 'car');
  const carQRs = (allQrTags || []).filter(qr => qr.type === 'car');

  // Filters
  const filteredCampaigns = (campaigns || []).filter((c) => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name?.toLowerCase().includes(q) ||
      (c.status || (c.is_active ? 'active' : 'inactive'))?.toString().toLowerCase().includes(q)
    );
  });

  const filteredPromotional = promotionalQRs.filter((qr) => {
    const q = promoSearch.trim().toLowerCase();
    if (!q) return true;
    const label = (qr.label || (Array.isArray(qr.tags) && qr.tags.length ? qr.tags.join(', ') : ''))?.toLowerCase();
    const slug = (qr.slug || '').toLowerCase();
    const campaignName = (qr.campaign?.name || '').toLowerCase();
    return label.includes(q) || slug.includes(q) || campaignName.includes(q);
  });

  const filteredCars = carQRs.filter((qr) => {
    const q = carSearch.trim().toLowerCase();
    if (!q) return true;
    const plate = (qr.car?.plate_number || '').toLowerCase();
    const label = (qr.label || '').toLowerCase();
    const slug = (qr.slug || '').toLowerCase();
    const campaignName = (qr.campaign?.name || '').toLowerCase();
    return plate.includes(q) || label.includes(q) || slug.includes(q) || campaignName.includes(q);
  });

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
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-6 h-6" />
                Select Campaign
              </CardTitle>
              <div className="w-full max-w-sm">
                <Input value={campaignSearch} onChange={(e) => setCampaignSearch(e.target.value)} placeholder="Search campaigns..." />
              </div>
            </div>
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
                  {filteredCampaigns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan="5" className="text-center py-8 text-gray-500">
                        {campaignSearch ? `"${campaignSearch}" is not found` : 'No campaigns found.'}
                      </TableCell>
                    </TableRow>
                  ) : filteredCampaigns.map((campaign) => (
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
            {/* Removed duplicate empty state below table; table row already shows empty message */}
          </CardContent>
        </Card>

        {/* Promotional QR Codes Table */}
        <Card className="shadow-lg mt-8">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <TagIcon className="w-6 h-6" />
                All Promotional QR Codes ({promotionalQRs.length})
              </CardTitle>
              <div className="flex items-center gap-2 w-full max-w-md">
                <Input value={promoSearch} onChange={(e) => setPromoSearch(e.target.value)} placeholder="Search promotional QRs..." />
                <Button variant="outline" size="sm" onClick={refreshQrTables} disabled={refreshing}>
                  {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>QR Image</TableHead>
                    <TableHead>Label / Slug</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Scans</TableHead>
                    <TableHead>Prospects</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPromotional.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan="6" className="text-center py-8 text-gray-500">
                        {promoSearch ? `"${promoSearch}" is not found` : 'No promotional QR codes found.'}
                      </TableCell>
                    </TableRow>
                  ) : filteredPromotional.map((qr) => (
                    <TableRow key={qr.id} className="hover:bg-gray-50">
                      <TableCell>
                        {qr.qrImageUrl ? (
                          <div className="w-16 h-16 p-1 bg-white rounded-md border">
                            <img
                              src={resolveBackendUrl(qr.qrImageUrl)}
                              alt={`QR Code ${qr.slug}`}
                              className="w-full h-full object-contain"
                            />
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded-md bg-gray-100 flex items-center justify-center">
                            <span className="text-xs text-gray-500">No Image</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">{qr.label || (Array.isArray(qr.tags) && qr.tags.length ? qr.tags.join(', ') : '-')}</div>
                        <div className="text-xs text-gray-500 truncate" title={qr.slug}>Slug: {qr.slug}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          {qr.campaign?.name || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {loadingAnalytics ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        ) : (
                          <span className="font-semibold text-lg">{scanTotals[qr.id]?.totalScans ?? 0}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-500" />
                          {loadingAnalytics ? (
                            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                          ) : (
                            <Link
                              to={`/admin/prospects?campaign=${qr.campaignId}&qrTagId=${qr.id}`}
                              className="font-semibold text-lg text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {scanTotals[qr.id]?.leads || 0}
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="space-x-1 flex items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!qr.qrImageUrl}
                          onClick={() => handleDownload(qr.qrImageUrl, qr.slug, qr.id)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyLink(qr.slug)}
                        >
                          {copiedLink === qr.slug ? <Copy className="w-4 h-4 mr-1 text-green-500" /> : <LinkIcon className="w-4 h-4 mr-1" />}
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="w-4 h-4 mr-1" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the promotional QR
                                <span className="font-bold mx-1">"{qr.label || (Array.isArray(qr.tags) && qr.tags.length ? qr.tags.join(', ') : qr.slug)}"</span>
                                and its associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(qr)} disabled={deleting} className="bg-red-600 hover:bg-red-700">
                                {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                {deleting ? 'Deleting...' : 'Delete'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Removed duplicate empty state below table; table row already shows empty message */}
            </div>
          </CardContent>
        </Card>

        {/* Car QR Codes Table */}
        <Card className="shadow-lg mt-8">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <CarIcon className="w-6 h-6" />
                All Car QR Codes ({carQRs.length})
              </CardTitle>
              <div className="flex items-center gap-2 w-full max-w-md">
                <Input value={carSearch} onChange={(e) => setCarSearch(e.target.value)} placeholder="Search car QRs..." />
                <Button variant="outline" size="sm" onClick={refreshQrTables} disabled={refreshing}>
                  {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>QR Image</TableHead>
                    <TableHead>Car Details</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Scans</TableHead>
                    <TableHead>Prospects</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCars.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan="6" className="text-center py-8 text-gray-500">
                        {carSearch ? `"${carSearch}" is not found` : 'No car QR codes found.'}
                      </TableCell>
                    </TableRow>
                  ) : filteredCars.map((qr) => (
                    <TableRow key={qr.id} className="hover:bg-gray-50">
                      <TableCell>
                        {qr.qrImageUrl ? (
                          <div className="w-16 h-16 p-1 bg-white rounded-md border">
                            <img
                              src={resolveBackendUrl(qr.qrImageUrl)}
                              alt={`QR Code ${qr.slug}`}
                              className="w-full h-full object-contain"
                            />
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded-md bg-gray-100 flex items-center justify-center">
                            <span className="text-xs text-gray-500">No Image</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">{qr.car?.plate_number || (qr.label ? `Car: ${qr.label}` : `Car ID: ${qr.carId}`)}</div>
                        {qr.car && (qr.car.model || qr.car.make) ? (
                          <div className="text-sm text-gray-500">{qr.car.make} {qr.car.model}</div>
                        ) : null}
                        <div className="text-xs text-gray-500 truncate" title={qr.slug}>Slug: {qr.slug}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          {qr.campaign?.name || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {loadingAnalytics ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        ) : (
                          <span className="font-semibold text-lg">{scanTotals[qr.id]?.totalScans ?? 0}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-500" />
                          {loadingAnalytics ? (
                            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                          ) : (
                            <Link
                              to={`/admin/prospects?campaign=${qr.campaignId}&qrTagId=${qr.id}`}
                              className="font-semibold text-lg text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {scanTotals[qr.id]?.leads || 0}
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="space-x-1 flex items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!qr.qrImageUrl}
                          onClick={() => handleDownload(qr.qrImageUrl, qr.slug, qr.id)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyLink(qr.slug)}
                        >
                          {copiedLink === qr.slug ? <Copy className="w-4 h-4 mr-1 text-green-500" /> : <LinkIcon className="w-4 h-4 mr-1" />}
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="w-4 h-4 mr-1" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the car QR for
                                <span className="font-bold mx-1">{qr.car?.plate_number || qr.carId || '-'}</span>
                                and its associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(qr)} disabled={deleting} className="bg-red-600 hover:bg-red-700">
                                {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                {deleting ? 'Deleting...' : 'Delete'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Removed duplicate empty state below table; table row already shows empty message */}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}