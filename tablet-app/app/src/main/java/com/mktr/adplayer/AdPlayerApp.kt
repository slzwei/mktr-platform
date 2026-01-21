package com.mktr.adplayer

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class AdPlayerApp : Application(), Configuration.Provider {
    
    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()
            
    override fun onCreate() {
        super.onCreate()
        scheduleWorkers()
    }
    
    private fun scheduleWorkers() {
        val workManager = androidx.work.WorkManager.getInstance(this)
        
        // 1. Heartbeat (Every 15 mins - Android Min)
        val heartbeatRequest = androidx.work.PeriodicWorkRequestBuilder<com.mktr.adplayer.worker.HeartbeatWorker>(
            15, java.util.concurrent.TimeUnit.MINUTES
        ).build()
        
        workManager.enqueueUniquePeriodicWork(
            "HeartbeatWorker",
            androidx.work.ExistingPeriodicWorkPolicy.KEEP,
            heartbeatRequest
        )
        
        // 2. Impression Sync (Every 15 mins - Android Min)
        // For lower latency, we'd need a different mechanism (e.g. self-scheduling OneTimeWork), 
        // but 15m is fine for MVP analytics.
        val impressionRequest = androidx.work.PeriodicWorkRequestBuilder<com.mktr.adplayer.worker.ImpressionWorker>(
            15, java.util.concurrent.TimeUnit.MINUTES
        ).build()
        
        workManager.enqueueUniquePeriodicWork(
            "ImpressionWorker",
            androidx.work.ExistingPeriodicWorkPolicy.KEEP,
            impressionRequest
        )
    }
}
