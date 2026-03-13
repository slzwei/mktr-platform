import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import Package from "lucide-react/icons/package";
import Save from "lucide-react/icons/save";
import { leadPackageSchema } from "@/schemas/leadPackage";

export default function LeadPackageDialog({ open, onOpenChange, agent, onSubmit }) {
  const [campaigns, setCampaigns] = useState([]);

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(leadPackageSchema),
    defaultValues: {
      campaign_id: "",
      package_name: "",
      total_leads: "",
      price_per_lead: "",
      start_date: new Date().toISOString().split('T')[0],
      end_date: "",
      payment_status: "pending",
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      loadCampaigns();
      reset({
        campaign_id: "",
        package_name: "",
        total_leads: "",
        price_per_lead: "",
        start_date: new Date().toISOString().split('T')[0],
        end_date: "",
        payment_status: "pending",
        notes: "",
      });
    }
  }, [open, reset]);

  const loadCampaigns = async () => {
    try {
      const response = await Campaign.list({ status: 'active', limit: 100 });
      const campaignsList = response.campaigns || (Array.isArray(response) ? response : []);
      setCampaigns(campaignsList);
    } catch (error) {
      console.error("Failed to load campaigns:", error);
    }
  };

  const totalLeads = watch("total_leads");
  const pricePerLead = watch("price_per_lead");
  const totalAmount = (parseInt(totalLeads) || 0) * (parseFloat(pricePerLead) || 0);

  const onFormSubmit = async (data) => {
    try {
      const packageData = {
        ...data,
        agent_id: agent.id,
        total_amount: data.total_leads * data.price_per_lead,
        leads_remaining: data.total_leads,
        purchase_date: new Date().toISOString(),
      };

      await onSubmit(packageData);
      onOpenChange(false);
    } catch (err) {
      setError("root", { message: err.message || "Failed to create lead package" });
    }
  };

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
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4 py-4">
          <div>
            <Label htmlFor="campaign_id">Campaign *</Label>
            <Controller
              name="campaign_id"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
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
              )}
            />
            {errors.campaign_id && (
              <p className="text-red-600 text-xs mt-1">{errors.campaign_id.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="package_name">Package Name *</Label>
            <Input
              id="package_name"
              placeholder="e.g., Starter Package, Premium Package"
              {...register("package_name")}
            />
            {errors.package_name && (
              <p className="text-red-600 text-xs mt-1">{errors.package_name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="total_leads">Total Leads *</Label>
              <Input
                id="total_leads"
                type="number"
                min="1"
                placeholder="100"
                {...register("total_leads")}
              />
              {errors.total_leads && (
                <p className="text-red-600 text-xs mt-1">{errors.total_leads.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="price_per_lead">Price per Lead (SGD) *</Label>
              <Input
                id="price_per_lead"
                type="number"
                min="0"
                step="0.01"
                placeholder="20.00"
                {...register("price_per_lead")}
              />
              {errors.price_per_lead && (
                <p className="text-red-600 text-xs mt-1">{errors.price_per_lead.message}</p>
              )}
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
                type="date"
                {...register("start_date")}
              />
            </div>
            <div>
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                {...register("end_date")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="payment_status">Payment Status</Label>
            <Controller
              name="payment_status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes about this package..."
              rows={3}
              {...register("notes")}
            />
          </div>

          {errors.root && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
              {errors.root.message}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              {isSubmitting ? "Creating..." : "Create Package"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
