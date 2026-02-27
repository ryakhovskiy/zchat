package com.zchat.mobile.data.local

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

private val Context.authDataStore by preferencesDataStore(name = "auth_store")

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
    private val tokenKey = stringPreferencesKey("token")
    private val usernameKey = stringPreferencesKey("username")
    private val userIdKey = longPreferencesKey("user_id")
    private val rememberMeKey = booleanPreferencesKey("remember_me")

    val session: Flow<AuthSession> = context.authDataStore.data
        .catch { throwable ->
            if (throwable is IOException) {
                emit(emptyPreferences())
            } else {
                throw throwable
            }
        }
        .map { prefs ->
            AuthSession(
                token = prefs[tokenKey],
                username = prefs[usernameKey],
                userId = prefs[userIdKey],
                rememberMe = prefs[rememberMeKey] ?: false
            )
        }

    suspend fun saveSession(token: String, username: String, userId: Long, rememberMe: Boolean) {
        context.authDataStore.edit { prefs: MutablePreferences ->
            prefs[tokenKey] = token
            prefs[usernameKey] = username
            prefs[userIdKey] = userId
            prefs[rememberMeKey] = rememberMe
        }
    }

    suspend fun clear() {
        context.authDataStore.edit { prefs ->
            prefs.remove(tokenKey)
            prefs.remove(usernameKey)
            prefs.remove(userIdKey)
            prefs.remove(rememberMeKey)
        }
    }
}