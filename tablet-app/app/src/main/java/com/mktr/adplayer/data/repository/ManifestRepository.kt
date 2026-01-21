package com.mktr.adplayer.data.repository

import android.util.Log
import com.mktr.adplayer.api.model.ManifestResponse
import com.mktr.adplayer.api.service.AdTechService
import com.mktr.adplayer.data.local.DevicePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ManifestRepository @Inject constructor(
    private val api: AdTechService,
    private val prefs: DevicePrefs
) {

    suspend fun refreshManifest(): Result<ManifestResponse?> {
        return withContext(Dispatchers.IO) {
            try {
                // Get cached ETag
                val etag = prefs.lastManifestEtag
                Log.d("ManifestRepo", "Fetching manifest with ETag: $etag")

                val response = api.getManifest(etag)

                if (response.isSuccessful) {
                    val newManifest = response.body()
                    val newEtag = response.headers()["ETag"]

                    if (newManifest != null) {
                        Log.d("ManifestRepo", "New manifest received. Version: ${newManifest.version}")
                        // Save new ETag
                        if (newEtag != null) {
                            prefs.lastManifestEtag = newEtag
                        }
                        // TODO: Save to Room Database for offline support
                        return@withContext Result.success(newManifest)
                    } else if (response.code() == 204) {
                         // Should not happen for this route, but handle 204 No Content
                         return@withContext Result.success(null)
                    } else {
                         // Body null but 200 OK?
                         return@withContext Result.failure(Exception("Empty body"))
                    }
                } else if (response.code() == 304) {
                    Log.d("ManifestRepo", "Manifest not modified (304).")
                    return@withContext Result.success(null) // Signal no change
                } else {
                    return@withContext Result.failure(Exception("API Error: ${response.code()} ${response.message()}"))
                }
            } catch (e: Exception) {
                Log.e("ManifestRepo", "Network error", e)
                return@withContext Result.failure(e)
            }
        }
    }
}
