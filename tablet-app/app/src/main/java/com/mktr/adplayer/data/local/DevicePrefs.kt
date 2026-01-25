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

    var lastManifestJson: String?
        get() = prefs.getString(KEY_MANIFEST_JSON, null)
        set(value) = prefs.edit().putString(KEY_MANIFEST_JSON, value).apply()

    // Vehicle Pairing Configuration
    var deviceRole: String?  // "master" or "slave"
        get() = prefs.getString(KEY_DEVICE_ROLE, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ROLE, value).apply()

    var vehicleId: String?
        get() = prefs.getString(KEY_VEHICLE_ID, null)
        set(value) = prefs.edit().putString(KEY_VEHICLE_ID, value).apply()

    var hotspotSsid: String?
        get() = prefs.getString(KEY_HOTSPOT_SSID, null)
        set(value) = prefs.edit().putString(KEY_HOTSPOT_SSID, value).apply()

    var hotspotPassword: String?
        get() = prefs.getString(KEY_HOTSPOT_PASSWORD, null)
        set(value) = prefs.edit().putString(KEY_HOTSPOT_PASSWORD, value).apply()

    val isMaster: Boolean
        get() = deviceRole == "master"

    val isSlave: Boolean
        get() = deviceRole == "slave"

    val isPaired: Boolean
        get() = !vehicleId.isNullOrEmpty()

    companion object {
        private const val KEY_DEVICE_KEY = "device_key"
        private const val KEY_MANIFEST_ETAG = "manifest_etag"
        private const val KEY_MANIFEST_JSON = "manifest_json"
        private const val KEY_DEVICE_ROLE = "device_role"
        private const val KEY_VEHICLE_ID = "vehicle_id"
        private const val KEY_HOTSPOT_SSID = "hotspot_ssid"
        private const val KEY_HOTSPOT_PASSWORD = "hotspot_password"
    }
}
