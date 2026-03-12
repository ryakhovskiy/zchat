package com.zchat.mobile.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

data class AuthSession(
    val token: String? = null,
    val username: String? = null,
    val userId: Long? = null,
    val rememberMe: Boolean = false
)

@Singleton
class AuthTokenStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private companion object {
        const val KEY_TOKEN = "token"
        const val KEY_USERNAME = "username"
        const val KEY_USER_ID = "user_id"
        const val KEY_REMEMBER_ME = "remember_me"
    }

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        "auth_encrypted_prefs",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    /** Synchronous in-memory cache so AuthInterceptor never needs runBlocking. */
    @Volatile
    var memCache: AuthSession = readFromPrefs()
        private set

    private val _session = MutableStateFlow(memCache)
    val session: StateFlow<AuthSession> = _session.asStateFlow()

    private fun readFromPrefs(): AuthSession {
        val token = prefs.getString(KEY_TOKEN, null)
        if (token.isNullOrBlank()) return AuthSession()
        return AuthSession(
            token = token,
            username = prefs.getString(KEY_USERNAME, null),
            userId = prefs.getLong(KEY_USER_ID, 0L).takeIf { it != 0L },
            rememberMe = prefs.getBoolean(KEY_REMEMBER_ME, false)
        )
    }

    suspend fun saveSession(token: String, username: String, userId: Long, rememberMe: Boolean) {
        val newSession = AuthSession(token = token, username = username, userId = userId, rememberMe = rememberMe)
        memCache = newSession
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USERNAME, username)
            .putLong(KEY_USER_ID, userId)
            .putBoolean(KEY_REMEMBER_ME, rememberMe)
            .apply()
        _session.value = newSession
    }

    suspend fun clear() {
        memCache = AuthSession()
        prefs.edit().clear().apply()
        _session.value = AuthSession()
    }
}