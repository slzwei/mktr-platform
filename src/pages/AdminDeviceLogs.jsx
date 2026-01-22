import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient as api } from '../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
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
    ChevronLeft,
    RefreshCcw,
    Battery,
    HardDrive,
    Activity,
    Eye,
    PlayCircle
} from 'lucide-react';
import { format } from 'date-fns';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";

export default function AdminDeviceLogs() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [logs, setLogs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchLogs(1);
    }, [id]);

    const fetchLogs = async (page) => {
        try {
            setLoading(true);
            const res = await api.get(`/devices/${id}/logs?page=${page}&limit=50`);
            setLogs(res.data);
            if (res.pagination) {
                setPagination(res.pagination);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
            <div className="max-w-[1200px] mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/AdminDevices')}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            Device Logs
                            <span className="text-sm font-mono font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                {id}
                            </span>
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Full history of heartbeats and beacon events.
                        </p>
                    </div>
                    <div className="ml-auto">
                        <Button variant="outline" size="sm" onClick={() => fetchLogs(pagination.page)}>
                            <RefreshCcw className="h-4 w-4 mr-2" />
                            Refresh
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Showing page {pagination.page} of {pagination.pages} ({pagination.total} events)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-hidden rounded-md border border-gray-100">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50/50">
                                        <TableHead className="w-[180px]">Timestamp</TableHead>
                                        <TableHead className="w-[120px]">Type</TableHead>
                                        <TableHead>Payload Details</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="h-24 text-center">Loading logs...</TableCell>
                                        </TableRow>
                                    ) : logs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="h-24 text-center">No logs found.</TableCell>
                                        </TableRow>
                                    ) : (
                                        logs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground">
                                                    {format(new Date(log.createdAt), 'MMM d, yyyy HH:mm:ss')}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="text-[10px] font-mono">
                                                        {log.type}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {log.type === 'HEARTBEAT' ? (
                                                        <div className="flex gap-4 text-xs font-mono text-muted-foreground">
                                                            {log.payload?.source === 'manifest_fetch' ? (
                                                                <span className="flex items-center gap-1.5 text-blue-600">
                                                                    <RefreshCcw className="h-3 w-3" /> Manifest Refresh (Manual)
                                                                </span>
                                                            ) : (
                                                                <>
                                                                    <span className="flex items-center gap-1.5">
                                                                        <Activity className="h-3 w-3 text-blue-500" />
                                                                        Status: <span className="text-foreground">{log.payload?.status}</span>
                                                                    </span>
                                                                    <span className="flex items-center gap-1.5">
                                                                        <Battery className="h-3 w-3 text-green-500" />
                                                                        {typeof log.payload?.batteryLevel === 'number'
                                                                            ? `${(log.payload.batteryLevel * 100).toFixed(0)}%`
                                                                            : '--%'}
                                                                    </span>
                                                                    <span className="flex items-center gap-1.5">
                                                                        <HardDrive className="h-3 w-3 text-orange-500" />
                                                                        {log.payload?.storageUsed || '--'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    ) : log.type === 'IMPRESSIONS' ? (
                                                        <span className="flex items-center gap-1.5 text-purple-600 text-xs font-mono">
                                                            <Eye className="h-3 w-3" /> Uploaded {log.payload?.count} Impressions
                                                        </span>
                                                    ) : log.type === 'PLAYBACK' ? (
                                                        <span className="flex items-center gap-1.5 text-teal-600 font-medium text-xs font-mono">
                                                            <PlayCircle className="h-3 w-3" />
                                                            Played {log.payload?.assetId}
                                                            <span className="text-muted-foreground ml-2">
                                                                ({log.payload?.campaignName})
                                                            </span>
                                                            <span className="text-xs text-gray-400 ml-auto">
                                                                {log.payload?.durationMs ? `${(log.payload.durationMs / 1000).toFixed(1)}s` : ''}
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap max-w-[600px] overflow-hidden">
                                                            {JSON.stringify(log.payload)}
                                                        </pre>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        <div className="mt-4 flex justify-center">
                            <Pagination>
                                <PaginationContent>
                                    {pagination.page > 1 && (
                                        <PaginationItem>
                                            <PaginationPrevious
                                                onClick={() => fetchLogs(pagination.page - 1)}
                                                className="cursor-pointer"
                                            />
                                        </PaginationItem>
                                    )}

                                    <PaginationItem>
                                        <PaginationLink isActive>{pagination.page}</PaginationLink>
                                    </PaginationItem>

                                    {pagination.page < pagination.pages && (
                                        <PaginationItem>
                                            <PaginationNext
                                                onClick={() => fetchLogs(pagination.page + 1)}
                                                className="cursor-pointer"
                                            />
                                        </PaginationItem>
                                    )}
                                </PaginationContent>
                            </Pagination>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
