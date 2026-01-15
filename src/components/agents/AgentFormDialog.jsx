
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
import Save from "lucide-react/icons/save";

export default function AgentFormDialog({ open, onOpenChange, agent, onSubmit }) {
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    owed_leads_count: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const formatSgPhone = (raw) => {
    const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  };

  useEffect(() => {
    if (agent) {
      setFormData({
        full_name: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
        email: agent.email || "",
        phone: formatSgPhone(agent.phone || ""),
        dateOfBirth: agent.dateOfBirth ? String(agent.dateOfBirth).slice(0, 10) : "",
        owed_leads_count: agent.owed_leads_count || 0,
      });
    } else {
      setFormData({
        full_name: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        owed_leads_count: 0,
      });
    }
    setError("");
  }, [agent, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      return setFormData((prev) => ({ ...prev, phone: formatSgPhone(value) }));
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = () => { };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Validate required fields
      if (!formData.full_name || !formData.email) {
        throw new Error("Full name and email are required");
      }

      await onSubmit(formData);
      onOpenChange(false);
    } catch (err) {
      // Surface backend-provided messages like duplicate email or self-invite
      setError(err?.message || "Failed to save agent");
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Agent" : "Invite New Agent"}</DialogTitle>
          <DialogDescription>
            {agent ? "Update the agent's information below." : "Enter the details to invite a new agent to your team."}
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

          {agent && (
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                placeholder="9123 4567"
              />
            </div>
          )}

          {agent && (
            <div>
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={handleChange}
              />
            </div>
          )}



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
              {loading ? "Inviting..." : agent ? "Save Agent" : "Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
