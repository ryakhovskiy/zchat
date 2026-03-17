package com.zchat.mobile.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.zchat.mobile.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ServerConfigManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private companion object {
        val KEY_API_BASE_URL = stringPreferencesKey("server_api_base_url")
        val KEY_WS_BASE_URL = stringPreferencesKey("server_ws_base_url")
        val KEY_WS_ORIGIN = stringPreferencesKey("server_ws_origin")
    }

    @Volatile var apiBaseUrl: String = BuildConfig.API_BASE_URL
        private set
    @Volatile var wsBaseUrl: String = BuildConfig.WS_BASE_URL
        private set
    @Volatile var wsOrigin: String = BuildConfig.WS_ORIGIN
        private set

    init {
        runBlocking {
            val prefs = context.settingsDataStore.data.first()
            prefs[KEY_API_BASE_URL]?.let { apiBaseUrl = it }
            prefs[KEY_WS_BASE_URL]?.let { wsBaseUrl = it }
            prefs[KEY_WS_ORIGIN]?.let { wsOrigin = it }
        }
    }

    suspend fun save(apiBase: String, wsBase: String, wsOrig: String) {
        apiBaseUrl = apiBase
        wsBaseUrl = wsBase
        wsOrigin = wsOrig
        context.settingsDataStore.edit { prefs ->
            prefs[KEY_API_BASE_URL] = apiBase
            prefs[KEY_WS_BASE_URL] = wsBase
            prefs[KEY_WS_ORIGIN] = wsOrig
        }
    }

    suspend fun resetToDefaults() {
        apiBaseUrl = BuildConfig.API_BASE_URL
        wsBaseUrl = BuildConfig.WS_BASE_URL
        wsOrigin = BuildConfig.WS_ORIGIN
        context.settingsDataStore.edit { prefs ->
            prefs.remove(KEY_API_BASE_URL)
            prefs.remove(KEY_WS_BASE_URL)
            prefs.remove(KEY_WS_ORIGIN)
        }
    }
}
