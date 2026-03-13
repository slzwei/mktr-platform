
import { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { apiClient } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import AlertCircle from "lucide-react/icons/alert-circle";
import Tag from "lucide-react/icons/tag";
import Loader2 from "lucide-react/icons/loader-2";
import CheckCircle from "lucide-react/icons/check-circle";
import UserIcon from "lucide-react/icons/user";
import Users from "lucide-react/icons/users";

export default function PromotionalQRForm({ campaign, onQRGenerated }) {
  const [formData, setFormData] = useState({
    label: "",
    tagsInput: "",
    description: "",
    agentAssignmentMode: campaign?.defaultAssignmentMode || 'direct',
    agentGroupId: null,
    agentGroupAgentIds: [],
    assignedAgentPhone: null,
    assignedAgentEmail: null,
    assignedAgentName: null
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lyfeAgents, setLyfeAgents] = useState([]);
  const [agentGroups, setAgentGroups] = useState([]);
  const [loadingAgentData, setLoadingAgentData] = useState(true);

  useEffect(() => {
    const loadAgentData = async () => {
      setLoadingAgentData(true);
      try {
        const [agentsRes, groupsRes] = await Promise.all([
          apiClient.get('/lyfe/agents').catch(() => ({ data: [] })),
          apiClient.get('/admin/agent-groups').catch(() => ({ data: [] }))
        ]);
        setLyfeAgents(agentsRes.data || []);
        setAgentGroups(groupsRes.data || []);
      } catch (err) {
        console.error('Failed to load agent data:', err);
      }
      setLoadingAgentData(false);
    };
    loadAgentData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.label.trim()) {
      setError("Label is required");
      return;
    }

    if (formData.agentAssignmentMode === 'direct' && !formData.assignedAgentPhone) {
      setError("An assigned agent is required for direct assignment");
      return;
    }

    if (formData.agentAssignmentMode === 'round_robin') {
      if (!formData.agentGroupId) {
        setError("An agent group is required for round robin assignment");
        return;
      }
      const group = agentGroups.find(g => g.id === formData.agentGroupId);
      if (!group || (group.agents || []).length === 0) {
        setError("Selected agent group must have at least 1 agent");
        return;
      }
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const tags = Array.from(new Set(
        (formData.tagsInput || '')
          .split(/[,\n;]+/)
          .map(t => t.trim())
          .filter(Boolean)
      ));

      const createData = {
        label: formData.label.trim(),
        tags,
        type: 'promo',
        campaignId: campaign.id,
        agentAssignmentMode: formData.agentAssignmentMode
      };

      if (formData.agentAssignmentMode === 'direct') {
        createData.assignedAgentPhone = formData.assignedAgentPhone;
        createData.assignedAgentEmail = formData.assignedAgentEmail;
        createData.assignedAgentName = formData.assignedAgentName;
      } else {
        createData.agentGroupId = formData.agentGroupId;
        createData.agentGroupAgentIds = formData.agentGroupAgentIds;
      }

      if (formData.description?.trim()) {
        createData.description = formData.description.trim();
      }

      await QrTag.create(createData);

      setSuccess(`Promotional QR code "${formData.label}" created successfully!`);
      // Preserve assignment fields on reset
      setFormData(prev => ({
        label: "",
        tagsInput: "",
        description: "",
        agentAssignmentMode: prev.agentAssignmentMode,
        agentGroupId: prev.agentGroupId,
        agentGroupAgentIds: prev.agentGroupAgentIds,
        assignedAgentPhone: prev.assignedAgentPhone,
        assignedAgentEmail: prev.assignedAgentEmail,
        assignedAgentName: prev.assignedAgentName,
      }));
      onQRGenerated();
    } catch (err) {
      console.error('Error creating promotional QR:', err);
      setError('Failed to create promotional QR code. Please try again.');
    }

    setLoading(false);
  };

  const selectedGroup = agentGroups.find(g => g.id === formData.agentGroupId);

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="w-5 h-5" />
          Generate Promotional QR Code
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">About Promotional QR Codes</h3>
            <p className="text-blue-700 text-sm">
              Promotional QR codes link directly to your campaign landing page and help you track
              the performance of different marketing channels or locations.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="promo-label">Label *</Label>
            <Input
              id="promo-label"
              value={formData.label}
              onChange={(e) => setFormData({...formData, label: e.target.value})}
              placeholder="e.g., Orchard Road Booth"
              maxLength={100}
              required
              aria-required="true"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="promo-tags">Tags (comma or newline separated)</Label>
            <Textarea
              id="promo-tags"
              value={formData.tagsInput}
              onChange={(e) => setFormData({...formData, tagsInput: e.target.value})}
              placeholder="Facebook, Instagram, Street Team"
              rows={3}
              maxLength={250}
            />
            <p className="text-sm text-gray-500">Multiple tags are supported; a single QR will include all tags for reporting.</p>
          </div>

          {/* Assignment Mode */}
          <div className="space-y-2">
            <Label htmlFor="promo-assignment-mode">Assignment Mode *</Label>
            {loadingAgentData ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 p-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading agent data...
              </div>
            ) : (
              <Select
                value={formData.agentAssignmentMode}
                onValueChange={(value) => setFormData(prev => ({
                  ...prev,
                  agentAssignmentMode: value,
                  // Clear opposite mode's data
                  ...(value === 'direct' ? { agentGroupId: null, agentGroupAgentIds: [] } : {}),
                  ...(value === 'round_robin' ? { assignedAgentPhone: null, assignedAgentEmail: null, assignedAgentName: null } : {})
                }))}
              >
                <SelectTrigger id="promo-assignment-mode" aria-required="true">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Direct — assign to one agent</SelectItem>
                  <SelectItem value="round_robin">Round Robin — rotate across agent group</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Round Robin: Agent Group picker */}
          {formData.agentAssignmentMode === 'round_robin' && !loadingAgentData && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="promo-agent-group">Agent Group *</Label>
                <Select
                  value={formData.agentGroupId || ""}
                  onValueChange={(value) => {
                    const group = agentGroups.find(g => g.id === value);
                    setFormData(prev => ({
                      ...prev,
                      agentGroupId: value || null,
                      agentGroupAgentIds: group ? (group.agents || []).map(a => a.phone) : []
                    }));
                  }}
                >
                  <SelectTrigger id="promo-agent-group" aria-required="true">
                    <SelectValue placeholder="Select an agent group..." />
                  </SelectTrigger>
                  <SelectContent>
                    {agentGroups.map(group => (
                      <SelectItem
                        key={group.id}
                        value={group.id}
                        disabled={(group.agents || []).length === 0}
                      >
                        <div className="flex items-center gap-2">
                          <Users className="w-3 h-3" />
                          <span>{group.name} ({(group.agents || []).length} agents)</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedGroup && (selectedGroup.agents || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(selectedGroup.agents || []).map(agent => (
                    <Badge key={agent.phone || agent.id} variant="secondary" className="text-xs">
                      {agent.name || agent.phone}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Direct: Agent picker */}
          {formData.agentAssignmentMode === 'direct' && !loadingAgentData && (
            <div className="space-y-2">
              <Label htmlFor="promo-agent">Assigned Agent *</Label>
              <Select
                value={formData.assignedAgentPhone || ""}
                onValueChange={(phone) => {
                  const agent = lyfeAgents.find(a => a.phone === phone);
                  setFormData(prev => ({
                    ...prev,
                    assignedAgentPhone: phone,
                    assignedAgentEmail: agent?.email || null,
                    assignedAgentName: agent?.name || null
                  }));
                }}
              >
                <SelectTrigger id="promo-agent" aria-required="true">
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

          <div className="space-y-2">
            <Label htmlFor="promo-description">Description (Optional)</Label>
            <Textarea
              id="promo-description"
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Additional notes about this QR code..."
              rows={3}
              maxLength={250}
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !formData.label.trim()}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating QR Code...
              </>
            ) : (
              <>
                <Tag className="w-4 h-4 mr-2" />
                Create Promotional QR Code
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
