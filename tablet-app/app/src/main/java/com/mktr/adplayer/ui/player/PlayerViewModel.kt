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

    fun startPlaylist(manifest: ManifestResponse) {
        currentPlaylist = manifest.playlist
        assetsMap = manifest.assets.associateBy { it.id }
        currentIndex = 0
        
        if (currentPlaylist.isEmpty()) {
            _playerState.value = PlayerState.Error("Empty Playlist")
            return
        }

        viewModelScope.launch {
            // First, ensure all assets are downloaded (Blocking strategy for MVP)
            _playerState.value = PlayerState.Initializing
            try {
                // Determine missing assets first if needed, but for now we just verify/download next item just-in-time OR look ahead.
                // Let's do a quick loop to start playback.
                playNextItem()
            } catch (e: Exception) {
                Log.e("PlayerVM", "Playback failed", e)
                _playerState.value = PlayerState.Error(e.message ?: "Unknown error")
            }
        }
    }

    private suspend fun playNextItem() {
        if (!viewModelScope.isActive) return

        val item = currentPlaylist[currentIndex]
        val asset = assetsMap[item.assetId]

        if (asset != null) {
            try {
                // Ensure file exists
                val file = assetManager.getAssetFile(asset)
                _playerState.value = PlayerState.Playing(
                    item = item,
                    fileUri = Uri.fromFile(file),
                    index = currentIndex,
                    total = currentPlaylist.size
                )

                // Track Impression
                impressionManager.trackImpression(
                    adId = item.assetId,
                    campaignId = null, // TODO: Manifest should include campaign ID if needed, or backend infers it
                    mediaType = item.type,
                    durationMs = item.durationMs
                )

                // Wait for duration (if image) or let video finish?
                // For MVP, we treat video duration as the truth from manifest, 
                // OR we can listen to player events. 
                // The manifest says `duration_ms`. We will respect that for now to keep logic simple.
                delay(item.durationMs)

                // Move to next
                currentIndex = (currentIndex + 1) % currentPlaylist.size
                playNextItem()

            } catch (e: Exception) {
                Log.e("PlayerVM", "Failed to play item ${item.id}", e)
                // Skip item?
                delay(2000)
                currentIndex = (currentIndex + 1) % currentPlaylist.size
                playNextItem()
            }
        } else {
            Log.e("PlayerVM", "Missing asset for item ${item.id} (assetId=${item.assetId}). Skipping.")
            currentIndex = (currentIndex + 1) % currentPlaylist.size
            playNextItem()
        }
    }
}
