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

    suspend fun getAssetFile(asset: Asset): File {
        val file = File(assetDir, "${asset.id}_${asset.hash.take(8)}") // Simple cache key
        if (!file.exists()) {
            downloadAsset(asset.url, file)
        }
        return file
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
        Log.d("AssetManager", "Download complete: ${destination.name}")
    }

    // Helper to clear unused assets (TODO for later)
    fun getLocalFileUri(asset: Asset): String {
        return File(assetDir, "${asset.id}_${asset.hash.take(8)}").absolutePath
    }
}
