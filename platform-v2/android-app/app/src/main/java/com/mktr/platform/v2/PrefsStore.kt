package com.mktr.platform.v2

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.UUID

// Extension property to create the DataStore singleton
val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class PrefsStore(private val context: Context) {

    companion object {
        val DEVICE_ID_KEY = stringPreferencesKey("device_id")
        val BACKEND_URL_KEY = stringPreferencesKey("backend_url")
        // Default URL for production
        const val RELAUNCH_URL = "http://localhost:3000" // For Emulator vs Host logic
        const val DEFAULT_BACKEND_URL = "https://dooh-backend.onrender.com"
        const val DEFAULT_DEV_URL = "http://10.0.2.2:3000" // Accessible from Emulator
    }

    val deviceIdFlow: Flow<String> = context.dataStore.data
        .map { preferences ->
            preferences[DEVICE_ID_KEY] ?: ""
        }

    val backendUrlFlow: Flow<String> = context.dataStore.data
        .map { preferences ->
            preferences[BACKEND_URL_KEY] ?: DEFAULT_BACKEND_URL
        }

    suspend fun getDeviceId(): String {
        var id = ""
        context.dataStore.edit { preferences ->
            val currentId = preferences[DEVICE_ID_KEY]
            if (currentId.isNullOrEmpty()) {
                val newId = UUID.randomUUID().toString()
                preferences[DEVICE_ID_KEY] = newId
                id = newId
            } else {
                id = currentId
            }
        }
        return id
    }

    suspend fun setBackendUrl(url: String) {
        context.dataStore.edit { preferences ->
            preferences[BACKEND_URL_KEY] = url
        }
    }
    
    suspend fun resetDeviceId() {
        context.dataStore.edit { preferences ->
            preferences[DEVICE_ID_KEY] = UUID.randomUUID().toString()
        }
    }
}
