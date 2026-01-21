import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { apiClient as api } from '../api/client';
import { formatDistanceToNow } from 'date-fns';
import { AssignCampaignDialog } from '../components/devices/AssignCampaignDialog';
import { Badge } from '../components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "../components/ui/table";
import { DeviceLogsSheet } from '../components/devices/DeviceLogsSheet';
import { Activity } from 'lucide-react';

export default function AdminDevices() {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null);

    // Logs State
    const [viewLogsDevice, setViewLogsDevice] = useState(null);
    const [logs, setLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(false);

    useEffect(() => {
        loadDevices();
    }, []);

    const loadDevices = async () => {
        try {
            setLoading(true);
            const res = await api.get('/devices');
            setDevices(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchLogs = async (deviceId) => {
        try {
            setLogsLoading(true);
            const res = await api.get(`/devices/${deviceId}/logs`);
            setLogs(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLogsLoading(false);
        }
    };

    const handleViewLogs = (device) => {
        setViewLogsDevice(device);
        fetchLogs(device.id);
    };

    const getStatusColor = (status, lastSeen) => {
        if (status !== 'active') return 'destructive'; // Offline/Disabled

        // Check if seen recently (e.g., 5 mins)
        if (!lastSeen) return 'destructive';

        const lastSeenDate = new Date(lastSeen);
        const diff = Date.now() - lastSeenDate.getTime();
        // 5 minutes threshold
        if (diff > 5 * 60 * 1000) return 'warning';

        return 'success'; // "default" variant in Badge usually maps to primary, but we'll use specific colors if needed
        // Since shadcn badge variants are: default, secondary, destructive, outline.
        // We might need to map 'success' to 'default' or a custom style. 
        // For now, let's stick to standard variants:
        // 'active' + recent -> 'default' (black/primary)
        // 'active' + stale -> 'secondary' (gray/yellowish)
        // 'inactive' -> 'destructive'
    };

    // Helper for Badge Variant
    const getBadgeVariant = (status, lastSeen) => {
        if (status !== 'active') return 'destructive';
        if (!lastSeen) return 'destructive';

        const lastSeenDate = new Date(lastSeen);
        const diff = Date.now() - lastSeenDate.getTime();
        if (diff > 5 * 60 * 1000) return 'secondary'; // Warning/Stale

        return 'default'; // Healthy
    };

    return (
        <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
            <div className="max-w-[1600px] mx-auto space-y-6">
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Device Management</h1>
                    <Button variant="outline" onClick={loadDevices}>Refresh</Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Fleet Overview ({devices.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="text-center py-4">Loading fleet status...</div>
                        ) : devices.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                No devices registered yet. Turn on a tablet to auto-enroll.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gray-50/50 hover:bg-gray-50/50 border-gray-100">
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Device Details</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Status</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Assigned Campaign</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Last Seen</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500 text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {devices.map(device => (
                                            <TableRow key={device.id} className="hover:bg-gray-50/50 transition-colors border-gray-100">
                                                <TableCell className="px-6 py-4 font-medium">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-base font-semibold text-gray-900">{device.model || 'Generic Device'}</span>

                                                        {/* External ID (e.g. Asset Tag) */}
                                                        {device.externalId && (
                                                            <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded w-fit">
                                                                <span className="font-semibold text-gray-400">TAG:</span>
                                                                {device.externalId}
                                                            </div>
                                                        )}

                                                        {/* Internal UUID */}
                                                        <div
                                                            className="flex items-center gap-1.5 text-xs text-blue-600/80 font-mono cursor-pointer hover:text-blue-700 hover:underline w-fit"
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(device.id);
                                                            }}
                                                            title="Click to copy full UUID"
                                                        >
                                                            <span className="font-semibold text-gray-400 select-none">ID:</span>
                                                            {device.id.substring(0, 8)}...
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-6 py-4">
                                                    <Badge variant={getBadgeVariant(device.status, device.lastSeenAt)}>
                                                        {device.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-6 py-4">
                                                    {device.campaign ? (
                                                        <span className="font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded text-sm">
                                                            {device.campaign.name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 italic text-sm">Unassigned</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="px-6 py-4 text-sm text-gray-500">
                                                    {device.lastSeenAt ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true }) : 'Never'}
                                                </TableCell>
                                                <TableCell className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 gap-2"
                                                            onClick={() => handleViewLogs(device)}
                                                        >
                                                            <Activity className="h-4 w-4" />
                                                            <span className="sr-only sm:not-sr-only">Logs</span>
                                                        </Button>

                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => setSelectedDevice(device)}
                                                            className="h-8"
                                                        >
                                                            Assign Campaign
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {selectedDevice && (
                    <AssignCampaignDialog
                        open={!!selectedDevice}
                        device={selectedDevice}
                        onClose={() => setSelectedDevice(null)}
                        onAssign={loadDevices}
                    />
                )}

                {/* Logs Sheet */}
                {viewLogsDevice && (
                    <DeviceLogsSheet
                        open={!!viewLogsDevice}
                        device={viewLogsDevice}
                        logs={logs}
                        loading={logsLoading}
                        onClose={() => {
                            setViewLogsDevice(null);
                            setLogs([]);
                        }}
                    />
                )}
            </div>
        </div>
    );
}
