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
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val assetManager: AssetManager,
    private val impressionManager: com.mktr.adplayer.data.manager.ImpressionManager
) : ViewModel(), androidx.lifecycle.LifecycleEventObserver {

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

            // 3. SWITCH PHASE (Main Thread)
            // Ensure we are still active and not cancelled
            if (!isActive) return@launch

            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                _isDownloading.value = false // Stop Indicator
                isPlaybackAllowed = true // Allow Playback (Serialized on Main Thread)
                
                currentPlaylist = correctedPlaylist // Use corrected list
                assetsMap = manifest.assets.associateBy { it.id }
                playlistVersion = manifest.version.toString()
                
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

        updateStatus("playing")

        // Update UI
        _playerState.value = PlayerState.Playing(
            item = item,
            fileUri = Uri.fromFile(file),
            index = index,
            total = currentPlaylist.size
        )

        // Track Impression
        trackImpression(item)

        if (item.type == "video") {
            // EXO PLAYER LOGIC
            val mediaItem = androidx.media3.common.MediaItem.fromUri(Uri.fromFile(file))
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
            exoPlayer.play()
            // Listener will trigger advanceToNextItem() on completion
        } else {
            // IMAGE LOGIC
            exoPlayer.stop() // Ensure video is stopped
            val duration = if (item.durationMs > 0) item.durationMs else 10000L
            
            imageTimerJob = viewModelScope.launch {
                delay(duration)
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
