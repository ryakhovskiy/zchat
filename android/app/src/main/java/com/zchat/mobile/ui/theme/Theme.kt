package com.zchat.mobile.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

enum class ThemeMode {
    HACKER,
    DARK,
    LIGHT
}

private val HackerColorScheme = darkColorScheme(
    primary = Color(0xFF00FF00),
    secondary = Color(0xFF00AA00),
    tertiary = Color(0xFF008800),
    background = Color(0xFF000000),
    surface = Color(0xFF001A00),
    onPrimary = Color(0xFF000000),
    onSecondary = Color(0xFF000000),
    onTertiary = Color(0xFF000000),
    onBackground = Color(0xFF00FF00),
    onSurface = Color(0xFF00FF00)
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF82C3FF),
    secondary = Color(0xFFBCC7DB),
    tertiary = Color(0xFFD6BEE4),
    background = Color(0xFF1A1C1E),
    surface = Color(0xFF1A1C1E),
    onPrimary = Color(0xFF003258),
    onSecondary = Color(0xFF263141),
    onTertiary = Color(0xFF3B2948),
    onBackground = Color(0xFFE2E2E6),
    onSurface = Color(0xFFE2E2E6)
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF0061A4),
    secondary = Color(0xFF535F70),
    tertiary = Color(0xFF6B587B),
    background = Color(0xFFFDFDFD),
    surface = Color(0xFFFDFDFD),
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = Color.White,
    onBackground = Color(0xFF1A1C1E),
    onSurface = Color(0xFF1A1C1E)
)

@Composable
fun ZChatTheme(
    themeMode: ThemeMode = ThemeMode.HACKER,
    dynamicColor: Boolean = false, // Disabled by default for hacker theme consistency
    content: @Composable () -> Unit
) {
    val colorScheme = when (themeMode) {
        ThemeMode.HACKER -> HackerColorScheme
        ThemeMode.DARK -> DarkColorScheme
        ThemeMode.LIGHT -> LightColorScheme
    }
    
    val darkTheme = themeMode != ThemeMode.LIGHT
    
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = Color.Transparent.toArgb()
            window.navigationBarColor = Color.Transparent.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
