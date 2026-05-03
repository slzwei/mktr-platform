import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient as api } from '../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { ChevronLeft, RefreshCcw, Battery, HardDrive, Activity, Eye, PlayCircle } from 'lucide-react';
import { format } from 'date-fns';
import {
 Pagination,
 PaginationContent,
 PaginationItem,
 PaginationLink,
 PaginationNext,
 PaginationPrevious,
} from '@/components/ui/pagination';

export default function AdminDeviceLogs() {
 const { id } = useParams();
 const navigate = useNavigate();
 const [logs, setLogs] = useState([]);
 const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
 const [loading, setLoading] = useState(true);

 const [streamStatus, setStreamStatus] = useState('disconnected');
 const [deviceStatus, setDeviceStatus] = useState('unknown'); // active vs inactive

 useEffect(() => {
 fetchLogs(1);
 }, [id]);

 useEffect(() => {
 // SSE auth via httpOnly cookie (withCredentials sends cookies cross-origin)
 setStreamStatus('connecting');
 const url = `${api.baseURL}/devices/events/${id}/logs/stream`;
 const eventSource = new EventSource(url, { withCredentials: true });

 eventSource.onopen = () => {
 setStreamStatus('connected');
 };

 eventSource.addEventListener('status_change', (e) => {
 try {
 const data = JSON.parse(e.data);
 setDeviceStatus(data.status);
 } catch (err) {
 console.error(err);
 }
 });

 eventSource.addEventListener('log', (e) => {
 try {
 const newLog = JSON.parse(e.data);
 // Prepend new log and keep limit (e.g. 50 + buffer)
 setLogs((prev) => {
 const updated = [newLog, ...prev];
 return updated.slice(0, 100); // Keep memory sane
 });
 } catch (err) {
 console.error('[Logs] Parse error', err);
 }
 });

 eventSource.addEventListener('connected', (e) => {
 setStreamStatus('connected');
 });

 eventSource.onerror = (err) => {
 // console.warn('[Logs] Stream disconnected', err);
 setStreamStatus('error');
 eventSource.close();

 // Auto-reconnect happens natively for network errors,
 // but for explicit close/auth fail, we might need manual retry logic
 // simple exponential backoff?
 // For now, let's just let user refresh if it dies hard.
 // Native EventSource retries automatically.
 };

 return () => {
 eventSource.close();
 setStreamStatus('disconnected');
 };
 }, [id]);

 const fetchLogs = async (page) => {
 try {
 setLoading(true);
 const res = await api.get(`/devices/${id}/logs?page=${page}&limit=50`);
 setLogs(res.data);
 if (res.pagination) {
 setPagination(res.pagination);
 }
 // Also try to get current status
 const devRes = await api.get(`/devices/${id}`);
 if (devRes.data?.status) setDeviceStatus(devRes.data.status);
 } catch (err) {
 console.error(err);
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1200px] mx-auto space-y-6">
 {/* Header */}
 <div className="flex items-center gap-4">
 <Button variant="ghost" size="icon" aria-label="Back to devices" onClick={() => navigate('/AdminDevices')}>
 <ChevronLeft className="h-5 w-5" aria-hidden="true" />
 </Button>
 <div>
 <h1 className="text-2xl font-bold flex items-center gap-2">
 Device Logs
 <span className="text-sm font-mono font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded">
 {id}
 </span>
 {streamStatus === 'connected' &&
 (deviceStatus === 'inactive' || deviceStatus === 'offline' ? (
 <Badge
 variant="outline" className="ml-2 bg-muted text-muted-foreground border-border" >
 <span className="w-2 h-2 rounded-full bg-muted-foreground mr-2"></span>
 OFFLINE
 </Badge>
 ) : deviceStatus === 'standby' || deviceStatus === 'idle' ? (
 <Badge
 variant="outline" className="ml-2 bg-primary/10 text-primary border-info/30 animate-pulse" >
 <span className="w-2 h-2 rounded-full bg-primary mr-2"></span>
 READY
 </Badge>
 ) : deviceStatus === 'active' || deviceStatus === 'playing' ? (
 <Badge
 variant="outline" className="ml-2 bg-success/10 text-success border-success/30 animate-pulse" >
 <span className="w-2 h-2 rounded-full bg-success mr-2"></span>
 LIVE
 </Badge>
 ) : null)}
 {streamStatus === 'connecting' && (
 <Badge
 variant="outline" className="ml-2 bg-warning/10 text-warning border-warning/30" >
 <span className="w-2 h-2 rounded-full bg-warning mr-2 animate-bounce"></span>
 Connecting...
 </Badge>
 )}
 {streamStatus === 'error' && (
 <Badge
 variant="outline" className="ml-2 bg-destructive/10 text-destructive border-destructive/30" >
 <span className="w-2 h-2 rounded-full bg-destructive mr-2"></span>
 Stream Error
 </Badge>
 )}
 </h1>
 <p className="text-sm text-muted-foreground">Full history of heartbeats and beacon events.</p>
 </div>
 <div className="ml-auto">
 <Button variant="outline" size="sm" onClick={() => fetchLogs(pagination.page)}>
 <RefreshCcw className="h-4 w-4 mr-2"/>
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
 <div className="overflow-hidden rounded-md border border-border">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/50">
 <TableHead className="w-[180px]">Timestamp</TableHead>
 <TableHead className="w-[120px]">Type</TableHead>
 <TableHead>Payload Details</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {loading ? (
 <TableRow>
 <TableCell colSpan={3} className="h-24 text-center">
 Loading logs...
 </TableCell>
 </TableRow>
 ) : logs.length === 0 ? (
 <TableRow>
 <TableCell colSpan={3} className="h-24 text-center">
 No logs found.
 </TableCell>
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
 <span className="flex items-center gap-1.5 text-primary">
 <RefreshCcw className="h-3 w-3"/> Manifest Refresh (Manual)
 </span>
 ) : (
 <>
 <span className="flex items-center gap-1.5">
 <Activity className="h-3 w-3 text-primary"/>
 Status:{' '}
 <span className="text-foreground">{log.payload?.status?.toUpperCase()}</span>
 </span>
 <span className="flex items-center gap-1.5">
 <Battery className="h-3 w-3 text-success"/>
 {typeof log.payload?.batteryLevel === 'number'
 ? `${(log.payload.batteryLevel * 100).toFixed(0)}%`
 : '--%'}
 </span>
 <span className="flex items-center gap-1.5">
 <HardDrive className="h-3 w-3 text-warning"/>
 {log.payload?.storageUsed || '--'}
 </span>
 </>
 )}
 </div>
 ) : log.type === 'IMPRESSIONS' ? (
 <span className="flex items-center gap-1.5 text-plum text-xs font-mono">
 <Eye className="h-3 w-3"/> Uploaded {log.payload?.count} Impressions
 </span>
 ) : log.type === 'PLAYBACK' ? (
 <span className="flex items-center gap-1.5 text-success font-medium text-xs font-mono">
 <PlayCircle className="h-3 w-3"/>
 Played {log.payload?.assetId}
 <span className="text-muted-foreground ml-2">({log.payload?.campaignName})</span>
 <span className="text-xs text-muted-foreground ml-auto">
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
 <PaginationPrevious onClick={() => fetchLogs(pagination.page - 1)} className="cursor-pointer"/>
 </PaginationItem>
 )}

 <PaginationItem>
 <PaginationLink isActive>{pagination.page}</PaginationLink>
 </PaginationItem>

 {pagination.page < pagination.pages && (
 <PaginationItem>
 <PaginationNext onClick={() => fetchLogs(pagination.page + 1)} className="cursor-pointer"/>
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
