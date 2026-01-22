package com.mktr.adplayer.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.mktr.adplayer.api.model.BeaconImpressionRequest
import com.mktr.adplayer.api.service.AdTechService
import com.mktr.adplayer.data.manager.ImpressionManager
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class ImpressionWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val api: AdTechService,
    private val impressionManager: ImpressionManager
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        // Defense in Depth: Check status first
        val prefs = applicationContext.getSharedPreferences("adplayer_prefs", Context.MODE_PRIVATE)
        val appStatus = prefs.getString("app_status", "active") ?: "active"

        // Drain the in-memory buffer
        val pendingImpressions = impressionManager.drainBuffer()

        if (pendingImpressions.isEmpty()) {
            Log.d("ImpressionWorker", "No impressions to sync.")
            
            // Keep the loop alive even if empty - BUT ONLY IF ACTIVE
            if (appStatus != "background" && appStatus != "offline") {
                val nextRequest = androidx.work.OneTimeWorkRequestBuilder<ImpressionWorker>()
                    .setInitialDelay(2, java.util.concurrent.TimeUnit.MINUTES)
                    .build()
                    
                androidx.work.WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                    "ImpressionWorker",
                    androidx.work.ExistingWorkPolicy.REPLACE,
                    nextRequest
                )
            } else {
                Log.d("ImpressionWorker", "App is $appStatus - stopping recursive sync.")
            }
            
            return Result.success()
        }

        return try {
            Log.d("ImpressionWorker", "Syncing ${pendingImpressions.size} impressions...")
            
            val request = BeaconImpressionRequest(impressions = pendingImpressions)
            val response = api.sendImpressions(request)

            if (response.isSuccessful) {
                Log.d("ImpressionWorker", "Sync success for ${pendingImpressions.size} items")
                
                // Reschedule next sync (2 mins) - ONLY IF ACTIVE
                if (appStatus != "background" && appStatus != "offline") {
                    // Recursive OneTimeWork pattern since powered by cable
                    val nextRequest = androidx.work.OneTimeWorkRequestBuilder<ImpressionWorker>()
                        .setInitialDelay(2, java.util.concurrent.TimeUnit.MINUTES)
                        .build()
                        
                    androidx.work.WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                        "ImpressionWorker",
                        androidx.work.ExistingWorkPolicy.REPLACE,
                        nextRequest
                    )
                } else {
                    Log.d("ImpressionWorker", "App is $appStatus - stopping recursive sync.")
                }

                Result.success()
            } else {
                Log.e("ImpressionWorker", "Sync failed: ${response.code()}. Re-queuing items.")
                // Restore items to buffer (simple retry strategy)
                impressionManager.requeue(pendingImpressions)
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e("ImpressionWorker", "Sync error", e)
            impressionManager.requeue(pendingImpressions)
            Result.retry()
        }
    }
}
