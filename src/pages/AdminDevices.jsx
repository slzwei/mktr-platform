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
import { Activity } from 'lucide-react'; // Icon for View Logs

// ... (keep existing imports)

export default function AdminDevices() {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null); // For Campaign Assign

    // Logs State
    const [viewLogsDevice, setViewLogsDevice] = useState(null);
    const [logs, setLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(false);

    useEffect(() => {
        loadDevices();
    }, []);

    // ... (loadDevices and getStatusColor logic same)

    const fetchLogs = async (deviceId) => {
        try {
            setLogsLoading(true);
            const res = await api.get(`/devices/${deviceId}/logs`);
            setLogs(res.data);
        } catch (err) {
            console.error(err);
            // Optionally toast error
        } finally {
            setLogsLoading(false);
        }
    };

    const handleViewLogs = (device) => {
        setViewLogsDevice(device);
        fetchLogs(device.id);
    };

    return (
        <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
            <div className="max-w-[1600px] mx-auto space-y-6">
                {/* ... Header ... */}
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Device Management</h1>
                    <Button variant="outline" onClick={loadDevices}>Refresh</Button>
                </div>

                <Card>
                    {/* ... Table ... */}
                    {/* inside TableRow actions */}
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
                    {/* ... */}
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
