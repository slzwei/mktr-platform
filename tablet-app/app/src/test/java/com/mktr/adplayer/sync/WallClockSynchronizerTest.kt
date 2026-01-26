package com.mktr.adplayer.sync

import com.mktr.adplayer.api.model.PlaylistItem
import org.junit.Assert.assertEquals
import org.junit.Test

class WallClockSynchronizerTest {

    // MockK TimeProvider
    private val timeProvider = io.mockk.mockk<TimeProvider>(relaxed = true)
    private val synchronizer = WallClockSynchronizer(timeProvider)

    @Test
    fun `getTargetState calculates correct index and position using Sync V4`() {
        val playlist = listOf(
            createItem("1", 5000),  // 0-5000ms
            createItem("2", 10000), // 5000-15000ms
            createItem("3", 5000)   // 15000-20000ms
        )
        // Total Duration = 20000ms
        
        // [Sync V4] Position = now % totalDuration
        
        // Scenario 1: 2000ms into the loop (Item 1)
        // 2000 % 20000 = 2000 -> Item 1 @ 2000ms
        io.mockk.every { timeProvider.nowSyncedUnixMs() } returns 2000L
        val state1 = synchronizer.getTargetState(playlist, "v1")
        
        assertEquals(0, state1.mediaIndex)
        assertEquals(2000L, state1.seekPositionMs)
        assertEquals("v1", state1.playlistVersion)
        
        // Scenario 2: 10000ms into the loop (Item 2)
        // 10000 % 20000 = 10000 -> Item 2 @ 5000ms offset (since Item 2 starts at 5000)
        io.mockk.every { timeProvider.nowSyncedUnixMs() } returns 10000L
        val state2 = synchronizer.getTargetState(playlist, "v1")
        
        assertEquals(1, state2.mediaIndex)
        assertEquals(5000L, state2.seekPositionMs)

        // Scenario 3: 21000ms (Looped - 1 full loop + 1000ms)
        // 21000 % 20000 = 1000 -> Item 1 @ 1000ms
        io.mockk.every { timeProvider.nowSyncedUnixMs() } returns 21000L
        val state3 = synchronizer.getTargetState(playlist, "v1")
        
        assertEquals(0, state3.mediaIndex)
        assertEquals(1000L, state3.seekPositionMs)
    }

    private fun createItem(id: String, duration: Long): PlaylistItem {
        return PlaylistItem(
            id = id,
            assetId = "asset_$id",
            campaignId = "camp_$id",
            durationMs = duration,
            type = "video"
        )
    }
}
