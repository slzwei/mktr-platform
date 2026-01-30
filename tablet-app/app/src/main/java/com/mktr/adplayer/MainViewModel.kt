package com.mktr.adplayer

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mktr.adplayer.api.model.ManifestResponse
import com.mktr.adplayer.data.local.DevicePrefs
import com.mktr.adplayer.data.repository.ManifestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class UiState {
    object Loading : UiState()
    data class Provisioning(val sessionCode: String? = null, val provisionUrl: String? = null, val status: String = "Initializing...") : UiState()
    data class Connected(val manifest: ManifestResponse?, val message: String) : UiState()
    data class Error(val error: String) : UiState()
}

@HiltViewModel
class MainViewModel @Inject constructor(
    private val repository: ManifestRepository,
    private val devicePrefs: DevicePrefs,
    private val sseService: com.mktr.adplayer.api.service.SseService
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        checkProvisioning()
    }

    private fun checkProvisioning() {
        if (devicePrefs.deviceKey.isNullOrEmpty()) {
            startQrProvisioning()
        } else {
            fetchManifest()
        }
    }

    private var provisioningJob: kotlinx.coroutines.Job? = null

    private fun startQrProvisioning(existingCode: String? = null) {
        provisioningJob?.cancel()
        provisioningJob = viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            val sessionCode = existingCode ?: java.util.UUID.randomUUID().toString()
            val url = "${BuildConfig.PROVISIONING_BASE_URL}/provision/$sessionCode"
            
            _uiState.value = UiState.Provisioning(sessionCode, url, "Generating QR Code...")

            // Start Session API (only if new session or significant retry needed? Actually we should perhaps retry creation if it failed)
            // If we are retrying a network error, we should probably try to create the session again just in case it didn't reach server.
            // The server handles duplicates gracefully (returns success), so it is safe to call create again.
            
            val startResult = repository.startProvisioning(sessionCode)
            if (startResult.isFailure) {
                _uiState.value = UiState.Provisioning(sessionCode, url, "Network Error: Retrying...")
                kotlinx.coroutines.delay(3000)
                startQrProvisioning(sessionCode) // Retry with SAME code
                return@launch
            }

            _uiState.value = UiState.Provisioning(sessionCode, url, "Waiting for Admin to Scan...")

            // Poll Loop
            while (true) {
                val check = repository.checkProvisioning(sessionCode)
                check.onSuccess { res ->
                    if (res.status == "fulfilled" && !res.deviceKey.isNullOrEmpty()) {
                        // Success!
                        saveDeviceKey(res.deviceKey)
                        return@launch
                    } else if (res.status == "expired") {
                         // Restart with NEW code
                         startQrProvisioning(null)
                         return@launch
                    }
                }
                
                kotlinx.coroutines.delay(3000) // Poll every 3s
            }
        }
    }



    fun saveDeviceKey(key: String) {
        devicePrefs.deviceKey = key
        fetchManifest()
    }

    fun fetchManifest() {
        // [FIX] Hot-Swap: Only show full-screen "Loading" if we aren't already playing content.
        // If we are Connected, we stay Connected while the background refresh happens.
        val currentState = _uiState.value
        if (currentState !is UiState.Connected) {
            _uiState.value = UiState.Loading
        } else {
            android.util.Log.d("MainVM", "Refreshing manifest in background (Hot Swap)...")
        }

        viewModelScope.launch {
            val result = repository.refreshManifest()
            
            result.onSuccess { manifest ->
                if (manifest != null) {
                    android.util.Log.i("MainVM", "Manifest Updated! v${manifest.version} with ${manifest.playlist.size} items")
                    
                    // [SYNC] Config Updated (Role/Hotspot logic removed for Virtual Sync)
                    // We only care about the playlist content now.

                    _uiState.value = UiState.Connected(manifest, "Manifest Loaded (v${manifest.version})")
                } else {
                    // 304 Not Modified
                    android.util.Log.i("MainVM", "Manifest 304 Not Modified. ETag matched.")
                    if (currentState !is UiState.Connected) {
                        _uiState.value = UiState.Connected(null, "Manifest not modified (304) - Using Cache")
                    } else {
                        // If already connected, no-op (keep existing manifest)
                        android.util.Log.d("MainVM", "Hot Swap: Skipping update because server returned 304.")
                    }
                }
                
                // [PUSH] Start SSE Listening (Idempotent call in SseService usually, but safe to call)
                devicePrefs.deviceKey?.let { key ->
                    sseService.start(key) { type, _ ->
                        // [FIX] SSE callback runs on OkHttp's background thread.
                        // Must dispatch to viewModelScope for proper StateFlow updates.
                        viewModelScope.launch {
                            android.util.Log.d("MainViewModel", "SSE Event Received: $type")
                            // [UX] Auto-Refresh on Reconnect to catch config changes (e.g. after deployment)
                            if (type == "REFRESH_MANIFEST" || type == "CONNECTED") {
                                android.util.Log.i("MainViewModel", "Triggering Hot-Swap Refresh due to SSE ($type)")
                                fetchManifest()
                            }
                        }
                    }
                }

            }.onFailure { e ->
                Log.e("MainVM", "Manifest Fetch Error", e)
                if (e.message?.contains("401") == true || e.message?.contains("403") == true) {
                    _uiState.value = UiState.Error("Auth Failed: ${e.message}. Check Key.")
                } else {
                    // [FIX] Resilience: If background refresh fails, DON'T kill the player with an Error screen.
                    // Just log it and keep playing the old playlist.
                    if (currentState !is UiState.Connected) {
                        _uiState.value = UiState.Error("Network Error: ${e.message}")
                    } else {
                        android.util.Log.w("MainVM", "Hot Swap Failed. Errors suppressed to keep playback alive. Error: ${e.message}")
                    }
                }
            }
        }
    }
    
    fun clearKey() {
        sseService.stop()
        devicePrefs.deviceKey = null
        devicePrefs.lastManifestEtag = null
        checkProvisioning()
    }

    override fun onCleared() {
        super.onCleared()
        sseService.stop()
    }
}
