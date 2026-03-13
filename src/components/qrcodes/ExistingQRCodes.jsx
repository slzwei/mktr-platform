import { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { apiClient } from "@/api/client";
import { Prospect } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Download from "lucide-react/icons/download";
import LinkIcon from "lucide-react/icons/link";
import Copy from "lucide-react/icons/copy";
import Trash2 from "lucide-react/icons/trash-2";
import QrCodeIcon from "lucide-react/icons/qr-code";
import Loader2 from "lucide-react/icons/loader-2";
import Users from "lucide-react/icons/users";
import Pencil from "lucide-react/icons/pencil";
import UserIcon from "lucide-react/icons/user";

export default function ExistingQRCodes({ qrTags, loading, onRefresh }) {
  const [copiedLink, setCopiedLink] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [prospectCounts, setProspectCounts] = useState({});
  const [loadingProspects, setLoadingProspects] = useState(true);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingQr, setEditingQr] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Agent data for edit dialog
  const [lyfeAgents, setLyfeAgents] = useState([]);
  const [agentGroups, setAgentGroups] = useState([]);
  const [agentDataLoaded, setAgentDataLoaded] = useState(false);

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

  const [scanTotals, setScanTotals] = useState({});
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  useEffect(() => {
    const loadAnalytics = async () => {
      if (!qrTags || qrTags.length === 0) return;

      setLoadingAnalytics(true);
      try {
        const totals = {};
        const analyticsPromises = qrTags.map(async (qr) => {
          try {
            const resp = await apiClient.get(`/qrcodes/${qr.id}/analytics`);
            return { id: qr.id, data: resp?.data?.analytics?.summary || { totalScans: 0, landings: 0, leads: 0 } };
          } catch (e) {
            return { id: qr.id, data: { totalScans: 0, landings: 0, leads: 0 } };
          }
        });

        const results = await Promise.all(analyticsPromises);
        results.forEach(({ id, data }) => {
          totals[id] = data;
        });

        setScanTotals(totals);
      } catch (e) {
        console.warn('Failed to load QR analytics:', e);
      } finally {
        setLoadingAnalytics(false);
      }
    };

    loadAnalytics();
  }, [qrTags]);

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

  const handleDownload = (imageUrl, code, id) => {
    const downloadUrl = `${apiClient.baseURL}/qrcodes/${id}/download`;
    fetch(downloadUrl, { credentials: 'include', headers: { Authorization: `Bearer ${apiClient.getToken()}` } })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `qr-code-${code}.png`;
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
        onRefresh();
    } catch (error) {
        console.error("Failed to delete QR tag:", error);
    }
    setDeleting(false);
  };

  // --- Edit Dialog ---
  const loadAgentData = async () => {
    if (agentDataLoaded) return;
    try {
      const [agentsRes, groupsRes] = await Promise.all([
        apiClient.get('/lyfe/agents').catch(() => ({ data: [] })),
        apiClient.get('/admin/agent-groups').catch(() => ({ data: [] }))
      ]);
      setLyfeAgents(agentsRes.data || []);
      setAgentGroups(groupsRes.data || []);
      setAgentDataLoaded(true);
    } catch (err) {
      console.error('Failed to load agent data:', err);
    }
  };

  const openEditDialog = (qr) => {
    setEditingQr(qr);
    setEditForm({
      agentAssignmentMode: qr.agentAssignmentMode || 'direct',
      agentGroupId: qr.agentGroupId || null,
      agentGroupAgentIds: qr.agentGroupAgentIds || [],
      assignedAgentPhone: qr.assignedAgentPhone || null,
      assignedAgentEmail: qr.assignedAgentEmail || null,
      assignedAgentName: qr.assignedAgentName || null,
    });
    setEditError("");
    setEditDialogOpen(true);
    loadAgentData();
  };

  const handleEditSave = async () => {
    if (editForm.agentAssignmentMode === 'direct' && !editForm.assignedAgentPhone) {
      setEditError("An assigned agent is required for direct assignment");
      return;
    }
    if (editForm.agentAssignmentMode === 'round_robin' && !editForm.agentGroupId) {
      setEditError("An agent group is required for round robin");
      return;
    }

    setSaving(true);
    setEditError("");
    try {
      const updateData = {
        agentAssignmentMode: editForm.agentAssignmentMode,
      };
      if (editForm.agentAssignmentMode === 'direct') {
        updateData.assignedAgentPhone = editForm.assignedAgentPhone;
        updateData.assignedAgentEmail = editForm.assignedAgentEmail;
        updateData.assignedAgentName = editForm.assignedAgentName;
        updateData.agentGroupId = null;
        updateData.agentGroupAgentIds = [];
      } else {
        updateData.agentGroupId = editForm.agentGroupId;
        updateData.agentGroupAgentIds = editForm.agentGroupAgentIds;
        updateData.assignedAgentPhone = null;
        updateData.assignedAgentEmail = null;
        updateData.assignedAgentName = null;
      }

      await QrTag.update(editingQr.id, updateData);
      setEditDialogOpen(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to update QR assignment:', err);
      setEditError('Failed to update assignment. Please try again.');
    }
    setSaving(false);
  };

  const selectedEditGroup = agentGroups.find(g => g.id === editForm.agentGroupId);

  return (
    <>
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
              <TableRow className="bg-gray-50 dark:bg-gray-800">
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
                        <div className="rounded-md bg-gray-200 dark:bg-gray-600 h-16 w-16"></div>
                        <div className="flex-1 space-y-2 py-1">
                          <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-3/4"></div>
                          <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/2"></div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : qrTags.length > 0 ? (
                qrTags.map((qr) => (
                  <TableRow key={qr.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <TableCell>
                      {qr.qrImageUrl ? (
                        <div className="w-16 h-16 p-1 bg-white dark:bg-gray-800 rounded-md border">
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
                      <Badge variant={qr.type === 'car' ? 'secondary' : 'outline'}>
                        {qr.type === 'car' ? 'Car' : 'Promotional'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {qr.label || (qr.type === 'car' ? `Car ID: ${qr.carId}` : '')}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={qr.slug}>
                        Slug: {qr.slug}
                      </div>
                      {qr.slug && (
                        <div className="text-xs text-blue-700 dark:text-blue-400 break-all">
                          {`${trackingBase}/${qr.slug}`}
                        </div>
                      )}
                      {/* Assignment info */}
                      <div className="text-xs mt-1">
                        {qr.agentAssignmentMode === 'round_robin' ? (
                          <Badge variant="secondary" className="text-xs">
                            <Users className="w-3 h-3 mr-1" />
                            Round Robin
                          </Badge>
                        ) : qr.assignedAgentName ? (
                          <span className="text-gray-600 dark:text-gray-400">
                            <UserIcon className="w-3 h-3 inline mr-1" />
                            Agent: {qr.assignedAgentName}
                          </span>
                        ) : (
                          <span className="text-amber-600">No agent assigned</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col space-y-1">
                        {loadingAnalytics ? (
                          <div className="flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin text-gray-400 dark:text-gray-500" />
                            <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Scans:</span>
                              <span className="font-semibold text-sm text-blue-600">{scanTotals[qr.id]?.totalScans ?? 0}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Landings:</span>
                              <span className="font-medium text-xs text-green-600">{scanTotals[qr.id]?.landings ?? 0}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Leads:</span>
                              <span className="font-medium text-xs text-purple-600">{scanTotals[qr.id]?.leads ?? 0}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-500" />
                        {loadingProspects ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400 dark:text-gray-500" />
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
                        onClick={() => openEditDialog(qr)}
                        title="Edit assignment"
                      >
                        <Pencil className="w-4 h-4 mr-1" />
                      </Button>
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
                              This action cannot be undone. This will permanently delete the QR code
                              <span className="font-bold mx-1">"{qr.label || (qr.type === 'car' ? `car ${qr.carId || '-'}` : ((Array.isArray(qr.tags) && qr.tags.length) ? qr.tags.join(', ') : qr.slug))}"</span>
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
                  <TableCell colSpan="6" className="text-center py-12 text-gray-500 dark:text-gray-400">
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

    {/* Edit Assignment Dialog */}
    <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit QR Assignment</DialogTitle>
          <DialogDescription>
            Change how leads from "{editingQr?.label || editingQr?.slug}" are routed.
          </DialogDescription>
        </DialogHeader>

        {editError && (
          <div className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded text-sm">{editError}</div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-assignment-mode">Assignment Mode</Label>
            <Select
              value={editForm.agentAssignmentMode || 'direct'}
              onValueChange={(value) => setEditForm(prev => ({
                ...prev,
                agentAssignmentMode: value,
                ...(value === 'direct' ? { agentGroupId: null, agentGroupAgentIds: [] } : {}),
                ...(value === 'round_robin' ? { assignedAgentPhone: null, assignedAgentEmail: null, assignedAgentName: null } : {})
              }))}
            >
              <SelectTrigger id="edit-assignment-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct — assign to one agent</SelectItem>
                <SelectItem value="round_robin">Round Robin — rotate across group</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {editForm.agentAssignmentMode === 'round_robin' && (
            <div className="space-y-2">
              <Label htmlFor="edit-agent-group">Agent Group</Label>
              <Select
                value={editForm.agentGroupId || ""}
                onValueChange={(value) => {
                  const group = agentGroups.find(g => g.id === value);
                  setEditForm(prev => ({
                    ...prev,
                    agentGroupId: value || null,
                    agentGroupAgentIds: group ? (group.agents || []).map(a => a.phone) : []
                  }));
                }}
              >
                <SelectTrigger id="edit-agent-group">
                  <SelectValue placeholder="Select an agent group..." />
                </SelectTrigger>
                <SelectContent>
                  {agentGroups.map(group => (
                    <SelectItem
                      key={group.id}
                      value={group.id}
                      disabled={(group.agents || []).length === 0}
                    >
                      {group.name} ({(group.agents || []).length} agents)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEditGroup && (selectedEditGroup.agents || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(selectedEditGroup.agents || []).map(agent => (
                    <Badge key={agent.phone || agent.id} variant="secondary" className="text-xs">
                      {agent.name || agent.phone}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {editForm.agentAssignmentMode === 'direct' && (
            <div className="space-y-2">
              <Label htmlFor="edit-agent">Assigned Agent</Label>
              <Select
                value={editForm.assignedAgentPhone || ""}
                onValueChange={(phone) => {
                  const agent = lyfeAgents.find(a => a.phone === phone);
                  setEditForm(prev => ({
                    ...prev,
                    assignedAgentPhone: phone,
                    assignedAgentEmail: agent?.email || null,
                    assignedAgentName: agent?.name || null
                  }));
                }}
              >
                <SelectTrigger id="edit-agent">
                  <SelectValue placeholder="Select an agent..." />
                </SelectTrigger>
                <SelectContent>
                  {lyfeAgents.map(agent => (
                    <SelectItem key={agent.phone || agent.id} value={agent.phone}>
                      <div className="flex items-center gap-2">
                        <UserIcon className="w-3 h-3" />
                        <span>{agent.name}</span>
                        <span className="text-muted-foreground text-xs">{agent.phone}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleEditSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
