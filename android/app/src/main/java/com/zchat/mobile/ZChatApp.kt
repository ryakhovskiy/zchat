package com.zchat.mobile

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import javax.inject.Inject

@HiltAndroidApp
class ZChatApp : Application(), ImageLoaderFactory {

    @Inject lateinit var okHttpClient: OkHttpClient

    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .okHttpClient(okHttpClient)
            .build()
}