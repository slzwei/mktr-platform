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
    private val playbackSynchronizer: com.mktr.adplayer.sync.PlaybackSynchronizer,
    private val devicePrefs: com.mktr.adplayer.data.local.DevicePrefs
) : ViewModel(), androidx.lifecycle.LifecycleEventObserver {

    // ExoPlayer instance managed by ViewModel
    val exoPlayer: androidx.media3.exoplayer.ExoPlayer by lazy {
        androidx.media3.exoplayer.ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
            repeatMode = androidx.media3.common.Player.REPEAT_MODE_OFF
        }
    }

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
                if (currentPlaylist.isNotEmpty()) {
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
        playbackSynchronizer.stop()
        exoPlayer.release()
    }

    private val _playerState = MutableStateFlow<PlayerState>(PlayerState.Initializing)
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    private val _isDownloading = MutableStateFlow(false)
    val isDownloading: StateFlow<Boolean> = _isDownloading.asStateFlow()

    // Signal from UI when video playback completes (Now handled via ExoPlayer listener internally)
    // We keep this for external signaling if needed, but primary logic moves to loop
    
    private var currentPlaylist: List<PlaylistItem> = emptyList()
    private var assetsMap: Map<String, com.mktr.adplayer.api.model.Asset> = emptyMap()
    private var currentIndex = 0

    private var playbackJob: kotlinx.coroutines.Job? = null

    init {
        // Observe Process Lifecycle for Foreground/Background detection
        androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        
        // Initialize Synchronizer
        playbackSynchronizer.initialize(devicePrefs.deviceRole, exoPlayer)
    }

    private var updateJob: kotlinx.coroutines.Job? = null

    fun startPlaylist(manifest: ManifestResponse) {
        // Update Sync Version
        playbackSynchronizer.updatePlaylistVersion(manifest.version.toString())
        
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
                currentPlaylist = manifest.playlist
                assetsMap = manifest.assets.associateBy { it.id }
                currentIndex = 0 // Reset index
                
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

    private fun startPlaybackLoop() {
        // Don't start if no playlist
        if (currentPlaylist.isEmpty()) return
        
        // If Slave, let Synchronizer handle playback control?
        // Actually, PlayerOrchestrator logic currently drives the "Next Item" logic.
        // For Slave, we might want to disable the automatic "Next Item" loop and just follow the Master?
        // OR, we run the loop but let Sync corrections fix the drift.
        // The Sync logic (step 290) handles Play/Pause/Seek. 
        // If Slave logic advances independently, it might conflict.
        
        // Strategy: Run logic on both. Sync corrects drift.
        
        playbackJob?.cancel()
        playbackJob = viewModelScope.launch {
            _playerState.value = PlayerState.Initializing
            updateStatus("playing")
            
            while (isActive) {
                val item = currentPlaylist.getOrNull(currentIndex)
                if (item == null) {
                    currentIndex = 0
                    continue
                }

                val asset = assetsMap[item.assetId]
                val isVideo = item.type == "video"

                if (asset != null) {
                    try {
                        val file = assetManager.getAssetFile(asset)
                        if (file.exists()) {
                            // Valid Asset - Play it
                            // Use ExoPlayer for both Image (dummy silence?) and Video
                            // Current UI splits them.
                            // If Video, we use ExoPlayer.
                            
                             _playerState.value = PlayerState.Playing(
                                item = item,
                                fileUri = Uri.fromFile(file),
                                index = currentIndex,
                                total = currentPlaylist.size
                            )

                            // Track Impression
                            impressionManager.trackImpression(
                                adId = item.assetId,
                                campaignId = item.campaignId,
                                mediaType = item.type,
                                durationMs = if (isVideo) item.durationMs else 10000L
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

                            if (isVideo) {
                                // Prepare Video in ExoPlayer
                                val mediaItem = androidx.media3.common.MediaItem.fromUri(Uri.fromFile(file))
                                exoPlayer.setMediaItem(mediaItem)
                                exoPlayer.prepare()
                                exoPlayer.play()
                                
                                Log.d("PlayerVM", "Playing VIDEO: ${item.assetId}")
                                
                                // Wait for completion
                                var videoEnded = false
                                val listener = object : androidx.media3.common.Player.Listener {
                                    override fun onPlaybackStateChanged(state: Int) {
                                        if (state == androidx.media3.common.Player.STATE_ENDED) {
                                            videoEnded = true
                                        }
                                    }
                                }
                                exoPlayer.addListener(listener)
                                
                                // Wait loop
                                while (!videoEnded && isActive && exoPlayer.playbackState != androidx.media3.common.Player.STATE_ENDED) {
                                    delay(200)
                                }
                                exoPlayer.removeListener(listener)
                                
                                currentIndex = (currentIndex + 1) % currentPlaylist.size
                            } else {
                                // For images: Still using Image composable, but maybe we should pause ExoPlayer?
                                exoPlayer.stop() 
                                Log.d("PlayerVM", "Playing IMAGE for 10s")
                                delay(10_000L)
                                currentIndex = (currentIndex + 1) % currentPlaylist.size
                            }
                        } else {
                            Log.e("PlayerVM", "File missing: ${file.absolutePath}")
                            delay(2000)
                            currentIndex = (currentIndex + 1) % currentPlaylist.size
                        }
                    } catch (e: Exception) {
                        Log.e("PlayerVM", "Error playback", e)
                        delay(2000)
                    }
                } else {
                     delay(2000)
                     currentIndex = (currentIndex + 1) % currentPlaylist.size
                }
            }
            updateStatus("idle")
        }
    }

    private fun updateStatus(status: String) {
        context.getSharedPreferences("adplayer_prefs", android.content.Context.MODE_PRIVATE)
            .edit()
            .putString("app_status", status)
            .apply()
    }
}
