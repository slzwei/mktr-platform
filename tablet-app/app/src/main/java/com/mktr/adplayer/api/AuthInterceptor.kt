package com.mktr.adplayer.api

import com.mktr.adplayer.data.local.DevicePrefs
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

class AuthInterceptor @Inject constructor(
    private val devicePrefs: DevicePrefs
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder()
            .header("User-Agent", "MKTR-AdPlayer/1.0 Android")
        
        devicePrefs.deviceKey?.let { key ->
            builder.header("X-Device-Key", key)
        }

        return chain.proceed(builder.build())
    }
}
