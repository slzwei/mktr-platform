import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agents as agentsAPI } from '@/api/client';
import { LeadPackage } from '@/api/entities';
import {
  useCampaignDeliveryPool,
  useBulkAssignCampaignPackage,
} from '@/hooks/queries/useCampaignsQuery';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, Users, Coins, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import LeadPackageTemplateDialog from '@/components/lead-packages/LeadPackageTemplateDialog';

/**
 * Delivery Pool tab — the campaign-first credits surface. Shows which agents are
 * actually in this campaign's lead round-robin (with remaining credits), and lets
 * an admin bulk-fund many agents with a campaign package in one action.
 */
export default function CampaignDeliveryPoolTab({ campaignId, campaignName }) {
  const queryClient = useQueryClient();
  const { data: pool, isLoading } = useCampaignDeliveryPool(campaignId);
  const { data: agentsData } = useQuery({ queryKey: ['agents', 'list'], queryFn: () => agentsAPI.getAll() });
  const bulkAssign = useBulkAssignCampaignPackage(campaignId);

  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState([]);
  const [pkgDialogOpen, setPkgDialogOpen] = useState(false);

  const packages = pool?.packages || [];
  const poolAgents = pool?.agents || [];
  const totals = pool?.totals || { fundedAgents: 0, remainingCredits: 0, heldLeads: 0 };
  const allAgents = (agentsData?.agents || []).filter(
    (a) => (a.role === 'agent' || !a.role) && a.isActive !== false
  );

  const toggleAgent = (id, checked) =>
    setSelectedAgentIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const handleAssign = async () => {
    if (!selectedPackageId || selectedAgentIds.length === 0) return;
    try {
      const res = await bulkAssign.mutateAsync({ packageId: selectedPackageId, agentIds: selectedAgentIds });
      const parts = [`${res.assigned} agent(s) funded`];
      if (res.skipped?.length) parts.push(`${res.skipped.length} already had this package`);
      if (res.invalid?.length) parts.push(`${res.invalid.length} skipped (not active agents)`);
      toast.success(parts.join(' · '));
      setSelectedAgentIds([]);
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || 'Failed to assign package');
    }
  };

  const handleCreatePackage = async (data) => {
    await LeadPackage.create({ ...data, campaignId });
    queryClient.invalidateQueries({ queryKey: ['campaignDeliveryPool', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['leadPackages'] });
    toast.success('Package created');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Funded agents" value={totals.fundedAgents} />
        <StatCard icon={Coins} label="Remaining credits" value={totals.remainingCredits} />
        <StatCard
          icon={PauseCircle}
          label="Held leads"
          value={totals.heldLeads}
          tone={totals.heldLeads > 0 ? 'warn' : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fund agents for this campaign</CardTitle>
          <CardDescription>
            Pick a lead package and the agents to give it to. Each funded agent joins this
            campaign&apos;s round-robin and spends one credit per delivered lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Lead package</label>
              <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                <SelectTrigger>
                  <SelectValue placeholder={packages.length ? 'Select a package' : 'No packages yet — create one'} />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.leadCount} leads)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setPkgDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New package
            </Button>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Agents ({selectedAgentIds.length} selected)</label>
            <ScrollArea className="h-48 rounded-md border border-border p-2">
              {allAgents.length === 0 ? (
                <p className="text-sm text-muted-foreground p-2">No active agents found.</p>
              ) : (
                allAgents.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-muted/50 rounded"
                  >
                    <Checkbox
                      checked={selectedAgentIds.includes(a.id)}
                      onCheckedChange={(c) => toggleAgent(a.id, !!c)}
                    />
                    <span className="text-sm">{a.fullName || a.full_name || a.email}</span>
                    <span className="text-xs text-muted-foreground">{a.phone}</span>
                  </label>
                ))
              )}
            </ScrollArea>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleAssign}
              disabled={!selectedPackageId || selectedAgentIds.length === 0 || bulkAssign.isPending}
            >
              {bulkAssign.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Assign to {selectedAgentIds.length || ''} agent{selectedAgentIds.length === 1 ? '' : 's'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery pool</CardTitle>
          <CardDescription>Agents currently receiving this campaign&apos;s leads.</CardDescription>
        </CardHeader>
        <CardContent>
          {poolAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No funded agents yet. Assign a package above to start delivering leads.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Remaining credits</TableHead>
                  <TableHead>Last funded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poolAgents.map((a) => (
                  <TableRow key={a.agentId}>
                    <TableCell className="font-medium">{a.fullName || a.email}</TableCell>
                    <TableCell className="text-muted-foreground">{a.phone || '—'}</TableCell>
                    <TableCell className="text-right">
                      <Badge className={a.remainingCredits > 0 ? 'bg-success/15 text-success' : 'bg-muted text-foreground'}>
                        {a.remainingCredits}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {a.lastPackageAssignedAt ? new Date(a.lastPackageAssignedAt).toLocaleDateString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LeadPackageTemplateDialog
        open={pkgDialogOpen}
        onOpenChange={setPkgDialogOpen}
        onSubmit={handleCreatePackage}
        lockCampaignId={campaignId}
        lockCampaignName={campaignName}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={`p-2 rounded-lg ${tone === 'warn' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary'}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
