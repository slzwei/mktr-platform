import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { apiClient as api } from '../../api/client';
import { useToast } from '../ui/use-toast';

export const AssignCampaignDialog = ({ device, open, onClose, onAssign }) => {
    const { toast } = useToast();
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);

    // Reset selection when device changes
    useEffect(() => {
        if (device && Array.isArray(device.campaigns)) {
            setSelectedIds(device.campaigns.map(c => c.id));
        } else if (device?.campaignId) {
            // Fallback for legacy data not yet refreshed
            setSelectedIds([device.campaignId]);
        } else {
            setSelectedIds([]);
        }
    }, [device]);

    useEffect(() => {
        if (open) {
            loadCampaigns();
        }
    }, [open]);

    const loadCampaigns = async () => {
        try {
            setLoading(true);
            const res = await api.get('/campaigns?limit=1000'); // Fetch enough to show all

            let campaignsList = [];
            if (res.data && Array.isArray(res.data.campaigns)) {
                campaignsList = res.data.campaigns;
            } else if (res.data && Array.isArray(res.data)) {
                campaignsList = res.data;
            }

            // Filter: Active AND PHV (brand_awareness)
            const available = campaignsList.filter(c =>
                c.status === 'active' &&
                c.type === 'brand_awareness'
            );

            setCampaigns(available);
        } catch (err) {
            console.error('❌ AssignCampaignDialog: Error loading campaigns:', err);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to load campaigns.",
            });
        } finally {
            setLoading(false);
        }
    };

    const toggleCampaign = (campaignId) => {
        setSelectedIds(prev => {
            if (prev.includes(campaignId)) {
                return prev.filter(id => id !== campaignId);
            } else {
                return [...prev, campaignId];
            }
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            // Payload: campaignIds array
            await api.patch(`/devices/${device.id}`, {
                campaignIds: selectedIds
            });
            toast({
                title: "Success",
                description: "Device assignments updated",
            });
            onAssign(); // Refresh parent
            onClose();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: "Error",
                description: err.response?.data?.message || "Failed to update assignments",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Assign Campaigns to {device?.model}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <Label className="text-sm font-medium">Select PHV Campaigns</Label>
                            <span className="text-xs text-muted-foreground">
                                {selectedIds.length} selected
                            </span>
                        </div>

                        <div className="border rounded-md p-1 h-60 overflow-y-auto bg-slate-50/50 space-y-1">
                            {loading ? (
                                <div className="p-4 text-center text-xs text-muted-foreground">Loading...</div>
                            ) : campaigns.length === 0 ? (
                                <div className="p-4 text-center text-xs text-muted-foreground">
                                    No active PHV campaigns found.
                                </div>
                            ) : (
                                campaigns.map(c => (
                                    <div
                                        key={c.id}
                                        className={`flex items-start space-x-3 p-2 rounded hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-gray-100 ${selectedIds.includes(c.id) ? 'bg-white border-blue-100 shadow-sm' : ''}`}
                                    >
                                        <Checkbox
                                            id={`c-${c.id}`}
                                            checked={selectedIds.includes(c.id)}
                                            onCheckedChange={() => toggleCampaign(c.id)}
                                            className="mt-0.5"
                                        />
                                        <div className="grid gap-0.5 leading-none w-full">
                                            <label
                                                htmlFor={`c-${c.id}`}
                                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                            >
                                                {c.name}
                                            </label>
                                            <p className="text-[10px] text-muted-foreground">
                                                Created {new Date(c.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <p className="text-[10px] text-gray-400">
                            Only 'Brand Awareness' (PHV) campaigns are shown. Regular 'Lead Gen' campaigns cannot be assigned to tablets.
                        </p>
                    </div>

                    <div className="flex justify-between gap-2 pt-2 border-t">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedIds([])}
                            disabled={loading || selectedIds.length === 0}
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        >
                            Clear Selection
                        </Button>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading ? 'Saving...' : 'Save Assignments'}
                            </Button>
                        </div>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};
