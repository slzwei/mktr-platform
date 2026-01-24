package com.mktr.adplayer.data.manager

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LocationManager provides GPS location for fleet tracking.
 * Uses FusedLocationProvider with high accuracy (car-powered, no battery concerns).
 * Returns null if permission denied or location unavailable.
 */
@Singleton
class LocationManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "LocationManager"
        private const val LOCATION_MAX_AGE_MS = 5 * 60 * 1000L // 5 minutes
    }

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)

    private var cachedLocation: Location? = null
    private var cachedTimestamp: Long = 0

    /**
     * Get the last known location.
     * Returns cached location if fresh enough, otherwise fetches new one.
     * Returns null if permission denied or location unavailable.
     */
    @SuppressLint("MissingPermission")
    suspend fun getLastLocation(): Location? {
        // Check permission first
        if (!hasLocationPermission()) {
            Log.w(TAG, "Location permission not granted")
            return null
        }

        // Return cached location if fresh enough
        val now = System.currentTimeMillis()
        if (cachedLocation != null && (now - cachedTimestamp) < LOCATION_MAX_AGE_MS) {
            return cachedLocation
        }

        return try {
            // Try to get current location with high accuracy
            val cancellationToken = CancellationTokenSource()
            val location = fusedLocationClient.getCurrentLocation(
                Priority.PRIORITY_HIGH_ACCURACY,
                cancellationToken.token
            ).await()

            if (location != null) {
                cachedLocation = location
                cachedTimestamp = now
                Log.d(TAG, "Location updated: ${location.latitude}, ${location.longitude}")
            } else {
                // Fallback to last known location
                val lastLocation = fusedLocationClient.lastLocation.await()
                if (lastLocation != null) {
                    cachedLocation = lastLocation
                    cachedTimestamp = now
                    Log.d(TAG, "Using last known location: ${lastLocation.latitude}, ${lastLocation.longitude}")
                }
            }

            cachedLocation
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get location", e)
            cachedLocation // Return stale cache as fallback
        }
    }

    /**
     * Check if location permission is granted.
     */
    fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Get cached latitude (null-safe for heartbeat).
     */
    suspend fun getLatitude(): Double? = getLastLocation()?.latitude

    /**
     * Get cached longitude (null-safe for heartbeat).
     */
    suspend fun getLongitude(): Double? = getLastLocation()?.longitude
}
