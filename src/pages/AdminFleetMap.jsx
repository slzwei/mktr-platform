import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiClient as api } from '../api/client';
import { formatDistanceToNow } from 'date-fns';
import { MapPin, RefreshCcw, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Singapore center coordinates
const SINGAPORE_CENTER = { lat: 1.3521, lng: 103.8198 };
const DEFAULT_ZOOM = 12;

// Resolve CSS custom property to a color string (Google Maps needs concrete values, not var() refs).
const readCssVar = (name) => {
 if (typeof window === 'undefined') return '';
 return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
};

// Status to color mapping — reads Tropic tokens so dark mode retints automatically.
const getStatusColor = (status, isStale) => {
 if (status === 'inactive' || status === 'offline' || isStale) {
 return readCssVar('--tropic-text-tertiary') || '#8B857A';
 }
 if (status === 'standby' || status === 'idle') {
 return readCssVar('--tropic-info') || '#5C7A9E';
 }
 if (status === 'playing' || status === 'active') {
 return readCssVar('--tropic-success') || '#7A8C6B';
 }
 return readCssVar('--tropic-text-tertiary') || '#8B857A';
};

const getStatusLabel = (status, isStale) => {
 if (status === 'inactive' || status === 'offline' || isStale) return 'OFFLINE';
 if (status === 'standby' || status === 'idle') return 'READY';
 if (status === 'playing' || status === 'active') return 'LIVE';
 return status?.toUpperCase() || 'UNKNOWN';
};

export default function AdminFleetMap() {
 const navigate = useNavigate();
 const mapRef = useRef(null);
 const googleMapRef = useRef(null);
 const markersRef = useRef({});
 const [devices, setDevices] = useState([]);
 const [loading, setLoading] = useState(true);
 const [mapLoaded, setMapLoaded] = useState(false);
 const [selectedDevice, setSelectedDevice] = useState(null);
 const [sseConnected, setSseConnected] = useState(false);

 // Load devices
 const loadDevices = useCallback(async () => {
 try {
 setLoading(true);
 const res = await api.get('/devices');
 let devicesList = Array.isArray(res.data) ? res.data : res.data?.devices || [];
 setDevices(devicesList);
 } catch (err) {
 console.error('Failed to load devices', err);
 } finally {
 setLoading(false);
 }
 }, []);

 // Initialize Google Maps
 useEffect(() => {
 // Check if Google Maps API is already loaded
 if (window.google && window.google.maps) {
 initializeMap();
 return;
 }

 // Load Google Maps script
 const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
 if (!apiKey) {
 console.error('Google Maps API key not configured. Set VITE_GOOGLE_MAPS_API_KEY');
 return;
 }

 const script = document.createElement('script');
 script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
 script.async = true;
 script.onload = () => initializeMap();
 document.head.appendChild(script);

 return () => {
 // Cleanup markers
 Object.values(markersRef.current).forEach((marker) => marker?.setMap?.(null));
 };
 }, []);

 const initializeMap = () => {
 if (!mapRef.current || googleMapRef.current) return;

 googleMapRef.current = new window.google.maps.Map(mapRef.current, {
 center: SINGAPORE_CENTER,
 zoom: DEFAULT_ZOOM,
 mapTypeControl: false,
 streetViewControl: false,
 fullscreenControl: true,
 styles: [
 { featureType: 'poi', stylers: [{ visibility: 'off' }] },
 { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
 ],
 });

 setMapLoaded(true);
 };

 // Update markers when devices or map changes
 useEffect(() => {
 if (!mapLoaded || !googleMapRef.current) return;

 devices.forEach((device) => {
 if (device.latitude && device.longitude) {
 updateMarker(device);
 }
 });

 // Remove old markers for devices no longer in list
 const deviceIds = new Set(devices.map((d) => d.id));
 Object.keys(markersRef.current).forEach((id) => {
 if (!deviceIds.has(id)) {
 markersRef.current[id]?.setMap?.(null);
 delete markersRef.current[id];
 }
 });
 }, [devices, mapLoaded]);

 const updateMarker = (device) => {
 const isStale = !device.lastSeenAt || Date.now() - new Date(device.lastSeenAt).getTime() > 5 * 60 * 1000;
 const color = getStatusColor(device.status, isStale);
 const position = { lat: device.latitude, lng: device.longitude };

 if (markersRef.current[device.id]) {
 // Update existing marker position
 markersRef.current[device.id].setPosition(position);
 } else {
 // Create new marker
 const marker = new window.google.maps.Marker({
 position,
 map: googleMapRef.current,
 title: device.model || device.id,
 icon: {
 path: window.google.maps.SymbolPath.CIRCLE,
 fillColor: color,
 fillOpacity: 1,
 strokeColor: readCssVar('--tropic-paper-elevated') || '#FFFFFF',
 strokeWeight: 2,
 scale: 10,
 },
 });

 marker.addListener('click', () => {
 setSelectedDevice(device);
 });

 markersRef.current[device.id] = marker;
 }

 // Update marker color
 markersRef.current[device.id]?.setIcon({
 path: window.google.maps.SymbolPath.CIRCLE,
 fillColor: color,
 fillOpacity: 1,
 strokeColor: readCssVar('--tropic-paper-elevated') || '#FFFFFF',
 strokeWeight: 2,
 scale: 10,
 });
 };

 // Load devices on mount
 useEffect(() => {
 loadDevices();
 }, [loadDevices]);

 // SSE for real-time location updates
 useEffect(() => {
 const url = `${import.meta.env.VITE_API_URL}/devices/events/fleet/stream`;
 const sse = new EventSource(url, { withCredentials: true });

 sse.onopen = () => {
 setSseConnected(true);
 };

 // Handle location updates
 sse.addEventListener('location_update', (e) => {
 try {
 const data = JSON.parse(e.data);
 setDevices((prev) =>
 prev.map((d) => {
 if (d.id === data.deviceId) {
 return {
 ...d,
 latitude: data.latitude,
 longitude: data.longitude,
 locationUpdatedAt: data.timestamp,
 };
 }
 return d;
 })
 );
 } catch (err) {
 console.error('Failed to parse location_update', err);
 }
 });

 // Handle status changes
 sse.addEventListener('status_change', (e) => {
 try {
 const data = JSON.parse(e.data);
 setDevices((prev) =>
 prev.map((d) => {
 if (d.id === data.deviceId) {
 return { ...d, status: data.status, lastSeenAt: data.lastSeenAt };
 }
 return d;
 })
 );
 } catch (err) {
 console.error('Failed to parse status_change', err);
 }
 });

 sse.onerror = () => {
 console.warn('⚠️ Fleet Map SSE error');
 setSseConnected(false);
 };

 return () => sse.close();
 }, []);

 // Stats
 const devicesWithLocation = devices.filter((d) => d.latitude && d.longitude);
 const liveDevices = devices.filter(
 (d) =>
 (d.status === 'playing' || d.status === 'active') &&
 d.lastSeenAt &&
 Date.now() - new Date(d.lastSeenAt).getTime() < 5 * 60 * 1000
 );

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1600px] mx-auto space-y-4">
 {/* Header */}
 <div className="flex justify-between items-center">
 <div>
 <h1 className="text-2xl font-bold flex items-center gap-2">
 <MapPin className="h-6 w-6 text-primary"/>
 Fleet Map
 </h1>
 <p className="text-sm text-muted-foreground mt-1">Real-time location of all tablet devices</p>
 </div>
 <div className="flex items-center gap-3">
 <Badge
 variant="outline" className={sseConnected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}
 >
 {sseConnected ? <Wifi className="h-3 w-3 mr-1"/> : <WifiOff className="h-3 w-3 mr-1"/>}
 {sseConnected ? 'Live' : 'Offline'}
 </Badge>
 <Button variant="outline" size="sm" onClick={loadDevices}>
 <RefreshCcw className="h-4 w-4 mr-2"/>
 Refresh
 </Button>
 </div>
 </div>

 {/* Stats Cards */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
 <Card>
 <CardContent className="pt-4">
 <div className="text-2xl font-bold">{devices.length}</div>
 <div className="text-sm text-muted-foreground">Total Devices</div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="pt-4">
 <div className="text-2xl font-bold text-success">{liveDevices.length}</div>
 <div className="text-sm text-muted-foreground">Currently Live</div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="pt-4">
 <div className="text-2xl font-bold text-primary">{devicesWithLocation.length}</div>
 <div className="text-sm text-muted-foreground">With GPS Location</div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="pt-4">
 <div className="text-2xl font-bold text-muted-foreground">{devices.length - devicesWithLocation.length}</div>
 <div className="text-sm text-muted-foreground">No Location Data</div>
 </CardContent>
 </Card>
 </div>

 {/* Map */}
 <Card className="overflow-hidden">
 <CardHeader className="pb-2">
 <CardTitle className="text-lg">Singapore Fleet Overview</CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
 <div className="h-[500px] flex items-center justify-center bg-muted text-muted-foreground">
 <div className="text-center">
 <MapPin className="h-12 w-12 mx-auto mb-3 opacity-50"/>
 <p className="font-medium">Google Maps API Key Required</p>
 <p className="text-sm mt-1">Set VITE_GOOGLE_MAPS_API_KEY in your environment</p>
 </div>
 </div>
 ) : (
 <div ref={mapRef} className="h-[500px] w-full" style={{ minHeight: '500px' }} />
 )}
 </CardContent>
 </Card>

 {/* Selected Device Info */}
 {selectedDevice && (
 <Card>
 <CardContent className="pt-4">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="font-semibold">{selectedDevice.model || 'Unknown Device'}</h2>
 <p className="text-sm text-muted-foreground font-mono">{selectedDevice.id}</p>
 <p className="text-sm mt-2">
 📍 {selectedDevice.latitude?.toFixed(4)}, {selectedDevice.longitude?.toFixed(4)}
 </p>
 <p className="text-sm text-muted-foreground">
 Last seen:{' '}
 {selectedDevice.lastSeenAt
 ? formatDistanceToNow(new Date(selectedDevice.lastSeenAt), { addSuffix: true })
 : 'Never'}
 </p>
 </div>
 <div className="flex gap-2">
 <Badge
 variant="outline" className={
 selectedDevice.status === 'playing'
 ? 'bg-success/10 text-success'
 : selectedDevice.status === 'standby'
 ? 'bg-primary/10 text-primary'
 : 'bg-muted text-muted-foreground'
 }
 >
 {getStatusLabel(selectedDevice.status, false)}
 </Badge>
 <Button size="sm" onClick={() => navigate(`/admin/devices/${selectedDevice.id}/logs`)}>
 View Logs
 </Button>
 <Button size="sm" variant="outline" onClick={() => setSelectedDevice(null)}>
 Close
 </Button>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Legend */}
 <div className="flex items-center gap-6 text-sm text-muted-foreground">
 <div className="flex items-center gap-2">
 <span className="w-3 h-3 rounded-full bg-success"></span>
 Live (Playing)
 </div>
 <div className="flex items-center gap-2">
 <span className="w-3 h-3 rounded-full bg-primary"></span>
 Ready (Standby)
 </div>
 <div className="flex items-center gap-2">
 <span className="w-3 h-3 rounded-full bg-muted-foreground"></span>
 Offline
 </div>
 </div>
 </div>
 </div>
 );
}
