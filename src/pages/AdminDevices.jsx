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

export default function AdminDevices() {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null);

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

    const getStatusColor = (status, lastSeen) => {
        if (status !== 'active') return 'destructive'; // Offline/Disabled

        // Check if seen recently (e.g., 5 mins)
        const lastSeenDate = new Date(lastSeen);
        const diff = Date.now() - lastSeenDate.getTime();
        if (diff > 5 * 60 * 1000) return 'warning'; // Warning if missing heartbeat

        return 'success';
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
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Model / ID</TableHead>
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
                                                    <div className="text-base font-semibold text-gray-900">{device.model || 'Unknown Device'}</div>
                                                    <div className="text-xs text-gray-500 font-mono mt-0.5">{device.externalId || device.id.substring(0, 8)}...</div>
                                                </TableCell>
                                                <TableCell className="px-6 py-4">
                                                    <Badge variant={getStatusColor(device.status, device.lastSeenAt)}>
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
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setSelectedDevice(device)}
                                                        className="h-8"
                                                    >
                                                        Assign Campaign
                                                    </Button>
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
            </div>
        </div>
    );
}
