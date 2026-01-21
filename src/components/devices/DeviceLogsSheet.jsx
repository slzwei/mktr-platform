import React from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import { Activity, Battery, HardDrive, Wifi } from 'lucide-react';

export function DeviceLogsSheet({ device, open, onClose, logs }) {
    if (!device) return null;

    return (
        <Sheet open={open} onOpenChange={onClose}>
            <SheetContent className="w-[400px] sm:w-[540px]">
                <SheetHeader>
                    <SheetTitle>Device Logs</SheetTitle>
                    <SheetDescription>
                        Recent activity for {device.externalId || 'Unknown Device'} ({device.model})
                        <br />
                        <span className="text-xs text-muted-foreground">Showing last 100 events</span>
                    </SheetDescription>
                </SheetHeader>

                <ScrollArea className="h-[calc(100vh-120px)] mt-6 pr-4">
                    <div className="space-y-6">
                        {logs.length === 0 ? (
                            <div className="text-center text-muted-foreground py-10">
                                No logs found.
                            </div>
                        ) : (
                            logs.map((log) => (
                                <div key={log.id} className="relative pl-6 border-l border-border pb-6 last:pb-0">
                                    {/* Timestamp Dot */}
                                    <div className="absolute left-[-5px] top-0 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />

                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-muted-foreground">
                                                {format(new Date(log.createdAt), 'MMM d, h:mm:ss a')}
                                            </span>
                                            <Badge variant="outline" className="text-[10px]">
                                                {log.type}
                                            </Badge>
                                        </div>

                                        {/* Payload Content */}
                                        <div className="mt-2 text-sm bg-muted/50 p-3 rounded-md space-y-2">
                                            {/* Heartbeat Specific UI */}
                                            {log.type === 'HEARTBEAT' && (
                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <Activity className="h-3 w-3 text-blue-500" />
                                                        <span>Status: <span className="font-medium">{log.payload?.status || 'Active'}</span></span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Battery className="h-3 w-3 text-green-500" />
                                                        <span>Battery: <span className="font-medium">{(log.payload?.batteryLevel * 100).toFixed(0)}%</span></span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <HardDrive className="h-3 w-3 text-orange-500" />
                                                        <span>Storage: <span className="font-medium">{log.payload?.storageUsed}</span></span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Raw Payload Fallback */}
                                            {log.type !== 'HEARTBEAT' && (
                                                <pre className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                                                    {JSON.stringify(log.payload, null, 2)}
                                                </pre>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
