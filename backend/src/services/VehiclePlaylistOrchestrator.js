import { pushService } from './pushService.js';
import { Device, Vehicle, Campaign } from '../models/index.js';

class VehiclePlaylistOrchestrator {
    constructor() {
        this.vehicleTimers = new Map(); // vehicleId -> { currentIndex, timer, playlist }
        this.startPromise = null;
    }

    // Restore timers on server boot
    async restoreOrchestrators() {
        console.log('[Orchestrator] Restoring active vehicle timers...');
        try {
            // Find vehicles that have at least one active device connected
            // Optimization: In a real large scale system, we might want to check Redis presence
            // For now, we iterate all vehicles with assigned campaigns
            // Find active vehicles
            const vehicles = await Vehicle.findAll({
                where: { status: 'active' },
                include: [
                    { model: Device, as: 'masterDevice' },
                    { model: Device, as: 'slaveDevice' }
                ]
            });

            // Filter for playing devices
            const activeVehicles = vehicles.filter(v =>
                (v.masterDevice && v.masterDevice.status === 'playing') ||
                (v.slaveDevice && v.slaveDevice.status === 'playing')
            );

            console.log(`[Orchestrator] Found ${activeVehicles.length} vehicles with playing devices to restore.`);

            for (const v of activeVehicles) {
                if (!this.vehicleTimers.has(v.id)) {
                    this.startVehicle(v.id);
                }
            }
        } catch (e) {
            console.error('[Orchestrator] Restoration failed:', e);
        }
    }

    async startVehicle(vehicleId) {
        // Dedup: If already running, do nothing (or refresh?)
        if (this.vehicleTimers.has(vehicleId)) return;

        try {
            const vehicle = await Vehicle.findByPk(vehicleId);
            if (!vehicle) return;

            const playlist = await this.getPlaylistForVehicle(vehicle);
            if (!playlist || playlist.length === 0) {
                console.log(`[Orchestrator] Vehicle ${vehicle.carplate} has no playlist. Skipping.`);
                return;
            }

            console.log(`[Orchestrator] Starting sync timer for ${vehicle.carplate} (${playlist.length} items)`);

            this.vehicleTimers.set(vehicleId, {
                currentIndex: 0,
                playlist, // { version, items: [...] }
                timer: null
            });

            this.scheduleNextVideo(vehicleId);

        } catch (e) {
            console.error(`[Orchestrator] Failed to start vehicle ${vehicleId}:`, e);
        }
    }

    scheduleNextVideo(vehicleId) {
        const state = this.vehicleTimers.get(vehicleId);
        if (!state) return;

        if (state.playlist.items.length === 0) return;

        // Safety: Wrap index
        state.currentIndex = state.currentIndex % state.playlist.items.length;

        const video = state.playlist.items[state.currentIndex];
        // Fallback for missing duration: default to 15s (15000ms)
        const duration = video.durationMs || 15000;

        // Broadcast immediately with future start time
        // FMEA FM-4: Increased buffer from 500ms to 2000ms for clock drift safety
        const bufferMs = 2000;
        const startAtUnixMs = Date.now() + bufferMs;

        // Broadcast play command
        pushService.broadcastToVehicle(vehicleId, {
            event: 'play_video',
            video_index: state.currentIndex,
            start_at_unix_ms: startAtUnixMs,
            playlist_version: state.playlist.version,
            sequence: Date.now() // FMEA FM-9: Simple sequence for ordering/dedup
        });

        // Schedule next broadcast
        // We want the NEXT video to start exactly when this one ends.
        // So we need to fire the NEXT command slightly before this one ends?
        // Actually, the command tells them to play NOW.
        // So we wait 'duration' before sending the NEXT command.

        state.timer = setTimeout(() => {
            // Advance index
            state.currentIndex = (state.currentIndex + 1) % state.playlist.items.length;
            this.scheduleNextVideo(vehicleId);
        }, duration);
    }

    async refreshVehicle(vehicleId) {
        console.log(`[Orchestrator] Refreshing vehicle ${vehicleId}`);
        this.stopVehicle(vehicleId);
        await this.startVehicle(vehicleId);
    }

    stopVehicle(vehicleId) {
        const state = this.vehicleTimers.get(vehicleId);
        if (state) {
            if (state.timer) clearTimeout(state.timer);
            this.vehicleTimers.delete(vehicleId);
            console.log(`[Orchestrator] Stopped vehicle ${vehicleId}`);
        }
    }

    hasVehicle(vehicleId) {
        return this.vehicleTimers.has(vehicleId);
    }

    // --- Helpers ---

    // Reused logic from adtechManifest.js (should extract to shared service ideally)
    async getPlaylistForVehicle(vehicle) {
        // ... Mock implementation for now, mirroring manifest logic ...
        // In real implementation, we should extract the playlist generation logic 
        // from adtechManifest.js into a CampaignService so it can be reused here.

        // For this MVP, we will fetch campaigns fresh.

        let campaignIds = vehicle.campaignIds || [];
        if (campaignIds.length === 0) return null;

        const campaigns = await Campaign.findAll({
            where: {
                id: campaignIds,
                status: 'active'
            }
        });

        if (campaigns.length === 0) return null;

        // Sort by assignment order
        campaigns.sort((a, b) => campaignIds.indexOf(a.id) - campaignIds.indexOf(b.id));

        const items = [];
        let versionSeed = "";

        campaigns.forEach(c => {
            if (c.ad_playlist && Array.isArray(c.ad_playlist)) {
                // Check for valid items
                c.ad_playlist.forEach((item, idx) => {
                    // Ensure duration_ms is set logic matches manifest
                    // Manifest logic: (item.duration > 1000) ? item.duration : (item.duration || 10) * 1000
                    const dur = (item.duration > 1000) ? item.duration : (item.duration || 10) * 1000;

                    items.push({
                        ...item,
                        durationMs: dur
                    });
                });
                versionSeed += c.updatedAt.getTime();
            }
        });

        // Simple version hash
        const version = items.length; // TODO: Better versioning?

        return {
            version: 1, // Matches manifest static version for now
            items
        };
    }

    // Public state getter for new connections (FMEA FM-2)
    getCurrentState(vehicleId) {
        const state = this.vehicleTimers.get(vehicleId);
        if (!state) return null;

        // Calculate remaining time for current video to give accurate 'start_at' for mid-stream joiners?
        // Actually, if a tablet joins MID-VIDEO, we want it to start playing the CURRENT video immediately?
        // Or just wait for next?

        // Simplest robust strategy: Wait for next. 
        // But user wants "catch up".

        // For now, return current index. Tablet can decide.
        return {
            video_index: state.currentIndex,
            start_at_unix_ms: Date.now() + 500, // Start ASAP
            playlist_version: state.playlist.version,
            sequence: Date.now()
        };
    }
}

export const orchestrator = new VehiclePlaylistOrchestrator();
