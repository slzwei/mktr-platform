package com.mktr.adplayer.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import javax.inject.Inject
import javax.inject.Singleton

/**
 * SyncBroadcaster - Master device broadcasts playback state over UDP
 * 
 * Sends periodic sync packets containing:
 * - Current media index
 * - Playback position (ms)
 * - Play/pause state
 * - Timestamp for latency calculation
 * 
 * Uses UDP broadcast to 255.255.255.255 on the local hotspot network.
 */
@Singleton
class SyncBroadcaster @Inject constructor() {
    
    companion object {
        private const val TAG = "SyncBroadcaster"
        const val SYNC_PORT = 8765
        private const val BROADCAST_INTERVAL_MS = 500L  // 2 Hz
    }

    private var socket: DatagramSocket? = null
    private var broadcastJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    // Current playback state (updated by PlayerViewModel)
    @Volatile var currentMediaIndex: Int = 0
    @Volatile var currentPositionMs: Long = 0
    @Volatile var isPlaying: Boolean = false
    @Volatile var playlistVersion: String = ""

    /**
     * Start broadcasting sync packets
     */
    fun start() {
        if (broadcastJob?.isActive == true) {
            Log.d(TAG, "Already broadcasting")
            return
        }

        Log.i(TAG, "Starting sync broadcaster on port $SYNC_PORT")

        broadcastJob = scope.launch {
            try {
                socket = DatagramSocket().apply {
                    broadcast = true
                    reuseAddress = true
                }

                val broadcastAddress = InetAddress.getByName("255.255.255.255")

                while (isActive) {
                    try {
                        val packet = createSyncPacket()
                        val data = packet.toByteArray(Charsets.UTF_8)
                        val datagramPacket = DatagramPacket(
                            data,
                            data.size,
                            broadcastAddress,
                            SYNC_PORT
                        )
                        socket?.send(datagramPacket)
                        
                        // Log occasionally (not every packet)
                        if (System.currentTimeMillis() % 5000 < BROADCAST_INTERVAL_MS) {
                            Log.d(TAG, "Sent sync: idx=$currentMediaIndex pos=$currentPositionMs playing=$isPlaying")
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to send sync packet", e)
                    }

                    delay(BROADCAST_INTERVAL_MS)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Broadcaster error", e)
            }
        }
    }

    /**
     * Stop broadcasting
     */
    fun stop() {
        Log.i(TAG, "Stopping sync broadcaster")
        broadcastJob?.cancel()
        broadcastJob = null
        try {
            socket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing socket", e)
        }
        socket = null
    }

    /**
     * Update playback state (called by PlayerViewModel)
     */
    fun updateState(mediaIndex: Int, positionMs: Long, playing: Boolean, version: String = "") {
        currentMediaIndex = mediaIndex
        currentPositionMs = positionMs
        isPlaying = playing
        if (version.isNotEmpty()) {
            playlistVersion = version
        }
    }

    /**
     * Create JSON sync packet
     */
    private fun createSyncPacket(): String {
        return JSONObject().apply {
            put("type", "SYNC")
            put("idx", currentMediaIndex)
            put("pos", currentPositionMs)
            put("playing", isPlaying)
            put("ts", System.currentTimeMillis())
            put("version", playlistVersion)
        }.toString()
    }
}
