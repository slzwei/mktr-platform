import React, { useState, useEffect, useRef } from 'react';
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import {
    Activity,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Battery,
    HardDrive,
    RefreshCcw,
    Eye,
    PlayCircle,
    MapPin
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

    // Location Map Dialog State
    const [mapDevice, setMapDevice] = useState(null);
    const mapRef = useRef(null);
    const googleMapRef = useRef(null);
    const markerRef = useRef(null);

    useEffect(() => {
        loadDevices();
    }, []);

    // Fleet Status Stream (SSE)
    useEffect(() => {
        const token = localStorage.getItem('mktr_auth_token');
        if (!token) return;

        const url = `${import.meta.env.VITE_API_URL}/devices/events/fleet/stream?token=${token}`;
        const sse = new EventSource(url);

        sse.onopen = () => console.log('✅ Connected to Fleet Stream');

        sse.addEventListener('status_change', (e) => {
            try {
                const data = JSON.parse(e.data);
                // Update local state for immediate feedback
                setDevices(prev => prev.map(d => {
                    if (d.id === data.deviceId) {
                        return { ...d, status: data.status, lastSeenAt: data.lastSeenAt };
                    }
                    return d;
                }));
            } catch (err) {
                console.error('Failed to parse status_change', err);
            }
        });

        // Listen for location updates
        sse.addEventListener('location_update', (e) => {
            try {
                const data = JSON.parse(e.data);
                setDevices(prev => prev.map(d => {
                    if (d.id === data.deviceId) {
                        return { ...d, latitude: data.latitude, longitude: data.longitude, locationUpdatedAt: data.timestamp };
                    }
                    return d;
                }));
            } catch (err) {
                console.error('Failed to parse location_update', err);
            }
        });

        sse.onerror = (err) => {
            // Let EventSource auto-reconnect - don't close the connection!
            console.warn('⚠️ Fleet Stream error - auto-reconnecting...', err);
        };

        return () => sse.close();
    }, []);

    const loadDevices = async () => {
        try {
            setLoading(true);
            const res = await api.get('/devices');

            // Defensive check for devices array
            let devicesList = [];
            if (Array.isArray(res.data)) {
                devicesList = res.data;
            } else if (res.data && Array.isArray(res.data.devices)) {
                devicesList = res.data.devices;
            } else {
                console.warn('⚠️ AdminDevices: Unexpected response, defaulting to empty array', res);
            }

            setDevices(devicesList);

            // Refetch logs if a row is open
            if (expandedDeviceId) {
                const logsRes = await api.get(`/devices/${expandedDeviceId}/logs?limit=5`);
                setPreviewLogs(logsRes.data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // Live Logs Stream (Ephemeral) for Expanded Row
    useEffect(() => {
        if (!expandedDeviceId) return;

        console.log(`[Preview] Connecting to stream for ${expandedDeviceId}`);
        const token = localStorage.getItem('mktr_auth_token');
        const url = `${import.meta.env.VITE_API_URL}/devices/events/${expandedDeviceId}/logs/stream?token=${token}`;
        const sse = new EventSource(url);

        sse.onopen = () => console.log(`[Preview] Connected to ${expandedDeviceId}`);

        sse.addEventListener('log', (e) => {
            try {
                const newLog = JSON.parse(e.data);
                // Prepend and keep top 5
                setPreviewLogs(prev => [newLog, ...prev].slice(0, 5));
            } catch (err) {
                console.error('[Preview] Parse error', err);
            }
        });

        // We don't need status_change here (Fleet Stream handles it), 
        // but no harm if we ignore it. The backend sends it on this channel too.

        sse.onerror = (e) => {
            // console.warn('[Preview] Stream error', e);
            sse.close();
        };

        return () => {
            console.log(`[Preview] Closing stream for ${expandedDeviceId}`);
            sse.close();
        };
    }, [expandedDeviceId]);

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
                                                        {(() => {
                                                            // Logic unified with AdminDeviceLogs.jsx
                                                            const isStale = !device.lastSeenAt || (Date.now() - new Date(device.lastSeenAt).getTime() > 5 * 60 * 1000);
                                                            const status = device.status;
                                                            // Normalize 'offline' from Android app or 'inactive' from backend
                                                            if (status === 'inactive' || status === 'offline' || isStale) {
                                                                return (
                                                                    <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-200">
                                                                        <span className="w-2 h-2 rounded-full bg-gray-400 mr-2"></span>
                                                                        OFFLINE
                                                                    </Badge>
                                                                );
                                                            }
                                                            if (status === 'standby' || status === 'idle') {
                                                                return (
                                                                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                                        <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>
                                                                        READY
                                                                    </Badge>
                                                                );
                                                            }
                                                            if (status === 'playing' || status === 'active') {
                                                                return (
                                                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 animate-pulse">
                                                                        <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                                                                        LIVE
                                                                    </Badge>
                                                                );
                                                            }
                                                            // Fallback
                                                            return <Badge variant="outline">{status?.toUpperCase() || 'UNKNOWN'}</Badge>;
                                                        })()}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4">
                                                        {device.campaigns && device.campaigns.length > 0 ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {device.campaigns.map(c => (
                                                                    <span key={c.id} className="font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded text-sm whitespace-nowrap">
                                                                        {c.name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400 italic text-sm">Unassigned</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-sm text-gray-500">
                                                        <div className="flex items-center gap-2">
                                                            <span>{device.lastSeenAt ? formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true }) : 'Never'}</span>
                                                            {device.latitude && device.longitude && (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700"
                                                                    onClick={() => setMapDevice(device)}
                                                                >
                                                                    <MapPin className="h-3 w-3 mr-1" />
                                                                    Map
                                                                </Button>
                                                            )}
                                                        </div>
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
                                                                                        log.payload?.source === 'manifest_fetch' ? (
                                                                                            <span className="flex items-center gap-1.5 text-blue-600">
                                                                                                <RefreshCcw className="h-3 w-3" /> Manifest Refresh (Manual)
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="flex gap-3">
                                                                                                <span className="flex items-center gap-1">
                                                                                                    <Battery className="h-3 w-3" />
                                                                                                    {typeof log.payload?.batteryLevel === 'number'
                                                                                                        ? `${(log.payload.batteryLevel * 100).toFixed(0)}%`
                                                                                                        : '--%'}
                                                                                                </span>
                                                                                                <span className="flex items-center gap-1">
                                                                                                    <HardDrive className="h-3 w-3" />
                                                                                                    {log.payload?.storageUsed || '--'}
                                                                                                </span>
                                                                                            </span>
                                                                                        )
                                                                                    ) : log.type === 'IMPRESSIONS' ? (
                                                                                        <span className="flex items-center gap-1.5 text-purple-600">
                                                                                            <Eye className="h-3 w-3" /> Uploaded {log.payload?.count} Impressions
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

                {/* Location Map Dialog */}
                <Dialog open={!!mapDevice} onOpenChange={(open) => !open && setMapDevice(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-blue-600" />
                                Device Location - {mapDevice?.model || 'Device'}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground">
                                <p>📍 Coordinates: {mapDevice?.latitude?.toFixed(6)}, {mapDevice?.longitude?.toFixed(6)}</p>
                                <p>🕐 Last updated: {mapDevice?.locationUpdatedAt ? formatDistanceToNow(new Date(mapDevice.locationUpdatedAt), { addSuffix: true }) : 'Unknown'}</p>
                            </div>
                            {mapDevice?.latitude && mapDevice?.longitude && (
                                <div className="h-[400px] rounded-lg overflow-hidden border">
                                    <iframe
                                        width="100%"
                                        height="100%"
                                        style={{ border: 0 }}
                                        loading="lazy"
                                        allowFullScreen
                                        referrerPolicy="no-referrer-when-downgrade"
                                        src={`https://www.google.com/maps/embed/v1/place?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&q=${mapDevice.latitude},${mapDevice.longitude}&zoom=16`}
                                    />
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div >
    );
}
