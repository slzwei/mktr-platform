package com.mktr.adplayer.sync

import android.util.Log
import com.mktr.adplayer.api.model.PlaylistItem
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max

/**
 * WallClockSynchronizer - Deterministic playback scheduler (Sync V4: Pure NTP).
 * 
 * All tablets sync to Google NTP (time.google.com) and calculate their
 * playlist position as: nowSyncedUnixMs() % totalLoopDuration.
 * No server time or session start is needed.
 */
@Singleton
class WallClockSynchronizer @Inject constructor(
    private val timeProvider: TimeProvider
) {

    companion object {
        private const val TAG = "WallClockSync"
    }

    data class SyncState(
        val mediaIndex: Int,
        val seekPositionMs: Long,
        val shouldBePlaying: Boolean,
        val playlistVersion: String,
        val serverTimeMs: Long // For debug overlays (actually NTP time now)
    )

    /**
     * Calculate the expected playback state for a given playlist at the current moment.
     * [Sync V4] Uses NTP-synced time and calculates position as: now % totalDuration.
     */
    fun getTargetState(
        playlist: List<PlaylistItem>, 
        version: String
    ): SyncState {
        val nowSynced = timeProvider.nowSyncedUnixMs()
        
        if (playlist.isEmpty()) {
            return SyncState(0, 0L, false, version, nowSynced)
        }

        // 1. Calculate Total Loop Duration
        var totalLoopDurationMs = 0L
        val startTimes = LongArray(playlist.size)

        playlist.forEachIndexed { index, item ->
            startTimes[index] = totalLoopDurationMs
            val duration = if (item.durationMs > 0) item.durationMs else 5000L
            totalLoopDurationMs += duration
        }

        if (totalLoopDurationMs == 0L) {
             return SyncState(0, 0L, false, version, nowSynced)
        }

        // 2. [Sync V4] Position = now % total (Simple. Elegant. Works.)
        val positionInLoop = nowSynced % totalLoopDurationMs

        // 3. Find which item covers this position
        var targetIndex = 0
        var itemStartTime = 0L
        
        for (i in playlist.indices) {
            val startTime = startTimes[i]
            val duration = if (playlist[i].durationMs > 0) playlist[i].durationMs else 5000L
            val endTime = startTime + duration
            
            if (positionInLoop >= startTime && positionInLoop < endTime) {
                targetIndex = i
                itemStartTime = startTime
                break
            }
        }

        // 4. Calculate Offset into that item
        val seekPos = positionInLoop - itemStartTime

        return SyncState(
            mediaIndex = targetIndex,
            seekPositionMs = seekPos,
            shouldBePlaying = true,
            playlistVersion = version,
            serverTimeMs = nowSynced
        )
    }
}
