import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QrTag } from "@/api/entities";
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
import { Link } from "react-router-dom";
import Download from "lucide-react/icons/download";
import LinkIcon from "lucide-react/icons/link";
import Copy from "lucide-react/icons/copy";
import Trash2 from "lucide-react/icons/trash-2";
import Users from "lucide-react/icons/users";
import Loader2 from "lucide-react/icons/loader-2";
import TagIcon from "lucide-react/icons/tag";
import RefreshCw from "lucide-react/icons/refresh-cw";

export default function PromotionalQRTable({ qrTags, onRefresh, refreshing }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [copiedLink, setCopiedLink] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ['qrTags'] });
    } catch (e) {
      console.error('Failed to delete QR tag:', e);
    }
    setDeleting(false);
  };

  const filtered = (qrTags || []).filter((qr) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const label = (qr.label || (Array.isArray(qr.tags) && qr.tags.length ? qr.tags.join(', ') : ''))?.toLowerCase();
    const slug = (qr.slug || '').toLowerCase();
    const campaignName = (qr.campaign?.name || '').toLowerCase();
    return label.includes(q) || slug.includes(q) || campaignName.includes(q);
  });

  return (
    <Card className="shadow-lg mt-8">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <TagIcon className="w-6 h-6" />
            All Promotional QR Codes ({qrTags.length})
          </CardTitle>
          <div className="flex items-center gap-2 w-full max-w-md">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search promotional QRs..." />
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
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
              <TableRow className="bg-gray-50 dark:bg-gray-800">
                <TableHead>QR Image</TableHead>
                <TableHead>Label / Slug</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Scans</TableHead>
                <TableHead>Prospects</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan="6" className="text-center py-8 text-gray-500 dark:text-gray-400">
                    {search ? `"${search}" is not found` : 'No promotional QR codes found.'}
                  </TableCell>
                </TableRow>
              ) : filtered.map((qr) => (
                <TableRow key={qr.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <TableCell>
                    {qr.qrImageUrl ? (
                      <div className="w-16 h-16 p-1 bg-white dark:bg-gray-900 rounded-md border">
                        <img
                          src={resolveBackendUrl(qr.qrImageUrl)}
                          alt={`QR Code ${qr.slug}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                        <span className="text-xs text-gray-500 dark:text-gray-400">No Image</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{qr.label || (Array.isArray(qr.tags) && qr.tags.length ? qr.tags.join(', ') : '-')}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={qr.slug}>Slug: {qr.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                      {qr.campaign?.name || '-'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-lg">{qr.scanCount ?? 0}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-500" />
                      <Link
                        to={`/admin/prospects?campaign=${qr.campaignId}&qrTagId=${qr.id}`}
                        className="font-semibold text-lg text-blue-600 dark:text-blue-400 hover:text-blue-800 hover:underline"
                      >
                        View
                      </Link>
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
        </div>
      </CardContent>
    </Card>
  );
}
