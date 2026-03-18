package com.zchat.mobile.data.local

import android.content.Context
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.edit
import com.zchat.mobile.ui.theme.ThemeMode
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val THEME_MODE_KEY = stringPreferencesKey("theme_mode")

    val themeMode: Flow<ThemeMode> = context.settingsDataStore.data.map { preferences ->
        try {
            val themeStr = preferences[THEME_MODE_KEY]
            if (themeStr != null) {
                ThemeMode.valueOf(themeStr)
            } else {
                ThemeMode.HACKER
            }
        } catch (e: Exception) {
            ThemeMode.HACKER
        }
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.settingsDataStore.edit { preferences ->
            preferences[THEME_MODE_KEY] = mode.name
        }
    }
}
