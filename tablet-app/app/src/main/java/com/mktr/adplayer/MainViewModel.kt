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
import kotlinx.coroutines.isActive
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
    private val sseService: com.mktr.adplayer.api.service.SseService,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        // [Volume] Default to 0% on startup (Requirements: "playback from 0% at the start")
        try {
            val audioManager = context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
            audioManager.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, 0, 0)
            android.util.Log.i("MainViewModel", "Startup: Volume set to 0%")
        } catch (e: Exception) {
            android.util.Log.e("MainViewModel", "Failed to set default volume", e)
        }

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


    private var refreshJob: kotlinx.coroutines.Job? = null

    fun fetchManifest(isAutoRetry: Boolean = false) {
        // [FIX] Hot-Swap: Only show "Loading" if not retrying silently and not already playing.
        val currentState = _uiState.value
        
        // If this is a manual refresh or initial load, show loading.
        // If it's an auto-retry, we stay on the "Waiting" screen (or whatever current state is).
        if (!isAutoRetry && currentState !is UiState.Connected) {
            _uiState.value = UiState.Loading
        } else if (currentState is UiState.Connected) {
             android.util.Log.d("MainVM", "Refreshing manifest in background (Hot Swap)...")
        }

        // Cancel previous fetch to prevent race conditions (e.g. rapid retries)
        if (!isAutoRetry) refreshJob?.cancel()

        refreshJob = viewModelScope.launch {
            val result = repository.refreshManifest()
            
            result.onSuccess { manifest ->
                if (manifest != null) {
                    android.util.Log.i("MainVM", "Manifest Updated! v${manifest.version} with ${manifest.playlist.size} items")
                    _uiState.value = UiState.Connected(manifest, "Manifest Loaded (v${manifest.version})")
                } else {
                    // 304 Not Modified
                    android.util.Log.i("MainVM", "Manifest 304 Not Modified. ETag matched.")
                    if (currentState !is UiState.Connected) {
                        _uiState.value = UiState.Connected(null, "Manifest not modified (304) - Using Cache")
                    } else {
                         android.util.Log.d("MainVM", "Hot Swap: Skipping update because server returned 304.")
                    }
                }
                
                // [PUSH] Restart SSE if needed
                devicePrefs.deviceKey?.let { key ->
                    sseService.start(key) { type, payload ->
                        viewModelScope.launch {
                            android.util.Log.d("MainViewModel", "SSE Event Received: $type")
                            if (type == "REFRESH_MANIFEST" || type == "CONNECTED") {
                                fetchManifest()
                            } else if (type == "SET_VOLUME") {
                                handleVolumeCommand(payload)
                            }
                        }
                    }
                }

            }.onFailure { e ->
                Log.e("MainVM", "Manifest Fetch Error: ${e.message}", e)
                
                // Check for Auth Failure (Permanent Error)
                if (e.message?.contains("401") == true || e.message?.contains("403") == true) {
                    _uiState.value = UiState.Error("Auth Failed: ${e.message}. Check Key.")
                    return@onFailure
                }
                
                // Network / Other Failure -> Auto Retry
                if (currentState !is UiState.Connected) {
                    // If we are offline, show "Waiting" state
                    val msg = "Network Error. Retrying..."
                    if (currentState !is UiState.Error || currentState.error != msg) {
                        _uiState.value = UiState.Error(msg)
                    }
                    
                    // [RETRY LOOP]
                    android.util.Log.w("MainVM", "Network failed. Retrying in 5s...")
                    kotlinx.coroutines.delay(5000)
                    if (isActive) {
                        fetchManifest(isAutoRetry = true)
                    }
                } else {
                    // If playing, just log and suppressed retry (or maybe we should retry locally too? 
                    // decided to retry silently to keep data fresh)
                    android.util.Log.w("MainVM", "Hot Swap Failed. Retrying silently in 10s...")
                    kotlinx.coroutines.delay(10000)
                    if (isActive) {
                        fetchManifest(isAutoRetry = true)
                    }
                }
            }
        }
    }

    private fun handleVolumeCommand(payload: String) {
        try {
            val json = org.json.JSONObject(payload)
            val volPercent = json.optInt("volume", -1)
            if (volPercent in 0..100) {
                val audioManager = context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
                val maxVol = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
                val newVol = (maxVol * volPercent / 100.0).toInt()
                audioManager.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, newVol, 0)
                android.util.Log.i("MainViewModel", "Volume set to $volPercent% ($newVol/$maxVol)")
            }
        } catch (e: Exception) {
            android.util.Log.e("MainViewModel", "Failed to set volume", e)
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
