package com.mktr.adplayer.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.mktr.adplayer.api.model.BeaconHeartbeatRequest
import com.mktr.adplayer.data.manager.ImpressionManager
import com.mktr.adplayer.api.service.AdTechService
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val api: AdTechService,
    private val impressionManager: ImpressionManager
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            // Report Buffer Size and Status
            val bufferSize = impressionManager.getBufferSize()
            val prefs = applicationContext.getSharedPreferences("adplayer_prefs", Context.MODE_PRIVATE)
            val appStatus = prefs.getString("app_status", "active") ?: "active"
            
            val request = BeaconHeartbeatRequest(
                status = appStatus,
                batteryLevel = null,
                storageUsed = "Buffer: $bufferSize"
            )
            
            Log.d("HeartbeatWorker", "Sending heartbeat...")
            val response = api.sendHeartbeat(request)

            if (response.isSuccessful) {
                Log.d("HeartbeatWorker", "Heartbeat success")
                
                // Reschedule next heartbeat (2 mins)
                // Recursive OneTimeWork pattern to bypass 15m Periodic minimum
                val nextRequest = androidx.work.OneTimeWorkRequestBuilder<HeartbeatWorker>()
                    .setInitialDelay(2, java.util.concurrent.TimeUnit.MINUTES)
                    .build()
                    
                androidx.work.WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                    "HeartbeatWorker",
                    androidx.work.ExistingWorkPolicy.REPLACE,
                    nextRequest
                )

                Result.success()
            } else {
                Log.e("HeartbeatWorker", "Heartbeat failed: ${response.code()}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e("HeartbeatWorker", "Heartbeat error", e)
            Result.retry()
        }
    }
}
