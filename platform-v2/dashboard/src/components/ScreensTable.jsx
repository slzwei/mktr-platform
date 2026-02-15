import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function ScreensTable({ screens, onCommand, onViewLogs }) {
    return (
        <div className="rounded-md border border-gray-700 bg-gray-900/50 backdrop-blur">
            <Table>
                <TableHeader className="bg-gray-800/50">
                    <TableRow className="border-gray-700 hover:bg-gray-800/50">
                        <TableHead className="w-[100px] text-gray-400">Status</TableHead>
                        <TableHead className="text-gray-400">Name</TableHead>
                        <TableHead className="text-gray-400">ID</TableHead>
                        <TableHead className="text-gray-400">Last Seen</TableHead>
                        <TableHead className="text-right text-gray-400">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {screens.map((screen) => (
                        <TableRow key={screen.id} className="border-gray-700 hover:bg-gray-800 transition-colors">
                            <TableCell>
                                <Badge
                                    variant={screen.status === 'online' ? 'default' : 'destructive'}
                                    className={screen.status === 'online' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}
                                >
                                    {screen.status}
                                </Badge>
                            </TableCell>
                            <TableCell className="font-medium text-white">{screen.name}</TableCell>
                            <TableCell className="font-mono text-xs text-gray-500">{screen.id.substring(0, 8)}</TableCell>
                            <TableCell className="text-gray-400 text-sm">
                                {screen.last_seen_at ? new Date(screen.last_seen_at).toLocaleString() : 'Never'}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                    <Button
                                        size="sm"
                                        className="h-8 bg-green-600 hover:bg-green-500 text-white"
                                        onClick={() => onCommand(screen.id, 'PLAY')}
                                        title="Play Content"
                                    >
                                        Play
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="h-8 bg-orange-500 hover:bg-orange-400 text-white"
                                        onClick={() => onCommand(screen.id, 'PAUSE')}
                                        title="Pause Content"
                                    >
                                        Pause
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="h-8 bg-red-600 hover:bg-red-500 text-white"
                                        onClick={() => onCommand(screen.id, 'REBOOT')}
                                        title="Reboot Device"
                                    >
                                        Reboot
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700"
                                        onClick={() => onViewLogs(screen)}
                                        title="View Live Logs"
                                    >
                                        Logs
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
