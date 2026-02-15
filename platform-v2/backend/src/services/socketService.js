import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase. 
// Note: We use process.env directly here. Ensure .env is loaded before this file is imported or use a getter.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('SocketService: Missing Supabase credentials. Ensure .env is loaded.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

class SocketService {
    constructor() {
        this.io = null;
        this.connectedDevices = new Map(); // socketId -> { deviceId, status }
    }

    init(httpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: '*', // Allow all origins for V2 MVP
                methods: ['GET', 'POST']
            }
        });

        this.io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);

            // Device Registration
            socket.on('register-device', async (deviceId) => {
                await this.handleRegister(socket, deviceId);
            });

            // Device Logs (Telemetry)
            socket.on('device-log', async (data) => {
                await this.handleLog(socket, data);
            });

            // Admin Joining Room
            socket.on('join-admin-room', (deviceId) => {
                if (deviceId) {
                    socket.join(`admin:device:${deviceId}`);
                    console.log(`Admin joined room: admin:device:${deviceId}`);
                }
            });

            // Admin Leaving Room
            socket.on('leave-admin-room', (deviceId) => {
                if (deviceId) {
                    socket.leave(`admin:device:${deviceId}`);
                    console.log(`Admin left room: admin:device:${deviceId}`);
                }
            });

            // Admin Sending Command (Relay to Device)
            socket.on('admin-command', ({ deviceId, command, payload }) => {
                console.log(`Admin sent command ${command} to ${deviceId}`);
                this.sendCommand(deviceId, command, payload);
            });

            // Disconnect
            socket.on('disconnect', async () => {
                await this.handleDisconnect(socket);
            });
        });
    }

    async handleRegister(socket, deviceId) {
        console.log(`Device ${deviceId} registered (Socket: ${socket.id})`);

        // Join device-specific room for receiving commands
        socket.join(`device:${deviceId}`);

        this.connectedDevices.set(socket.id, { deviceId, status: 'online' });

        // Update DB
        const { data, error } = await supabase
            .from('screens')
            .update({ status: 'online', last_seen_at: new Date() })
            .eq('id', deviceId)
            .select();

        if (error) console.error(`Error updating status for ${deviceId}:`, error.message);

        // Auto-Enrollment: If device doesn't exist, insert it logic
        if (!data || data.length === 0) {
            console.log(`New device detected: ${deviceId}. enrolling...`);
            const { error: insertError } = await supabase.from('screens').insert({
                id: deviceId,
                name: `New Device (${deviceId.substring(0, 5)})`,
                status: 'online',
                last_seen_at: new Date()
            });
            if (insertError) console.error(`Error enrolling ${deviceId}:`, insertError.message);
        }

        // Notify Admin Dashboard (Global Status Change)
        this.io.emit('status_change', { deviceId, status: 'online', lastSeenAt: new Date() });
    }

    async handleLog(socket, logData) {
        const { deviceId } = this.connectedDevices.get(socket.id) || {};
        if (!deviceId) return; // Security: Ignore logs from unregistered sockets

        // Save to DB (Fire & Forget to avoid blocking)
        supabase.from('device_logs').insert({
            device_id: deviceId,
            type: logData.type || 'INFO',
            payload: logData.payload
        }).then(({ error }) => {
            if (error) console.error('Failed to save log for', deviceId, error.message);
        });

        // Forward to Admin Room (Live Log Stream)
        const logPayload = {
            deviceId,
            ...logData,
            createdAt: new Date().toISOString()
        };
        this.io.to(`admin:device:${deviceId}`).emit('log', logPayload);
    }

    async handleDisconnect(socket) {
        const data = this.connectedDevices.get(socket.id);
        if (data) {
            const { deviceId } = data;
            console.log(`Device ${deviceId} disconnected`);
            this.connectedDevices.delete(socket.id);

            // Update DB
            await supabase
                .from('screens')
                .update({ status: 'offline', last_seen_at: new Date() })
                .eq('id', deviceId);

            // Notify Admin
            this.io.emit('status_change', { deviceId, status: 'offline', lastSeenAt: new Date() });
        }
    }

    /**
     * Send a command to a specific device
     * @param {string} deviceId 
     * @param {string} command - e.g. 'REBOOT', 'PLAY', 'PAUSE'
     * @param {object} payload 
     */
    sendCommand(deviceId, command, payload = {}) {
        if (!this.io) {
            console.warn('SocketService not initialized');
            return;
        }
        console.log(`Sending command ${command} to device ${deviceId}`);
        this.io.to(`device:${deviceId}`).emit('command', { command, payload });
    }
}

export const socketService = new SocketService();
