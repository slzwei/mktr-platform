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
import { Upload, X, Image as ImageIcon, Video, Trash2, Loader2, Play } from "lucide-react";
import { integrations } from "@/api/client";

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
  const [uploading, setUploading] = useState(false);

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
        ad_playlist: campaign.ad_playlist || [],
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
        ad_playlist: [],
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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const type = file.type.startsWith("video/") ? "video" : "image";
      // Use 'campaign_media' folder type
      const response = await integrations.Core.UploadFile(file, "campaign_media");

      // Response structure from UploadFile is response.data, which is { file: ... }
      const fileData = response.file;

      const newMedia = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        type: type,
        url: fileData.url,
        duration: type === "image" ? 10000 : 0 // Default 10s for image
      };

      // Enforce single media item: replace existing
      setFormData((prev) => ({ ...prev, ad_playlist: [newMedia] }));
    } catch (error) {
      console.error("Upload failed", error);
      alert("Upload failed: " + (error.message || "Unknown error"));
    } finally {
      setUploading(false);
      // Reset input value to allow re-uploading same file if needed
      e.target.value = "";
    }
  };

  const removeMedia = () => {
    setFormData((prev) => ({ ...prev, ad_playlist: [] }));
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
        ad_playlist: formData.ad_playlist,
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

          <div className="space-y-4 border rounded-md p-4 bg-slate-50">
            <div className="flex justify-between items-center">
              <Label className="text-base font-semibold">Ad Media (Tablet Display)</Label>
              <span className="text-xs text-slate-500">Required for PHV assignment</span>
            </div>

            {formData.ad_playlist && formData.ad_playlist.length > 0 ? (
              <div className="relative group rounded-lg overflow-hidden border bg-black/5 aspect-video w-full max-w-sm mx-auto">
                {formData.ad_playlist[0].type === "video" ? (
                  <div className="w-full h-full flex items-center justify-center bg-black">
                    <video src={formData.ad_playlist[0].url} className="w-full h-full object-contain" controls />
                  </div>
                ) : (
                  <img
                    src={formData.ad_playlist[0].url}
                    alt="Ad Asset"
                    className="w-full h-full object-contain"
                  />
                )}

                <div className="absolute top-2 right-2 flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8 shadow-sm"
                    onClick={removeMedia}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded flex items-center">
                  {formData.ad_playlist[0].type === "video" ? <Video className="h-3 w-3 mr-1" /> : <ImageIcon className="h-3 w-3 mr-1" />}
                  {formData.ad_playlist[0].type === "video" ? "Video" : "Image (10s)"}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => document.getElementById('media-upload').click()}>
                <input
                  id="media-upload"
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                {uploading ? (
                  <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-2" />
                ) : (
                  <Upload className="h-8 w-8 text-slate-400 mb-2" />
                )}
                <div className="text-sm font-medium text-slate-900">
                  {uploading ? "Uploading..." : "Click to upload media"}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Supports Images/Videos (Max 10MB)
                </p>
              </div>
            )}
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