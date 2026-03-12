
import { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { apiClient } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AlertCircle from "lucide-react/icons/alert-circle";
import Tag from "lucide-react/icons/tag";
import Loader2 from "lucide-react/icons/loader-2";
import CheckCircle from "lucide-react/icons/check-circle";
import UserIcon from "lucide-react/icons/user";

// Simple UUID v4 alternative using crypto API or fallback
const generateUniqueId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export default function PromotionalQRForm({ campaign, onQRGenerated }) {
  const [formData, setFormData] = useState({
    label: "",
    tagsInput: "",
    assignedAgentPhone: null,
    assignedAgentEmail: null,
    assignedAgentName: null
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lyfeAgents, setLyfeAgents] = useState([]);

  const isDirectMode = campaign?.agentAssignmentMode === 'direct';

  useEffect(() => {
    if (isDirectMode) {
      apiClient.get('/lyfe/agents')
        .then(res => setLyfeAgents(res.data || []))
        .catch(() => {});
    }
  }, [isDirectMode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.label.trim()) {
      setError("Label is required");
      return;
    }

    if (isDirectMode && !formData.assignedAgentPhone) {
      setError("An assigned agent is required for direct assignment campaigns");
      return;
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
        campaignId: campaign.id
      };

      if (isDirectMode) {
        createData.assignedAgentPhone = formData.assignedAgentPhone;
        createData.assignedAgentEmail = formData.assignedAgentEmail;
        createData.assignedAgentName = formData.assignedAgentName;
      }

      await QrTag.create(createData);

      setSuccess(`Promotional QR code "${formData.label}" created successfully!`);
      setFormData({ label: "", tagsInput: "" });
      onQRGenerated();
    } catch (err) {
      console.error('Error creating promotional QR:', err);
      setError('Failed to create promotional QR code. Please try again.');
    }
    
    setLoading(false);
  };

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
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-5 h-5" />
              <span>{success}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="label">Label *</Label>
            <Input
              id="label"
              value={formData.label}
              onChange={(e) => setFormData({...formData, label: e.target.value})}
              placeholder="e.g., Orchard Road Booth"
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma or newline separated)</Label>
            <Textarea
              id="tags"
              value={formData.tagsInput}
              onChange={(e) => setFormData({...formData, tagsInput: e.target.value})}
              placeholder="Facebook, Instagram, Street Team"
              rows={3}
              maxLength={250}
            />
            <p className="text-sm text-gray-500">Multiple tags are supported; a single QR will include all tags for reporting.</p>
          </div>

          {isDirectMode && (
            <div className="space-y-2">
              <Label>Assigned Agent *</Label>
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
                <SelectTrigger>
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

          {!isDirectMode && campaign?.agentAssignmentMode === 'round_robin' && (
            <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">
              Leads from this QR code will be round-robin assigned to the campaign's agent group.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
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
