import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Campaign } from "@/api/entities";
import { integrations } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { format, parseISO } from "date-fns";
import {
    Calendar as CalendarIcon,
    Save,
    ArrowLeft,
    Upload,
    Trash2,
    Loader2,
    Video,
    Image as ImageIcon
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function AdminCampaignForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const [searchParams] = useSearchParams();
    const typeParam = searchParams.get("type");
    const isEditMode = !!id;

    // Default to type param if creating, else lead_generation. 
    // If editing, this will be overwritten by loadCampaign data.
    const initialType = typeParam || "lead_generation";

    const [formData, setFormData] = useState({
        name: "",
        type: initialType,
        min_age: 18,
        max_age: 65,
        start_date: new Date(),
        end_date: new Date(),
        is_active: true,
        commission_amount_driver: "",
        commission_amount_fleet: "",
        ad_playlist: [],
    });

    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(isEditMode);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (isEditMode) {
            loadCampaign();
        }
    }, [id]);

    const loadCampaign = async () => {
        try {
            const campaign = await Campaign.get(id);
            if (campaign) {
                setFormData({
                    name: campaign.name || "",
                    type: campaign.type || "lead_generation",
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
                toast({ title: "Error", description: "Campaign not found", variant: "destructive" });
                navigate("/AdminCampaigns");
            }
        } catch (error) {
            console.error("Failed to load campaign:", error);
            toast({ title: "Error", description: "Failed to load campaign details", variant: "destructive" });
        } finally {
            setFetching(false);
        }
    };

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
            const response = await integrations.Core.UploadFile(file, "campaign_media");
            const fileData = response.file;

            const newMedia = {
                id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                type: type,
                url: fileData.url,
                duration: type === "image" ? 10000 : 0
            };

            setFormData((prev) => ({ ...prev, ad_playlist: [newMedia] }));
            toast({ title: "Success", description: "Media uploaded successfully" });
        } catch (error) {
            console.error("Upload failed", error);
            toast({ title: "Error", description: "Upload failed: " + (error.message || "Unknown error"), variant: "destructive" });
        } finally {
            setUploading(false);
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
            const formattedData = {
                name: formData.name,
                type: formData.type,
                min_age: formData.min_age,
                max_age: formData.max_age,
                is_active: formData.is_active,
                start_date: formData.start_date.toISOString(),
                end_date: formData.end_date.toISOString(),
                ad_playlist: formData.ad_playlist,
                commission_amount_driver: formData.commission_amount_driver === "" ? null : Number(formData.commission_amount_driver),
                commission_amount_fleet: formData.commission_amount_fleet === "" ? null : Number(formData.commission_amount_fleet),
            };

            if (isEditMode) {
                await Campaign.update(id, formattedData);
                toast({ title: "Success", description: "Campaign updated successfully" });
            } else {
                await Campaign.create(formattedData);
                toast({ title: "Success", description: "Campaign created successfully" });
            }
            navigate("/AdminCampaigns");
        } catch (error) {
            console.error("Failed to save campaign:", error);
            toast({ title: "Error", description: "Failed to save campaign", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (fetching) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    // Helper to determine display text for type
    const isPHV = formData.type === 'brand_awareness';
    const typeLabel = isPHV ? 'PHV' : 'Regular';

    return (
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/AdminCampaigns")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{isEditMode ? "Edit Campaign" : "Create New Campaign"}</h1>
                    <p className="text-muted-foreground">
                        {isEditMode
                            ? "Update campaign details and settings."
                            : `Configure a new ${typeLabel} campaign.`}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Form Area */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Campaign Details</CardTitle>
                                <CardDescription>Basic information about this campaign.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
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

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Start Date</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="w-full justify-start text-left font-normal">
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {formData.start_date ? format(formData.start_date, "PPP") : "Pick a date"}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                    mode="single"
                                                    selected={formData.start_date}
                                                    onSelect={(date) => handleDateChange("start_date", date)}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>End Date</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="w-full justify-start text-left font-normal">
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {formData.end_date ? format(formData.end_date, "PPP") : "Pick a date"}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                    mode="single"
                                                    selected={formData.end_date}
                                                    onSelect={(date) => handleDateChange("end_date", date)}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="min_age">Min Age</Label>
                                        <Input
                                            id="min_age"
                                            name="min_age"
                                            type="number"
                                            value={formData.min_age}
                                            onChange={handleChange}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="max_age">Max Age</Label>
                                        <Input
                                            id="max_age"
                                            name="max_age"
                                            type="number"
                                            value={formData.max_age}
                                            onChange={handleChange}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Commissions</CardTitle>
                                <CardDescription>Set the payout amounts for this campaign.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="commission_amount_driver">Driver Commission (SGD)</Label>
                                        <Input
                                            id="commission_amount_driver"
                                            name="commission_amount_driver"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.commission_amount_driver}
                                            onChange={handleChange}
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="commission_amount_fleet">Fleet Owner Commission (SGD)</Label>
                                        <Input
                                            id="commission_amount_fleet"
                                            name="commission_amount_fleet"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.commission_amount_fleet}
                                            onChange={handleChange}
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar Area */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Status</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="is_active"
                                        checked={formData.is_active}
                                        onCheckedChange={handleSwitchChange}
                                    />
                                    <Label htmlFor="is_active" className="cursor-pointer">
                                        {formData.is_active ? "Active" : "Inactive"}
                                    </Label>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Conditionally render Ad Media for PHV Campaigns */}
                        {isPHV && (
                            <Card className="border-blue-200 bg-blue-50/20">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-blue-700">
                                        <Video className="w-5 h-5" />
                                        Ad Media (Tablet Display)
                                    </CardTitle>
                                    <CardDescription className="text-blue-600/80">
                                        Required for PHV campaigns. Upload a video or image to display on tablets.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {formData.ad_playlist && formData.ad_playlist.length > 0 ? (
                                        <div className="relative group rounded-lg overflow-hidden border bg-black/5 aspect-video w-full">
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

                                            <div className="absolute top-2 right-2">
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
                                        <div className="flex flex-col items-center justify-center border-2 border-dashed border-blue-200 rounded-lg p-6 hover:bg-blue-50 transition-colors cursor-pointer text-center bg-white" onClick={() => document.getElementById('media-upload-page').click()}>
                                            <input
                                                id="media-upload-page"
                                                type="file"
                                                accept="image/*,video/*"
                                                className="hidden"
                                                onChange={handleFileUpload}
                                                disabled={uploading}
                                            />
                                            {uploading ? (
                                                <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-2" />
                                            ) : (
                                                <Upload className="h-8 w-8 text-blue-400 mb-2" />
                                            )}
                                            <div className="text-sm font-medium text-blue-900">
                                                {uploading ? "Uploading..." : "Click to upload"}
                                            </div>
                                            <p className="text-xs text-blue-600 mt-1">
                                                Images/Videos (Max 10MB)
                                            </p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <div className="flex gap-4">
                            <Button type="button" variant="outline" className="w-full" onClick={() => navigate("/AdminCampaigns")}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700">
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Changes
                            </Button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}
