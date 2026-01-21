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
        // Drain the in-memory buffer
        val pendingImpressions = impressionManager.drainBuffer()

        if (pendingImpressions.isEmpty()) {
            Log.d("ImpressionWorker", "No impressions to sync.")
            return Result.success()
        }

        return try {
            Log.d("ImpressionWorker", "Syncing ${pendingImpressions.size} impressions...")
            
            val request = BeaconImpressionRequest(impressions = pendingImpressions)
            val response = api.sendImpressions(request)

            if (response.isSuccessful) {
                Log.d("ImpressionWorker", "Sync success for ${pendingImpressions.size} items")
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
