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
    object Provisioning : UiState() // Needs Key
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
            _uiState.value = UiState.Provisioning
        } else {
            fetchManifest()
        }
    }

    fun saveDeviceKey(key: String) {
        devicePrefs.deviceKey = key
        fetchManifest()
    }

    fun fetchManifest() {
        _uiState.value = UiState.Loading
        viewModelScope.launch {
            val result = repository.refreshManifest()
            
            result.onSuccess { manifest ->
                if (manifest != null) {
                    _uiState.value = UiState.Connected(manifest, "Manifest Loaded (v${manifest.version})")
                } else {
                    _uiState.value = UiState.Connected(null, "Manifest not modified (304) - Using Cache")
                }
                
                // [PUSH] Start SSE Listening
                devicePrefs.deviceKey?.let { key ->
                    sseService.start(key) { type, _ ->
                        if (type == "REFRESH_MANIFEST" || type == "CONNECTED") {
                            android.util.Log.d("MainViewModel", "Push/Connect received ($type)! Refreshing...")
                            fetchManifest()
                        }
                    }
                }

            }.onFailure { e ->
                Log.e("MainVM", "Error", e)
                if (e.message?.contains("401") == true || e.message?.contains("403") == true) {
                    _uiState.value = UiState.Error("Auth Failed: ${e.message}. Check Key.")
                } else {
                    _uiState.value = UiState.Error("Network Error: ${e.message}")
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
