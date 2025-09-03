import React, { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { Prospect } from "@/api/entities";
import { createPageUrl } from "@/utils";
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
import { Download, Link as LinkIcon, Copy, Trash2, QrCode as QrCodeIcon, Loader2, Users } from "lucide-react";

export default function ExistingQRCodes({ qrTags, loading, onRefresh }) {
  const [copiedLink, setCopiedLink] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [prospectCounts, setProspectCounts] = useState({});
  const [loadingProspects, setLoadingProspects] = useState(true);

  // Load prospect counts for all QR tags
  useEffect(() => {
    const loadProspectCounts = async () => {
      if (!qrTags || qrTags.length === 0) {
        setLoadingProspects(false);
        return;
      }

      setLoadingProspects(true);
      try {
        const counts = {};
        // Get all prospects and group by qr_tag_id
        const allProspects = await Prospect.list();
        
        qrTags.forEach(qrTag => {
          const count = allProspects.filter(prospect => prospect.qr_tag_id === qrTag.id).length;
          counts[qrTag.id] = count;
        });
        
        setProspectCounts(counts);
      } catch (error) {
        console.error("Failed to load prospect counts:", error);
      }
      setLoadingProspects(false);
    };

    loadProspectCounts();
  }, [qrTags]);

  const handleCopyLink = (qrTagCode) => {
    const url = `${window.location.origin}${createPageUrl(`LeadCapture?qr_tag_id=${qrTagCode}`)}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(qrTagCode);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const handleDownload = (imageUrl, code) => {
    fetch(imageUrl)
      .then(response => response.blob())
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `qr-code-${code}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch(err => console.error("Failed to download image:", err));
  };
  
  const handleDelete = async (qrTag) => {
    setDeleting(true);
    try {
        await QrTag.delete(qrTag.id);
        onRefresh(); // Refresh the list from the parent
    } catch (error) {
        console.error("Failed to delete QR tag:", error);
    }
    setDeleting(false);
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCodeIcon className="w-5 h-5" />
          Existing QR Codes
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>QR Image</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Scans</TableHead>
                <TableHead>Prospects</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(3).fill(0).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan="6" className="p-4">
                      <div className="animate-pulse flex space-x-4">
                        <div className="rounded-md bg-gray-200 h-16 w-16"></div>
                        <div className="flex-1 space-y-2 py-1">
                          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : qrTags.length > 0 ? (
                qrTags.map((qr) => (
                  <TableRow key={qr.id} className="hover:bg-gray-50">
                    <TableCell>
                      {qr.qr_image_url ? (
                        <div className="w-16 h-16 p-1 bg-white rounded-md border">
                          <img 
                            src={qr.qr_image_url} 
                            alt={`QR Code ${qr.code}`}
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
                      <Badge variant={qr.type === 'car' ? 'secondary' : 'outline'}>
                        {qr.type === 'car' ? 'Car' : 'Promotional'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-gray-900">
                        {qr.type === 'car' ? `Car ID: ${qr.car_id}` : `Tag: ${qr.tracking_tag}`}
                      </div>
                      <div className="text-xs text-gray-500 truncate" title={qr.code}>
                        Code: {qr.code}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-lg">{qr.scan_count || 0}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-500" />
                        {loadingProspects ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        ) : (
                          <span className="font-semibold text-lg text-blue-600">
                            {prospectCounts[qr.id] || 0}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="space-x-1 flex items-center">
                      <Button 
                        variant="outline" 
                        size="sm"
                        disabled={!qr.qr_image_url}
                        onClick={() => handleDownload(qr.qr_image_url, qr.code)}
                      >
                        <Download className="w-4 h-4 mr-1" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleCopyLink(qr.code)}
                      >
                        {copiedLink === qr.code ? <Copy className="w-4 h-4 mr-1 text-green-500" /> : <LinkIcon className="w-4 h-4 mr-1" />}
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
                              This action cannot be undone. This will permanently delete the QR code
                              <span className="font-bold mx-1">{qr.type === 'car' ? `for car ${qr.car_id}` : `"${qr.tracking_tag}"`}</span>
                              and its associated data. The link will no longer work.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                                onClick={() => handleDelete(qr)} 
                                disabled={deleting}
                                className="bg-red-600 hover:bg-red-700"
                            >
                              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                              {deleting ? 'Deleting...' : 'Delete'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan="6" className="text-center py-12 text-gray-500">
                    <h3 className="font-semibold">No QR codes found for this campaign.</h3>
                    <p>Generate one using the tabs above.</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}