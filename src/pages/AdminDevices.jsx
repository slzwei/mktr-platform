import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { apiClient as api } from '../api/client';
import { formatDistanceToNow } from 'date-fns';
import { AssignCampaignDialog } from '../components/devices/AssignCampaignDialog';
import { Badge } from '../components/ui/badge';

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
        <DashboardLayout>
            <div className="space-y-6">
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
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-4 py-3">Model / ID</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3">Assigned Campaign</th>
                                            <th className="px-4 py-3">Last Seen</th>
                                            <th className="px-4 py-3">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {devices.map(device => (
                                            <tr key={device.id} className="border-b dark:border-gray-700">
                                                <td className="px-4 py-3 font-medium">
                                                    <div className="text-base">{device.model || 'Unknown Device'}</div>
                                                    <div className="text-xs text-gray-500 font-mono">{device.externalId || device.id.substring(0, 8)}...</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant={getStatusColor(device.status, device.lastSeenAt)}>
                                                        {device.status}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {device.campaign ? (
                                                        <span className="font-semibold text-blue-600">
                                                            {device.campaign.name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 italic">Unassigned</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {device.lastSeenAt ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true }) : 'Never'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setSelectedDevice(device)}
                                                    >
                                                        Assign Campaign
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
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
        </DashboardLayout>
    );
}
