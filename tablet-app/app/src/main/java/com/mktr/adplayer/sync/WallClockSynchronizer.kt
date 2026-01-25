package com.mktr.adplayer.sync

import android.util.Log
import com.mktr.adplayer.api.model.PlaylistItem
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max

/**
 * WallClockSynchronizer - Deterministic playback scheduler based on System Time.
 * 
 * Instead of Master/Slave communication, every tablet calculates exactly
 * what frame it should be displaying at this millisecond based on the
 * Wall Clock (System.currentTimeMillis()).
 * 
 * Prerequisites:
 * - Devices must have synchronized clocks (Automatic Date/Time via Network).
 * - Playlist items must have fixed durations.
 */
@Singleton
class WallClockSynchronizer @Inject constructor() {

    companion object {
        private const val TAG = "WallClockSync"
    }

    data class SyncState(
        val mediaIndex: Int,
        val seekPositionMs: Long,
        val shouldBePlaying: Boolean,
        val playlistVersion: String
    )

    /**
     * Calculate the expected playback state for a given playlist at the current moment.
     */
    fun getTargetState(playlist: List<PlaylistItem>, version: String): SyncState {
        if (playlist.isEmpty()) {
            return SyncState(0, 0L, false, version)
        }

        // 1. Calculate Total Loop Duration
        // Use a safe cumulative sum to avoid overflow (though unlikely for playlists)
        var totalLoopDurationMs = 0L
        val startTimes = LongArray(playlist.size)

        playlist.forEachIndexed { index, item ->
            startTimes[index] = totalLoopDurationMs
            // Ensure valid duration (fallback to 5s if missing/zero to prevent loops)
            val duration = if (item.durationMs > 0) item.durationMs else 5000L
            totalLoopDurationMs += duration
        }

        if (totalLoopDurationMs == 0L) {
             return SyncState(0, 0L, false, version)
        }

        // 2. Get Current Wall Clock Time
        val now = System.currentTimeMillis()

        // 3. Find Position in Loop
        val positionInLoop = now % totalLoopDurationMs

        // 4. Find which item covers this position
        // We iterate backwards or use binary search, but linear is fine for <100 items
        var targetIndex = 0
        var itemStartTime = 0L
        
        for (i in playlist.indices) {
            val nextStartTime = if (i == playlist.lastIndex) totalLoopDurationMs else startTimes[i + 1]
            
            if (positionInLoop >= startTimes[i] && positionInLoop < nextStartTime) {
                targetIndex = i
                itemStartTime = startTimes[i]
                break
            }
        }

        // 5. Calculate Offset into that item
        val seekPos = positionInLoop - itemStartTime

        return SyncState(
            mediaIndex = targetIndex,
            seekPositionMs = seekPos,
            shouldBePlaying = true,
            playlistVersion = version
        )
    }
}
