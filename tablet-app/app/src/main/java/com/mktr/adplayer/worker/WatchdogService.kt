package com.mktr.adplayer.worker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.mktr.adplayer.MainActivity
import com.mktr.adplayer.R

/**
 * Foreground service that monitors and restarts MainActivity if it crashes.
 * This ensures the AdPlayer app stays running continuously for kiosk-mode operation.
 */
class WatchdogService : Service() {
    companion object {
        private const val TAG = "AdPlayer.Watchdog"
        private const val CHANNEL_ID = "adplayer_watchdog"
        private const val NOTIFICATION_ID = 1001
        private const val CHECK_INTERVAL_MS = 5000L // Check every 5 seconds
    }

    private val handler = Handler(Looper.getMainLooper())
    private var isRunning = false

    private val watchdogRunnable = object : Runnable {
        override fun run() {
            if (isRunning) {
                checkAndRestartIfNeeded()
                handler.postDelayed(this, CHECK_INTERVAL_MS)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "WatchdogService created")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "WatchdogService started")
        
        // Start as foreground service with notification
        startForeground(NOTIFICATION_ID, createNotification())
        
        // Start monitoring
        isRunning = true
        handler.post(watchdogRunnable)
        
        // Return START_STICKY so the service restarts if killed
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "WatchdogService destroyed")
        isRunning = false
        handler.removeCallbacks(watchdogRunnable)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AdPlayer Watchdog",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps AdPlayer running continuously"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AdPlayer Active")
            .setContentText("Keeping ads running in background")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun checkAndRestartIfNeeded() {
        if (!isMainActivityInForeground()) {
            Log.w(TAG, "MainActivity not in foreground - bringing to front...")
            restartMainActivity()
        }
    }

    /**
     * Check if MainActivity is currently visible in the foreground.
     * Returns false if:
     * - The activity was destroyed (back button)
     * - The activity went to background (home button)
     * - Another app is in front
     */
    private fun isMainActivityInForeground(): Boolean {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        
        // Check running tasks - only the TOP activity matters for kiosk mode
        val runningTasks = activityManager.getRunningTasks(1)
        if (runningTasks.isNotEmpty()) {
            val topActivity = runningTasks[0].topActivity
            if (topActivity?.className == MainActivity::class.java.name) {
                return true
            }
        }
        
        return false
    }

    private fun restartMainActivity() {
        try {
            val intent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(intent)
            Log.d(TAG, "MainActivity restarted successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to restart MainActivity: ${e.message}")
        }
    }
}
