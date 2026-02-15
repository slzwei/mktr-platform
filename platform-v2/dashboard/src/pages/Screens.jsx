import { useState, useEffect, useRef } from 'react';
import { screensApi } from '../services/api';
import { socket } from '../services/socket';
import { ScreensTable } from '../components/ScreensTable';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"

export default function Screens() {
    const [screens, setScreens] = useState([]);
    const [selectedScreen, setSelectedScreen] = useState(null); // Full screen object
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const logEndRef = useRef(null);

    // Initial Load
    useEffect(() => {
        loadScreens();
    }, []);

    // Socket Event Listeners
    useEffect(() => {
        function onConnect() {
            console.log('Socket connected');
        }

        function onStatusChange({ deviceId, status, lastSeenAt }) {
            setScreens(prev => prev.map(s =>
                s.id === deviceId ? { ...s, status, last_seen_at: lastSeenAt } : s
            ));

            // Update selected screen if open
            if (selectedScreen?.id === deviceId) {
                setSelectedScreen(prev => ({ ...prev, status, last_seen_at: lastSeenAt }));
            }
        }

        function onLog(logEntry) {
            // Only append logs if we are viewing this device
            if (selectedScreen?.id === logEntry.deviceId) {
                setLogs(prev => [...prev, logEntry]);
            }
        }

        socket.on('connect', onConnect);
        socket.on('status_change', onStatusChange);
        socket.on('log', onLog);

        return () => {
            socket.off('connect', onConnect);
            socket.off('status_change', onStatusChange);
            socket.off('log', onLog);
        };
    }, [selectedScreen]); // Re-bind when selectedScreen changes (for closure access)

    // Join/Leave Admin Room for Logs
    useEffect(() => {
        if (selectedScreen) {
            console.log(`Joining admin room for ${selectedScreen.id}`);
            socket.emit('join-admin-room', selectedScreen.id);
            // Clear previous logs or fetch recent ones (omitted for MVP)
            setLogs([]);
        }

        return () => {
            if (selectedScreen) {
                console.log(`Leaving admin room for ${selectedScreen.id}`);
                socket.emit('leave-admin-room', selectedScreen.id);
            }
        };
    }, [selectedScreen?.id]);

    // Auto-scroll logs
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    async function loadScreens() {
        try {
            const data = await screensApi.getAll();
            setScreens(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    function sendCommand(screenId, command, payload = {}) {
        console.log(`Sending ${command} to ${screenId}`);
        socket.emit('admin-command', { deviceId: screenId, command, payload });
    }

    return (
        <div className="p-8 bg-black min-h-screen text-white font-sans">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Device Management</h1>
                    <p className="text-gray-400">Monitor and control your fleet.</p>
                </div>
                <Button
                    className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
                    onClick={() => {/* Add Screen logic */ }}
                >
                    + Register Device
                </Button>
            </div>

            {loading ? (
                <div className="text-center text-gray-500 mt-20">Loading fleet...</div>
            ) : (
                <ScreensTable
                    screens={screens}
                    onCommand={sendCommand}
                    onViewLogs={(screen) => setSelectedScreen(screen)}
                />
            )}

            {/* Live Logs Drawer */}
            <Sheet open={!!selectedScreen} onOpenChange={(open) => !open && setSelectedScreen(null)}>
                <SheetContent className="w-[800px] sm:max-w-[100vw] bg-gray-950 border-l border-gray-800 text-white sm:w-[600px]">
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-white flex items-center gap-3">
                            {selectedScreen?.name}
                            <Badge variant={selectedScreen?.status === 'online' ? 'default' : 'destructive'} className={selectedScreen?.status === 'online' ? 'bg-green-600' : 'bg-red-600'}>
                                {selectedScreen?.status}
                            </Badge>
                        </SheetTitle>
                        <SheetDescription className="text-gray-400 font-mono text-xs">
                            ID: {selectedScreen?.id}
                        </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Live Logs</h3>
                        <ScrollArea className="h-[calc(100vh-200px)] w-full rounded-md border border-gray-800 bg-black p-4 font-mono text-sm">
                            {logs.length === 0 && <div className="text-gray-600 italic">Waiting for logs...</div>}
                            {logs.map((log, i) => (
                                <div key={i} className="mb-1 border-b border-gray-900/50 pb-1 last:border-0">
                                    <span className="text-gray-500 text-xs mr-2">[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                                    <span className={`font-bold mr-2 ${log.type === 'ERROR' ? 'text-red-500' : 'text-blue-500'}`}>{log.type}</span>
                                    <span className="text-gray-300 break-all">{JSON.stringify(log.payload)}</span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </ScrollArea>
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}

// Temporary Button Component duplicate (to avoid import issues if shadcn incomplete)
function Button({ className, children, onClick }) {
    return <button onClick={onClick} className={`px-4 py-2 rounded-md font-medium transition-colors ${className}`}>{children}</button>
}
