import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { Campaign } from "@/api/entities";

const LeadPackageTemplateDialog = ({ open, onOpenChange, onSubmit, editingPackage = null }) => {
    const [loading, setLoading] = useState(false);
    const [campaigns, setCampaigns] = useState([]);
    const [error, setError] = useState("");

    const [formData, setFormData] = useState({
        name: "",
        description: "",
        campaignId: "",
        type: "basic",
        leadCount: 100,
        price: 0,
        isPublic: true,
        status: "active"
    });

    useEffect(() => {
        if (open) {
            loadCampaigns();
            if (editingPackage) {
                setFormData({
                    name: editingPackage.name || "",
                    description: editingPackage.description || "",
                    campaignId: editingPackage.campaignId || "",
                    type: editingPackage.type || "basic",
                    leadCount: editingPackage.leadCount || 100,
                    price: editingPackage.price || 0,
                    isPublic: editingPackage.isPublic !== false,
                    status: editingPackage.status || "active"
                });
            } else {
                setFormData({
                    name: "",
                    description: "",
                    campaignId: "",
                    leadCount: 100,
                    price: 0,
                    isPublic: true,
                    status: "active"
                });
            }
        }
    }, [open, editingPackage]);

    const loadCampaigns = async () => {
        try {
            // Logic from fixed LeadPackageDialog: check response format
            const response = await Campaign.list({ status: 'active', limit: 100 });
            const list = response.campaigns || (Array.isArray(response) ? response : []);
            setCampaigns(list);
        } catch (err) {
            console.error("Failed to load campaigns", err);
            setError("Failed to load campaigns");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            if (!formData.name || !formData.campaignId || formData.price < 0 || formData.leadCount <= 0) {
                throw new Error("Please fill in all required fields correctly.");
            }

            await onSubmit(formData);
            onOpenChange(false);
        } catch (err) {
            setError(err.message || "Failed to save package");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{editingPackage ? 'Edit Package Template' : 'Create Package Template'}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="name">Package Name *</Label>
                        <Input
                            id="name"
                            placeholder="e.g., Gold Package (100 Leads)"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="campaign">Campaign *</Label>
                        <Select
                            value={formData.campaignId}
                            onValueChange={(val) => setFormData({ ...formData, campaignId: val })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a campaign" />
                            </SelectTrigger>
                            <SelectContent>
                                {campaigns.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {c.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="type">Package Type</Label>
                        <Select
                            value={formData.type}
                            onValueChange={(val) => setFormData({ ...formData, type: val })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="basic">Basic</SelectItem>
                                <SelectItem value="premium">Premium</SelectItem>
                                <SelectItem value="enterprise">Enterprise</SelectItem>
                                <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="leadCount">Total Leads *</Label>
                            <Input
                                id="leadCount"
                                type="number"
                                min="1"
                                value={formData.leadCount}
                                onChange={(e) => setFormData({ ...formData, leadCount: parseInt(e.target.value) || 0 })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="price">Price (SGD) *</Label>
                            <Input
                                id="price"
                                type="number"
                                min="0"
                                step="0.01"
                                value={formData.price}
                                onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                            id="description"
                            placeholder="Package details..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {editingPackage ? 'Save Changes' : 'Create Template'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default LeadPackageTemplateDialog;
