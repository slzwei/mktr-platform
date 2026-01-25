package com.mktr.adplayer.sync

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import androidx.media3.exoplayer.ExoPlayer

class SyncUnitTest {

    @org.junit.Before
    fun setup() {
        io.mockk.mockkStatic(android.util.Log::class)
        every { android.util.Log.v(any(), any()) } returns 0
        every { android.util.Log.d(any(), any()) } returns 0
        every { android.util.Log.i(any(), any()) } returns 0
        every { android.util.Log.w(any(), any<String>()) } returns 0
        every { android.util.Log.w(any(), any<Throwable>()) } returns 0
        every { android.util.Log.e(any(), any()) } returns 0
        every { android.util.Log.e(any(), any(), any()) } returns 0
    }

    @Test
    fun `SyncPacket serialization and parsing`() {
        // Broadcaster creates packet
        val index = 5
        val position = 12345L
        val playing = true
        val version = "v1.5"
        val timestamp = System.currentTimeMillis()
        
        val jsonString = org.json.JSONObject().apply {
            put("type", "SYNC")
            put("idx", index)
            put("pos", position)
            put("playing", playing)
            put("ts", timestamp)
            put("version", version)
        }.toString()

        // Receiver parses packet
        val json = org.json.JSONObject(jsonString)
        assertEquals("SYNC", json.getString("type"))
        
        val packet = SyncPacket(
            mediaIndex = json.getInt("idx"),
            positionMs = json.getLong("pos"),
            isPlaying = json.getBoolean("playing"),
            timestamp = json.getLong("ts"),
            playlistVersion = json.getString("version"),
            receivedAt = timestamp + 50 // Simulated 50ms latency
        )

        assertEquals(index, packet.mediaIndex)
        assertEquals(position, packet.positionMs)
        assertEquals(playing, packet.isPlaying)
        assertEquals(version, packet.playlistVersion)
        
        // Verify latency calculation
        assertEquals(50L, packet.latencyMs)
        assertEquals(position + 50L, packet.adjustedPositionMs)
    }

    @Test
    fun `PlaybackSynchronizer - Master updates broadcaster`() {
        val broadcaster = mockk<SyncBroadcaster>(relaxed = true)
        val receiver = mockk<SyncReceiver>(relaxed = true)
        val player = mockk<ExoPlayer>(relaxed = true)
        
        val sync = PlaybackSynchronizer(broadcaster, receiver)
        sync.initialize("master", player, "v1")

        every { player.currentMediaItemIndex } returns 2
        every { player.currentPosition } returns 5000L
        every { player.isPlaying } returns true

        sync.updateBroadcasterState()

        verify { 
            broadcaster.updateState(
                mediaIndex = 2,
                positionMs = 5000L,
                playing = true,
                version = "v1"
            )
        }
    }
}
