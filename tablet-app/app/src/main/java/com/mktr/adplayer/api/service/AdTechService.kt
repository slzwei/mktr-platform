package com.mktr.adplayer.api.service

import com.mktr.adplayer.api.model.BeaconHeartbeatRequest
import com.mktr.adplayer.api.model.BeaconImpressionRequest
import com.mktr.adplayer.api.model.ManifestResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface AdTechService {

    @GET("adtech/v1/manifest")
    suspend fun getManifest(
        @Header("If-None-Match") etag: String? = null
    ): Response<ManifestResponse>

    @POST("adtech/v1/beacons/heartbeat")
    suspend fun sendHeartbeat(
        @Body body: BeaconHeartbeatRequest
    ): Response<Unit>

    @POST("adtech/v1/beacons/impressions")
    suspend fun sendImpressions(
        @Body body: BeaconImpressionRequest
    ): Response<Unit>
}
