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
    private val impressionManager: com.mktr.adplayer.data.manager.ImpressionManager
) : ViewModel(), androidx.lifecycle.LifecycleEventObserver {



    override fun onStateChanged(source: androidx.lifecycle.LifecycleOwner, event: androidx.lifecycle.Lifecycle.Event) {
        when (event) {
            androidx.lifecycle.Lifecycle.Event.ON_STOP -> {
                Log.d("PlayerVM", "App Backgrounded: Stopping Playback")
                stopPlaybackLoop() // Cancel job
                updateStatus("offline")
            }
            androidx.lifecycle.Lifecycle.Event.ON_START -> {
                Log.d("PlayerVM", "App Foregrounded: Checking state")
                // If we have a playlist, we could auto-resume, but effectively we just report "idle"
                // until the user (or auto-logic) starts it.
                // However, to be "nice", if we were playing, we might want to resume.
                // For now, consistent with the plan: Update status to idle/ready.
                updateStatus("idle")
                
                // If we have a playlist loaded, we can restart the loop if desired.
                // But simplified approach: just ensure status is correct so backend knows.
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
    }

    private val _playerState = MutableStateFlow<PlayerState>(PlayerState.Initializing)
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    private var currentPlaylist: List<PlaylistItem> = emptyList()
    private var assetsMap: Map<String, com.mktr.adplayer.api.model.Asset> = emptyMap()
    private var currentIndex = 0

    private var playbackJob: kotlinx.coroutines.Job? = null

    init {
        // Observe Process Lifecycle for Foreground/Background detection
        androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    fun startPlaylist(manifest: ManifestResponse) {
        currentPlaylist = manifest.playlist
        assetsMap = manifest.assets.associateBy { it.id }
        currentIndex = 0
        
        if (currentPlaylist.isEmpty()) {
            _playerState.value = PlayerState.Error("Empty Playlist")
            updateStatus("idle")
            return
        }

        startPlaybackLoop()
    }

    private fun stopPlaybackLoop() {
        playbackJob?.cancel()
        playbackJob = null
        // Reset state to non-playing if beneficial, but keeping last state might be better for UI?
        // Let's just ensure we stop the loop.
    }

    private fun startPlaybackLoop() {
        // Don't start if no playlist
        if (currentPlaylist.isEmpty()) return

        playbackJob?.cancel()
        playbackJob = viewModelScope.launch {
            _playerState.value = PlayerState.Initializing
            updateStatus("playing")
            
            // Initial delay to allow UI to settle? Not strictly needed but safe.
            // delay(500) 

            while (isActive) {
                val item = currentPlaylist.getOrNull(currentIndex)
                if (item == null) {
                    // Safety check if playlist changed or index invalid
                    currentIndex = 0
                    continue
                }

                val asset = assetsMap[item.assetId]
                var durationToWait = 5000L // Default fallback

                if (asset != null) {
                    try {
                        val file = assetManager.getAssetFile(asset)
                        if (file.exists()) {
                            // Valid Asset - Play it
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
                                durationMs = item.durationMs
                            )

                            // [MODIFIED] Trigger Upload Immediately
                            try {
                                val uploadRequest = androidx.work.OneTimeWorkRequestBuilder<com.mktr.adplayer.worker.ImpressionWorker>()
                                    .build()
                                
                                androidx.work.WorkManager.getInstance(context).enqueueUniqueWork(
                                    "ImpressionWorker",
                                    androidx.work.ExistingWorkPolicy.REPLACE,
                                    uploadRequest
                                )
                                Log.d("PlayerVM", "Triggered immediate upload for ${item.assetId}")
                            } catch (e: Exception) {
                                Log.e("PlayerVM", "Failed to trigger upload worker", e)
                            }

                            durationToWait = item.durationMs.coerceAtLeast(3000L).coerceAtMost(60000L) // Ensure 3s-60s range
                        } else {
                            Log.e("PlayerVM", "File not found for asset: ${asset.id} at path: ${file.absolutePath}")
                            // Skip quickly but not instantly
                            durationToWait = 2000L
                        }
                    } catch (e: Exception) {
                        Log.e("PlayerVM", "Error playback item ${item.id}", e)
                        durationToWait = 2000L
                    }
                } else {
                     Log.e("PlayerVM", "Missing asset definition for item ${item.id}")
                     durationToWait = 2000L
                }

                // Wait for the duration of the content (or the error backoff)
                Log.d("PlayerVM", "Playing index $currentIndex for ${durationToWait}ms")
                delay(durationToWait)

                // Advance index
                currentIndex = (currentIndex + 1) % currentPlaylist.size
            }
            // Loop ended (shouldn't happen unless cancelled)
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
