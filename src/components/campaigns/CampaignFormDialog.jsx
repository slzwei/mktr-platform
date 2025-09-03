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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import CalendarIcon from "lucide-react/icons/calendar";
import Save from "lucide-react/icons/save";
import { format, parseISO } from "date-fns";

export default function CampaignFormDialog({ open, onOpenChange, campaign, onSubmit }) {
  const [formData, setFormData] = useState({
    name: "",
    min_age: 18,
    max_age: 65,
    start_date: new Date(),
    end_date: new Date(),
    is_active: true,
    commission_amount_driver: "",
    commission_amount_fleet: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (campaign) {
      setFormData({
        name: campaign.name || "",
        min_age: campaign.min_age || 18,
        max_age: campaign.max_age || 65,
        start_date: campaign.start_date ? parseISO(campaign.start_date) : new Date(),
        end_date: campaign.end_date ? parseISO(campaign.end_date) : new Date(),
        is_active: campaign.is_active !== undefined ? campaign.is_active : true,
        commission_amount_driver: campaign.commission_amount_driver ?? "",
        commission_amount_fleet: campaign.commission_amount_fleet ?? "",
      });
    } else {
      // Reset to default for new campaign
      setFormData({
        name: "",
        min_age: 18,
        max_age: 65,
        start_date: new Date(),
        end_date: new Date(),
        is_active: true,
        commission_amount_driver: "",
        commission_amount_fleet: "",
      });
    }
  }, [campaign, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (name, date) => {
    setFormData((prev) => ({ ...prev, [name]: date }));
  };

  const handleSwitchChange = (checked) => {
    setFormData((prev) => ({ ...prev, is_active: checked }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Format dates as ISO strings
      const formattedData = {
        name: formData.name,
        min_age: formData.min_age,
        max_age: formData.max_age,
        is_active: formData.is_active,
        start_date: formData.start_date.toISOString(),
        end_date: formData.end_date.toISOString(),
      };
      // If empty string, send null to clear value; otherwise send number
      formattedData.commission_amount_driver = formData.commission_amount_driver === "" ? null : Number(formData.commission_amount_driver);
      formattedData.commission_amount_fleet = formData.commission_amount_fleet === "" ? null : Number(formData.commission_amount_fleet);
      await onSubmit(formattedData);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to submit campaign:", error);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{campaign ? "Edit Campaign" : "Create New Campaign"}</DialogTitle>
          <DialogDescription>
            Fill in the details for your campaign below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div>
            <Label htmlFor="name">Campaign Name</Label>
            <Input
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g., Summer 2024 Promotion"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="min_age">Minimum Age</Label>
              <Input
                id="min_age"
                name="min_age"
                type="number"
                value={formData.min_age}
                onChange={handleChange}
                required
              />
            </div>
            <div>
              <Label htmlFor="max_age">Maximum Age</Label>
              <Input
                id="max_age"
                name="max_age"
                type="number"
                value={formData.max_age}
                onChange={handleChange}
                placeholder="e.g., 65"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="commission_amount_driver">Driver Commission (SGD)</Label>
              <Input
                id="commission_amount_driver"
                name="commission_amount_driver"
                type="number"
                step="0.01"
                min="0"
                value={formData.commission_amount_driver}
                onChange={handleChange}
                placeholder="$2"
              />
            </div>
            <div>
              <Label htmlFor="commission_amount_fleet">Fleet Owner Commission (SGD)</Label>
              <Input
                id="commission_amount_fleet"
                name="commission_amount_fleet"
                type="number"
                step="0.01"
                min="0"
                value={formData.commission_amount_fleet}
                onChange={handleChange}
                placeholder="$0.5"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.start_date ? format(formData.start_date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.start_date}
                    onSelect={(date) => handleDateChange("start_date", date)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.end_date ? format(formData.end_date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.end_date}
                    onSelect={(date) => handleDateChange("end_date", date)}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={handleSwitchChange}
            />
            <Label htmlFor="is_active">Campaign is Active</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              {loading ? "Saving..." : "Save Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}