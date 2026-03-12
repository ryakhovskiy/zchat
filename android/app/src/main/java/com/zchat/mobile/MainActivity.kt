package com.zchat.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import com.zchat.mobile.data.local.SettingsManager
import com.zchat.mobile.ui.theme.ZChatTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var settingsManager: SettingsManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val systemTheme = isSystemInDarkTheme()
            val isDarkTheme by settingsManager.isDarkMode.collectAsState(initial = systemTheme)
            val darkThemeToUse = isDarkTheme ?: systemTheme

            ZChatTheme(darkTheme = darkThemeToUse) {
                ZChatRoot(
                    isDarkMode = darkThemeToUse,
                    onToggleDarkMode = { enabled ->
                        lifecycleScope.launch {
                            settingsManager.setDarkMode(enabled)
                        }
                    }
                )
            }
        }
    }
}