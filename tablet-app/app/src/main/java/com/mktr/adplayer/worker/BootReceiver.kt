package com.mktr.adplayer.worker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.mktr.adplayer.MainActivity

/**
 * BroadcastReceiver that starts the AdPlayer app after device boot.
 * This enables kiosk-mode behavior where the app auto-starts on reboot.
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "AdPlayer.BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d(TAG, "Boot completed - launching AdPlayer app")
            
            // Start the WatchdogService first (it will keep running even if MainActivity crashes)
            startWatchdogService(context)
            
            // Launch MainActivity
            launchMainActivity(context)
        }
    }

    private fun startWatchdogService(context: Context) {
        try {
            val serviceIntent = Intent(context, WatchdogService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            Log.d(TAG, "WatchdogService started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start WatchdogService: ${e.message}")
        }
    }

    private fun launchMainActivity(context: Context) {
        try {
            val activityIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(activityIntent)
            Log.d(TAG, "MainActivity launched")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch MainActivity: ${e.message}")
        }
    }
}
