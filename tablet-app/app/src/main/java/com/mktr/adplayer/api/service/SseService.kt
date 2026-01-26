package com.mktr.adplayer.api.service

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.min
import kotlin.math.pow

import com.mktr.adplayer.BuildConfig

@Singleton
class SseService @Inject constructor(
    @javax.inject.Named("SseClient") private val okHttpClient: OkHttpClient
) {
    private var eventSource: EventSource? = null
    private var isConnected = false
    private var reconnectAttempts = 0
    private var deviceKey: String? = null
    private var onMessageCallback: ((String, String) -> Unit)? = null
    
    // [Sync V5] Use Flow for event distribution
    private val _eventFlow = kotlinx.coroutines.flow.MutableSharedFlow<SseEvent>(
        replay = 0, 
        extraBufferCapacity = 10,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST
    )
    val eventFlow = _eventFlow.asSharedFlow()

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    // Connection activity tracking
    private var lastActivityTimestamp = 0L
    private var watchdogJob: Job? = null

    companion object {
        private const val TAG = "SseService"
        // Dynamic URL from build config (removes hardcoded prod URL)
        private val BASE_URL = "${BuildConfig.API_BASE_URL}devices/events".replace("api//", "api/") 
        private const val MAX_RETRY_DELAY_MS = 30000L
        
        // [FIX] 45s timeout detects stale connections before Render's ~60s proxy kills them
        private const val ACTIVITY_TIMEOUT_MS = 45000L
        private const val WATCHDOG_CHECK_INTERVAL_MS = 15000L
    }

    fun start(key: String, onMessage: (type: String, data: String) -> Unit) {
        if (isConnected && deviceKey == key) return
        
        Log.d(TAG, "Starting SSE connection...")
        deviceKey = key
        onMessageCallback = onMessage
        reconnectAttempts = 0
        connect()
        startWatchdog()
    }

    fun stop() {
        Log.d(TAG, "Stopping SSE connection")
        stopWatchdog()
        eventSource?.cancel()
        eventSource = null
        isConnected = false
        deviceKey = null
    }

    private fun connect() {
        if (deviceKey == null) return

        val request = Request.Builder()
            .url(BASE_URL)
            .header("x-device-key", deviceKey!!)
            .header("Accept", "text/event-stream")
            .build()

        val factory = EventSources.createFactory(okHttpClient)
        
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                Log.d(TAG, "SSE Connected")
                isConnected = true
                reconnectAttempts = 0
                lastActivityTimestamp = System.currentTimeMillis()
                onMessageCallback?.invoke("CONNECTED", "{}")
                
                // Emit Connected event
                CoroutineScope(Dispatchers.IO).launch {
                    _eventFlow.emit(SseEvent.Connected) 
                }
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (type == "heartbeat") {
                    Log.v(TAG, "SSE Heartbeat received")
                } else {
                    Log.d(TAG, "SSE Event: $type")
                }
                lastActivityTimestamp = System.currentTimeMillis()
                
                if (type != null) {
                    onMessageCallback?.invoke(type, data)
                    
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            if (type == "play_video") {
                                val payload = json.decodeFromString<PlayVideoPayload>(data)
                                _eventFlow.emit(SseEvent.PlayVideo(payload))
                            } else {
                                _eventFlow.emit(SseEvent.Raw(type, data))
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to parse SSE event: $type", e)
                        }
                    }
                }
            }

            override fun onClosed(eventSource: EventSource) {
                Log.d(TAG, "SSE Closed")
                isConnected = false
                scheduleReconnect()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                Log.e(TAG, "SSE Failure: ${t?.message}")
                isConnected = false
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (deviceKey == null) return

        val delayMs = (2.0.pow(reconnectAttempts.toDouble()) * 1000).toLong()
            .coerceAtMost(MAX_RETRY_DELAY_MS)
        
        // Add Jitter
        val jitter = (Math.random() * 2000).toLong()
        val totalDelay = delayMs + jitter

        Log.d(TAG, "Scheduling reconnect in ${totalDelay}ms (Attempt #${reconnectAttempts + 1})")
        
        CoroutineScope(Dispatchers.IO).launch {
            delay(totalDelay)
            reconnectAttempts++
            connect()
        }
    }

    /**
     * Watchdog timer that checks for connection activity.
     * If no data (including heartbeats) is received within ACTIVITY_TIMEOUT_MS,
     * force a reconnection to recover from silently dropped connections.
     */
    private fun startWatchdog() {
        stopWatchdog()
        lastActivityTimestamp = System.currentTimeMillis()
        
        watchdogJob = CoroutineScope(Dispatchers.IO).launch {
            while (isActive && deviceKey != null) {
                delay(WATCHDOG_CHECK_INTERVAL_MS)
                
                val elapsed = System.currentTimeMillis() - lastActivityTimestamp
                if (elapsed > ACTIVITY_TIMEOUT_MS) {
                    Log.w(TAG, "SSE Connection stale (no activity for ${elapsed}ms) - forcing reconnect")
                    
                    // Cancel current connection and reconnect
                    eventSource?.cancel()
                    isConnected = false
                    reconnectAttempts = 0 // Reset because this is a watchdog recovery, not a failure
                    connect()
                    lastActivityTimestamp = System.currentTimeMillis()
                } else if (isConnected) {
                    Log.d(TAG, "SSE Watchdog: Connection healthy (last activity ${elapsed}ms ago)")
                }
            }
        }
        Log.d(TAG, "SSE Watchdog started")
    }

    private fun stopWatchdog() {
        watchdogJob?.cancel()
        watchdogJob = null
    }
}

sealed class SseEvent {
    object Connected : SseEvent()
    data class PlayVideo(val payload: PlayVideoPayload) : SseEvent()
    data class Raw(val type: String, val data: String) : SseEvent()
}

@kotlinx.serialization.Serializable
data class PlayVideoPayload(
    val video_index: Int,
    val start_at_unix_ms: Long,
    val playlist_version: Int,
    val sequence: Long = 0
)

