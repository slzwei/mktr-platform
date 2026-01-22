package com.mktr.adplayer

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class AdPlayerApp : Application(), Configuration.Provider, androidx.lifecycle.LifecycleEventObserver {
    
    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()
            
    override fun onCreate() {
        super.onCreate()
        
        // Reset status to IDLE on fresh launch
        getSharedPreferences("adplayer_prefs", MODE_PRIVATE)
            .edit()
            .putString("app_status", "idle")
            .apply()

        // Observe process lifecycle (Foreground/Background)
        androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    override fun onStateChanged(source: androidx.lifecycle.LifecycleOwner, event: androidx.lifecycle.Lifecycle.Event) {
        when (event) {
            androidx.lifecycle.Lifecycle.Event.ON_START -> {
                android.util.Log.d("AdPlayerApp", "App Foreground: Scheduling Workers")
                scheduleWorkers()
            }
            androidx.lifecycle.Lifecycle.Event.ON_STOP -> {
                android.util.Log.d("AdPlayerApp", "App Background: Cancelling Heartbeat")
                androidx.work.WorkManager.getInstance(this).cancelUniqueWork("HeartbeatWorker")
            }
            else -> {}
        }
    }
    
    private fun scheduleWorkers() {
        val workManager = androidx.work.WorkManager.getInstance(this)
        
        // 1. Heartbeat (Every 2 mins - using recursive OneTimeWork)
        // Note: PeriodicWorkRequest has 15m min, so we chain OneTimeWork requests in the worker itself.
        val heartbeatRequest = androidx.work.OneTimeWorkRequestBuilder<com.mktr.adplayer.worker.HeartbeatWorker>()
            .build()
        
        workManager.enqueueUniqueWork(
            "HeartbeatWorker",
            androidx.work.ExistingWorkPolicy.REPLACE,
            heartbeatRequest
        )
        
        // 2. Impression Sync (Every 2 mins - using recursive OneTimeWork)
        // High frequency sync since device is cable powered.
        val impressionRequest = androidx.work.OneTimeWorkRequestBuilder<com.mktr.adplayer.worker.ImpressionWorker>()
            .build()
        
        workManager.enqueueUniqueWork(
            "ImpressionWorker",
            androidx.work.ExistingWorkPolicy.REPLACE,
            impressionRequest
        )
    }
}
