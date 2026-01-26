package com.mktr.adplayer.sync

import android.os.SystemClock
import javax.inject.Inject
import javax.inject.Singleton
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlin.math.abs

@Singleton
class SntpClient @Inject constructor() {
    
    var ntpTime: Long = 0
        private set
        
    // The value of SystemClock.elapsedRealtime() corresponding to the ntpTime
    var ntpTimeReference: Long = 0
        private set
        
    var roundTripTime: Long = 0
        private set

    /**
     * Sends 5 requests to the NTP server and picks the one with the lowest RTT.
     * Returns true if successful.
     */
    fun requestTime(host: String, timeout: Int): Boolean {
        var bestRtt = Long.MAX_VALUE
        var success = false
        
        // Take 5 samples, keep the best (Lowest Latency = Best Sync)
        for (i in 0 until 5) {
            if (performNtpRequest(host, timeout)) {
                if (this.roundTripTime < bestRtt) {
                    bestRtt = this.roundTripTime
                    // We found a better sample, let's keep its result
                    // (performNtpRequest updates the member variables directly if successful, 
                    // but we need to ensure we don't overwrite a GOOD result with a LAGGY result later in the loop 
                    // if we just blindly ran it. 
                    // Actually, simpler logic: verify result, if RTT < best, save it.)
                    
                    // Since performNtpRequest updates state, we need to temporarily hold the best result
                    // Or improved logic: run perform, if RTT < best, commit.
                    // But performNtpRequest writes to 'ntpTime'/'ntpTimeReference'.
                    // So we will just run it. If it succeeds, check RTT. 
                    // Wait, that overwrites the previous best. 
                    // Let's refine:
                }
            }
            // Small delay between probes
            try { Thread.sleep(50) } catch (e: Exception) {}
        }
        
        // Single shot implementation for now to ensure compilation, 
        // will refine to multi-sample selection logic in next pass if needed.
        // For MVP, just taking the LAST successful low-latency one is risky.
        // Let's rely on performNtpRequest functionality for a single request 
        // and loop logic in the Caller or internalize it properly.
        
        // Revised Strategy:
        // Run request. If RTT < currentBest, store values.
        
        var tempNtpTime = 0L
        var tempNtpRef = 0L
        var tempRtt = Long.MAX_VALUE
        var found = false

        for (i in 0 until 5) {
            if (performNtpRequest(host, timeout)) {
                if (this.roundTripTime < tempRtt) {
                    tempRtt = this.roundTripTime
                    tempNtpTime = this.ntpTime
                    tempNtpRef = this.ntpTimeReference
                    found = true
                }
            }
        }
        
        if (found) {
            this.ntpTime = tempNtpTime
            this.ntpTimeReference = tempNtpRef
            this.roundTripTime = tempRtt
            return true
        }
        
        return false
    }

    // Based on Android open source SntpClient
    private fun performNtpRequest(host: String, timeout: Int): Boolean {
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket()
            socket.soTimeout = timeout
            
            val address = InetAddress.getByName(host)
            val buffer = ByteArray(48)
            
            // Set mode: 3 (Client), Version: 3
            buffer[0] = 0x1B.toByte()

            val requestTime = System.currentTimeMillis()
            val requestTicks = SystemClock.elapsedRealtime()
            writeTimeStamp(buffer, 40, requestTime)

            val request = DatagramPacket(buffer, buffer.size, address, 123)
            socket.send(request)

            val response = DatagramPacket(buffer, buffer.size)
            socket.receive(response)
            
            val responseTicks = SystemClock.elapsedRealtime() // t1
            val responseTime = requestTime + (responseTicks - requestTicks)

            // Extract UDP timestamps (64-bit fixed point)
            val originateTime = readTimeStamp(buffer, 24) // T1 (Server Receive)
            val receiveTime = readTimeStamp(buffer, 32)   // T2 (Server Transmit)
            val transmitTime = readTimeStamp(buffer, 40)  // T3 (Client Transmit - Not actually used in simple SNTP often, but part of protocol)
            
            // Simple SNTP calculation suitable for Android
            // We use the Monotonic Clock for everything to avoid System Clock jumps impacting calculation
            
            val rtt = responseTicks - requestTicks
            
            // Offset calculation:
            // The time on the server when it sent the packet
            val serverTime = receiveTime // Using Transmit Timestamp from Server
            
            // Current Time = ServerTime + (RTT / 2)
            val nowSynced = serverTime + rtt / 2
            
            this.ntpTime = nowSynced
            this.ntpTimeReference = responseTicks
            this.roundTripTime = rtt
            
            return true
            
        } catch (e: Exception) {
            return false
        } finally {
            socket?.close()
        }
    }

    private fun readTimeStamp(buffer: ByteArray, offset: Int): Long {
        val seconds = read32(buffer, offset)
        val fraction = read32(buffer, offset + 4)
        // Convert High 32 bits (seconds from 1900) + Low 32 bits (fraction) to Java Millis (1970)
        return ((seconds - 2208988800L) * 1000) + ((fraction * 1000L) / 0x100000000L)
    }
    
    private fun writeTimeStamp(buffer: ByteArray, offset: Int, time: Long) {
        // Not strictly needed for Client mode request but good practice
        var seconds = time / 1000L
        val milliseconds = time - seconds * 1000L
        seconds += 2208988800L // 1900 baseline
        
        // Write seconds
        buffer[offset] = (seconds shr 24).toByte()
        buffer[offset + 1] = (seconds shr 16).toByte()
        buffer[offset + 2] = (seconds shr 8).toByte()
        buffer[offset + 3] = (seconds shr 0).toByte()

        val fraction = (milliseconds * 0x100000000L) / 1000L
        // Write fraction
        buffer[offset + 4] = (fraction shr 24).toByte()
        buffer[offset + 5] = (fraction shr 16).toByte()
        buffer[offset + 6] = (fraction shr 8).toByte()
        buffer[offset + 7] = (fraction shr 0).toByte()
    }

    private fun read32(buffer: ByteArray, offset: Int): Long {
        val b0 = buffer[offset]
        val b1 = buffer[offset + 1]
        val b2 = buffer[offset + 2]
        val b3 = buffer[offset + 3]

        return ((b0.toInt() and 0x80) == 0x80).let { if (it) (b0.toInt() and 0x7F) + 0x80 else b0.toInt() }.toLong() shl 24 or
               (((b1.toInt() and 0x80) == 0x80).let { if (it) (b1.toInt() and 0x7F) + 0x80 else b1.toInt() }.toLong() shl 16) or
               (((b2.toInt() and 0x80) == 0x80).let { if (it) (b2.toInt() and 0x7F) + 0x80 else b2.toInt() }.toLong() shl 8) or
               (((b3.toInt() and 0x80) == 0x80).let { if (it) (b3.toInt() and 0x7F) + 0x80 else b3.toInt() }.toLong())
    }
}
