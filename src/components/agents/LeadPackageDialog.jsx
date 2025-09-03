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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Campaign } from "@/api/entities";
import { Package, Save } from "lucide-react";

export default function LeadPackageDialog({ open, onOpenChange, agent, onSubmit }) {
  const [campaigns, setCampaigns] = useState([]);
  const [formData, setFormData] = useState({
    campaign_id: "",
    package_name: "",
    total_leads: "",
    price_per_lead: "",
    start_date: "",
    end_date: "",
    payment_status: "pending",
    notes: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      loadCampaigns();
      // Reset form for new package
      setFormData({
        campaign_id: "",
        package_name: "",
        total_leads: "",
        price_per_lead: "",
        start_date: new Date().toISOString().split('T')[0],
        end_date: "",
        payment_status: "pending",
        notes: ""
      });
    }
  }, [open]);

  const loadCampaigns = async () => {
    try {
      const campaignsData = await Campaign.list();
      // Filter out archived campaigns and only show active ones
      setCampaigns(campaignsData.filter(c => c.is_active && c.status !== 'archived'));
    } catch (error) {
      console.error("Failed to load campaigns:", error);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    // Auto-calculate total amount when leads or price changes
    if (name === 'total_leads' || name === 'price_per_lead') {
      const leads = name === 'total_leads' ? parseFloat(value) || 0 : parseFloat(formData.total_leads) || 0;
      const pricePerLead = name === 'price_per_lead' ? parseFloat(value) || 0 : parseFloat(formData.price_per_lead) || 0;
      // Total amount will be calculated on submit
    }
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
      if (!formData.campaign_id || !formData.package_name || !formData.total_leads || !formData.price_per_lead) {
        throw new Error("Please fill in all required fields");
      }

      const totalLeads = parseInt(formData.total_leads);
      const pricePerLead = parseFloat(formData.price_per_lead);
      const totalAmount = totalLeads * pricePerLead;

      const packageData = {
        ...formData,
        agent_id: agent.id,
        total_leads: totalLeads,
        price_per_lead: pricePerLead,
        total_amount: totalAmount,
        leads_remaining: totalLeads, // Initially all leads are remaining
        purchase_date: new Date().toISOString()
      };

      await onSubmit(packageData);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Failed to create lead package");
    }
    setLoading(false);
  };

  const totalAmount = (parseInt(formData.total_leads) || 0) * (parseFloat(formData.price_per_lead) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Create Lead Package for {agent?.full_name}
          </DialogTitle>
          <DialogDescription>
            Set up a new lead package with specific quantity and pricing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label htmlFor="campaign_id">Campaign *</Label>
            <Select 
              value={formData.campaign_id} 
              onValueChange={(value) => handleSelectChange("campaign_id", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select campaign" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="package_name">Package Name *</Label>
            <Input
              id="package_name"
              name="package_name"
              value={formData.package_name}
              onChange={handleChange}
              placeholder="e.g., Starter Package, Premium Package"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="total_leads">Total Leads *</Label>
              <Input
                id="total_leads"
                name="total_leads"
                type="number"
                min="1"
                value={formData.total_leads}
                onChange={handleChange}
                placeholder="100"
                required
              />
            </div>
            <div>
              <Label htmlFor="price_per_lead">Price per Lead (SGD) *</Label>
              <Input
                id="price_per_lead"
                name="price_per_lead"
                type="number"
                min="0"
                step="0.01"
                value={formData.price_per_lead}
                onChange={handleChange}
                placeholder="20.00"
                required
              />
            </div>
          </div>

          {totalAmount > 0 && (
            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm font-medium text-blue-900">
                Total Package Value: <span className="text-lg">${totalAmount.toFixed(2)} SGD</span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                name="start_date"
                type="date"
                value={formData.start_date}
                onChange={handleChange}
              />
            </div>
            <div>
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                name="end_date"
                type="date"
                value={formData.end_date}
                onChange={handleChange}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="payment_status">Payment Status</Label>
            <Select 
              value={formData.payment_status} 
              onValueChange={(value) => handleSelectChange("payment_status", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Additional notes about this package..."
              rows={3}
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
              {loading ? "Creating..." : "Create Package"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}