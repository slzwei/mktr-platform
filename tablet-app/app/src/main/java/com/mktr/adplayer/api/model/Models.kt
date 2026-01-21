package com.mktr.adplayer.api.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ManifestResponse(
    val version: Int,
    @SerialName("device_id") val deviceId: String,
    @SerialName("refresh_seconds") val refreshSeconds: Long = 300,
    val assets: List<Asset> = emptyList(),
    val playlist: List<PlaylistItem> = emptyList()
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
    @SerialName("duration_ms") val durationMs: Long,
    val type: String // "image" | "video"
)

@Serializable
data class BeaconHeartbeatRequest(
    val status: String,
    @SerialName("battery_level") val batteryLevel: Float? = null
)

@Serializable
data class BeaconImpressionRequest(
    val items: List<ImpressionItem>
)

@Serializable
data class ImpressionItem(
    @SerialName("asset_id") val assetId: String,
    @SerialName("campaign_id") val campaignId: String?,
    @SerialName("started_at") val startedAt: String, // ISO8601
    @SerialName("duration_ms") val durationMs: Long
)
