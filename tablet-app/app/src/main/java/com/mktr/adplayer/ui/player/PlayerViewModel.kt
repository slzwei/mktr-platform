package com.mktr.adplayer.ui.player

import android.net.Uri
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mktr.adplayer.api.model.ManifestResponse
import com.mktr.adplayer.api.model.PlaylistItem
import com.mktr.adplayer.data.manager.AssetManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
// import kotlinx.coroutines.flow.first // Unused
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

// Removed unused WallClockSynchronizer import

sealed class PlayerState {
    object Initializing : PlayerState()
    data class Playing(
        val item: PlaylistItem,
        val fileUri: Uri,
        val index: Int,
        val total: Int,
        val playId: Long = System.currentTimeMillis()
    ) : PlayerState()
    data class Error(val message: String) : PlayerState()
    data class WaitingForSync(val targetTime: Long, val waitDuration: Long) : PlayerState()
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val assetManager: AssetManager,
    private val impressionManager: com.mktr.adplayer.data.manager.ImpressionManager
) : ViewModel(), androidx.lifecycle.LifecycleEventObserver {

    // ExoPlayer instance managed by ViewModel
    val exoPlayer: androidx.media3.exoplayer.ExoPlayer by lazy {
        androidx.media3.exoplayer.ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
            repeatMode = androidx.media3.common.Player.REPEAT_MODE_OFF
        }
    }

    private var isPlaybackAllowed = false

    override fun onStateChanged(source: androidx.lifecycle.LifecycleOwner, event: androidx.lifecycle.Lifecycle.Event) {
        when (event) {
            androidx.lifecycle.Lifecycle.Event.ON_STOP -> {
                Log.d("PlayerVM", "App Backgrounded: Stopping Playback")
                exoPlayer.pause()
                stopPlaybackLoop() // Cancel job
                updateStatus("offline")
            }
            androidx.lifecycle.Lifecycle.Event.ON_START -> {
                Log.d("PlayerVM", "App Foregrounded: Checking state")
                updateStatus("idle")
                if (isPlaybackAllowed && currentPlaylist.isNotEmpty()) {
                     startPlaybackLoop()
                }
            }
            else -> {}
        }
    }

    override fun onCleared() {
        super.onCleared()
        androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
        stopPlaybackLoop()
        exoPlayer.release()
    }

    private val _playerState = MutableStateFlow<PlayerState>(PlayerState.Initializing)
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    private val _isDownloading = MutableStateFlow(false)
    val isDownloading: StateFlow<Boolean> = _isDownloading.asStateFlow()

    private var currentPlaylist: List<PlaylistItem> = emptyList()
    private var assetsMap: Map<String, com.mktr.adplayer.api.model.Asset> = emptyMap()
    private var activeMediaIndex = -1
    private var playlistVersion = ""
    private var syncConfig: com.mktr.adplayer.api.model.SyncConfig? = null

    private var currentCycleStartTime: Long = 0L // [SYNC] Phase-Lock Anchor
    private var totalPlaylistDuration: Long = 0L // [SYNC] Total Cycle Time

    private var imageTimerJob: kotlinx.coroutines.Job? = null

    // [FIX] Simple Sequential Playback (No Sync)
    private val playerListener = object : androidx.media3.common.Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == androidx.media3.common.Player.STATE_ENDED) {
                Log.d("PlayerVM", "Video Ended. Moving to next.")
                advanceToNextItem()
            }
        }
        
        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
            Log.e("PlayerVM", "ExoPlayer Error: ${error.message}. Skipping.", error)
            advanceToNextItem()
        }
    }

    init {
        // Observe Process Lifecycle for Foreground/Background detection
        androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        exoPlayer.addListener(playerListener) // Attach listener permanently
    }

    private var updateJob: kotlinx.coroutines.Job? = null

    fun startPlaylist(manifest: ManifestResponse) {
        // Cancel any pending update (Race Condition #1)
        updateJob?.cancel()
        
        updateJob = viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            val startTime = System.currentTimeMillis()
            _isDownloading.value = true // Start Indicator
            
            // 1. Show loading ONLY if we strictly have nothing to play (Cold Start)
            if (currentPlaylist.isEmpty()) {
                _playerState.value = PlayerState.Initializing
            } else {
                Log.d("PlayerVM", "Hot-Swap started. Spinner should be visible now.")
            }

            // 2. DOWNLOAD PHASE (Background)
            try {
                // Returns true only if ALL files are ready. 
                // If false (e.g. disk full), we abort switch.
                val success = assetManager.prepareAssets(manifest.assets)
                
                if (!success) {
                   Log.e("PlayerVM", "Download Failed: Aborting playlist switch.")
                   _isDownloading.value = false
                   return@launch // Stay on old playlist (Safety #2)
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                Log.d("PlayerVM", "Update Cancelled (Newer manifest arrived)")
                throw e
            } catch (e: Exception) {
                Log.e("PlayerVM", "Download Error", e)
                _isDownloading.value = false
                return@launch // Stay on old playlist
            }

            // [VISUAL FEEDBACK] Enforce minimum spinner duration (2s) so user sees the update happening
            val elapsed = System.currentTimeMillis() - startTime
            if (elapsed < 2000) {
                delay(2000 - elapsed)
            }

            // 2.5 INSPECTION PHASE (IO)
            // Fix 10s truncation bug: The backend might send 0 or default durations.
            // We MUST inspect the actual files to get the true duration for Sync to work correctly.
            val correctedPlaylist = manifest.playlist.map { item ->
                if (item.type == "video") {
                    val asset = manifest.assets.find { it.id == item.assetId }
                    if (asset != null) {
                        try {
                            val file = assetManager.getAssetFile(asset)
                            if (file.exists()) {
                                val mmr = android.media.MediaMetadataRetriever()
                                try {
                                    mmr.setDataSource(file.absolutePath)
                                    val durationStr = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                                    val realDuration = durationStr?.toLongOrNull()
                                    if (realDuration != null && realDuration > 0) {
                                         // Log.d("PlayerVM", "Corrected duration for ${item.assetId}: ${item.durationMs} -> ${realDuration}ms")
                                         return@map item.copy(durationMs = realDuration)
                                    }
                                } catch (e: Exception) {
                                    Log.e("PlayerVM", "Failed to read duration for ${item.assetId}", e)
                                } finally {
                                    mmr.release()
                                }
                            }
                        } catch (e: Exception) {
                            Log.e("PlayerVM", "Error resolving file for ${item.assetId}", e)
                        }
                    }
                }
                item // Fallback to original if not video or failed
            }

            // [FIX] Empty Playlist Handling
            if (correctedPlaylist.isEmpty()) {
                Log.i("PlayerVM", "Received empty playlist. Stopping playback.")
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _isDownloading.value = false
                    isPlaybackAllowed = false
                    stopPlaybackLoop()
                    currentPlaylist = emptyList()
                    _playerState.value = PlayerState.Initializing // Return to waiting state
                }
                return@launch
            }

            // 3. SWITCH PHASE (Main Thread)
            // Ensure we are still active and not cancelled
            if (!isActive) return@launch

            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                _isDownloading.value = false // Stop Indicator
                isPlaybackAllowed = true // Allow Playback (Serialized on Main Thread)
                
                currentPlaylist = correctedPlaylist // Use corrected list
                assetsMap = manifest.assets.associateBy { it.id }
                playlistVersion = manifest.version.toString()
                syncConfig = manifest.syncConfig
                
                // [SYNC] Calculate Total Loop Duration for Continuous Sync
                totalPlaylistDuration = currentPlaylist.sumOf { 
                   if (it.durationMs > 0) it.durationMs else 10000L 
                }
                Log.i("PlayerVM", "Continuous Sync Mode: Cycle Duration = ${totalPlaylistDuration}ms")

                // Restart Loop with new content
                startPlaybackLoop() 
                
                Log.i("PlayerVM", "Switched to new playlist (Version ${manifest.version})")
                
                // 4. CLEANUP PHASE (Background, Low Priority)
                launch(kotlinx.coroutines.Dispatchers.IO) {
                    delay(5000) // Debounce cleanups / wait for player to let go of old files
                    assetManager.cleanupAssets(manifest.assets)
                }
            }
        }
    }

    private fun stopPlaybackLoop() {
        imageTimerJob?.cancel()
        imageTimerJob = null
        exoPlayer.stop()
    }

    fun stopPlayback() {
        Log.d("PlayerVM", "Stopping Playback (Unmounting)")
        isPlaybackAllowed = false
        updateJob?.cancel() // [FIX] Cancel any pending playlist update/download
        stopPlaybackLoop()
        updateStatus("idle")
        _playerState.value = PlayerState.Initializing
    }

    private fun startPlaybackLoop() {
        // Reset to first item
        activeMediaIndex = -1
        advanceToNextItem()
    }

    private fun advanceToNextItem() {
        if (!isPlaybackAllowed || currentPlaylist.isEmpty()) {
            return
        }

        // Cancel previous image timer if any
        imageTimerJob?.cancel()

        // Increment or wrap
        var nextIndex = activeMediaIndex + 1
        if (nextIndex >= currentPlaylist.size) {
            nextIndex = 0
        }
        
        // [SYNC] Continuous Atomic Sync (No Waiting)
        // We simply loop. phase-lock in playItem() handles the alignment.
        if (nextIndex == 0) {
            Log.i("PlayerVM", "Loop Restarting (Continuous).")
        }
        
        activeMediaIndex = nextIndex
        playItem(nextIndex)
    }

    private fun playItem(index: Int) {
        val item = currentPlaylist.getOrNull(index) ?: return
        val asset = assetsMap[item.assetId]
        
        if (asset == null) {
            Log.e("PlayerVM", "Missing asset for item $index. Skipping.")
            advanceToNextItem()
            return
        }

        val file = assetManager.getAssetFile(asset)
        if (!file.exists()) {
            Log.e("PlayerVM", "File missing for item $index. Skipping.")
            advanceToNextItem()
            return
        }

        // [SYNC] Phase-Locked Drift Correction
        var startOffset = 0L
        var displayDuration = if (item.durationMs > 0) item.durationMs else 10000L

        val config = syncConfig
        if (config != null && config.enabled && totalPlaylistDuration > 0) {
            // [SYNC] Continuous Phase Lock Logic
            // 1. Determine where "Cycle Start" was relative to Epoch
            val now = System.currentTimeMillis()
            val anchor = config.anchorEpochMs
            
            // "Which cycle iteration are we in?"
            // Iteration = floor((Now - Anchor) / Total)
            // StartTime = Anchor + Iteration * Total
            val timeSinceAnchor = now - anchor
            val iteration = timeSinceAnchor / totalPlaylistDuration
            currentCycleStartTime = anchor + (iteration * totalPlaylistDuration)
            
            // 2. Calculate Drift for THIS item
            var idealStartOffset = 0L
            for (i in 0 until index) {
                idealStartOffset += (currentPlaylist.getOrNull(i)?.durationMs ?: 0L)
            }
            
            // Ideal Start Time for this item
            val idealStartTime = currentCycleStartTime + idealStartOffset
            val drift = now - idealStartTime
            
            // Log.d("PlayerVM", "Phase: Loop=${iteration}, Item=$index, Ideal=${idealStartTime}, Now=${now}, Drift=${drift}ms")

            if (drift > 0) {
                // LATE: Behind schedule. Catch up.
                if (drift > displayDuration) {
                    Log.w("PlayerVM", "Phase: Very Late (${drift}ms > ${displayDuration}ms). Skipping item.")
                    advanceToNextItem()
                    return
                }
                
                if (item.type == "video") {
                    startOffset = drift
                } else {
                    displayDuration = (displayDuration - drift).coerceAtLeast(0L)
                }
            } else if (drift < -100) { 
                // EARLY: Too fast. Wait.
                viewModelScope.launch {
                    delay(-drift)
                    if (isActive) playItem(index)
                }
                return
            }
        }

        updateStatus("playing")

        // Update UI
        _playerState.value = PlayerState.Playing(
            item = item,
            fileUri = Uri.fromFile(file),
            index = index,
            total = currentPlaylist.size,
            playId = System.currentTimeMillis()
        )

        // Track Impression
        trackImpression(item)

        if (item.type == "video") {
            // EXO PLAYER LOGIC
            val mediaItem = androidx.media3.common.MediaItem.fromUri(Uri.fromFile(file))
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
            if (startOffset > 0) {
                exoPlayer.seekTo(startOffset)
            }
            exoPlayer.play()
            // Listener will trigger advanceToNextItem() on completion
        } else {
            // IMAGE LOGIC
            exoPlayer.stop() // Ensure video is stopped
            
            imageTimerJob = viewModelScope.launch {
                delay(displayDuration)
                if (isActive) {
                     advanceToNextItem()
                }
            }
        }
    }

    private fun trackImpression(item: PlaylistItem) {
        // Track Impression
        impressionManager.trackImpression(
            adId = item.assetId,
            campaignId = item.campaignId,
            mediaType = item.type,
            durationMs = item.durationMs
        )

        // Trigger Upload
        try {
            val uploadRequest = androidx.work.OneTimeWorkRequestBuilder<com.mktr.adplayer.worker.ImpressionWorker>().build()
            androidx.work.WorkManager.getInstance(context).enqueueUniqueWork(
                "ImpressionWorker",
                androidx.work.ExistingWorkPolicy.REPLACE,
                uploadRequest
            )
        } catch (e: Exception) { Log.e("PlayerVM", "Worker failed", e) }
    }

    private fun updateStatus(status: String) {
        context.getSharedPreferences("adplayer_prefs", android.content.Context.MODE_PRIVATE)
            .edit()
            .putString("app_status", status)
            .apply()

        // [FIX] Force immediate Heartbeat to update backend instantly
        try {
            val request = androidx.work.OneTimeWorkRequestBuilder<com.mktr.adplayer.worker.HeartbeatWorker>()
                .build()
            
            androidx.work.WorkManager.getInstance(context).enqueueUniqueWork(
                "HeartbeatWorker",
                androidx.work.ExistingWorkPolicy.REPLACE,
                request
            )
        } catch (e: Exception) { }
    }
}
