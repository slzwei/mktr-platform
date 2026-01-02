import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { LeadPackage } from "@/api/entities";

const AssignPackageDialog = ({ open, onOpenChange, agent, onSubmitSuccess }) => {
    const [loading, setLoading] = useState(false);
    const [packages, setPackages] = useState([]);
    const [selectedPackageId, setSelectedPackageId] = useState("");
    const [error, setError] = useState("");

    const selectedPackage = packages.find(p => p.id === selectedPackageId);

    useEffect(() => {
        if (open) {
            loadPackages();
            setSelectedPackageId("");
            setError("");
        }
    }, [open]);

    const loadPackages = async () => {
        try {
            // Fetch only active packages
            const response = await LeadPackage.list({ status: 'active' });
            const list = response.packages || (Array.isArray(response) ? response : []);
            // Client-side filter as backup if API doesn't filter perfectly yet
            setPackages(list.filter(p => p.status === 'active'));
        } catch (err) {
            console.error("Failed to load packages", err);
            setError("Failed to load available packages");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!agent || !selectedPackageId) return;

        setLoading(true);
        setError("");

        try {
            await LeadPackage.assign(agent.id, selectedPackageId);
            onOpenChange(false);
            if (onSubmitSuccess) onSubmitSuccess();
        } catch (err) {
            console.error("Assignment error:", err);
            // Extract error message if available
            const msg = err.response?.data?.message || err.message || "Failed to assign package";
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Assign Package to {agent?.full_name}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>Select Package</Label>
                        <Select
                            value={selectedPackageId}
                            onValueChange={setSelectedPackageId}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Choose a lead package..." />
                            </SelectTrigger>
                            <SelectContent>
                                {packages.map((pkg) => (
                                    <SelectItem key={pkg.id} value={pkg.id}>
                                        {pkg.name} ({pkg.leadCount} leads - ${pkg.price})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {selectedPackage && (
                        <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm border border-gray-100">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Campaign:</span>
                                <span className="font-medium">{selectedPackage.campaign?.name || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Leads:</span>
                                <span className="font-medium">{selectedPackage.leadCount}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Price:</span>
                                <span className="font-medium text-green-600">${selectedPackage.price}</span>
                            </div>
                            <div className="pt-2 text-xs text-gray-400">
                                Assigning this package will invoice the agent and add leads to their balance.
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading || !selectedPackageId} className="bg-blue-600 hover:bg-blue-700">
                            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Confirm Assignment
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default AssignPackageDialog;
