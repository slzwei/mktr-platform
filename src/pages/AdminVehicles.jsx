import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { apiClient as api } from '../api/client';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '../components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "../components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import {
    Car,
    Plus,
    Link2,
    Unlink,
    Settings,
    Trash2,
    MapPin,
    RefreshCcw,
    MonitorSmartphone
} from 'lucide-react';
import { toast } from 'sonner';

export default function AdminVehicles() {
    const [vehicles, setVehicles] = useState([]);
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [campaigns, setCampaigns] = useState([]);

    // Dialogs
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [showPairDialog, setShowPairDialog] = useState(false);
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [selectedVehicle, setSelectedVehicle] = useState(null);

    // Form state
    const [newCarplate, setNewCarplate] = useState('');
    const [pairMasterId, setPairMasterId] = useState('');
    const [pairSlaveId, setPairSlaveId] = useState('');
    const [selectedCampaignIds, setSelectedCampaignIds] = useState([]);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [vehiclesRes, devicesRes, campaignsRes] = await Promise.all([
                api.get('/vehicles'),
                api.get('/devices'),
                api.get('/campaigns?limit=100')
            ]);
            setVehicles(vehiclesRes.data?.data || vehiclesRes.data || []);

            // Filter unpaired devices
            let devicesList = [];
            if (Array.isArray(devicesRes.data)) {
                devicesList = devicesRes.data;
            } else if (devicesRes.data?.data) {
                devicesList = devicesRes.data.data;
            }
            setDevices(devicesList);

            // Get PHV campaigns
            let campaignsList = [];
            if (campaignsRes.data?.campaigns && Array.isArray(campaignsRes.data.campaigns)) {
                campaignsList = campaignsRes.data.campaigns;
            } else if (Array.isArray(campaignsRes.data)) {
                campaignsList = campaignsRes.data;
            }

            setCampaigns(campaignsList.filter(c => ['brand_awareness', 'lead_generation', 'video_ad'].includes(c.type) || !c.type));
        } catch (err) {
            console.error('Failed to load data:', err);
            toast.error('Failed to load vehicles');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateVehicle = async () => {
        if (!newCarplate.trim()) {
            toast.error('Carplate is required');
            return;
        }

        try {
            await api.post('/vehicles', { carplate: newCarplate.trim() });
            toast.success('Vehicle created');
            setShowCreateDialog(false);
            setNewCarplate('');
            loadData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to create vehicle');
        }
    };

    const handlePairDevices = async () => {
        if (!selectedVehicle) return;

        try {
            await api.put(`/vehicles/${selectedVehicle.id}/pair`, {
                masterDeviceId: pairMasterId || undefined,
                slaveDeviceId: pairSlaveId || undefined
            });
            toast.success('Devices paired');
            setShowPairDialog(false);
            setPairMasterId('');
            setPairSlaveId('');
            loadData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to pair devices');
        }
    };

    const handleUnpair = async (vehicleId) => {
        try {
            await api.delete(`/vehicles/${vehicleId}/pair`);
            toast.success('Devices unpaired');
            loadData();
        } catch (err) {
            toast.error('Failed to unpair devices');
        }
    };

    const handleAssignCampaigns = async () => {
        if (!selectedVehicle) return;

        try {
            await api.patch(`/vehicles/${selectedVehicle.id}`, {
                campaignIds: selectedCampaignIds
            });
            toast.success('Campaigns assigned');
            setShowAssignDialog(false);
            setSelectedCampaignIds([]);
            loadData();
        } catch (err) {
            toast.error('Failed to assign campaigns');
        }
    };

    const handleDeleteVehicle = async (vehicleId) => {
        if (!confirm('Delete this vehicle? Devices will be unpaired.')) return;

        try {
            await api.delete(`/vehicles/${vehicleId}`);
            toast.success('Vehicle deleted');
            loadData();
        } catch (err) {
            toast.error('Failed to delete vehicle');
        }
    };

    const getDeviceStatus = (device) => {
        if (!device) return { label: 'Empty', color: 'gray' };
        const isStale = !device.lastSeenAt || (Date.now() - new Date(device.lastSeenAt).getTime() > 5 * 60 * 1000);
        if (device.status === 'inactive' || device.status === 'offline' || isStale) {
            return { label: 'OFFLINE', color: 'gray' };
        }
        if (device.status === 'playing' || device.status === 'active') {
            return { label: 'LIVE', color: 'green' };
        }
        return { label: 'READY', color: 'blue' };
    };

    const unpairedDevices = devices.filter(d => !d.vehicleId);

    return (
        <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
            <div className="max-w-[1600px] mx-auto space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold">Vehicle Fleet</h1>
                        <p className="text-muted-foreground">Manage paired tablets by vehicle</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={loadData}>
                            <RefreshCcw className="h-4 w-4 mr-2" />
                            Refresh
                        </Button>
                        <Button onClick={() => setShowCreateDialog(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Vehicle
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            Loading vehicles...
                        </CardContent>
                    </Card>
                ) : vehicles.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <Car className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                            <h3 className="text-lg font-medium mb-2">No Vehicles Yet</h3>
                            <p className="text-muted-foreground mb-4">
                                Create a vehicle to start pairing tablets
                            </p>
                            <Button onClick={() => setShowCreateDialog(true)}>
                                <Plus className="h-4 w-4 mr-2" />
                                Add First Vehicle
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4">
                        {vehicles.map(vehicle => (
                            <Card key={vehicle.id} className="overflow-hidden">
                                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b py-4">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-100 rounded-lg">
                                                <Car className="h-5 w-5 text-blue-600" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-lg">{vehicle.carplate}</CardTitle>
                                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                                    WiFi: {vehicle.hotspotSsid}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedVehicle(vehicle);
                                                    setSelectedCampaignIds(vehicle.campaignIds || []);
                                                    setShowAssignDialog(true);
                                                }}
                                            >
                                                <Settings className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => handleDeleteVehicle(vehicle.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-4">
                                    <div className="grid md:grid-cols-2 gap-4">
                                        {/* Master Device */}
                                        <div className="border rounded-lg p-4 bg-white">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                        MASTER
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">Left Screen</span>
                                                </div>
                                                {vehicle.masterDevice && (
                                                    <Badge
                                                        variant="outline"
                                                        className={
                                                            getDeviceStatus(vehicle.masterDevice).color === 'green'
                                                                ? 'bg-green-50 text-green-700 border-green-200'
                                                                : getDeviceStatus(vehicle.masterDevice).color === 'blue'
                                                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                                    : 'bg-gray-100 text-gray-500 border-gray-200'
                                                        }
                                                    >
                                                        {getDeviceStatus(vehicle.masterDevice).label}
                                                    </Badge>
                                                )}
                                            </div>
                                            {vehicle.masterDevice ? (
                                                <div className="space-y-1">
                                                    <p className="font-medium">{vehicle.masterDevice.model || 'Tablet'}</p>
                                                    <p className="text-xs text-muted-foreground font-mono">
                                                        {vehicle.masterDevice.id.substring(0, 8)}...
                                                    </p>
                                                    {vehicle.masterDevice.lastSeenAt && (
                                                        <p className="text-xs text-muted-foreground">
                                                            Seen {formatDistanceToNow(new Date(vehicle.masterDevice.lastSeenAt), { addSuffix: true })}
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4 text-muted-foreground">
                                                    <MonitorSmartphone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                                    <p className="text-sm">No device paired</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Slave Device */}
                                        <div className="border rounded-lg p-4 bg-white">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                                        SLAVE
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">Right Screen</span>
                                                </div>
                                                {vehicle.slaveDevice && (
                                                    <Badge
                                                        variant="outline"
                                                        className={
                                                            getDeviceStatus(vehicle.slaveDevice).color === 'green'
                                                                ? 'bg-green-50 text-green-700 border-green-200'
                                                                : getDeviceStatus(vehicle.slaveDevice).color === 'blue'
                                                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                                    : 'bg-gray-100 text-gray-500 border-gray-200'
                                                        }
                                                    >
                                                        {getDeviceStatus(vehicle.slaveDevice).label}
                                                    </Badge>
                                                )}
                                            </div>
                                            {vehicle.slaveDevice ? (
                                                <div className="space-y-1">
                                                    <p className="font-medium">{vehicle.slaveDevice.model || 'Tablet'}</p>
                                                    <p className="text-xs text-muted-foreground font-mono">
                                                        {vehicle.slaveDevice.id.substring(0, 8)}...
                                                    </p>
                                                    {vehicle.slaveDevice.lastSeenAt && (
                                                        <p className="text-xs text-muted-foreground">
                                                            Seen {formatDistanceToNow(new Date(vehicle.slaveDevice.lastSeenAt), { addSuffix: true })}
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4 text-muted-foreground">
                                                    <MonitorSmartphone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                                    <p className="text-sm">No device paired</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Campaign & Actions */}
                                    <div className="mt-4 pt-4 border-t flex justify-between items-center">
                                        <div>
                                            <span className="text-sm text-muted-foreground mr-2">Campaigns:</span>
                                            {vehicle.campaigns && vehicle.campaigns.length > 0 ? (
                                                <div className="inline-flex flex-wrap gap-1">
                                                    {vehicle.campaigns.map(c => (
                                                        <Badge key={c.id} variant="secondary" className="text-xs">
                                                            {c.name}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-sm text-gray-400 italic">None assigned</span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            {(!vehicle.masterDevice || !vehicle.slaveDevice) && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedVehicle(vehicle);
                                                        setPairMasterId(vehicle.masterDeviceId || '');
                                                        setPairSlaveId(vehicle.slaveDeviceId || '');
                                                        setShowPairDialog(true);
                                                    }}
                                                >
                                                    <Link2 className="h-4 w-4 mr-1" />
                                                    Pair Devices
                                                </Button>
                                            )}
                                            {(vehicle.masterDevice || vehicle.slaveDevice) && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-orange-600 hover:text-orange-700"
                                                    onClick={() => handleUnpair(vehicle.id)}
                                                >
                                                    <Unlink className="h-4 w-4 mr-1" />
                                                    Unpair
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* Unpaired Devices Section */}
                {unpairedDevices.length > 0 && (
                    <Card className="border-dashed">
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <MonitorSmartphone className="h-5 w-5 text-muted-foreground" />
                                Unpaired Devices ({unpairedDevices.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                {unpairedDevices.map(device => (
                                    <div key={device.id} className="p-3 border rounded-lg bg-gray-50/50">
                                        <p className="font-medium text-sm">{device.model || 'Tablet'}</p>
                                        <p className="text-xs text-muted-foreground font-mono">
                                            {device.id.substring(0, 8)}...
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className={
                                                getDeviceStatus(device).color === 'green'
                                                    ? 'bg-green-50 text-green-700 border-green-200 mt-2'
                                                    : getDeviceStatus(device).color === 'blue'
                                                        ? 'bg-blue-50 text-blue-700 border-blue-200 mt-2'
                                                        : 'bg-gray-100 text-gray-500 border-gray-200 mt-2'
                                            }
                                        >
                                            {getDeviceStatus(device).label}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Create Vehicle Dialog */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add New Vehicle</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium">Carplate Number</label>
                            <Input
                                placeholder="e.g. SGX1234A"
                                value={newCarplate}
                                onChange={(e) => setNewCarplate(e.target.value.toUpperCase())}
                                className="mt-1"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                WiFi hotspot will be auto-generated as MKTR-{newCarplate || 'CARPLATE'}
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateVehicle}>
                            Create Vehicle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Pair Devices Dialog */}
            <Dialog open={showPairDialog} onOpenChange={setShowPairDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Pair Devices to {selectedVehicle?.carplate}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium">Master Device (Left Screen)</label>
                            <Select value={pairMasterId || '_none'} onValueChange={(val) => setPairMasterId(val === '_none' ? '' : val)}>
                                <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="Select master device" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="_none">None</SelectItem>
                                    {unpairedDevices
                                        .filter(d => d.id !== pairSlaveId)
                                        .map(device => (
                                            <SelectItem key={device.id} value={device.id}>
                                                {device.model || 'Tablet'} ({device.id.substring(0, 8)}...)
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Slave Device (Right Screen)</label>
                            <Select value={pairSlaveId || '_none'} onValueChange={(val) => setPairSlaveId(val === '_none' ? '' : val)}>
                                <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="Select slave device" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="_none">None</SelectItem>
                                    {unpairedDevices
                                        .filter(d => d.id !== pairMasterId)
                                        .map(device => (
                                            <SelectItem key={device.id} value={device.id}>
                                                {device.model || 'Tablet'} ({device.id.substring(0, 8)}...)
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPairDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handlePairDevices} disabled={!pairMasterId && !pairSlaveId}>
                            <Link2 className="h-4 w-4 mr-2" />
                            Pair Devices
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Assign Campaigns Dialog */}
            <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Assign Campaigns to {selectedVehicle?.carplate}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            Select campaigns to play on both screens of this vehicle.
                        </p>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {campaigns.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                    No PHV campaigns available
                                </p>
                            ) : (
                                campaigns.map(campaign => {
                                    // Calculate total media duration
                                    const playlist = campaign.ad_playlist || [];
                                    let totalDuration = 0;
                                    let mediaCount = 0;

                                    playlist.forEach(item => {
                                        mediaCount++;
                                        if (item.type === 'image') {
                                            totalDuration += 10; // Default 10s for images
                                        } else if (item.type === 'video' && item.duration) {
                                            totalDuration += item.duration;
                                        }
                                    });

                                    // Format campaign type for display
                                    const typeLabels = {
                                        'brand_awareness': 'Brand Awareness',
                                        'lead_generation': 'Lead Gen',
                                        'video_ad': 'Video Ad'
                                    };
                                    const typeLabel = typeLabels[campaign.type] || campaign.type;

                                    return (
                                        <label
                                            key={campaign.id}
                                            className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedCampaignIds.includes(campaign.id)
                                                ? 'bg-blue-50 border-blue-300'
                                                : 'hover:bg-gray-50 border-gray-200'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedCampaignIds.includes(campaign.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedCampaignIds([...selectedCampaignIds, campaign.id]);
                                                    } else {
                                                        setSelectedCampaignIds(selectedCampaignIds.filter(id => id !== campaign.id));
                                                    }
                                                }}
                                                className="h-4 w-4 rounded border-gray-300 mt-0.5"
                                            />
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="font-medium text-sm">{campaign.name}</p>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                                                    >
                                                        {typeLabel}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <MonitorSmartphone className="h-3 w-3" />
                                                        {mediaCount} media
                                                    </span>
                                                    {totalDuration > 0 && (
                                                        <span className="flex items-center gap-1">
                                                            ⏱️ {totalDuration}s loop
                                                        </span>
                                                    )}
                                                    <span className={`${campaign.status === 'active' ? 'text-green-600' : 'text-gray-500'}`}>
                                                        {campaign.status}
                                                    </span>
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleAssignCampaigns}>
                            Save Assignments
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
