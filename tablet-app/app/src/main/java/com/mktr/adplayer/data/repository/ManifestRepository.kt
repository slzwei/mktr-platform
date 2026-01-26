package com.mktr.adplayer.data.repository

import android.util.Log
import com.mktr.adplayer.api.model.ManifestResponse
import com.mktr.adplayer.api.service.AdTechService
import com.mktr.adplayer.data.local.DevicePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Singleton
class ManifestRepository @Inject constructor(
    private val api: AdTechService,
    private val prefs: DevicePrefs,
    private val timeProvider: com.mktr.adplayer.sync.TimeProvider // Injected
) {

    suspend fun refreshManifest(): Result<ManifestResponse?> {
        return withContext(Dispatchers.IO) {
            try {
                val etag = prefs.lastManifestEtag
                Log.d("ManifestRepo", "Fetching manifest with ETag: $etag")

                val response = api.getManifest(etag)

                if (response.isSuccessful) {
                    val newManifest = response.body()
                    val newEtag = response.headers()["ETag"]

                    if (newManifest != null) {
                        Log.d("ManifestRepo", "New manifest received. Ver: ${newManifest.version}")
                        
                        // [Sync V4] Use NTP for time sync (no server-time dependency)
                        timeProvider.syncWithNtp()
                        
                        // Save new ETag
                        if (newEtag != null) {
                            prefs.lastManifestEtag = newEtag
                        }
                        // Save to Prefs (Simple Cache)
                        try {
                            val json = Json.encodeToString(newManifest)
                            prefs.lastManifestJson = json
                        } catch (e: Exception) {
                            Log.e("ManifestRepo", "Failed to cache manifest", e)
                        }
                        
                        return@withContext Result.success(newManifest)
                    } else if (response.code() == 204) {
                         // Should not happen for this route, but handle 204 No Content
                         return@withContext Result.success(null)
                    } else {
                         // Body null but 200 OK?
                         return@withContext Result.failure(Exception("Empty body"))
                    }
                } else if (response.code() == 304) {
                    Log.d("ManifestRepo", "Manifest not modified (304). Using Cache.")
                    // Load from Cache
                    val cachedJson = prefs.lastManifestJson
                    if (cachedJson != null) {
                        try {
                             val manifest = Json.decodeFromString<ManifestResponse>(cachedJson)
                             return@withContext Result.success(manifest)
                        } catch (e: Exception) {
                            Log.e("ManifestRepo", "Failed to decode cached manifest", e)
                            return@withContext Result.success(null) // Cache corrupted
                        }
                    } else {
                        Log.w("ManifestRepo", "304 received but local cache is missing. Clearing ETag and retrying...")
                        // Cache Inconsistency: We have ETag but no JSON.
                        // Fix: Clear ETag and force full fetch.
                        prefs.lastManifestEtag = null
                        // Recursive retry (now without ETag)
                        return@withContext refreshManifest()
                    }
                } else {
                    return@withContext Result.failure(Exception("API Error: ${response.code()} ${response.message()}"))
                }
            } catch (e: Exception) {
                Log.e("ManifestRepo", "Network error", e)
                return@withContext Result.failure(e)
            }
        }
    }
    suspend fun startProvisioning(sessionCode: String): Result<com.mktr.adplayer.api.model.ProvisioningSessionResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.createProvisioningSession(
                    com.mktr.adplayer.api.model.ProvisioningSessionRequest(sessionCode)
                )
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Provisioning start failed: ${response.code()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun checkProvisioning(sessionCode: String): Result<com.mktr.adplayer.api.model.ProvisioningCheckResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.checkProvisioningStatus(sessionCode)
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Check failed: ${response.code()}"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}

