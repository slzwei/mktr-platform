import { EventEmitter } from 'events';

class PushService extends EventEmitter {
    constructor() {
        super();
        this.clients = new Map(); // deviceId -> { id, res }
        this.observers = new Map(); // deviceId -> Set<{ id, res }>

        // Start heartbeat loop to keep connections alive and detect zombies
        setInterval(() => this.broadcastHeartbeat(), 30000);
    }

    addClient(deviceId, res) {
        // If client already exists, we might want to close the old one or just overwrite
        if (this.clients.has(deviceId)) {
            console.log(`[Push] Replacing existing client for ${deviceId}`);
        }

        // Generate a quick random connection ID for debugging
        const connectionId = Math.random().toString(36).substring(7);

        const client = {
            id: connectionId,
            deviceId,
            res,
            connectedAt: Date.now()
        };

        this.clients.set(deviceId, client);
        console.log(`[Push] Client connected: ${deviceId} (${connectionId}) | Total: ${this.clients.size}`);

        // Send initial connection confirmed event
        this.sendEvent(deviceId, 'CONNECTED', { connectionId });

        // Handle close (client disconnect)
        res.on('close', () => {
            console.log(`[Push] Client disconnected: ${deviceId} (${connectionId})`);
            // Only remove if it matches the current connection (handling race conditions)
            if (this.clients.get(deviceId)?.id === connectionId) {
                this.clients.delete(deviceId);
            }
        });
    }

    addObserver(deviceId, res) {
        if (!this.observers.has(deviceId)) {
            this.observers.set(deviceId, new Set());
        }

        const connectionId = Math.random().toString(36).substring(7);
        const observer = { id: connectionId, res };

        this.observers.get(deviceId).add(observer);
        console.log(`[Push] Observer added for ${deviceId} (${connectionId}). Total: ${this.observers.get(deviceId).size}`);

        // Initial Event
        res.write(`event: connected\n`);
        res.write(`data: "Listening for logs..."\n\n`);

        res.on('close', () => {
            console.log(`[Push] Observer removed for ${deviceId} (${connectionId})`);
            const set = this.observers.get(deviceId);
            if (set) {
                // We have to iterate to find the object reference unless we store it specifically
                // Actually Set.delete requires the exact object reference.
                set.delete(observer);
                if (set.size === 0) {
                    this.observers.delete(deviceId);
                }
            }
        });
    }

    removeClient(deviceId) {
        const client = this.clients.get(deviceId);
        if (client) {
            client.res.end();
            this.clients.delete(deviceId);
        }
    }

    sendEvent(deviceId, type, data = {}) {
        const client = this.clients.get(deviceId);
        if (!client) {
            // Safe to ignore, tablet just might not be online
            // console.debug(`[Push] No active client for ${deviceId}, skipping ${type}`);
            return false;
        }

        try {
            const payload = JSON.stringify(data);
            client.res.write(`event: ${type}\n`);
            client.res.write(`data: ${payload}\n\n`);
            return true;
        } catch (err) {
            console.error(`[Push] Failed to send event to ${deviceId}`, err);
            this.removeClient(deviceId); // Assume broken pipe
            return false;
        }
    }

    broadcastLog(deviceId, log) {
        const set = this.observers.get(deviceId);
        if (!set || set.size === 0) return;

        const payload = JSON.stringify(log);
        for (const obs of set) {
            try {
                obs.res.write(`event: log\n`);
                obs.res.write(`data: ${payload}\n\n`);
            } catch (err) {
                console.error(`[Push] Failed to send log to observer`, err);
            }
        }
    }

    broadcastHeartbeat() {
        // Heartbeat for Clients (Tablets)
        if (this.clients.size > 0) {
            for (const [deviceId, client] of this.clients.entries()) {
                try {
                    client.res.write(': keep-alive\n\n');
                } catch (err) {
                    console.error(`[Push] Heartbeat failed for ${deviceId}, removing.`);
                    this.clients.delete(deviceId);
                }
            }
        }

        // Heartbeat for Observers (Admins)
        // Keep them alive too to prevent timeouts
        if (this.observers.size > 0) {
            for (const [deviceId, set] of this.observers.entries()) {
                for (const obs of set) {
                    try {
                        obs.res.write(': keep-alive\n\n');
                    } catch (e) {
                        // Cleanup happens on 'close' event
                    }
                }
            }
        }
    }
}

export const pushService = new PushService();
