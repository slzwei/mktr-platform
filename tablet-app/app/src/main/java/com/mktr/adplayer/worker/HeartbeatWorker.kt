package com.mktr.adplayer.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.mktr.adplayer.api.model.BeaconHeartbeatRequest
import com.mktr.adplayer.api.service.AdTechService
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val api: AdTechService
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            // TODO: Retrieve actual battery level if permissible
            val request = BeaconHeartbeatRequest(
                status = "active",
                batteryLevel = null
            )
            
            Log.d("HeartbeatWorker", "Sending heartbeat...")
            val response = api.sendHeartbeat(request)

            if (response.isSuccessful) {
                Log.d("HeartbeatWorker", "Heartbeat success")
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
