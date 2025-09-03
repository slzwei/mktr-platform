import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User } from "@/api/entities";
import { Campaign } from "@/api/entities";
import { Users, Save } from "lucide-react";

export default function ManageAgentsDialog({ open, onOpenChange, campaign }) {
  const [agents, setAgents] = useState([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadAgents();
    }
  }, [open]);

  useEffect(() => {
    if (campaign?.assigned_agents) {
      setSelectedAgentIds(new Set(campaign.assigned_agents));
    } else {
      setSelectedAgentIds(new Set());
    }
  }, [campaign]);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const allAgents = await User.filter({ role: 'agent' });
      setAgents(allAgents);
    } catch (error) {
      console.error("Failed to load agents:", error);
    }
    setLoading(false);
  };

  const handleToggleAgent = (agentId) => {
    setSelectedAgentIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Campaign.update(campaign.id, {
        assigned_agents: Array.from(selectedAgentIds),
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update assigned agents:", error);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Agents</DialogTitle>
          <DialogDescription>
            Assign agents to the "{campaign?.name}" campaign for round-robin distribution.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <ScrollArea className="h-72 w-full rounded-md border p-4">
            {loading ? (
              <p>Loading agents...</p>
            ) : agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                    <Users className="w-12 h-12 mb-4" />
                    <h3 className="font-semibold">No Agents Found</h3>
                    <p className="text-sm">You need to create users with the 'agent' role first.</p>
                </div>
            ) : (
              <div className="space-y-4">
                {agents.map((agent) => (
                  <div key={agent.id} className="flex items-center space-x-3">
                    <Checkbox
                      id={`agent-${agent.id}`}
                      checked={selectedAgentIds.has(agent.id)}
                      onCheckedChange={() => handleToggleAgent(agent.id)}
                    />
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-blue-100 text-blue-700">
                        {agent.full_name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <Label htmlFor={`agent-${agent.id}`} className="flex-1 cursor-pointer">
                      {agent.full_name}
                      <p className="text-xs text-gray-500 font-normal">{agent.email}</p>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}