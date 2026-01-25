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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

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
    private val impressionManager: com.mktr.adplayer.data.manager.ImpressionManager,
    private val wallClockSynchronizer: com.mktr.adplayer.sync.WallClockSynchronizer,
    private val devicePrefs: com.mktr.adplayer.data.local.DevicePrefs
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
    // currentIndex is now derived from WallClock, but we keep track of what we are currently *playing* to detect changes
    private var activeMediaIndex = -1
    private var playlistVersion = ""

    private var playbackJob: kotlinx.coroutines.Job? = null

    init {
        // Observe Process Lifecycle for Foreground/Background detection
        androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.addObserver(this)
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

            // 3. SWITCH PHASE (Main Thread)
            // Ensure we are still active and not cancelled
            if (!isActive) return@launch

            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                _isDownloading.value = false // Stop Indicator
                isPlaybackAllowed = true // Allow Playback (Serialized on Main Thread)
                
                currentPlaylist = manifest.playlist
                assetsMap = manifest.assets.associateBy { it.id }
                playlistVersion = manifest.version.toString()
                activeMediaIndex = -1 // Force refresh
                
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
        playbackJob?.cancel()
        playbackJob = null
    }

    fun stopPlayback() {
        Log.d("PlayerVM", "Stopping Playback (Unmounting)")
        isPlaybackAllowed = false
        updateJob?.cancel() // [FIX] Cancel any pending playlist update/download
        stopPlaybackLoop()
        exoPlayer.pause()
        updateStatus("idle")
        _playerState.value = PlayerState.Initializing
    }

    private fun startPlaybackLoop() {
        // Don't start if no playlist
        if (currentPlaylist.isEmpty()) return
        
        playbackJob?.cancel()
        playbackJob = viewModelScope.launch {
            try {
                if (!isPlaybackAllowed) {
                     Log.w("PlayerVM", "Playback blocked because isPlaybackAllowed=false")
                     updateStatus("idle")
                     return@launch
                }

                updateStatus("playing")
                
                // Sync Loop (10Hz)
                while (isActive) {
                    val syncState = wallClockSynchronizer.getTargetState(currentPlaylist, playlistVersion)
                    val targetIndex = syncState.mediaIndex
                    val targetPos = syncState.seekPositionMs
                    
                    val item = currentPlaylist.getOrNull(targetIndex)
                    if (item == null) {
                        delay(100)
                        continue
                    }

                    val asset = assetsMap[item.assetId]
                    val isVideo = item.type == "video"
                    
                    if (asset == null) {
                         // Missing asset, skip? Or wait? 
                         // WallClock says we SHOULD be here. If we skip, we are ahead of time.
                         // Just show error/loading placeholder for this segment.
                         delay(100)
                         continue
                    }

                    val file = assetManager.getAssetFile(asset)
                    if (!file.exists()) {
                         delay(100)
                         continue
                    }

                    // CHECK: Do we need to switch media?
                    if (activeMediaIndex != targetIndex) {
                        Log.i("PlayerVM", "Sync: Switching to Item #$targetIndex (${item.type}) at ${targetPos}ms")
                        
                        // Update UI State
                        _playerState.value = PlayerState.Playing(
                            item = item,
                            fileUri = Uri.fromFile(file),
                            index = targetIndex,
                            total = currentPlaylist.size
                        )
                        
                        // Handle Media Switch
                        if (isVideo) {
                            val mediaItem = androidx.media3.common.MediaItem.fromUri(Uri.fromFile(file))
                            exoPlayer.setMediaItem(mediaItem)
                            exoPlayer.prepare()
                            exoPlayer.seekTo(targetPos) // Seek to wall-clock offset
                            exoPlayer.play()
                        } else {
                            exoPlayer.stop() // Stop video player for images
                        }
                        
                        activeMediaIndex = targetIndex
                        
                        // Track Impression (On Start)
                        trackImpression(item)

                    } else {
                        // WE ARE ON THE SAME ITEM.
                        // CHECK: Do we need to correct drift (Video only)?
                        if (isVideo && exoPlayer.isPlaying) {
                            val currentPos = exoPlayer.currentPosition
                            val drift = kotlin.math.abs(currentPos - targetPos)
                            
                            // Tolerance: 2 seconds (Generous to prevent stuttering)
                            if (drift > 2000) {
                                Log.w("PlayerVM", "Sync: Drift detected (${drift}ms). Seek to ${targetPos}ms")
                                exoPlayer.seekTo(targetPos)
                            }
                        }
                        // For Images, we just wait.
                    }
                    
                    delay(100) // 10Hz tick
                }
            } finally {
                updateStatus("idle")
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
            Log.d("PlayerVM", "Triggered immediate heartbeat for status: $status")
        } catch (e: Exception) {
            Log.e("PlayerVM", "Failed to trigger heartbeat", e)
        }
    }
}
