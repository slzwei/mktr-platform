package com.mktr.adplayer.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import javax.inject.Inject
import javax.inject.Singleton

/**
 * SyncReceiver - Slave device receives sync packets from Master
 * 
 * Listens on UDP port for playback sync commands and emits them
 * via SharedFlow for the PlaybackSynchronizer to consume.
 */
@Singleton
class SyncReceiver @Inject constructor() {
    
    companion object {
        private const val TAG = "SyncReceiver"
        private const val BUFFER_SIZE = 1024
    }

    private var socket: DatagramSocket? = null
    private var listenerJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    private val _syncEvents = MutableSharedFlow<SyncPacket>(
        replay = 0,
        extraBufferCapacity = 10
    )
    val syncEvents: SharedFlow<SyncPacket> = _syncEvents.asSharedFlow()

    /**
     * Start listening for sync packets
     */
    fun start() {
        if (listenerJob?.isActive == true) {
            Log.d(TAG, "Already listening")
            return
        }

        Log.i(TAG, "Starting sync receiver on port ${SyncBroadcaster.SYNC_PORT}")

        listenerJob = scope.launch {
            try {
                socket = DatagramSocket(SyncBroadcaster.SYNC_PORT).apply {
                    reuseAddress = true
                    broadcast = true
                }

                val buffer = ByteArray(BUFFER_SIZE)
                val packet = DatagramPacket(buffer, buffer.size)

                while (isActive) {
                    try {
                        socket?.receive(packet)
                        val data = String(packet.data, 0, packet.length, Charsets.UTF_8)
                        val syncPacket = parseSyncPacket(data)
                        
                        if (syncPacket != null) {
                            _syncEvents.emit(syncPacket)
                            
                            // Log occasionally
                            if (System.currentTimeMillis() % 5000 < 600) {
                                Log.d(TAG, "Received sync: idx=${syncPacket.mediaIndex} pos=${syncPacket.positionMs}")
                            }
                        }
                    } catch (e: Exception) {
                        if (isActive) {
                            Log.w(TAG, "Error receiving packet", e)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Receiver error", e)
            }
        }
    }

    /**
     * Stop listening
     */
    fun stop() {
        Log.i(TAG, "Stopping sync receiver")
        listenerJob?.cancel()
        listenerJob = null
        try {
            socket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing socket", e)
        }
        socket = null
    }

    /**
     * Parse JSON sync packet
     */
    private fun parseSyncPacket(data: String): SyncPacket? {
        return try {
            val json = JSONObject(data)
            if (json.optString("type") != "SYNC") return null
            
            SyncPacket(
                mediaIndex = json.getInt("idx"),
                positionMs = json.getLong("pos"),
                isPlaying = json.getBoolean("playing"),
                timestamp = json.getLong("ts"),
                playlistVersion = json.optString("version", ""),
                receivedAt = System.currentTimeMillis()
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse sync packet: $data", e)
            null
        }
    }
}

/**
 * Data class for sync packet
 */
data class SyncPacket(
    val mediaIndex: Int,
    val positionMs: Long,
    val isPlaying: Boolean,
    val timestamp: Long,
    val playlistVersion: String,
    val receivedAt: Long
) {
    /**
     * Calculate network latency (one-way estimate)
     */
    val latencyMs: Long
        get() = (receivedAt - timestamp).coerceAtLeast(0)
    
    /**
     * Get adjusted position accounting for latency
     */
    val adjustedPositionMs: Long
        get() = positionMs + latencyMs
}
