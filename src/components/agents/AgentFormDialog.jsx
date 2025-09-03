
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Save from "lucide-react/icons/save";

export default function AgentFormDialog({ open, onOpenChange, agent, onSubmit }) {
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    status: "active",
    owed_leads_count: 0,
    agent_notes: "",
    join_date: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (agent) {
      setFormData({
        full_name: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
        email: agent.email || "",
        phone: agent.phone || "",
        status: agent.isActive ? "active" : "inactive",
        owed_leads_count: agent.owed_leads_count || 0,
        agent_notes: agent.agent_notes || "",
        join_date: agent.createdAt ? agent.createdAt.split('T')[0] : "",
      });
    } else {
      // Reset to default for new agent
      setFormData({
        full_name: "",
        email: "",
        phone: "",
        status: "active",
        owed_leads_count: 0,
        agent_notes: "",
        join_date: new Date().toISOString().split('T')[0],
      });
    }
    setError("");
  }, [agent, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Validate required fields
      if (!formData.full_name || !formData.email) {
        throw new Error("Full name and email are required");
      }

      // Updated: Set role as 'user' and user_type as 'agent'
      const agentData = {
        ...formData,
        role: 'user',
        user_type: 'agent'
      };

      await onSubmit(agentData);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Failed to save agent");
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Agent" : "Add New Agent"}</DialogTitle>
          <DialogDescription>
            {agent ? "Update the agent's information below." : "Fill in the details for the new agent."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              placeholder="Agent's full name"
              required
            />
          </div>

          <div>
            <Label htmlFor="email">Email Address *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="agent@company.com"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+65 XXXX XXXX"
              />
            </div>
            <div>
              <Label htmlFor="date_of_birth">Date of Birth</Label>
              <Input
                id="date_of_birth"
                name="date_of_birth"
                type="date"
                value={formData.date_of_birth}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="status">Status</Label>
              <Select 
                value={formData.status} 
                onValueChange={(value) => handleSelectChange("status", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="owed_leads_count">Owed Leads Count</Label>
              <Input
                id="owed_leads_count"
                name="owed_leads_count"
                type="number"
                min="0"
                value={formData.owed_leads_count}
                onChange={handleChange}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="join_date">Join Date</Label>
            <Input
              id="join_date"
              name="join_date"
              type="date"
              value={formData.join_date}
              onChange={handleChange}
            />
          </div>

          <div>
            <Label htmlFor="agent_notes">Internal Notes</Label>
            <Input
              id="agent_notes"
              name="agent_notes"
              value={formData.agent_notes}
              onChange={handleChange}
              placeholder="Internal notes about this agent..."
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              {loading ? "Saving..." : "Save Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
