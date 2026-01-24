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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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

    companion object {
        // Dynamic URL from build config (removes hardcoded prod URL)
        private val BASE_URL = "${BuildConfig.API_BASE_URL}devices/events".replace("api//", "api/") 
        private const val MAX_RETRY_DELAY_MS = 30000L
    }

    fun start(key: String, onMessage: (type: String, data: String) -> Unit) {
        Log.i("SseService", ">>> start() called with key: ${key.take(8)}... | isConnected=$isConnected | deviceKey=${deviceKey?.take(8) ?: "null"}")
        
        if (isConnected && deviceKey == key) {
            Log.d("SseService", "Already connected with same key - skipping")
            return
        }
        
        Log.d("SseService", "Starting SSE connection...")
        deviceKey = key
        onMessageCallback = onMessage
        reconnectAttempts = 0
        connect()
    }

    fun stop() {
        Log.d("SseService", "Stopping SSE connection")
        eventSource?.cancel()
        eventSource = null
        isConnected = false
        deviceKey = null
    }

    private fun connect() {
        if (deviceKey == null) {
            Log.e("SseService", "connect() called but deviceKey is null!")
            return
        }

        Log.i("SseService", ">>> connect() - URL: $BASE_URL | Key: ${deviceKey?.take(8)}...")

        val request = Request.Builder()
            .url(BASE_URL)
            .header("x-device-key", deviceKey!!)
            .header("Accept", "text/event-stream")
            .build()

        val factory = EventSources.createFactory(okHttpClient)
        
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                Log.i("SseService", ">>> SSE CONNECTED! Response: ${response.code}")
                isConnected = true
                reconnectAttempts = 0
                // Force refresh on any new connection (covers app start and reconnection)
                Log.d("SseService", "Invoking CONNECTED callback...")
                onMessageCallback?.invoke("CONNECTED", "{}")
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                Log.i("SseService", ">>> SSE EVENT RECEIVED: type=$type")
                if (type != null) {
                    Log.d("SseService", "Invoking callback with type=$type")
                    onMessageCallback?.invoke(type, data)
                }
            }

            override fun onClosed(eventSource: EventSource) {
                Log.w("SseService", ">>> SSE CLOSED")
                isConnected = false
                scheduleReconnect()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                Log.e("SseService", ">>> SSE FAILURE: ${t?.message} | Response: ${response?.code}")
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

        Log.d("SseService", "Scheduling reconnect in ${totalDelay}ms (Attempt #${reconnectAttempts + 1})")
        
        CoroutineScope(Dispatchers.IO).launch {
            delay(totalDelay)
            reconnectAttempts++
            connect()
        }
    }
}
