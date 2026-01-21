import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { apiClient as api } from '../../api/client';
import { useToast } from '../ui/use-toast';

export const AssignCampaignDialog = ({ device, open, onClose, onAssign }) => {
    const { toast } = useToast();
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedId, setSelectedId] = useState(device?.campaignId || '');

    // Reset selection when device changes
    useEffect(() => {
        setSelectedId(device?.campaignId || '');
    }, [device]);

    useEffect(() => {
        if (open) {
            loadCampaigns();
        }
    }, [open]);

    const loadCampaigns = async () => {
        try {
            setLoading(true);
            const res = await api.get('/campaigns'); // Re-using existing campaigns endpoint
            const campaignsList = res.data?.campaigns || [];
            setCampaigns(campaignsList.filter(c => c.status === 'active')); // Only active campaigns
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to load campaigns",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            await api.patch(`/devices/${device.id}`, {
                campaignId: selectedId || null // Send null to unassign
            });
            toast({
                title: "Success",
                description: "Device assignment updated",
            });
            onAssign(); // Refresh parent
            onClose();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to assign campaign",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign Campaign to {device?.model}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Select Campaign</label>
                        <select
                            className="w-full border rounded p-2"
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                            disabled={loading}
                        >
                            <option value="">-- No Campaign (Unassigned) --</option>
                            {campaigns.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name} (Active)
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            Only active campaigns are shown.
                        </p>
                    </div>

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Saving...' : 'Save Assignment'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};
