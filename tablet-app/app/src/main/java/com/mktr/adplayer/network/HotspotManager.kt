package com.mktr.adplayer.network

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * HotspotManager - Manages local-only hotspot for Master device
 * 
 * Uses WifiManager.LocalOnlyHotspotReservation for creating a local hotspot
 * that Slave devices can connect to for synchronized playback.
 * 
 * Note: LocalOnlyHotspot generates random SSID/password each time.
 * For production, consider using manual hotspot setup with fixed credentials.
 */
@Singleton
class HotspotManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "HotspotManager"
    }

    sealed class HotspotState {
        object Inactive : HotspotState()
        object Starting : HotspotState()
        data class Active(val ssid: String, val password: String) : HotspotState()
        data class Failed(val reason: String) : HotspotState()
    }

    private val _state = MutableStateFlow<HotspotState>(HotspotState.Inactive)
    val state: StateFlow<HotspotState> = _state.asStateFlow()

    private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
    private val wifiManager: WifiManager by lazy {
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    }

    /**
     * Start the local-only hotspot
     * Requires: android.permission.CHANGE_WIFI_STATE
     *           android.permission.ACCESS_FINE_LOCATION (for API 26+)
     */
    fun startHotspot() {
        if (_state.value is HotspotState.Active || _state.value is HotspotState.Starting) {
            Log.d(TAG, "Hotspot already active or starting")
            return
        }

        _state.value = HotspotState.Starting
        Log.i(TAG, "Starting local-only hotspot...")

        try {
            wifiManager.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation?) {
                    reservation = res
                    val config = res?.wifiConfiguration ?: res?.softApConfiguration
                    
                    val ssid: String
                    val password: String
                    
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && res?.softApConfiguration != null) {
                        // API 30+
                        ssid = res.softApConfiguration?.ssid ?: "Unknown"
                        password = res.softApConfiguration?.passphrase ?: ""
                    } else {
                        // Legacy (API 26-29)
                        @Suppress("DEPRECATION")
                        ssid = res?.wifiConfiguration?.SSID ?: "Unknown"
                        @Suppress("DEPRECATION")
                        password = res?.wifiConfiguration?.preSharedKey ?: ""
                    }
                    
                    Log.i(TAG, "Hotspot started! SSID: $ssid")
                    _state.value = HotspotState.Active(ssid, password)
                }

                override fun onStopped() {
                    Log.i(TAG, "Hotspot stopped")
                    reservation = null
                    _state.value = HotspotState.Inactive
                }

                override fun onFailed(reason: Int) {
                    val reasonStr = when (reason) {
                        ERROR_GENERIC -> "Generic error"
                        ERROR_INCOMPATIBLE_MODE -> "Incompatible mode"
                        ERROR_TETHERING_DISALLOWED -> "Tethering disallowed"
                        ERROR_NO_CHANNEL -> "No channel available"
                        else -> "Unknown error ($reason)"
                    }
                    Log.e(TAG, "Hotspot failed: $reasonStr")
                    _state.value = HotspotState.Failed(reasonStr)
                }
            }, Handler(Looper.getMainLooper()))
        } catch (e: SecurityException) {
            Log.e(TAG, "Permission denied for hotspot", e)
            _state.value = HotspotState.Failed("Permission denied: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start hotspot", e)
            _state.value = HotspotState.Failed("Error: ${e.message}")
        }
    }

    /**
     * Stop the hotspot and release resources
     */
    fun stopHotspot() {
        Log.i(TAG, "Stopping hotspot...")
        try {
            reservation?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing hotspot", e)
        }
        reservation = null
        _state.value = HotspotState.Inactive
    }

    /**
     * Get the IP address of the hotspot (for Slave to connect to)
     * Returns the gateway IP which is typically 192.168.x.1
     */
    fun getGatewayIp(): String {
        return "192.168.49.1" // Android's default LocalOnlyHotspot gateway
    }
}
