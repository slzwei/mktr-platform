import { useEffect, useMemo, useState } from "react";
import { Car, QrTag, Campaign } from "@/api/entities";
import { apiClient } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import Loader2 from "lucide-react/icons/loader-2";
import CarIcon from "lucide-react/icons/car";
import Search from "lucide-react/icons/search";
import Users from "lucide-react/icons/users";

export default function CarQRDirectory({ campaign, onAssigned }) {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filters, setFilters] = useState({ search: "" });
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedCarIds, setSelectedCarIds] = useState(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [agentGroups, setAgentGroups] = useState([]);
  const [bulkAssignmentMode, setBulkAssignmentMode] = useState('direct');
  const [bulkAgentGroupId, setBulkAgentGroupId] = useState(null);

  const backendOrigin = apiClient.baseURL.replace(/\/api\/?$/, "");
  const resolveBackendUrl = (path) => {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${backendOrigin}${path.startsWith('/') ? path : '/' + path}`;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const carList = await Car.list("-created_date");
        // Load car QR tags in parallel and ensure one per car
        const enriched = await Promise.all(carList.map(async (car) => {
          let tag = null;
          try {
            const tags = await QrTag.filter({ carId: car.id, type: 'car' });
            tag = Array.isArray(tags) && tags.length > 0 ? tags[0] : null;
          } catch (e) {
            tag = null;
          }
          // Ensure existence: create if missing (fixed-per-car)
          if (!tag) {
            try {
              tag = await QrTag.create({ type: 'car', carId: car.id, label: car.plate_number });
            } catch (e) {
              // If backend enforces idempotency, it may update instead of create; fetch again
              try {
                const tags = await QrTag.filter({ carId: car.id, type: 'car' });
                tag = Array.isArray(tags) && tags.length > 0 ? tags[0] : null;
              } catch (err) { void err }
            }
          }
          return { ...car, __carTag: tag };
        }));
        setCars(enriched);
      } catch (e) {
        setError('Failed to load cars or QR tags.');
      }
      setLoading(false);
    })();
  }, []);

  // Load campaigns and agent groups on mount for bulk assignment
  useEffect(() => {
    (async () => {
      try {
        const [campaignList, groupsRes] = await Promise.all([
          Campaign.list("-created_date"),
          apiClient.get('/admin/agent-groups').catch(() => ({ data: [] }))
        ]);
        setCampaigns(campaignList);
        setAgentGroups(groupsRes.data || []);
      } catch (e) {
        setCampaigns([]);
      }
    })();
  }, []);

  const filteredCars = useMemo(() => {
    const s = (filters.search || '').toLowerCase();
    return cars.filter(c => !s || c.plate_number?.toLowerCase().includes(s));
  }, [cars, filters]);

  const toggleSelectAll = (checked) => {
    if (checked) {
      setSelectedCarIds(new Set(filteredCars.map((c) => c.id)));
    } else {
      setSelectedCarIds(new Set());
    }
  };

  const toggleSelectOne = (carId, checked) => {
    setSelectedCarIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(carId); else next.delete(carId);
      return next;
    });
  };

  const bulkAssign = async () => {
    if (!selectedCampaignId || selectedCarIds.size === 0) return;
    setAssigning(true);
    setError("");
    setSuccess("");
    try {
      const ids = Array.from(selectedCarIds);
      const chosenCampaign = campaigns.find(c => c.id === selectedCampaignId) || null;
      for (const carId of ids) {
        const car = cars.find(c => c.id === carId);
        if (!car) continue;
        let tag = car.__carTag;
        if (!tag) {
          try {
            tag = await QrTag.create({ type: 'car', carId: car.id, label: car.plate_number });
          } catch (e) {
            try {
              const tags = await QrTag.filter({ carId: car.id, type: 'car' });
              tag = Array.isArray(tags) && tags.length > 0 ? tags[0] : null;
            } catch (err) { void err }
          }
        }
        if (tag) {
          const updatePayload = { campaignId: selectedCampaignId };
          if (bulkAssignmentMode === 'round_robin' && bulkAgentGroupId) {
            const group = agentGroups.find(g => g.id === bulkAgentGroupId);
            updatePayload.agentAssignmentMode = 'round_robin';
            updatePayload.agentGroupId = bulkAgentGroupId;
            // agentGroupAgentIds no longer needed; routing reads from agent_group_members table
          } else {
            updatePayload.agentAssignmentMode = 'direct';
          }
          await QrTag.update(tag.id, updatePayload);
        }
      }
      setSuccess(`Assigned ${selectedCarIds.size} car QR${selectedCarIds.size > 1 ? 's' : ''} to campaign.`);
      // Update local state
      setCars(prev => prev.map(c => selectedCarIds.has(c.id)
        ? { ...c, __carTag: { ...c.__carTag, campaignId: selectedCampaignId, campaign: chosenCampaign ? { id: chosenCampaign.id, name: chosenCampaign.name } : c.__carTag?.campaign } }
        : c
      ));
      setSelectedCarIds(new Set());
      setBulkDialogOpen(false);
      onAssigned && onAssigned();
    } catch (e) {
      setError(e?.message || 'Failed to assign selected QRs to campaign.');
    }
    setAssigning(false);
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CarIcon className="w-5 h-5" />
          Car QR Directory
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {error && (
            <div className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded">{error}</div>
          )}
          {success && (
            <div className="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-3 rounded">{success}</div>
          )}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3 md:justify-between">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                className="pl-10"
                placeholder="Search by plate number..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              {selectedCarIds.size > 0 && (
                <Button variant="secondary" onClick={() => setSelectedCarIds(new Set())}>Clear Selection</Button>
              )}
              <Button
                disabled={assigning || selectedCarIds.size === 0}
                onClick={() => { setSelectedCampaignId(""); setBulkDialogOpen(true); }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {assigning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Assign To Campaign ({selectedCarIds.size})
              </Button>
            </div>
          </div>

          <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 dark:bg-gray-800">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filteredCars.length > 0 && selectedCarIds.size === filteredCars.length}
                      onCheckedChange={(v) => toggleSelectAll(!!v)}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>QR</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Campaign</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan="5">
                      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 p-4">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredCars.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan="5" className="text-center py-10 text-gray-500 dark:text-gray-400">
                      No cars found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCars.map((car) => {
                    const tag = car.__carTag;
                    return (
                      <TableRow key={car.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <TableCell>
                          <Checkbox
                            checked={selectedCarIds.has(car.id)}
                            onCheckedChange={(v) => toggleSelectOne(car.id, !!v)}
                            aria-label={`Select ${car.plate_number}`}
                          />
                        </TableCell>
                        <TableCell>
                          {tag?.qrImageUrl ? (
                            <div className="w-16 h-16 p-1 bg-white dark:bg-gray-900 rounded-md border">
                              <img
                                src={resolveBackendUrl(tag.qrImageUrl)}
                                alt={`QR ${tag.slug}`}
                                className="w-full h-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                              <span className="text-xs text-gray-500 dark:text-gray-400">No Image</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{car.plate_number}</TableCell>
                        <TableCell className="text-xs">{tag?.slug || '-'}</TableCell>
                        <TableCell>
                          {tag?.campaignId ? (
                            <Badge variant="secondary">{tag?.campaign?.name || campaigns.find(c => c.id === tag.campaignId)?.name || 'Linked'}</Badge>
                          ) : (
                            <Badge variant="outline">Unassigned</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <AlertDialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Assign selected cars to campaign</AlertDialogTitle>
                <AlertDialogDescription>
                  Choose a campaign to link to the selected car QR codes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Campaign</Label>
                  <Select value={selectedCampaignId || ''} onValueChange={(v) => {
                    setSelectedCampaignId(v);
                    const camp = campaigns.find(c => c.id === v);
                    setBulkAssignmentMode(camp?.defaultAssignmentMode || 'direct');
                    setBulkAgentGroupId(null);
                  }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedCampaignId && (
                  <div className="space-y-2">
                    <Label>Assignment Mode</Label>
                    <Select value={bulkAssignmentMode} onValueChange={setBulkAssignmentMode}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct (no specific agent)</SelectItem>
                        <SelectItem value="round_robin">Round Robin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {bulkAssignmentMode === 'round_robin' && (
                  <div className="space-y-2">
                    <Label>Agent Group</Label>
                    <Select value={bulkAgentGroupId || ''} onValueChange={setBulkAgentGroupId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select agent group" />
                      </SelectTrigger>
                      <SelectContent>
                        {agentGroups.map((g) => (
                          <SelectItem key={g.id} value={g.id} disabled={(g.members || []).length === 0}>
                            <div className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {g.name} ({(g.members || []).length} agents)
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={assigning}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={bulkAssign} disabled={assigning || !selectedCampaignId} className="bg-blue-600 hover:bg-blue-700">
                  {assigning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignOptions({ mount, onOptions }) {
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!mount || loaded) return;
    (async () => {
      try {
        const list = await Campaign.list("-created_date");
        setItems(list);
      } catch (e) {
        setItems([]);
      }
      setLoaded(true);
    })();
  }, [mount, loaded]);

  // Render options into the existing SelectContent via DOM is complex; instead, directly render a second Select when loaded is true
  // To keep UI consistent, we will display a lightweight second select below when campaigns are loaded
  if (!mount) return null;

  return (
    <div>
      {items.length > 0 ? (
        <Select onValueChange={(v) => onOptions && onOptions(items)}>
          {/* no-op, we actually set options above; for simplicity we won't attempt to inject into parent select */}
        </Select>
      ) : null}
      {/* Replace parent SelectContent by mapping */}
      <div className="hidden" />
    </div>
  );
}
