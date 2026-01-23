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

    @POST("provision/session")
    suspend fun createProvisioningSession(
        @Body body: com.mktr.adplayer.api.model.ProvisioningSessionRequest
    ): Response<com.mktr.adplayer.api.model.ProvisioningSessionResponse>

    @GET("provision/check/{code}")
    suspend fun checkProvisioningStatus(
        @retrofit2.http.Path("code") code: String
    ): Response<com.mktr.adplayer.api.model.ProvisioningCheckResponse>
}

