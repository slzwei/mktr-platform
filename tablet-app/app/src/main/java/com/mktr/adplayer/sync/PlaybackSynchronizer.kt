package com.mktr.adplayer.sync

import android.util.Log
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * PlaybackSynchronizer - Coordinates playback between Master and Slave
 * 
 * For Master: Reports current playback state to SyncBroadcaster
 * For Slave: Applies sync packets to local player
 */
@Singleton
class PlaybackSynchronizer @Inject constructor(
    private val syncBroadcaster: SyncBroadcaster,
    private val syncReceiver: SyncReceiver
) {
    companion object {
        private const val TAG = "PlaybackSynchronizer"
        
        // Tolerance for position sync (don't seek if within this range)
        private const val POSITION_TOLERANCE_MS = 300L
        
        // Maximum position drift before forcing a seek
        private const val MAX_DRIFT_MS = 1000L
        
        // Minimum time between forced syncs
        private const val MIN_SYNC_INTERVAL_MS = 2000L
    }

    enum class Role { MASTER, SLAVE, STANDALONE }
    
    private var role: Role = Role.STANDALONE
    private var player: ExoPlayer? = null
    private var listenerJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main)
    private var lastForcedSyncTime = 0L
    private var playlistVersion = ""

    /**
     * Initialize synchronizer with role and player
     */
    fun initialize(deviceRole: String?, exoPlayer: ExoPlayer, version: String = "") {
        role = when (deviceRole) {
            "master" -> Role.MASTER
            "slave" -> Role.SLAVE
            else -> Role.STANDALONE
        }
        player = exoPlayer
        playlistVersion = version
        
        Log.i(TAG, "Initialized as $role")
        
        when (role) {
            Role.MASTER -> startMasterMode()
            Role.SLAVE -> startSlaveMode()
            Role.STANDALONE -> { /* No sync needed */ }
        }
    }

    /**
     * Master mode: Start broadcasting and report state
     */
    private fun startMasterMode() {
        syncBroadcaster.playlistVersion = playlistVersion
        syncBroadcaster.start()
        
        // Add player listener to update broadcaster
        player?.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                updateBroadcasterState()
            }
            
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updateBroadcasterState()
            }
            
            override fun onMediaItemTransition(
                mediaItem: androidx.media3.common.MediaItem?,
                reason: Int
            ) {
                updateBroadcasterState()
            }
        })
    }

    /**
     * Report current state to broadcaster
     */
    fun updateBroadcasterState() {
        val p = player ?: return
        if (role != Role.MASTER) return
        
        syncBroadcaster.updateState(
            mediaIndex = p.currentMediaItemIndex,
            positionMs = p.currentPosition,
            playing = p.isPlaying,
            version = playlistVersion
        )
    }

    /**
     * Slave mode: Listen for sync packets and apply them
     */
    private fun startSlaveMode() {
        syncReceiver.start()
        
        listenerJob = scope.launch {
            syncReceiver.syncEvents.collectLatest { packet ->
                applySyncPacket(packet)
            }
        }
    }

    /**
     * Apply sync packet to player (Slave mode)
     */
    private fun applySyncPacket(packet: SyncPacket) {
        val p = player ?: return
        
        // Check playlist version match
        if (packet.playlistVersion.isNotEmpty() && 
            playlistVersion.isNotEmpty() && 
            packet.playlistVersion != playlistVersion) {
            Log.w(TAG, "Playlist version mismatch: ${packet.playlistVersion} vs $playlistVersion")
            // Could trigger manifest refresh here
            return
        }
        
        val currentIndex = p.currentMediaItemIndex
        val currentPosition = p.currentPosition
        val targetPosition = packet.adjustedPositionMs
        val drift = kotlin.math.abs(currentPosition - targetPosition)
        
        // Handle media item change
        if (packet.mediaIndex != currentIndex) {
            Log.i(TAG, "Syncing media item: $currentIndex -> ${packet.mediaIndex}")
            p.seekTo(packet.mediaIndex, targetPosition)
            lastForcedSyncTime = System.currentTimeMillis()
            return
        }
        
        // Handle significant position drift
        val timeSinceLastSync = System.currentTimeMillis() - lastForcedSyncTime
        if (drift > MAX_DRIFT_MS && timeSinceLastSync > MIN_SYNC_INTERVAL_MS) {
            Log.i(TAG, "Syncing position: drift=${drift}ms, seeking to $targetPosition")
            p.seekTo(targetPosition)
            lastForcedSyncTime = System.currentTimeMillis()
        }
        
        // Handle play/pause state
        if (packet.isPlaying && !p.isPlaying) {
            Log.d(TAG, "Syncing: Start playback")
            p.play()
        } else if (!packet.isPlaying && p.isPlaying) {
            Log.d(TAG, "Syncing: Pause playback")
            p.pause()
        }
    }

    /**
     * Update playlist version (called when manifest changes)
     */
    fun updatePlaylistVersion(version: String) {
        playlistVersion = version
        if (role == Role.MASTER) {
            syncBroadcaster.playlistVersion = version
        }
    }

    /**
     * Stop synchronization
     */
    fun stop() {
        Log.i(TAG, "Stopping synchronizer")
        listenerJob?.cancel()
        listenerJob = null
        
        when (role) {
            Role.MASTER -> syncBroadcaster.stop()
            Role.SLAVE -> syncReceiver.stop()
            Role.STANDALONE -> { /* Nothing to stop */ }
        }
        
        player = null
        role = Role.STANDALONE
    }
}
