package com.mktr.adplayer.data.manager

import com.mktr.adplayer.api.model.ImpressionItem
import java.util.Collections
import java.util.concurrent.ConcurrentLinkedQueue
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ImpressionManager @Inject constructor() {
    // Thread-safe queue for buffering impressions
    private val buffer = ConcurrentLinkedQueue<ImpressionItem>()

    fun trackImpression(adId: String, campaignId: String?, mediaType: String, durationMs: Long) {
        val now = java.time.Instant.now().toString()
        val item = ImpressionItem(
            adId = adId,
            campaignId = campaignId,
            mediaType = mediaType,
            occurredAt = now,
            durationMs = durationMs
        )
        buffer.add(item)
    }

    fun drainBuffer(): List<ImpressionItem> {
        val snapshot = mutableListOf<ImpressionItem>()
        // Drain entire queue
        while (true) {
            val item = buffer.poll() ?: break
            snapshot.add(item)
        }
        return snapshot
    }

    fun requeue(items: List<ImpressionItem>) {
        buffer.addAll(items)
    }
}
