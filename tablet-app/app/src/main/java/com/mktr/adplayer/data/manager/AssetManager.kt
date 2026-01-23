package com.mktr.adplayer.data.manager

import android.content.Context
import android.util.Log
import com.mktr.adplayer.api.model.Asset
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AssetManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val okHttpClient: OkHttpClient
) {
    private val assetDir = File(context.filesDir, "ad_assets")

    init {
        if (!assetDir.exists()) assetDir.mkdirs()
    }

    /**
     * Downloads all assets in the list.
     * Returns true if ALL assets are successfully available on disk.
     * Returns false if any download fails.
     */
    suspend fun prepareAssets(assets: List<Asset>): Boolean = withContext(Dispatchers.IO) {
        var allSuccess = true
        
        for (asset in assets) {
            val file = getAssetFileObject(asset)
            if (file.exists() && file.length() > 0) {
                // Already exists, skip download
                continue
            }

            try {
                // Download to .tmp first completely
                val tmpFile = File(assetDir, "${file.name}.tmp")
                downloadAsset(asset.url, tmpFile)
                
                // Atomic rename to final name
                if (tmpFile.renameTo(file)) {
                    Log.d("AssetManager", "Asset ready: ${file.name}")
                } else {
                    Log.e("AssetManager", "Failed to rename tmp file: ${tmpFile.name}")
                    allSuccess = false
                    break // Stop on error
                }
            } catch (e: Exception) {
                Log.e("AssetManager", "Failed to download asset: ${asset.id}", e)
                allSuccess = false
                break // Stop on error
            }
        }
        return@withContext allSuccess
    }

    /**
     * Deletes any file in the asset directory that is NOT in the activeAssets list.
     */
    fun cleanupAssets(activeAssets: List<Asset>) {
        try {
            val keptFiles = activeAssets.map { getAssetFileObject(it).name }.toSet()
            val allFiles = assetDir.listFiles() ?: return

            var deletedCount = 0
            for (file in allFiles) {
                // Don't delete tmp files currently downloading
                if (file.name.endsWith(".tmp")) continue
                
                if (!keptFiles.contains(file.name)) {
                    if (file.delete()) {
                        deletedCount++
                        Log.d("AssetManager", "Deleted unused asset: ${file.name}")
                    } else {
                        Log.w("AssetManager", "Failed to delete unused asset: ${file.name}")
                    }
                }
            }
            if (deletedCount > 0) {
                Log.i("AssetManager", "Garbage Collection: Cleaned up $deletedCount files.")
            }
        } catch (e: Exception) {
            Log.e("AssetManager", "Error during asset cleanup", e)
        }
    }

    fun getAssetFile(asset: Asset): File {
        return getAssetFileObject(asset)
    }

    private fun getAssetFileObject(asset: Asset): File {
        return File(assetDir, "${asset.id}_${asset.hash.take(8)}")
    }

    private suspend fun downloadAsset(url: String, destination: File) = withContext(Dispatchers.IO) {
        Log.d("AssetManager", "Downloading $url to ${destination.name}")
        val request = Request.Builder().url(url).build()
        val response = okHttpClient.newCall(request).execute()
        
        if (!response.isSuccessful) throw Exception("Failed to download asset: ${response.code}")

        response.body?.byteStream()?.use { input ->
            FileOutputStream(destination).use { output ->
                input.copyTo(output)
            }
        } ?: throw Exception("Empty body")
    }

    fun getLocalFileUri(asset: Asset): String {
        return getAssetFileObject(asset).absolutePath
    }
}
