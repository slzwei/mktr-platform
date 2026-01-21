package com.mktr.adplayer.data.local

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DevicePrefs @Inject constructor(
    @ApplicationContext context: Context
) {
    private val prefs: SharedPreferences = context.getSharedPreferences("adplayer_prefs", Context.MODE_PRIVATE)

    var deviceKey: String?
        get() = prefs.getString(KEY_DEVICE_KEY, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_KEY, value).apply()

    var lastManifestEtag: String?
        get() = prefs.getString(KEY_MANIFEST_ETAG, null)
        set(value) = prefs.edit().putString(KEY_MANIFEST_ETAG, value).apply()

    companion object {
        private const val KEY_DEVICE_KEY = "device_key"
        private const val KEY_MANIFEST_ETAG = "manifest_etag"
    }
}
