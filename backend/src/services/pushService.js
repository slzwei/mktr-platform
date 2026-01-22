import { EventEmitter } from 'events';

class PushService extends EventEmitter {
    constructor() {
        super();
        this.clients = new Map(); // deviceId -> { id, res, connectedAt }
        this.observers = new Map(); // deviceId -> Set<{ id, res }>
        this.fleetObservers = new Set(); // Set<{ id, res }> - For the main device list

        // Start heartbeat loop to keep connections alive and detect zombies
        setInterval(() => this.broadcastHeartbeat(), 30000);
    }

    // Register a tablet client
    async addClient(deviceId, res) {
        // Generate a quick random connection ID
        const connectionId = Math.random().toString(36).substring(7);

        // If client already exists, log it. We overwrite it below.
        if (this.clients.has(deviceId)) {
            console.log(`[Push] Replacing existing client for ${deviceId}`);
        }

        const client = {
            id: connectionId,
            deviceId,
            res,
            connectedAt: Date.now()
        };

        this.clients.set(deviceId, client);
        console.log(`[Push] Client connected: ${deviceId} (${connectionId}) | Total: ${this.clients.size}`);

        // 1. Update DB to Active
        this.updateDeviceStatus(deviceId, 'active');

        // 2. Broadcast Status Change (to Log View & Fleet View)
        this.broadcastStatusChange(deviceId, 'active');

        // 3. Send confirmation to tablet
        this.sendEvent(deviceId, 'CONNECTED', { connectionId });

        // Handle disconnect
        res.on('close', () => {
            this.removeClient(deviceId, connectionId);
        });
    }

    addObserver(deviceId, res) {
        console.log(`[Push] addObserver called for ID: ${deviceId} (Type: ${typeof deviceId})`);
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

        // Force flush proxy buffers (some require 2KB+ of data to start streaming)
        res.write(`: ${' '.repeat(2048)}\n\n`);

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

    // Handle tablet disconnect with Race Condition Protection
    removeClient(deviceId, closingConnectionId) {
        const currentClient = this.clients.get(deviceId);

        // CRITICAL: Only mark inactive if the closing connection is the CURRENT one.
        // If the tablet reconnected quickly, clients.get(id).id will be different.
        if (currentClient && (!closingConnectionId || currentClient.id === closingConnectionId)) {
            console.log(`[Push] Client disconnected: ${deviceId} (${closingConnectionId || 'unknown'}) -> Marking Inactive`);
            this.clients.delete(deviceId);

            // Update DB & Broadcast
            this.updateDeviceStatus(deviceId, 'inactive');
            this.broadcastStatusChange(deviceId, 'inactive');
        } else {
            console.log(`[Push] Stale disconnect ignored for ${deviceId} (${closingConnectionId}). Current: ${currentClient?.id}`);
        }
    }

    async updateDeviceStatus(deviceId, status) {
        try {
            // lazy import to avoid circular dependency issues if any
            const { Device } = await import('../models/index.js');
            await Device.update({ status, lastSeenAt: new Date() }, { where: { id: deviceId } });
        } catch (err) {
            console.error(`[Push] Failed to update device status ${deviceId}`, err);
        }
    }

    broadcastStatusChange(deviceId, status) {
        const payload = JSON.stringify({ status, lastSeenAt: new Date() });

        // 1. Notify Fleet Observers (AdminDevices list)
        for (const obs of this.fleetObservers) {
            try {
                obs.res.write(`event: status_change\n`);
                obs.res.write(`data: ${JSON.stringify({ deviceId, status, lastSeenAt: new Date() })}\n\n`);
            } catch (e) { /* clean up on close */ }
        }

        // 2. Notify Individual Device Log Observers (AdminDeviceLogs)
        const deviceObservers = this.observers.get(deviceId);
        if (deviceObservers) {
            for (const obs of deviceObservers) {
                try {
                    obs.res.write(`event: status_change\n`);
                    obs.res.write(`data: ${payload}\n\n`);
                } catch (e) { /* clean up on close */ }
            }
        }
    }

    addFleetObserver(res) {
        const connectionId = Math.random().toString(36).substring(7);
        const observer = { id: connectionId, res };
        this.fleetObservers.add(observer);

        console.log(`[Push] Fleet Observer added (${connectionId}). Total: ${this.fleetObservers.size}`);

        // Initial Event
        res.write(`event: connected\n`);
        res.write(`data: "Listening for fleet updates..."\n\n`);

        // Padding
        res.write(`: ${' '.repeat(2048)}\n\n`);
        if (res.flushHeaders) res.flushHeaders();

        res.on('close', () => {
            this.fleetObservers.delete(observer);
            console.log(`[Push] Fleet Observer removed (${connectionId})`);
        });
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
        console.log(`[Push] broadcastLog called for ID: ${deviceId} (Type: ${typeof deviceId})`);
        const set = this.observers.get(deviceId);

        // DEBUG: Print keys if not found
        if (!set || set.size === 0) {
            console.log(`[Push] No observers found for ${deviceId}. Observers Map Size: ${this.observers.size}`);
            // Limit spam, but could dump keys: console.log([...this.observers.keys()])
            return;
        }

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
                    this.removeClient(deviceId, client.id);
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

        // Heartbeat for Fleet Observers
        for (const obs of this.fleetObservers) {
            try {
                obs.res.write(': keep-alive\n\n');
            } catch (e) { }
        }
    }
}

export const pushService = new PushService();
