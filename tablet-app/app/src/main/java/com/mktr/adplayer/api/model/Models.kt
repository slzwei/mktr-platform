package com.mktr.adplayer.api.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ManifestResponse(
    val version: Int,
    @SerialName("device_id") val deviceId: String,
    @SerialName("refresh_seconds") val refreshSeconds: Long = 300,
    val assets: List<Asset> = emptyList(),
    val playlist: List<PlaylistItem> = emptyList(),
    val role: String = "standalone", // master, slave, standalone
    @SerialName("vehicle_id") val vehicleId: String? = null,
    @SerialName("vehicle_wifi") val vehicleWifi: WifiCredentials? = null
)

@Serializable
data class WifiCredentials(
    val ssid: String? = null,
    val password: String? = null
)

@Serializable
data class Asset(
    val id: String,
    val url: String,
    @SerialName("sha256") val hash: String,
    @SerialName("size_bytes") val sizeBytes: Long
)

@Serializable
data class PlaylistItem(
    val id: String,
    @SerialName("asset_id") val assetId: String,
    @SerialName("campaign_id") val campaignId: String? = null,
    @SerialName("duration_ms") val durationMs: Long,
    val type: String // "image" | "video"
)

@Serializable
data class BeaconHeartbeatRequest(
    val status: String,
    @SerialName("battery_level") val batteryLevel: Float? = null,
    @SerialName("storage_used") val storageUsed: String? = null,
    @SerialName("latitude") val latitude: Double? = null,
    @SerialName("longitude") val longitude: Double? = null
)

@Serializable
data class BeaconImpressionRequest(
    val impressions: List<ImpressionItem>
)

@Serializable
data class ImpressionItem(
    @SerialName("adId") val adId: String,
    @SerialName("campaignId") val campaignId: String?,
    @SerialName("mediaType") val mediaType: String,
    @SerialName("occurredAt") val occurredAt: String, // ISO8601
    @SerialName("durationMs") val durationMs: Long
)
