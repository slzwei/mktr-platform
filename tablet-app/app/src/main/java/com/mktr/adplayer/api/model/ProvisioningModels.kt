package com.mktr.adplayer.api.model

import kotlinx.serialization.Serializable

@Serializable
data class ProvisioningSessionRequest(
    val sessionCode: String,
    val ipAddress: String? = null
)

@Serializable
data class ProvisioningSessionResponse(
    val success: Boolean,
    val expiresAt: String? = null,
    val message: String? = null
)

@Serializable
data class ProvisioningCheckResponse(
    val status: String, // pending, fulfilled, expired, not_found
    val deviceKey: String? = null
)
