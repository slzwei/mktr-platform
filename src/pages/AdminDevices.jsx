import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { apiClient as api } from '../api/client';
import { formatDistanceToNow, format } from 'date-fns';
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
import {
    Activity,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Battery,
    HardDrive
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AdminDevices() {
    const navigate = useNavigate();
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null);

    // Logs Preview State
    const [expandedDeviceId, setExpandedDeviceId] = useState(null);
    const [previewLogs, setPreviewLogs] = useState([]);
    const [previewLoading, setPreviewLoading] = useState(false);

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

    const toggleExpandLogs = async (deviceId) => {
        if (expandedDeviceId === deviceId) {
            setExpandedDeviceId(null);
            setPreviewLogs([]);
            return;
        }

        setExpandedDeviceId(deviceId);
        setPreviewLoading(true);
        try {
            // Fetch only last 5 logs for preview
            const res = await api.get(`/devices/${deviceId}/logs?limit=5`);
            setPreviewLogs(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setPreviewLoading(false);
        }
    };

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
                                            <TableHead className="w-[50px]"></TableHead> {/* Expand Trigger */}
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Device Details</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Status</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Assigned Campaign</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500">Last Seen</TableHead>
                                            <TableHead className="py-3 px-6 font-medium text-gray-500 text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {devices.map(device => (
                                            <React.Fragment key={device.id}>
                                                {/* Main Row */}
                                                <TableRow className={`hover:bg-gray-50/50 transition-colors border-gray-100 ${expandedDeviceId === device.id ? 'bg-muted/30' : ''}`}>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() => toggleExpandLogs(device.id)}
                                                        >
                                                            {expandedDeviceId === device.id ? (
                                                                <ChevronUp className="h-4 w-4" />
                                                            ) : (
                                                                <ChevronDown className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-medium">
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-base font-semibold text-gray-900">{device.model || 'Generic Device'}</span>
                                                            <div
                                                                className="flex items-center gap-1.5 text-xs text-blue-600/80 font-mono cursor-pointer hover:underline w-fit"
                                                                onClick={() => navigator.clipboard.writeText(device.id)}
                                                                title="Click to copy ID"
                                                            >
                                                                ID: {device.id.substring(0, 8)}...
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

                                                {/* Expanded Row (Logs Preview) */}
                                                {expandedDeviceId === device.id && (
                                                    <TableRow className="bg-muted/10">
                                                        <TableCell colSpan={6} className="p-0">
                                                            <div className="p-4 border-b border-gray-100 bg-slate-50/50">
                                                                <div className="flex justify-between items-center mb-3 px-2">
                                                                    <h4 className="text-sm font-semibold flex items-center gap-2">
                                                                        <Activity className="h-4 w-4 text-primary" />
                                                                        Recent Logs (Last 5)
                                                                    </h4>
                                                                    <Button
                                                                        variant="link"
                                                                        size="sm"
                                                                        className="h-auto p-0 text-blue-600"
                                                                        onClick={() => navigate(`/admin/devices/${device.id}/logs`)}
                                                                    >
                                                                        See Full History <ExternalLink className="ml-1 h-3 w-3" />
                                                                    </Button>
                                                                </div>

                                                                {previewLoading ? (
                                                                    <div className="text-xs text-muted-foreground p-4">Loading logs...</div>
                                                                ) : previewLogs.length === 0 ? (
                                                                    <div className="text-xs text-muted-foreground p-4">No logs found.</div>
                                                                ) : (
                                                                    <div className="space-y-2">
                                                                        {previewLogs.map((log) => (
                                                                            <div key={log.id} className="grid grid-cols-[140px_100px_1fr] gap-4 text-xs p-2 rounded bg-white border border-gray-100 items-center">
                                                                                <span className="text-muted-foreground">
                                                                                    {format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}
                                                                                </span>
                                                                                <Badge variant="outline" className="w-fit text-[10px] h-5">
                                                                                    {log.type}
                                                                                </Badge>
                                                                                <div className="truncate text-muted-foreground font-mono">
                                                                                    {log.type === 'HEARTBEAT' ? (
                                                                                        <span className="flex gap-3">
                                                                                            <span className="flex items-center gap-1"><Battery className="h-3 w-3" /> {(log.payload?.batteryLevel * 100).toFixed(0)}%</span>
                                                                                            <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {log.payload?.storageUsed}</span>
                                                                                        </span>
                                                                                    ) : (
                                                                                        JSON.stringify(log.payload)
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </React.Fragment>
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
