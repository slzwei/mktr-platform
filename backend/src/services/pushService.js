import { EventEmitter } from 'events';

class PushService extends EventEmitter {
    constructor() {
        super();
        this.clients = new Map(); // deviceId -> { id, res }

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

    broadcastHeartbeat() {
        if (this.clients.size === 0) return;

        // console.debug(`[Push] Sending heartbeat to ${this.clients.size} clients`);
        for (const [deviceId, client] of this.clients.entries()) {
            try {
                // SSE Comment (starts with :) keeps connection alive but ignored by client
                client.res.write(': keep-alive\n\n');
            } catch (err) {
                console.error(`[Push] Heartbeat failed for ${deviceId}, removing.`);
                this.clients.delete(deviceId);
            }
        }
    }
}

export const pushService = new PushService();
