package com.mktr.platform.v2

import android.content.Context
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URI

object SocketManager {
    private const val TAG = "SocketManager"
    private var prefsStore: PrefsStore? = null
    private var socket: Socket? = null
    private var heartbeatJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    private val _connectionState = MutableStateFlow("Disconnected")
    val connectionState: StateFlow<String> = _connectionState

    private val _lastCommand = MutableStateFlow<String?>(null)
    val lastCommand: StateFlow<String?> = _lastCommand
    
    // Exposed for UI to show
    val currentDeviceId = MutableStateFlow<String>("Loading...")

    fun init(context: Context) {
        prefsStore = PrefsStore(context)
        connect()
    }

    fun connect() {
        if (socket?.connected() == true) return
        
        scope.launch {
            val url = prefsStore?.backendUrlFlow?.first() ?: PrefsStore.DEFAULT_BACKEND_URL
            val deviceId = prefsStore?.getDeviceId() ?: "UNKNOWN"
            currentDeviceId.value = deviceId

            Log.d(TAG, "Connecting to $url with ID: $deviceId")

            try {
                val options = IO.Options().apply {
                    reconnection = true
                    forceNew = true
                    transports = arrayOf("websocket")
                }
                
                socket = IO.socket(URI.create(url), options)

                socket?.on(Socket.EVENT_CONNECT) {
                    Log.d(TAG, "Connected to $url")
                    _connectionState.value = "Connected"
                    registerScreen(deviceId)
                    startHeartbeat(deviceId)
                }

                socket?.on(Socket.EVENT_DISCONNECT) {
                    Log.d(TAG, "Disconnected")
                    _connectionState.value = "Disconnected"
                    stopHeartbeat()
                }

                socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                    val err = if (args.isNotEmpty()) args[0] else "Unknown"
                    Log.e(TAG, "Connection Error: $err")
                    _connectionState.value = "Error: $err"
                }

                socket?.on("command") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val command = data.optString("command")
                        Log.d(TAG, "Received command: $command")
                        _lastCommand.value = command
                        
                        // Handle REBOOT command (Simulated)
                        if (command == "REBOOT") {
                            // In real app: ProcessPhoenix.triggerRebirth(context)
                            _connectionState.value = "Rebooting..."
                        }
                    }
                }

                socket?.connect()

            } catch (e: Exception) {
                Log.e(TAG, "Error initializing socket", e)
                _connectionState.value = "Init Error: ${e.message}"
            }
        }
    }

    private fun registerScreen(deviceId: String) {
        socket?.emit("register-device", deviceId)
    }
    
    private fun startHeartbeat(deviceId: String) {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (true) {
                try {
                    val memory = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()
                    val payload = JSONObject().apply {
                        put("type", "HEARTBEAT")
                        put("payload", JSONObject().apply {
                            put("device_id", deviceId)
                            put("memory_usage", memory)
                            put("timestamp", System.currentTimeMillis())
                        })
                    }
                    socket?.emit("device-log", payload)
                    Log.v(TAG, "Sent Heartbeat")
                } catch (e: Exception) {
                    Log.e(TAG, "Heartbeat failed", e)
                }
                delay(60000) // 60 seconds
            }
        }
    }
    
    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
    }

    fun disconnect() {
        stopHeartbeat()
        socket?.disconnect()
        socket?.off()
    }
}
