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
    private val assetManager: AssetManager,
    private val impressionManager: com.mktr.adplayer.data.manager.ImpressionManager
) : ViewModel() {

    private val _playerState = MutableStateFlow<PlayerState>(PlayerState.Initializing)
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    private var currentPlaylist: List<PlaylistItem> = emptyList()
    private var assetsMap: Map<String, com.mktr.adplayer.api.model.Asset> = emptyMap()
    private var currentIndex = 0

    private var playbackJob: kotlinx.coroutines.Job? = null

    fun startPlaylist(manifest: ManifestResponse) {
        currentPlaylist = manifest.playlist
        assetsMap = manifest.assets.associateBy { it.id }
        currentIndex = 0
        
        if (currentPlaylist.isEmpty()) {
            _playerState.value = PlayerState.Error("Empty Playlist")
            return
        }

        startPlaybackLoop()
    }

    private fun startPlaybackLoop() {
        playbackJob?.cancel()
        playbackJob = viewModelScope.launch {
            _playerState.value = PlayerState.Initializing
            
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
                                campaignId = null,
                                mediaType = item.type,
                                durationMs = item.durationMs
                            )

                            durationToWait = item.durationMs.coerceAtLeast(3000L) // Ensure at least 3s
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
        }
    }
}
