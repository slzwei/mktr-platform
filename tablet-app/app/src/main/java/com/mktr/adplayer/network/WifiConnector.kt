package com.mktr.adplayer.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WifiConnector - Manages WiFi connection for Slave device
 * 
 * Connects to the Master device's hotspot using provided SSID/password.
 * Uses WifiNetworkSpecifier on Android 10+ for peer-to-peer connections.
 */
@Singleton
class WifiConnector @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "WifiConnector"
    }

    sealed class ConnectionState {
        object Disconnected : ConnectionState()
        object Connecting : ConnectionState()
        data class Connected(val network: Network?, val ssid: String) : ConnectionState()
        data class Failed(val reason: String) : ConnectionState()
    }

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val connectivityManager: ConnectivityManager by lazy {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    private val wifiManager: WifiManager by lazy {
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    }

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /**
     * Connect to the Master's hotspot
     * 
     * @param ssid The SSID of the hotspot
     * @param password The password for the hotspot
     */
    fun connectToHotspot(ssid: String, password: String) {
        if (_state.value is ConnectionState.Connecting) {
            Log.d(TAG, "Already connecting...")
            return
        }

        _state.value = ConnectionState.Connecting
        Log.i(TAG, "Connecting to hotspot: $ssid")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+ uses WifiNetworkSpecifier
            connectWithSpecifier(ssid, password)
        } else {
            // Legacy approach for Android 9 and below
            connectLegacy(ssid, password)
        }
    }

    /**
     * Modern WiFi connection using WifiNetworkSpecifier (API 29+)
     * This creates a peer-to-peer connection that doesn't route internet traffic
     */
    private fun connectWithSpecifier(ssid: String, password: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return

        try {
            val specifier = WifiNetworkSpecifier.Builder()
                .setSsid(ssid)
                .setWpa2Passphrase(password)
                .build()

            val request = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifier)
                .build()

            // Unregister any existing callback
            networkCallback?.let {
                try {
                    connectivityManager.unregisterNetworkCallback(it)
                } catch (e: Exception) {
                    Log.w(TAG, "Error unregistering old callback", e)
                }
            }

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "Connected to $ssid")
                    // Bind this process to use the WiFi network for local communication
                    connectivityManager.bindProcessToNetwork(network)
                    _state.value = ConnectionState.Connected(network, ssid)
                }

                override fun onUnavailable() {
                    Log.e(TAG, "Network unavailable")
                    _state.value = ConnectionState.Failed("Network unavailable")
                }

                override fun onLost(network: Network) {
                    Log.w(TAG, "Network connection lost")
                    _state.value = ConnectionState.Disconnected
                }
            }

            connectivityManager.requestNetwork(request, networkCallback!!)
            Log.d(TAG, "Network request submitted")

        } catch (e: SecurityException) {
            Log.e(TAG, "Permission denied", e)
            _state.value = ConnectionState.Failed("Permission denied: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect", e)
            _state.value = ConnectionState.Failed("Error: ${e.message}")
        }
    }

    /**
     * Legacy WiFi connection for Android 9 and below
     */
    @Suppress("DEPRECATION")
    private fun connectLegacy(ssid: String, password: String) {
        try {
            val config = WifiConfiguration().apply {
                SSID = "\"$ssid\""
                preSharedKey = "\"$password\""
            }

            // Enable WiFi if not enabled
            if (!wifiManager.isWifiEnabled) {
                wifiManager.isWifiEnabled = true
            }

            val networkId = wifiManager.addNetwork(config)
            if (networkId == -1) {
                _state.value = ConnectionState.Failed("Failed to add network configuration")
                return
            }

            wifiManager.disconnect()
            val success = wifiManager.enableNetwork(networkId, true)
            
            if (success) {
                wifiManager.reconnect()
                // Note: In legacy mode we can't easily track connection state without BroadcastReceiver
                _state.value = ConnectionState.Connected(
                    null, // Network object not available synchronously in legacy mode
                    ssid
                )
            } else {
                _state.value = ConnectionState.Failed("Failed to enable network")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Permission denied", e)
            _state.value = ConnectionState.Failed("Permission denied: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect (legacy)", e)
            _state.value = ConnectionState.Failed("Error: ${e.message}")
        }
    }

    /**
     * Disconnect from the hotspot
     */
    fun disconnect() {
        Log.i(TAG, "Disconnecting from hotspot...")
        
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (e: Exception) {
                Log.w(TAG, "Error unregistering callback", e)
            }
        }
        networkCallback = null
        
        // Unbind process from network
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            connectivityManager.bindProcessToNetwork(null)
        }
        
        _state.value = ConnectionState.Disconnected
    }

    /**
     * Get the IP address of the Master device (gateway)
     */
    fun getMasterIp(): String? {
        if (_state.value !is ConnectionState.Connected) return null
        return "192.168.49.1" // Android LocalOnlyHotspot default gateway
    }
}
